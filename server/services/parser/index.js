// server/services/parser/index.js - Parser factory
const { detectPlatform, genericParse } = require('./generic');
const { bilibiliParse } = require('./bilibili');
const { youtubeParse } = require('./youtube');
const { twitterParse } = require('./twitter');
const { xiaohongshuParse } = require('./xiaohongshu');
const { zhihuParse } = require('./zhihu');
const { xiaoyuzhouParse } = require('./xiaoyuzhou');
const { douyinParse } = require('./douyin');
const logger = require('../../utils/logger');

const PARSERS = {
    bilibili: bilibiliParse,
    youtube: youtubeParse,
    twitter: twitterParse,
    xiaohongshu: xiaohongshuParse,
    zhihu: zhihuParse,
    xiaoyuzhou: xiaoyuzhouParse,
    douyin: douyinParse,
};

async function parseUrl(url) {
    const platform = detectPlatform(url);
    const parser = PARSERS[platform] || genericParse;

    logger.debug(`Using parser: ${platform} for ${url}`);

    try {
        const result = await parser(url);
        return {
            platform,
            title: result.title || null,
            description: result.description || null,
            cover_url: result.cover_url || null,
            author: result.author || null,
            author_id: result.author_id || null,
            source_data: result.source_data || {},
        };
    } catch (err) {
        logger.warn(`Platform parser failed (${platform}), falling back to generic: ${err.message}`);
        try {
            const fallback = await genericParse(url);
            return { ...fallback, platform };
        } catch (fallbackErr) {
            logger.warn(`Generic parser also failed: ${fallbackErr.message}`);
            return {
                platform,
                title: null,
                description: null,
                cover_url: null,
                author: null,
                author_id: null,
                source_data: { error: fallbackErr.message },
            };
        }
    }
}

module.exports = { parseUrl, detectPlatform };
