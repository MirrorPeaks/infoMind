// server/db/init.js
const Database = require('better-sqlite3');
const fs = require('fs');
const path = require('path');
const logger = require('../utils/logger');
const { getDbPath, getCoversDir } = require('../utils/paths');

const SCHEMA_PATH = path.join(__dirname, 'schema.sql');

const CATEGORIES = [
    { id: 'ai', name: '人工智能', name_en: 'AI & Machine Learning', icon: 'cpu', color: '#6366f1', sort_order: 1 },
    { id: 'cs', name: '计算机科学', name_en: 'Computer Science', icon: 'monitor', color: '#8b5cf6', sort_order: 2 },
    { id: 'psychology', name: '心理学', name_en: 'Psychology', icon: 'brain', color: '#ec4899', sort_order: 3 },
    { id: 'philosophy', name: '哲学', name_en: 'Philosophy', icon: 'book-open', color: '#f59e0b', sort_order: 4 },
    { id: 'history', name: '历史', name_en: 'History', icon: 'scroll', color: '#84cc16', sort_order: 5 },
    { id: 'science', name: '自然科学', name_en: 'Natural Sciences', icon: 'microscope', color: '#06b6d4', sort_order: 6 },
    { id: 'math', name: '数学', name_en: 'Mathematics', icon: 'calculator', color: '#3b82f6', sort_order: 7 },
    { id: 'economics', name: '经济与金融', name_en: 'Economics & Finance', icon: 'circle-dollar-sign', color: '#10b981', sort_order: 8 },
    { id: 'business', name: '商业与管理', name_en: 'Business & Management', icon: 'briefcase', color: '#f97316', sort_order: 9 },
    { id: 'art', name: '艺术与设计', name_en: 'Art & Design', icon: 'palette', color: '#e11d48', sort_order: 10 },
    { id: 'music', name: '音乐', name_en: 'Music', icon: 'music', color: '#7c3aed', sort_order: 11 },
    { id: 'film', name: '影视与娱乐', name_en: 'Film & Entertainment', icon: 'clapperboard', color: '#0891b2', sort_order: 12 },
    { id: 'literature', name: '文学与写作', name_en: 'Literature & Writing', icon: 'feather', color: '#059669', sort_order: 13 },
    { id: 'politics', name: '政治与社会', name_en: 'Politics & Society', icon: 'globe', color: '#dc2626', sort_order: 14 },
    { id: 'law', name: '法律', name_en: 'Law', icon: 'scale', color: '#92400e', sort_order: 15 },
    { id: 'medicine', name: '医学与健康', name_en: 'Medicine & Health', icon: 'activity', color: '#16a34a', sort_order: 16 },
    { id: 'sports', name: '体育与健身', name_en: 'Sports & Fitness', icon: 'dumbbell', color: '#ea580c', sort_order: 17 },
    { id: 'food', name: '美食与烹饪', name_en: 'Food & Cooking', icon: 'utensils', color: '#ca8a04', sort_order: 18 },
    { id: 'travel', name: '旅行与地理', name_en: 'Travel & Geography', icon: 'map', color: '#2563eb', sort_order: 19 },
    { id: 'gaming', name: '游戏', name_en: 'Gaming', icon: 'gamepad-2', color: '#7c3aed', sort_order: 20 },
    { id: 'product', name: '产品与技术', name_en: 'Product & Technology', icon: 'smartphone', color: '#0284c7', sort_order: 21 },
    { id: 'education', name: '教育', name_en: 'Education', icon: 'graduation-cap', color: '#d97706', sort_order: 22 },
    { id: 'engineering', name: '工程与制造', name_en: 'Engineering', icon: 'wrench', color: '#64748b', sort_order: 23 },
    { id: 'ecology', name: '生态与环境', name_en: 'Ecology & Environment', icon: 'leaf', color: '#15803d', sort_order: 24 },
    { id: 'others', name: '其他', name_en: 'Others', icon: 'package', color: '#6b7280', sort_order: 25 },
];

let db;

function getDb() {
    if (!db) {
        throw new Error('Database not initialized. Call initDb() first.');
    }
    return db;
}

function initDb() {
    const dbPath = getDbPath();
    // Ensure data directory exists
    const dataDir = path.dirname(dbPath);
    if (!fs.existsSync(dataDir)) {
        fs.mkdirSync(dataDir, { recursive: true });
        logger.info(`Created data directory: ${dataDir}`);
    }

    // Also ensure covers directory
    const coversDir = getCoversDir();
    if (!fs.existsSync(coversDir)) {
        fs.mkdirSync(coversDir, { recursive: true });
    }

    db = new Database(dbPath);
    db.pragma('journal_mode = WAL');
    db.pragma('foreign_keys = ON');

    // Execute schema
    const schema = fs.readFileSync(SCHEMA_PATH, 'utf8');
    db.exec(schema);
    ensureMigrations();

    // Seed categories if not already present
    const count = db.prepare('SELECT COUNT(*) as c FROM categories').get().c;
    if (count === 0) {
        const insertCat = db.prepare(
            'INSERT OR IGNORE INTO categories (id, name, name_en, icon, color, sort_order) VALUES (?, ?, ?, ?, ?, ?)'
        );
        const insertMany = db.transaction((cats) => {
            for (const c of cats) {
                insertCat.run(c.id, c.name, c.name_en, c.icon, c.color, c.sort_order);
            }
        });
        insertMany(CATEGORIES);
        logger.info('Seeded 25 categories');
    }

    logger.success(`Database ready: ${dbPath}`);
    return db;
}

function ensureMigrations() {
    const entryAnalysisColumns = new Set(
        db.prepare('PRAGMA table_info(entry_analysis)').all().map(column => column.name)
    );
    const migrations = [
        ['progress', 'ALTER TABLE entry_analysis ADD COLUMN progress INTEGER DEFAULT 0'],
        ['stage', 'ALTER TABLE entry_analysis ADD COLUMN stage TEXT'],
        ['started_at', 'ALTER TABLE entry_analysis ADD COLUMN started_at DATETIME'],
        ['finished_at', 'ALTER TABLE entry_analysis ADD COLUMN finished_at DATETIME'],
    ];
    for (const [column, sql] of migrations) {
        if (!entryAnalysisColumns.has(column)) db.exec(sql);
    }
}

module.exports = { initDb, getDb };
