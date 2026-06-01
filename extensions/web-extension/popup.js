const DEFAULT_BASE_URL = 'http://127.0.0.1:3456';
const DISCOVERY_URLS = [
  'http://127.0.0.1:3456',
  'http://localhost:3456',
  'http://127.0.0.1:3457',
  'http://127.0.0.1:3458',
];

const baseUrlInput = document.getElementById('baseUrl');
const tokenInput = document.getElementById('token');
const saveBtn = document.getElementById('saveBtn');
const statusEl = document.getElementById('status');

init();

async function init() {
  const stored = await chrome.storage.local.get(['baseUrl', 'token']);
  baseUrlInput.value = stored.baseUrl || await discoverBaseUrl() || DEFAULT_BASE_URL;
  tokenInput.value = stored.token || '';
  saveBtn.addEventListener('click', saveCurrentTab);
  baseUrlInput.addEventListener('change', persistSettings);
  tokenInput.addEventListener('change', persistSettings);
}

async function saveCurrentTab() {
  setStatus('正在读取当前页面...', '');
  saveBtn.disabled = true;
  try {
    await persistSettings();
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (!tab?.id) throw new Error('没有可收录的当前标签页');

    const capture = await collectFromTab(tab.id);
    setStatus('正在发送到 InfoMind...', '');
    const result = await postCapture(capture);
    const title = result?.data?.title || capture.title || '当前内容';
    setStatus(`收录成功：${title}`, 'ok');
  } catch (err) {
    setStatus(err.message || '收录失败', 'error');
  } finally {
    saveBtn.disabled = false;
  }
}

async function collectFromTab(tabId) {
  try {
    const response = await chrome.tabs.sendMessage(tabId, { type: 'INFOMIND_COLLECT_PAGE' });
    if (response?.ok) return response.data;
  } catch {}

  await chrome.scripting.executeScript({ target: { tabId }, files: ['clipper-core.js'] });
  const [result] = await chrome.scripting.executeScript({
    target: { tabId },
    func: () => window.InfoMindClipper.collect(),
  });
  if (!result?.result) throw new Error('无法读取页面内容，请刷新页面后重试');
  return result.result;
}

async function postCapture(capture) {
  const baseUrl = normalizeBaseUrl(baseUrlInput.value);
  const token = tokenInput.value.trim();
  if (!token) throw new Error('请先填写 InfoMind 设置页中的配对码');

  const response = await fetch(`${baseUrl}/api/clipper/captures`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-InfoMind-Clipper-Token': token,
    },
    body: JSON.stringify(capture),
  });
  const json = await response.json().catch(() => ({}));
  if (!response.ok || !json.success) {
    throw new Error(json.error || `InfoMind 返回 ${response.status}`);
  }
  return json;
}

async function discoverBaseUrl() {
  for (const baseUrl of DISCOVERY_URLS) {
    try {
      const response = await fetch(`${baseUrl}/api/clipper/hello`, { method: 'GET' });
      if (response.ok) return baseUrl;
    } catch {}
  }
  return null;
}

async function persistSettings() {
  await chrome.storage.local.set({
    baseUrl: normalizeBaseUrl(baseUrlInput.value || DEFAULT_BASE_URL),
    token: tokenInput.value.trim(),
  });
}

function normalizeBaseUrl(value) {
  return String(value || DEFAULT_BASE_URL).trim().replace(/\/+$/, '');
}

function setStatus(text, type) {
  statusEl.textContent = text;
  statusEl.className = `status ${type || ''}`.trim();
}
