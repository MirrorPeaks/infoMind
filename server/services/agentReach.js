const { execFile } = require('child_process');

const DEFAULT_TIMEOUT = 15000;
const DISABLED_VALUES = new Set(['0', 'false', 'off', 'disabled']);
const ENABLED_VALUES = new Set(['1', 'true', 'on', 'enabled']);

async function readSocialUrl(url, platform, options = {}) {
    if (isDisabled()) return null;
    try {
        if (platform === 'twitter' && canUseTwitterCli()) return await readTwitter(url, options);
        if (platform === 'youtube') return await readVideoMetadata(url, platform, options);
        if (platform === 'xiaohongshu' && canUseXhsCli()) return await readXiaohongshu(url, options);
    } catch {
        return null;
    }
    return null;
}

async function readTwitter(url, options = {}) {
    if (!canUseTwitterCli()) return null;
    const output = await runIfAvailable('twitter', ['tweet', url], { timeout: options.timeout || DEFAULT_TIMEOUT });
    const parsed = parseJsonOrText(output);
    const text = pickText(parsed, ['text', 'content', 'full_text', 'fullText', 'tweet_text', 'body']) || output;
    const author = pickText(parsed, ['author', 'author_name', 'authorName', 'username', 'user_name', 'userName']);
    const title = cleanText(text).slice(0, 100);
    if (!title && !author) return null;
    return {
        title: title || 'X/Twitter 帖子',
        description: cleanText(text) || null,
        cover_url: pickUrl(parsed, ['cover_url', 'coverUrl', 'thumbnail', 'image', 'image_url', 'imageUrl']),
        author: cleanText(author) || null,
        author_id: pickText(parsed, ['author_id', 'authorId', 'handle', 'screen_name', 'screenName']) || null,
        platform: 'twitter',
        source_data: {
            agent_reach_source: 'twitter-cli',
            tweet_text: cleanText(text) || null,
            full_text: cleanText(text) || null,
            content_type: hasVideoLikeMedia(parsed) ? 'video' : 'post',
            media: collectMedia(parsed),
            raw_excerpt: rawExcerpt(output),
        },
    };
}

async function readVideoMetadata(url, platform, options = {}) {
    const output = await runIfAvailable('yt-dlp', [
        '--dump-json',
        '--no-playlist',
        '--skip-download',
        url,
    ], { timeout: options.timeout || 22000 });
    const parsed = parseJsonOrText(output);
    if (!parsed || typeof parsed !== 'object') return null;
    const title = cleanText(parsed.title);
    if (!title) return null;
    return {
        title,
        description: cleanText(parsed.description) || null,
        cover_url: pickUrl(parsed, ['thumbnail']) || firstArrayUrl(parsed.thumbnails, ['url']),
        author: cleanText(parsed.uploader || parsed.channel || parsed.creator) || null,
        author_id: parsed.uploader_id || parsed.channel_id || null,
        platform,
        source_data: {
            agent_reach_source: 'yt-dlp',
            video_id: parsed.id || null,
            webpage_url: parsed.webpage_url || url,
            duration: normalizeDuration(parsed.duration),
            view_count: parsed.view_count || null,
            like_count: parsed.like_count || null,
            upload_date: parsed.upload_date || null,
            subtitle_languages: Object.keys(parsed.subtitles || {}),
            automatic_caption_languages: Object.keys(parsed.automatic_captions || {}),
            content_type: 'video',
        },
    };
}

async function readXiaohongshu(url, options = {}) {
    if (!canUseXhsCli()) return null;
    const noteId = extractXhsNoteId(url);
    const target = noteId || url;
    const output = await runIfAvailable('xhs', ['read', target], { timeout: options.timeout || DEFAULT_TIMEOUT });
    const parsed = parseJsonOrText(output);
    const text = pickText(parsed, ['content', 'text', 'desc', 'description', 'full_text', 'fullText']) || output;
    const title = pickText(parsed, ['title', 'displayTitle', 'noteTitle']) || cleanText(text).slice(0, 80);
    if (!title) return null;
    return {
        title,
        description: cleanText(text) || null,
        cover_url: pickUrl(parsed, ['cover_url', 'coverUrl', 'image', 'image_url', 'imageUrl']) || firstArrayUrl(parsed?.images || parsed?.image_list, ['url', 'src']),
        author: pickText(parsed, ['author', 'nickname', 'userName', 'user_name', 'name']) || null,
        author_id: pickText(parsed, ['author_id', 'authorId', 'user_id', 'userId']) || null,
        platform: 'xiaohongshu',
        source_data: {
            agent_reach_source: 'xhs-cli',
            note_id: noteId,
            full_text: cleanText(text) || null,
            content_type: hasVideoLikeMedia(parsed) ? 'video' : 'note',
            images: collectImages(parsed),
            media: collectMedia(parsed),
            raw_excerpt: rawExcerpt(output),
        },
    };
}

async function runIfAvailable(command, args, { timeout = DEFAULT_TIMEOUT } = {}) {
    return new Promise((resolve, reject) => {
        const child = execFile(command, args, {
            timeout,
            maxBuffer: 6 * 1024 * 1024,
            env: process.env,
        }, (error, stdout, stderr) => {
            if (error) {
                reject(new Error(stderr || error.message));
                return;
            }
            resolve(String(stdout || stderr || '').trim());
        });
        child.on('error', reject);
    });
}

function parseJsonOrText(output) {
    const text = String(output || '').trim();
    if (!text) return null;
    try { return JSON.parse(text); } catch {}
    const start = text.indexOf('{');
    const end = text.lastIndexOf('}');
    if (start >= 0 && end > start) {
        try { return JSON.parse(text.slice(start, end + 1)); } catch {}
    }
    return text;
}

function pickText(input, keys) {
    if (!input || typeof input === 'string') return null;
    for (const key of keys) {
        const value = input?.[key];
        if (typeof value === 'string' && value.trim()) return cleanText(value);
    }
    for (const value of Object.values(input)) {
        if (value && typeof value === 'object') {
            const picked = pickText(value, keys);
            if (picked) return picked;
        }
    }
    return null;
}

function pickUrl(input, keys) {
    const text = pickText(input, keys);
    return isHttpUrl(text) ? text : null;
}

function collectImages(input) {
    return flatten(input).filter(value => isHttpUrl(value) && /\.(jpg|jpeg|png|webp|gif)(\?|$)/i.test(value)).slice(0, 20);
}

function collectMedia(input) {
    return flatten(input)
        .filter(value => isHttpUrl(value) && /\.(mp4|m3u8|mov|webm)(\?|$)/i.test(value))
        .slice(0, 10)
        .map(url => ({ url, type: 'video', platform: 'agent-reach' }));
}

function hasVideoLikeMedia(input) {
    return collectMedia(input).length > 0 || flatten(input).some(value => typeof value === 'string' && /video|m3u8|mp4/i.test(value));
}

function flatten(input, out = []) {
    if (input === null || input === undefined || out.length > 5000) return out;
    if (typeof input !== 'object') {
        out.push(input);
        return out;
    }
    if (Array.isArray(input)) {
        for (const item of input) flatten(item, out);
        return out;
    }
    for (const value of Object.values(input)) flatten(value, out);
    return out;
}

function firstArrayUrl(items, keys) {
    if (!Array.isArray(items)) return null;
    for (const item of items) {
        const url = pickUrl(item, keys);
        if (url) return url;
    }
    return null;
}

function extractXhsNoteId(url) {
    return String(url || '').match(/\/(?:explore|discovery\/item)\/([a-zA-Z0-9]+)/)?.[1] || null;
}

function normalizeDuration(value) {
    const number = Number(value);
    if (!Number.isFinite(number) || number <= 0) return null;
    return number > 10000 ? Math.round(number / 1000) : Math.round(number);
}

function cleanText(value) {
    return String(value || '').replace(/\u00a0/g, ' ').replace(/\s+/g, ' ').trim();
}

function rawExcerpt(output) {
    return String(output || '').slice(0, 2000);
}

function isHttpUrl(value) {
    return typeof value === 'string' && /^https?:\/\//i.test(value);
}

function isDisabled() {
    return DISABLED_VALUES.has(String(process.env.INFOMIND_AGENT_REACH || '').toLowerCase());
}

function canUseTwitterCli(env = process.env) {
    return Boolean(env.TWITTER_AUTH_TOKEN && env.TWITTER_CT0);
}

function canUseXhsCli(env = process.env) {
    return ENABLED_VALUES.has(String(env.INFOMIND_AGENT_REACH_XHS || '').toLowerCase());
}

module.exports = { readSocialUrl, canUseTwitterCli, canUseXhsCli };
