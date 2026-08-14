const test = require('node:test');
const assert = require('node:assert/strict');

const { detectPlatform } = require('../server/services/parser');

const cases = [
    ['https://www.bilibili.com/video/BV1xx411c7mD', 'bilibili'],
    ['https://b23.tv/AbCdEf1', 'bilibili'],
    ['https://youtu.be/dQw4w9WgXcQ', 'youtube'],
    ['https://www.youtube-nocookie.com/embed/dQw4w9WgXcQ', 'youtube'],
    ['https://x.com/example/status/123', 'twitter'],
    ['https://v.douyin.com/example/', 'douyin'],
    ['https://xhslink.com/a/example', 'xiaohongshu'],
    ['https://zhuanlan.zhihu.com/p/123', 'zhihu'],
    ['https://www.xiaoyuzhoufm.com/episode/example', 'xiaoyuzhou'],
    ['https://mp.weixin.qq.com/s/example', 'wechat'],
    ['https://weibo.com/123/example', 'weibo'],
];

for (const [url, expected] of cases) {
    test(`detects ${expected} links: ${url}`, () => {
        assert.equal(detectPlatform(url), expected);
    });
}
