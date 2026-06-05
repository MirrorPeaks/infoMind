const express = require('express');
const crypto = require('crypto');
const logger = require('../utils/logger');
const queries = require('../db/queries');
const { detectPlatform } = require('../services/parser');
const { classifyEntry } = require('../services/classifier');
const { processBook } = require('../services/bookmaker');
const { downloadCover } = require('../services/entryHelpers');

const router = express.Router();
const TOKEN_KEY = 'clipper.token';

router.get('/hello', (req, res) => {
    const token = getClipperToken();
    const provided = getToken(req);
    res.json({
        success: true,
        data: {
            status: 'ready',
            paired: !!provided && safeEqual(provided, token),
            api: 'InfoMind Clipper',
        },
    });
});

router.get('/pairing', (req, res) => {
    if (!isLocalUiRequest(req)) {
        return res.status(403).json({ success: false, error: 'Pairing token is only available from the local InfoMind app' });
    }
    res.json({
        success: true,
        data: {
            token: getClipperToken(),
            base_url: `${req.protocol}://${req.get('host')}`,
        },
    });
});

router.post('/captures', requireClipperToken, async (req, res) => {
    const jobId = req.body?.job_id || null;
    try {
        const payload = normalizeCapturePayload(req.body || {});
        if (!payload.url) return res.status(400).json({ success: false, error: 'url is required' });
        const job = jobId ? queries.getCaptureJobById(jobId) : null;
        if (jobId && !job) return res.status(404).json({ success: false, error: 'Capture job not found' });
        if (job) queries.updateCaptureJob(job.id, { status: 'capturing', error: null });

        const existing = queries.getEntryByUrl(payload.url) || (job?.url ? queries.getEntryByUrl(job.url) : null);
        if (existing) {
            const updated = mergeCaptureIntoEntry(existing, payload);
            if (job) queries.updateCaptureJob(job.id, { status: 'saved', entry_id: updated.id, error: null, finish_now: true });
            return res.json({ success: true, data: updated, duplicate: true });
        }

        const entryData = buildEntryData(payload);
        try {
            const classification = await classifyEntry(entryData);
            entryData.category = classification.category || entryData.category || '其他';
            entryData.sub_category = classification.sub_category || null;
            entryData.summary = entryData.summary || classification.summary || null;
            if (!entryData.tags?.length) entryData.tags = classification.tags || [];
            if (classification.clean_title && isWeakTitle(entryData.title, entryData.url)) entryData.title = classification.clean_title;
            if (classification.clean_author && !entryData.author) entryData.author = classification.clean_author;
        } catch (err) {
            logger.warn(`Clipper classification failed: ${err.message}`);
            entryData.category = entryData.category || '其他';
        }

        if (entryData.cover_url) {
            entryData.cover_local = await downloadCover(entryData.cover_url, entryData.url);
        }

        try {
            const book = await processBook(entryData);
            if (book) entryData.book_id = book.id;
        } catch (err) {
            logger.warn(`Clipper book processing failed: ${err.message}`);
        }

        const entry = queries.createEntry(entryData);
        if (job) queries.updateCaptureJob(job.id, { status: 'saved', entry_id: entry.id, error: null, finish_now: true });
        res.status(201).json({ success: true, data: entry });
    } catch (err) {
        if (jobId) {
            try {
                queries.updateCaptureJob(jobId, { status: 'failed', error: err.message, finish_now: true });
            } catch {}
        }
        logger.error('Clipper capture failed', err);
        res.status(500).json({ success: false, error: err.message });
    }
});

function getClipperToken() {
    let token = queries.getConfig(TOKEN_KEY);
    if (!token) {
        token = crypto.randomBytes(18).toString('base64url');
        queries.setConfig(TOKEN_KEY, token);
    }
    return token;
}

function requireClipperToken(req, res, next) {
    const token = getClipperToken();
    const provided = getToken(req);
    if (!provided || !safeEqual(provided, token)) {
        return res.status(401).json({ success: false, error: 'InfoMind Clipper is not paired' });
    }
    next();
}

function getToken(req) {
    return String(req.get('X-InfoMind-Clipper-Token') || req.body?.token || '').trim();
}

function safeEqual(a, b) {
    const left = Buffer.from(String(a));
    const right = Buffer.from(String(b));
    return left.length === right.length && crypto.timingSafeEqual(left, right);
}

function isLocalUiRequest(req) {
    const origin = req.get('origin');
    if (!origin) return true;
    return /^http:\/\/(127\.0\.0\.1|localhost)(:\d+)?$/i.test(origin);
}

function normalizeCapturePayload(raw) {
    const url = cleanUrl(raw.canonical_url || raw.url);
    const images = Array.isArray(raw.images) ? raw.images.map(cleanUrl).filter(Boolean).slice(0, 20) : [];
    const media = Array.isArray(raw.media)
        ? raw.media.map(item => ({ ...item, url: cleanUrl(item?.url) })).filter(item => item.url).slice(0, 10)
        : [];
    const platform = raw.platform || (url ? detectPlatform(url) : 'web');
    const contentType = normalizeContentType(raw.content_type, platform, media);

    return {
        job_id: raw.job_id || null,
        original_url: cleanUrl(raw.original_url) || cleanUrl(raw.requested_url) || null,
        url,
        canonical_url: cleanUrl(raw.canonical_url) || url,
        platform,
        content_type: contentType,
        title: cleanText(raw.title),
        author: cleanAuthor(raw.author),
        description: cleanText(raw.description),
        cover_url: cleanUrl(raw.cover_url) || images[0] || null,
        full_text: cleanLongText(raw.full_text),
        subtitle_text: cleanLongText(raw.subtitle_text),
        images,
        media,
        captured_at: raw.captured_at || new Date().toISOString(),
        source: raw.source || 'infomind-extension',
    };
}

function buildEntryData(payload) {
    const contentText = payload.full_text || payload.subtitle_text || payload.description || '';
    const title = payload.title || payload.description?.slice(0, 80) || payload.url;
    return {
        url: payload.url,
        platform: payload.platform,
        title,
        author: payload.author || platformDisplayName(payload.platform),
        author_id: null,
        description: payload.description || null,
        cover_url: payload.cover_url || null,
        cover_local: null,
        summary: payload.description || summarizeText(contentText),
        note: null,
        category: '其他',
        sub_category: null,
        tags: inferTags(payload),
        source_data: {
            capture_source: 'browser-extension',
            content_source: 'browser-extension',
            content_type: payload.content_type,
            canonical_url: payload.canonical_url,
            original_url: payload.original_url,
            full_text: payload.full_text || null,
            subtitle_text: payload.subtitle_text || null,
            transcript: payload.subtitle_text || null,
            images: payload.images,
            media: payload.media,
            description: payload.description || null,
            captured_at: payload.captured_at,
            needs_transcript: payload.content_type === 'video' && !payload.subtitle_text,
        },
    };
}

function mergeCaptureIntoEntry(entry, payload) {
    const sourceData = {
        ...(entry.source_data || {}),
        capture_source: 'browser-extension',
        content_source: 'browser-extension',
        content_type: payload.content_type,
        canonical_url: payload.canonical_url || entry.source_data?.canonical_url,
        original_url: payload.original_url || entry.source_data?.original_url,
        full_text: payload.full_text || entry.source_data?.full_text || null,
        subtitle_text: payload.subtitle_text || entry.source_data?.subtitle_text || null,
        transcript: payload.subtitle_text || entry.source_data?.transcript || null,
        images: payload.images?.length ? payload.images : (entry.source_data?.images || []),
        media: payload.media?.length ? payload.media : (entry.source_data?.media || []),
        description: payload.description || entry.source_data?.description || null,
        captured_at: payload.captured_at,
        needs_transcript: payload.content_type === 'video' && !payload.subtitle_text,
    };
    const updates = {
        title: isWeakTitle(entry.title, entry.url) && payload.title ? payload.title : entry.title,
        author: (!entry.author || isWeakAuthor(entry.author, entry.platform)) && payload.author ? payload.author : entry.author,
        cover_url: entry.cover_url || payload.cover_url || null,
        summary: entry.summary || payload.description || summarizeText(payload.full_text || payload.subtitle_text),
        source_data: sourceData,
    };
    return queries.updateEntry(entry.id, updates);
}

function normalizeContentType(type, platform, media) {
    const value = String(type || '').toLowerCase();
    if (['video', 'note', 'article', 'image', 'audio'].includes(value)) return value;
    if (media.some(item => String(item.type || '').includes('video') || /\.m3u8|\.mp4/i.test(item.url))) return 'video';
    if (platform === 'youtube' || platform === 'bilibili') return 'video';
    return platform === 'douyin' ? 'unknown' : 'article';
}

function inferTags(payload) {
    const tags = ['浏览器插件'];
    if (payload.content_type && payload.content_type !== 'unknown') tags.push(payload.content_type);
    return tags;
}

function platformDisplayName(platform) {
    const names = {
        douyin: '抖音',
        xiaohongshu: '小红书',
        zhihu: '知乎',
        bilibili: '哔哩哔哩',
        youtube: 'YouTube',
        web: '网页',
    };
    return names[platform] || platform || '网页';
}

function summarizeText(text) {
    const value = cleanText(text);
    return value ? value.slice(0, 160) : null;
}

function isWeakTitle(title, url) {
    const value = String(title || '').trim();
    return !value || value === url || /^https?:\/\//i.test(value) || ['抖音内容', '网页内容', 'Untitled'].includes(value);
}

function isWeakAuthor(author, platform) {
    const value = String(author || '').trim();
    return !value || value === platformDisplayName(platform) || value === '抖音';
}

function cleanUrl(value) {
    const text = String(value || '').trim();
    if (!/^https?:\/\//i.test(text)) return null;
    return text.replace(/[)）\]】>》。，、]+$/u, '');
}

function cleanText(value) {
    return String(value || '').replace(/\s+/g, ' ').trim();
}

function cleanLongText(value) {
    return String(value || '').replace(/\r/g, '').replace(/\n{3,}/g, '\n\n').trim();
}

function cleanAuthor(value) {
    return cleanText(value).replace(/^@+/, '').replace(/关注/g, '').trim();
}

module.exports = router;
