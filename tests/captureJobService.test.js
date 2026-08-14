const test = require('node:test');
const assert = require('node:assert/strict');

const { upsertCaptureJob } = require('../server/services/captureJobService');

test('creates browser capture jobs for any supported restricted platform', () => {
    const calls = [];
    const repository = {
        findActiveCaptureJobByUrl: () => null,
        createCaptureJob: data => {
            calls.push(data);
            return { id: 'job-1', ...data };
        },
        updateCaptureJob: () => null,
    };

    const job = upsertCaptureJob(repository, 'https://www.zhihu.com/question/1', {
        platform: 'zhihu',
        source_channel: 'feishu',
        source_message: '请收录',
    });

    assert.equal(job.platform, 'zhihu');
    assert.equal(job.status, 'queued');
    assert.equal(calls.length, 1);
});

test('requeues a failed capture job instead of creating a duplicate', () => {
    const updates = [];
    const repository = {
        findActiveCaptureJobByUrl: () => ({ id: 'job-old', status: 'failed', platform: 'xiaohongshu' }),
        createCaptureJob: () => assert.fail('must not create a duplicate job'),
        updateCaptureJob: (id, data) => {
            updates.push({ id, data });
            return { id, platform: 'xiaohongshu', ...data };
        },
    };

    const job = upsertCaptureJob(repository, 'https://www.xiaohongshu.com/explore/1', {
        platform: 'xiaohongshu',
    });

    assert.equal(job.status, 'queued');
    assert.deepEqual(updates, [{ id: 'job-old', data: { status: 'queued', error: null } }]);
});

test('reuses an already queued capture job', () => {
    const existing = { id: 'job-active', status: 'queued', platform: 'douyin' };
    const repository = {
        findActiveCaptureJobByUrl: () => existing,
        createCaptureJob: () => assert.fail('must not create a duplicate job'),
        updateCaptureJob: () => assert.fail('must not update an active job'),
    };

    assert.equal(upsertCaptureJob(repository, 'https://v.douyin.com/1', { platform: 'douyin' }), existing);
});
