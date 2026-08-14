// Local Lucide icon hydration keeps the desktop app visually intact offline.
(function () {
    const ICON_MAP = {
        add: 'plus', account_tree: 'network', alternate_email: 'at-sign',
        auto_awesome: 'sparkles', auto_stories: 'book-open', autorenew: 'refresh-cw',
        business_center: 'briefcase-business', calculate: 'calculator',
        calendar_month: 'calendar-days', category: 'shapes', chat: 'message-circle',
        close: 'x', delete: 'trash-2', desktop_mac: 'monitor', desktop_windows: 'monitor',
        devices: 'monitor-smartphone', download: 'download', eco: 'leaf',
        edit_note: 'notebook-pen', engineering: 'cog', error: 'circle-alert',
        extension: 'puzzle', fitness_center: 'dumbbell', folder: 'folder',
        gamepad: 'gamepad-2', gavel: 'scale', grid_view: 'layout-grid',
        health_and_safety: 'heart-pulse', help: 'circle-help', history_edu: 'landmark',
        hub: 'network', insights: 'chart-no-axes-combined',
        language: 'globe', menu_book: 'book-open', memory: 'cpu', movie: 'film',
        music_note: 'music', music_video: 'audio-lines', open_in_new: 'external-link',
        paid: 'circle-dollar-sign', palette: 'palette', podcasts: 'podcast',
        network_check: 'wifi', play_circle: 'circle-play', psychology: 'brain-circuit',
        public: 'globe', refresh: 'refresh-cw',
        restaurant: 'utensils', science: 'flask-conical', school: 'graduation-cap',
        search: 'search', settings: 'settings', smart_display: 'play-square',
        stadia_controller: 'gamepad-2', timeline: 'chart-spline',
        travel_explore: 'map', visibility: 'eye'
    };

    function hydrate(root = document) {
        const nodes = root.matches?.('.material-symbols-outlined')
            ? [root]
            : root.querySelectorAll?.('.material-symbols-outlined') || [];
        nodes.forEach(node => {
            if (node.dataset.localIcon === 'true') return;
            const key = node.textContent.trim();
            const icon = ICON_MAP[key];
            if (!icon) return;
            node.textContent = '';
            node.classList.add(`icon-${icon}`);
            node.dataset.localIcon = 'true';
            node.setAttribute('aria-hidden', 'true');
        });
    }

    document.addEventListener('DOMContentLoaded', () => {
        hydrate(document);
        new MutationObserver(records => {
            records.forEach(record => record.addedNodes.forEach(node => {
                if (node.nodeType === Node.ELEMENT_NODE) hydrate(node);
            }));
        }).observe(document.body, { childList: true, subtree: true });
    });
})();
