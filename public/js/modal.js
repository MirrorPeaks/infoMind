// public/js/modal.js - Book and entry detail modals
let currentBookModalEntry = null;
let currentBookModalBook = null;
let bookModalAnalysisSeq = 0;
const analysisDockJobs = new Map();
let analysisDockTimer = null;

function openBookModal(bookId, options = {}) {
    const overlay = document.getElementById('modalOverlay');
    const content = document.getElementById('modalContent');
    const fallbackEntry = options?.fallbackEntry || null;

    _openOverlay(overlay);
    content.innerHTML = '<div class="w-full h-full flex items-center justify-center"><span class="material-symbols-outlined animate-spin text-4xl text-primary">autorenew</span></div>';

    api.getBook(bookId).then(res => {
        const book = res.data;
        const entries = book.entries || [];
        const platformLabel = getModalPlatformLabel(book.platform);
        const initialEntry = entries[0] || book;
        currentBookModalEntry = initialEntry;
        currentBookModalBook = book;
        const displayTitle = initialEntry.title || book.latest_entry_title || book.title || '无标题';
        
        const coverHtml = buildModalCover(initialEntry, displayTitle);

        const openOriginalHref = initialEntry.url || entries[0]?.url || '#';
        const openOriginalDisabled = openOriginalHref === '#';

        content.innerHTML = `
<!-- Left Column: Quick Info & Cover -->
<div class="w-full md:w-1/3 bg-surface-container-low p-8 flex flex-col items-center justify-center border-r border-outline-variant/10">
    <div id="bookModalCover" class="w-48 md:w-64 aspect-[2/3] bg-surface-container-high rounded-lg overflow-hidden shadow-sm mb-8 relative border border-outline-variant/10">
        ${coverHtml}
    </div>
    <div class="w-full space-y-4 text-center">
        <h2 id="bookModalTitle" class="font-headline text-3xl md:text-3xl text-on-surface leading-tight tracking-tight">${escapeHtml(displayTitle)}</h2>
        <p id="bookModalAuthor" class="font-body text-lg text-on-surface-variant ${initialEntry.author || book.author ? '' : 'hidden'}">${escapeHtml(initialEntry.author || book.author || '')}</p>
        <div class="flex flex-wrap items-center justify-center gap-2 pt-4">
            <span class="inline-flex items-center px-3 py-1 rounded-full bg-secondary-container text-on-secondary-container font-label text-sm">
                ${escapeHtml(book.category)}
            </span>
            <span class="inline-flex items-center px-3 py-1 rounded-full bg-surface-container-highest text-on-surface-variant font-label text-sm">
                ${escapeHtml(platformLabel)}
            </span>
            <span class="inline-flex items-center px-3 py-1 rounded-full bg-surface-container-highest text-on-surface-variant font-label text-sm">
                ${entries.length} Entries
            </span>
        </div>
    </div>
    <div class="w-full mt-12 space-y-3">
        <a id="bookModalOpenOriginal" href="${escapeHtml(openOriginalHref)}" target="_blank" class="w-full flex items-center justify-center gap-2 bg-primary text-on-primary py-3 px-6 rounded-lg font-body font-medium transition-colors hover:bg-primary-container ${openOriginalDisabled ? 'pointer-events-none opacity-50' : ''}">
            <span class="material-symbols-outlined">menu_book</span> Open Original
        </a>
        <button id="bookModalDeleteEntry" type="button" class="w-full flex items-center justify-center gap-2 bg-transparent text-error py-3 px-6 rounded-lg font-body font-medium transition-colors hover:bg-error-container hover:text-on-error-container">
            <span class="material-symbols-outlined">delete</span> Delete Entry
        </button>
    </div>
</div>

<!-- Right Column: Content & AI Summary -->
<div class="w-full md:w-2/3 bg-surface p-8 md:p-12 flex flex-col relative overflow-y-auto">
    <button onclick="closeModal()" class="absolute top-6 right-6 p-2 rounded-full text-on-surface-variant hover:bg-surface-container-highest transition-colors">
        <span class="material-symbols-outlined">close</span>
    </button>
    
    <nav class="flex gap-8 mb-12 border-b border-outline-variant/20 pb-4">
        <button class="font-body text-primary font-bold border-b-2 border-primary pb-4 -mb-[18px]">AI Summary</button>
    </nav>
    
    <div class="space-y-12 max-w-2xl text-on-surface-variant font-body">
        <section id="bookModalInsightSection" class="${initialEntry?.summary ? '' : 'hidden'}">
            <div class="flex items-center gap-3 mb-6">
                <div class="w-8 h-8 rounded-full bg-secondary-container flex items-center justify-center">
                    <span class="material-symbols-outlined text-on-secondary-container text-sm">auto_awesome</span>
                </div>
                <h3 class="font-headline text-2xl text-on-surface tracking-tight">AI Generated Insight</h3>
            </div>
            <p id="bookModalInsightText" class="font-body text-lg leading-relaxed text-on-surface-variant break-words">
                ${escapeHtml(initialEntry?.summary || '').replace(/\n/g, '<br/>')}
            </p>
        </section>
        
        ${entries.length > 0 ? `
        <section class="pt-8 border-t border-outline-variant/20">
            <h3 class="font-headline text-2xl text-on-surface tracking-tight mb-6">Contained Entries</h3>
            <div class="space-y-4" id="containedEntriesList">
                ${entries.map((e, i) => `
                <button type="button" data-entry-index="${i}" class="contained-entry w-full text-left flex items-start gap-4 p-4 rounded-xl border ${i === 0 ? 'active border-primary/40 bg-surface-container-low' : 'border-outline-variant/20 bg-surface-container-lowest'} hover:bg-surface-container-low transition-colors focus:outline-none focus:ring-2 focus:ring-primary/40">
                    <span class="w-8 h-8 flex-shrink-0 flex items-center justify-center rounded bg-surface-container-high font-bold text-sm text-on-surface-variant">${i + 1}</span>
                    <span class="flex-1 min-w-0">
                        <span class="block font-body font-medium text-sm text-on-surface truncate">${escapeHtml(e.title || e.url)}</span>
                        <span class="block text-xs text-on-surface-variant mt-1">${formatDateTimeMinute(e.created_at)}</span>
                    </span>
                </button>`).join('')}
            </div>
        </section>
        ` : ''}

        <section class="pt-8 border-t border-outline-variant/20">
            <div class="flex items-center justify-between gap-4 mb-6">
                <div class="flex items-center gap-3">
                    <div class="w-8 h-8 rounded-full bg-primary-container flex items-center justify-center">
                        <span class="material-symbols-outlined text-primary text-sm">account_tree</span>
                    </div>
                    <h3 class="font-headline text-2xl text-on-surface tracking-tight">Article Mind Map</h3>
                </div>
                <span id="bookModalMindMapMeta" class="font-label text-xs uppercase tracking-[0.16em] text-on-surface-variant/70">${escapeHtml(getModalPlatformLabel(initialEntry?.platform || book.platform))}</span>
            </div>
            <div id="bookModalMindMap">${buildAnalysisLoadingState('正在读取已有解读...')}</div>
        </section>
    </div>
</div>
        `;

        bindBookEntryInteractions(entries, book);
        bindBookDeleteButton(book);
        updateBookModalAnalysis(initialEntry, book);
    }).catch(err => {
        if (fallbackEntry?.id) {
            content.innerHTML = buildBrokenEntryRecoveryState(fallbackEntry, err);
            return;
        }
        content.innerHTML = `
            <div class="w-full h-full bg-surface p-10 flex items-start justify-center">
                <div class="max-w-lg rounded-3xl border border-error/20 bg-error-container/10 p-8 text-left">
                    <div class="w-11 h-11 rounded-full bg-error-container text-error flex items-center justify-center mb-5">
                        <span class="material-symbols-outlined">error</span>
                    </div>
                    <h3 class="font-headline text-3xl text-on-surface mb-3">加载失败</h3>
                    <p class="font-body text-on-surface-variant">${escapeHtml(err.message || 'Book not found')}</p>
                    <button type="button" onclick="closeModal()" class="mt-6 rounded-lg bg-primary text-on-primary px-5 py-3 font-body text-sm">关闭</button>
                </div>
            </div>`;
    });
}

function buildModalCover(item, fallbackTitle) {
    const title = item?.title || fallbackTitle || '无标题';
    const coverPath = item?.cover_local || item?.cover_url;
    return coverPath
        ? `<img alt="${escapeHtml(title)}" class="w-full h-full object-cover" src="${escapeHtml(coverPath)}" onerror="this.style.display='none';this.nextElementSibling.style.display='flex'" />
               <div class="w-full h-full bg-surface p-6 items-center justify-center" style="display:none"><span class="font-headline text-2xl text-on-surface text-center leading-tight">${escapeHtml(title)}</span></div>`
        : `<div class="w-full h-full bg-surface p-6 flex items-center justify-center"><span class="font-headline text-2xl text-on-surface text-center leading-tight">${escapeHtml(title)}</span></div>`;
}

function buildAnalysisLoadingState(message = '正在生成真实内容解读...') {
    return `
        <div class="min-h-[360px] rounded-3xl border border-primary/15 bg-surface-container-lowest/70 flex flex-col items-center justify-center text-center p-8">
            <span class="material-symbols-outlined animate-spin text-4xl text-primary mb-4">autorenew</span>
            <p class="font-body text-on-surface">${escapeHtml(message)}</p>
            <p class="font-body text-sm text-on-surface-variant mt-2">长内容会分段摘要后再合并，避免浪费 token。</p>
        </div>
    `;
}

function buildAnalysisProgressState(analysis, entry) {
    const progress = Math.max(3, Math.min(99, Number(analysis?.progress || 8)));
    const stage = analysis?.stage || '任务处理中';
    return `
        <div class="min-h-[320px] rounded-3xl border border-primary/15 bg-surface-container-lowest/80 p-8 flex flex-col justify-center">
            <div class="flex items-start gap-4 mb-8">
                <div class="w-11 h-11 rounded-full bg-primary-container text-primary flex items-center justify-center shrink-0">
                    <span class="material-symbols-outlined animate-spin">autorenew</span>
                </div>
                <div class="min-w-0">
                    <div class="font-label text-xs uppercase tracking-[0.16em] text-primary mb-2">Background Analysis</div>
                    <h4 class="font-headline text-2xl text-on-surface mb-2">${escapeHtml(stage)}</h4>
                    <p class="font-body text-sm text-on-surface-variant leading-relaxed">
                        正在为「${escapeHtml(entry?.title || '当前内容')}」生成真实解读。你可以关闭详情页继续浏览，任务会在后台完成。
                    </p>
                </div>
            </div>
            <div class="h-2 rounded-full bg-surface-container-high overflow-hidden">
                <div class="h-full rounded-full bg-primary transition-all duration-500" style="width:${progress}%"></div>
            </div>
            <div class="mt-3 flex justify-between font-label text-xs text-on-surface-variant">
                <span>${escapeHtml(stage)}</span>
                <span>${progress}%</span>
            </div>
        </div>
    `;
}

function buildAnalysisEmptyState(entry) {
    return `
        <div class="min-h-[360px] rounded-3xl border border-primary/15 bg-[linear-gradient(135deg,rgba(250,249,239,0.96),rgba(241,246,231,0.94))] p-8 flex flex-col justify-center">
            <div class="w-12 h-12 rounded-full bg-primary-container text-primary flex items-center justify-center mb-5">
                <span class="material-symbols-outlined">account_tree</span>
            </div>
            <h4 class="font-headline text-2xl text-on-surface mb-3">尚未生成真实解读</h4>
            <p class="font-body text-on-surface-variant leading-relaxed mb-6">
                InfoMind 会先读取可获取正文、播客文稿或转录文本，再调用 LLM 生成结构化思维导图。不会仅凭标题和封面伪造导图。
            </p>
            <button type="button" data-analysis-action="generate" data-entry-id="${escapeHtml(entry?.id || '')}" class="w-fit inline-flex items-center gap-2 rounded-lg bg-primary text-on-primary px-5 py-3 font-body font-medium hover:bg-primary-container transition-colors">
                <span class="material-symbols-outlined text-[18px]">auto_awesome</span>
                生成文章解读
            </button>
        </div>
    `;
}

function buildAnalysisNeedsContentState(analysis, entry) {
    const result = analysis?.result || {};
    const isVideo = isEntryVideoLike(entry);
    const setupCommand = result.setup_command || (result.setup_action === 'install_local_stt' ? 'npm run setup:stt' : '');
    return `
        <div class="min-h-[360px] rounded-3xl border border-outline-variant/30 bg-surface-container-lowest p-8">
            <div class="flex items-start gap-4">
                <div class="w-10 h-10 rounded-full bg-surface-container-high text-on-surface-variant flex items-center justify-center shrink-0">
                    <span class="material-symbols-outlined">travel_explore</span>
                </div>
                <div>
                    <h4 class="font-headline text-2xl text-on-surface mb-3">需要更多正文</h4>
                    <p class="font-body text-on-surface-variant leading-relaxed">${escapeHtml(result.reason || analysis?.error || '当前内容不足，无法生成可信导图。')}</p>
                    <p class="font-body text-sm text-on-surface-variant mt-4">需要内容：${escapeHtml(result.required_content || '正文、字幕或转录文本')}</p>
                    <div class="mt-6 flex flex-wrap gap-3">
                        <button type="button" data-analysis-action="generate" data-entry-id="${escapeHtml(entry?.id || '')}" class="inline-flex items-center gap-2 rounded-lg bg-primary text-on-primary px-5 py-3 font-body font-medium hover:bg-primary-container transition-colors">
                            <span class="material-symbols-outlined text-[18px]">autorenew</span>
                            ${isVideo ? '重新查找字幕/转写' : '重新生成解读'}
                        </button>
                    </div>
                </div>
            </div>
            ${setupCommand ? `
            <div class="mt-8 rounded-2xl bg-primary/5 p-5 border border-primary/15">
                <div class="font-label text-xs uppercase tracking-[0.16em] text-primary mb-2">本地转写组件</div>
                <p class="font-body text-sm leading-relaxed text-on-surface-variant mb-3">
                    当前环境还不能处理无字幕视频。先在 InfoMind 项目目录运行下面命令安装开源转写工具和默认 Whisper 模型。
                </p>
                <code class="block px-3 py-2 rounded-lg bg-surface-container-lowest border border-outline-variant/20 font-mono text-sm text-on-surface break-all">${escapeHtml(setupCommand)}</code>
            </div>` : ''}
            <div class="mt-8 rounded-2xl bg-surface-container-low p-5 border border-outline-variant/20">
                <div class="font-label text-xs uppercase tracking-[0.16em] text-on-surface-variant mb-2">浏览器插件建议</div>
                <p class="font-body text-sm leading-relaxed text-on-surface-variant">
                    对抖音、小红书、知乎等登录内容，优先在已登录浏览器里使用 InfoMind Clipper 重新收录当前页面。插件会读取页面可见正文、图片、字幕或描述，不需要配置 cookie。
                </p>
                <p class="font-body text-xs leading-relaxed text-on-surface-variant/80 mt-3">
                    高级用户也可以让 Hermes/OpenClaw 做 OCR、转写或批处理，然后回写到 <code class="px-1 rounded bg-surface">PUT /api/entries/${escapeHtml(entry?.id || ':id')}/content</code>。
                </p>
            </div>
        </div>
    `;
}

function isEntryVideoLike(entry) {
    if (!entry) return false;
    if (['bilibili', 'youtube'].includes(entry.platform)) return true;
    if (entry.platform !== 'douyin') return false;
    const source = entry.source_data || {};
    const type = String(source.content_type || '').toLowerCase();
    if (['note', 'image', 'images', 'photo', 'photos'].includes(type)) return false;
    if (['video', 'aweme_video'].includes(type)) return true;
    if (source.video_url || source.videoUrl || source.play_addr || source.playAddr) return true;
    const url = `${entry.url || ''} ${source.final_url || ''}`.toLowerCase();
    if (url.includes('/note/')) return false;
    return url.includes('/video/');
}

function buildAnalysisFailedState(analysis, entry) {
    return `
        <div class="min-h-[300px] rounded-3xl border border-error/20 bg-error-container/20 p-8">
            <h4 class="font-headline text-2xl text-on-surface mb-3">解读生成失败</h4>
            <p class="font-body text-on-surface-variant leading-relaxed mb-6">${escapeHtml(analysis?.error || '生成失败，请稍后重试。')}</p>
            <button type="button" data-analysis-action="generate" data-entry-id="${escapeHtml(entry?.id || '')}" class="inline-flex items-center gap-2 rounded-lg bg-primary text-on-primary px-5 py-3 font-body font-medium">
                <span class="material-symbols-outlined text-[18px]">refresh</span>
                重试生成
            </button>
        </div>
    `;
}

function buildRealAnalysisMindMap(analysis, entry) {
    const result = analysis?.result || {};
    const mindMap = result.mind_map || {};
    const nodes = Array.isArray(mindMap.nodes) ? mindMap.nodes.slice(0, 6) : [];
    const chips = [
        entry?.category,
        getModalPlatformLabel(entry?.platform),
        analysis?.token_budget === 'chunked' ? '分段解读' : '直接解读',
        analysis?.source_kind,
    ].filter(Boolean).slice(0, 4);

    return `
        <div class="rounded-3xl border border-primary/20 bg-[radial-gradient(circle_at_50%_12%,rgba(183,230,153,0.22),transparent_32%),linear-gradient(135deg,rgba(250,249,239,0.96),rgba(241,246,231,0.94))] p-5 md:p-6 shadow-[inset_0_1px_0_rgba(255,255,255,0.72)]">
            <div class="rounded-3xl border border-primary/20 bg-surface-container-lowest px-5 py-4 text-center shadow-[0_18px_50px_rgba(28,28,22,0.08)] mb-5">
                <div class="font-label text-[10px] uppercase tracking-[0.2em] text-primary mb-2">Real Content Analysis</div>
                <div class="font-headline text-xl leading-tight text-on-surface">${escapeHtml(mindMap.root || result.title || entry?.title || '内容解读')}</div>
                ${result.thesis ? `<p class="mt-3 font-body text-sm text-on-surface-variant leading-relaxed">${escapeHtml(result.thesis)}</p>` : ''}
                <div class="mt-3 flex flex-wrap items-center justify-center gap-2">
                    ${chips.map(chip => `<span class="px-2.5 py-1 rounded-full bg-secondary-container text-on-secondary-container text-xs font-label">${escapeHtml(chip)}</span>`).join('')}
                </div>
            </div>

            <div class="grid md:grid-cols-2 gap-3">
                ${nodes.map((node, index) => `
                    <article class="rounded-2xl border border-outline-variant/20 bg-surface-container-lowest/95 p-4 shadow-[0_12px_32px_rgba(28,28,22,0.06)]">
                        <div class="flex items-center gap-2 mb-3">
                            <span class="w-7 h-7 rounded-full ${index % 2 ? 'bg-primary-container text-primary' : 'bg-secondary-container text-on-secondary-container'} inline-flex items-center justify-center shrink-0">
                                <span class="material-symbols-outlined text-[15px] leading-none">${index % 2 ? 'route' : 'tips_and_updates'}</span>
                            </span>
                            <h4 class="font-label text-xs uppercase tracking-[0.14em] text-on-surface-variant">${escapeHtml(node.label || '要点')}</h4>
                        </div>
                        ${node.summary ? `<p class="font-body text-sm text-on-surface-variant leading-relaxed mb-3">${escapeHtml(node.summary)}</p>` : ''}
                        <ul class="space-y-3">
                            ${(node.children || []).map(child => `
                                <li class="font-body text-sm leading-snug text-on-surface">
                                    <div class="flex gap-2">
                                        <span class="mt-[0.45em] w-1.5 h-1.5 rounded-full bg-primary/70 shrink-0"></span>
                                        <span>${escapeHtml(child.label || '知识点')}</span>
                                    </div>
                                    ${child.detail ? `<p class="pl-3 mt-1 text-on-surface-variant leading-relaxed">${escapeHtml(child.detail)}</p>` : ''}
                                    ${child.evidence ? `<p class="pl-3 mt-1 text-xs text-on-surface-variant/75 leading-relaxed">证据：${escapeHtml(child.evidence)}</p>` : ''}
                                </li>
                            `).join('')}
                        </ul>
                    </article>
                `).join('')}
            </div>

            ${result.knowledge_points?.length ? `
            <div class="mt-5 rounded-2xl bg-surface-container-lowest/80 border border-outline-variant/20 p-4">
                <div class="font-label text-xs uppercase tracking-[0.16em] text-on-surface-variant mb-2">Knowledge Points</div>
                <div class="flex flex-wrap gap-2">
                    ${result.knowledge_points.map(point => `<span class="px-2.5 py-1 rounded-full bg-surface-container-high text-on-surface-variant text-xs font-label">${escapeHtml(point)}</span>`).join('')}
                </div>
            </div>` : ''}

            ${result.limitations?.length ? `
            <div class="mt-4 font-body text-xs leading-relaxed text-on-surface-variant/75">
                ${result.limitations.map(item => `<div>限制：${escapeHtml(item)}</div>`).join('')}
            </div>` : ''}
        </div>
    `;
}

function bindBookEntryInteractions(entries, book) {
    const list = document.getElementById('containedEntriesList');
    if (!list) return;

    const selectEntry = (entry, button) => {
        currentBookModalEntry = entry;
        currentBookModalBook = book;
        const title = entry.title || entry.url || '无标题';
        const author = entry.author || book.author || '';
        document.getElementById('bookModalCover').innerHTML = buildModalCover(entry, title);
        document.getElementById('bookModalTitle').textContent = title;
        const authorEl = document.getElementById('bookModalAuthor');
        authorEl.textContent = author;
        authorEl.classList.toggle('hidden', !author);
        const openBtn = document.getElementById('bookModalOpenOriginal');
        openBtn.href = entry.url || '#';
        openBtn.classList.toggle('pointer-events-none', !entry.url);
        openBtn.classList.toggle('opacity-50', !entry.url);
        updateBookModalInsight(entry);
        updateBookModalAnalysis(entry, book);
        list.querySelectorAll('.contained-entry').forEach(el => {
            el.classList.remove('active', 'border-primary/40', 'bg-surface-container-low');
            el.classList.add('border-outline-variant/20', 'bg-surface-container-lowest');
        });
        button?.classList.remove('border-outline-variant/20', 'bg-surface-container-lowest');
        button?.classList.add('active', 'border-primary/40', 'bg-surface-container-low');
    };

    list.querySelectorAll('.contained-entry').forEach(button => {
        const entry = entries[Number(button.dataset.entryIndex)];
        button.addEventListener('click', () => selectEntry(entry, button));
        button.addEventListener('dblclick', () => {
            if (entry?.url) window.open(entry.url, '_blank', 'noopener');
        });
    });
}

function bindBookDeleteButton(book) {
    const button = document.getElementById('bookModalDeleteEntry');
    if (!button) return;
    button.addEventListener('click', () => {
        if (!currentBookModalEntry?.id) return;
        confirmDeleteEntryFromBook(currentBookModalEntry, book);
    });
}

function updateBookModalInsight(entry) {
    const section = document.getElementById('bookModalInsightSection');
    const text = document.getElementById('bookModalInsightText');
    if (!section || !text) return;
    section.classList.toggle('hidden', !entry?.summary);
    text.innerHTML = escapeHtml(entry?.summary || '').replace(/\n/g, '<br/>');
}

async function updateBookModalAnalysis(entry, book) {
    const seq = ++bookModalAnalysisSeq;
    const container = document.getElementById('bookModalMindMap');
    if (!container || !entry?.id) return;
    const meta = document.getElementById('bookModalMindMapMeta');
    if (meta) meta.textContent = getModalPlatformLabel(entry?.platform || book.platform);
    if (container.dataset.analysisStatus !== 'processing') {
        container.innerHTML = buildAnalysisLoadingState('正在读取已有解读...');
    }
    try {
        const res = await api.getEntryAnalysis(entry.id);
        if (seq !== bookModalAnalysisSeq) return;
        renderBookModalAnalysis(res.data, entry, book);
        if (res.data?.status === 'processing') {
            trackAnalysisJob(entry, book, res.data);
            setTimeout(() => {
                if (seq === bookModalAnalysisSeq && currentBookModalEntry?.id === entry.id) {
                    updateBookModalAnalysis(entry, book);
                }
            }, 1800);
        }
    } catch (err) {
        if (seq !== bookModalAnalysisSeq) return;
        container.innerHTML = buildAnalysisEmptyState(entry);
        bindAnalysisPanelAction(entry, book);
    }
}

function renderBookModalAnalysis(analysis, entry, book) {
    const container = document.getElementById('bookModalMindMap');
    if (!container) return;
    container.dataset.analysisStatus = analysis?.status || 'empty';

    if (!analysis) {
        container.innerHTML = buildAnalysisEmptyState(entry);
    } else if (analysis.status === 'done') {
        container.innerHTML = buildRealAnalysisMindMap(analysis, entry);
    } else if (analysis.status === 'needs_content') {
        container.innerHTML = buildAnalysisNeedsContentState(analysis, entry);
    } else if (analysis.status === 'failed') {
        container.innerHTML = buildAnalysisFailedState(analysis, entry);
    } else if (analysis.status === 'processing') {
        container.innerHTML = buildAnalysisProgressState(analysis, entry);
    } else {
        container.innerHTML = buildAnalysisLoadingState('解读任务处理中...');
    }
    bindAnalysisPanelAction(entry, book);
}

function bindAnalysisPanelAction(entry, book) {
    const button = document.querySelector('#bookModalMindMap [data-analysis-action="generate"]');
    if (!button || !entry?.id) return;
    button.addEventListener('click', async () => {
        const container = document.getElementById('bookModalMindMap');
        if (!container) return;
        container.innerHTML = buildAnalysisLoadingState('正在生成真实内容解读...');
        try {
            const res = await api.analyzeEntry(entry.id, { force: true });
            trackAnalysisJob(entry, book, res.data);
            renderBookModalAnalysis(res.data, entry, book);
            updateBookModalAnalysis(entry, book);
        } catch (err) {
            container.innerHTML = buildAnalysisFailedState({ error: err.message }, entry);
            bindAnalysisPanelAction(entry, book);
        }
    });
}

function trackAnalysisJob(entry, book, analysis) {
    if (!entry?.id) return;
    analysisDockJobs.set(entry.id, {
        entry,
        book,
        analysis: analysis || {},
        doneAt: null,
    });
    renderAnalysisDock();
    ensureAnalysisDockTimer();
}

function ensureAnalysisDockTimer() {
    if (analysisDockTimer) return;
    analysisDockTimer = setInterval(refreshAnalysisDockJobs, 1800);
}

async function refreshAnalysisDockJobs() {
    if (!analysisDockJobs.size) {
        clearInterval(analysisDockTimer);
        analysisDockTimer = null;
        renderAnalysisDock();
        return;
    }

    const now = Date.now();
    for (const [entryId, job] of analysisDockJobs.entries()) {
        try {
            const res = await api.getEntryAnalysis(entryId);
            job.analysis = res.data || {};
            if (['done', 'failed', 'needs_content'].includes(job.analysis.status)) {
                job.doneAt ||= now;
                if (now - job.doneAt > 4500) analysisDockJobs.delete(entryId);
            }
        } catch {
            job.doneAt ||= now;
            if (now - job.doneAt > 4500) analysisDockJobs.delete(entryId);
        }
    }
    renderAnalysisDock();
}

function renderAnalysisDock() {
    let dock = document.getElementById('analysisProgressDock');
    if (!analysisDockJobs.size) {
        dock?.remove();
        return;
    }
    if (!dock) {
        dock = document.createElement('div');
        dock.id = 'analysisProgressDock';
        dock.className = 'fixed right-5 bottom-5 z-[220] w-[320px] max-w-[calc(100vw-2.5rem)] space-y-3';
        document.body.appendChild(dock);
    }
    dock.innerHTML = Array.from(analysisDockJobs.values()).map(job => buildAnalysisDockCard(job)).join('');
}

function buildAnalysisDockCard(job) {
    const entry = job.entry || {};
    const analysis = job.analysis || {};
    const status = analysis.status || 'processing';
    const progress = status === 'done' ? 100 : Math.max(3, Math.min(99, Number(analysis.progress || 8)));
    const cover = entry.cover_local || entry.cover_url;
    const statusLabel = status === 'done' ? '完成' : status === 'failed' ? '失败' : status === 'needs_content' ? '需要内容' : (analysis.stage || '处理中');
    const tone = status === 'failed' ? 'bg-error' : status === 'needs_content' ? 'bg-outline' : 'bg-primary';
    return `
        <div class="rounded-2xl border border-outline-variant/20 bg-surface-container-lowest/95 shadow-[0_18px_60px_rgba(28,28,22,0.16)] backdrop-blur p-3">
            <div class="flex gap-3">
                <div class="w-12 h-16 rounded-md bg-surface-container-high overflow-hidden shrink-0">
                    ${cover ? `<img src="${escapeHtml(cover)}" alt="" class="w-full h-full object-cover" onerror="this.style.display='none'" />` : `<div class="w-full h-full flex items-center justify-center"><span class="material-symbols-outlined text-on-surface-variant">account_tree</span></div>`}
                </div>
                <div class="min-w-0 flex-1">
                    <div class="flex items-center justify-between gap-2 mb-1">
                        <span class="font-label text-[10px] uppercase tracking-[0.14em] text-primary">Mind Map</span>
                        <span class="font-label text-xs text-on-surface-variant">${progress}%</span>
                    </div>
                    <div class="font-body text-sm text-on-surface font-medium truncate">${escapeHtml(entry.title || '内容解读')}</div>
                    <div class="font-body text-xs text-on-surface-variant mt-1 truncate">${escapeHtml(statusLabel)}</div>
                    <div class="mt-3 h-1.5 bg-surface-container-high rounded-full overflow-hidden">
                        <div class="h-full ${tone} rounded-full transition-all duration-500" style="width:${progress}%"></div>
                    </div>
                </div>
            </div>
        </div>
    `;
}

function formatDateTimeMinute(value) {
    if (!value) return '';
    return new Date(value.replace(' ', 'T')).toLocaleString('zh-CN', {
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
        hour: '2-digit',
        minute: '2-digit',
        hour12: false,
    });
}

function openEntryModal(entry) {
    const overlay = document.getElementById('modalOverlay');
    const content = document.getElementById('modalContent');

    _openOverlay(overlay);
    
    const tags = Array.isArray(entry.tags) ? entry.tags : [];
    const entryCoverPath = entry.cover_local || entry.cover_url;
    const coverHtml = entryCoverPath
        ? `<img alt="${escapeHtml(entry.title)}" class="w-full h-full object-cover" src="${escapeHtml(entryCoverPath)}" onerror="this.style.display='none'" />`
        : `<div class="w-full h-full bg-surface flex items-center justify-center"><span class="material-symbols-outlined text-4xl text-outline-variant">description</span></div>`;

    content.innerHTML = `
<div class="w-full md:w-1/3 bg-surface-container-low p-8 flex flex-col items-center justify-center border-r border-outline-variant/10">
    <div class="w-48 md:w-64 aspect-[2/3] bg-surface-container-high rounded-lg overflow-hidden shadow-sm mb-8 relative border border-outline-variant/10">
        ${coverHtml}
    </div>
    <div class="w-full space-y-4 text-center">
        <h2 class="font-headline text-3xl md:text-3xl text-on-surface leading-tight tracking-tight">${escapeHtml(entry.title || '无标题')}</h2>
        ${entry.author ? `<p class="font-body text-lg text-on-surface-variant">${escapeHtml(entry.author)}</p>` : ''}
        <div class="flex flex-wrap items-center justify-center gap-2 pt-4">
            <span class="inline-flex items-center px-3 py-1 rounded-full bg-secondary-container text-on-secondary-container font-label text-sm">
                ${escapeHtml(entry.category)}
            </span>
            <span class="inline-flex items-center px-3 py-1 rounded-full bg-surface-container-highest text-on-surface-variant font-label text-sm">
                ${escapeHtml(getModalPlatformLabel(entry.platform))}
            </span>
        </div>
        <div class="flex flex-wrap items-center justify-center gap-2">
            ${tags.map(t => `<span class="inline-flex items-center px-3 py-1 rounded-full bg-surface border border-outline-variant/30 text-on-surface-variant font-label text-xs">#${escapeHtml(t)}</span>`).join('')}
        </div>
    </div>
    <div class="w-full mt-12 space-y-3">
        <a href="${escapeHtml(entry.url)}" target="_blank" class="w-full flex items-center justify-center gap-2 bg-primary text-on-primary py-3 px-6 rounded-lg font-body font-medium transition-colors hover:bg-primary-container">
            <span class="material-symbols-outlined">menu_book</span> Open Original
        </a>
        <button onclick="confirmDeleteEntry('${entry.id}')" class="w-full flex items-center justify-center gap-2 bg-transparent text-error py-3 px-6 rounded-lg font-body font-medium transition-colors hover:bg-error-container hover:text-on-error-container">
            <span class="material-symbols-outlined">delete</span> Delete Entry
        </button>
    </div>
</div>

<div class="w-full md:w-2/3 bg-surface p-8 md:p-12 flex flex-col relative overflow-y-auto">
    <button onclick="closeModal()" class="absolute top-6 right-6 p-2 rounded-full text-on-surface-variant hover:bg-surface-container-highest transition-colors">
        <span class="material-symbols-outlined">close</span>
    </button>
    
    <nav class="flex gap-8 mb-12 border-b border-outline-variant/20 pb-4">
        <button class="font-body text-primary font-bold border-b-2 border-primary pb-4 -mb-[18px]">AI Summary</button>
    </nav>
    
    <div class="space-y-12 max-w-2xl text-on-surface-variant font-body">
        ${entry.summary ? `
        <section>
            <div class="flex items-center gap-3 mb-6">
                <div class="w-8 h-8 rounded-full bg-secondary-container flex items-center justify-center">
                    <span class="material-symbols-outlined text-on-secondary-container text-sm">auto_awesome</span>
                </div>
                <h3 class="font-headline text-2xl text-on-surface tracking-tight">AI Generated Insight</h3>
            </div>
            <p class="font-body text-lg leading-relaxed text-on-surface-variant break-words">
                ${escapeHtml(entry.summary).replace(/\n/g, '<br/>')}
            </p>
        </section>
        ` : ''}
        
        ${entry.note ? `
        <section class="pt-8 border-t border-outline-variant/20">
            <h3 class="font-headline text-2xl text-on-surface tracking-tight mb-6">Notes</h3>
            <p class="font-body text-lg leading-relaxed text-on-surface-variant">
                ${escapeHtml(entry.note).replace(/\n/g, '<br/>')}
            </p>
        </section>
        ` : ''}
    </div>
</div>
    `;
}

function getModalPlatformLabel(platform) {
    if (typeof PLATFORM_LABELS !== 'undefined' && PLATFORM_LABELS[platform]) return PLATFORM_LABELS[platform];
    return platform || 'web';
}

function confirmDeleteEntry(entryId) {
    showDeleteConfirmDialog({
        title: '删除这条内容？',
        description: '删除后会从书架、时间线和解读缓存中移除。',
        itemTitle: '当前内容',
        onConfirm: () => api.deleteEntry(entryId).then(() => {
            closeModal();
            window.showToast('已删除', 'success');
            window.loadData();
        }),
    });
}

function buildBrokenEntryRecoveryState(entry, err) {
    const title = entry.title || entry.url || '无标题';
    const reason = err?.message || 'Book not found';
    const platformLabel = getModalPlatformLabel(entry.platform);
    return `
        <div class="w-full h-full bg-surface p-8 md:p-12 overflow-y-auto">
            <button onclick="closeModal()" class="absolute top-6 right-6 p-2 rounded-full text-on-surface-variant hover:bg-surface-container-highest transition-colors">
                <span class="material-symbols-outlined">close</span>
            </button>
            <div class="max-w-2xl">
                <div class="w-12 h-12 rounded-full bg-error-container text-error flex items-center justify-center mb-6">
                    <span class="material-symbols-outlined">database_off</span>
                </div>
                <h2 class="font-headline text-4xl text-on-surface leading-tight mb-4">这条收录数据可能已损坏</h2>
                <p class="font-body text-on-surface-variant leading-relaxed mb-8">
                    当前条目指向的书籍不存在，所以无法打开完整详情。你可以打开原链接确认，也可以直接删除这条坏数据。
                </p>
                <div class="rounded-2xl border border-outline-variant/20 bg-surface-container-lowest p-5 mb-8">
                    <div class="font-label text-xs uppercase tracking-[0.16em] text-on-surface-variant mb-3">Broken Entry</div>
                    <h3 class="font-headline text-2xl text-on-surface mb-3 break-words">${escapeHtml(title)}</h3>
                    <div class="flex flex-wrap gap-2 mb-4">
                        <span class="inline-flex items-center px-3 py-1 rounded-full bg-surface-container-high text-on-surface-variant font-label text-xs">${escapeHtml(platformLabel)}</span>
                        ${entry.category ? `<span class="inline-flex items-center px-3 py-1 rounded-full bg-secondary-container text-on-secondary-container font-label text-xs">${escapeHtml(entry.category)}</span>` : ''}
                    </div>
                    <p class="font-body text-sm text-on-surface-variant break-all">${escapeHtml(entry.url || '')}</p>
                    <p class="font-body text-xs text-error mt-4">错误：${escapeHtml(reason)}</p>
                </div>
                <div class="flex flex-wrap gap-3">
                    ${entry.url ? `<a href="${escapeHtml(entry.url)}" target="_blank" class="inline-flex items-center gap-2 rounded-lg bg-primary text-on-primary px-5 py-3 font-body font-medium">
                        <span class="material-symbols-outlined text-[18px]">open_in_new</span>
                        打开原链接
                    </a>` : ''}
                    <button type="button" onclick="confirmDeleteEntry('${escapeHtml(entry.id)}')" class="inline-flex items-center gap-2 rounded-lg bg-error text-on-error px-5 py-3 font-body font-medium">
                        <span class="material-symbols-outlined text-[18px]">delete</span>
                        删除这条收录
                    </button>
                    <button type="button" onclick="window.openEntryModal(JSON.parse(decodeURIComponent('${encodeURIComponent(JSON.stringify(entry))}')))" class="inline-flex items-center gap-2 rounded-lg bg-surface-container-high text-on-surface px-5 py-3 font-body font-medium">
                        <span class="material-symbols-outlined text-[18px]">article</span>
                        查看条目详情
                    </button>
                </div>
            </div>
        </div>
    `;
}

function confirmDeleteEntryFromBook(entry, book) {
    showDeleteConfirmDialog({
        title: '删除当前选中的内容？',
        description: '只会删除这一篇内容，不会删除整本书中的其他收录。',
        itemTitle: entry.title || entry.url || '无标题',
        onConfirm: async () => {
            await api.deleteEntry(entry.id);
            window.showToast('已删除当前内容', 'success');
            window.loadData();
            try {
                const nextBook = await api.getBook(book.id);
                if (nextBook.data?.entries?.length) {
                    openBookModal(book.id);
                    return;
                }
            } catch {}
            closeModal();
        },
    });
}

function showDeleteConfirmDialog({ title, description, itemTitle, onConfirm }) {
    document.getElementById('deleteConfirmOverlay')?.remove();
    const overlay = document.createElement('div');
    overlay.id = 'deleteConfirmOverlay';
    overlay.className = 'fixed inset-0 z-[260] bg-on-surface/25 backdrop-blur-sm flex items-center justify-center p-6';
    overlay.innerHTML = `
        <div class="w-full max-w-md rounded-2xl bg-surface-container-lowest border border-outline-variant/20 shadow-[0_24px_80px_rgba(28,28,22,0.22)] overflow-hidden">
            <div class="p-7">
                <div class="w-11 h-11 rounded-full bg-error-container text-error flex items-center justify-center mb-5">
                    <span class="material-symbols-outlined">delete</span>
                </div>
                <h3 class="font-headline text-3xl text-on-surface mb-3">${escapeHtml(title)}</h3>
                <p class="font-body text-sm text-on-surface-variant leading-relaxed mb-5">${escapeHtml(description)}</p>
                <div class="rounded-xl bg-surface-container-low border border-outline-variant/20 px-4 py-3 font-body text-sm text-on-surface leading-snug">
                    ${escapeHtml(itemTitle)}
                </div>
            </div>
            <div class="px-7 py-5 bg-surface-container-low flex justify-end gap-3">
                <button type="button" data-delete-cancel class="px-5 py-2.5 rounded-lg bg-surface-container-high text-on-surface font-body text-sm hover:bg-surface-container-highest">取消</button>
                <button type="button" data-delete-confirm class="px-5 py-2.5 rounded-lg bg-error text-on-error font-body text-sm hover:opacity-90">确认删除</button>
            </div>
        </div>
    `;
    document.body.appendChild(overlay);
    const close = () => overlay.remove();
    overlay.addEventListener('click', event => {
        if (event.target === overlay) close();
    });
    overlay.querySelector('[data-delete-cancel]').addEventListener('click', close);
    overlay.querySelector('[data-delete-confirm]').addEventListener('click', async () => {
        const button = overlay.querySelector('[data-delete-confirm]');
        button.disabled = true;
        button.textContent = '删除中...';
        try {
            await onConfirm();
            close();
        } catch (err) {
            button.disabled = false;
            button.textContent = '确认删除';
            window.showToast('删除失败: ' + err.message, 'error');
        }
    });
}

// ── Animated overlay helpers ─────────────────────────────────────────────────
const EASE_SPRING = 'cubic-bezier(0.22, 1, 0.36, 1)';

function _openOverlay(overlay) {
    overlay.classList.remove('hidden');
    const card = overlay.firstElementChild;
    overlay.style.opacity = '0';
    if (card) {
        card.style.transform = 'scale(0.96) translateY(12px)';
        card.style.opacity = '0';
    }
    requestAnimationFrame(() => {
        requestAnimationFrame(() => {
            overlay.style.transition = `opacity 0.25s ${EASE_SPRING}`;
            overlay.style.opacity = '1';
            if (card) {
                card.style.transition = `transform 0.38s ${EASE_SPRING}, opacity 0.28s ${EASE_SPRING}`;
                card.style.transform = 'scale(1) translateY(0)';
                card.style.opacity = '1';
            }
        });
    });
    // Clean up
    setTimeout(() => {
        overlay.style.transition = '';
        overlay.style.opacity = '';
        if (card) { card.style.transition = ''; card.style.opacity = ''; card.style.transform = ''; }
    }, 420);
}

function _closeOverlay(overlay) {
    const card = overlay.firstElementChild;
    overlay.style.transition = `opacity 0.2s ${EASE_SPRING}`;
    overlay.style.opacity = '0';
    if (card) {
        card.style.transition = `transform 0.2s ${EASE_SPRING}, opacity 0.15s ${EASE_SPRING}`;
        card.style.transform = 'scale(0.97) translateY(8px)';
        card.style.opacity = '0';
    }
    setTimeout(() => {
        overlay.classList.add('hidden');
        overlay.style.transition = '';
        overlay.style.opacity = '';
        if (card) { card.style.transition = ''; card.style.opacity = ''; card.style.transform = ''; }
    }, 220);
}

function closeModal() {
    _closeOverlay(document.getElementById('modalOverlay'));
}

document.getElementById('modalOverlay').addEventListener('click', e => {
    if (e.target === e.currentTarget) closeModal();
});
document.addEventListener('keydown', e => {
    if (e.key === 'Escape') {
        closeModal();
        _closeOverlay(document.getElementById('settingsOverlay'));
    }
});

window.openBookModal = openBookModal;
window.openEntryModal = openEntryModal;
window.closeModal = closeModal;
window.confirmDeleteEntry = confirmDeleteEntry;
