(function () {
  function collectPage() {
    const url = location.href;
    const platform = detectPlatform(url);
    const meta = collectMeta();
    const platformData = collectPlatformData(platform);
    const title = firstText(platformData.title, meta.ogTitle, meta.twitterTitle, document.title);
    const author = firstText(platformData.author, meta.author, meta.siteName);
    const description = firstText(platformData.description, meta.description, meta.ogDescription, visibleText({ max: 260 }));
    const fullText = normalizeLongText(firstText(platformData.fullText, articleText(), visibleText({ max: 12000 })));
    const subtitleText = normalizeLongText(firstText(platformData.subtitleText, collectVisibleCaptions()));
    const images = uniqueUrls([platformData.coverUrl, meta.ogImage, meta.twitterImage].concat(collectImages()));
    const media = uniqueMedia(collectMedia(platform));
    const contentType = detectContentType(platform, media, subtitleText, images, fullText);

    return {
      source: 'infomind-extension',
      url,
      canonical_url: canonicalUrl() || url,
      platform,
      content_type: contentType,
      title,
      author,
      description,
      cover_url: platformData.coverUrl || meta.ogImage || meta.twitterImage || images[0] || null,
      full_text: fullText,
      subtitle_text: subtitleText,
      images,
      media,
      captured_at: new Date().toISOString(),
    };
  }

  function collectMeta() {
    return {
      ogTitle: meta('property', 'og:title'),
      ogDescription: meta('property', 'og:description'),
      ogImage: absolutize(meta('property', 'og:image')),
      twitterTitle: meta('name', 'twitter:title'),
      twitterImage: absolutize(meta('name', 'twitter:image') || meta('name', 'twitter:image:src')),
      description: meta('name', 'description'),
      author: meta('name', 'author') || meta('property', 'article:author'),
      siteName: meta('property', 'og:site_name'),
    };
  }

  function collectPlatformData(platform) {
    if (platform === 'douyin') return collectDouyin();
    if (platform === 'xiaohongshu') return collectXiaohongshu();
    if (platform === 'zhihu') return collectZhihu();
    if (platform === 'bilibili') return collectBilibili();
    if (platform === 'youtube') return collectYoutube();
    if (platform === 'twitter') return collectTwitter();
    if (platform === 'xiaoyuzhou') return collectXiaoyuzhou();
    if (platform === 'weibo') return collectWeibo();
    return {};
  }

  function collectDouyin() {
    const selectors = [
      '[data-e2e="detail-video-info"]',
      '[data-e2e="video-desc"]',
      '[data-e2e="detail-desc"]',
      '[class*="note"]',
      '[class*="desc"]',
    ];
    return {
      title: queryText(selectors) || document.title.replace(/ - 抖音$/, ''),
      author: queryText(['[data-e2e="user-info"] [class*="name"]', '[class*="author"] [class*="name"]', '[data-e2e="detail-author"]']),
      description: queryText(selectors),
      fullText: queryText(selectors.concat(['main', 'body']), 9000),
      coverUrl: findImageNear(['video', '[data-e2e*="detail"]']) || null,
    };
  }

  function collectXiaohongshu() {
    return {
      title: queryText(['#detail-title', '[class*="title"]']),
      author: queryText(['[class*="author"] [class*="name"]', '[class*="user"] [class*="name"]']),
      description: queryText(['#detail-desc', '[class*="desc"]', '[class*="content"]'], 9000),
      fullText: queryText(['#detail-desc', '[class*="desc"]', '[class*="content"]', 'main'], 9000),
      coverUrl: findImageNear(['#noteContainer', 'main']) || null,
    };
  }

  function collectZhihu() {
    return {
      title: queryText(['h1.QuestionHeader-title', '.Post-Title', 'h1']),
      author: queryText(['.AuthorInfo-name', '[class*="AuthorInfo"] [class*="name"]']),
      description: queryText(['.RichContent-inner', '.Post-RichText', 'article'], 12000),
      fullText: queryText(['.RichContent-inner', '.Post-RichText', 'article', 'main'], 12000),
    };
  }

  function collectBilibili() {
    return {
      title: queryText(['h1.video-title', '.video-title', 'h1']) || document.title,
      author: queryText(['.up-name', '.username', '[class*="up-info"] [class*="name"]']),
      description: queryText(['.desc-info-text', '.video-desc-container', '[class*="desc"]'], 5000),
      subtitleText: collectVisibleCaptions(),
      coverUrl: findImageNear(['.video-container', '#bilibili-player', 'main']) || null,
    };
  }

  function collectYoutube() {
    return {
      title: queryText(['h1.ytd-watch-metadata', 'h1.title', 'h1']) || document.title,
      author: queryText(['#channel-name #text', 'ytd-channel-name #text']),
      description: queryText(['#description-inline-expander', '#description', 'ytd-watch-metadata'], 5000),
      subtitleText: collectVisibleCaptions(),
      coverUrl: youtubeCover(location.href),
    };
  }

  function collectTwitter() {
    const tweetRoot = findTweetRoot();
    const tweetText = queryTextWithin(tweetRoot, ['[data-testid="tweetText"]', '[lang]', 'article'], 12000);
    const authorText = queryTextWithin(tweetRoot, ['[data-testid="User-Name"]', '[data-testid="UserName"]'], 240);
    const author = cleanTwitterAuthor(authorText) || twitterHandleFromUrl();
    const video = tweetRoot?.querySelector?.('video') || document.querySelector('article video, video');
    const coverUrl = video?.poster ? absolutize(video.poster) : findImageNear(['article [data-testid="tweetPhoto"]', 'article', 'main']);

    return {
      title: tweetText ? tweetText.slice(0, 100) : document.title.replace(/\s*\/\s*X$/, ''),
      author,
      description: tweetText,
      fullText: tweetText || queryTextWithin(tweetRoot, ['article', 'main'], 12000),
      subtitleText: collectVisibleCaptions(),
      coverUrl,
    };
  }

  function collectXiaoyuzhou() {
    return {
      title: queryText(['h1', '[class*="episode-title"]', '[class*="title"]']) || document.title,
      author: queryText(['[class*="podcast-title"]', '[class*="podcast-name"]', '[class*="author"]']),
      description: queryText(['[class*="description"]', '[class*="shownotes"]', 'main'], 12000),
      fullText: queryText(['[class*="description"]', '[class*="shownotes"]', 'main'], 12000),
      coverUrl: findImageNear(['main', '[class*="episode"]', '[class*="podcast"]']) || null,
    };
  }

  function collectWeibo() {
    const postRoot = document.querySelector('article, [class*="Feed_detail"], [class*="detail_wbtext"]') || document.querySelector('main');
    const postText = queryTextWithin(postRoot, [
      '[class*="detail_wbtext"]',
      '[node-type="feed_list_content"]',
      '[class*="wbpro-feed-content"]',
      'article',
    ], 12000);
    return {
      title: postText ? postText.slice(0, 100) : document.title.replace(/\s*-\s*微博$/, ''),
      author: queryTextWithin(postRoot, [
        '[class*="head_name"]',
        '[class*="woo-font--semibold"]',
        'a[href*="/u/"]',
      ], 200),
      description: postText,
      fullText: postText,
      coverUrl: findImageNear(['article', '[class*="Feed_detail"]', 'main']) || null,
    };
  }

  function detectPlatform(url) {
    const value = String(url).toLowerCase();
    if (value.includes('douyin.com') || value.includes('iesdouyin.com') || value.includes('amemv.com')) return 'douyin';
    if (value.includes('xiaohongshu.com') || value.includes('xhslink.com')) return 'xiaohongshu';
    if (value.includes('zhihu.com')) return 'zhihu';
    if (value.includes('bilibili.com') || value.includes('b23.tv')) return 'bilibili';
    if (value.includes('youtube.com') || value.includes('youtu.be') || value.includes('youtube-nocookie.com')) return 'youtube';
    if (value.includes('mp.weixin.qq.com')) return 'wechat';
    if (value.includes('x.com') || value.includes('twitter.com')) return 'twitter';
    if (value.includes('xiaoyuzhoufm.com') || value.includes('xiaoyuzhou.com')) return 'xiaoyuzhou';
    if (value.includes('weibo.com')) return 'weibo';
    return 'web';
  }

  function detectContentType(platform, media, subtitleText, images, fullText) {
    const hasVideo = media.some(item => item.type === 'video' || /\.m3u8(?:\?|$)|\.mp4(?:\?|$)/i.test(item.url || ''))
      || !!document.querySelector('video');
    if (platform === 'youtube' || platform === 'bilibili') return 'video';
    if (platform === 'douyin') {
      if (hasVideo || subtitleText) return 'video';
      if (images.length > 1 || fullText.length > 80) return 'note';
      return 'unknown';
    }
    if (platform === 'xiaohongshu') return hasVideo ? 'video' : 'note';
    if (platform === 'twitter') return hasVideo ? 'video' : 'post';
    if (platform === 'weibo') return hasVideo ? 'video' : 'post';
    if (platform === 'xiaoyuzhou') return 'audio';
    return document.querySelector('article') ? 'article' : 'article';
  }

  function collectMedia(platform) {
    const media = Array.from(document.querySelectorAll('video, audio, source')).map(node => ({
      url: absolutize(node.currentSrc || node.src),
      type: node.tagName.toLowerCase() === 'audio' ? 'audio' : 'video',
      duration: Number.isFinite(node.duration) ? Math.round(node.duration) : null,
      poster: node.poster ? absolutize(node.poster) : null,
      platform,
    })).filter(item => item.url);
    return media;
  }

  function collectVisibleCaptions() {
    return queryText([
      '.ytp-caption-segment',
      '.bpx-player-subtitle-panel-text',
      '[class*="subtitle"]',
      '[class*="caption"]',
      '[data-testid*="caption"]',
      '[aria-live="polite"]',
    ], 6000);
  }

  function articleText() {
    return queryText(['article', '[role="article"]', 'main'], 12000);
  }

  function visibleText({ max = 8000 } = {}) {
    const ignored = new Set(['SCRIPT', 'STYLE', 'NOSCRIPT', 'SVG', 'CANVAS']);
    const parts = [];
    const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT, {
      acceptNode(node) {
        const parent = node.parentElement;
        if (!parent || ignored.has(parent.tagName)) return NodeFilter.FILTER_REJECT;
        const text = normalizeText(node.textContent);
        if (!text || text.length < 2) return NodeFilter.FILTER_REJECT;
        const rect = parent.getBoundingClientRect();
        if (rect.width === 0 || rect.height === 0) return NodeFilter.FILTER_REJECT;
        return NodeFilter.FILTER_ACCEPT;
      },
    });
    while (walker.nextNode() && parts.join('\n').length < max) {
      parts.push(normalizeText(walker.currentNode.textContent));
    }
    return parts.join('\n').slice(0, max);
  }

  function collectImages() {
    return Array.from(document.images)
      .filter(img => img.naturalWidth >= 120 && img.naturalHeight >= 120)
      .sort((a, b) => (b.naturalWidth * b.naturalHeight) - (a.naturalWidth * a.naturalHeight))
      .map(img => absolutize(img.currentSrc || img.src))
      .filter(Boolean)
      .slice(0, 16);
  }

  function findImageNear(selectors) {
    for (const selector of selectors) {
      const root = document.querySelector(selector);
      const image = root?.querySelector?.('img');
      const src = image && (image.currentSrc || image.src);
      if (src) return absolutize(src);
    }
    return null;
  }

  function queryText(selectors, max = 300) {
    for (const selector of selectors) {
      const node = document.querySelector(selector);
      const text = normalizeText(node?.innerText || node?.textContent || '');
      if (text) return text.slice(0, max);
    }
    return '';
  }

  function queryTextWithin(root, selectors, max = 300) {
    if (!root) return queryText(selectors, max);
    for (const selector of selectors) {
      const node = root.matches?.(selector) ? root : root.querySelector?.(selector);
      const text = normalizeText(node?.innerText || node?.textContent || '');
      if (text) return text.slice(0, max);
    }
    return '';
  }

  function findTweetRoot() {
    const article = document.querySelector('article[data-testid="tweet"], article');
    if (article) return article;
    const text = document.querySelector('[data-testid="tweetText"]');
    return text?.closest?.('article') || document.querySelector('main') || document.body;
  }

  function cleanTwitterAuthor(value) {
    const lines = normalizeText(value).split('\n').map(line => line.trim()).filter(Boolean);
    const handle = lines.find(line => /^@[\w_]+$/.test(line));
    const display = lines.find(line => line && !/^@/.test(line) && !/·|Follow|关注/.test(line));
    return display && handle ? `${display} ${handle}` : (display || handle || '');
  }

  function twitterHandleFromUrl() {
    const match = location.pathname.match(/^\/([^/]+)\/status\//);
    return match ? `@${match[1]}` : '';
  }

  function meta(attr, value) {
    return document.querySelector(`meta[${attr}="${value}"]`)?.content || '';
  }

  function canonicalUrl() {
    return absolutize(document.querySelector('link[rel="canonical"]')?.href || '');
  }

  function youtubeCover(url) {
    const id = url.match(/[?&]v=([^&]+)/)?.[1] || url.match(/youtu\.be\/([^?]+)/)?.[1];
    return id ? `https://i.ytimg.com/vi/${id}/hqdefault.jpg` : null;
  }

  function firstText(...values) {
    for (const value of values) {
      const text = normalizeText(value);
      if (text) return text;
    }
    return '';
  }

  function normalizeText(value) {
    return String(value || '').replace(/\u00a0/g, ' ').replace(/[ \t]+/g, ' ').replace(/\n{3,}/g, '\n\n').trim();
  }

  function normalizeLongText(value) {
    return normalizeText(value).slice(0, 12000);
  }

  function absolutize(url) {
    try {
      if (!url) return null;
      return new URL(url, location.href).href;
    } catch {
      return null;
    }
  }

  function uniqueUrls(urls) {
    return Array.from(new Set(urls.filter(Boolean))).slice(0, 20);
  }

  function uniqueMedia(media) {
    const seen = new Set();
    return media.filter(item => {
      if (!item.url || seen.has(item.url)) return false;
      seen.add(item.url);
      return true;
    });
  }

  window.InfoMindClipper = { collect: collectPage, detectPlatform };

  if (typeof chrome !== 'undefined' && chrome.runtime?.onMessage) {
    chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
      if (message?.type !== 'INFOMIND_COLLECT_PAGE') return false;
      try {
        sendResponse({ ok: true, data: collectPage() });
      } catch (err) {
        sendResponse({ ok: false, error: err.message });
      }
      return true;
    });
  }
})();
