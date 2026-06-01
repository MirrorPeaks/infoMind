// server/services/parser/generic.js - Universal Open Graph parser
const axios = require('axios');
const cheerio = require('cheerio');

const USER_AGENT = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36';

async function genericParse(url) {
    const response = await axios.get(url, {
        headers: { 'User-Agent': USER_AGENT, 'Accept-Language': 'zh-CN,zh;q=0.9,en;q=0.8' },
        timeout: 10000,
        maxRedirects: 5,
    });

    const $ = cheerio.load(response.data);

    const get = (selectors) => {
        for (const s of selectors) {
            const val = $(s).attr('content') || $(s).text();
            if (val && val.trim()) return val.trim();
        }
        return null;
    };

    const title = get([
        'meta[property="og:title"]',
        'meta[name="twitter:title"]',
        'title',
    ]);

    const description = get([
        'meta[property="og:description"]',
        'meta[name="description"]',
        'meta[name="twitter:description"]',
    ]);

    const cover_url = get([
        'meta[property="og:image"]',
        'meta[name="twitter:image"]',
        'meta[name="twitter:image:src"]',
    ]);

    const author = get([
        'meta[name="author"]',
        'meta[property="article:author"]',
        'meta[name="twitter:creator"]',
        '[class*="author"]',
        '[itemprop="author"]',
    ]);

    const siteName = get(['meta[property="og:site_name"]']);

    return {
        title: title || url,
        description,
        cover_url,
        author: author || siteName || null,
        author_id: null,
        platform: detectPlatform(url),
        source_data: { title, description, cover_url, author, siteName, url },
    };
}

function detectPlatform(url) {
    const u = url.toLowerCase();
    if (u.includes('twitter.com') || u.includes('x.com')) return 'twitter';
    if (u.includes('bilibili.com')) return 'bilibili';
    if (u.includes('youtube.com') || u.includes('youtu.be')) return 'youtube';
    if (u.includes('douyin.com') || u.includes('iesdouyin.com') || u.includes('amemv.com')) return 'douyin';
    if (u.includes('xiaohongshu.com') || u.includes('xhslink.com')) return 'xiaohongshu';
    if (u.includes('zhihu.com')) return 'zhihu';
    if (u.includes('xiaoyuzhoufm.com') || u.includes('xiaoyuzhou.com')) return 'xiaoyuzhou';
    if (u.includes('mp.weixin.qq.com')) return 'wechat';
    if (u.includes('weibo.com')) return 'weibo';
    return 'web';
}

module.exports = { genericParse, detectPlatform };
