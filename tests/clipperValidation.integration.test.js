const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const testDir = fs.mkdtempSync(path.join(os.tmpdir(), 'infomind-clipper-test-'));
process.env.INFOMIND_DB_PATH = path.join(testDir, 'infomind.db');

const { startServer } = require('../server');
const queries = require('../server/db/queries');

test('clipper rejects an error page instead of creating a bad entry', async t => {
    const { server, port } = await startServer({ port: 0, host: '127.0.0.1', log: false });
    t.after(() => new Promise(resolve => server.close(resolve)));

    const pairingResponse = await fetch(`http://127.0.0.1:${port}/api/clipper/pairing`);
    const pairing = await pairingResponse.json();
    const url = 'https://www.xiaohongshu.com/explore/not-found-test';
    const job = queries.createCaptureJob({
        url,
        platform: 'xiaohongshu',
        source_channel: 'test',
        status: 'capturing',
    });

    const response = await fetch(`http://127.0.0.1:${port}/api/clipper/captures`, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            'X-InfoMind-Clipper-Token': pairing.data.token,
        },
        body: JSON.stringify({
            job_id: job.id,
            url,
            platform: 'xiaohongshu',
            title: '小红书 - 你访问的页面不见了',
            description: '页面不见了',
            full_text: '页面不见了',
            images: [],
            media: [],
        }),
    });
    const body = await response.json();

    assert.equal(response.status, 422);
    assert.equal(body.success, false);
    assert.equal(body.job_status, 'needs_user_action');
    assert.equal(queries.getCaptureJobById(job.id).status, 'needs_user_action');
    assert.equal(queries.getEntryByUrl(url), null);
});

test('clipper stores healthy browser captures for every restricted platform', async t => {
    const { server, port } = await startServer({ port: 0, host: '127.0.0.1', log: false });
    t.after(() => new Promise(resolve => server.close(resolve)));

    const pairingResponse = await fetch(`http://127.0.0.1:${port}/api/clipper/pairing`);
    const pairing = await pairingResponse.json();
    const fixtures = [
        ['douyin', 'https://www.douyin.com/video/clipper-test-1', '抖音视频正文', 'video'],
        ['xiaohongshu', 'https://www.xiaohongshu.com/explore/clipper-test-2', '小红书图文正文', 'note'],
        ['zhihu', 'https://www.zhihu.com/question/clipper-test-3', '知乎回答正文', 'article'],
        ['weibo', 'https://weibo.com/clipper-test-4', '微博长文正文', 'post'],
        ['twitter', 'https://x.com/infomind/status/1234567890123456789', 'X 帖子正文', 'post'],
    ];

    for (const [platform, url, title, contentType] of fixtures) {
        const fullText = `${title}包含足够的真实内容，用于验证作者、主题、事实线索、知识点和后续结构化解读都能正常入库。`.repeat(3);
        const response = await fetch(`http://127.0.0.1:${port}/api/clipper/captures`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'X-InfoMind-Clipper-Token': pairing.data.token,
            },
            body: JSON.stringify({
                url,
                platform,
                content_type: contentType,
                title,
                author: `${platform}作者`,
                description: fullText.slice(0, 100),
                full_text: fullText,
                images: [],
                media: [],
            }),
        });
        const body = await response.json();
        const entry = queries.getEntryByUrl(url);

        assert.equal(response.status, 201, `${platform}: ${JSON.stringify(body)}`);
        assert.equal(body.success, true);
        assert.equal(entry.platform, platform);
        assert.equal(entry.author, `${platform}作者`);
        assert.equal(entry.source_data.full_text, fullText);
    }
});
