const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const backgroundPath = path.join(__dirname, '..', 'extensions', 'web-extension', 'background.js');
const popupPath = path.join(__dirname, '..', 'extensions', 'web-extension', 'popup.js');

test('browser extension polls pending capture jobs across all supported platforms', () => {
    const source = fs.readFileSync(backgroundPath, 'utf8');

    assert.match(source, /\/api\/capture-jobs\/pending\?limit=/);
    assert.doesNotMatch(source, /pending\?platform=douyin/);
});

test('browser extension status copy describes cross-platform jobs', () => {
    const source = fs.readFileSync(popupPath, 'utf8');

    assert.doesNotMatch(source, /待处理抖音任务/);
    assert.doesNotMatch(source, /抖音任务/);
    assert.match(source, /待处理采集任务/);
});

test('browser extension preserves actionable server job states', () => {
    const source = fs.readFileSync(backgroundPath, 'utf8');

    assert.match(source, /err\.jobStatus \|\| 'failed'/);
    assert.match(source, /error\.jobStatus = json\.job_status/);
});
