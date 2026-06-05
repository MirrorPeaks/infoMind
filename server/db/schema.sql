-- InfoMind Database Schema

-- 分类表（预置25个行业分类）
CREATE TABLE IF NOT EXISTS categories (
    id          TEXT PRIMARY KEY,
    name        TEXT NOT NULL UNIQUE,
    name_en     TEXT NOT NULL,
    icon        TEXT NOT NULL,
    color       TEXT NOT NULL DEFAULT '#6b7280',
    sort_order  INTEGER DEFAULT 0
);

-- "书"表（同作者内容聚合）
CREATE TABLE IF NOT EXISTS books (
    id          TEXT PRIMARY KEY,
    author      TEXT NOT NULL,
    author_id   TEXT,
    platform    TEXT NOT NULL,
    category    TEXT NOT NULL,
    title       TEXT,
    cover_url   TEXT,
    cover_local TEXT,
    entry_count INTEGER DEFAULT 1,
    created_at  DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at  DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- 内容条目表
CREATE TABLE IF NOT EXISTS entries (
    id           TEXT PRIMARY KEY,
    url          TEXT NOT NULL UNIQUE,
    platform     TEXT NOT NULL,
    title        TEXT,
    author       TEXT,
    author_id    TEXT,
    cover_url    TEXT,
    cover_local  TEXT,
    summary      TEXT,
    note         TEXT,
    category     TEXT NOT NULL DEFAULT '其他',
    sub_category TEXT,
    tags         TEXT DEFAULT '[]',
    book_id      TEXT,
    source_data  TEXT DEFAULT '{}',
    created_at   DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at   DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (book_id) REFERENCES books(id) ON DELETE SET NULL
);

-- 内容解读产物表：保存对单条内容的真实结构化分析，避免前端伪造或重复消耗 token
CREATE TABLE IF NOT EXISTS entry_analysis (
    id            TEXT PRIMARY KEY,
    entry_id      TEXT NOT NULL UNIQUE,
    status        TEXT NOT NULL DEFAULT 'pending',
    content_hash  TEXT,
    source_kind   TEXT,
    source_length INTEGER DEFAULT 0,
    model         TEXT,
    token_budget  TEXT DEFAULT 'medium',
    progress      INTEGER DEFAULT 0,
    stage         TEXT,
    result_json   TEXT DEFAULT '{}',
    error         TEXT,
    started_at    DATETIME,
    finished_at   DATETIME,
    created_at    DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at    DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (entry_id) REFERENCES entries(id) ON DELETE CASCADE
);

-- 浏览器采集任务：Agent/手机入口把需要登录态的动态内容交给本机浏览器插件完成
CREATE TABLE IF NOT EXISTS capture_jobs (
    id             TEXT PRIMARY KEY,
    url            TEXT NOT NULL,
    normalized_url TEXT,
    platform       TEXT NOT NULL DEFAULT 'web',
    source_channel TEXT DEFAULT 'manual',
    source_message TEXT,
    status         TEXT NOT NULL DEFAULT 'queued',
    entry_id       TEXT,
    error          TEXT,
    attempts       INTEGER DEFAULT 0,
    created_at     DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at     DATETIME DEFAULT CURRENT_TIMESTAMP,
    completed_at   DATETIME,
    FOREIGN KEY (entry_id) REFERENCES entries(id) ON DELETE SET NULL
);

-- 系统配置表
CREATE TABLE IF NOT EXISTS config (
    key        TEXT PRIMARY KEY,
    value      TEXT NOT NULL,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- 索引
CREATE INDEX IF NOT EXISTS idx_entries_category   ON entries(category);
CREATE INDEX IF NOT EXISTS idx_entries_platform   ON entries(platform);
CREATE INDEX IF NOT EXISTS idx_entries_created_at ON entries(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_entries_book_id    ON entries(book_id);
CREATE INDEX IF NOT EXISTS idx_entry_analysis_entry_id ON entry_analysis(entry_id);
CREATE INDEX IF NOT EXISTS idx_entry_analysis_status   ON entry_analysis(status);
CREATE INDEX IF NOT EXISTS idx_capture_jobs_status     ON capture_jobs(status, created_at);
CREATE INDEX IF NOT EXISTS idx_capture_jobs_url        ON capture_jobs(url);
CREATE INDEX IF NOT EXISTS idx_capture_jobs_normalized ON capture_jobs(normalized_url);
CREATE INDEX IF NOT EXISTS idx_books_category     ON books(category);
CREATE INDEX IF NOT EXISTS idx_books_platform     ON books(platform);
