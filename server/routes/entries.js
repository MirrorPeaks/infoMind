// server/routes/entries.js
const express = require('express');
const router = express.Router();
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const axios = require('axios');
const logger = require('../utils/logger');
const queries = require('../db/queries');
const { parseUrl } = require('../services/parser');
const { deriveZhihuMetadataFromText } = require('../services/parser/zhihu');
const { deriveDouyinMetadataFromText } = require('../services/parser/douyin');
const { classifyEntry } = require('../services/classifier');
const { processBook } = require('../services/bookmaker');
const { getEntryAnalysis, startEntryAnalysis } = require('../services/analyzer');
const { getCoversDir } = require('../utils/paths');
const { assessParsedEntry, shouldQueueBrowserCapture, supportsBrowserCapture } = require('../services/platformPolicy');
const { upsertCaptureJob } = require('../services/captureJobService');

async function downloadCover(coverUrl, sourceUrl) {
    if (!coverUrl) return null;
    try {
        // Normalize protocol-relative URLs
        if (coverUrl.startsWith('//')) coverUrl = 'https:' + coverUrl;
        // Skip data URIs
        if (coverUrl.startsWith('data:')) return null;

        const extMatch = coverUrl.match(/\.(jpg|jpeg|png|webp|gif)/i);
        const ext = extMatch ? extMatch[1].toLowerCase() : 'jpg';
        const filename = crypto.createHash('md5').update(coverUrl).digest('hex') + '.' + ext;
        const filepath = path.join(getCoversDir(), filename);
        
        const dir = path.dirname(filepath);
        if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
        
        if (fs.existsSync(filepath)) return '/covers/' + filename;

        // Use Referer from source URL to avoid hotlink blocks
        const referer = sourceUrl ? new URL(sourceUrl).origin : undefined;
        const response = await axios.get(coverUrl, {
            responseType: 'stream',
            timeout: 15000,
            headers: {
                'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
                ...(referer ? { Referer: referer } : {}),
            },
        });
        const writer = fs.createWriteStream(filepath);
        response.data.pipe(writer);
        return new Promise((resolve, reject) => {
            writer.on('finish', () => resolve('/covers/' + filename));
            writer.on('error', reject);
        });
    } catch (err) {
        logger.warn(`Failed to download cover: ${err.message}`);
        return null;
    }
}

// POST /api/entries - Add a new link
router.post('/', async (req, res) => {
    let { url, note, category: manualCategory, tags } = req.body;
    if (!url) return res.status(400).json({ success: false, error: 'URL is required' });
    const originalInput = url;

    // Extract actual URL if user pasted text like "标题 - 知乎 https://www.zhihu.com/..."
    const urlMatch = url.match(/(https?:\/\/[^\s]+)/);
    if (urlMatch) {
        url = urlMatch[1].replace(/[)）\]】>》。，、]+$/u, ''); // trim trailing brackets / punctuation
    } else if (!url.startsWith('http')) {
        url = 'https://' + url;
    }

    // Check duplicate. Bad Douyin captures should not block a fresh save attempt,
    // and healthy duplicates should be treated as idempotent success for the UI.
    const existing = queries.getEntryByUrl(url);
    if (existing) {
        if (shouldReplaceExistingEntry(existing)) {
            logger.warn(`Replacing stale duplicate entry: ${existing.id} ${existing.url}`);
            queries.deleteEntry(existing.id);
        } else {
            return res.status(200).json({ success: true, duplicate: true, message: 'URL already exists', data: existing });
        }
    }

    try {
        logger.info(`Parsing URL: ${url}`);

        // 1. Parse the URL
        const parsed = await parseUrl(url);
        const entryData = { ...parsed, url, note: note || null, tags: tags || [] };
        applyZhihuSharedMetadata(entryData, originalInput, url);
        applyDouyinSharedMetadata(entryData, originalInput, url);

        if (shouldQueueBrowserCapture(entryData, url)) {
            const assessment = assessParsedEntry(entryData, url);
            const job = upsertCaptureJob(queries, url, {
                platform: entryData.platform,
                source_channel: 'manual',
                source_message: originalInput,
            });
            return res.status(202).json({
                success: true,
                pending_capture: true,
                message: '当前平台没有返回足够正文，已转交 InfoMind Clipper 使用本机浏览器登录态补全。',
                capture_reason: assessment.reason,
                data: job,
            });
        }

        // 2. Classify with LLM (or fallback)
        if (!manualCategory) {
            try {
                const classification = await classifyEntry(entryData);
                entryData.category = classification.category || '其他';
                entryData.sub_category = classification.sub_category || null;
                entryData.summary = entryData.summary || classification.summary || null;
                if (!entryData.tags?.length) entryData.tags = classification.tags || [];
                if (classification.clean_title) entryData.title = classification.clean_title;
                if (classification.clean_author) entryData.author = classification.clean_author;
            } catch (llmErr) {
                logger.warn(`LLM classification failed, using default: ${llmErr.message}`);
                entryData.category = '其他';
            }
        } else {
            entryData.category = manualCategory;
        }

        if (entryData.cover_url) {
            entryData.cover_local = await downloadCover(entryData.cover_url, url);
        }

        // 3. Book merging
        try {
            const book = await processBook(entryData);
            if (book) entryData.book_id = book.id;
        } catch (bookErr) {
            logger.warn(`Book processing failed: ${bookErr.message}`);
        }

        // 4. Save to DB
        const entry = queries.createEntry(entryData);
        logger.success(`Entry created: ${entry.id} - ${entry.title}`);

        res.status(201).json({ success: true, data: entry });
    } catch (err) {
        logger.error('Failed to create entry', err);
        res.status(500).json({ success: false, error: err.message });
    }
});

function applyZhihuSharedMetadata(entryData, originalInput, url) {
    if (entryData.platform !== 'zhihu') return;
    const shared = deriveZhihuMetadataFromText(originalInput, url);
    if (!shared) return;
    if (!entryData.title || entryData.title === '知乎内容' || entryData.title === url) entryData.title = shared.title || entryData.title;
    if (!entryData.author) entryData.author = shared.author || entryData.author;
    if (!entryData.description) entryData.description = shared.description || entryData.description;
    entryData.source_data = { ...(entryData.source_data || {}), ...(shared.source_data || {}) };
}

function applyDouyinSharedMetadata(entryData, originalInput, url) {
    if (entryData.platform !== 'douyin') return;
    const shared = deriveDouyinMetadataFromText(originalInput, url);
    if (!shared) return;
    if (!entryData.title || entryData.title === '抖音内容' || entryData.title === url) entryData.title = shared.title || entryData.title;
    if (!entryData.author) entryData.author = shared.author || entryData.author;
    if (!entryData.description) entryData.description = shared.description || entryData.description;
    entryData.source_data = mergeDouyinSourceData(entryData.source_data, shared.source_data);
}

function mergeDouyinSourceData(parsed = {}, shared = {}) {
    const contentType = parsed.content_type && parsed.content_type !== 'unknown'
        ? parsed.content_type
        : (shared.content_type || parsed.content_type || 'unknown');
    return { ...parsed, ...shared, content_type: contentType };
}

function shouldReplaceExistingEntry(entry) {
    return !!entry && supportsBrowserCapture(entry.platform) && shouldQueueBrowserCapture(entry, entry.url);
}

// GET /api/entries/search - Search entries
router.get('/search', (req, res) => {
    const { q, limit } = req.query;
    if (!q) return res.status(400).json({ success: false, error: 'Query parameter q is required' });
    try {
        const results = queries.searchEntries(q, { limit: parseInt(limit) || 50 });
        res.json({ success: true, data: results, total: results.length });
    } catch (err) {
        logger.error('Search error', err);
        res.status(500).json({ success: false, error: err.message });
    }
});

// GET /api/entries - List entries
router.get('/', (req, res) => {
    const { category, platform, sort, page, limit } = req.query;
    try {
        const result = queries.listEntries({
            category, platform, sort,
            page: parseInt(page) || 1,
            limit: parseInt(limit) || 50,
        });
        res.json({ success: true, ...result });
    } catch (err) {
        logger.error('List entries error', err);
        res.status(500).json({ success: false, error: err.message });
    }
});

// GET /api/entries/:id/analysis - Get cached real content analysis
router.get('/:id/analysis', (req, res) => {
    const entry = queries.getEntryById(req.params.id);
    if (!entry) return res.status(404).json({ success: false, error: 'Entry not found' });
    res.set('Cache-Control', 'no-store');
    const analysis = getEntryAnalysis(req.params.id, { autoRecover: true });
    res.json({ success: true, data: analysis });
});

// POST /api/entries/:id/analyze - Queue structured analysis in the background
router.post('/:id/analyze', async (req, res) => {
    try {
        const analysis = startEntryAnalysis(req.params.id, { force: !!req.body?.force });
        res.json({ success: true, data: analysis });
    } catch (err) {
        logger.error('Analyze entry error', err);
        res.status(err.statusCode || 500).json({ success: false, error: err.message });
    }
});

// POST /api/entries/:id/transcribe - Queue video transcription + analysis
router.post('/:id/transcribe', async (req, res) => {
    try {
        const analysis = startEntryAnalysis(req.params.id, { force: !!req.body?.force });
        res.json({ success: true, data: analysis });
    } catch (err) {
        logger.error('Transcribe entry error', err);
        res.status(err.statusCode || 500).json({ success: false, error: err.message });
    }
});

// PUT /api/entries/:id/content - Hermes/Agent can write extracted full text or transcript
router.put('/:id/content', (req, res) => {
    try {
        const entry = queries.getEntryById(req.params.id);
        if (!entry) return res.status(404).json({ success: false, error: 'Entry not found' });
        const { full_text, transcript, content_source, content_url } = req.body || {};
        const text = String(full_text || transcript || '').trim();
        if (!text) return res.status(400).json({ success: false, error: 'full_text or transcript is required' });

        const sourceData = {
            ...(entry.source_data || {}),
            full_text: full_text || entry.source_data?.full_text || null,
            transcript: transcript || entry.source_data?.transcript || null,
            content_source: content_source || 'hermes',
            content_url: content_url || null,
            content_updated_at: new Date().toISOString(),
        };
        const updated = queries.updateEntry(req.params.id, { source_data: sourceData });
        res.json({ success: true, data: updated });
    } catch (err) {
        logger.error('Update entry content error', err);
        res.status(500).json({ success: false, error: err.message });
    }
});

// GET /api/entries/:id - Get single entry
router.get('/:id', (req, res) => {
    const entry = queries.getEntryById(req.params.id);
    if (!entry) return res.status(404).json({ success: false, error: 'Entry not found' });
    res.json({ success: true, data: entry });
});

// PUT /api/entries/:id - Update entry
router.put('/:id', (req, res) => {
    try {
        const entry = queries.updateEntry(req.params.id, req.body);
        if (!entry) return res.status(404).json({ success: false, error: 'Entry not found' });
        res.json({ success: true, data: entry });
    } catch (err) {
        logger.error('Update entry error', err);
        res.status(500).json({ success: false, error: err.message });
    }
});

// DELETE /api/entries/:id - Delete entry
router.delete('/:id', (req, res) => {
    const deleted = queries.deleteEntry(req.params.id);
    if (!deleted) return res.status(404).json({ success: false, error: 'Entry not found' });
    res.json({ success: true, message: 'Entry deleted' });
});

module.exports = router;
