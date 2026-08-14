---
name: infomind
description: InfoMind 个人知识库，适用于终端主 channel、飞书/Lark channel 和其他 Hermes gateway channel。用户发送链接并说“收录、收藏、保存、记录、记一下、存一下、加入书架、稍后看”时，自动把 URL 保存到 InfoMind；也支持搜索已收录内容、读取书架、查看统计和生成阅读计划。Also triggers on save, collect, bookmark, remember, read later.
---

# InfoMind Personal Knowledge Skill

Use this skill when the user wants to save a URL, search previously saved content, review the bookshelf, or plan daily reading.

Important: if a user message contains a URL plus any collection keyword such as `收录`, `收藏`, `保存`, `记录`, `记一下`, `存一下`, `加入书架`, or `稍后看`, this skill must be used to save the URL to InfoMind.

This applies in every Agent channel, including terminal/main channel, Feishu/Lark group chats, Feishu/Lark direct messages, and any Hermes gateway channel. Bot mentions, group chat prefixes, Feishu rich-text formatting, quoted text, or link preview formatting must not prevent using this skill when the visible message contains a URL and collection intent.

## Configuration

Read the InfoMind base URL from `INFOMIND_BASE_URL`. If it is not set, use `http://127.0.0.1:3456`.

## Auto Save Trigger

When a user message contains at least one URL and an explicit collection intent, save the URL to InfoMind immediately. Do not ask for confirmation.

Collection intent includes Chinese phrases such as:

- 收录
- 收藏
- 保存
- 记录
- 记一下
- 加入书架
- 稍后看
- 存一下

Collection intent also includes English phrases such as:

- save
- collect
- bookmark
- remember
- read later
- add to knowledge base

Examples that should save automatically:

- `收录 https://example.com/article`
- `帮我收藏这个 https://youtube.com/watch?v=...`
- `这个稍后看 https://...`
- `save this https://...`

If the user sends multiple URLs with a collection intent, save each URL separately.

If the user sends a URL without collection intent, only save it when the surrounding request clearly means collection. For example, save for "这个不错，记一下 <URL>", but do not save for "帮我总结这个 <URL>" unless the user also asks to save it.

### Douyin Mobile Links

For Douyin URLs (`douyin.com`, `v.douyin.com`, `iesdouyin.com`), do not call `/api/entries` first. Douyin needs the user's logged-in Chrome session. Create a browser capture job instead:

```bash
curl -s -X POST "$INFOMIND_BASE_URL/api/capture-jobs" \
  -H "Content-Type: application/json" \
  -d '{"url":"<URL>","platform":"douyin","source_channel":"feishu","source_message":"<original visible message>"}'
```

Tell the user:

- `queued`, `opening`, `capturing`: 已收到，正在让 Mac 上的 InfoMind Clipper 用浏览器登录态采集。
- `saved`: 已收录。
- `needs_login`: 需要先在 Mac Chrome 登录抖音，然后重试。
- `failed` or `needs_user_action`: 采集失败或需要手动打开页面处理。

## Save a Link

For each URL that should be saved, call:

```bash
curl -s -X POST "$INFOMIND_BASE_URL/api/entries" \
  -H "Content-Type: application/json" \
  -d '{"url":"<URL>","note":"<optional user note>"}'
```

Put any user-provided note or surrounding context into `note` when useful. Tell the user the saved title, category, and whether it was already present. If InfoMind returns `URL already exists`, treat that as already saved and tell the user it was already in the knowledge base.

## Search Saved Knowledge

When the user asks about previously saved material:

```bash
curl -s "$INFOMIND_BASE_URL/api/entries/search?q=<keyword>&limit=10"
```

Summarize the most relevant matches with title, author, category, and URL.

## Daily Reading Plan

When the user asks for a daily reading plan:

1. Fetch overview stats:

```bash
curl -s "$INFOMIND_BASE_URL/api/stats"
```

2. Fetch recent entries:

```bash
curl -s "$INFOMIND_BASE_URL/api/entries?limit=20"
```

3. Select 3 to 5 items:
   - Prefer recently saved unread-looking material.
   - Balance categories when possible.
   - Group short items before long videos.
   - Include a concrete reading order and a short reason for each item.

## Book Management

When the user asks to inspect authors, books, or shelves:

```bash
curl -s "$INFOMIND_BASE_URL/api/books?limit=20"
```

For a specific book:

```bash
curl -s "$INFOMIND_BASE_URL/api/books/<book_id>"
```

Use book entries to suggest what to read next or summarize a creator's saved material.

## Deep Content Capture for Mind Maps

InfoMind owns durable analysis results. Hermes should act as the optional capture worker when InfoMind says an entry needs more content.

When the user asks to deeply analyze a saved entry, or InfoMind returns `status: "needs_content"` from:

```bash
curl -s "$INFOMIND_BASE_URL/api/entries/<entry_id>/analysis"
```

do this:

1. Open or fetch the original URL using the best available Hermes/browser capability.
2. Extract real content, not just title metadata:
   - blogs/articles: main article body
   - videos: captions/transcript when available; InfoMind can also trigger local whisper.cpp transcription when captions are missing
   - podcasts: transcript/show notes when available; otherwise ask before doing audio transcription
   - 小红书/知乎/X/Twitter/dynamic pages: browser-visible正文, OCR text if relevant and available
   - X/Twitter videos: visible post text first; if the video carries the main information, extract captions/transcript or write a short human/Agent transcript back
3. Write the extracted content back to InfoMind:

```bash
curl -s -X PUT "$INFOMIND_BASE_URL/api/entries/<entry_id>/content" \
  -H "Content-Type: application/json" \
  -d '{"full_text":"<extracted article body or transcript>","content_source":"hermes"}'
```

For audio/video transcript, use:

```bash
curl -s -X PUT "$INFOMIND_BASE_URL/api/entries/<entry_id>/content" \
  -H "Content-Type: application/json" \
  -d '{"transcript":"<caption or transcript text>","content_source":"hermes-transcript"}'
```

4. Trigger structured analysis. InfoMind runs this in the background and reports progress from the analysis endpoint:

```bash
curl -s -X POST "$INFOMIND_BASE_URL/api/entries/<entry_id>/analyze" \
  -H "Content-Type: application/json" \
  -d '{"force":true}'
```

For Bilibili/YouTube entries without captions, explicitly trigger the same local transcription pipeline:

```bash
curl -s -X POST "$INFOMIND_BASE_URL/api/entries/<entry_id>/transcribe" \
  -H "Content-Type: application/json" \
  -d '{"force":true}'
```

Important token policy:

- Do not paste a full long video transcript into the chat response.
- Prefer writing transcript/content to InfoMind, then let InfoMind run its chunked analysis pipeline.
- For long videos or podcasts without captions, prefer InfoMind's background transcription endpoint when the local Whisper model is enabled.
