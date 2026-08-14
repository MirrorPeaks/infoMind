// public/js/bookshelf.js - Bookshelf and timeline rendering
const PLATFORM_META = {
    bilibili: { label: '哔哩哔哩', icon: 'smart_display', logo: 'https://www.bilibili.com/favicon.ico' },
    youtube: { label: 'YouTube', icon: 'play_circle', logo: 'https://www.youtube.com/favicon.ico' },
    twitter: { label: 'X', icon: 'alternate_email', logo: 'https://x.com/favicon.ico' },
    douyin: { label: '抖音', icon: 'music_video', logo: 'https://www.douyin.com/favicon.ico' },
    xiaohongshu: { label: '小红书', icon: 'auto_awesome', logo: 'https://www.xiaohongshu.com/favicon.ico' },
    zhihu: { label: '知乎', icon: 'help', logo: 'https://static.zhihu.com/heifetz/favicon.ico' },
    xiaoyuzhou: { label: '小宇宙', icon: 'podcasts', logo: 'https://www.xiaoyuzhoufm.com/favicon-32x32.png' },
    wechat: { label: '公众号', icon: 'chat', logo: 'https://mp.weixin.qq.com/favicon.ico' },
    weibo: { label: '微博', icon: 'public', logo: 'https://weibo.com/favicon.ico' },
    web: { label: '网页', icon: 'language' },
};
const PLATFORM_LABELS = Object.fromEntries(Object.entries(PLATFORM_META).map(([key, meta]) => [key, meta.label]));

const CATEGORY_META = {
    人工智能: { icon: 'memory', tone: '#5b6ee1' },
    计算机科学: { icon: 'desktop_windows', tone: '#6b5bd6' },
    心理学: { icon: 'psychology', tone: '#b94e83' },
    哲学: { icon: 'auto_stories', tone: '#8b6f2a' },
    历史: { icon: 'history_edu', tone: '#7b6a3d' },
    自然科学: { icon: 'science', tone: '#00839b' },
    数学: { icon: 'calculate', tone: '#2f69bf' },
    经济与金融: { icon: 'paid', tone: '#17865d' },
    商业与管理: { icon: 'business_center', tone: '#9b5a12' },
    艺术与设计: { icon: 'palette', tone: '#b63d5e' },
    音乐: { icon: 'music_note', tone: '#7650b5' },
    影视与娱乐: { icon: 'movie', tone: '#0d7f95' },
    文学与写作: { icon: 'edit_note', tone: '#2c8a62' },
    政治与社会: { icon: 'public', tone: '#b33a32' },
    法律: { icon: 'gavel', tone: '#775326' },
    医学与健康: { icon: 'health_and_safety', tone: '#258a46' },
    体育与健身: { icon: 'fitness_center', tone: '#b45d19' },
    美食与烹饪: { icon: 'restaurant', tone: '#a67314' },
    旅行与地理: { icon: 'travel_explore', tone: '#256fbd' },
    游戏: { icon: 'stadia_controller', tone: '#734fb7' },
    产品与技术: { icon: 'devices', tone: '#0877a8' },
    教育: { icon: 'school', tone: '#a86614' },
    工程与制造: { icon: 'engineering', tone: '#647080' },
    生态与环境: { icon: 'eco', tone: '#2f8a45' },
    其他: { icon: 'category', tone: '#727063' },
};

const CATEGORY_EN = {
    人工智能: 'ARTIFICIAL INTELLIGENCE',
    计算机科学: 'COMPUTER SCIENCE',
    心理学: 'PSYCHOLOGY',
    哲学: 'PHILOSOPHY',
    历史: 'HISTORY',
    自然科学: 'NATURAL SCIENCE',
    数学: 'MATHEMATICS',
    经济与金融: 'ECONOMICS & FINANCE',
    商业与管理: 'BUSINESS & MANAGEMENT',
    艺术与设计: 'ART & DESIGN',
    影视与娱乐: 'FILM & ENTERTAINMENT',
    文学与写作: 'LITERATURE & WRITING',
    政治与社会: 'POLITICS & SOCIETY',
    医学与健康: 'MEDICINE & HEALTH',
    产品与技术: 'PRODUCT & TECHNOLOGY',
    教育: 'EDUCATION',
    其他: 'OPEN CATALOG',
};

function getCategoryMeta(category) {
    return CATEGORY_META[category] || { icon: 'folder', tone: '#727063' };
}

function getPlatformColor(platform) {
    const colors = { bilibili: '#00a1d6', youtube: '#ff0000', twitter: '#1d9bf0', douyin: '#111111', xiaohongshu: '#ff2442', zhihu: '#0084ff', xiaoyuzhou: '#f5c400', wechat: '#07c160', weibo: '#e6162d' };
    return colors[platform] || '#6b7280';
}

function renderBookshelf(booksData, categoriesData, container) {
    const rowContainer = document.getElementById('bookshelfRows') || container;
    rowContainer.innerHTML = '';

    const catMap = {};
    for (const cat of categoriesData) { catMap[cat.name] = { ...cat, books: [] }; }
    for (const book of booksData) {
        if (catMap[book.category]) { catMap[book.category].books.push(book); } else {
            (catMap['其他'] ||= { name: '其他', icon: 'package', books: [] }).books.push(book);
        }
    }

    const sections = Object.values(catMap).filter(c => c.books.length > 0);
    if (sections.length === 0) { rowContainer.innerHTML = ''; return; }

    for (const cat of sections) {
        const section = document.createElement('section');
        const catMeta = getCategoryMeta(cat.name);
        section.dataset.category = cat.name;
        section.className = 'knowledge-island';
        section.style.setProperty('--island-tone', pickIslandTone(cat.name));

        section.innerHTML = `
      <div class="knowledge-island-header flex items-center justify-between mb-8">
        <h2 class="font-headline text-3xl text-on-surface flex items-center gap-3">
            <span class="inline-flex w-10 h-10 items-center justify-center rounded-full border border-outline-variant/20 bg-surface-container-low shadow-[inset_0_1px_0_rgba(255,255,255,0.45)]" style="color:${catMeta.tone};">
                <span class="material-symbols-outlined text-[22px] leading-none">${escapeHtml(catMeta.icon)}</span>
            </span>
            <span>${escapeHtml(cat.name)}<small class="category-english">${escapeHtml(CATEGORY_EN[cat.name] || 'KNOWLEDGE INDEX')}</small></span>
            <span class="font-label text-xs text-on-surface-variant px-2 py-1 rounded-full bg-surface-container-high">${String(cat.books.length).padStart(2, '0')} 本</span>
        </h2>
      </div>
      <div class="grid grid-cols-3 sm:grid-cols-4 md:grid-cols-5 lg:grid-cols-6 xl:grid-cols-7 gap-x-5 gap-y-8 shelf-row"></div>
    `;

        const row = section.querySelector('.shelf-row');
        cat.books.forEach((book, i) => {
            const card = buildBookCard(book, i);
            row.appendChild(card);
        });

        rowContainer.appendChild(section);
    }
}

function buildBookCard(book, index = 0) {
    const card = document.createElement('div');
    card.className = 'kinetic-book-card group cursor-pointer';
    card.dataset.bookId = book.id;
    card.style.animationDelay = `${Math.min(index * 0.05, 0.5)}s`;

    const platformMeta = PLATFORM_META[book.platform] || { label: book.platform || '未知', icon: 'bookmark' };
    const platformLabel = platformMeta.label;
    const coverPath = book.cover_local || book.cover_url;
    const coverTitle = book.latest_entry_title || book.title || '无标题';
    const platColor = getPlatformColor(book.platform);
    const archiveDate = String(book.latest_entry_created_at || book.updated_at || book.created_at || '').slice(0, 10);
    const platformIconHtml = platformMeta.logo
        ? `<img src="${escapeHtml(platformMeta.logo)}" alt="" class="platform-official-logo" onerror="this.style.display='none';this.nextElementSibling.style.display='inline-flex'" />
           <span class="material-symbols-outlined platform-fallback-icon" style="display:none">${escapeHtml(platformMeta.icon)}</span>`
        : `<span class="material-symbols-outlined platform-fallback-icon">${escapeHtml(platformMeta.icon)}</span>`;

    const coverHtml = coverPath
        ? `<img class="w-full h-full object-cover transition-transform duration-500 group-hover:scale-[1.03]"
               src="${escapeHtml(coverPath)}" alt="${escapeHtml(book.title || '')}" loading="lazy"
               onerror="this.style.display='none';this.nextElementSibling.style.display='flex'" />
           <div class="w-full h-full items-center justify-center p-4 bg-gradient-to-br from-primary/80 to-primary-container/90" style="display:none">
              <span class="font-headline text-xl text-on-primary text-center leading-tight line-clamp-6">${escapeHtml(coverTitle)}</span>
           </div>`
        : `<div class="w-full h-full flex items-center justify-center p-4 bg-gradient-to-br from-primary/80 to-primary-container/90">
              <span class="font-headline text-xl text-on-primary text-center leading-tight line-clamp-6">${escapeHtml(coverTitle)}</span>
           </div>`;

    card.innerHTML = `
    <div class="book-cover-3d relative mb-3" style="perspective: 800px;">
        <div class="book-cover-shell w-full aspect-[2/3] rounded-sm overflow-hidden relative
                    shadow-[4px_4px_12px_rgba(28,28,22,0.08)]
                    transition-all duration-300
                    group-hover:-translate-y-1.5 group-hover:shadow-[6px_10px_24px_rgba(28,28,22,0.15)]"
             style="transform-style: preserve-3d; transition: transform 0.35s cubic-bezier(0.4,0,0.2,1), box-shadow 0.35s;">
            <!-- Book spine (left edge gradient) -->
            <div class="absolute left-0 top-0 bottom-0 w-[10px] z-20 pointer-events-none"
                 style="background: linear-gradient(90deg, rgba(0,0,0,0.35) 0%, rgba(0,0,0,0.08) 60%, transparent 100%);"></div>
            <!-- Inner highlight (simulates page edge light) -->
            <div class="absolute left-[10px] top-0 bottom-0 w-[2px] z-20 pointer-events-none"
                 style="background: linear-gradient(180deg, rgba(255,255,255,0.25) 0%, rgba(255,255,255,0.08) 100%);"></div>
            <!-- Cover image -->
            ${coverHtml}
            <!-- Bottom gradient overlay for readability -->
            <div class="absolute inset-0 bg-gradient-to-t from-black/30 via-transparent to-transparent pointer-events-none z-10"></div>
            <!-- Platform badge -->
            <span class="absolute bottom-2 right-2 z-20 px-1.5 py-0.5 rounded-sm text-[9px] font-label backdrop-blur-sm shadow-sm inline-flex items-center gap-1 platform-source-badge"
                  style="--platform-color:${platColor};">
                ${platformIconHtml}
                <span>${escapeHtml(platformLabel)}</span>
            </span>
            <!-- Entry count badge -->
            ${book.entry_count > 1 ? `<span class="absolute top-2 right-2 z-20 w-5 h-5 flex items-center justify-center rounded-full bg-primary text-on-primary text-[9px] font-bold shadow-sm">${book.entry_count}</span>` : ''}
        </div>
    </div>
    <h3 class="font-headline text-sm font-medium text-on-surface leading-snug mb-0.5 line-clamp-2">${escapeHtml(coverTitle)}</h3>
    <p class="book-card-meta font-body text-xs text-on-surface-variant line-clamp-1">${escapeHtml(book.author || platformLabel)}${archiveDate ? ` · ${escapeHtml(archiveDate)}` : ''}</p>
  `;

    card.addEventListener('click', () => window.openBookModal(book.id));
    return card;
}

function pickIslandTone(category) {
    const tones = ['#dff1ff', '#dff6e8', '#ffe6d5', '#f8dde8', '#eee5ff', '#fff1bd'];
    let hash = 0;
    for (const ch of String(category || '')) hash = (hash * 31 + ch.charCodeAt(0)) >>> 0;
    return tones[hash % tones.length];
}

function renderTimeline(entries, container) {
    const rowContainer = document.getElementById('timelineRows') || container;
    rowContainer.innerHTML = '';
    if (!entries.length) return;

    // Group entries by month (YYYY-MM)
    const groups = {};
    const groupOrder = [];
    entries.forEach(entry => {
        const d = new Date(entry.created_at);
        const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
        if (!groups[key]) { groups[key] = []; groupOrder.push(key); }
        groups[key].push(entry);
    });

    groupOrder.forEach(monthKey => {
        // ── Month anchor header ──────────────────────────────────
        const [yr, mo] = monthKey.split('-');
        const monthLabel = new Date(+yr, +mo - 1, 1).toLocaleDateString('zh-CN', { year: 'numeric', month: 'long' });
        const anchor = document.createElement('div');
        anchor.id = `month-${monthKey}`;
        anchor.className = 'flex items-center gap-4 py-2 scroll-mt-24';
        anchor.innerHTML = `
            <span class="font-headline text-2xl text-on-surface opacity-70 whitespace-nowrap">${monthLabel}</span>
            <div class="flex-1 h-px bg-outline-variant/20"></div>
            <span class="font-label text-xs text-on-surface-variant">${groups[monthKey].length} 条</span>
        `;
        rowContainer.appendChild(anchor);

        // Entries are rendered as an archival table instead of floating cards.
        groups[monthKey].forEach((entry, i) => {
            const item = document.createElement('article');
            item.className = 'archive-timeline-row cursor-pointer';
            const date = new Date(entry.created_at);
            const time = Number.isNaN(date.getTime()) ? '--:--' : date.toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit', hour12: false });
            const platformMeta = PLATFORM_META[entry.platform] || PLATFORM_META.web;
            const platformIcon = platformMeta.logo
                ? `<img class="timeline-platform" src="${escapeHtml(platformMeta.logo)}" alt="${escapeHtml(platformMeta.label)}" onerror="this.style.display='none';this.nextElementSibling.style.display='inline-flex'"/><span class="material-symbols-outlined" style="display:none">${escapeHtml(platformMeta.icon)}</span>`
                : `<span class="material-symbols-outlined">${escapeHtml(platformMeta.icon)}</span>`;
            const code = `IM-${String(entry.id || '').slice(0, 8).toUpperCase()}`;
            item.innerHTML = `
                <time class="timeline-time">${escapeHtml(time)}</time>
                <span>${platformIcon}</span>
                <h3 class="timeline-title">${escapeHtml(entry.title || '无标题')}</h3>
                <span class="timeline-author">${escapeHtml(entry.author || platformMeta.label)}</span>
                <span class="timeline-category">${escapeHtml(entry.category || '其他')}</span>
                <span class="timeline-status">已收录</span>
                <span class="timeline-code">${escapeHtml(code)}</span>
                <div class="archive-timeline-detail">${escapeHtml(entry.description || entry.summary || '点击打开内容详情与文章解读。')}</div>
            `;
            item.addEventListener('click', () => openTimelineEntry(entry));
            rowContainer.appendChild(item);
        });
    });

    const endMarker = document.createElement('div');
    endMarker.className = 'archive-timeline-end';
    endMarker.innerHTML = '<span>END OF CURRENT ARCHIVE</span>';
    rowContainer.appendChild(endMarker);
}

function openTimelineEntry(entry) {
    if (!entry) return;
    if (!entry.book_id) {
        window.openEntryModal(entry);
        return;
    }

    window.openBookModal(entry.book_id, { fallbackEntry: entry });
}

function renderSearchResults(entries, query, container) {
    container.innerHTML = `
        <h2 class="font-headline text-3xl text-on-surface mb-8">搜索：<span class="italic text-primary">${escapeHtml(query)}</span> (${entries.length})</h2>
    `;
    if (!entries.length) {
        container.innerHTML += '<p class="text-on-surface-variant text-center py-20 font-body">没有找到匹配内容。</p>';
        return;
    }
    const list = document.createElement('div');
    list.className = 'space-y-6';
    entries.forEach(entry => {
        const item = document.createElement('div');
        item.className = 'bg-surface-container-low rounded-xl p-6 flex gap-6 cursor-pointer hover:bg-surface-container-highest transition-colors border border-outline-variant/10';
        item.onclick = () => window.openEntryModal(entry);
        
        const date = formatDateTimeMinute(entry.created_at);
        const imgNode = (entry.cover_local || entry.cover_url) ? `<img src="${escapeHtml(entry.cover_local || entry.cover_url)}" class="w-24 h-24 object-cover rounded-lg flex-shrink-0" onerror="this.style.display='none'"/>` : '';
        
        item.innerHTML = `
            ${imgNode}
            <div class="flex-1">
                <h3 class="font-headline text-xl text-on-surface mb-2">${escapeHtml(entry.title || '无标题')}</h3>
                <div class="flex flex-wrap gap-2 mb-2 font-label text-xs text-on-surface-variant">
                    <span class="px-2 py-1 bg-surface rounded">${escapeHtml(entry.category)}</span>
                    ${entry.author ? `<span class="px-2 py-1 bg-surface rounded">${escapeHtml(entry.author)}</span>` : ''}
                    <span class="px-2 py-1 bg-surface rounded">${date}</span>
                </div>
            </div>
        `;
        list.appendChild(item);
    });
    container.appendChild(list);
}

function escapeHtml(str) {
    if (!str) return '';
    return String(str).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

function formatDateTimeMinute(value) {
    if (!value) return '';
    return new Date(String(value).replace(' ', 'T')).toLocaleString('zh-CN', {
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
        hour: '2-digit',
        minute: '2-digit',
        hour12: false,
    });
}

window.renderBookshelf = renderBookshelf;
window.renderTimeline = renderTimeline;
window.renderSearchResults = renderSearchResults;
window.buildBookCard = buildBookCard;
window.escapeHtml = escapeHtml;
window.getCategoryMeta = getCategoryMeta;
