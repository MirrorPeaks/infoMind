const DEFAULT_BASE_URL = 'http://127.0.0.1:3456';
const POLL_ALARM = 'infomind-capture-poll';
const PROCESSING_KEY = 'processingJobIds';

chrome.runtime.onInstalled.addListener(() => {
  chrome.alarms.create(POLL_ALARM, { periodInMinutes: 0.25 });
  pollCaptureJobs();
});

chrome.runtime.onStartup.addListener(() => {
  chrome.alarms.create(POLL_ALARM, { periodInMinutes: 0.25 });
  pollCaptureJobs();
});

chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name === POLL_ALARM) pollCaptureJobs();
});

chrome.storage.onChanged.addListener((changes, areaName) => {
  if (areaName === 'local' && (changes.baseUrl || changes.token)) pollCaptureJobs();
});

async function pollCaptureJobs() {
  const settings = await getSettings();
  if (!settings.token) return;

  let jobs;
  try {
    const json = await request(settings, '/api/capture-jobs/pending?platform=douyin&limit=1');
    jobs = json.data || [];
  } catch {
    return;
  }

  for (const job of jobs) {
    if (await isProcessing(job.id)) continue;
    await markProcessing(job.id, true);
    processJob(settings, job).finally(() => markProcessing(job.id, false));
  }
}

async function processJob(settings, job) {
  let tabId = null;
  try {
    await patchJob(settings, job.id, { status: 'opening', increment_attempts: true });
    const tab = await chrome.tabs.create({ url: job.url, active: false });
    tabId = tab.id;
    await waitForTabComplete(tabId, 25000);
    await sleep(4500);

    await patchJob(settings, job.id, { status: 'capturing' });
    const capture = await collectFromTab(tabId);
    capture.job_id = job.id;
    capture.original_url = job.url;
    capture.requested_url = job.url;

    const guard = diagnoseCapture(capture);
    if (guard.status) {
      await patchJob(settings, job.id, { status: guard.status, error: guard.error });
      return;
    }

    await request(settings, '/api/clipper/captures', {
      method: 'POST',
      body: JSON.stringify(capture),
    });
  } catch (err) {
    await patchJob(settings, job.id, { status: 'failed', error: err.message || '浏览器采集失败' });
  } finally {
    if (tabId) {
      try { await chrome.tabs.remove(tabId); } catch {}
    }
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
  if (!result?.result) throw new Error('无法读取页面内容');
  return result.result;
}

function diagnoseCapture(capture) {
  const text = [
    capture.title,
    capture.author,
    capture.description,
    capture.full_text,
  ].filter(Boolean).join(' ');
  if (/登录|注册|验证码|安全验证|请先登录|扫码登录/.test(text) && text.length < 900) {
    return { status: 'needs_login', error: 'Chrome 中的抖音页面需要登录或安全验证。' };
  }
  const title = String(capture.title || '').trim();
  const author = String(capture.author || '').trim();
  const hasContent = !!(capture.description || capture.full_text || capture.subtitle_text || capture.images?.length || capture.cover_url);
  if ((!title || ['抖音', 'Douyin'].includes(title)) && (!author || author === '抖音') && !hasContent) {
    return { status: 'needs_user_action', error: '页面没有暴露可采集内容，请在 Chrome 手动打开该链接后重试。' };
  }
  return {};
}

async function patchJob(settings, jobId, body) {
  return request(settings, `/api/capture-jobs/${encodeURIComponent(jobId)}`, {
    method: 'PATCH',
    body: JSON.stringify(body),
  });
}

async function request(settings, path, options = {}) {
  const response = await fetch(`${settings.baseUrl}${path}`, {
    method: options.method || 'GET',
    headers: {
      'Content-Type': 'application/json',
      'X-InfoMind-Clipper-Token': settings.token,
    },
    body: options.body,
  });
  const json = await response.json().catch(() => ({}));
  if (!response.ok || !json.success) throw new Error(json.error || `InfoMind 返回 ${response.status}`);
  return json;
}

async function getSettings() {
  const stored = await chrome.storage.local.get(['baseUrl', 'token']);
  return {
    baseUrl: normalizeBaseUrl(stored.baseUrl || DEFAULT_BASE_URL),
    token: String(stored.token || '').trim(),
  };
}

async function isProcessing(jobId) {
  const stored = await chrome.storage.session.get([PROCESSING_KEY]);
  return !!stored[PROCESSING_KEY]?.[jobId];
}

async function markProcessing(jobId, active) {
  const stored = await chrome.storage.session.get([PROCESSING_KEY]);
  const map = stored[PROCESSING_KEY] || {};
  if (active) map[jobId] = Date.now();
  else delete map[jobId];
  await chrome.storage.session.set({ [PROCESSING_KEY]: map });
}

function waitForTabComplete(tabId, timeoutMs) {
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => {
      chrome.tabs.onUpdated.removeListener(listener);
      reject(new Error('页面加载超时'));
    }, timeoutMs);
    const listener = (updatedTabId, info) => {
      if (updatedTabId !== tabId || info.status !== 'complete') return;
      clearTimeout(timeout);
      chrome.tabs.onUpdated.removeListener(listener);
      resolve();
    };
    chrome.tabs.onUpdated.addListener(listener);
    chrome.tabs.get(tabId).then(tab => {
      if (tab.status === 'complete') {
        clearTimeout(timeout);
        chrome.tabs.onUpdated.removeListener(listener);
        resolve();
      }
    }).catch(() => {});
  });
}

function normalizeBaseUrl(value) {
  return String(value || DEFAULT_BASE_URL).trim().replace(/\/+$/, '');
}

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}
