// server/services/parser/xiaohongshu.js
const axios = require('axios');
const cheerio = require('cheerio');
const { genericParse } = require('./generic');
const { readSocialUrl } = require('../agentReach');

const USER_AGENT = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36';
const XHS_IMAGE_HOST_RE = /(xhscdn\.com|xhscdn\.net|xiaohongshu\.com)/i;
const XHS_CDN_RE = /(xhscdn\.com|xhscdn\.net)/i;

async function xiaohongshuParse(url) {
    const agentReach = await readSocialUrl(url, 'xiaohongshu');
    if (agentReach) return agentReach;

    try {
        const response = await axios.get(url, {
            headers: {
                'User-Agent': USER_AGENT,
                'Accept-Language': 'zh-CN,zh;q=0.9,en;q=0.8',
                Referer: 'https://www.xiaohongshu.com/',
            },
            timeout: 12000,
            maxRedirects: 5,
        });
        return parseXiaohongshuHtml(response.data, response.request?.res?.responseUrl || url);
    } catch (err) {
        try {
            const result = await genericParse(url);
            return {
                ...result,
                platform: 'xiaohongshu',
                title: cleanTitle(result.title),
                author: cleanAuthor(result.author),
                source_data: { ...(result.source_data || {}), parser_error: err.message },
            };
        } catch (fallbackErr) {
            return {
                title: '小红书内容',
                description: null,
                cover_url: null,
                author: null,
                author_id: null,
                platform: 'xiaohongshu',
                source_data: { url, error: fallbackErr.message, parser_error: err.message },
            };
        }
    }
}

function parseXiaohongshuHtml(html, url) {
    const $ = cheerio.load(html);
    const meta = (selectors) => {
        for (const s of selectors) {
            const val = $(s).attr('content') || $(s).text();
            if (val && val.trim()) return decodeText(val.trim());
        }
        return null;
    };

    const scriptObjects = extractScriptObjects($);
    const scriptHints = extractScriptHints($);
    const candidates = flattenObjects(scriptObjects);

    const title = cleanTitle(
        meta(['meta[property="og:title"]', 'meta[name="twitter:title"]', 'title']) ||
        scriptHints.title ||
        pickString(candidates, ['title', 'displayTitle', 'noteTitle', 'desc', 'description'])
    );
    const description =
        meta(['meta[property="og:description"]', 'meta[name="description"]', 'meta[name="twitter:description"]']) ||
        scriptHints.description ||
        pickString(candidates, ['desc', 'description', 'content']);
    const author = cleanAuthor(
        scriptHints.author ||
        pickString(candidates, ['nickname', 'nickName', 'userName', 'name']) ||
        meta(['meta[name="author"]', 'meta[property="article:author"]'])
    );
    const cover_url = firstValidCover([
        meta(['meta[property="og:image"]', 'meta[name="twitter:image"]', 'meta[name="twitter:image:src"]', 'link[rel="image_src"]']),
        scriptHints.cover_url,
        pickCoverUrl(candidates),
    ]);
    const author_id = pickString(candidates, ['userId', 'user_id', 'authorId']) ||
        (url.match(/user\/profile\/([a-zA-Z0-9]+)/) || [])[1] ||
        null;

    return {
        title: title || '小红书内容',
        description,
        cover_url,
        author,
        author_id,
        platform: 'xiaohongshu',
        source_data: {
            title,
            description,
            cover_url,
            author,
            author_id,
            url,
            script_object_count: scriptObjects.length,
        },
    };
}

function extractScriptHints($) {
    const hints = {};
    const imageUrls = [];
    $('script').each((_, el) => {
        const text = decodeText($(el).html() || '').replace(/\\u002F/g, '/').replace(/\\\//g, '/');
        hints.title ||= matchScriptString(text, ['title', 'displayTitle', 'noteTitle']);
        hints.description ||= matchScriptString(text, ['desc', 'description', 'content']);
        hints.author ||= matchScriptString(text, ['nickname', 'nickName', 'userName']);
        const urlMatches = text.match(/https?:\/\/[^"'<>\\\s]+/g) || [];
        for (const matchedUrl of urlMatches) {
            const normalized = normalizeCover(matchedUrl);
            if (normalized && isLikelyImageUrl(normalized)) imageUrls.push(normalized);
        }
    });
    hints.cover_url = imageUrls.find(u => !/avatar|icon|profile/i.test(u)) || imageUrls[0] || null;
    return hints;
}

function isLikelyImageUrl(url) {
    if (!url || /\.(js|css|mjs|map|json)(\?|$)/i.test(url)) return false;
    if (/\.(jpg|jpeg|png|webp|gif)(\?|$)/i.test(url)) return true;
    return XHS_CDN_RE.test(url) && !/fe-static|\/as\/|\/static\//i.test(url);
}

function matchScriptString(text, keys) {
    for (const key of keys) {
        const pattern = new RegExp(`["']?${key}["']?\\s*:\\s*["']([^"']{1,300})["']`, 'i');
        const match = text.match(pattern);
        if (match?.[1]) return decodeText(match[1].trim());
    }
    return null;
}

function extractScriptObjects($) {
    const objects = [];
    $('script').each((_, el) => {
        const text = $(el).html() || '';
        const jsonLdType = ($(el).attr('type') || '').toLowerCase();
        if (jsonLdType.includes('ld+json')) {
            const parsed = safeJsonParse(text);
            if (parsed) objects.push(parsed);
            return;
        }

        for (const marker of ['window.__INITIAL_STATE__', '__INITIAL_STATE__', 'window.__APOLLO_STATE__']) {
            const idx = text.indexOf(marker);
            if (idx === -1) continue;
            const braceIdx = text.indexOf('{', idx);
            const jsonText = extractBalancedJson(text, braceIdx);
            const parsed = safeJsonParse(jsonText);
            if (parsed) objects.push(parsed);
        }
    });
    return objects;
}

function extractBalancedJson(text, start) {
    if (start < 0) return '';
    let depth = 0;
    let inString = false;
    let quote = '';
    let escaped = false;
    for (let i = start; i < text.length; i++) {
        const ch = text[i];
        if (inString) {
            if (escaped) escaped = false;
            else if (ch === '\\') escaped = true;
            else if (ch === quote) inString = false;
            continue;
        }
        if (ch === '"' || ch === "'") {
            inString = true;
            quote = ch;
        } else if (ch === '{') {
            depth++;
        } else if (ch === '}') {
            depth--;
            if (depth === 0) return text.slice(start, i + 1);
        }
    }
    return '';
}

function flattenObjects(input, out = []) {
    if (!input || out.length > 2500) return out;
    if (Array.isArray(input)) {
        for (const item of input) flattenObjects(item, out);
        return out;
    }
    if (typeof input === 'object') {
        out.push(input);
        for (const value of Object.values(input)) flattenObjects(value, out);
    }
    return out;
}

function pickString(objects, keys) {
    for (const obj of objects) {
        for (const key of keys) {
            const val = obj?.[key];
            if (typeof val === 'string' && val.trim()) return decodeText(val.trim());
        }
    }
    return null;
}

function pickCoverUrl(objects) {
    const urls = [];
    for (const obj of objects) {
        for (const [key, val] of Object.entries(obj || {})) {
            collectImageUrls(val, key, urls);
        }
    }
    return urls.find(u => !/avatar|icon|profile/i.test(u)) || urls[0] || null;
}

function collectImageUrls(value, key, urls) {
    if (!value) return;
    if (typeof value === 'string') {
        const normalized = normalizeCover(value);
        if (normalized && (XHS_IMAGE_HOST_RE.test(normalized) || /image|img|cover|url/i.test(key))) {
            urls.push(normalized);
        }
        return;
    }
    if (Array.isArray(value)) {
        for (const item of value) collectImageUrls(item, key, urls);
        return;
    }
    if (typeof value === 'object') {
        for (const [childKey, childValue] of Object.entries(value)) {
            collectImageUrls(childValue, childKey, urls);
        }
    }
}

function normalizeCover(url) {
    if (!url || typeof url !== 'string') return null;
    let value = decodeText(url).replace(/\\u002F/g, '/').replace(/&amp;/g, '&').trim();
    const match = value.match(/https?:\/\/[^\s"'<>]+|\/\/[^\s"'<>]+/);
    if (match) value = match[0];
    if (value.startsWith('//')) value = 'https:' + value;
    if (!value.startsWith('http')) return null;
    return value.replace(/\\\//g, '/');
}

function firstValidCover(values) {
    for (const value of values) {
        const normalized = normalizeCover(value);
        if (normalized && isLikelyImageUrl(normalized)) return normalized;
    }
    return null;
}

function cleanTitle(title) {
    if (!title) return null;
    return decodeText(title).replace(/\s*-\s*小红书\s*$/i, '').trim();
}

function cleanAuthor(author) {
    if (!author) return null;
    const text = decodeText(author).replace(/\s+/g, ' ').trim();
    const dedupFollow = text.replace(/关注/g, '').trim();
    if (dedupFollow && dedupFollow.length < text.length) {
        return collapseRepeatedText(dedupFollow);
    }
    return collapseRepeatedText(text);
}

function collapseRepeatedText(text) {
    const value = text.trim();
    for (let size = 1; size <= Math.floor(value.length / 2); size++) {
        if (value.length % size !== 0) continue;
        const unit = value.slice(0, size);
        if (unit.repeat(value.length / size) === value) return unit;
    }
    return value;
}

function decodeText(text) {
    return String(text)
        .replace(/&quot;/g, '"')
        .replace(/&#39;/g, "'")
        .replace(/&amp;/g, '&')
        .replace(/&lt;/g, '<')
        .replace(/&gt;/g, '>');
}

function safeJsonParse(text) {
    if (!text) return null;
    try { return JSON.parse(text); } catch { return null; }
}

module.exports = { xiaohongshuParse, parseXiaohongshuHtml };
