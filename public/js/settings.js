// public/js/settings.js - Settings panel management
function initSettings() {
    document.getElementById('settingsBtn').addEventListener('click', openSettings);
    document.getElementById('settingsClose').addEventListener('click', closeSettings);
    document.getElementById('settingsOverlay').addEventListener('click', e => {
        if (e.target === e.currentTarget) closeSettings();
    });
    document.getElementById('saveSettingsBtn').addEventListener('click', saveSettings);
    document.getElementById('testLlmBtn').addEventListener('click', testLlmConnection);
    ['agentBaseUrl', 'agentType', 'agentSkillDir'].forEach(id => {
        const el = document.getElementById(id);
        if (!el) return;
        const eventName = el.tagName === 'SELECT' ? 'change' : 'input';
        el.addEventListener(eventName, updateAgentConnectCommand);
    });
    document.getElementById('copyClipperTokenBtn')?.addEventListener('click', copyClipperToken);
    document.getElementById('copyClipperBaseUrlBtn')?.addEventListener('click', copyClipperBaseUrl);
}

async function openSettings() {
    _openOverlay(document.getElementById('settingsOverlay'));

    // Load current config
    try {
        const res = await api.getConfig();
        const cfg = res.data;
        document.getElementById('cfgProvider').value = cfg['llm.provider'] || 'openai';
        document.getElementById('cfgBaseUrl').value = cfg['llm.base_url'] || '';
        const apiKeyInput = document.getElementById('cfgApiKey');
        apiKeyInput.value = ''; // never prefill key for security
        apiKeyInput.placeholder = cfg['llm.api_key'] ? `已保存: ${cfg['llm.api_key']}` : 'sk-...';
        document.getElementById('cfgModel').value = cfg['llm.model'] || '';
    } catch { }

    // Load stats
    try {
        const res = await api.getStats();
        const s = res.data;
        const grid = document.getElementById('settingsStats');
        grid.innerHTML = `
      <div class="stat-card"><div class="stat-num">${s.total_entries}</div><div class="stat-label">总条目</div></div>
      <div class="stat-card"><div class="stat-num">${s.total_books}</div><div class="stat-label">书架数量</div></div>
      <div class="stat-card"><div class="stat-num">${s.total_categories_used}</div><div class="stat-label">使用分类</div></div>
      <div class="stat-card"><div class="stat-num">${(s.by_platform || []).length}</div><div class="stat-label">收录平台</div></div>
    `;
    } catch { }

    initAgentConnectFields();
    updateAgentConnectCommand();
    loadClipperPairing();
}

function closeSettings() {
    _closeOverlay(document.getElementById('settingsOverlay'));
}

async function saveSettings() {
    const btn = document.getElementById('saveSettingsBtn');
    btn.disabled = true; btn.textContent = 'Saving...';

    const updates = {};
    const provider = document.getElementById('cfgProvider').value;
    const baseUrl = document.getElementById('cfgBaseUrl').value.trim();
    const apiKey = document.getElementById('cfgApiKey').value.trim();
    const model = document.getElementById('cfgModel').value.trim();

    if (provider) updates['llm.provider'] = provider;
    if (baseUrl) updates['llm.base_url'] = baseUrl;
    if (apiKey) updates['llm.api_key'] = apiKey;
    if (model) updates['llm.model'] = model;

    try {
        await api.saveConfig(updates);
        window.showToast('设置已保存', 'success');
        const apiKeyInput = document.getElementById('cfgApiKey');
        apiKeyInput.value = ''; // clear after save
        try {
            const res = await api.getConfig();
            if (res.data['llm.api_key']) apiKeyInput.placeholder = `已保存: ${res.data['llm.api_key']}`;
        } catch {}
    } catch (err) {
        window.showToast('保存失败: ' + err.message, 'error');
    } finally {
        btn.disabled = false; btn.innerHTML = 'Save Configuration';
    }
}

async function testLlmConnection() {
    const btn = document.getElementById('testLlmBtn');
    const result = document.getElementById('testResult');
    btn.disabled = true; btn.innerHTML = '<span class="material-symbols-outlined text-sm animate-spin">autorenew</span> Testing...';
    result.textContent = ''; result.className = 'text-sm font-label';

    try {
        const res = await api.testLlm();
        result.innerHTML = `<span class="text-success flex items-center gap-1"><span class="material-symbols-outlined text-sm">check_circle</span> Success (${res.data.latency}ms)</span>`;
    } catch (err) {
        result.innerHTML = `<span class="text-error flex items-center gap-1"><span class="material-symbols-outlined text-sm">error</span> ${escapeHtml(err.message)}</span>`;
    } finally {
        btn.disabled = false; btn.innerHTML = '<span class="material-symbols-outlined text-sm">network_check</span> Test Connection';
    }
}

function toggleApiKeyVisibility() {
    const input = document.getElementById('cfgApiKey');
    input.type = input.type === 'password' ? 'text' : 'password';
}

function copyAgentConnectCommand() {
    updateAgentConnectCommand();
    const command = document.getElementById('agentConnectCommand').textContent;
    navigator.clipboard.writeText(command).then(() => window.showToast('已复制', 'success'));
}

function initAgentConnectFields() {
    const baseInput = document.getElementById('agentBaseUrl');
    const typeInput = document.getElementById('agentType');
    const dirInput = document.getElementById('agentSkillDir');
    if (!baseInput || !typeInput || !dirInput) return;

    baseInput.value = localStorage.getItem('infomind.agentBaseUrl') || window.location.origin;
    typeInput.value = localStorage.getItem('infomind.agentType') || 'auto';
    dirInput.value = localStorage.getItem('infomind.agentSkillDir') || '';
}

function updateAgentConnectCommand() {
    const commandEl = document.getElementById('agentConnectCommand');
    if (!commandEl) return;

    const baseInput = document.getElementById('agentBaseUrl');
    const typeInput = document.getElementById('agentType');
    const dirInput = document.getElementById('agentSkillDir');
    const hintEl = document.getElementById('agentConnectHint');
    const baseUrl = normalizeAgentBaseUrl(baseInput?.value || window.location.origin);
    const agentType = typeInput?.value || 'auto';
    const skillDir = (dirInput?.value || '').trim();

    localStorage.setItem('infomind.agentBaseUrl', baseUrl);
    localStorage.setItem('infomind.agentType', agentType);
    localStorage.setItem('infomind.agentSkillDir', skillDir);

    const scriptUrl = `${baseUrl}/agent/install-infomind-agent.sh`;
    const envParts = [
        `INFOMIND_BASE_URL=${shellQuote(baseUrl)}`,
        `INFOMIND_AGENT=${shellQuote(agentType)}`,
    ];
    if (skillDir) envParts.push(`AGENT_SKILL_DIR=${shellQuote(skillDir)}`);

    commandEl.textContent = `curl -fsSL ${shellQuote(scriptUrl)} | env ${envParts.join(' ')} bash`;

    if (hintEl) {
        hintEl.textContent = skillDir
            ? '会安装到自定义目录，并把 InfoMind API 地址写入 skill。'
            : agentType === 'auto'
                ? '会自动识别 Hermes / OpenClaw；未识别时生成通用 skill 包。'
                : `会按 ${typeInput.options[typeInput.selectedIndex]?.text || agentType} 方式安装。`;
    }
}

function normalizeAgentBaseUrl(value) {
    const trimmed = String(value || '').trim() || window.location.origin;
    return trimmed.replace(/\/+$/, '');
}

function shellQuote(value) {
    return `'${String(value).replace(/'/g, `'\"'\"'`)}'`;
}

async function loadClipperPairing() {
    const tokenEl = document.getElementById('clipperPairingToken');
    const baseEl = document.getElementById('clipperBaseUrl');
    const statusEl = document.getElementById('clipperStatus');
    if (!tokenEl || !baseEl || !statusEl) return;

    tokenEl.textContent = 'Loading...';
    baseEl.textContent = window.location.origin;
    statusEl.textContent = '正在检查本地服务';

    try {
        const res = await api.getClipperPairing();
        const token = res.data?.token || '';
        const baseUrl = res.data?.base_url || window.location.origin;
        tokenEl.textContent = token;
        baseEl.textContent = baseUrl;
        statusEl.textContent = baseUrl.includes(':3456')
            ? '可连接：插件会自动发现本机 InfoMind'
            : '可连接：当前端口不是默认值，首次配对时请填入下方地址';
        statusEl.className = 'text-xs text-success';
    } catch (err) {
        tokenEl.textContent = '无法读取';
        statusEl.textContent = err.message || '连接信息加载失败';
        statusEl.className = 'text-xs text-error';
    }
}

function copyClipperToken() {
    const token = document.getElementById('clipperPairingToken')?.textContent || '';
    if (!token || token === 'Loading...' || token === '无法读取') return;
    navigator.clipboard.writeText(token).then(() => window.showToast('配对码已复制', 'success'));
}

function copyClipperBaseUrl() {
    const baseUrl = document.getElementById('clipperBaseUrl')?.textContent || window.location.origin;
    navigator.clipboard.writeText(baseUrl).then(() => window.showToast('连接地址已复制', 'success'));
}

window.initSettings = initSettings;
window.openSettings = openSettings;
window.closeSettings = closeSettings;
window.toggleApiKeyVisibility = toggleApiKeyVisibility;
window.copyAgentConnectCommand = copyAgentConnectCommand;
window.updateAgentConnectCommand = updateAgentConnectCommand;
window.loadClipperPairing = loadClipperPairing;
window.copyClipperToken = copyClipperToken;
window.copyClipperBaseUrl = copyClipperBaseUrl;
