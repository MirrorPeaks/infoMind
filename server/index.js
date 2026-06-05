// server/index.js
const express = require('express');
const cors = require('cors');
const path = require('path');
const { initDb } = require('./db/init');
const logger = require('./utils/logger');
const { getCoversDir } = require('./utils/paths');

function createApp() {
    const app = express();

    // Middleware
    app.use(cors());
    app.use(express.json({ limit: '15mb' }));
    app.use(express.urlencoded({ extended: true }));

    // Static files (Web UI)
    app.use(express.static(path.join(__dirname, '../public'), {
        setHeaders(res, filePath) {
            if (filePath.endsWith('.html') || filePath.endsWith('.js')) {
                res.setHeader('Cache-Control', 'no-store');
            }
        }
    }));
    app.use('/covers', express.static(getCoversDir()));
    app.use('/extensions', express.static(path.join(__dirname, '../extensions'), {
        setHeaders(res) {
            res.setHeader('Cache-Control', 'no-store');
        }
    }));

    // API Routes
    app.use('/api/entries', require('./routes/entries'));
    app.use('/api/books', require('./routes/books'));
    app.use('/api/categories', require('./routes/categories'));
    app.use('/api/config', require('./routes/config'));
    app.use('/api/webhook', require('./routes/webhook'));
    app.use('/api/clipper', require('./routes/clipper'));
    app.use('/api/capture-jobs', require('./routes/captureJobs'));

    app.use('/api/stats', require('./routes/stats'));

    // Health check
    app.get('/api/health', (req, res) => {
        res.json({ success: true, status: 'ok', version: '1.0.0', timestamp: new Date().toISOString() });
    });

    // SPA fallback - serve index.html for all non-API routes
    app.get('*', (req, res) => {
        if (!req.path.startsWith('/api')) {
            res.sendFile(path.join(__dirname, '../public/index.html'));
        }
    });

    // Error handler
    app.use((err, req, res, next) => {
        logger.error('Unhandled error', err);
        res.status(500).json({ success: false, error: 'Internal server error' });
    });

    return app;
}

function startServer({ port = process.env.INFOMIND_PORT || 3456, host, app = createApp(), log = true } = {}) {
    return new Promise((resolve, reject) => {
        try {
            initDb();
        } catch (err) {
            reject(err);
            return;
        }

        const server = app.listen(port, host, () => {
            const address = server.address();
            const actualPort = typeof address === 'object' ? address.port : port;
            const actualHost = host || 'localhost';
            if (log) {
                logger.success(`InfoMind server running at http://${actualHost}:${actualPort}`);
                logger.info(`Web UI: http://${actualHost}:${actualPort}`);
                logger.info(`API:    http://${actualHost}:${actualPort}/api`);
            }
            resolve({ app, server, port: actualPort, host: actualHost });
        });
        server.once('error', reject);
    });
}

const app = createApp();

if (require.main === module) {
    startServer({ app }).catch((err) => {
        logger.error('Failed to start server', err);
        process.exit(1);
    });
}

module.exports = app;
module.exports.createApp = createApp;
module.exports.startServer = startServer;
