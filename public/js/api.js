// public/js/api.js - API client
const API_BASE = '';

class ApiClient {
    async request(method, path, body) {
        const opts = {
            method,
            headers: { 'Content-Type': 'application/json' },
        };
        if (body) opts.body = JSON.stringify(body);

        const res = await fetch(API_BASE + path, opts);
        const json = await res.json();

        if (!res.ok || !json.success) {
            throw new Error(json.error || `HTTP ${res.status}`);
        }
        return json;
    }

    get(path) { return this.request('GET', path); }
    post(path, body) { return this.request('POST', path, body); }
    put(path, body) { return this.request('PUT', path, body); }
    del(path) { return this.request('DELETE', path); }

    // Entries
    addEntry(url, note) { return this.post('/api/entries', { url, note }); }
    listEntries(params = {}) {
        const q = new URLSearchParams(params).toString();
        return this.get(`/api/entries${q ? '?' + q : ''}`);
    }
    searchEntries(q) { return this.get(`/api/entries/search?q=${encodeURIComponent(q)}`); }
    deleteEntry(id) { return this.del(`/api/entries/${id}`); }
    updateEntry(id, data) { return this.put(`/api/entries/${id}`, data); }
    getEntryAnalysis(id) { return this.get(`/api/entries/${id}/analysis`); }
    analyzeEntry(id, data = {}) { return this.post(`/api/entries/${id}/analyze`, data); }
    transcribeEntry(id, data = {}) { return this.post(`/api/entries/${id}/transcribe`, data); }

    // Books
    listBooks(params = {}) {
        const q = new URLSearchParams(params).toString();
        return this.get(`/api/books${q ? '?' + q : ''}`);
    }
    getBook(id) { return this.get(`/api/books/${id}`); }

    // Categories
    listCategories() { return this.get('/api/categories'); }

    // Stats
    getStats() { return this.get('/api/stats'); }
    getAdvancedStats(params = '1m') {
        const query = typeof params === 'string' ? { range: params } : (params || {});
        const q = new URLSearchParams(query).toString();
        return this.get(`/api/stats/advanced${q ? '?' + q : ''}`);
    }

    // Config
    getConfig() { return this.get('/api/config'); }
    saveConfig(data) { return this.put('/api/config', data); }
    testLlm() { return this.post('/api/config/test-llm'); }

    // Browser Clipper
    getClipperPairing() { return this.get('/api/clipper/pairing'); }
    getClipperHello() { return this.get('/api/clipper/hello'); }
    getCaptureJobSummary() { return this.get('/api/capture-jobs/summary'); }
    listCaptureJobs(params = {}) {
        const q = new URLSearchParams(params).toString();
        return this.get(`/api/capture-jobs${q ? '?' + q : ''}`);
    }
    deleteCaptureJob(id) { return this.del(`/api/capture-jobs/${id}`); }
}

window.api = new ApiClient();
