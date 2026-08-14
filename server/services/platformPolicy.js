const BROWSER_CAPTURE_PLATFORMS = new Set(['douyin', 'xiaohongshu', 'zhihu', 'twitter', 'weibo']);

const WEAK_TITLES = {
    douyin: new Set(['抖音', '抖音内容', 'Douyin', '抖音短视频', '抖音-记录美好生活']),
    xiaohongshu: new Set(['小红书', '小红书内容']),
    zhihu: new Set(['知乎', '知乎内容', '知乎文章', '知乎回答', '知乎问题']),
    twitter: new Set(['X', 'Twitter', 'X/Twitter 帖子']),
    weibo: new Set(['微博', '微博正文']),
};

const ERROR_PAGE_RE = /页面不见了|内容不存在|内容已删除|访问受限|请先登录|扫码登录|安全验证|登录后查看|暂时无法访问|page not found|something went wrong/i;

function assessParsedEntry(entry = {}, url = entry.url || '') {
    const platform = String(entry.platform || '').trim();
    const source = entry.source_data && typeof entry.source_data === 'object' ? entry.source_data : {};
    const title = cleanText(entry.title);
    const author = cleanText(entry.author);
    const content = collectContent(entry, source);
    const combined = cleanText([title, author, content].filter(Boolean).join(' '));
    const weakTitles = WEAK_TITLES[platform] || new Set();
    const hasRealTitle = !!title
        && title !== cleanText(url)
        && !/^https?:\/\//i.test(title)
        && !weakTitles.has(title);
    const hasErrorPage = ERROR_PAGE_RE.test(combined);
    const hasParserError = !!(source.error || source.parser_error);
    const contentLength = meaningfulLength(content);

    if (!BROWSER_CAPTURE_PLATFORMS.has(platform)) {
        return {
            usable: hasRealTitle,
            needsBrowserCapture: false,
            reason: hasRealTitle ? null : '链接没有解析出有效标题。',
            contentLength,
        };
    }

    let usable = hasRealTitle && !hasErrorPage;
    if (platform === 'twitter') {
        usable = usable && contentLength >= 40;
    } else if (platform === 'douyin') {
        const realContentLength = meaningfulLength(collectDouyinRealContent(entry, source));
        const hasIdentity = !!author || !!entry.cover_url || !!source.cover_url;
        const hasDirectMedia = hasUsableMediaUrl(source);
        usable = usable && (hasDirectMedia || (realContentLength >= 24 && (hasIdentity || realContentLength >= 80)));
        return {
            usable,
            needsBrowserCapture: !usable,
            reason: usable ? null : captureReason(platform, { hasErrorPage, hasParserError }),
            contentLength: realContentLength,
        };
    } else {
        const hasIdentity = !!author || !!entry.cover_url || !!source.cover_url;
        usable = usable && contentLength >= 24 && (hasIdentity || contentLength >= 80);
    }

    if (hasParserError && !hasRealTitle && contentLength < 24) usable = false;

    return {
        usable,
        needsBrowserCapture: !usable,
        reason: usable ? null : captureReason(platform, { hasErrorPage, hasParserError }),
        contentLength,
    };
}

function collectDouyinRealContent(entry, source) {
    const sharedText = cleanText(source.douyin_shared_text);
    return [
        source.full_text,
        source.fullText,
        source.subtitle_text,
        source.transcript_clean,
        source.transcript,
        source.description,
        entry.description,
    ]
        .map(cleanText)
        .filter(value => value && value !== sharedText)
        .join('\n');
}

function hasUsableMediaUrl(source) {
    const values = [
        source.video_url,
        source.videoUrl,
        source.play_addr,
        source.playAddr,
        ...(Array.isArray(source.media) ? source.media.map(item => item?.url) : []),
    ];
    return values.some(value => /^https?:\/\//i.test(String(value || '')));
}

function shouldQueueBrowserCapture(entry, url) {
    return assessParsedEntry(entry, url).needsBrowserCapture;
}

function supportsBrowserCapture(platform) {
    return BROWSER_CAPTURE_PLATFORMS.has(platform);
}

function captureReason(platform, details = {}) {
    const prefix = {
        douyin: '抖音',
        xiaohongshu: '小红书',
        zhihu: '知乎',
        twitter: 'X/Twitter',
        weibo: '微博',
    }[platform] || '该平台';
    if (details.hasErrorPage) return `${prefix}返回了登录页、错误页或已失效页面，需要浏览器登录态重新采集。`;
    if (details.hasParserError) return `${prefix}后端请求受限且没有拿到正文，需要浏览器登录态重新采集。`;
    return `${prefix}没有解析出足够的真实正文，需要浏览器登录态补全。`;
}

function collectContent(entry, source) {
    const values = [
        source.full_text,
        source.fullText,
        source.tweet_text,
        source.tweetText,
        source.subtitle_text,
        source.transcript_clean,
        source.transcript,
        source.description,
        source.zhihu_shared_text,
        source.douyin_shared_text,
        entry.description,
        entry.summary,
    ];
    return values.map(cleanText).filter(Boolean).join('\n');
}

function meaningfulLength(value) {
    return cleanText(value).replace(/[^\p{Script=Han}a-z0-9]/giu, '').length;
}

function cleanText(value) {
    return String(value || '').replace(/\s+/g, ' ').trim();
}

module.exports = {
    assessParsedEntry,
    shouldQueueBrowserCapture,
    supportsBrowserCapture,
};
