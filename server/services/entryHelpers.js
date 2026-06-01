const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const axios = require('axios');
const logger = require('../utils/logger');
const { getCoversDir } = require('../utils/paths');

async function downloadCover(coverUrl, sourceUrl) {
    if (!coverUrl) return null;
    try {
        if (coverUrl.startsWith('//')) coverUrl = 'https:' + coverUrl;
        if (coverUrl.startsWith('data:')) return null;

        const extMatch = coverUrl.match(/\.(jpg|jpeg|png|webp|gif)/i);
        const ext = extMatch ? extMatch[1].toLowerCase() : 'jpg';
        const filename = crypto.createHash('md5').update(coverUrl).digest('hex') + '.' + ext;
        const filepath = path.join(getCoversDir(), filename);

        fs.mkdirSync(path.dirname(filepath), { recursive: true });
        if (fs.existsSync(filepath)) return '/covers/' + filename;

        const referer = sourceUrl ? new URL(sourceUrl).origin : undefined;
        const response = await axios.get(coverUrl, {
            responseType: 'stream',
            timeout: 15000,
            headers: {
                'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
                ...(referer ? { Referer: referer } : {}),
            },
        });
        const writer = fs.createWriteStream(filepath);
        response.data.pipe(writer);
        return new Promise((resolve, reject) => {
            writer.on('finish', () => resolve('/covers/' + filename));
            writer.on('error', reject);
        });
    } catch (err) {
        logger.warn(`Failed to download cover: ${err.message}`);
        return null;
    }
}

module.exports = { downloadCover };
