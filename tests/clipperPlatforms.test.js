const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const source = fs.readFileSync(
    path.join(__dirname, '..', 'extensions', 'web-extension', 'clipper-core.js'),
    'utf8'
);
const context = { window: {} };
vm.runInNewContext(source, context);

const detectPlatform = context.window.InfoMindClipper.detectPlatform;

const cases = [
    ['https://b23.tv/example', 'bilibili'],
    ['https://www.youtube-nocookie.com/embed/example', 'youtube'],
    ['https://www.xiaoyuzhoufm.com/episode/example', 'xiaoyuzhou'],
    ['https://weibo.com/123/example', 'weibo'],
    ['https://www.amemv.com/share/video/example', 'douyin'],
];

for (const [url, expected] of cases) {
    test(`clipper detects ${expected}: ${url}`, () => {
        assert.equal(typeof detectPlatform, 'function');
        assert.equal(detectPlatform(url), expected);
    });
}

function fakeNode(text = '', options = {}) {
    const children = options.children || {};
    return {
        innerText: text,
        textContent: text,
        tagName: options.tagName || 'DIV',
        currentSrc: options.currentSrc || '',
        src: options.src || '',
        poster: options.poster || '',
        duration: options.duration ?? NaN,
        naturalWidth: options.naturalWidth || 0,
        naturalHeight: options.naturalHeight || 0,
        content: options.content || '',
        href: options.href || '',
        querySelector(selector) {
            return findSelector(children, selector);
        },
        querySelectorAll(selector) {
            const value = children[selector];
            return Array.isArray(value) ? value : (value ? [value] : []);
        },
        matches(selector) {
            return (options.matches || []).includes(selector);
        },
        closest() {
            return options.closest || null;
        },
        getBoundingClientRect() {
            return { width: 320, height: 48 };
        },
    };
}

function findSelector(selectors, selector) {
    if (selectors[selector]) return selectors[selector];
    for (const part of selector.split(',').map(item => item.trim())) {
        if (selectors[part]) return selectors[part];
    }
    return null;
}

function collectFixture({ url, title = '', selectors = {}, media = [], images = [] }) {
    const body = fakeNode('');
    const document = {
        title,
        body,
        images,
        querySelector(selector) {
            return findSelector(selectors, selector);
        },
        querySelectorAll(selector) {
            if (selector === 'video, audio, source') return media;
            return [];
        },
        createTreeWalker() {
            return { currentNode: null, nextNode: () => false };
        },
    };
    const parsedUrl = new URL(url);
    const fixtureContext = {
        window: {},
        document,
        location: { href: parsedUrl.href, pathname: parsedUrl.pathname },
        URL,
        Date,
        NodeFilter: { SHOW_TEXT: 4, FILTER_REJECT: 2, FILTER_ACCEPT: 1 },
    };
    vm.runInNewContext(source, fixtureContext);
    return fixtureContext.window.InfoMindClipper.collect();
}

test('clipper extracts a Douyin video as real content instead of a generic page shell', () => {
    const video = fakeNode('', {
        tagName: 'VIDEO',
        currentSrc: 'https://video.example/douyin.mp4',
        poster: 'https://img.example/douyin-cover.jpg',
        duration: 48,
    });
    const data = collectFixture({
        url: 'https://www.douyin.com/video/123',
        title: '抖音视频 - 抖音',
        media: [video],
        selectors: {
            '[data-e2e="detail-video-info"]': fakeNode('AI 创业团队如何建立高密度人才组织，并用真实案例解释招聘与协作方法。'),
            '[data-e2e="user-info"] [class*="name"]': fakeNode('组织观察员'),
            video,
        },
    });

    assert.equal(data.platform, 'douyin');
    assert.equal(data.content_type, 'video');
    assert.equal(data.author, '组织观察员');
    assert.match(data.full_text, /高密度人才组织/);
    assert.equal(data.media[0].url, 'https://video.example/douyin.mp4');
});

test('clipper distinguishes a Douyin image note from video', () => {
    const images = [
        fakeNode('', { tagName: 'IMG', src: 'https://img.example/1.jpg', naturalWidth: 1200, naturalHeight: 1600 }),
        fakeNode('', { tagName: 'IMG', src: 'https://img.example/2.jpg', naturalWidth: 1200, naturalHeight: 1600 }),
    ];
    const data = collectFixture({
        url: 'https://www.douyin.com/note/456',
        title: '图文笔记 - 抖音',
        images,
        selectors: {
            '[data-e2e="detail-desc"]': fakeNode('这是一篇图文笔记，完整梳理产品验证、用户访谈、数据复盘和下一步迭代方法，正文足够用于可信解读。'),
            '[data-e2e="detail-author"]': fakeNode('产品手记'),
        },
    });

    assert.equal(data.content_type, 'note');
    assert.equal(data.images.length, 2);
    assert.match(data.full_text, /用户访谈/);
});

test('clipper extracts Xiaohongshu title, author, body and cover', () => {
    const cover = fakeNode('', { tagName: 'IMG', src: 'https://img.example/xhs.jpg', naturalWidth: 1080, naturalHeight: 1440 });
    const noteRoot = fakeNode('', { children: { img: cover } });
    const data = collectFixture({
        url: 'https://www.xiaohongshu.com/explore/abc',
        title: '小红书页面',
        images: [cover],
        selectors: {
            '#detail-title': fakeNode('如何用 AI 建立个人知识系统'),
            '[class*="author"] [class*="name"]': fakeNode('一个人的AI冒险'),
            '#detail-desc': fakeNode('从采集、分类、阅读到复盘，逐步解释个人知识系统的真实工作流与常见误区。'),
            '#noteContainer': noteRoot,
        },
    });

    assert.equal(data.title, '如何用 AI 建立个人知识系统');
    assert.equal(data.author, '一个人的AI冒险');
    assert.match(data.full_text, /真实工作流/);
    assert.equal(data.cover_url, 'https://img.example/xhs.jpg');
});

test('clipper extracts Zhihu article body and author', () => {
    const data = collectFixture({
        url: 'https://www.zhihu.com/question/1/answer/2',
        title: '知乎',
        selectors: {
            'h1.QuestionHeader-title': fakeNode('假如 LLM 无限上下文了，RAG 还有意义吗？'),
            '.AuthorInfo-name': fakeNode('知识工程师'),
            '.RichContent-inner': fakeNode('无限上下文并不会消除检索增强的价值，因为成本、时效性、可解释性与权限边界仍然存在。本文逐项分析这些约束。'),
        },
    });

    assert.equal(data.platform, 'zhihu');
    assert.equal(data.author, '知识工程师');
    assert.match(data.full_text, /检索增强/);
});

test('clipper extracts Weibo post text and author', () => {
    const postRoot = fakeNode('', {
        children: {
            '[class*="detail_wbtext"]': fakeNode('这是一条关于 AI 产品落地的长微博，包含用户需求、工程约束和商业化节奏三个核心判断。'),
            '[class*="head_name"]': fakeNode('产品研究所'),
        },
    });
    const data = collectFixture({
        url: 'https://weibo.com/123/abc',
        title: '微博',
        selectors: { article: postRoot },
    });

    assert.equal(data.platform, 'weibo');
    assert.equal(data.author, '产品研究所');
    assert.match(data.full_text, /工程约束/);
});

test('clipper marks an attached Weibo video for local transcription', () => {
    const video = fakeNode('', {
        tagName: 'VIDEO',
        currentSrc: 'https://video.weibo.example/post.mp4',
        poster: 'https://img.weibo.example/post.jpg',
        duration: 72,
    });
    const postRoot = fakeNode('', {
        children: {
            '[class*="detail_wbtext"]': fakeNode('微博视频介绍了一项新的 AI 产品实验。'),
            '[class*="head_name"]': fakeNode('产品研究所'),
            video,
        },
    });
    const data = collectFixture({
        url: 'https://weibo.com/123/video-post',
        title: '微博',
        media: [video],
        selectors: { article: postRoot, video },
    });

    assert.equal(data.content_type, 'video');
    assert.equal(data.media[0].url, 'https://video.weibo.example/post.mp4');
});

test('clipper preserves X display name and recognizes an attached video', () => {
    const video = fakeNode('', {
        tagName: 'VIDEO',
        currentSrc: 'https://video.twimg.com/sample.mp4',
        poster: 'https://pbs.twimg.com/thumb.jpg',
        duration: 13,
    });
    const tweetRoot = fakeNode('', {
        matches: ['article'],
        children: {
            '[data-testid="tweetText"]': fakeNode('完整帖子正文：这段视频展示了新一代推进器的静态点火测试，并解释了关键工程改进。'),
            '[data-testid="User-Name"]': fakeNode('X Freeze\n@XFreeze\n· Follow'),
            video,
        },
    });
    const data = collectFixture({
        url: 'https://x.com/XFreeze/status/123',
        title: 'X',
        media: [video],
        selectors: { 'article[data-testid="tweet"]': tweetRoot, 'article video': video, video },
    });

    assert.equal(data.content_type, 'video');
    assert.equal(data.author, 'X Freeze @XFreeze');
    assert.match(data.full_text, /推进器/);
    assert.equal(data.media[0].url, 'https://video.twimg.com/sample.mp4');
});
