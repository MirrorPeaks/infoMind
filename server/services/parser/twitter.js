// server/services/parser/twitter.js
const axios = require('axios');
const cheerio = require('cheerio');
const { genericParse } = require('./generic');
const { readSocialUrl } = require('../agentReach');

const FXTWITTER_BASE_URL = process.env.INFOMIND_FXTWITTER_BASE_URL || 'https://api.fxtwitter.com';
const USER_AGENT = 'InfoMind/1.0 (public X metadata parser)';

async function twitterParse(url) {
    const agentReach = await readSocialUrl(url, 'twitter');
    if (agentReach) return agentReach;

    try {
        const fxTwitter = await fetchFxTwitter(url);
        if (fxTwitter) return fxTwitter;
    } catch {
        // Public API unavailable: keep the official oEmbed fallback below.
    }

    // Normalize URL (x.com → twitter.com for oEmbed)
    const normalizedUrl = url.replace('x.com', 'twitter.com');

    try {
        // Try oEmbed (works for public tweets)
        const oembedUrl = `https://publish.twitter.com/oembed?url=${encodeURIComponent(normalizedUrl)}&omit_script=1`;
        const response = await axios.get(oembedUrl, { timeout: 8000 });
        const data = response.data;

        // Extract author handle
        const authorMatch = data.author_url?.match(/twitter\.com\/([^\/]+)/);
        const authorHandle = authorMatch ? `@${authorMatch[1]}` : data.author_name;

        const description = extractTweetText(data.html);

        return {
            title: description ? buildTweetTitle(description) : `${data.author_name} 的推文`,
            description,
            cover_url: null, // Twitter doesn't expose images in oEmbed
            author: data.author_name || null,
            author_id: authorMatch ? authorMatch[1] : null,
            platform: 'twitter',
            source_data: {
                author_url: data.author_url,
                html: data.html,
                tweet_text: description,
                full_text: description,
                content_type: 'post',
                content_source: 'twitter-oembed',
            },
        };
    } catch {
        // Fallback to generic parsing
        const result = await genericParse(normalizedUrl);
        result.platform = 'twitter';
        return result;
    }
}

async function fetchFxTwitter(url) {
    const statusId = extractTwitterStatusId(url);
    if (!statusId) return null;
    const response = await axios.get(`${FXTWITTER_BASE_URL.replace(/\/$/, '')}/2/status/${statusId}`, {
        headers: { 'User-Agent': USER_AGENT, Accept: 'application/json' },
        timeout: 8000,
    });
    return parseFxTwitterPayload(response.data, url);
}

function parseFxTwitterPayload(payload, originalUrl) {
    const status = payload?.status;
    if (Number(payload?.code) !== 200 || !status || status.type === 'tombstone') return null;
    const text = cleanText(status.text || status.raw_text?.text);
    if (!text) return null;

    const media = status.media || {};
    const allMedia = Array.isArray(media.all) ? media.all : [];
    const videos = uniqueMedia([
        ...(Array.isArray(media.videos) ? media.videos : []),
        ...allMedia.filter(item => item?.type === 'video' || item?.type === 'gif'),
    ]);
    const photos = uniqueMedia([
        ...(Array.isArray(media.photos) ? media.photos : []),
        ...allMedia.filter(item => item?.type === 'photo'),
    ]);
    const normalizedVideos = videos.map(item => ({
        id: item.id || null,
        type: item.type === 'gif' ? 'video' : (item.type || 'video'),
        url: pickBestVideoUrl(item),
        poster: item.thumbnail_url || item.thumbnail || null,
        duration: Number.isFinite(Number(item.duration)) ? Number(item.duration) : null,
        width: Number(item.width) || null,
        height: Number(item.height) || null,
        platform: 'twitter',
    })).filter(item => isHttpUrl(item.url));
    const images = photos.map(item => item?.url).filter(isHttpUrl);
    const video = normalizedVideos[0] || null;
    const author = status.author || payload.author || {};
    const authorName = cleanText(author.name || author.screen_name);
    const handle = cleanText(author.screen_name);
    const coverUrl = video?.poster || images[0] || null;

    return {
        title: buildTweetTitle(text),
        description: text,
        cover_url: coverUrl,
        author: authorName || handle || null,
        author_id: handle || (author.id ? String(author.id) : null),
        platform: 'twitter',
        source_data: {
            tweet_id: status.id ? String(status.id) : extractTwitterStatusId(originalUrl),
            author_url: author.url || (handle ? `https://x.com/${handle}` : null),
            author_avatar: author.avatar_url || null,
            tweet_text: text,
            full_text: text,
            content_type: video ? 'video' : 'post',
            content_source: 'fxtwitter',
            media: normalizedVideos,
            images,
            video_url: video?.url || null,
            duration: video?.duration || null,
            created_at: status.created_at || null,
            canonical_url: status.url || originalUrl,
        },
    };
}

function extractTwitterStatusId(url) {
    return String(url || '').match(/\/(?:status|statuses)\/(\d+)/i)?.[1] || null;
}

function pickBestVideoUrl(item) {
    if (isHttpUrl(item?.url)) return item.url;
    const formats = Array.isArray(item?.formats) ? item.formats : [];
    return formats
        .filter(format => isHttpUrl(format?.url) && (format.container === 'mp4' || /\.mp4(?:\?|$)/i.test(format.url)))
        .sort((a, b) => Number(b.bitrate || 0) - Number(a.bitrate || 0))[0]?.url
        || formats.find(format => isHttpUrl(format?.url))?.url
        || null;
}

function uniqueMedia(items) {
    const seen = new Set();
    return items.filter(item => {
        const key = item?.id || item?.url;
        if (!key || seen.has(key)) return false;
        seen.add(key);
        return true;
    });
}

function isHttpUrl(value) {
    return typeof value === 'string' && /^https?:\/\//i.test(value);
}

function extractTweetText(html) {
    if (!html) return null;
    const $ = cheerio.load(html);
    const text = cleanText($('p').first().text());
    return text || null;
}

function cleanText(value) {
    return String(value || '')
        .replace(/\s+/g, ' ')
        .replace(/\bpic\.twitter\.com\/\S+/gi, '')
        .trim();
}

function buildTweetTitle(text) {
    const value = cleanText(text);
    const lead = value.match(/^(.{12,180}?[。！？!?])(?:\s|$)/u)?.[1];
    if (lead) return lead;
    return value.length > 180 ? `${value.slice(0, 177).trim()}...` : value;
}

module.exports = {
    twitterParse,
    extractTwitterStatusId,
    parseFxTwitterPayload,
};
