// public/js/app.js - Main application controller

// ── State ────────────────────────────────────────────────────────────────────
let state = {
    view: 'shelf',       // 'shelf' | 'timeline' | 'search' | 'dashboard'
    category: '',        // active category filter
    sort: 'created_at',
    searchQuery: '',
    allBooks: [],
    allEntries: [],
    categories: [],
};

// Apple-style spring ease
const EASE = 'cubic-bezier(0.22, 1, 0.36, 1)';
const dashboardStatsCache = new Map();
let dashboardRenderSeq = 0;
let dashboardResizeObserver = null;

const DASHBOARD_PLATFORM_META = {
    xiaohongshu: { label: '小红书', color: '#ff2442', logo: 'https://www.xiaohongshu.com/favicon.ico' },
    wechat: { label: '微信公众号', color: '#07c160', logo: 'https://mp.weixin.qq.com/favicon.ico' },
    bilibili: { label: 'Bilibili', color: '#00a1d6', logo: 'https://www.bilibili.com/favicon.ico' },
    twitter: { label: 'X', color: '#111111', logo: 'https://x.com/favicon.ico' },
    douyin: { label: '抖音', color: '#111111', logo: 'https://www.douyin.com/favicon.ico' },
    youtube: { label: 'YouTube', color: '#ff0033', logo: 'https://www.youtube.com/favicon.ico' },
    zhihu: { label: '知乎', color: '#0084ff', logo: 'https://static.zhihu.com/heifetz/favicon.ico' },
    xiaoyuzhou: { label: '小宇宙', color: '#f5c400', logo: 'https://www.xiaoyuzhoufm.com/favicon-32x32.png' },
    weibo: { label: '微博', color: '#e6162d', logo: 'https://weibo.com/favicon.ico' },
    web: { label: '网页', color: '#64748b', logo: '' },
};
let viewTransitionSeq = 0;

// ── Animation Helpers ────────────────────────────────────────────────────────
// These use inline styles + rAF so they work regardless of Tailwind's display:none

function animateIn(el, { duration = 300, fromY = 8, fromScale = 1, fromOpacity = 0 } = {}) {
    if (!el) return;
    el.classList.remove('hidden');
    el.style.opacity = String(fromOpacity);
    el.style.transform = `translateY(${fromY}px) scale(${fromScale})`;
    el.style.transition = 'none';

    requestAnimationFrame(() => {
        requestAnimationFrame(() => {
            el.style.transition = `opacity ${duration}ms ${EASE}, transform ${duration}ms ${EASE}`;
            el.style.opacity = '1';
            el.style.transform = 'translateY(0) scale(1)';
        });
    });

    // Clean up inline styles after animation settles
    setTimeout(() => {
        el.style.transition = '';
        el.style.opacity = '';
        el.style.transform = '';
    }, duration + 50);
}

function animateOut(el, { duration = 200, toY = 6, toScale = 1, toOpacity = 0 } = {}) {
    if (!el || el.classList.contains('hidden')) return Promise.resolve();
    return new Promise(resolve => {
        el.style.transition = `opacity ${duration}ms ${EASE}, transform ${duration}ms ${EASE}`;
        el.style.opacity = String(toOpacity);
        el.style.transform = `translateY(${toY}px) scale(${toScale})`;
        setTimeout(() => {
            el.classList.add('hidden');
            el.style.transition = '';
            el.style.opacity = '';
            el.style.transform = '';
            resolve();
        }, duration);
    });
}

// ── Data Loading ─────────────────────────────────────────────────────────────
async function loadData() {
    showLoading(true);
    try {
        const [catRes, booksRes, statsRes] = await Promise.all([
            api.listCategories(),
            api.listBooks({ limit: 500 }),
            api.getStats(),
        ]);

        state.categories = catRes.data;
        state.allBooks = booksRes.books || [];
        renderFilterPills(state.categories, state.allBooks);
        renderDashboardFilterOptions(state.categories);
        renderCurrentView();
        updateStatsBar(statsRes.data);
    } catch (err) {
        showToast('加载数据失败: ' + err.message, 'error');
    } finally {
        showLoading(false);
    }
}

function renderDashboardFilterOptions(categories) {
    const select = document.getElementById('dashboardCategoryFilter');
    if (!select) return;
    const current = select.value;
    select.innerHTML = '<option value="">全部类别</option>';
    for (const cat of categories || []) {
        const option = document.createElement('option');
        option.value = cat.name;
        option.textContent = cat.name;
        select.appendChild(option);
    }
    select.value = [...select.options].some(option => option.value === current) ? current : '';
}

// ── Filter Pills ─────────────────────────────────────────────────────────────
function renderFilterPills(categories, books) {
    const container = document.getElementById('filterCategories');
    const usedCategories = new Set(books.map(b => b.category));

    container.innerHTML = `
        <button class="px-4 py-2 rounded-full whitespace-nowrap font-label text-sm bg-primary text-on-primary filter-pill active inline-flex items-center gap-1.5" data-category="">
            <span class="material-symbols-outlined text-[16px] leading-none">grid_view</span>
            <span>全部</span>
        </button>
    `;

    for (const cat of categories) {
        if (!usedCategories.has(cat.name)) continue;
        const btn = document.createElement('button');
        const meta = window.getCategoryMeta ? window.getCategoryMeta(cat.name) : { icon: 'folder' };
        btn.className = 'px-4 py-2 rounded-full whitespace-nowrap font-label text-sm bg-surface border border-outline-variant/30 text-on-surface hover:bg-surface-container-highest filter-pill inline-flex items-center gap-1.5';
        btn.dataset.category = cat.name;
        btn.innerHTML = `<span class="material-symbols-outlined text-[16px] leading-none">${escapeHtml(meta.icon)}</span><span>${escapeHtml(cat.name)}</span>`;
        btn.addEventListener('click', () => setCategory(cat.name, btn));
        container.appendChild(btn);
    }

    // Re-attach listener for "全部"
    container.querySelector('[data-category=""]').addEventListener('click', function () {
        setCategory('', this);
    });
}

function setCategory(category, btn) {
    state.category = category;
    document.querySelectorAll('.filter-pill').forEach(p => {
        p.className = 'px-4 py-2 rounded-full whitespace-nowrap font-label text-sm bg-surface border border-outline-variant/30 text-on-surface hover:bg-surface-container-highest filter-pill inline-flex items-center gap-1.5';
    });
    btn.className = 'px-4 py-2 rounded-full whitespace-nowrap font-label text-sm bg-primary text-on-primary filter-pill active inline-flex items-center gap-1.5';
    if (state.view === 'search') setView('shelf');
    else renderCurrentView();
}

// ── View Switching (with animation) ──────────────────────────────────────────
const VIEW_MAP = {
    shelf: 'bookshelfContainer',
    timeline: 'timelineContainer',
    dashboard: 'dashboardContainer',
    search: 'searchResults',
};

function setView(view) {
    const prevView = state.view;
    state.view = view;
    const transitionSeq = ++viewTransitionSeq;

    // Update active styles in side nav
    const setActive = (el, isActive) => {
        if (!el) return;
        el.className = isActive
            ? "flex items-center space-x-3 px-4 py-3 bg-surface-container-lowest text-primary rounded-lg font-['Manrope'] text-sm tracking-wide uppercase font-semibold ease-out duration-300 cursor-pointer shadow-[0_4px_32px_rgba(28,28,22,0.04)]"
            : "flex items-center space-x-3 px-4 py-3 text-on-surface-variant hover:text-on-surface hover:translate-x-1 transition-transform font-['Manrope'] text-sm tracking-wide uppercase font-semibold hover:bg-surface-container-highest rounded-lg ease-out duration-300 cursor-pointer";
    };

    setActive(document.getElementById('viewShelf'), view === 'shelf');
    setActive(document.getElementById('viewTimeline'), view === 'timeline');
    setActive(document.getElementById('viewDashboard'), view === 'dashboard');

    // Toggle filter pills: only show on shelf & timeline
    const filterEl = document.getElementById('filterCategories');
    if (filterEl) {
        if (view === 'shelf' || view === 'timeline') {
            filterEl.classList.remove('hidden');
        } else {
            filterEl.classList.add('hidden');
        }
    }

    // Animate out old panel, then animate in new panel
    const oldEl = document.getElementById(VIEW_MAP[prevView]);
    const newEl = document.getElementById(VIEW_MAP[view]);

    if (prevView === view) {
        // Same view — just re-render content
        renderCurrentView();
        return;
    }

    // Hide all panels except the one we're animating out
    Object.entries(VIEW_MAP).forEach(([key, id]) => {
        if (key !== prevView && key !== view) {
            document.getElementById(id).classList.add('hidden');
        }
    });

    // Fade out old panel
    animateOut(oldEl, { duration: 150, toY: -4 }).then(() => {
        if (transitionSeq !== viewTransitionSeq || state.view !== view) return;
        // Fade in new panel
        animateIn(newEl, { duration: 280, fromY: 10 });
        renderCurrentView();
    });
}

// ── Render Current View ──────────────────────────────────────────────────────
function renderCurrentView() {
    const filtered = state.category
        ? state.allBooks.filter(b => b.category === state.category)
        : state.allBooks;

    const isEmpty = filtered.length === 0 && state.view !== 'search' && state.view !== 'dashboard';
    if (isEmpty && !state.category) {
        document.getElementById('emptyState').classList.remove('hidden');
    } else {
        document.getElementById('emptyState').classList.add('hidden');
    }

    if (state.view === 'shelf') {
        renderBookshelf(filtered, state.categories, document.getElementById('bookshelfContainer'));
    } else if (state.view === 'timeline') {
        const params = { limit: 1000, sort: state.sort };
        if (state.category) params.category = state.category;
        api.listEntries(params).then(res => {
            if (state.view !== 'timeline') return;
            renderTimeline(res.entries, document.getElementById('timelineContainer'));
            initTimelinePicker();
        });
    } else if (state.view === 'dashboard') {
        renderDashboard();
    }
}

async function renderDashboard() {
    const range = document.getElementById('dashboardTimeFilter')?.value || '1m';
    const category = document.getElementById('dashboardCategoryFilter')?.value || '';
    const platform = document.getElementById('dashboardPlatformFilter')?.value || '';
    const chartEl = document.getElementById('dashboardTrendChart');
    const heatmapEl = document.getElementById('dashboardHeatmap');
    if (!chartEl || !heatmapEl) return;

    const seq = ++dashboardRenderSeq;
    const cacheKey = `${range}:${category || '*'}:${platform || '*'}`;
    if (dashboardStatsCache.has(cacheKey)) {
        renderDashboardData(dashboardStatsCache.get(cacheKey));
    } else {
        chartEl.innerHTML = '<div class="h-full w-full flex items-center justify-center text-sm text-on-surface-variant">加载真实数据中...</div>';
        heatmapEl.innerHTML = '<div class="absolute inset-0 flex items-center justify-center text-sm text-white/50">正在重排注意力矩阵...</div>';
    }

    try {
        const res = await api.getAdvancedStats({ range, category, platform });
        if (seq !== dashboardRenderSeq) return;
        let data = normalizeDashboardStats(res.data || {}, range);
        if (needsClientTreemapRebuild(data)) {
            data = await buildDashboardStatsFromEntries({ range, category, platform, baseData: data });
            if (seq !== dashboardRenderSeq) return;
        }
        dashboardStatsCache.set(cacheKey, data);
        renderDashboardData(data);
    } catch (err) {
        if (seq !== dashboardRenderSeq) return;
        chartEl.innerHTML = `<div class="h-full w-full flex items-center justify-center text-sm text-error">洞察数据加载失败：${escapeHtml(err.message)}</div>`;
        heatmapEl.innerHTML = '<div class="absolute inset-0 flex items-center justify-center rounded-sm bg-[#171814] text-sm text-white/45">暂无数据</div>';
    }
}

function needsClientTreemapRebuild(data) {
    const heatmap = data?.heatmap || [];
    if (!heatmap.length) return false;
    return !heatmap.some(cat => Array.isArray(cat.children) && cat.children.length > 0);
}

async function buildDashboardStatsFromEntries({ range, category, platform, baseData }) {
    const res = await api.listEntries({ limit: 1000, sort: 'created_at' });
    const days = ({ '1w': 7, '1m': 30, '3m': 90, '1y': 365 })[range] || 30;
    const start = new Date();
    start.setDate(start.getDate() - (days - 1));
    start.setHours(0, 0, 0, 0);
    const rows = (res.entries || []).filter(entry => {
        const createdAt = new Date(String(entry.created_at || '').replace(' ', 'T'));
        if (Number.isNaN(createdAt.getTime()) || createdAt < start) return false;
        if (category && entry.category !== category) return false;
        if (platform && entry.platform !== platform) return false;
        return true;
    });
    const heatmap = buildClientTreemapHeatmap(rows);
    const trend = buildClientTrend(rows, start, days);
    const platforms = [...rows.reduce((map, entry) => {
        const key = entry.platform || 'web';
        map.set(key, (map.get(key) || 0) + 1);
        return map;
    }, new Map()).entries()].map(([name, count]) => ({ platform: name, count })).sort((a, b) => b.count - a.count);

    return {
        ...baseData,
        range,
        days,
        trend,
        heatmap,
        platforms,
        summary: {
            ...baseData.summary,
            total_entries: rows.length,
            active_days: trend.filter(d => d.count > 0).length,
            top_category: heatmap[0]?.name || null,
        },
    };
}

function buildClientTreemapHeatmap(rows) {
    const categoryMap = new Map();
    for (const entry of rows) {
        const categoryName = entry.category || '其他';
        if (!categoryMap.has(categoryName)) {
            const meta = window.getCategoryMeta ? window.getCategoryMeta(categoryName) : { icon: 'category', tone: '#727063' };
            categoryMap.set(categoryName, {
                name: categoryName,
                count: 0,
                percent: 0,
                basis: 'category_platform_author_client',
                icon: meta.icon || 'category',
                label_en: getShortCategoryLabel(categoryName),
                color: meta.tone || '#727063',
                children: new Map(),
            });
        }

        const category = categoryMap.get(categoryName);
        category.count += 1;
        const platformName = entry.platform || 'web';
        const platformMeta = getDashboardPlatformMeta(platformName);
        const author = String(entry.author || '').trim() || '未知作者';
        const key = `${platformName}::${author}`;
        if (!category.children.has(key)) {
            category.children.set(key, {
                id: key,
                platform: platformName,
                platform_label: platformMeta.label,
                platform_icon: platformName,
                platform_color: platformMeta.color,
                author,
                count: 0,
                recent: [],
            });
        }
        const child = category.children.get(key);
        child.count += 1;
        child.recent.push({
            title: entry.title || entry.url || '无标题',
            url: entry.url,
            created_at: entry.created_at,
        });
    }

    const total = rows.length || 1;
    return [...categoryMap.values()].sort((a, b) => b.count - a.count).map(category => ({
        ...category,
        percent: Math.round((category.count / total) * 100),
        children: [...category.children.values()].sort((a, b) => b.count - a.count).map(child => ({
            ...child,
            percent_of_total: Math.round((child.count / total) * 100),
            percent_of_category: Math.round((child.count / category.count) * 100),
            recent: child.recent.sort((a, b) => String(b.created_at).localeCompare(String(a.created_at))).slice(0, 5),
        })),
    }));
}

function buildClientTrend(rows, start, days) {
    const counts = new Map();
    for (const entry of rows) {
        const key = String(entry.created_at || '').slice(0, 10);
        if (key) counts.set(key, (counts.get(key) || 0) + 1);
    }
    return Array.from({ length: days }, (_, index) => {
        const d = new Date(start);
        d.setDate(start.getDate() + index);
        const date = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
        return { date, count: counts.get(date) || 0 };
    });
}

function renderDashboardData(data) {
    renderTrendChart(data);
    renderCategoryHeatmap(data);
}

function normalizeDashboardStats(raw, fallbackRange = '1m') {
    const trend = Array.isArray(raw.trend) ? raw.trend.map(d => ({
        date: d.date,
        count: Number(d.count) || 0,
    })) : [];
    const heatmap = normalizeDashboardHeatmap(raw.heatmap);
    const totalEntries = Number(raw.summary?.total_entries) || trend.reduce((sum, d) => sum + d.count, 0);
    const activeDays = Number(raw.summary?.active_days) || trend.filter(d => d.count > 0).length;
    const topCategory = raw.summary?.top_category || heatmap[0]?.name || null;
    return {
        ...raw,
        range: raw.range || fallbackRange,
        trend,
        heatmap,
        summary: {
            total_entries: totalEntries,
            previous_entries: Number(raw.summary?.previous_entries) || 0,
            delta_percent: Number(raw.summary?.delta_percent) || 0,
            active_days: activeDays,
            top_category: topCategory,
        },
    };
}

function normalizeDashboardHeatmap(heatmap) {
    const rows = Array.isArray(heatmap)
        ? heatmap
        : (!heatmap || typeof heatmap !== 'object' ? [] : Object.entries(heatmap).map(([name, value]) => ({
            name,
            count: Number(value?.count) || 0,
            percent: Number(value?.percent) || 0,
            icon: value?.icon || 'category',
            label_en: value?.label_en || name,
            color: value?.color || '#727063',
        })));

    return rows.map((cat) => ({
        ...cat,
        name: cat.name || '其他',
        count: Number(cat.count) || 0,
        percent: Number(cat.percent) || 0,
        icon: cat.icon || 'category',
        label_en: cat.label_en || cat.name || 'Other',
        color: cat.color || '#727063',
        children: Array.isArray(cat.children) ? cat.children.map(child => ({
            ...child,
            platform: child.platform || 'web',
            platform_label: child.platform_label || getDashboardPlatformMeta(child.platform).label,
            platform_color: child.platform_color || getDashboardPlatformMeta(child.platform).color,
            platform_icon: child.platform_icon || child.platform || 'web',
            author: child.author || '未知作者',
            count: Number(child.count) || 0,
            percent_of_category: Number(child.percent_of_category) || 0,
            percent_of_total: Number(child.percent_of_total) || 0,
            recent: Array.isArray(child.recent) ? child.recent : [],
        })).sort((a, b) => b.count - a.count) : [],
    })).sort((a, b) => b.count - a.count);
}

function renderTrendChart(data) {
    const chartEl = document.getElementById('dashboardTrendChart');
    const subtitle = document.getElementById('dashboardTrendSubtitle');
    const deltaEl = document.getElementById('dashboardTrendDelta');
    const trend = data.trend || [];
    const summary = data.summary || { total_entries: 0, active_days: 0, delta_percent: 0 };
    const rawMax = Math.max(1, ...trend.map(d => d.count));
    const maxY = rawMax <= 4 ? rawMax : Math.ceil(rawMax / 5) * 5;
    const bounds = { left: 8, right: 98, top: 10, bottom: 82 };
    const points = trend.map((d, i) => {
        const x = trend.length <= 1 ? bounds.left : bounds.left + (i / (trend.length - 1)) * (bounds.right - bounds.left);
        const y = bounds.bottom - (d.count / maxY) * (bounds.bottom - bounds.top);
        return { ...d, x, y };
    });
    const linePath = buildSmoothPath(points);
    const areaPath = points.length
        ? `${linePath} L${points[points.length - 1].x.toFixed(2)},${bounds.bottom} L${points[0].x.toFixed(2)},${bounds.bottom} Z`
        : '';
    const tickIndexes = buildTickIndexes(trend.length);
    const yTicks = Array.from({ length: 5 }, (_, i) => {
        const ratio = i / 4;
        return {
            y: bounds.top + ratio * (bounds.bottom - bounds.top),
            value: Math.round(maxY * (1 - ratio)),
        };
    });
    const activeMarkers = selectVisibleMarkers(points.filter(p => p.count > 0), 18);
    const peakPoint = points.reduce((best, p) => p.count > best.count ? p : best, points[0] || { count: 0, x: bounds.left, y: bounds.bottom });
    const lastActivePoint = [...points].reverse().find(p => p.count > 0) || points[points.length - 1];
    const accent = '#0066cc';
    const accentSoft = '#2997ff';

    subtitle.textContent = `${rangeLabel(data.range)} · ${summary.total_entries} 条收录 · ${summary.active_days} 个活跃日`;
    const delta = summary.delta_percent;
    deltaEl.textContent = `${delta >= 0 ? '+' : ''}${delta}%`;
    deltaEl.className = `font-label text-xs font-semibold px-2.5 py-1 rounded-full ${delta >= 0 ? 'text-primary bg-primary/10' : 'text-error bg-error-container/50'}`;

    chartEl.innerHTML = `
        <div class="absolute left-0 top-0 z-20 flex gap-3">
            <div class="rounded-md bg-surface-container-lowest/90 border border-outline-variant/20 px-3 py-2 shadow-[0_10px_30px_rgba(28,28,22,0.06)]">
                <div class="font-label text-[10px] uppercase tracking-[0.18em] text-on-surface/45">Total</div>
                <div class="font-headline text-2xl leading-none text-on-surface mt-1">${summary.total_entries}</div>
            </div>
            <div class="rounded-md bg-surface-container-low/90 border border-outline-variant/15 px-3 py-2">
                <div class="font-label text-[10px] uppercase tracking-[0.18em] text-on-surface/45">Peak</div>
                <div class="font-headline text-2xl leading-none text-on-surface mt-1">${peakPoint?.count || 0}</div>
            </div>
        </div>
        <svg class="absolute inset-0 h-full w-full z-10" preserveAspectRatio="none" viewBox="0 0 100 100" aria-label="Capture trend chart">
            <defs>
                <linearGradient id="trendAreaGradient" x1="0" x2="0" y1="0" y2="1">
                    <stop offset="0%" stop-color="${accentSoft}" stop-opacity="0.34"></stop>
                    <stop offset="72%" stop-color="${accentSoft}" stop-opacity="0.05"></stop>
                    <stop offset="100%" stop-color="${accentSoft}" stop-opacity="0"></stop>
                </linearGradient>
                <filter id="trendLineGlow" x="-10%" y="-40%" width="120%" height="180%">
                    <feDropShadow dx="0" dy="0" stdDeviation="0" flood-color="${accent}" flood-opacity="0"/>
                </filter>
            </defs>
            <rect x="${bounds.left}" y="${bounds.top}" width="${bounds.right - bounds.left}" height="${bounds.bottom - bounds.top}" rx="1.5" fill="#fafafc" opacity="0.92"></rect>
            ${yTicks.map(tick => `
                <line x1="${bounds.left}" x2="${bounds.right}" y1="${tick.y.toFixed(2)}" y2="${tick.y.toFixed(2)}" stroke="#d2d2d7" stroke-width="0.28" stroke-dasharray="1.5 2.2" opacity="0.7"></line>
                <text x="1.6" y="${(tick.y + 1).toFixed(2)}" font-size="3.2" fill="#6e6e73" font-family="system-ui, -apple-system, sans-serif">${tick.value}</text>
            `).join('')}
            <line x1="${bounds.left}" x2="${bounds.right}" y1="${bounds.bottom}" y2="${bounds.bottom}" stroke="#d2d2d7" stroke-width="0.35" opacity="0.8"></line>
            ${areaPath ? `<path d="${areaPath}" fill="url(#trendAreaGradient)"></path>` : ''}
            ${linePath ? `<path d="${linePath}" fill="none" stroke="${accent}" stroke-linecap="round" stroke-linejoin="round" stroke-width="1.35"></path>` : ''}
            ${activeMarkers.map(p => `<circle cx="${p.x.toFixed(2)}" cy="${p.y.toFixed(2)}" r="1.15" fill="#ffffff" stroke="${accent}" stroke-width="0.65"></circle>`).join('')}
            ${peakPoint?.count > 0 ? `
                <line x1="${peakPoint.x.toFixed(2)}" x2="${peakPoint.x.toFixed(2)}" y1="${peakPoint.y.toFixed(2)}" y2="${bounds.bottom}" stroke="${accent}" stroke-width="0.35" stroke-dasharray="1 1.6" opacity="0.5"></line>
                <circle cx="${peakPoint.x.toFixed(2)}" cy="${peakPoint.y.toFixed(2)}" r="2.25" fill="${accent}" opacity="0.16"></circle>
                <circle cx="${peakPoint.x.toFixed(2)}" cy="${peakPoint.y.toFixed(2)}" r="1.15" fill="${accent}"></circle>
            ` : ''}
            ${lastActivePoint?.count > 0 ? `<circle cx="${lastActivePoint.x.toFixed(2)}" cy="${lastActivePoint.y.toFixed(2)}" r="1.55" fill="#ffffff" stroke="${accent}" stroke-width="0.9"></circle>` : ''}
        </svg>
        <div class="absolute bottom-1 left-[8%] right-[2%] z-20 flex justify-between text-[10px] font-label text-on-surface/45">
            ${tickIndexes.map(i => `<span>${formatChartDate(trend[i]?.date, data.range)}</span>`).join('')}
        </div>
        ${summary.total_entries === 0 ? '<div class="absolute inset-0 z-30 flex items-center justify-center text-sm text-on-surface-variant">当前时间范围暂无收录</div>' : ''}
    `;
}

function renderCategoryHeatmap(data) {
    const heatmapEl = document.getElementById('dashboardHeatmap');
    const subtitle = document.getElementById('dashboardHeatmapSubtitle');
    const tooltip = document.getElementById('dashboardHeatmapTooltip');
    const categories = (data.heatmap || []).filter(cat => cat.count > 0);
    const summary = data.summary || { total_entries: 0, top_category: null };
    const sourceCount = new Set(categories.flatMap(cat => (cat.children || []).map(child => child.platform))).size;
    subtitle.textContent = summary.top_category
        ? `${rangeLabel(data.range)} · ${summary.total_entries} 条 · ${categories.length} 类 · ${sourceCount} 个来源`
        : '当前时间范围暂无分类标签数据';

    if (!categories.length) {
        heatmapEl.innerHTML = '<div class="absolute inset-0 flex items-center justify-center rounded-lg bg-[#171814] text-sm text-white/45">当前筛选条件下暂无收录</div>';
        if (tooltip) tooltip.classList.add('hidden');
        return;
    }

    const draw = () => drawAttentionTreemap(heatmapEl, tooltip, categories, summary.total_entries);
    draw();
    if (dashboardResizeObserver) {
        dashboardResizeObserver.disconnect();
        dashboardResizeObserver = null;
    }
    if (window.ResizeObserver) {
        dashboardResizeObserver = new ResizeObserver(() => {
            if (state.view === 'dashboard') draw();
        });
        dashboardResizeObserver.observe(heatmapEl);
    }
}

function drawAttentionTreemap(container, tooltip, categories, totalEntries) {
    const width = Math.max(320, container.clientWidth || 0);
    const height = Math.max(420, container.clientHeight || 0);
    const categoryRects = sliceTreemap(
        categories.map(cat => ({ ...cat, value: cat.count })),
        { x: 0, y: 0, w: width, h: height },
        7
    );

    container.innerHTML = categoryRects.map(({ item: cat, rect }) => {
        const categoryColor = normalizeHexColor(cat.color || '#727063');
        const compactHeader = rect.w < 210 || rect.h < 145;
        const headerHeight = compactHeader ? 46 : 58;
        const categoryPercent = Number(cat.percent) || Math.round((cat.count / Math.max(1, totalEntries)) * 100);
        const childArea = {
            x: 9,
            y: headerHeight + 6,
            w: Math.max(0, rect.w - 18),
            h: Math.max(0, rect.h - headerHeight - 15),
        };
        const childRects = sliceTreemap(
            (cat.children?.length ? cat.children : [{
                platform: 'web',
                platform_label: 'Web',
                platform_color: categoryColor,
                author: '未知作者',
                count: cat.count,
                percent_of_category: 100,
                percent_of_total: cat.percent,
                recent: [],
            }]).map(child => ({ ...child, value: child.count })),
            childArea,
            5
        );

        return `
            <section class="absolute rounded-md overflow-hidden transition-all duration-500"
                style="left:${rect.x}px;top:${rect.y}px;width:${rect.w}px;height:${rect.h}px;background:${hexToRgba(categoryColor, 0.17)};box-shadow: inset 0 0 0 1px ${hexToRgba(categoryColor, 0.38)};">
                <div class="absolute inset-x-0 top-0 px-3 flex items-center justify-between gap-3 border-b border-white/10"
                     style="height:${headerHeight}px;background:linear-gradient(90deg, ${hexToRgba(categoryColor, 0.24)}, rgba(255,255,255,0.02));">
                    <div class="min-w-0 flex items-center gap-2.5">
                        <span class="material-symbols-outlined text-[18px] text-white/78 shrink-0">${escapeHtml((window.getCategoryMeta ? window.getCategoryMeta(cat.name).icon : cat.icon) || 'category')}</span>
                        <div class="min-w-0">
                            <div class="font-body ${compactHeader ? 'text-xs' : 'text-sm'} font-semibold text-white truncate">${escapeHtml(cat.name)}</div>
                            <div class="font-label text-[10px] uppercase tracking-[0.16em] text-white/48 truncate">${escapeHtml(cat.label_en || getShortCategoryLabel(cat.name))}</div>
                        </div>
                    </div>
                    <div class="text-right shrink-0">
                        <div class="font-headline ${compactHeader ? 'text-xl' : 'text-2xl'} leading-none text-white">${categoryPercent}%</div>
                        <div class="font-label text-[10px] text-white/45">${cat.count} 条</div>
                    </div>
                </div>
                ${childRects.map(({ item: child, rect: childRect }) => renderTreemapTile(child, cat, childRect, totalEntries)).join('')}
            </section>
        `;
    }).join('');

    container.querySelectorAll('[data-treemap-tile]').forEach(tile => {
        tile.addEventListener('mousemove', event => showTreemapTooltip(event, tooltip, tile));
        tile.addEventListener('mouseleave', () => tooltip?.classList.add('hidden'));
    });
}

function renderTreemapTile(child, category, rect, totalEntries) {
    const meta = getDashboardPlatformMeta(child.platform);
    const color = normalizeHexColor(child.platform_color || meta.color);
    const small = rect.w < 96 || rect.h < 72;
    const tiny = rect.w < 66 || rect.h < 50;
    const highFrequency = child.count >= 2 || child.percent_of_category >= 40;
    const recent = encodeURIComponent(JSON.stringify(child.recent || []));
    const label = highFrequency && !tiny ? child.author : child.platform_label;
    const categoryPercent = child.percent_of_category || Math.round((child.count / Math.max(1, category.count)) * 100);
    const totalPercent = child.percent_of_total || Math.round((child.count / Math.max(1, totalEntries)) * 100);
    return `
        <article data-treemap-tile
            data-category="${escapeHtml(category.name)}"
            data-platform="${escapeHtml(child.platform_label || meta.label)}"
            data-author="${escapeHtml(child.author)}"
            data-count="${child.count}"
            data-category-percent="${categoryPercent}"
            data-total-percent="${totalPercent}"
            data-recent="${recent}"
            class="absolute rounded-[6px] overflow-hidden group cursor-default transition-all duration-500 hover:z-20 hover:brightness-110"
            style="left:${rect.x}px;top:${rect.y}px;width:${rect.w}px;height:${rect.h}px;background:linear-gradient(135deg, ${darkenHex(color, 0.62)} 0%, ${darkenHex(color, 0.42)} 100%);box-shadow:inset 0 0 0 1px rgba(255,255,255,0.08);">
            <div class="absolute inset-0 opacity-30" style="background:radial-gradient(circle at 18% 8%, rgba(255,255,255,0.45), rgba(255,255,255,0) 55%);"></div>
            <div class="relative h-full p-2.5 flex flex-col ${tiny ? 'items-center justify-center' : 'justify-between'}">
                <div class="flex items-center gap-2 min-w-0 ${tiny ? 'justify-center' : ''}">
                    ${renderPlatformLogo(child, small ? 'small' : 'normal')}
                    ${tiny ? '' : `<span class="font-label text-[10px] uppercase tracking-[0.13em] text-white/72 truncate">${escapeHtml(child.platform_label || meta.label)}</span>`}
                </div>
                ${tiny ? '' : `
                    <div class="min-w-0">
                        <div class="font-body ${small ? 'text-[11px]' : 'text-sm'} font-semibold text-white truncate">${escapeHtml(label)}</div>
                        <div class="font-label text-[10px] text-white/56 mt-0.5">${child.count} captures · ${categoryPercent}% of ${escapeHtml(category.name)}</div>
                    </div>
                `}
            </div>
        </article>
    `;
}

function showTreemapTooltip(event, tooltip, tile) {
    if (!tooltip) return;
    let recent = [];
    try {
        recent = JSON.parse(decodeURIComponent(tile.dataset.recent || '%5B%5D'));
    } catch {
        recent = [];
    }
    tooltip.innerHTML = `
        <div class="font-label text-[10px] uppercase tracking-[0.18em] text-on-surface/45">${escapeHtml(tile.dataset.category)} · ${escapeHtml(tile.dataset.platform)}</div>
        <div class="mt-1 font-headline text-2xl leading-tight text-on-surface">${escapeHtml(tile.dataset.author)}</div>
        <div class="mt-2 flex gap-2 text-xs font-label text-on-surface-variant">
            <span>${escapeHtml(tile.dataset.count)} 条收录</span>
            <span>${escapeHtml(tile.dataset.categoryPercent)}% 类内占比</span>
            <span>${escapeHtml(tile.dataset.totalPercent)}% 总占比</span>
        </div>
        <div class="mt-3 space-y-1.5">
            ${recent.slice(0, 5).map(item => `<div class="font-body text-xs leading-snug text-on-surface/78 line-clamp-2">- ${escapeHtml(item.title || '无标题')}</div>`).join('') || '<div class="font-body text-xs text-on-surface/55">暂无最近标题</div>'}
        </div>
    `;
    tooltip.classList.remove('hidden');
    const x = Math.min(window.innerWidth - 340, event.clientX + 18);
    const y = Math.min(window.innerHeight - 220, event.clientY + 18);
    tooltip.style.left = `${Math.max(12, x)}px`;
    tooltip.style.top = `${Math.max(12, y)}px`;
}

function sliceTreemap(items, area, gap = 4, horizontal = area.w >= area.h) {
    const filtered = items.filter(item => Number(item.value) > 0);
    if (!filtered.length || area.w <= 0 || area.h <= 0) return [];
    const sorted = [...filtered].sort((a, b) => Number(b.value || 0) - Number(a.value || 0));
    return binaryTreemap(sorted, area, gap, horizontal)
        .filter(({ rect }) => rect.w > 8 && rect.h > 8);
}

function binaryTreemap(items, area, gap, horizontal) {
    if (items.length === 1) {
        return [{ item: items[0], rect: shrinkRect(area, gap) }];
    }
    const total = items.reduce((sum, item) => sum + Number(item.value || 0), 0);
    let headTotal = 0;
    let splitIndex = 0;
    for (let i = 0; i < items.length - 1; i++) {
        const nextTotal = headTotal + Number(items[i].value || 0);
        if (Math.abs(total / 2 - nextTotal) <= Math.abs(total / 2 - headTotal)) {
            headTotal = nextTotal;
            splitIndex = i + 1;
        } else {
            break;
        }
    }
    splitIndex = Math.max(1, splitIndex);
    const first = items.slice(0, splitIndex);
    const second = items.slice(splitIndex);
    const ratio = headTotal / total;
    if (horizontal) {
        const firstW = Math.round(area.w * ratio);
        return [
            ...binaryTreemap(first, { x: area.x, y: area.y, w: firstW, h: area.h }, gap, !horizontal),
            ...binaryTreemap(second, { x: area.x + firstW, y: area.y, w: area.w - firstW, h: area.h }, gap, !horizontal),
        ];
    }
    const firstH = Math.round(area.h * ratio);
    return [
        ...binaryTreemap(first, { x: area.x, y: area.y, w: area.w, h: firstH }, gap, !horizontal),
        ...binaryTreemap(second, { x: area.x, y: area.y + firstH, w: area.w, h: area.h - firstH }, gap, !horizontal),
    ];
}

function shrinkRect(rect, gap) {
    const half = gap / 2;
    return {
        x: rect.x + half,
        y: rect.y + half,
        w: Math.max(0, rect.w - gap),
        h: Math.max(0, rect.h - gap),
    };
}

function getDashboardPlatformMeta(platform) {
    return DASHBOARD_PLATFORM_META[platform] || DASHBOARD_PLATFORM_META.web;
}

function renderPlatformLogo(child, size = 'normal') {
    const box = size === 'small' ? 'w-7 h-7' : 'w-8 h-8';
    const logoUrl = getOfficialLogoUrl(child.platform, child.recent?.[0]?.url);
    if (!logoUrl) {
        return `<span class="platform-logo ${box} rounded-md bg-white/12 inline-flex items-center justify-center shrink-0 overflow-hidden"></span>`;
    }
    return `
        <span class="platform-logo ${box} rounded-md bg-white/92 inline-flex items-center justify-center shrink-0 p-1 overflow-hidden">
            <img class="max-w-full max-h-full object-contain" src="${escapeHtml(logoUrl)}" alt="${escapeHtml((child.platform_label || getDashboardPlatformMeta(child.platform).label) + ' logo')}" referrerpolicy="no-referrer"
                onerror="this.closest('.platform-logo')?.classList.add('opacity-30'); this.remove();" />
        </span>
    `;
}

function getOfficialLogoUrl(platform, sourceUrl) {
    const meta = getDashboardPlatformMeta(platform);
    if (platform === 'web') return getFaviconFromUrl(sourceUrl) || meta.logo || '';
    return meta.logo || getFaviconFromUrl(sourceUrl) || '';
}

function getFaviconFromUrl(sourceUrl) {
    const url = extractFirstUrl(sourceUrl);
    if (!url) return '';
    try {
        const parsed = new URL(url);
        return `${parsed.origin}/favicon.ico`;
    } catch {
        return '';
    }
}

function extractFirstUrl(value) {
    const match = String(value || '').match(/https?:\/\/[^\s，。)）】]+/i);
    return match ? match[0] : '';
}

function darkenHex(hex, amount = 0.5) {
    const value = normalizeHexColor(hex).slice(1);
    const int = parseInt(value, 16);
    const r = Math.round(((int >> 16) & 255) * amount);
    const g = Math.round(((int >> 8) & 255) * amount);
    const b = Math.round((int & 255) * amount);
    return `rgb(${r}, ${g}, ${b})`;
}

function getShortCategoryLabel(name) {
    const labels = {
        '人工智能': 'AI',
        '计算机科学': 'CS',
        '经济与金融': 'Finance',
        '商业与管理': 'Business',
        '影视与娱乐': 'Film',
        '产品与技术': 'Product',
        '生态与环境': 'Ecology',
        '其他': 'Other',
    };
    return labels[name] || name || 'Other';
}

function normalizeHexColor(color) {
    const value = String(color || '').trim();
    if (/^#[0-9a-f]{6}$/i.test(value)) return value;
    if (/^#[0-9a-f]{3}$/i.test(value)) {
        return `#${value[1]}${value[1]}${value[2]}${value[2]}${value[3]}${value[3]}`;
    }
    return '#727063';
}

function hexToRgba(hex, alpha = 1) {
    const value = normalizeHexColor(hex).slice(1);
    const int = parseInt(value, 16);
    const r = (int >> 16) & 255;
    const g = (int >> 8) & 255;
    const b = int & 255;
    return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}

function buildSmoothPath(points) {
    if (!points.length) return '';
    if (points.length === 1) return `M${points[0].x.toFixed(2)},${points[0].y.toFixed(2)}`;
    let path = `M${points[0].x.toFixed(2)},${points[0].y.toFixed(2)}`;
    for (let i = 1; i < points.length; i++) {
        const prev = points[i - 1];
        const curr = points[i];
        const midX = (prev.x + curr.x) / 2;
        path += ` C${midX.toFixed(2)},${prev.y.toFixed(2)} ${midX.toFixed(2)},${curr.y.toFixed(2)} ${curr.x.toFixed(2)},${curr.y.toFixed(2)}`;
    }
    return path;
}

function selectVisibleMarkers(points, limit) {
    if (points.length <= limit) return points;
    const step = Math.ceil(points.length / limit);
    return points.filter((_, index) => index % step === 0 || index === points.length - 1);
}

function buildTickIndexes(length) {
    if (!length) return [];
    if (length <= 5) return Array.from({ length }, (_, i) => i);
    return [0, Math.floor((length - 1) * 0.25), Math.floor((length - 1) * 0.5), Math.floor((length - 1) * 0.75), length - 1];
}

function rangeLabel(range) {
    return ({ '1w': '近1周', '1m': '近1月', '3m': '近3月', '1y': '近1年' })[range] || '近1月';
}

function formatChartDate(date, range) {
    if (!date) return '';
    const d = new Date(date + 'T00:00:00');
    if (range === '1y') return `${d.getMonth() + 1}/${d.getDate()}`;
    return `${String(d.getMonth() + 1).padStart(2, '0')}/${String(d.getDate()).padStart(2, '0')}`;
}

// ── Search ───────────────────────────────────────────────────────────────────
async function handleSearch(query) {
    query = sanitizeSearchQuery(query);
    if (!query) {
        setView('shelf');
        return;
    }

    state.searchQuery = query;
    setView('search');

    try {
        const res = await api.searchEntries(query);
        renderSearchResults(res.data, query, document.getElementById('searchResults'));
    } catch (err) {
        showToast('搜索失败: ' + err.message, 'error');
    }
}

function sanitizeSearchQuery(query) {
    const value = String(query || '').trim();
    if (/^https:\/\/api\.kimi\.com\/coding\/?$/i.test(value)) return '';
    return value;
}

// ── Quick-Add Bar (animated) ─────────────────────────────────────────────────
function toggleQuickAdd() {
    const bar = document.getElementById('quickAddBar');
    if (bar.classList.contains('hidden')) {
        animateIn(bar, { duration: 250, fromY: -12 });
        setTimeout(() => document.getElementById('urlInput').focus(), 100);
    } else {
        animateOut(bar, { duration: 180, toY: -8 });
    }
}

function closeQuickAdd() {
    animateOut(document.getElementById('quickAddBar'), { duration: 180, toY: -8 });
}

// ── Add URL (mail folding, sealing, and mailbox delivery) ────────────────────
function _createSaveOverlay() {
    let overlay = document.getElementById('saveOverlay');
    if (overlay) return overlay;
    overlay = document.createElement('div');
    overlay.id = 'saveOverlay';
    overlay.className = 'hidden';
    overlay.innerHTML = `
        <style>
            #saveOverlay {
                position: fixed; inset: 0; z-index: 9998;
                background: rgba(255,254,250, 0.72);
                backdrop-filter: blur(10px); -webkit-backdrop-filter: blur(10px);
                display: flex; flex-direction: column; align-items: center; justify-content: center;
                transition: opacity 0.2s cubic-bezier(0.22,1,0.36,1);
            }
            #saveOverlay.hidden { opacity: 0; pointer-events: none; display: none; }
            .mail-prep-loader {
                position: relative; width: min(360px, calc(100vw - 32px)); height: 248px; margin-bottom: 22px;
                display: flex; align-items: center; justify-content: center;
                perspective: 900px;
            }
            .prep-envelope {
                --cycle: 4.2s;
                position: relative; width: min(220px, 62vw); height: min(110px, 31vw);
                transform-style: preserve-3d;
                filter: drop-shadow(0 26px 42px rgba(42,38,28,0.13));
                animation: prepEnvelopeBreathe var(--cycle) cubic-bezier(0.22,1,0.36,1) infinite;
            }
            .prep-envelope-back,
            .prep-envelope-front,
            .prep-flap {
                position: absolute; inset: 0;
                border: 1px solid rgba(92,74,44,0.16);
                background:
                    radial-gradient(circle at 16% 18%, rgba(255,255,255,0.78), transparent 26%),
                    radial-gradient(circle at 82% 72%, rgba(132,103,60,0.08), transparent 22%),
                    repeating-linear-gradient(8deg, rgba(108,85,48,0.035) 0 1px, transparent 1px 7px),
                    linear-gradient(145deg, #fffdf3, #f2dfbb 68%, #e3c996);
            }
            .prep-envelope-back {
                border-radius: 5px;
                box-shadow: inset 0 1px 0 rgba(255,255,255,0.86);
            }
            .prep-envelope-front {
                border-radius: 5px;
                background:
                    linear-gradient(32deg, transparent 49.4%, rgba(111,86,48,0.18) 50%, transparent 50.6%),
                    linear-gradient(-32deg, transparent 49.4%, rgba(111,86,48,0.13) 50%, transparent 50.6%),
                    linear-gradient(to bottom, rgba(255,255,255,0.42), rgba(244,226,190,0.78));
                opacity: 0.94;
            }
            .prep-flap {
                transform-style: preserve-3d;
                backface-visibility: hidden;
            }
            .prep-flap.top {
                bottom: 50%; clip-path: polygon(0 0, 100% 0, 50% 100%);
                transform-origin: 50% 0%;
                animation: prepFoldTop var(--cycle) cubic-bezier(0.16,1,0.3,1) infinite;
            }
            .prep-flap.bottom {
                top: 50%; clip-path: polygon(0 100%, 100% 100%, 50% 0);
                transform-origin: 50% 100%;
                animation: prepFoldBottom var(--cycle) cubic-bezier(0.16,1,0.3,1) infinite;
            }
            .prep-flap.left {
                right: 50%; clip-path: polygon(0 0, 100% 50%, 0 100%);
                transform-origin: 0% 50%;
                animation: prepFoldLeft var(--cycle) cubic-bezier(0.16,1,0.3,1) infinite;
            }
            .prep-flap.right {
                left: 50%; clip-path: polygon(100% 0, 0 50%, 100% 100%);
                transform-origin: 100% 50%;
                animation: prepFoldRight var(--cycle) cubic-bezier(0.16,1,0.3,1) infinite;
            }
            .prep-paper-grain {
                position: absolute; inset: 0; border-radius: 5px; pointer-events: none;
                background:
                    radial-gradient(circle at 24% 28%, rgba(108,85,48,0.08) 0 1px, transparent 1px),
                    radial-gradient(circle at 76% 54%, rgba(108,85,48,0.06) 0 1px, transparent 1px),
                    repeating-linear-gradient(102deg, rgba(255,255,255,0.18) 0 1px, transparent 1px 9px);
                background-size: 22px 18px, 28px 24px;
                mix-blend-mode: multiply;
                opacity: 0.48;
            }
            .prep-stamp {
                position: absolute; right: 16px; top: 14px; width: 34px; height: 24px;
                border-radius: 3px; border: 1px solid rgba(80,64,42,0.18);
                background: linear-gradient(135deg, rgba(227,245,255,0.72), rgba(250,227,237,0.58));
                animation: prepStampFade var(--cycle) ease infinite;
            }
            .prep-glue-line {
                position: absolute; left: 34px; right: 34px; top: 48%;
                height: 8px; border-radius: 999px;
                background: linear-gradient(90deg, transparent, rgba(126,202,166,0.58), transparent);
                opacity: 0;
                transform: scaleX(0.15);
                animation: prepGlueMark var(--cycle) cubic-bezier(0.16,1,0.3,1) infinite;
            }
            .glue-stick {
                position: absolute; left: 216px; top: 76px; width: 58px; height: 18px;
                border-radius: 999px; background: linear-gradient(90deg, #13120f, #343026);
                box-shadow: 0 10px 26px rgba(42,38,28,0.14);
                transform-origin: 6px 50%;
                animation: prepGlueSwipe 4.2s cubic-bezier(0.16,1,0.3,1) infinite;
            }
            .glue-stick::before {
                content: ""; position: absolute; left: -22px; top: 4px; width: 28px; height: 10px;
                border-radius: 999px; background: linear-gradient(90deg, rgba(228,248,237,0.98), rgba(126,202,166,0.72));
                box-shadow: 0 0 12px rgba(80,160,120,0.16);
            }
            .glue-stick::after {
                content: ""; position: absolute; right: 8px; top: 4px; width: 18px; height: 10px;
                border-radius: 999px; background: rgba(255,255,255,0.12);
            }
            @keyframes prepEnvelopeBreathe {
                0%, 100% { transform: rotate(-1deg) translateY(0); }
                32% { transform: rotate(0.5deg) translateY(-2px); }
                64% { transform: rotate(-0.4deg) translateY(1px); }
            }
            @keyframes prepFoldLeft {
                0%, 10%, 100% { transform: rotateY(0deg); }
                22%, 88% { transform: rotateY(-160deg); }
            }
            @keyframes prepFoldRight {
                0%, 14%, 100% { transform: rotateY(0deg); }
                28%, 88% { transform: rotateY(160deg); }
            }
            @keyframes prepFoldBottom {
                0%, 24%, 100% { transform: rotateX(0deg); }
                40%, 88% { transform: rotateX(156deg); }
            }
            @keyframes prepFoldTop {
                0%, 34%, 100% { transform: rotateX(0deg); }
                52%, 88% { transform: rotateX(-164deg); }
            }
            @keyframes prepStampFade {
                0%, 45%, 100% { opacity: 1; }
                52%, 88% { opacity: 0; }
            }
            @keyframes prepGlueSwipe {
                0%, 54% { opacity: 0; transform: translate(-10px, 8px) rotate(-18deg); }
                61% { opacity: 1; transform: translate(-4px, 8px) rotate(-18deg); }
                76% { opacity: 1; transform: translate(-150px, 34px) rotate(-18deg); }
                84%, 100% { opacity: 0; transform: translate(-166px, 40px) rotate(-18deg); }
            }
            @keyframes prepGlueMark {
                0%, 58% { opacity: 0; transform: scaleX(0.08); }
                76% { opacity: 1; transform: scaleX(1); }
                92%, 100% { opacity: 0; transform: scaleX(0.92); }
            }
            @media (prefers-reduced-motion: reduce) {
                .prep-envelope, .prep-flap, .glue-stick, .prep-glue-line, .prep-stamp {
                    animation: none !important;
                }
            }
        </style>
        <div class="mail-prep-loader" aria-hidden="true">
            <div class="prep-envelope">
                <div class="prep-envelope-back"></div>
                <div class="prep-flap left"></div>
                <div class="prep-flap right"></div>
                <div class="prep-flap bottom"></div>
                <div class="prep-envelope-front"></div>
                <div class="prep-flap top"></div>
                <div class="prep-paper-grain"></div>
                <div class="prep-stamp"></div>
                <div class="prep-glue-line"></div>
            </div>
            <div class="glue-stick"></div>
        </div>
        <p id="saveOverlayText" class="font-headline text-3xl text-on-surface mb-2">信息收录中</p>
        <p class="font-body text-sm text-on-surface-variant">正在解析链接、分类并放入书架</p>
    `;
    document.body.appendChild(overlay);
    return overlay;
}

function _showSaveOverlay(text) {
    const overlay = _createSaveOverlay();
    document.getElementById('saveOverlayText').textContent = text || '信息收录中';
    overlay.classList.remove('hidden');
    overlay.style.display = 'flex';
    requestAnimationFrame(() => { overlay.style.opacity = '1'; });
}

function _hideSaveOverlay() {
    const overlay = document.getElementById('saveOverlay');
    if (!overlay) return;
    overlay.style.opacity = '0';
    setTimeout(() => { overlay.classList.add('hidden'); overlay.style.display = 'none'; }, 300);
}

// ── Mailbox drop success animation + generated sound ─────────────────────────
function playCelebration(entryOrCategory) {
    const entry = typeof entryOrCategory === 'object' ? entryOrCategory : { category: entryOrCategory };
    const category = entry?.category || '知识库';
    const title = entry?.title || entry?.latest_entry_title || '新收录内容';
    const platform = entry?.platform ? getPlatformLabelForMaildrop(entry.platform) : 'InfoMind';
    const reduceMotion = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;

    playMaildropSound(reduceMotion);

    const overlay = document.createElement('div');
    overlay.className = 'maildrop-overlay';
    overlay.innerHTML = `
        <div class="maildrop-stage">
            <div class="maildrop-camera">
                ${reduceMotion ? '' : `<div class="maildrop-letter"><div class="maildrop-letter-seam"></div></div>`}
                <div class="maildrop-mailbox"><div class="mailbox-post"></div></div>
                <div class="maildrop-slot-cover" aria-hidden="true"></div>
                <div class="maildrop-fireworks" aria-hidden="true">
                    ${Array.from({ length: 22 }, (_, i) => `<span style="--i:${i};--a:${i * 16.36}deg"></span>`).join('')}
                </div>
            </div>
            <div class="maildrop-result">
                <div class="maildrop-stamp">
                    <span class="material-symbols-outlined text-[15px] leading-none">mark_email_read</span>
                    收录成功
                </div>
                <h3 class="mt-4 font-headline text-3xl leading-tight text-on-surface">${escapeHtml(title)}</h3>
                <p class="mt-3 font-body text-sm leading-relaxed text-on-surface-variant">
                    已投递到「${escapeHtml(category)}」 · ${escapeHtml(platform)}
                </p>
            </div>
        </div>
    `;
    document.body.appendChild(overlay);

    const result = overlay.querySelector('.maildrop-result');
    setTimeout(() => result?.classList.add('is-visible'), reduceMotion ? 80 : 1520);
    overlay.addEventListener('click', () => dismissMaildrop(overlay));
    setTimeout(() => dismissMaildrop(overlay), reduceMotion ? 1800 : 3900);
}

function dismissMaildrop(overlay) {
    if (!overlay || overlay._dismissed) return;
    overlay._dismissed = true;
    overlay.style.transition = 'opacity 260ms cubic-bezier(0.22,1,0.36,1), transform 260ms cubic-bezier(0.22,1,0.36,1)';
    overlay.style.opacity = '0';
    overlay.style.transform = 'scale(0.98)';
    setTimeout(() => overlay.remove(), 280);
}

function getPlatformLabelForMaildrop(platform) {
    if (typeof PLATFORM_LABELS !== 'undefined' && PLATFORM_LABELS[platform]) return PLATFORM_LABELS[platform];
    return platform || '网页';
}

function playMaildropSound(reduceMotion = false) {
    if (reduceMotion) return;
    const AudioContext = window.AudioContext || window.webkitAudioContext;
    if (!AudioContext) return;
    const ctx = new AudioContext();
    const now = ctx.currentTime;
    const master = ctx.createGain();
    master.gain.setValueAtTime(0.0001, now);
    master.gain.exponentialRampToValueAtTime(0.16, now + 0.02);
    master.gain.exponentialRampToValueAtTime(0.0001, now + 1.95);
    master.connect(ctx.destination);

    const noiseBurst = (start, dur, gainValue = 0.05, filterFreq = 1400) => {
        const sampleRate = ctx.sampleRate;
        const buffer = ctx.createBuffer(1, Math.max(1, Math.floor(sampleRate * dur)), sampleRate);
        const data = buffer.getChannelData(0);
        for (let i = 0; i < data.length; i++) {
            data[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / data.length, 2);
        }
        const source = ctx.createBufferSource();
        const filter = ctx.createBiquadFilter();
        const gain = ctx.createGain();
        filter.type = 'bandpass';
        filter.frequency.setValueAtTime(filterFreq, now + start);
        filter.Q.setValueAtTime(0.9, now + start);
        gain.gain.setValueAtTime(0.0001, now + start);
        gain.gain.exponentialRampToValueAtTime(gainValue, now + start + 0.012);
        gain.gain.exponentialRampToValueAtTime(0.0001, now + start + dur);
        source.buffer = buffer;
        source.connect(filter);
        filter.connect(gain);
        gain.connect(master);
        source.start(now + start);
    };

    const ping = (start, freq, dur, type = 'sine', gainValue = 0.16) => {
        const osc = ctx.createOscillator();
        const gain = ctx.createGain();
        osc.type = type;
        osc.frequency.setValueAtTime(freq, now + start);
        osc.frequency.exponentialRampToValueAtTime(freq * 0.74, now + start + dur);
        gain.gain.setValueAtTime(0.0001, now + start);
        gain.gain.exponentialRampToValueAtTime(gainValue, now + start + 0.012);
        gain.gain.exponentialRampToValueAtTime(0.0001, now + start + dur);
        osc.connect(gain);
        gain.connect(master);
        osc.start(now + start);
        osc.stop(now + start + dur + 0.03);
    };

    ping(0.04, 520, 0.12, 'triangle', 0.026);
    ping(0.44, 390, 0.16, 'triangle', 0.022);
    noiseBurst(1.32, 0.16, 0.035, 980);
    ping(1.46, 108, 0.26, 'sine', 0.105);
    ping(1.72, 1540, 0.08, 'triangle', 0.04);
    noiseBurst(1.82, 0.2, 0.028, 520);
    ping(1.92, 680, 0.22, 'sine', 0.026);

    setTimeout(() => ctx.close?.(), 2200);
}

async function handleAddUrl() {
    const urlInput = document.getElementById('urlInput');
    const noteInput = document.getElementById('noteInput');
    const statusEl = document.getElementById('addStatus');
    const btn = document.getElementById('addSubmitBtn');

    const url = urlInput.value.trim();
    if (!url) { urlInput.focus(); return; }

    btn.disabled = true;
    statusEl.classList.remove('hidden');
    statusEl.innerHTML = '';

    _showSaveOverlay('信息收录中');

    try {
        const res = await api.addEntry(url, noteInput.value.trim());
        const entry = res.data;

        _hideSaveOverlay();

        playCelebration(entry);

        urlInput.value = '';
        noteInput.value = '';
        await loadData();
        setTimeout(() => closeQuickAdd(), 3900);
    } catch (err) {
        _hideSaveOverlay();
        statusEl.innerHTML = `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#ba1a1a" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="margin-right:4px"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>${escapeHtml(err.message)}`;
        showToast('添加失败: ' + err.message, 'error');
    } finally {
        btn.disabled = false;
    }
}

// ── Stats Bar ────────────────────────────────────────────────────────────────
function updateStatsBar(stats) {
    if (!stats) return;
    document.getElementById('statTotal').textContent = `${stats.total_entries} 条内容`;
    document.getElementById('statCategories').textContent = `${stats.total_categories_used} 个分类`;
    const platforms = (stats.by_platform || []).map(p => p.platform).slice(0, 3).join('、');
    document.getElementById('statPlatforms').textContent = platforms || '暂无平台数据';
}

// ── Loading ──────────────────────────────────────────────────────────────────
function showLoading(show) {
    if (show) {
        document.getElementById('loadingScreen').classList.remove('hidden');
        document.getElementById('bookshelfContainer').classList.add('hidden');
    } else {
        document.getElementById('loadingScreen').classList.add('hidden');
        if (state.view === 'shelf') document.getElementById('bookshelfContainer').classList.remove('hidden');
    }
}

// ── Timeline month-jump ──────────────────────────────────────────────────────
function initTimelinePicker() {
    const picker = document.getElementById('timelineMonthPicker');
    if (!picker) return;
    if (!picker.value) {
        const now = new Date();
        picker.value = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
    }
}

function jumpToTimelineMonth() {
    const picker = document.getElementById('timelineMonthPicker');
    if (!picker || !picker.value) return;
    const anchor = document.getElementById(`month-${picker.value}`);
    if (!anchor) {
        window.showToast(`该月份暂无内容 (${picker.value})`, 'info');
        return;
    }
    anchor.scrollIntoView({ behavior: 'smooth', block: 'start' });
    // Brief gold flash to confirm jump
    anchor.style.transition = 'background 0.3s';
    anchor.style.background = 'rgba(113,89,21,0.08)';
    setTimeout(() => { anchor.style.background = ''; }, 1200);
}

// ── Toast ────────────────────────────────────────────────────────────────────
function showToast(message, type = 'info') {
    const container = document.getElementById('toastContainer');
    const toast = document.createElement('div');
    toast.className = `toast ${type}`;

    let iconSvg = '';
    if (type === 'success') iconSvg = '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="margin-right:6px"><polyline points="20 6 9 17 4 12"/></svg>';
    else if (type === 'error') iconSvg = '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="margin-right:6px"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>';
    else iconSvg = '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="margin-right:6px"><circle cx="12" cy="12" r="10"/><line x1="12" y1="16" x2="12" y2="12"/><line x1="12" y1="8" x2="12.01" y2="8"/></svg>';

    toast.innerHTML = `<div style="display:flex;align-items:center;">${iconSvg}${escapeHtml(message)}</div>`;
    container.appendChild(toast);
    setTimeout(() => {
        toast.style.animation = 'toastOut 0.3s ease forwards';
        setTimeout(() => toast.remove(), 300);
    }, 3000);
}

// ── Init ─────────────────────────────────────────────────────────────────────
document.addEventListener('DOMContentLoaded', () => {
    initSettings();

    // Add button (animated)
    document.getElementById('addBtn').addEventListener('click', toggleQuickAdd);
    document.getElementById('addCancelBtn').addEventListener('click', closeQuickAdd);
    document.getElementById('addSubmitBtn').addEventListener('click', handleAddUrl);
    document.getElementById('urlInput').addEventListener('keydown', e => {
        if (e.key === 'Enter') handleAddUrl();
    });

    // View toggle
    document.getElementById('viewShelf').addEventListener('click', (e) => {
        e.preventDefault();
        setView('shelf');
    });
    document.getElementById('viewTimeline').addEventListener('click', (e) => {
        e.preventDefault();
        setView('timeline');
    });
    document.getElementById('viewDashboard').addEventListener('click', (e) => {
        e.preventDefault();
        setView('dashboard');
    });
    document.getElementById('sortSelect').addEventListener('change', e => {
        state.sort = e.target.value;
        renderCurrentView();
    });
    document.getElementById('dashboardTimeFilter')?.addEventListener('change', () => {
        if (state.view === 'dashboard') renderDashboard();
    });
    document.getElementById('dashboardCategoryFilter')?.addEventListener('change', () => {
        if (state.view === 'dashboard') renderDashboard();
    });
    document.getElementById('dashboardPlatformFilter')?.addEventListener('change', () => {
        if (state.view === 'dashboard') renderDashboard();
    });

    // Search
    let searchTimer;
    const searchInput = document.getElementById('searchInput');
    searchInput.value = sanitizeSearchQuery(searchInput.value);
    document.querySelectorAll('input[type="search"], input[name*="search" i]').forEach(input => {
        if (input !== searchInput) input.value = sanitizeSearchQuery(input.value);
    });
    document.getElementById('searchInput').addEventListener('input', e => {
        const cleanQuery = sanitizeSearchQuery(e.target.value);
        if (cleanQuery !== e.target.value.trim()) e.target.value = cleanQuery;
        clearTimeout(searchTimer);
        searchTimer = setTimeout(() => handleSearch(cleanQuery), 350);
    });

    // Keyboard shortcut ⌘K
    document.addEventListener('keydown', e => {
        if ((e.metaKey || e.ctrlKey) && e.key === 'k') {
            e.preventDefault();
            document.getElementById('searchInput').focus();
        }
    });

    // Timeline month jump
    document.getElementById('timelineJumpBtn')?.addEventListener('click', jumpToTimelineMonth);
    document.getElementById('timelineMonthPicker')?.addEventListener('keydown', e => {
        if (e.key === 'Enter') jumpToTimelineMonth();
    });

    loadData();
});

window.loadData = loadData;
window.showToast = showToast;
