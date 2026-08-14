// server/services/parser/youtube.js
const axios = require('axios');
const { readSocialUrl } = require('../agentReach');

async function youtubeParse(url) {
    const agentReach = await readSocialUrl(url, 'youtube');
    if (agentReach) return agentReach;

    // Extract video ID
    const idMatch = url.match(/(?:v=|youtu\.be\/|embed\/)([a-zA-Z0-9_-]{11})/);
    const videoId = idMatch ? idMatch[1] : null;

    // Try noembed API (free, no key needed)
    try {
        const oembedUrl = `https://www.youtube.com/oembed?url=${encodeURIComponent(url)}&format=json`;
        const response = await axios.get(oembedUrl, { timeout: 8000 });
        const data = response.data;

        // YouTube thumbnail
        const cover_url = videoId
            ? `https://img.youtube.com/vi/${videoId}/maxresdefault.jpg`
            : data.thumbnail_url;

        return {
            title: data.title,
            description: null,
            cover_url,
            author: data.author_name || null,
            author_id: null, // YouTube oEmbed doesn't expose channel ID
            platform: 'youtube',
            source_data: {
                video_id: videoId,
                thumbnail_url: data.thumbnail_url,
                author_url: data.author_url,
                width: data.width,
                height: data.height,
            },
        };
    } catch (err) {
        // Fallback to generic OG parser
        const { genericParse } = require('./generic');
        const result = await genericParse(url);
        if (videoId) {
            result.cover_url = result.cover_url || `https://img.youtube.com/vi/${videoId}/hqdefault.jpg`;
        }
        result.platform = 'youtube';
        return result;
    }
}

module.exports = { youtubeParse };
