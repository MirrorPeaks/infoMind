const test = require('node:test');
const assert = require('node:assert/strict');

const {
    extractTwitterStatusId,
    parseFxTwitterPayload,
} = require('../server/services/parser/twitter');

test('extractTwitterStatusId accepts x.com and twitter.com status URLs', () => {
    assert.equal(extractTwitterStatusId('https://x.com/example/status/2033674857309757502?s=20'), '2033674857309757502');
    assert.equal(extractTwitterStatusId('https://twitter.com/example/status/123456789'), '123456789');
    assert.equal(extractTwitterStatusId('https://x.com/example'), null);
});

test('FxTwitter payload preserves full text and direct video metadata', () => {
    const parsed = parseFxTwitterPayload({
        code: 200,
        status: {
            id: '2033674857309757502',
            url: 'https://x.com/XFreeze/status/2033674857309757502',
            text: 'A complete public post with enough real context for analysis.',
            created_at: 'Mon Mar 16 17:40:00 +0000 2026',
            author: {
                id: 'author-1',
                name: 'X Freeze',
                screen_name: 'XFreeze',
                url: 'https://x.com/XFreeze',
                avatar_url: 'https://pbs.twimg.com/profile.jpg',
            },
            media: {
                videos: [{
                    id: 'video-1',
                    type: 'video',
                    url: 'https://video.twimg.com/video/high.mp4',
                    thumbnail_url: 'https://pbs.twimg.com/thumb.jpg',
                    duration: 13.418,
                    width: 1592,
                    height: 888,
                    formats: [{ url: 'https://video.twimg.com/video/low.mp4', bitrate: 256000, container: 'mp4' }],
                }],
                photos: [],
                all: [],
            },
        },
    }, 'https://x.com/XFreeze/status/2033674857309757502');

    assert.equal(parsed.author, 'X Freeze');
    assert.equal(parsed.author_id, 'XFreeze');
    assert.equal(parsed.description, 'A complete public post with enough real context for analysis.');
    assert.equal(parsed.cover_url, 'https://pbs.twimg.com/thumb.jpg');
    assert.equal(parsed.source_data.content_type, 'video');
    assert.equal(parsed.source_data.video_url, 'https://video.twimg.com/video/high.mp4');
    assert.equal(parsed.source_data.media[0].duration, 13.418);
    assert.equal(parsed.source_data.content_source, 'fxtwitter');
});

test('FxTwitter photo post exposes its image as the cover', () => {
    const parsed = parseFxTwitterPayload({
        code: 200,
        status: {
            id: '1',
            text: 'Photo post',
            author: { name: 'Author', screen_name: 'author' },
            media: {
                videos: [],
                photos: [{ type: 'photo', url: 'https://pbs.twimg.com/photo.png', width: 1200, height: 900 }],
                all: [],
            },
        },
    }, 'https://x.com/author/status/1');

    assert.equal(parsed.cover_url, 'https://pbs.twimg.com/photo.png');
    assert.deepEqual(parsed.source_data.images, ['https://pbs.twimg.com/photo.png']);
    assert.equal(parsed.source_data.content_type, 'post');
});

test('invalid FxTwitter payload is rejected so the parser can fall back', () => {
    assert.equal(parseFxTwitterPayload({ code: 404, status: null }, 'https://x.com/a/status/1'), null);
});

test('FxTwitter title keeps a complete lead sentence instead of cutting at 100 characters', () => {
    const lead = '这是一条足够长的完整首句，用来说明帖子真正讨论的问题、背景、方法与最终结论，标题应在句号处自然结束而不是机械截断成半句话。';
    const parsed = parseFxTwitterPayload({
        code: 200,
        status: {
            id: '2',
            text: `${lead} 后面还有更多正文细节，这些内容应保留在 full_text 中。`,
            author: { name: 'Author', screen_name: 'author' },
            media: { videos: [], photos: [], all: [] },
        },
    }, 'https://x.com/author/status/2');

    assert.equal(parsed.title, lead);
    assert.match(parsed.source_data.full_text, /后面还有更多正文细节/);
});
