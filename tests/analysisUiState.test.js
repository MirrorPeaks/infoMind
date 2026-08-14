const test = require('node:test');
const assert = require('node:assert/strict');

const {
    getAnalysisRefreshDelay,
    isRecoverableAnalysisFailure,
} = require('../public/js/modal');

test('analysis UI keeps checking a recoverable legacy format failure', () => {
    const analysis = {
        status: 'failed',
        error: '模型返回的解读格式不完整，已尝试自动修复但仍失败。请重试生成。',
    };

    assert.equal(isRecoverableAnalysisFailure(analysis), true);
    assert.ok(getAnalysisRefreshDelay(analysis) >= 1000);
});

test('analysis UI does not repeatedly poll permanent authentication failures', () => {
    const analysis = { status: 'failed', error: 'HTTP 401 Unauthorized' };

    assert.equal(isRecoverableAnalysisFailure(analysis), false);
    assert.equal(getAnalysisRefreshDelay(analysis), 0);
});

test('analysis UI polls active jobs and stops after success', () => {
    assert.equal(getAnalysisRefreshDelay({ status: 'processing' }), 1800);
    assert.equal(getAnalysisRefreshDelay({ status: 'done' }), 0);
});
