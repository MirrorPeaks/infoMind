// server/services/classifier.js - Content classification with LLM + keyword fallback
const { classify: llmClassify } = require('./llm');
const logger = require('../utils/logger');

// Keyword-based fallback classification
const KEYWORD_MAP = {
    '人工智能': ['ai', 'gpt', 'llm', '大模型', '机器学习', 'chatgpt', 'claude', 'gemini',
        '深度学习', '神经网络', 'openai', 'anthropic', '人工智能', 'transformer',
        'stable diffusion', 'midjourney', '算法', '训练', 'rag', '上下文', 'token',
        '向量', 'embedding', 'agent', '智能体', '推理', '模型', '提示词', 'prompt',
        '检索增强', '多模态', '生成式', 'aigc', 'openclaw', 'codex', 'ai agent',
        'coding agent'],
    '计算机科学': ['编程', '代码', 'python', 'javascript', 'java', 'rust', 'golang',
        '软件', '开发', 'github', 'linux', '数据库', 'api', '架构', '后端', '前端'],
    '心理学': ['心理', '认知', '情绪', '焦虑', '抑郁', '行为', '冥想', '压力', '心理咨询'],
    '哲学': ['哲学', '伦理', '道德', '存在', '意识', '价值观', '形而上'],
    '历史': ['历史', '朝代', '战争', '帝国', '文明', '古代', '近代', '考古'],
    '经济与金融': ['经济', '股票', '投资', '基金', '比特币', '加密货币', '财务', '金融', '理财'],
    '商业与管理': ['创业', '管理', '商业', '产品', '运营', '营销', '领导力', '企业'],
    '医学与健康': ['健康', '医学', '医院', '疾病', '治疗', '药物', '营养', '睡眠'],
    '体育与健身': ['健身', '运动', '跑步', '瑜伽', '足球', '篮球', '训练', '体育'],
    '游戏': ['游戏', 'game', '电竞', '主机', 'steam', '手游', 'minecraft'],
    '影视与娱乐': ['电影', '电视剧', '综艺', '动漫', 'anime', '剧', '影视', '奥斯卡'],
    '音乐': ['音乐', '歌曲', '乐队', '专辑', '演唱会', 'spotify', '说唱'],
    '美食与烹饪': ['美食', '食谱', '烹饪', '餐厅', '料理', '饮食', '厨师'],
    '旅行与地理': ['旅行', '旅游', '城市', '国家', '签证', '酒店', '景点'],
};

async function classifyEntry(entry) {
    const fallback = keywordClassify(entry);

    // Try LLM first
    try {
        const result = await llmClassify(entry);
        if ((!result.category || result.category === '其他') && fallback.category !== '其他') {
            return mergeClassification(fallback, result);
        }
        if (result.category && result.category !== '其他') return result;
    } catch (err) {
        logger.debug(`LLM classify failed: ${err.message}, using keyword fallback`);
    }

    // Keyword fallback
    return fallback;
}

function keywordClassify(entry) {
    const text = buildClassifyText(entry);
    let bestCategory = '其他';
    let bestScore = 0;

    for (const [cat, keywords] of Object.entries(KEYWORD_MAP)) {
        const score = keywords.reduce((sum, kw) => keywordMatches(text, kw) ? sum + getKeywordWeight(kw.toLowerCase()) : sum, 0);
        if (score > bestScore) {
            bestScore = score;
            bestCategory = cat;
        }
    }

    return {
        category: bestCategory,
        sub_category: null,
        tags: bestCategory === '其他' ? [] : extractMatchedTags(text, KEYWORD_MAP[bestCategory]),
        summary: null,
    };
}

function buildClassifyText(entry) {
    const sourceData = entry.source_data && typeof entry.source_data === 'object'
        ? [
            entry.source_data.title,
            entry.source_data.description,
            entry.source_data.author,
            entry.source_data.full_text,
            entry.source_data.subtitle_text,
            entry.source_data.transcript_clean,
            entry.source_data.transcript,
            entry.source_data.zhihu_shared_text,
            entry.source_data.douyin_shared_text,
        ].filter(Boolean).join(' ')
        : '';
    return [
        entry.title,
        entry.description,
        entry.summary,
        entry.note,
        entry.author,
        Array.isArray(entry.tags) ? entry.tags.join(' ') : entry.tags,
        sourceData,
    ].filter(Boolean).join(' ').toLowerCase();
}

function getKeywordWeight(keyword) {
    if (['llm', 'gpt', 'rag', '大模型', '人工智能', '机器学习', 'chatgpt', 'openai', 'agent', '智能体', 'openclaw', 'codex'].includes(keyword)) {
        return 3;
    }
    if (['token', '上下文', 'embedding', '向量', '模型', 'prompt', '提示词'].includes(keyword)) {
        return 2;
    }
    return 1;
}

function extractMatchedTags(text, keywords = []) {
    return keywords
        .filter(kw => keywordMatches(text, kw))
        .slice(0, 5);
}

function keywordMatches(text, keyword) {
    const kw = keyword.toLowerCase();
    if (/^[a-z0-9+#.-]+$/i.test(kw)) {
        const escaped = kw.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
        return new RegExp(`(^|[^a-z0-9])${escaped}([^a-z0-9]|$)`, 'i').test(text);
    }
    return text.includes(kw);
}

function mergeClassification(fallback, result = {}) {
    return {
        ...result,
        category: fallback.category,
        sub_category: result.sub_category || fallback.sub_category,
        tags: result.tags?.length ? result.tags : fallback.tags,
        summary: result.summary || fallback.summary,
    };
}

module.exports = { classifyEntry, keywordClassify };
