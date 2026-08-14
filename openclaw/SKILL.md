---
name: infomind
description: 个人知识管理系统 - 当用户发送链接并说“收录/收藏/保存/记一下/稍后看”等关键词时，自动收藏和管理网络内容链接（支持 YouTube、Bilibili、Twitter、小红书、知乎等主流平台）
---

## 添加链接到知识库

当用户消息同时包含 URL 链接和明确收藏意图时，直接调用此接口将链接添加到 InfoMind 知识库，不需要再次向用户确认。

明确收藏意图包括：

- 中文：收录、收藏、保存、记录、记一下、存一下、加入书架、稍后看
- 英文：save、collect、bookmark、remember、read later、add to knowledge base

示例：

- `收录 https://example.com/article`
- `帮我收藏这个 https://youtube.com/watch?v=...`
- `这个稍后看 https://...`
- `save this https://...`

如果一条消息里有多个 URL，并且带有收藏意图，逐个 URL 调用接口保存。

如果用户只是让你总结、阅读、解释某个 URL，但没有表达收藏意图，不要自动保存，除非上下文明显是在让你记录到 InfoMind。

## 抖音手机链接

当 URL 属于 `douyin.com`、`v.douyin.com` 或 `iesdouyin.com` 时，不要优先调用 `/api/entries`。抖音需要用户 Mac Chrome 中已有登录态，由 InfoMind Clipper 插件采集真实内容。

POST http://localhost:3456/api/capture-jobs
Content-Type: application/json

{
  "url": "{{用户提供的抖音URL}}",
  "platform": "douyin",
  "source_channel": "feishu",
  "source_message": "{{用户原始可见消息}}"
}

根据返回状态回复用户：

- `queued` / `opening` / `capturing`：已收到，正在让 Mac 上的 InfoMind Clipper 用浏览器登录态采集。
- `saved`：已收录。
- `needs_login`：需要先在 Mac Chrome 登录抖音，然后重试。
- `failed` / `needs_user_action`：采集失败或需要手动打开页面处理。

POST http://localhost:3456/api/entries
Content-Type: application/json

{
  "url": "{{用户提供的URL}}",
  "note": "{{用户的备注，没有就不传}}"
}

成功后，向用户说明已将内容收录到某个分类的书架中。如果接口返回 `URL already exists`，说明已经收藏过，直接告诉用户已在知识库中。

## 搜索知识库内容

当用户提问"我之前看的关于XXX的内容"、"帮我查一下XXX"等搜索类问题时，调用此接口。

GET http://localhost:3456/api/entries/search?q={{关键词}}

将搜索结果整理后告知用户。

## 查看特定分类内容

当用户要查看某个分类（如"AI"、"心理学"、"历史"）下的内容时，调用此接口。

GET http://localhost:3456/api/entries?category={{分类名}}&limit=10

常用分类：人工智能、计算机科学、心理学、哲学、历史、经济与金融、商业与管理、艺术与设计、影视与娱乐

## 查看知识库统计

当用户问"我收藏了多少内容"、"给我看统计"等时，调用此接口。

GET http://localhost:3456/api/stats

向用户汇报总条目数、书架数量、分类情况等。

## 深度内容解读与思维导图

InfoMind 负责保存结构化解读结果。Agent 只在需要时负责抓取真实正文、字幕或转录文本。

如果用户要求“深度解读/生成思维导图/分析这篇内容”，先检查：

GET http://localhost:3456/api/entries/{{entry_id}}/analysis

如果返回 `needs_content`，说明 InfoMind 只有标题、封面或简介，不能可信生成导图。此时需要：

1. 打开原文链接，提取真实正文、字幕、播客文稿或可见帖子正文。
2. 将内容写回：

PUT http://localhost:3456/api/entries/{{entry_id}}/content
Content-Type: application/json

{
  "full_text": "{{正文或帖子内容}}",
  "content_source": "agent"
}

视频/播客字幕使用：

{
  "transcript": "{{字幕或转录文本}}",
  "content_source": "agent-transcript"
}

3. 再触发：

POST http://localhost:3456/api/entries/{{entry_id}}/analyze
Content-Type: application/json

{
  "force": true
}

对于没有字幕的 Bilibili/YouTube 内容，也可以直接触发 InfoMind 内置的本地转写流水线：

POST http://localhost:3456/api/entries/{{entry_id}}/transcribe
Content-Type: application/json

{
  "force": true
}

不要把长视频或长播客的完整转录直接发给用户；写回 InfoMind，由 InfoMind 分段解读，控制 token 消耗。

对于 X/Twitter 帖子，如果 InfoMind 提示正文不足，使用浏览器读取真实可见帖子正文并写回 `full_text`。如果帖子附带视频且主要信息在视频里，优先提取可见字幕或整理一段简短转写写回 `transcript`，再触发解读。
