const express = require('express');
const router = express.Router();
const queries = require('../db/queries');
const { getDb } = require('../db/init');
const logger = require('../utils/logger');

const RANGE_DAYS = {
    '1w': 7,
    '1m': 30,
    '3m': 90,
    '1y': 365,
};

const advancedStatsCache = new Map();

const PLATFORM_META = {
    xiaohongshu: { label: '小红书', icon: 'xiaohongshu', color: '#ff2442' },
    wechat: { label: '微信公众号', icon: 'wechat', color: '#07c160' },
    bilibili: { label: 'Bilibili', icon: 'bilibili', color: '#00a1d6' },
    twitter: { label: 'X', icon: 'x', color: '#111111' },
    douyin: { label: '抖音', icon: 'douyin', color: '#111111' },
    youtube: { label: 'YouTube', icon: 'youtube', color: '#ff0033' },
    zhihu: { label: '知乎', icon: 'zhihu', color: '#0084ff' },
    xiaoyuzhou: { label: '小宇宙', icon: 'xiaoyuzhou', color: '#f5c400' },
    weibo: { label: '微博', icon: 'weibo', color: '#e6162d' },
    web: { label: 'Web', icon: 'favicon', color: '#64748b' },
};

const CATEGORY_SHORT_LABELS = {
    '人工智能': 'AI',
    '计算机科学': 'CS',
    '心理学': 'Psychology',
    '哲学': 'Philosophy',
    '历史': 'History',
    '自然科学': 'Science',
    '数学': 'Math',
    '经济与金融': 'Finance',
    '商业与管理': 'Business',
    '艺术与设计': 'Design',
    '音乐': 'Music',
    '影视与娱乐': 'Film',
    '文学与写作': 'Writing',
    '政治与社会': 'Society',
    '法律': 'Law',
    '医学与健康': 'Health',
    '体育与健身': 'Fitness',
    '美食与烹饪': 'Food',
    '旅行与地理': 'Travel',
    '游戏': 'Gaming',
    '产品与技术': 'Product',
    '教育': 'Education',
    '工程与制造': 'Engineering',
    '生态与环境': 'Ecology',
    '其他': 'Other',
};

const FALLBACK_CATEGORY_META = {
    '人工智能': { icon: 'memory', color: '#5b6ee1' },
    '计算机科学': { icon: 'desktop_windows', color: '#6b5bd6' },
    '心理学': { icon: 'psychology', color: '#b94e83' },
    '哲学': { icon: 'auto_stories', color: '#8b6f2a' },
    '历史': { icon: 'history_edu', color: '#7b6a3d' },
    '自然科学': { icon: 'science', color: '#00839b' },
    '数学': { icon: 'calculate', color: '#2f69bf' },
    '经济与金融': { icon: 'paid', color: '#17865d' },
    '商业与管理': { icon: 'business_center', color: '#9b5a12' },
    '艺术与设计': { icon: 'palette', color: '#b63d5e' },
    '音乐': { icon: 'music_note', color: '#7650b5' },
    '影视与娱乐': { icon: 'movie', color: '#0d7f95' },
    '文学与写作': { icon: 'edit_note', color: '#2c8a62' },
    '政治与社会': { icon: 'public', color: '#b33a32' },
    '法律': { icon: 'gavel', color: '#775326' },
    '医学与健康': { icon: 'health_and_safety', color: '#258a46' },
    '体育与健身': { icon: 'fitness_center', color: '#b45d19' },
    '美食与烹饪': { icon: 'restaurant', color: '#a67314' },
    '旅行与地理': { icon: 'travel_explore', color: '#256fbd' },
    '游戏': { icon: 'stadia_controller', color: '#734fb7' },
    '产品与技术': { icon: 'devices', color: '#0877a8' },
    '教育': { icon: 'school', color: '#a86614' },
    '工程与制造': { icon: 'engineering', color: '#647080' },
    '生态与环境': { icon: 'eco', color: '#2f8a45' },
    '其他': { icon: 'category', color: '#727063' },
};

// GET /api/stats (Basic stats)
router.get('/', (req, res) => {
    try {
        res.json({ success: true, data: queries.getStats() });
    } catch (err) {
        logger.error('Stats error', err);
        res.status(500).json({ success: false, error: err.message });
    }
});

// GET /api/stats/advanced (Heatmap & Trends)
router.get('/advanced', async (req, res) => {
    try {
        const db = getDb();
        const range = RANGE_DAYS[req.query.range] ? req.query.range : '1m';
        const days = RANGE_DAYS[range];
        const categoryFilter = normalizeFilter(req.query.category);
        const platformFilter = normalizeFilter(req.query.platform);
        const signature = db.prepare('SELECT COUNT(*) as count, MAX(updated_at) as max_updated, MAX(created_at) as max_created FROM entries').get();
        const cacheKey = `${range}:${categoryFilter || '*'}:${platformFilter || '*'}:${signature.count}:${signature.max_updated || ''}:${signature.max_created || ''}`;
        const cached = advancedStatsCache.get(cacheKey);
        if (cached) return res.json(cached);

        const end = new Date();
        const start = new Date(end);
        start.setDate(end.getDate() - (days - 1));
        start.setHours(0, 0, 0, 0);

        const startDate = toSqlDate(start);
        const previousStart = new Date(start);
        previousStart.setDate(start.getDate() - days);

        const where = ['datetime(created_at) >= datetime(?)'];
        const params = [startDate];
        if (categoryFilter) {
            where.push('category = ?');
            params.push(categoryFilter);
        }
        if (platformFilter) {
            where.push('platform = ?');
            params.push(platformFilter);
        }

        const rows = db.prepare(`
            SELECT id, title, category, platform, author, url, created_at
            FROM entries
            WHERE ${where.join(' AND ')}
            ORDER BY datetime(created_at) ASC
        `).all(...params);

        const previousWhere = ['datetime(created_at) >= datetime(?)', 'datetime(created_at) < datetime(?)'];
        const previousParams = [toSqlDate(previousStart), startDate];
        if (categoryFilter) {
            previousWhere.push('category = ?');
            previousParams.push(categoryFilter);
        }
        if (platformFilter) {
            previousWhere.push('platform = ?');
            previousParams.push(platformFilter);
        }
        const previousCount = db.prepare(`
            SELECT COUNT(*) as count
            FROM entries
            WHERE ${previousWhere.join(' AND ')}
        `).get(...previousParams).count;

        const trend = buildTrend(rows, start, days);
        const categories = buildCategoryHeatmap(rows, getCategoryMetaMap(db));
        const platformRows = db.prepare(`
            SELECT platform, COUNT(*) as count
            FROM entries
            WHERE ${where.join(' AND ')}
            GROUP BY platform
            ORDER BY count DESC
        `).all(...params);

        const currentCount = rows.length;
        const delta = previousCount === 0
            ? (currentCount > 0 ? 100 : 0)
            : Math.round(((currentCount - previousCount) / previousCount) * 100);

        const payload = {
            success: true,
            data: {
                range,
                days,
                filters: {
                    category: categoryFilter,
                    platform: platformFilter,
                },
                start_date: startDate,
                end_date: toSqlDate(end),
                summary: {
                    total_entries: currentCount,
                    previous_entries: previousCount,
                    delta_percent: delta,
                    active_days: trend.filter(d => d.count > 0).length,
                    top_category: categories[0]?.name || null,
                },
                trend,
                heatmap: categories,
                platforms: platformRows,
            }
        };
        advancedStatsCache.clear();
        advancedStatsCache.set(cacheKey, payload);
        res.json(payload);
    } catch (err) {
        logger.error('Advanced stats error', err);
        res.status(500).json({ success: false, error: err.message });
    }
});

function buildTrend(rows, start, days) {
    const counts = new Map();
    for (const row of rows) {
        const key = row.created_at.slice(0, 10);
        counts.set(key, (counts.get(key) || 0) + 1);
    }
    return Array.from({ length: days }, (_, index) => {
        const d = new Date(start);
        d.setDate(start.getDate() + index);
        const date = toDateKey(d);
        return { date, count: counts.get(date) || 0 };
    });
}

function buildCategoryHeatmap(rows, categoryMetaMap = new Map()) {
    const categoryMap = new Map();
    for (const row of rows) {
        const categoryName = row.category || '其他';
        if (!categoryMap.has(categoryName)) {
            categoryMap.set(categoryName, {
                name: categoryName,
                count: 0,
                children: new Map(),
            });
        }

        const category = categoryMap.get(categoryName);
        category.count += 1;

        const platform = row.platform || 'web';
        const author = normalizeAuthor(row.author);
        const sourceKey = `${platform}::${author}`;
        if (!category.children.has(sourceKey)) {
            const platformMeta = PLATFORM_META[platform] || PLATFORM_META.web;
            category.children.set(sourceKey, {
                id: sourceKey,
                platform,
                platform_label: platformMeta.label,
                platform_icon: platformMeta.icon,
                platform_color: platformMeta.color,
                author,
                count: 0,
                recent: [],
            });
        }

        const child = category.children.get(sourceKey);
        child.count += 1;
        child.recent.push({
            title: row.title || row.url || '无标题',
            url: row.url,
            created_at: row.created_at,
        });
    }
    const total = rows.length || 1;

    return [...categoryMap.values()]
        .sort((a, b) => b.count - a.count)
        .map((category) => ({
            name: category.name,
            count: category.count,
            percent: Math.round((category.count / total) * 100),
            basis: 'category_platform_author',
            ...(categoryMetaMap.get(category.name) || categoryMetaMap.get('其他') || {
                icon: 'category',
                label_en: CATEGORY_SHORT_LABELS['其他'],
                color: '#727063',
            }),
            children: [...category.children.values()]
                .sort((a, b) => b.count - a.count)
                .map(child => {
                    const recent = child.recent
                        .sort((a, b) => String(b.created_at).localeCompare(String(a.created_at)))
                        .slice(0, 5);
                    return {
                        ...child,
                        percent_of_total: Math.round((child.count / total) * 100),
                        percent_of_category: Math.round((child.count / category.count) * 100),
                        recent,
                    };
                }),
        }));
}

function normalizeFilter(value) {
    const text = String(value || '').trim();
    return text && text !== 'all' ? text : null;
}

function normalizeAuthor(author) {
    const text = String(author || '').trim();
    return text || '未知作者';
}

function getCategoryMetaMap(db) {
    const map = new Map(
        Object.entries(FALLBACK_CATEGORY_META).map(([name, meta]) => [name, {
            ...meta,
            label_en: CATEGORY_SHORT_LABELS[name] || name,
        }])
    );

    const rows = db.prepare('SELECT name, name_en, icon, color FROM categories').all();
    for (const row of rows) {
        const fallback = map.get(row.name) || map.get('其他');
        map.set(row.name, {
            icon: fallback?.icon || row.icon || 'category',
            label_en: CATEGORY_SHORT_LABELS[row.name] || compactEnglishLabel(row.name_en) || row.name,
            color: row.color || fallback?.color || '#727063',
        });
    }
    return map;
}

function compactEnglishLabel(label) {
    if (!label) return '';
    return String(label).split('&')[0].trim().split(/\s+/)[0] || '';
}

function toSqlDate(date) {
    return `${toDateKey(date)} ${String(date.getHours()).padStart(2, '0')}:${String(date.getMinutes()).padStart(2, '0')}:${String(date.getSeconds()).padStart(2, '0')}`;
}

function toDateKey(date) {
    return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
}

module.exports = router;
