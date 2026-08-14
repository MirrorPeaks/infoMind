const test = require('node:test');
const assert = require('node:assert/strict');

const {
    getMissingTranscriptionTools,
    getYtDlpJavaScriptRuntime,
    isVideoEntry,
} = require('../server/services/videoTranscript');

test('direct media transcription does not require yt-dlp', () => {
    assert.deepEqual(getMissingTranscriptionTools({
        ytDlp: null,
        ffmpeg: '/opt/homebrew/bin/ffmpeg',
        whisper: '/opt/homebrew/bin/whisper-cli',
        modelExists: true,
        requireYtDlp: false,
    }), []);
});

test('page-only media transcription still reports yt-dlp as required', () => {
    assert.deepEqual(getMissingTranscriptionTools({
        ytDlp: null,
        ffmpeg: '/opt/homebrew/bin/ffmpeg',
        whisper: '/opt/homebrew/bin/whisper-cli',
        modelExists: true,
        requireYtDlp: true,
    }), ['yt-dlp']);
});

test('X entries with direct video metadata enter the local transcription path', () => {
    assert.equal(isVideoEntry({
        platform: 'twitter',
        url: 'https://x.com/example/status/123',
        source_data: {
            content_type: 'video',
            video_url: 'https://video.twimg.com/sample.mp4',
        },
    }), true);
});

test('browser-captured Weibo and Xiaohongshu videos use the same local transcription path', () => {
    for (const platform of ['weibo', 'xiaohongshu']) {
        assert.equal(isVideoEntry({
            platform,
            url: `https://example.com/${platform}/post`,
            source_data: {
                content_type: 'video',
                media: [{ type: 'video', url: 'https://media.example/post.mp4' }],
            },
        }), true);
    }
});

test('browser-captured image notes do not trigger local video transcription', () => {
    assert.equal(isVideoEntry({
        platform: 'xiaohongshu',
        url: 'https://www.xiaohongshu.com/explore/note',
        source_data: {
            content_type: 'note',
            images: ['https://media.example/note.jpg'],
        },
    }), false);
});

test('yt-dlp receives the current Node runtime for YouTube JavaScript challenges', () => {
    assert.equal(getYtDlpJavaScriptRuntime({
        execPath: '/Applications/InfoMind.app/Contents/MacOS/InfoMind',
        versions: { node: '22.22.3', electron: '31.7.7' },
        configured: '',
    }), 'node:/Applications/InfoMind.app/Contents/MacOS/InfoMind');
    assert.equal(getYtDlpJavaScriptRuntime({
        execPath: '/usr/local/bin/node',
        versions: { node: '22.22.3' },
        configured: 'deno:/opt/homebrew/bin/deno',
    }), 'deno:/opt/homebrew/bin/deno');
});
