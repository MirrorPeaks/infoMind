// server/services/parser/bilibili.js
const axios = require('axios');

async function bilibiliParse(url) {
    const originalUrl = url;
    if (/https?:\/\/(?:www\.)?b23\.tv\//i.test(url)) {
        url = await resolveBilibiliShortUrl(url);
    }

    // Extract BV number or AV number
    const bvMatch = url.match(/BV([a-zA-Z0-9]+)/);
    const avMatch = url.match(/av(\d+)/i);

    let apiUrl;
    if (bvMatch) {
        apiUrl = `https://api.bilibili.com/x/web-interface/view?bvid=BV${bvMatch[1]}`;
    } else if (avMatch) {
        apiUrl = `https://api.bilibili.com/x/web-interface/view?aid=${avMatch[1]}`;
    } else {
        throw new Error('Cannot extract Bilibili video ID from URL');
    }

    const response = await axios.get(apiUrl, {
        headers: { 'User-Agent': 'Mozilla/5.0', Referer: 'https://www.bilibili.com' },
        timeout: 8000,
    });

    const data = response.data;
    if (data.code !== 0) throw new Error(`Bilibili API error: ${data.message}`);

    const video = data.data;
    return {
        title: video.title,
        description: video.desc || null,
        cover_url: video.pic,
        author: video.owner?.name || null,
        author_id: String(video.owner?.mid || ''),
        platform: 'bilibili',
        source_data: {
            bvid: video.bvid,
            aid: video.aid,
            cid: video.cid || video.pages?.[0]?.cid || null,
            duration: video.duration,
            view: video.stat?.view,
            like: video.stat?.like,
            pubdate: video.pubdate,
            original_url: originalUrl,
            final_url: url,
        },
    };
}

async function resolveBilibiliShortUrl(url) {
    const response = await axios.get(url, {
        headers: { 'User-Agent': 'Mozilla/5.0' },
        timeout: 8000,
        maxRedirects: 6,
    });
    return response.request?.res?.responseUrl || url;
}

module.exports = { bilibiliParse };
