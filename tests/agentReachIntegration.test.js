const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const {
    canUseTwitterCli,
    canUseXhsCli,
} = require('../server/services/agentReach');

test('Twitter CLI requires explicit Cookie-Editor credentials', () => {
    assert.equal(canUseTwitterCli({}), false);
    assert.equal(canUseTwitterCli({ TWITTER_AUTH_TOKEN: 'auth-only' }), false);
    assert.equal(canUseTwitterCli({ TWITTER_AUTH_TOKEN: 'auth', TWITTER_CT0: 'ct0' }), true);
});

test('legacy xhs-cli requires explicit InfoMind opt-in', () => {
    assert.equal(canUseXhsCli({}), false);
    assert.equal(canUseXhsCli({ INFOMIND_AGENT_REACH_XHS: '0' }), false);
    assert.equal(canUseXhsCli({ INFOMIND_AGENT_REACH_XHS: '1' }), true);
});

test('Bilibili parser does not route through yt-dlp metadata', () => {
    const source = fs.readFileSync(path.join(__dirname, '..', 'server', 'services', 'parser', 'bilibili.js'), 'utf8');
    assert.doesNotMatch(source, /readSocialUrl/);
});

test('Douyin parser uses browser capture instead of an unsupported Agent-Reach channel', () => {
    const source = fs.readFileSync(path.join(__dirname, '..', 'server', 'services', 'parser', 'douyin.js'), 'utf8');
    assert.doesNotMatch(source, /readSocialUrl/);
});
