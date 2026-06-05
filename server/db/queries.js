// server/db/queries.js
const { v4: uuidv4 } = require('uuid');
const { getDb } = require('./init');

// ─── Entries ──────────────────────────────────────────────────────────────────

function createEntry(data) {
    const db = getDb();
    const id = data.id || uuidv4();
    db.prepare(`
    INSERT INTO entries (id, url, platform, title, author, author_id, cover_url, cover_local,
                         summary, note, category, sub_category, tags, book_id, source_data)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
        id, data.url, data.platform || 'unknown',
        data.title || null, data.author || null, data.author_id || null,
        data.cover_url || null, data.cover_local || null,
        data.summary || null, data.note || null,
        data.category || '其他', data.sub_category || null,
        JSON.stringify(data.tags || []), data.book_id || null,
        JSON.stringify(data.source_data || {})
    );
    return getEntryById(id);
}

function getEntryById(id) {
    const db = getDb();
    const row = db.prepare('SELECT * FROM entries WHERE id = ?').get(id);
    return row ? parseEntry(row) : null;
}

function getEntryByUrl(url) {
    const db = getDb();
    const row = db.prepare('SELECT * FROM entries WHERE url = ?').get(url);
    return row ? parseEntry(row) : null;
}

function listEntries({ category, platform, sort = 'created_at', page = 1, limit = 50 } = {}) {
    const db = getDb();
    const conditions = [];
    const params = [];

    if (category) { conditions.push('e.category = ?'); params.push(category); }
    if (platform) { conditions.push('e.platform = ?'); params.push(platform); }

    const where = conditions.length ? 'WHERE ' + conditions.join(' AND ') : '';
    const sortCol = sort === 'title' ? 'e.title' : 'e.created_at';
    const offset = (page - 1) * limit;

    const rows = db.prepare(`
    SELECT e.* FROM entries e ${where}
    ORDER BY ${sortCol} DESC
    LIMIT ? OFFSET ?
  `).all(...params, limit, offset);

    const total = db.prepare(`SELECT COUNT(*) as c FROM entries e ${where}`).get(...params).c;
    return { entries: rows.map(parseEntry), total, page, limit };
}

function searchEntries(q, { limit = 50 } = {}) {
    const db = getDb();
    const term = `%${q}%`;
    const rows = db.prepare(`
    SELECT * FROM entries
    WHERE title LIKE ? OR summary LIKE ? OR author LIKE ? OR tags LIKE ? OR note LIKE ?
    ORDER BY created_at DESC
    LIMIT ?
  `).all(term, term, term, term, term, limit);
    return rows.map(parseEntry);
}

function updateEntry(id, data) {
    const db = getDb();
    const fields = [];
    const params = [];

    if (data.category !== undefined) { fields.push('category = ?'); params.push(data.category); }
    if (data.sub_category !== undefined) { fields.push('sub_category = ?'); params.push(data.sub_category); }
    if (data.tags !== undefined) { fields.push('tags = ?'); params.push(JSON.stringify(data.tags)); }
    if (data.note !== undefined) { fields.push('note = ?'); params.push(data.note); }
    if (data.book_id !== undefined) { fields.push('book_id = ?'); params.push(data.book_id); }
    if (data.summary !== undefined) { fields.push('summary = ?'); params.push(data.summary); }
    if (data.title !== undefined) { fields.push('title = ?'); params.push(data.title); }
    if (data.author !== undefined) { fields.push('author = ?'); params.push(data.author); }
    if (data.cover_url !== undefined) { fields.push('cover_url = ?'); params.push(data.cover_url); }
    if (data.cover_local !== undefined) { fields.push('cover_local = ?'); params.push(data.cover_local); }
    if (data.source_data !== undefined) { fields.push('source_data = ?'); params.push(JSON.stringify(data.source_data)); }

    if (!fields.length) return getEntryById(id);
    fields.push('updated_at = CURRENT_TIMESTAMP');
    params.push(id);

    db.prepare(`UPDATE entries SET ${fields.join(', ')} WHERE id = ?`).run(...params);
    return getEntryById(id);
}

function deleteEntry(id) {
    const db = getDb();
    const entry = getEntryById(id);
    if (!entry) return false;
    db.prepare('DELETE FROM entry_analysis WHERE entry_id = ?').run(id);
    db.prepare('DELETE FROM capture_jobs WHERE entry_id = ?').run(id);
    db.prepare('DELETE FROM entries WHERE id = ?').run(id);
    // Update book count
    if (entry.book_id) {
        updateBookCount(entry.book_id);
    }
    return true;
}

function parseEntry(row) {
    return {
        ...row,
        author: cleanDisplayAuthor(row.author, row.platform),
        tags: safeJsonParse(row.tags, []),
        source_data: safeJsonParse(row.source_data, {}),
    };
}

// ─── Entry Analysis ──────────────────────────────────────────────────────────

function getEntryAnalysis(entryId) {
    const db = getDb();
    const row = db.prepare('SELECT * FROM entry_analysis WHERE entry_id = ?').get(entryId);
    return row ? parseEntryAnalysis(row) : null;
}

function upsertEntryAnalysis(data) {
    const db = getDb();
    const existing = getEntryAnalysis(data.entry_id);
    const id = existing?.id || data.id || uuidv4();
    db.prepare(`
        INSERT INTO entry_analysis (
            id, entry_id, status, content_hash, source_kind, source_length,
            model, token_budget, progress, stage, result_json, error,
            started_at, finished_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
        ON CONFLICT(entry_id) DO UPDATE SET
            status = excluded.status,
            content_hash = excluded.content_hash,
            source_kind = excluded.source_kind,
            source_length = excluded.source_length,
            model = excluded.model,
            token_budget = excluded.token_budget,
            progress = excluded.progress,
            stage = excluded.stage,
            result_json = excluded.result_json,
            error = excluded.error,
            started_at = COALESCE(excluded.started_at, entry_analysis.started_at),
            finished_at = excluded.finished_at,
            updated_at = CURRENT_TIMESTAMP
    `).run(
        id,
        data.entry_id,
        data.status || 'pending',
        data.content_hash || null,
        data.source_kind || null,
        data.source_length || 0,
        data.model || null,
        data.token_budget || 'medium',
        Number.isFinite(data.progress) ? data.progress : 0,
        data.stage || null,
        JSON.stringify(data.result || {}),
        data.error || null,
        data.started_at || null,
        data.finished_at || null
    );
    return getEntryAnalysis(data.entry_id);
}

function parseEntryAnalysis(row) {
    return {
        ...row,
        result: safeJsonParse(row.result_json, {}),
    };
}

// ─── Capture Jobs ────────────────────────────────────────────────────────────

function createCaptureJob(data) {
    const db = getDb();
    const id = data.id || uuidv4();
    db.prepare(`
        INSERT INTO capture_jobs (
            id, url, normalized_url, platform, source_channel, source_message,
            status, entry_id, error, attempts
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
        id,
        data.url,
        data.normalized_url || normalizeJobUrl(data.url),
        data.platform || 'web',
        data.source_channel || 'manual',
        data.source_message || null,
        data.status || 'queued',
        data.entry_id || null,
        data.error || null,
        Number.isFinite(data.attempts) ? data.attempts : 0
    );
    return getCaptureJobById(id);
}

function getCaptureJobById(id) {
    const db = getDb();
    const row = db.prepare('SELECT * FROM capture_jobs WHERE id = ?').get(id);
    return row || null;
}

function findActiveCaptureJobByUrl(url) {
    const db = getDb();
    const normalized = normalizeJobUrl(url);
    return db.prepare(`
        SELECT * FROM capture_jobs
        WHERE (url = ? OR normalized_url = ?)
          AND status IN ('queued', 'opening', 'capturing', 'needs_login', 'needs_user_action', 'failed')
        ORDER BY datetime(created_at) DESC
        LIMIT 1
    `).get(url, normalized) || null;
}

function findCaptureJobByUrl(url) {
    const db = getDb();
    const normalized = normalizeJobUrl(url);
    return db.prepare(`
        SELECT * FROM capture_jobs
        WHERE url = ? OR normalized_url = ?
        ORDER BY datetime(created_at) DESC
        LIMIT 1
    `).get(url, normalized) || null;
}

function listCaptureJobs({ status, platform, limit = 20 } = {}) {
    const db = getDb();
    const conditions = [];
    const params = [];
    if (status) {
        const statuses = Array.isArray(status) ? status : String(status).split(',').map(s => s.trim()).filter(Boolean);
        if (statuses.length) {
            conditions.push(`status IN (${statuses.map(() => '?').join(', ')})`);
            params.push(...statuses);
        }
    }
    if (platform) { conditions.push('platform = ?'); params.push(platform); }
    const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';
    return db.prepare(`
        SELECT * FROM capture_jobs
        ${where}
        ORDER BY datetime(created_at) ASC
        LIMIT ?
    `).all(...params, limit);
}

function updateCaptureJob(id, data) {
    const db = getDb();
    const fields = [];
    const params = [];
    if (data.url !== undefined) { fields.push('url = ?'); params.push(data.url); }
    if (data.normalized_url !== undefined) { fields.push('normalized_url = ?'); params.push(data.normalized_url); }
    if (data.platform !== undefined) { fields.push('platform = ?'); params.push(data.platform); }
    if (data.source_channel !== undefined) { fields.push('source_channel = ?'); params.push(data.source_channel); }
    if (data.source_message !== undefined) { fields.push('source_message = ?'); params.push(data.source_message); }
    if (data.status !== undefined) { fields.push('status = ?'); params.push(data.status); }
    if (data.entry_id !== undefined) { fields.push('entry_id = ?'); params.push(data.entry_id); }
    if (data.error !== undefined) { fields.push('error = ?'); params.push(data.error); }
    if (data.attempts !== undefined) { fields.push('attempts = ?'); params.push(data.attempts); }
    if (data.increment_attempts) fields.push('attempts = attempts + 1');
    if (data.completed_at !== undefined) { fields.push('completed_at = ?'); params.push(data.completed_at); }
    if (data.finish_now) fields.push('completed_at = CURRENT_TIMESTAMP');

    if (!fields.length) return getCaptureJobById(id);
    fields.push('updated_at = CURRENT_TIMESTAMP');
    params.push(id);
    db.prepare(`UPDATE capture_jobs SET ${fields.join(', ')} WHERE id = ?`).run(...params);
    return getCaptureJobById(id);
}

function deleteCaptureJob(id) {
    const db = getDb();
    const result = db.prepare('DELETE FROM capture_jobs WHERE id = ?').run(id);
    return result.changes > 0;
}

// ─── Books ────────────────────────────────────────────────────────────────────

function findBook({ author_id, author, platform }) {
    const db = getDb();
    if (author_id) {
        return db.prepare('SELECT * FROM books WHERE author_id = ? AND platform = ?').get(author_id, platform);
    }
    if (author) {
        return db.prepare('SELECT * FROM books WHERE author = ? AND platform = ?').get(author, platform);
    }
    return null;
}

function createBook(data) {
    const db = getDb();
    const id = data.id || uuidv4();
    db.prepare(`
    INSERT INTO books (id, author, author_id, platform, category, title, cover_url, cover_local)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `).run(id, data.author, data.author_id || null, data.platform, data.category,
        data.title || null, data.cover_url || null, data.cover_local || null);
    return db.prepare('SELECT * FROM books WHERE id = ?').get(id);
}

function updateBook(id, data) {
    const db = getDb();
    const fields = [];
    const params = [];
    if (data.title !== undefined) { fields.push('title = ?'); params.push(data.title); }
    if (data.cover_url !== undefined) { fields.push('cover_url = ?'); params.push(data.cover_url); }
    if (data.cover_local !== undefined) { fields.push('cover_local = ?'); params.push(data.cover_local); }
    if (data.entry_count !== undefined) { fields.push('entry_count = ?'); params.push(data.entry_count); }
    if (data.category !== undefined) { fields.push('category = ?'); params.push(data.category); }

    if (!fields.length) return;
    fields.push('updated_at = CURRENT_TIMESTAMP');
    params.push(id);
    db.prepare(`UPDATE books SET ${fields.join(', ')} WHERE id = ?`).run(...params);
}

function updateBookCount(bookId) {
    const db = getDb();
    const count = db.prepare('SELECT COUNT(*) as c FROM entries WHERE book_id = ?').get(bookId).c;
    if (count === 0) {
        db.prepare('DELETE FROM books WHERE id = ?').run(bookId);
    } else {
        db.prepare('UPDATE books SET entry_count = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?').run(count, bookId);
    }
}

function listBooks({ category, platform, sort = 'updated_at', page = 1, limit = 100 } = {}) {
    const db = getDb();
    const conditions = [];
    const params = [];
    if (category) { conditions.push('b.category = ?'); params.push(category); }
    if (platform) { conditions.push('b.platform = ?'); params.push(platform); }
    const where = conditions.length ? 'WHERE ' + conditions.join(' AND ') : '';
    const offset = (page - 1) * limit;
    const rows = db.prepare(`
    SELECT
        b.id, b.author, b.author_id, b.platform, b.category, b.title,
        COALESCE(
            (SELECT e.cover_local FROM entries e WHERE e.book_id = b.id AND e.cover_local IS NOT NULL ORDER BY datetime(e.created_at) DESC, e.id DESC LIMIT 1),
            b.cover_local
        ) as cover_local,
        COALESCE(
            (SELECT e.cover_url FROM entries e WHERE e.book_id = b.id AND e.cover_url IS NOT NULL ORDER BY datetime(e.created_at) DESC, e.id DESC LIMIT 1),
            b.cover_url
        ) as cover_url,
        (SELECT e.title FROM entries e WHERE e.book_id = b.id AND e.title IS NOT NULL ORDER BY datetime(e.created_at) DESC, e.id DESC LIMIT 1) as latest_entry_title,
        (SELECT e.created_at FROM entries e WHERE e.book_id = b.id ORDER BY datetime(e.created_at) DESC, e.id DESC LIMIT 1) as latest_entry_created_at,
        b.entry_count, b.created_at, b.updated_at
    FROM books b ${where}
    ORDER BY COALESCE(datetime(latest_entry_created_at), datetime(b.updated_at)) DESC, b.id DESC
    LIMIT ? OFFSET ?
  `).all(...params, limit, offset);
    const total = db.prepare(`SELECT COUNT(*) as c FROM books b ${where}`).get(...params).c;
    return { books: rows.map(parseBook), total, page, limit };
}

function getBookById(id) {
    const db = getDb();
    const row = db.prepare(`
    SELECT
        b.*,
        COALESCE(
            (SELECT e.cover_local FROM entries e WHERE e.book_id = b.id AND e.cover_local IS NOT NULL ORDER BY datetime(e.created_at) DESC, e.id DESC LIMIT 1),
            b.cover_local
        ) as cover_local,
        COALESCE(
            (SELECT e.cover_url FROM entries e WHERE e.book_id = b.id AND e.cover_url IS NOT NULL ORDER BY datetime(e.created_at) DESC, e.id DESC LIMIT 1),
            b.cover_url
        ) as cover_url,
        (SELECT e.title FROM entries e WHERE e.book_id = b.id AND e.title IS NOT NULL ORDER BY datetime(e.created_at) DESC, e.id DESC LIMIT 1) as latest_entry_title,
        (SELECT e.created_at FROM entries e WHERE e.book_id = b.id ORDER BY datetime(e.created_at) DESC, e.id DESC LIMIT 1) as latest_entry_created_at
    FROM books b
    WHERE b.id = ?
  `).get(id);
    return row ? parseBook(row) : null;
}

function getBookEntries(bookId) {
    const db = getDb();
    const rows = db.prepare('SELECT * FROM entries WHERE book_id = ? ORDER BY datetime(created_at) DESC, id DESC').all(bookId);
    return rows.map(parseEntry);
}

// ─── Categories ───────────────────────────────────────────────────────────────

function listCategories() {
    const db = getDb();
    return db.prepare(`
    SELECT c.*, COUNT(e.id) as entry_count
    FROM categories c
    LEFT JOIN entries e ON e.category = c.name
    GROUP BY c.id
    ORDER BY c.sort_order
  `).all();
}

// ─── Config ───────────────────────────────────────────────────────────────────

function getConfig(key) {
    const db = getDb();
    const row = db.prepare('SELECT value FROM config WHERE key = ?').get(key);
    return row ? row.value : null;
}

function setConfig(key, value) {
    const db = getDb();
    db.prepare(`
    INSERT INTO config (key, value, updated_at) VALUES (?, ?, CURRENT_TIMESTAMP)
    ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = CURRENT_TIMESTAMP
  `).run(key, value);
}

function getAllConfig() {
    const db = getDb();
    const rows = db.prepare('SELECT key, value FROM config').all();
    const result = {};
    for (const r of rows) result[r.key] = r.value;
    return result;
}

// ─── Stats ────────────────────────────────────────────────────────────────────

function getStats() {
    const db = getDb();
    return {
        total_entries: db.prepare('SELECT COUNT(*) as c FROM entries').get().c,
        total_books: db.prepare('SELECT COUNT(*) as c FROM books').get().c,
        total_categories_used: db.prepare('SELECT COUNT(DISTINCT category) as c FROM entries').get().c,
        by_platform: db.prepare(
            "SELECT platform, COUNT(*) as count FROM entries GROUP BY platform ORDER BY count DESC"
        ).all(),
        by_category: db.prepare(
            "SELECT category, COUNT(*) as count FROM entries GROUP BY category ORDER BY count DESC"
        ).all(),
        recent: db.prepare('SELECT id, title, platform, created_at FROM entries ORDER BY created_at DESC LIMIT 5').all(),
    };
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function safeJsonParse(str, fallback) {
    try { return JSON.parse(str); } catch { return fallback; }
}

function parseBook(row) {
    return {
        ...row,
        title: row.latest_entry_title || row.title,
        author: cleanDisplayAuthor(row.author, row.platform),
    };
}

function cleanDisplayAuthor(author, platform) {
    if (!author || platform !== 'xiaohongshu') return author;
    const withoutFollow = String(author).replace(/关注/g, '').replace(/\s+/g, ' ').trim();
    return collapseRepeatedText(withoutFollow);
}

function collapseRepeatedText(text) {
    const value = String(text || '').trim();
    for (let size = 1; size <= Math.floor(value.length / 2); size++) {
        if (value.length % size !== 0) continue;
        const unit = value.slice(0, size);
        if (unit.repeat(value.length / size) === value) return unit;
    }
    return value;
}

function normalizeJobUrl(url) {
    try {
        const parsed = new URL(String(url || '').trim());
        parsed.hash = '';
        for (const key of ['utm_source', 'utm_medium', 'utm_campaign', 'utm_term', 'utm_content']) {
            parsed.searchParams.delete(key);
        }
        return parsed.toString().replace(/\/$/, '');
    } catch {
        return String(url || '').trim();
    }
}

module.exports = {
    createEntry, getEntryById, getEntryByUrl, listEntries, searchEntries, updateEntry, deleteEntry,
    getEntryAnalysis, upsertEntryAnalysis,
    createCaptureJob, getCaptureJobById, findCaptureJobByUrl, findActiveCaptureJobByUrl, listCaptureJobs, updateCaptureJob, deleteCaptureJob,
    findBook, createBook, updateBook, updateBookCount, listBooks, getBookById, getBookEntries,
    listCategories,
    getConfig, setConfig, getAllConfig,
    getStats,
};
