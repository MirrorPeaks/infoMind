const test = require('node:test');
const assert = require('node:assert/strict');

const {
    getYtDlpReleaseAsset,
    isYtDlpVersionStale,
    parseExpectedChecksum,
} = require('../server/services/ytDlpManager');

test('selects the official yt-dlp release asset for desktop platforms', () => {
    assert.equal(getYtDlpReleaseAsset('darwin', 'arm64'), 'yt-dlp_macos');
    assert.equal(getYtDlpReleaseAsset('darwin', 'x64'), 'yt-dlp_macos');
    assert.equal(getYtDlpReleaseAsset('linux', 'x64'), 'yt-dlp_linux');
    assert.equal(getYtDlpReleaseAsset('linux', 'arm64'), 'yt-dlp_linux_aarch64');
    assert.equal(getYtDlpReleaseAsset('win32', 'x64'), null);
});

test('marks an old dated yt-dlp build as stale but keeps a recent build', () => {
    const now = new Date('2026-08-12T00:00:00Z');
    assert.equal(isYtDlpVersionStale('2025.10.14', now), true);
    assert.equal(isYtDlpVersionStale('2026.07.04', now), false);
    assert.equal(isYtDlpVersionStale('unknown', now), true);
});

test('reads an exact asset checksum from the official checksum manifest', () => {
    const manifest = [
        'aaa111  yt-dlp',
        'bbb222  yt-dlp_macos',
        'ccc333  yt-dlp_linux',
    ].join('\n');
    assert.equal(parseExpectedChecksum(manifest, 'yt-dlp_macos'), 'bbb222');
    assert.equal(parseExpectedChecksum(manifest, 'missing'), null);
});
