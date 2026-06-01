// server/services/contentExtractor.js
const axios = require('axios');
const cheerio = require('cheerio');

const USER_AGENT = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36';
const METADATA_ONLY_PLATFORMS = new Set(['bilibili', 'youtube', 'twitter', 'xiaohongshu', 'douyin']);

async function extractEntryContent(entry, { allowNetwork = true } = {}) {
    const stored = collectStoredText(entry);
    const canFetchHtml = allowNetwork && entry.url && !METADATA_ONLY_PLATFORMS.has(entry.platform);
    let fetched = null;

    if (canFetchHtml) {
        fetched = await fetchReadableHtml(entry.url).catch(() => null);
    }

    const parts = [
        formatLine('标题', entry.title),
        formatLine('作者', entry.author),
        formatLine('分类', entry.category),
        formatLine('标签', Array.isArray(entry.tags) ? entry.tags.join('、') : entry.tags),
        formatLine('已有摘要', entry.summary),
        formatLine('备注', entry.note),
        stored,
        fetched?.text,
    ].filter(Boolean);

    const text = normalizeText(parts.join('\n\n'));
    const sourceKind = fetched?.kind || (stored.length > 280 ? 'stored_content' : 'metadata');
    const hasEnoughContent = estimateMeaningfulLength(text) >= 420;
    const reason = hasEnoughContent ? null : buildInsufficientReason(entry);

    return {
        text,
        sourceKind,
        sourceLength: text.length,
        hasEnoughContent,
        reason,
        fetchedTitle: fetched?.title || null,
    };
}

function collectStoredText(entry) {
    const source = entry.source_data && typeof entry.source_data === 'object' ? entry.source_data : {};
    const candidates = [
        source.full_text,
        source.fullText,
        source.article_text,
        source.articleText,
        source.content,
        source.text,
        source.subtitle_text,
        source.transcript_clean,
        source.transcript,
        source.transcript_text,
        source.transcriptText,
        source.transcript_raw,
        source.zhihu_shared_text,
        source.douyin_shared_text,
        source.description,
        source.rawDescription,
        source.seriesName,
        entry.description,
    ];
    return normalizeText(candidates.filter(Boolean).join('\n\n'));
}

async function fetchReadableHtml(url) {
    const response = await axios.get(url, {
        headers: {
            'User-Agent': USER_AGENT,
            'Accept-Language': 'zh-CN,zh;q=0.9,en;q=0.8',
            Referer: new URL(url).origin,
        },
        timeout: 12000,
        maxRedirects: 5,
    });
    const $ = cheerio.load(response.data);
    $('script, style, noscript, svg, canvas, iframe, nav, footer, header, aside').remove();

    const title = cleanText(
        $('meta[property="og:title"]').attr('content')
        || $('meta[name="twitter:title"]').attr('content')
        || $('title').text()
    );

    const blocks = [];
    const selectors = [
        '#js_content',
        'article',
        'main',
        '[itemprop="articleBody"]',
        '.RichContent-inner',
        '.Post-RichText',
        '.content',
        '.article',
        'body',
    ];

    for (const selector of selectors) {
        const text = normalizeText($(selector).first().text());
        if (text.length > 360) {
            blocks.push(text);
            break;
        }
    }

    const fallbackParagraphs = $('p').map((_, el) => cleanText($(el).text())).get()
        .filter(text => text && text.length > 12)
        .join('\n');
    if (fallbackParagraphs.length > blocks.join('').length) blocks.push(fallbackParagraphs);

    return {
        kind: 'html_extracted',
        title,
        text: normalizeText(blocks.join('\n\n')),
    };
}

function buildInsufficientReason(entry) {
    if (['bilibili', 'youtube'].includes(entry.platform)) {
        return '视频内容需要字幕或转录文本。为避免浪费 token，InfoMind 不会仅凭标题和封面生成导图。';
    }
    if (entry.platform === 'xiaoyuzhou') {
        return '播客内容需要节目文稿或音频转录。当前只有元数据，建议由 Hermes 抓取或转写后回写。';
    }
    if (entry.platform === 'xiaohongshu') {
        return '小红书页面正文受动态渲染和访问策略影响，当前正文不足。请在已登录浏览器里用 InfoMind Clipper 重新收录当前页面。';
    }
    if (entry.platform === 'douyin') {
        return '抖音内容通常需要字幕、视频转录、图文正文或 OCR。请在已登录浏览器里用 InfoMind Clipper 重新收录；视频无字幕时可再进入本地转写或 Agent 增强流程。';
    }
    return '当前链接正文不足，无法生成可信的内容解读导图。';
}

function estimateMeaningfulLength(text) {
    return normalizeText(text)
        .replace(/[^\p{Script=Han}a-z0-9]/giu, '')
        .length;
}

function formatLine(label, value) {
    const text = cleanText(value);
    return text ? `${label}: ${text}` : '';
}

function cleanText(value) {
    return String(value || '').replace(/\s+/g, ' ').trim();
}

function normalizeText(value) {
    return String(value || '')
        .replace(/\u00a0/g, ' ')
        .replace(/[ \t]+/g, ' ')
        .replace(/\n{3,}/g, '\n\n')
        .trim();
}

module.exports = { extractEntryContent };
