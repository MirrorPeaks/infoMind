const test = require('node:test');
const assert = require('node:assert/strict');
const axios = require('axios');

const { bilibiliParse } = require('../server/services/parser/bilibili');

test('follows b23.tv redirects before requesting Bilibili metadata', async () => {
    const originalGet = axios.get;
    const calls = [];
    axios.get = async url => {
        calls.push(url);
        if (url === 'https://b23.tv/example') {
            return {
                data: '',
                request: { res: { responseUrl: 'https://www.bilibili.com/video/BV1Example123/' } },
            };
        }
        if (url.includes('/x/web-interface/view?bvid=BV1Example123')) {
            return {
                data: {
                    code: 0,
                    data: {
                        title: '短链视频标题',
                        desc: '短链视频简介',
                        pic: 'https://example.com/cover.jpg',
                        bvid: 'BV1Example123',
                        aid: 1,
                        cid: 2,
                        duration: 30,
                        owner: { name: '测试作者', mid: 3 },
                        stat: {},
                    },
                },
            };
        }
        throw new Error(`unexpected request: ${url}`);
    };

    try {
        const result = await bilibiliParse('https://b23.tv/example');
        assert.equal(result.title, '短链视频标题');
        assert.equal(result.author, '测试作者');
        assert.equal(result.source_data.final_url, 'https://www.bilibili.com/video/BV1Example123/');
        assert.equal(calls.length, 2);
    } finally {
        axios.get = originalGet;
    }
});
