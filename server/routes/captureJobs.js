const express = require('express');
const crypto = require('crypto');
const logger = require('../utils/logger');
const queries = require('../db/queries');
const { detectPlatform } = require('../services/parser');

const router = express.Router();
const AGENT_TOKEN_KEY = 'agent.token';
const CLIPPER_TOKEN_KEY = 'clipper.token';
const ACTIVE_STATUSES = ['queued', 'opening', 'capturing', 'needs_login', 'needs_user_action', 'failed'];

router.post('/', requireAgentAccess, (req, res) => {
    try {
        const rawUrl = req.body?.url || extractFirstUrl(req.body?.source_message || req.body?.message || '');
        const url = cleanUrl(rawUrl);
        if (!url) return res.status(400).json({ success: false, error: 'url is required' });

        const existingEntry = queries.getEntryByUrl(url);
        if (existingEntry) {
            return res.json({
                success: true,
                duplicate: true,
                data: createSavedJobResponse(url, existingEntry, req.body),
                entry: existingEntry,
            });
        }

        const previous = queries.findCaptureJobByUrl(url);
        if (previous?.status === 'saved' && previous.entry_id) {
            const previousEntry = queries.getEntryById(previous.entry_id);
            if (previousEntry) {
                return res.json({ success: true, duplicate: true, data: previous, entry: previousEntry });
            }
        }

        const active = queries.findActiveCaptureJobByUrl(url);
        if (active) {
            const retried = ['failed', 'needs_login', 'needs_user_action'].includes(active.status)
                ? queries.updateCaptureJob(active.id, { status: 'queued', error: null })
                : active;
            return res.json({ success: true, duplicate: true, data: retried });
        }

        const platform = req.body?.platform || detectPlatform(url);
        const job = queries.createCaptureJob({
            url,
            normalized_url: normalizeUrl(url),
            platform,
            source_channel: req.body?.source_channel || 'agent',
            source_message: req.body?.source_message || req.body?.message || null,
            status: 'queued',
        });
        logger.info(`Capture job created: ${job.id} ${job.platform} ${job.url}`);
        res.status(202).json({ success: true, data: job });
    } catch (err) {
        logger.error('Create capture job failed', err);
        res.status(500).json({ success: false, error: err.message });
    }
});

router.get('/', requireAgentAccess, (req, res) => {
    try {
        const jobs = queries.listCaptureJobs({
            status: req.query.status,
            platform: req.query.platform,
            limit: parseInt(req.query.limit, 10) || 20,
        });
        res.json({ success: true, data: jobs, total: jobs.length });
    } catch (err) {
        logger.error('List capture jobs failed', err);
        res.status(500).json({ success: false, error: err.message });
    }
});

router.get('/pending', requireClipperToken, (req, res) => {
    try {
        const jobs = queries.listCaptureJobs({
            status: req.query.status || ACTIVE_STATUSES,
            platform: req.query.platform,
            limit: parseInt(req.query.limit, 10) || 3,
        });
        res.json({ success: true, data: jobs, total: jobs.length });
    } catch (err) {
        logger.error('List pending capture jobs failed', err);
        res.status(500).json({ success: false, error: err.message });
    }
});

router.get('/summary', requireAgentAccess, (req, res) => {
    try {
        const jobs = queries.listCaptureJobs({ status: ACTIVE_STATUSES, limit: 100 });
        const byStatus = jobs.reduce((acc, job) => {
            acc[job.status] = (acc[job.status] || 0) + 1;
            return acc;
        }, {});
        res.json({ success: true, data: { total_active: jobs.length, by_status: byStatus, recent: jobs.slice(0, 10) } });
    } catch (err) {
        logger.error('Capture job summary failed', err);
        res.status(500).json({ success: false, error: err.message });
    }
});

router.get('/:id', requireAgentAccess, (req, res) => {
    const job = queries.getCaptureJobById(req.params.id);
    if (!job) return res.status(404).json({ success: false, error: 'Capture job not found' });
    const entry = job.entry_id ? queries.getEntryById(job.entry_id) : null;
    res.json({ success: true, data: { ...job, entry } });
});

router.patch('/:id', requireClipperToken, (req, res) => {
    try {
        const job = queries.getCaptureJobById(req.params.id);
        if (!job) return res.status(404).json({ success: false, error: 'Capture job not found' });
        const status = normalizeStatus(req.body?.status);
        const updated = queries.updateCaptureJob(req.params.id, {
            status: status || job.status,
            entry_id: req.body?.entry_id ?? job.entry_id,
            error: req.body?.error ?? null,
            increment_attempts: !!req.body?.increment_attempts,
            finish_now: ['saved', 'failed', 'needs_login', 'needs_user_action'].includes(status),
        });
        res.json({ success: true, data: updated });
    } catch (err) {
        logger.error('Update capture job failed', err);
        res.status(500).json({ success: false, error: err.message });
    }
});

router.delete('/:id', requireAgentAccess, (req, res) => {
    const deleted = queries.deleteCaptureJob(req.params.id);
    if (!deleted) return res.status(404).json({ success: false, error: 'Capture job not found' });
    res.json({ success: true, message: 'Capture job deleted' });
});

function requireAgentAccess(req, res, next) {
    const configured = getAgentToken();
    const provided = String(req.get('X-InfoMind-Agent-Token') || '').trim();
    if (provided && safeEqual(provided, configured)) return next();
    if (isLocalRequest(req)) return next();
    return res.status(401).json({ success: false, error: 'InfoMind Agent is not authorized' });
}

function requireClipperToken(req, res, next) {
    const token = getOrCreateConfigToken(CLIPPER_TOKEN_KEY);
    const provided = String(req.get('X-InfoMind-Clipper-Token') || req.body?.token || '').trim();
    if (!provided || !safeEqual(provided, token)) {
        return res.status(401).json({ success: false, error: 'InfoMind Clipper is not paired' });
    }
    next();
}

function getAgentToken() {
    return getOrCreateConfigToken(AGENT_TOKEN_KEY);
}

function getOrCreateConfigToken(key) {
    let token = queries.getConfig(key);
    if (!token) {
        token = crypto.randomBytes(18).toString('base64url');
        queries.setConfig(key, token);
    }
    return token;
}

function safeEqual(a, b) {
    const left = Buffer.from(String(a));
    const right = Buffer.from(String(b));
    return left.length === right.length && crypto.timingSafeEqual(left, right);
}

function isLocalRequest(req) {
    const ip = String(req.ip || req.socket?.remoteAddress || '');
    return ip === '127.0.0.1' || ip === '::1' || ip === '::ffff:127.0.0.1';
}

function createSavedJobResponse(url, entry, body = {}) {
    return {
        id: null,
        url,
        normalized_url: normalizeUrl(url),
        platform: body.platform || entry.platform || detectPlatform(url),
        source_channel: body.source_channel || 'agent',
        status: 'saved',
        entry_id: entry.id,
        error: null,
        attempts: 0,
        completed_at: new Date().toISOString(),
    };
}

function extractFirstUrl(text) {
    return String(text || '').match(/https?:\/\/[^\s"'<>]+/i)?.[0] || '';
}

function cleanUrl(value) {
    const text = String(value || '').trim().replace(/[)）\]】>》。，、]+$/u, '');
    return /^https?:\/\//i.test(text) ? text : '';
}

function normalizeUrl(url) {
    try {
        const parsed = new URL(url);
        parsed.hash = '';
        for (const key of ['utm_source', 'utm_medium', 'utm_campaign', 'utm_term', 'utm_content']) {
            parsed.searchParams.delete(key);
        }
        return parsed.toString().replace(/\/$/, '');
    } catch {
        return url;
    }
}

function normalizeStatus(status) {
    const value = String(status || '').trim();
    const allowed = new Set(['queued', 'opening', 'capturing', 'saved', 'failed', 'needs_login', 'needs_user_action']);
    return allowed.has(value) ? value : null;
}

module.exports = router;
