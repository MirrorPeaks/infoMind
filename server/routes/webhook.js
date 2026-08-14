// server/routes/webhook.js
const express = require('express');
const router = express.Router();
const crypto = require('crypto');
const logger = require('../utils/logger');
const queries = require('../db/queries');
const { parseUrl, detectPlatform } = require('../services/parser');
const { deriveZhihuMetadataFromText } = require('../services/parser/zhihu');
const { deriveDouyinMetadataFromText } = require('../services/parser/douyin');
const { classifyEntry } = require('../services/classifier');
const { processBook } = require('../services/bookmaker');
const { assessParsedEntry, shouldQueueBrowserCapture, supportsBrowserCapture } = require('../services/platformPolicy');
const { upsertCaptureJob } = require('../services/captureJobService');

// Extract URLs from a text string
function extractUrls(text) {
    const urlRegex = /https?:\/\/[^\s"'<>]+/gi;
    return [...new Set((text.match(urlRegex) || []).map(sanitizeSharedUrl))];
}

// Verify OpenClaw HMAC signature (optional, if secret is configured)
function verifySignature(req) {
    const secret = queries.getConfig('webhook.secret');
    if (!secret) return true; // No secret configured → allow all
    const signature = req.headers['x-openclaw-signature'] || req.headers['x-signature'];
    if (!signature) return false;
    const expected = 'sha256=' + crypto
        .createHmac('sha256', secret)
        .update(JSON.stringify(req.body))
        .digest('hex');
    return crypto.timingSafeEqual(Buffer.from(signature), Buffer.from(expected));
}

// POST /api/webhook/openclaw
router.post('/openclaw', async (req, res) => {
    if (!verifySignature(req)) {
        logger.warn('Webhook signature verification failed');
        return res.status(401).json({ success: false, error: 'Invalid signature' });
    }

    const { message, urls: providedUrls } = req.body;
    const urls = providedUrls?.length ? providedUrls.map(sanitizeSharedUrl) : extractUrls(message || '');

    if (!urls.length) {
        return res.json({ success: true, message: 'No URLs found in message', processed: 0 });
    }

    logger.info(`Webhook received ${urls.length} URL(s): ${urls.join(', ')}`);
    const results = [];

    for (const url of urls) {
        try {
            const platform = detectPlatform(url);
            // Dedup check
            const existing = queries.getEntryByUrl(url);
            if (existing) {
                if (supportsBrowserCapture(existing.platform) && shouldQueueBrowserCapture(existing, url)) {
                    queries.deleteEntry(existing.id);
                } else {
                    results.push({ url, status: 'duplicate', id: existing.id, title: existing.title });
                    continue;
                }
            }

            const parsed = await parseUrl(url);
            const entryData = { ...parsed, url };
            applyZhihuSharedMetadata(entryData, message || '', url);
            applyDouyinSharedMetadata(entryData, message || '', url);

            if (shouldQueueBrowserCapture(entryData, url)) {
                const assessment = assessParsedEntry(entryData, url);
                const job = upsertCaptureJob(queries, url, {
                    platform,
                    source_channel: 'feishu',
                    source_message: message || '',
                });
                results.push({
                    url,
                    status: 'capture_queued',
                    job_id: job.id,
                    job_status: job.status,
                    reason: assessment.reason,
                });
                continue;
            }

            try {
                const classification = await classifyEntry(entryData);
                entryData.category = classification.category || '其他';
                entryData.sub_category = classification.sub_category || null;
                entryData.summary = entryData.summary || classification.summary || null;
                entryData.tags = classification.tags || [];
            } catch {
                entryData.category = '其他';
            }

            try {
                const book = await processBook(entryData);
                if (book) entryData.book_id = book.id;
            } catch { /* ignore */ }

            const entry = queries.createEntry(entryData);
            results.push({ url, status: 'created', id: entry.id, title: entry.title, category: entry.category });
            logger.success(`Webhook entry created: ${entry.title}`);
        } catch (err) {
            logger.error(`Failed to process webhook URL: ${url}`, err);
            results.push({ url, status: 'error', error: err.message });
        }
    }

    const successCount = results.filter(r => r.status === 'created').length;
    res.json({
        success: true,
        message: `Processed ${urls.length} URL(s), ${successCount} added`,
        results
    });
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

function sanitizeSharedUrl(url) {
    return String(url || '').replace(/[)）\]】>》。，、]+$/u, '');
}

function mergeDouyinSourceData(parsed = {}, shared = {}) {
    const contentType = parsed.content_type && parsed.content_type !== 'unknown'
        ? parsed.content_type
        : (shared.content_type || parsed.content_type || 'unknown');
    return { ...parsed, ...shared, content_type: contentType };
}

module.exports = router;
