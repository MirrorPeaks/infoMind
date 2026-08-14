const crypto = require('crypto');
const fs = require('fs');
const fsp = require('fs/promises');
const path = require('path');
const { execFile } = require('child_process');
const { pipeline } = require('stream/promises');
const axios = require('axios');
const { getDataDir } = require('../utils/paths');
const logger = require('../utils/logger');

const RELEASE_BASE = process.env.INFOMIND_YTDLP_RELEASE_BASE
    || 'https://github.com/yt-dlp/yt-dlp/releases/latest/download';
const MAX_VERSION_AGE_MS = 120 * 24 * 60 * 60 * 1000;
let managedDownload = null;

async function resolveYtDlpCommand({ fallbackCommand = null, now = new Date() } = {}) {
    const configured = String(process.env.INFOMIND_YTDLP_PATH || '').trim();
    if (configured && await isRunnable(configured)) return configured;

    const managedPath = getManagedYtDlpPath();
    const managedVersion = await readYtDlpVersion(managedPath);
    if (managedVersion && !isYtDlpVersionStale(managedVersion, now)) return managedPath;

    const fallbackVersion = await readYtDlpVersion(fallbackCommand);
    if (fallbackVersion && !isYtDlpVersionStale(fallbackVersion, now)) return fallbackCommand;

    if (process.env.INFOMIND_YTDLP_AUTO_DOWNLOAD === '0') {
        return managedVersion ? managedPath : fallbackCommand;
    }

    const asset = getYtDlpReleaseAsset(process.platform, process.arch);
    if (!asset) return managedVersion ? managedPath : fallbackCommand;

    try {
        managedDownload ||= downloadManagedYtDlp(asset, managedPath).finally(() => {
            managedDownload = null;
        });
        await managedDownload;
        return managedPath;
    } catch (err) {
        logger.warn(`Managed yt-dlp update failed; using available fallback: ${err.message}`);
        return managedVersion ? managedPath : fallbackCommand;
    }
}

function getManagedYtDlpPath() {
    return path.join(getDataDir(), 'tools', 'yt-dlp');
}

function getYtDlpReleaseAsset(platform, arch) {
    if (platform === 'darwin' && ['arm64', 'x64'].includes(arch)) return 'yt-dlp_macos';
    if (platform === 'linux' && arch === 'x64') return 'yt-dlp_linux';
    if (platform === 'linux' && arch === 'arm64') return 'yt-dlp_linux_aarch64';
    return null;
}

function isYtDlpVersionStale(version, now = new Date()) {
    const match = String(version || '').match(/(20\d{2})\.(\d{2})\.(\d{2})/);
    if (!match) return true;
    const releasedAt = Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3]));
    return now.getTime() - releasedAt > MAX_VERSION_AGE_MS;
}

function parseExpectedChecksum(manifest, asset) {
    for (const line of String(manifest || '').split(/\r?\n/)) {
        const parts = line.trim().split(/\s+/);
        if (parts.length >= 2 && parts[parts.length - 1].replace(/^\*/, '') === asset) {
            return parts[0].toLowerCase();
        }
    }
    return null;
}

async function downloadManagedYtDlp(asset, targetPath) {
    const manifestResponse = await requestWithRetry(`${RELEASE_BASE}/SHA2-256SUMS`, {
        timeout: 30000,
        responseType: 'text',
    });
    const expected = parseExpectedChecksum(manifestResponse.data, asset);
    if (!expected) throw new Error(`Official checksum for ${asset} was not found`);

    await fsp.mkdir(path.dirname(targetPath), { recursive: true });
    const temporaryPath = `${targetPath}.download`;
    try {
        await downloadStreamWithRetry(`${RELEASE_BASE}/${asset}`, temporaryPath);
        const actual = await hashFile(temporaryPath);
        if (actual !== expected) throw new Error(`Checksum mismatch for ${asset}`);
        await fsp.chmod(temporaryPath, 0o755);
        await fsp.rename(temporaryPath, targetPath);
    } finally {
        await fsp.rm(temporaryPath, { force: true }).catch(() => {});
    }

    const version = await readYtDlpVersion(targetPath);
    if (!version) throw new Error('Downloaded yt-dlp binary did not start');
    logger.info(`Managed yt-dlp ready: ${version} (${targetPath})`);
}

async function requestWithRetry(url, options, attempts = 3) {
    let lastError = null;
    for (let attempt = 1; attempt <= attempts; attempt += 1) {
        try {
            return await axios.get(url, { maxRedirects: 10, ...options });
        } catch (err) {
            lastError = err;
            if (attempt < attempts) await wait(attempt * 600);
        }
    }
    throw lastError;
}

async function downloadStreamWithRetry(url, destination, attempts = 3) {
    let lastError = null;
    for (let attempt = 1; attempt <= attempts; attempt += 1) {
        await fsp.rm(destination, { force: true }).catch(() => {});
        try {
            const response = await requestWithRetry(url, {
                timeout: 120000,
                responseType: 'stream',
                maxContentLength: 100 * 1024 * 1024,
            }, 1);
            await pipeline(response.data, fs.createWriteStream(destination, { mode: 0o755 }));
            return;
        } catch (err) {
            lastError = err;
            if (attempt < attempts) await wait(attempt * 1000);
        }
    }
    throw lastError;
}

function hashFile(filePath) {
    return new Promise((resolve, reject) => {
        const hash = crypto.createHash('sha256');
        const input = fs.createReadStream(filePath);
        input.on('error', reject);
        input.on('data', chunk => hash.update(chunk));
        input.on('end', () => resolve(hash.digest('hex')));
    });
}

function wait(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
}

async function readYtDlpVersion(command) {
    if (!command || (!path.isAbsolute(command) && !command.includes('/'))) {
        return runVersionCommand(command);
    }
    if (!fs.existsSync(command)) return null;
    return runVersionCommand(command);
}

async function isRunnable(command) {
    return !!await readYtDlpVersion(command);
}

function runVersionCommand(command) {
    if (!command) return Promise.resolve(null);
    return new Promise(resolve => {
        execFile(command, ['--version'], { timeout: 8000 }, (err, stdout) => {
            resolve(err ? null : String(stdout || '').trim().split(/\r?\n/)[0] || null);
        });
    });
}

module.exports = {
    resolveYtDlpCommand,
    getManagedYtDlpPath,
    getYtDlpReleaseAsset,
    isYtDlpVersionStale,
    parseExpectedChecksum,
};
