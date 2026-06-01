// server/services/parser/douyin.js
const axios = require('axios');
const cheerio = require('cheerio');
const { genericParse } = require('./generic');

const USER_AGENT = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36';
const DOUYIN_IMAGE_HOST_RE = /(douyinpic\.com|douyinstatic\.com|douyinvod\.com|byteimg\.com|pstatp\.com|tos-cn-|bytegoofy\.com)/i;
const DOUYIN_VIDEO_HOST_RE = /(douyinvod\.com|douyinvideo\.net|amemv\.com|snssdk\.com|bytecdn\.cn|tos-cn-|bytegoofy\.com)/i;
const GENERIC_TITLE_RE = /^(抖音|douyin|抖音短视频|抖音-记录美好生活|记录美好生活)$/i;

async function douyinParse(url) {
    let pageResult = null;
    let pageError = null;
    let finalUrl = url;

    try {
        const response = await axios.get(url, {
            headers: {
                'User-Agent': USER_AGENT,
                'Accept-Language': 'zh-CN,zh;q=0.9,en;q=0.8',
                Referer: 'https://www.douyin.com/',
            },
            timeout: 15000,
            maxRedirects: 8,
        });
        finalUrl = response.request?.res?.responseUrl || url;
        pageResult = parseDouyinHtml(response.data, finalUrl);
    } catch (err) {
        finalUrl = err.response?.request?.res?.responseUrl || err.request?.res?.responseUrl || finalUrl;
        pageError = err.message;
    }

    const awemeId = pageResult?.source_data?.aweme_id || extractAwemeId(finalUrl) || extractAwemeId(url);
    const apiResult = awemeId ? await fetchDouyinApiMetadata(awemeId, finalUrl).catch(() => null) : null;
    const merged = mergeDouyinResults(apiResult, pageResult, {
        url,
        finalUrl,
        awemeId,
        pageError,
    });

    if (hasUsefulMetadata(merged)) return merged;

    try {
        const fallback = await genericParse(finalUrl || url);
        return {
            ...fallback,
            platform: 'douyin',
            title: cleanTitle(fallback.title) || merged.title || '抖音内容',
            author: cleanAuthor(fallback.author) || merged.author,
            source_data: {
                ...(fallback.source_data || {}),
                ...(merged.source_data || {}),
                parser_error: pageError || null,
            },
        };
    } catch (fallbackErr) {
        return {
            ...merged,
            title: merged.title || '抖音内容',
            source_data: {
                ...(merged.source_data || {}),
                error: fallbackErr.message,
                parser_error: pageError || null,
            },
        };
    }
}

function parseDouyinHtml(html, url) {
    const $ = cheerio.load(html);
    const meta = (selectors) => {
        for (const selector of selectors) {
            const value = $(selector).attr('content') || $(selector).text();
            const cleaned = cleanText(value);
            if (cleaned) return cleaned;
        }
        return null;
    };

    const scriptObjects = extractScriptObjects($);
    const scriptHints = extractScriptHints($);
    const candidates = flattenObjects(scriptObjects);
    const item = pickAwemeObject(candidates);
    const authorObj = pickAuthorObject(item, candidates);

    const rawTitle = pickFirst([
        getAwemeTitle(item),
        scriptHints.title,
        meta(['meta[property="og:title"]', 'meta[name="twitter:title"]', 'meta[name="title"]', 'title']),
        pickString(candidates, ['desc', 'description', 'title', 'share_title', 'shareTitle']),
    ]);
    const description = cleanDescription(pickFirst([
        getAwemeDescription(item),
        scriptHints.description,
        meta(['meta[property="og:description"]', 'meta[name="description"]', 'meta[name="twitter:description"]']),
        pickString(candidates, ['desc', 'description', 'share_desc', 'shareDesc']),
    ]));
    const author = cleanAuthor(pickFirst([
        getAuthorName(authorObj),
        scriptHints.author,
        extractAuthorFromTitle(rawTitle),
        meta(['meta[name="author"]', 'meta[property="article:author"]']),
        pickString(candidates, ['nickname', 'nickName', 'userName', 'uniqueId', 'unique_id']),
    ]));
    const coverUrl = firstValidCover([
        pickCoverFromAweme(item),
        scriptHints.cover_url,
        meta(['meta[property="og:image"]', 'meta[name="twitter:image"]', 'meta[name="twitter:image:src"]', 'link[rel="image_src"]']),
        pickCoverUrl(candidates),
    ]);
    const videoUrl = pickVideoUrlFromAweme(item);
    const contentType = detectDouyinContentType(url, item, videoUrl);
    const duration = normalizeDuration(pickFirst([
        item?.duration,
        item?.video?.duration,
        item?.video?.duration_ms,
        item?.video?.durationMs,
        pickString(candidates, ['duration', 'duration_ms', 'durationMs']),
    ]));
    const awemeId = extractAwemeId(url) || pickString(candidates, ['aweme_id', 'awemeId', 'item_id', 'itemId', 'group_id', 'groupId']);
    const authorId = pickFirst([
        authorObj?.sec_uid,
        authorObj?.secUid,
        authorObj?.uid,
        authorObj?.id,
        authorObj?.unique_id,
        authorObj?.uniqueId,
        pickString(candidates, ['sec_uid', 'secUid', 'uid', 'user_id', 'userId', 'unique_id', 'uniqueId']),
    ]);

    return {
        title: cleanTitle(rawTitle) || description || '抖音内容',
        description,
        cover_url: coverUrl,
        author,
        author_id: authorId ? String(authorId) : null,
        platform: 'douyin',
        source_data: {
            title: cleanTitle(rawTitle),
            description,
            cover_url: coverUrl,
            video_url: videoUrl,
            author,
            author_id: authorId ? String(authorId) : null,
            aweme_id: awemeId ? String(awemeId) : null,
            duration,
            final_url: url,
            content_type: contentType,
            script_object_count: scriptObjects.length,
        },
    };
}

async function fetchDouyinApiMetadata(awemeId, refererUrl) {
    const endpoints = [
        `https://www.douyin.com/aweme/v1/web/aweme/detail/?aweme_id=${encodeURIComponent(awemeId)}&aid=6383`,
        `https://www.iesdouyin.com/web/api/v2/aweme/iteminfo/?item_ids=${encodeURIComponent(awemeId)}`,
    ];

    for (const endpoint of endpoints) {
        try {
            const response = await axios.get(endpoint, {
                headers: {
                    'User-Agent': USER_AGENT,
                    'Accept-Language': 'zh-CN,zh;q=0.9,en;q=0.8',
                    Referer: refererUrl || 'https://www.douyin.com/',
                },
                timeout: 8000,
            });
            const data = response.data;
            const item = data?.aweme_detail || data?.item_list?.[0] || data?.aweme_list?.[0] || data?.data?.aweme_detail || data?.data?.[0];
            if (!item) continue;
            return fromAwemeObject(item, refererUrl, { api_endpoint: endpoint });
        } catch {
            // Try the next public metadata endpoint.
        }
    }
    return null;
}

function fromAwemeObject(item, url, extraSource = {}) {
    const authorObj = pickAuthorObject(item, [item]);
    const title = cleanTitle(getAwemeTitle(item));
    const description = cleanDescription(getAwemeDescription(item));
    const coverUrl = firstValidCover([pickCoverFromAweme(item)]);
    const videoUrl = pickVideoUrlFromAweme(item);
    const contentType = detectDouyinContentType(url, item, videoUrl);
    const author = cleanAuthor(getAuthorName(authorObj));
    const authorId = pickFirst([authorObj?.sec_uid, authorObj?.secUid, authorObj?.uid, authorObj?.unique_id, authorObj?.uniqueId]);
    const awemeId = item.aweme_id || item.awemeId || item.item_id || item.itemId || extractAwemeId(url);
    const duration = normalizeDuration(pickFirst([item.duration, item.video?.duration, item.video?.duration_ms, item.video?.durationMs]));

    return {
        title: title || description || '抖音内容',
        description,
        cover_url: coverUrl,
        author,
        author_id: authorId ? String(authorId) : null,
        platform: 'douyin',
        source_data: {
            ...extraSource,
            title,
            description,
            cover_url: coverUrl,
            video_url: videoUrl,
            author,
            author_id: authorId ? String(authorId) : null,
            aweme_id: awemeId ? String(awemeId) : null,
            duration,
            final_url: url,
            content_type: contentType,
        },
    };
}

function mergeDouyinResults(primary, secondary, context = {}) {
    const source = {
        ...(secondary?.source_data || {}),
        ...(primary?.source_data || {}),
        url: context.url,
        final_url: context.finalUrl || secondary?.source_data?.final_url || primary?.source_data?.final_url || context.url,
        aweme_id: primary?.source_data?.aweme_id || secondary?.source_data?.aweme_id || context.awemeId || null,
        parser_error: context.pageError || null,
    };
    source.content_type = pickContentType(primary?.source_data, secondary?.source_data, context.finalUrl);

    return {
        title: cleanTitle(primary?.title) || cleanTitle(secondary?.title) || null,
        description: cleanDescription(primary?.description) || cleanDescription(secondary?.description) || null,
        cover_url: primary?.cover_url || secondary?.cover_url || null,
        author: cleanAuthor(primary?.author) || cleanAuthor(secondary?.author) || null,
        author_id: primary?.author_id || secondary?.author_id || null,
        platform: 'douyin',
        source_data: source,
    };
}

function deriveDouyinMetadataFromText(input, url) {
    const text = cleanText(input);
    if (!text || !/douyin\.com|iesdouyin\.com|抖音/i.test(text)) return null;

    const withoutUrls = text
        .replace(/https?:\/\/[^\s"'<>]+/gi, ' ')
        .replace(/\b\d+\.\d+\b/g, ' ')
        .replace(/复制(?:此)?(?:链接|打开抖音)?|打开抖音|看看|快来|一起|长按复制|口令|分享给你|点击链接|直接观看/gu, ' ')
        .replace(/\s+/g, ' ')
        .replace(/^[\s,，.。:：;；-]+|[\s,，.。:：;；-]+$/gu, '')
        .trim();
    const bracket = withoutUrls.match(/[【「《]([^】」》]{2,180})[】」》]/u)?.[1];
    const authorFromBracket = bracket?.match(/^(.{1,40}?)(?:的)?(?:作品|视频|图文|抖音)$/u)?.[1];
    const title = cleanTitle(bracket || withoutUrls);
    const author = cleanAuthor(authorFromBracket || extractAuthorFromTitle(withoutUrls));
    const contentType = inferSharedContentType(withoutUrls, url);

    if (!title && !author) return null;
    return {
        title: title || null,
        description: withoutUrls || null,
        author,
        platform: 'douyin',
        source_data: {
            douyin_shared_text: withoutUrls,
            shared_url: url,
            content_type: contentType,
        },
    };
}

function extractScriptObjects($) {
    const objects = [];

    $('script[type="application/ld+json"]').each((_, el) => {
        const parsed = safeJsonParse($(el).text());
        if (parsed) objects.push(parsed);
    });

    const renderData = $('#RENDER_DATA').html() || $('[id="RENDER_DATA"]').html();
    const parsedRenderData = safeJsonParse(decodeScriptJson(renderData));
    if (parsedRenderData) objects.push(parsedRenderData);

    $('script').each((_, el) => {
        const text = $(el).html() || '';
        for (const marker of [
            'window._ROUTER_DATA',
            '_ROUTER_DATA',
            'window.__INIT_PROPS__',
            '__INIT_PROPS__',
            'window.__INITIAL_STATE__',
            '__INITIAL_STATE__',
            'window.__UNIVERSAL_DATA_FOR_REHYDRATION__',
            '__UNIVERSAL_DATA_FOR_REHYDRATION__',
            'window.RENDER_DATA',
            'RENDER_DATA',
        ]) {
            const idx = text.indexOf(marker);
            if (idx === -1) continue;
            const start = findJsonStart(text, idx);
            const jsonText = extractBalancedJson(text, start);
            const parsed = safeJsonParse(decodeScriptJson(jsonText));
            if (parsed) objects.push(parsed);
        }
    });

    return objects;
}

function extractScriptHints($) {
    const hints = {};
    const imageUrls = [];
    $('script').each((_, el) => {
        const text = decodeScriptJson($(el).html() || '').replace(/\\u002F/g, '/').replace(/\\\//g, '/');
        hints.title ||= matchScriptString(text, ['desc', 'title', 'share_title', 'shareTitle']);
        hints.description ||= matchScriptString(text, ['desc', 'description', 'share_desc', 'shareDesc']);
        hints.author ||= matchScriptString(text, ['nickname', 'nickName', 'unique_id', 'uniqueId']);
        const matches = text.match(/https?:\/\/[^"'<>\\\s]+|https?%3A%2F%2F[^"'<>\\\s]+/g) || [];
        for (const match of matches) {
            const normalized = normalizeUrl(match);
            if (normalized && isLikelyImageUrl(normalized)) imageUrls.push(normalized);
        }
    });
    hints.cover_url = imageUrls.find(url => !/avatar|icon|profile/i.test(url)) || imageUrls[0] || null;
    return hints;
}

function pickAwemeObject(objects) {
    return objects.find(obj => obj && typeof obj === 'object' && (obj.aweme_id || obj.awemeId) && (obj.desc || obj.video || obj.images || obj.author))
        || objects.find(obj => obj && typeof obj === 'object' && obj.video && obj.author && (obj.desc || obj.title))
        || objects.find(obj => obj && typeof obj === 'object' && obj.aweme_detail)
        || null;
}

function pickAuthorObject(item, objects = []) {
    if (item?.author && typeof item.author === 'object') return item.author;
    if (item?.authorInfo && typeof item.authorInfo === 'object') return item.authorInfo;
    if (item?.user && typeof item.user === 'object') return item.user;
    return objects.find(obj => obj && typeof obj === 'object' && (
        obj.nickname || obj.nickName || obj.unique_id || obj.uniqueId || obj.sec_uid || obj.secUid
    )) || null;
}

function getAwemeTitle(item) {
    return pickFirst([
        item?.desc,
        item?.description,
        item?.title,
        item?.share_info?.share_title,
        item?.shareInfo?.shareTitle,
        item?.seo_info?.ocr_content,
        item?.seoInfo?.ocrContent,
    ]);
}

function getAwemeDescription(item) {
    return pickFirst([
        item?.desc,
        item?.description,
        item?.share_info?.share_desc,
        item?.shareInfo?.shareDesc,
        item?.text_extra?.map?.(extra => extra?.hashtag_name).filter(Boolean).join(' '),
    ]);
}

function getAuthorName(authorObj) {
    return pickFirst([
        authorObj?.nickname,
        authorObj?.nickName,
        authorObj?.name,
        authorObj?.userName,
        authorObj?.unique_id,
        authorObj?.uniqueId,
        authorObj?.short_id,
        authorObj?.shortId,
    ]);
}

function pickCoverFromAweme(item) {
    const urls = [];
    collectImageUrls(item?.video?.cover, 'cover', urls);
    collectImageUrls(item?.video?.origin_cover, 'origin_cover', urls);
    collectImageUrls(item?.video?.originCover, 'originCover', urls);
    collectImageUrls(item?.video?.dynamic_cover, 'dynamic_cover', urls);
    collectImageUrls(item?.video?.dynamicCover, 'dynamicCover', urls);
    collectImageUrls(item?.images, 'images', urls);
    collectImageUrls(item?.image_infos, 'image_infos', urls);
    collectImageUrls(item?.imageInfos, 'imageInfos', urls);
    collectImageUrls(item?.cover, 'cover', urls);
    collectImageUrls(item?.thumbnail, 'thumbnail', urls);
    return urls.find(url => !/avatar|icon|profile/i.test(url)) || urls[0] || null;
}

function pickCoverUrl(objects) {
    const urls = [];
    for (const obj of objects) {
        for (const [key, value] of Object.entries(obj || {})) {
            collectImageUrls(value, key, urls);
        }
    }
    return urls.find(url => !/avatar|icon|profile/i.test(url)) || urls[0] || null;
}

function pickVideoUrlFromAweme(item) {
    const urls = [];
    collectMediaUrls(item?.video?.play_addr, 'play_addr', urls);
    collectMediaUrls(item?.video?.playAddr, 'playAddr', urls);
    collectMediaUrls(item?.video?.download_addr, 'download_addr', urls);
    collectMediaUrls(item?.video?.downloadAddr, 'downloadAddr', urls);
    collectMediaUrls(item?.video?.bit_rate, 'bit_rate', urls);
    collectMediaUrls(item?.video?.bitRate, 'bitRate', urls);
    collectMediaUrls(item?.video?.playApi, 'playApi', urls);
    return urls.find(url => !/watermark|playwm/i.test(url)) || urls[0] || null;
}

function collectMediaUrls(value, key, urls) {
    if (!value) return;
    if (typeof value === 'string') {
        const normalized = normalizeUrl(value);
        if (normalized && isLikelyVideoUrl(normalized, key)) urls.push(normalized);
        return;
    }
    if (Array.isArray(value)) {
        for (const item of value) collectMediaUrls(item, key, urls);
        return;
    }
    if (typeof value === 'object') {
        for (const childKey of ['url_list', 'urlList', 'urls']) {
            if (Array.isArray(value[childKey])) collectMediaUrls(value[childKey], childKey, urls);
        }
        for (const [childKey, childValue] of Object.entries(value)) {
            collectMediaUrls(childValue, childKey, urls);
        }
    }
}

function collectImageUrls(value, key, urls) {
    if (!value) return;
    if (typeof value === 'string') {
        const normalized = normalizeUrl(value);
        if (normalized && (isLikelyImageUrl(normalized) || /image|img|cover|poster|thumb|url/i.test(key))) {
            urls.push(normalized);
        }
        return;
    }
    if (Array.isArray(value)) {
        for (const item of value) collectImageUrls(item, key, urls);
        return;
    }
    if (typeof value === 'object') {
        for (const childKey of ['url_list', 'urlList', 'urls']) {
            if (Array.isArray(value[childKey])) collectImageUrls(value[childKey], childKey, urls);
        }
        for (const [childKey, childValue] of Object.entries(value)) {
            collectImageUrls(childValue, childKey, urls);
        }
    }
}

function firstValidCover(values) {
    for (const value of values) {
        const normalized = normalizeUrl(value);
        if (normalized && isLikelyImageUrl(normalized)) return normalized;
    }
    return null;
}

function isLikelyImageUrl(url) {
    if (!url || /\.(js|css|mjs|map|json)(\?|$)/i.test(url)) return false;
    if (/\.(jpg|jpeg|png|webp|gif)(\?|$)/i.test(url)) return true;
    return DOUYIN_IMAGE_HOST_RE.test(url);
}

function isLikelyVideoUrl(url, key = '') {
    if (!url || /\.(js|css|mjs|map|json|jpg|jpeg|png|webp|gif)(\?|$)/i.test(url)) return false;
    if (/\.(mp4|mov|m4v|webm|m3u8)(\?|$)/i.test(url)) return true;
    if (/play|video|download|addr|url/i.test(key) && DOUYIN_VIDEO_HOST_RE.test(url)) return true;
    return /\/aweme\/v1\/play/i.test(url);
}

function normalizeDuration(value) {
    const number = Number(value);
    if (!Number.isFinite(number) || number <= 0) return null;
    return number > 10000 ? Math.round(number / 1000) : Math.round(number);
}

function extractAwemeId(url) {
    const text = String(url || '');
    const patterns = [
        /\/(?:video|note)\/(\d{8,})/i,
        /\/share\/(?:video|note)\/(\d{8,})/i,
        /[?&](?:modal_id|aweme_id|item_id|group_id)=(\d{8,})/i,
    ];
    for (const pattern of patterns) {
        const match = text.match(pattern);
        if (match?.[1]) return match[1];
    }
    return null;
}

function detectDouyinContentType(url, item = null, videoUrl = null) {
    const text = String(url || '').toLowerCase();
    if (text.includes('/note/')) return 'note';
    if (text.includes('/video/') || text.includes('/share/video/')) return 'video';
    if (hasDouyinImages(item) && !videoUrl) return 'note';
    if (videoUrl || item?.video) return 'video';
    return 'unknown';
}

function hasDouyinImages(item) {
    if (!item || typeof item !== 'object') return false;
    return Boolean(
        (Array.isArray(item.images) && item.images.length)
        || (Array.isArray(item.image_infos) && item.image_infos.length)
        || (Array.isArray(item.imageInfos) && item.imageInfos.length)
    );
}

function inferSharedContentType(text, url = '') {
    const value = String(text || '');
    if (/图文|图片|照片|相册|笔记/u.test(value)) return 'note';
    if (/视频|短视频|拍摄|直播/u.test(value)) return 'video';
    const urlType = detectDouyinContentType(url);
    if (urlType !== 'unknown') return urlType;
    return 'unknown';
}

function pickContentType(primary = {}, secondary = {}, url = '') {
    const candidates = [primary?.content_type, secondary?.content_type]
        .map(type => String(type || '').trim())
        .filter(Boolean);
    return candidates.find(type => type && type !== 'unknown' && type !== 'douyin')
        || detectDouyinContentType(url)
        || 'unknown';
}

function hasUsefulMetadata(result) {
    return !!(cleanTitle(result?.title) || result?.cover_url || cleanAuthor(result?.author));
}

function cleanTitle(title) {
    const text = cleanText(title)
        ?.replace(/\s*[-｜|]\s*抖音.*$/iu, '')
        .replace(/\s*[-｜|]\s*douyin.*$/iu, '')
        .replace(/^\s*抖音\s*[-｜|]\s*/iu, '')
        .replace(/抖音号[:：]\s*[A-Za-z0-9_.-]+/giu, '')
        .replace(/#在抖音，记录美好生活#?/gu, '')
        .trim();
    if (!text || GENERIC_TITLE_RE.test(text) || /打开抖音|登录后即可观看|页面不存在|验证码/.test(text)) return null;
    return text;
}

function cleanDescription(value) {
    const text = cleanText(value)
        ?.replace(/\s*[-｜|]\s*抖音.*$/iu, '')
        .replace(/打开抖音.*$/u, '')
        .trim();
    return text && !GENERIC_TITLE_RE.test(text) ? text : null;
}

function cleanAuthor(author) {
    const text = cleanText(author)
        ?.replace(/\s*的抖音(?:号)?\s*$/u, '')
        .replace(/\s*[-｜|]\s*抖音.*$/iu, '')
        .replace(/关注/g, '')
        .trim();
    if (!text || /^(抖音|douyin|打开抖音|登录|关注|分享)$/i.test(text)) return null;
    if (text.length > 80) return null;
    return collapseRepeatedText(text);
}

function extractAuthorFromTitle(title) {
    const text = cleanText(title);
    if (!text) return null;
    return cleanAuthor(
        text.match(/^(.{1,40}?)(?:的)?(?:抖音|视频|图文|作品)(?:\s*[-｜|]|，|,|$)/u)?.[1]
        || text.match(/^(.{1,40}?)在抖音/u)?.[1]
    );
}

function pickString(objects, keys) {
    for (const obj of objects) {
        for (const key of keys) {
            const value = obj?.[key];
            if (typeof value === 'string' && cleanText(value)) return cleanText(value);
            if (typeof value === 'number') return String(value);
        }
    }
    return null;
}

function matchScriptString(text, keys) {
    for (const key of keys) {
        const pattern = new RegExp(`["']?${key}["']?\\s*:\\s*["']([^"']{1,500})["']`, 'i');
        const match = text.match(pattern);
        if (match?.[1]) return cleanText(match[1]);
    }
    return null;
}

function flattenObjects(input, out = []) {
    if (!input || out.length > 4000) return out;
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

function findJsonStart(text, markerIndex) {
    const objectStart = text.indexOf('{', markerIndex);
    const arrayStart = text.indexOf('[', markerIndex);
    if (objectStart === -1) return arrayStart;
    if (arrayStart === -1) return objectStart;
    return Math.min(objectStart, arrayStart);
}

function extractBalancedJson(text, start) {
    if (start < 0) return '';
    const open = text[start];
    const close = open === '[' ? ']' : '}';
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
        } else if (ch === open) {
            depth++;
        } else if (ch === close) {
            depth--;
            if (depth === 0) return text.slice(start, i + 1);
        }
    }
    return '';
}

function normalizeUrl(value) {
    if (!value || typeof value !== 'string') return null;
    let text = decodeText(value).replace(/\\u002F/g, '/').replace(/\\u0026/g, '&').replace(/\\\//g, '/').trim();
    if (/https?%3A%2F%2F/i.test(text)) {
        try { text = decodeURIComponent(text); } catch { /* keep original */ }
    }
    const match = text.match(/https?:\/\/[^\s"'<>]+|\/\/[^\s"'<>]+/);
    if (match) text = match[0];
    if (text.startsWith('//')) text = 'https:' + text;
    if (!/^https?:\/\//i.test(text)) return null;
    return text.replace(/&amp;/g, '&');
}

function decodeScriptJson(text) {
    if (!text) return '';
    let value = decodeText(String(text).trim());
    if (/%7B|%5B|%22|%3A/i.test(value)) {
        try { value = decodeURIComponent(value); } catch { /* keep decoded HTML */ }
    }
    return value.replace(/\\u002F/g, '/');
}

function decodeText(text) {
    return String(text || '')
        .replace(/&quot;/g, '"')
        .replace(/&#34;/g, '"')
        .replace(/&#39;/g, "'")
        .replace(/&amp;/g, '&')
        .replace(/&lt;/g, '<')
        .replace(/&gt;/g, '>')
        .replace(/\\n/g, ' ')
        .replace(/\\t/g, ' ');
}

function cleanText(value) {
    return decodeText(value)
        .replace(/\u00a0/g, ' ')
        .replace(/\s+/g, ' ')
        .trim() || null;
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

function pickFirst(values) {
    for (const value of values) {
        const text = typeof value === 'number' ? String(value) : value;
        if (typeof text === 'string' && cleanText(text)) return cleanText(text);
        if (text) return text;
    }
    return null;
}

function safeJsonParse(text) {
    if (!text) return null;
    try { return JSON.parse(text); } catch { return null; }
}

module.exports = { douyinParse, parseDouyinHtml, deriveDouyinMetadataFromText };
