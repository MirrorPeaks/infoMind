// server/routes/config.js
const express = require('express');
const router = express.Router();
const logger = require('../utils/logger');
const queries = require('../db/queries');
const { encrypt, decrypt, maskKey } = require('../utils/crypto');
const { testLlmConnection } = require('../services/llm');

const SENSITIVE_KEYS = ['llm.api_key'];

// GET /api/config
router.get('/', (req, res) => {
    try {
        const all = queries.getAllConfig();
        // Decrypt and mask sensitive values
        const result = {};
        for (const [k, v] of Object.entries(all)) {
            if (k === 'clipper.token' || k === 'agent.token') {
                result[k] = maskKey(v);
            } else if (SENSITIVE_KEYS.includes(k)) {
                result[k] = maskKey(decrypt(v));
            } else {
                result[k] = v;
            }
        }
        res.json({ success: true, data: result });
    } catch (err) {
        logger.error('Get config error', err);
        res.status(500).json({ success: false, error: err.message });
    }
});

// PUT /api/config
router.put('/', (req, res) => {
    try {
        const updates = req.body;
        for (const [key, value] of Object.entries(updates)) {
            if (value === null || value === undefined || value === '') continue;
            const storeValue = SENSITIVE_KEYS.includes(key) ? encrypt(String(value)) : String(value);
            queries.setConfig(key, storeValue);
        }
        res.json({ success: true, message: 'Config updated' });
    } catch (err) {
        logger.error('Put config error', err);
        res.status(500).json({ success: false, error: err.message });
    }
});

// POST /api/config/test-llm
router.post('/test-llm', async (req, res) => {
    try {
        const result = await testLlmConnection();
        res.json({ success: true, data: result });
    } catch (err) {
        logger.error('LLM test error', err);
        res.status(400).json({ success: false, error: err.message });
    }
});

// GET /api/config/raw/:key (for internal use, returns decrypted value)
router.get('/raw/:key', (req, res) => {
    const value = queries.getConfig(req.params.key);
    if (!value) return res.json({ success: true, data: null });
    const decrypted = SENSITIVE_KEYS.includes(req.params.key) ? decrypt(value) : value;
    res.json({ success: true, data: decrypted });
});

module.exports = router;
