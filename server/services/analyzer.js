const crypto = require('crypto');
const { chat, getConfiguredModel } = require('./llm');
const { extractEntryContent } = require('./contentExtractor');
const { ensureVideoTranscript, isVideoEntry } = require('./videoTranscript');
const queries = require('../db/queries');
const logger = require('../utils/logger');

const DIRECT_ANALYSIS_CHARS = 12000;
const MAX_ANALYSIS_CHARS = 36000;
const CHUNK_SIZE = 5200;
const activeJobs = new Map();
let analysisQueue = Promise.resolve();

function getEntryAnalysis(entryId) {
    return queries.getEntryAnalysis(entryId);
}

function startEntryAnalysis(entryId, { force = false } = {}) {
    const entry = queries.getEntryById(entryId);
    if (!entry) {
        const err = new Error('Entry not found');
        err.statusCode = 404;
        throw err;
    }

    const existing = queries.getEntryAnalysis(entryId);
    if (!force && existing?.status === 'done') return existing;
    if (activeJobs.has(entryId)) return existing || markProcessing(entry, 2, '排队中');

    const status = markProcessing(entry, 2, '排队中');
    const job = analysisQueue.then(() => runEntryAnalysisNow(entryId, { force }))
        .catch(err => {
            logger.error(`Background analysis failed for ${entryId}`, err);
            markFailed(entryId, entry, err, 100, '生成失败');
        })
        .finally(() => activeJobs.delete(entryId));
    analysisQueue = job.catch(() => {});
    activeJobs.set(entryId, job);
    return status;
}

async function runEntryAnalysisNow(entryId, { force = false } = {}) {
    let entry = queries.getEntryById(entryId);
    if (!entry) {
        const err = new Error('Entry not found');
        err.statusCode = 404;
        throw err;
    }

    await updateProgress(entry, 8, '准备正文');
    if (force && isVideoEntry(entry)) {
        const transcript = await ensureVideoTranscript(entry, (progress, stage) => updateProgress(entry, progress, stage), { force: true });
        if (transcript.ok) {
            entry = queries.getEntryById(entryId);
        } else {
            const currentExtracted = await extractEntryContent(entry);
            return markNeedsContent(entry, currentExtracted, transcript.reason || currentExtracted.reason, transcript);
        }
    }

    let extracted = await extractEntryContent(entry);
    let contentHash = hashContent(extracted.text);
    const existing = queries.getEntryAnalysis(entryId);
    if (!force && existing?.status === 'done' && existing.content_hash === contentHash) {
        return existing;
    }

    if (!extracted.hasEnoughContent && isVideoEntry(entry)) {
        const transcript = await ensureVideoTranscript(entry, (progress, stage) => updateProgress(entry, progress, stage), { force });
        if (transcript.ok) {
            entry = queries.getEntryById(entryId);
            extracted = await extractEntryContent(entry);
            contentHash = hashContent(extracted.text);
        } else {
            return markNeedsContent(entry, extracted, transcript.reason || extracted.reason, transcript);
        }
    }

    if (!extracted.hasEnoughContent) {
        return markNeedsContent(entry, extracted, extracted.reason);
    }

    await updateProgress(entry, 28, '生成结构化导图');
    try {
        const result = await generateStructuredAnalysis(entry, extracted.text, (progress, stage) => updateProgress(entry, progress, stage));
        return queries.upsertEntryAnalysis({
            entry_id: entryId,
            status: 'done',
            content_hash: contentHash,
            source_kind: extracted.sourceKind,
            source_length: extracted.sourceLength,
            model: getConfiguredModel(),
            token_budget: selectTokenBudget(extracted.sourceLength),
            progress: 100,
            stage: '完成',
            result,
            error: null,
            finished_at: new Date().toISOString(),
        });
    } catch (err) {
        return markFailed(entryId, entry, err, 100, '生成失败', extracted, contentHash);
    }
}

async function generateStructuredAnalysis(entry, text, progress = async () => {}) {
    const clipped = text.slice(0, MAX_ANALYSIS_CHARS);
    if (clipped.length <= DIRECT_ANALYSIS_CHARS) {
        await progress(55, '提炼观点');
        return generateFinalMindMap(entry, clipped, [], progress);
    }

    const chunks = chunkText(clipped, CHUNK_SIZE);
    const chunkSummaries = [];
    for (let i = 0; i < chunks.length; i += 1) {
        await progress(32 + Math.round((i / chunks.length) * 38), `分段摘要 ${i + 1}/${chunks.length}`);
        chunkSummaries.push(await summarizeChunk(entry, chunks[i], i + 1, chunks.length));
    }
    await progress(76, '合并分段观点');
    return generateFinalMindMap(entry, chunkSummaries.map(item => JSON.stringify(item)).join('\n\n'), chunkSummaries, progress);
}

async function summarizeChunk(entry, chunk, index, total) {
    const prompt = `你在为个人知识库做长内容分段解读。请只基于本段内容提取事实和观点，不要臆测。

内容标题：${entry.title || '无标题'}
平台：${entry.platform || '未知'}
分段：${index}/${total}

本段内容：
${chunk}

请返回 JSON，不要解释：
{
  "segment": "${index}/${total}",
  "claims": ["本段核心观点1", "本段核心观点2"],
  "knowledge_points": ["知识点1", "知识点2"],
  "evidence": ["支撑材料或原文线索1", "支撑材料或原文线索2"],
  "questions": ["值得继续追问的问题"]
}`;
    try {
        const text = await chat([{ role: 'user', content: prompt }], { temperature: 0.2, maxTokens: 900, timeout: 90000 });
        return await parseJsonObjectWithRepair(text, '分段摘要 JSON');
    } catch (err) {
        return {
            segment: `${index}/${total}`,
            claims: [`本段解析失败，已跳过：${friendlyAnalysisError(err)}`],
            knowledge_points: [],
            evidence: [],
            questions: [],
        };
    }
}

async function generateFinalMindMap(entry, content, chunkSummaries = [], progress = async () => {}) {
    const prompt = `你是一个严谨的知识管理分析器。请基于给定内容生成“真实内容解读思维导图”，用于个人知识库详情页展示。

要求：
1. 只基于内容本身，不要补充外部知识或编造细节。
2. 输出观点、知识点和证据线索，不要只复述标题。
3. 如果内容是分段摘要，请综合各段，保留重要脉络。
4. 节点名称要短，detail 可以稍长。
5. 返回严格 JSON，不要 Markdown，不要解释。

内容元信息：
- 标题：${entry.title || '无标题'}
- 作者：${entry.author || '未知'}
- 平台：${entry.platform || '未知'}
- 分类：${entry.category || '未分类'}
- 标签：${Array.isArray(entry.tags) ? entry.tags.join('、') : ''}
- 分段摘要数量：${chunkSummaries.length}

内容：
${content}

JSON 结构：
{
  "title": "内容标题",
  "thesis": "一句话概括核心论点",
  "mind_map": {
    "root": "中心主题",
    "nodes": [
      {
        "label": "一级节点",
        "summary": "该节点概括",
        "children": [
          {
            "label": "二级节点",
            "detail": "具体解释",
            "evidence": "来自内容的支撑线索，可为空"
          }
        ]
      }
    ]
  },
  "knowledge_points": ["关键知识点"],
  "questions": ["值得继续追问的问题"],
  "content_coverage": "说明本次解读依据的内容范围",
  "limitations": ["如果内容不足或存在限制，在这里说明"]
}`;

    await progress(84, '生成最终导图');
    const response = await chat([{ role: 'user', content: prompt }], { temperature: 0.25, maxTokens: 2600, timeout: 90000 });
    const parsed = await parseJsonObjectWithRepair(response, '思维导图 JSON');
    return normalizeAnalysisResult(parsed, entry);
}

async function parseJsonObjectWithRepair(text, purpose) {
    const first = parseJsonObject(text);
    if (first.ok) return first.value;

    const prompt = `请修复下面这段${purpose}，只返回合法 JSON，不要解释。不要改写字段含义。

原始内容：
${String(text || '').slice(0, 12000)}`;
    const repaired = await chat([{ role: 'user', content: prompt }], { temperature: 0, maxTokens: 2800, timeout: 90000 });
    const second = parseJsonObject(repaired);
    if (second.ok) return second.value;
    throw new Error('LLM returned malformed analysis JSON after repair');
}

function parseJsonObject(text) {
    const cleaned = String(text || '').replace(/```(?:json)?/gi, '').replace(/```/g, '').trim();
    const start = cleaned.indexOf('{');
    if (start < 0) return { ok: false };
    const candidate = extractBalancedJson(cleaned, start) || cleaned.slice(start, cleaned.lastIndexOf('}') + 1);
    try {
        return { ok: true, value: JSON.parse(candidate) };
    } catch {
        return { ok: false };
    }
}

function normalizeAnalysisResult(result, entry) {
    const nodes = Array.isArray(result?.mind_map?.nodes) ? result.mind_map.nodes : [];
    return {
        title: result?.title || entry.title || '无标题',
        thesis: result?.thesis || '',
        mind_map: {
            root: result?.mind_map?.root || result?.title || entry.title || '内容解读',
            nodes: nodes.slice(0, 6).map(node => ({
                label: String(node.label || '要点').slice(0, 40),
                summary: String(node.summary || '').slice(0, 140),
                children: Array.isArray(node.children)
                    ? node.children.slice(0, 5).map(child => ({
                        label: String(child.label || '知识点').slice(0, 48),
                        detail: String(child.detail || '').slice(0, 180),
                        evidence: String(child.evidence || '').slice(0, 180),
                    }))
                    : [],
            })),
        },
        knowledge_points: Array.isArray(result?.knowledge_points) ? result.knowledge_points.slice(0, 8) : [],
        questions: Array.isArray(result?.questions) ? result.questions.slice(0, 5) : [],
        content_coverage: result?.content_coverage || '基于当前可获取正文生成',
        limitations: Array.isArray(result?.limitations) ? result.limitations.slice(0, 4) : [],
    };
}

function markProcessing(entry, progress, stage) {
    return queries.upsertEntryAnalysis({
        entry_id: entry.id,
        status: 'processing',
        content_hash: null,
        source_kind: null,
        source_length: 0,
        model: getConfiguredModel(),
        token_budget: 'pending',
        progress,
        stage,
        result: { title: entry.title || '无标题' },
        error: null,
        started_at: new Date().toISOString(),
        finished_at: null,
    });
}

async function updateProgress(entry, progress, stage) {
    const existing = queries.getEntryAnalysis(entry.id);
    const nextProgress = Math.max(Number(existing?.progress || 0), Number(progress || 0));
    queries.upsertEntryAnalysis({
        entry_id: entry.id,
        status: 'processing',
        model: getConfiguredModel(),
        token_budget: 'pending',
        progress: nextProgress,
        stage,
        result: { title: entry.title || '无标题' },
        error: null,
        started_at: new Date().toISOString(),
        finished_at: null,
    });
}

function markNeedsContent(entry, extracted, reason, details = {}) {
    return queries.upsertEntryAnalysis({
        entry_id: entry.id,
        status: 'needs_content',
        content_hash: hashContent(extracted.text),
        source_kind: extracted.sourceKind,
        source_length: extracted.sourceLength,
        model: getConfiguredModel(),
        token_budget: 'none',
        progress: 100,
        stage: '需要更多正文',
        result: {
            title: entry.title || '无标题',
            reason,
            required_content: getRequiredContent(entry.platform),
            setup_action: details.setup_action || null,
            setup_command: details.setup_command || null,
            missing_tools: details.missing_tools || null,
            model_path: details.model_path || null,
            mind_map: null,
        },
        error: reason,
        finished_at: new Date().toISOString(),
    });
}

function markFailed(entryId, entry, err, progress = 100, stage = '生成失败', extracted = null, contentHash = null) {
    return queries.upsertEntryAnalysis({
        entry_id: entryId,
        status: 'failed',
        content_hash: contentHash || null,
        source_kind: extracted?.sourceKind || null,
        source_length: extracted?.sourceLength || 0,
        model: getConfiguredModel(),
        token_budget: extracted ? selectTokenBudget(extracted.sourceLength) : 'unknown',
        progress,
        stage,
        result: { title: entry?.title || '无标题' },
        error: friendlyAnalysisError(err),
        finished_at: new Date().toISOString(),
    });
}

function friendlyAnalysisError(err) {
    const message = String(err?.message || err || '未知错误');
    if (/malformed|Invalid LLM|JSON|parse/i.test(message)) return '模型返回的解读格式不完整，已尝试自动修复但仍失败。请重试生成。';
    return message;
}

function extractBalancedJson(text, start) {
    let depth = 0;
    let inString = false;
    let escape = false;
    for (let i = start; i < text.length; i += 1) {
        const char = text[i];
        if (escape) { escape = false; continue; }
        if (char === '\\') { escape = true; continue; }
        if (char === '"') inString = !inString;
        if (inString) continue;
        if (char === '{') depth += 1;
        if (char === '}') depth -= 1;
        if (depth === 0) return text.slice(start, i + 1);
    }
    return null;
}

function chunkText(text, size) {
    const chunks = [];
    for (let i = 0; i < text.length; i += size) chunks.push(text.slice(i, i + size));
    return chunks;
}

function hashContent(text) {
    return crypto.createHash('sha256').update(String(text || '')).digest('hex');
}

function selectTokenBudget(length) {
    if (length <= DIRECT_ANALYSIS_CHARS) return 'medium';
    return 'chunked';
}

function getRequiredContent(platform) {
    if (['bilibili', 'youtube'].includes(platform)) return '字幕、视频转录文本或人工整理稿';
    if (platform === 'xiaoyuzhou') return '播客文稿或音频转录文本';
    if (platform === 'xiaohongshu') return '帖子正文、图片 OCR 或浏览器抓取正文';
    if (platform === 'douyin') return '字幕、视频转录文本、图文正文或图片 OCR';
    return '正文内容或可读网页文本';
}

module.exports = { getEntryAnalysis, startEntryAnalysis, runEntryAnalysisNow };
