// server/services/llm.js - LLM service (OpenAI Compatible API)
const axios = require('axios');
// Force http adapter for Node.js 18 compatibility (avoid undici/fetch issues)
const axiosInstance = axios.create({ adapter: 'http' });
const { getConfig } = require('../db/queries');
const { decrypt } = require('../utils/crypto');
const logger = require('../utils/logger');


const CATEGORIES = [
    '人工智能', '计算机科学', '心理学', '哲学', '历史', '自然科学', '数学',
    '经济与金融', '商业与管理', '艺术与设计', '音乐', '影视与娱乐', '文学与写作',
    '政治与社会', '法律', '医学与健康', '体育与健身', '美食与烹饪', '旅行与地理',
    '游戏', '产品与技术', '教育', '工程与制造', '生态与环境', '其他'
];

function getLlmConfig() {
    const rawKey = getConfig('llm.api_key');
    const apiKey = rawKey ? decrypt(rawKey) : null;
    const provider = getConfig('llm.provider') || 'openai'; // default to openai
    
    let baseUrl = getConfig('llm.base_url');
    if (!baseUrl) {
        baseUrl = provider === 'anthropic' ? 'https://api.anthropic.com/v1' : 'https://api.openai.com/v1';
    }
    
    // Normalize baseUrl to prevent 404 errors
    baseUrl = baseUrl.replace(/\/+$/, '');
    if (baseUrl.endsWith('/chat/completions')) {
        baseUrl = baseUrl.replace(/\/chat\/completions$/, '');
    } else if (baseUrl.endsWith('/messages')) {
        baseUrl = baseUrl.replace(/\/messages$/, '');
    }
    
    const model = getConfig('llm.model') || 'gpt-4o-mini';
    return { apiKey, baseUrl, model, provider };
}

function getConfiguredModel() {
    return getLlmConfig().model;
}

async function chat(messages, { temperature = 0.3, maxTokens = 1000, timeout = 30000, thinking = null } = {}) {
    const { apiKey, baseUrl, model, provider } = getLlmConfig();
    if (!apiKey) throw new Error('LLM API key not configured. Please set it in Settings.');

    // Support Anthropic Standard API format based on provider setting
    const isAnthropic = provider === 'anthropic';

    if (isAnthropic) {
        const response = await axiosInstance.post(
            `${baseUrl.replace(/\/$/, '')}/messages`,
            buildAnthropicRequestPayload(messages, { temperature, maxTokens, thinking }, model, baseUrl),
            {
                headers: {
                    'x-api-key': apiKey,
                    'anthropic-version': '2023-06-01',
                    'Content-Type': 'application/json',
                },
                timeout,
            }
        );
        const content = extractAnthropicText(response.data.content);
        if (!content) {
            const err = new Error('LLM returned no text content');
            err.code = 'LLM_EMPTY_RESPONSE';
            throw err;
        }
        return content;
    }

    // Default to OpenAI Compatible API format
    const response = await axiosInstance.post(
        `${baseUrl.replace(/\/$/, '')}/chat/completions`,
        { model, messages, temperature, max_tokens: maxTokens },
        {
            headers: {
                'Authorization': `Bearer ${apiKey}`,
                'Content-Type': 'application/json',
            },
            timeout,
        }
    );

    return response.data.choices[0]?.message?.content || '';
}

function buildAnthropicRequestPayload(messages, options, model, baseUrl) {
    const payload = {
        model,
        messages,
        temperature: options?.temperature ?? 0.3,
        max_tokens: options?.maxTokens ?? 1000,
    };
    const isKimi = /kimi/i.test(String(model || '')) || /api\.kimi\.com/i.test(String(baseUrl || ''));
    if (options?.thinking === false && isKimi) {
        payload.thinking = { type: 'disabled' };
    }
    return payload;
}

function extractAnthropicText(content) {
    if (typeof content === 'string') return content.trim();
    if (!Array.isArray(content)) return '';

    const textBlocks = content
        .filter(block => block?.type === 'text' && typeof block.text === 'string')
        .map(block => block.text.trim())
        .filter(Boolean);
    if (textBlocks.length) return textBlocks.join('\n');

    // Some Anthropic-compatible providers return structured output as tool input.
    const toolBlock = content.find(block => block?.type === 'tool_use' && block.input != null);
    return toolBlock ? JSON.stringify(toolBlock.input) : '';
}

async function chatWithRetry(messages, options = {}, retryOptions = {}) {
    const {
        retries = 3,
        delays = [2500, 7000, 15000],
        onRetry = null,
    } = retryOptions;

    let lastErr = null;
    let attemptOptions = { ...options };
    for (let attempt = 0; attempt <= retries; attempt += 1) {
        try {
            return await chat(messages, attemptOptions);
        } catch (err) {
            lastErr = err;
            if (!isRetryableLlmError(err) || attempt >= retries) throw err;

            const retryAfter = parseRetryAfter(err);
            const delay = retryAfter || (err?.code === 'LLM_EMPTY_RESPONSE'
                ? 100
                : delays[Math.min(attempt, delays.length - 1)] || 2500);
            attemptOptions = expandOutputBudgetForRetry(attemptOptions, err);
            if (onRetry) await onRetry({ attempt: attempt + 1, retries, delay, err });
            await sleep(delay);
        }
    }
    throw lastErr;
}

function getLlmErrorStatus(err) {
    return err?.response?.status || err?.status || err?.statusCode || null;
}

function isRateLimitError(err) {
    const status = getLlmErrorStatus(err);
    const message = String(err?.message || err || '');
    return status === 429 || /status code 429|rate limit|too many requests|quota/i.test(message);
}

function isRetryableLlmError(err) {
    const status = getLlmErrorStatus(err);
    if (isRateLimitError(err)) return true;
    if (err?.code === 'LLM_EMPTY_RESPONSE') return true;
    return [408, 409, 425, 500, 502, 503, 504].includes(status);
}

function expandOutputBudgetForRetry(options, err) {
    if (err?.code !== 'LLM_EMPTY_RESPONSE') return { ...options };
    const current = Math.max(256, Number(options?.maxTokens || 1000));
    return { ...options, maxTokens: Math.min(current * 2, 8000) };
}

function parseRetryAfter(err) {
    const value = err?.response?.headers?.['retry-after'];
    const seconds = Number(value);
    if (Number.isFinite(seconds) && seconds > 0) return Math.min(seconds * 1000, 60000);
    const date = value ? Date.parse(value) : NaN;
    if (Number.isFinite(date)) return Math.min(Math.max(date - Date.now(), 0), 60000);
    return null;
}

function sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
}

async function classify(entry) {
    const categoriesList = CATEGORIES.join('、');
    const prompt = `你是一个内容分类助手。请根据以下内容信息进行分类。

内容标题: ${entry.title || '未知'}
内容来源平台: ${entry.platform || '未知'}
内容描述: ${entry.description || '无'}
作者: ${entry.author || '未知'}

请从以下分类中选择最匹配的一级分类：${categoriesList}

同时，请对标题和作者名进行清理和纠正（不要臆测，只需去除平台相关的后缀、诸如"XXX关注的XXX内容"等；提取出最核心的标题和真实的作者名或昵称）。如果无法提取出有效作者，可以返回原样或null。

只返回 JSON，不要任何解释：
{
  "category": "分类名称",
  "clean_title": "清理后的原文标题",
  "clean_author": "提取或清理后的作者名",
  "sub_category": "可选子分类，可为null",
  "tags": ["关键词1", "关键词2", "关键词3"],
  "summary": "50字以内的中文摘要"
}`;


    const content = await chat([{ role: 'user', content: prompt }], { thinking: false });
    const jsonMatch = content.match(/\{[\s\S]*\}/);
    if (!jsonMatch) throw new Error('Invalid LLM response format');

    const result = JSON.parse(jsonMatch[0]);
    // Validate category
    if (!CATEGORIES.includes(result.category)) result.category = '其他';
    return result;
}

async function generateBookTitle(entries) {
    if (!entries?.length) return null;
    const entrySummaries = entries.slice(0, 5).map(e => `- ${e.title || e.url}`).join('\n');

    const prompt = `我需要给同一个作者的多篇内容集合起一个书名，像一本书的标题一样简洁有力、引人入胜。

作者: ${entries[0]?.author || '未知'}
内容列表:
${entrySummaries}

请返回一个不超过15个字的中文书名（不加引号，直接返回书名）：`;

    const title = await chat([{ role: 'user', content: prompt }], { maxTokens: 50, thinking: false });
    return title.trim().replace(/["'《》]/g, '');
}

async function testLlmConnection() {
    const { apiKey, baseUrl, model } = getLlmConfig();
    if (!apiKey) throw new Error('API key not configured');

    const start = Date.now();
    const response = await chat([{ role: 'user', content: '请回复"连接成功"四个字' }], { maxTokens: 20 });
    const latency = Date.now() - start;

    return { model, baseUrl, latency, response: response.trim() };
}

module.exports = {
    chat,
    chatWithRetry,
    classify,
    generateBookTitle,
    testLlmConnection,
    getConfiguredModel,
    isRateLimitError,
    getLlmErrorStatus,
    extractAnthropicText,
    expandOutputBudgetForRetry,
    buildAnthropicRequestPayload,
};
