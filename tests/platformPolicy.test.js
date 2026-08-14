const test = require('node:test');
const assert = require('node:assert/strict');

const {
    assessParsedEntry,
    shouldQueueBrowserCapture,
} = require('../server/services/platformPolicy');

test('rejects Xiaohongshu not-found pages as unusable parser results', () => {
    const parsed = {
        platform: 'xiaohongshu',
        title: '小红书 - 你访问的页面不见了',
        description: '页面不见了',
        cover_url: 'https://example.com/error-cover.png',
        author: null,
        source_data: {},
    };

    const assessment = assessParsedEntry(parsed, 'https://www.xiaohongshu.com/explore/example');

    assert.equal(assessment.usable, false);
    assert.equal(shouldQueueBrowserCapture(parsed), true);
    assert.match(assessment.reason, /页面|正文|登录态/);
});

test('routes empty Zhihu responses with an HTTP error to browser capture', () => {
    const parsed = {
        platform: 'zhihu',
        title: '知乎内容',
        description: null,
        cover_url: null,
        author: null,
        source_data: { error: 'Request failed with status code 403' },
    };

    assert.equal(shouldQueueBrowserCapture(parsed), true);
});

test('routes empty Douyin metadata to browser capture', () => {
    const parsed = {
        platform: 'douyin',
        title: '抖音内容',
        description: null,
        cover_url: null,
        author: null,
        source_data: { content_type: 'video' },
    };

    assert.equal(shouldQueueBrowserCapture(parsed), true);
});

test('routes Douyin share-code text without real page content to browser capture', () => {
    const parsed = {
        platform: 'douyin',
        title: 'VibeCoding大赏｜用代码还原，世界上最震撼...',
        description: '【浙大猫学长的作品】VibeCoding大赏｜用代码还原，世界上最震撼... vfB:/ :7pm b@a.nd 09/16',
        author: '浙大猫学长',
        source_data: {
            content_type: 'video',
            douyin_shared_text: '【浙大猫学长的作品】VibeCoding大赏｜用代码还原，世界上最震撼... vfB:/ :7pm b@a.nd 09/16',
            final_url: 'https://www.douyin.com/video/7642345931534322985',
            video_url: null,
        },
    };

    assert.equal(shouldQueueBrowserCapture(parsed), true);
});

test('routes Weibo login shells to browser capture', () => {
    const parsed = {
        platform: 'weibo',
        title: '微博正文',
        description: '微博正文',
        cover_url: null,
        author: null,
        source_data: {},
    };

    assert.equal(shouldQueueBrowserCapture(parsed), true);
});

test('accepts a browser-enriched Weibo post with real text', () => {
    const parsed = {
        platform: 'weibo',
        title: '一条关于人工智能产业的长微博',
        description: '这条微博包含真实正文、作者信息以及足够的上下文，可用于分类与生成内容解读。',
        author: '示例作者',
        source_data: {
            full_text: '这条微博包含真实正文、作者信息以及足够的上下文，可用于分类与生成内容解读。',
            content_source: 'browser-extension',
        },
    };

    assert.equal(shouldQueueBrowserCapture(parsed), false);
});

test('accepts a public X post when real post text was extracted', () => {
    const parsed = {
        platform: 'twitter',
        title: 'A useful post about agent workflows',
        description: 'This post contains enough real text to support classification and interpretation.',
        author: 'Example Author',
        source_data: {
            full_text: 'This post contains enough real text to support classification and interpretation.',
            tweet_text: 'This post contains enough real text to support classification and interpretation.',
            content_type: 'post',
        },
    };

    const assessment = assessParsedEntry(parsed, 'https://x.com/example/status/123');

    assert.equal(assessment.usable, true);
    assert.equal(shouldQueueBrowserCapture(parsed), false);
});

test('accepts a browser-enriched Xiaohongshu note with real content', () => {
    const parsed = {
        platform: 'xiaohongshu',
        title: '真实笔记标题',
        description: '这是一段真实的小红书笔记正文，包含足够的信息用于分类和后续解读。',
        author: '真实作者',
        cover_url: 'https://sns-webpic-qc.xhscdn.com/example.jpg',
        source_data: {
            full_text: '这是一段真实的小红书笔记正文，包含足够的信息用于分类和后续解读。',
            content_source: 'browser-extension',
        },
    };

    assert.equal(shouldQueueBrowserCapture(parsed), false);
});
