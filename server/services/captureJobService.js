function upsertCaptureJob(repository, url, data = {}) {
    const active = repository.findActiveCaptureJobByUrl(url);
    if (active) {
        if (['failed', 'needs_login', 'needs_user_action'].includes(active.status)) {
            return repository.updateCaptureJob(active.id, { status: 'queued', error: null });
        }
        return active;
    }

    return repository.createCaptureJob({
        url,
        platform: data.platform || 'web',
        source_channel: data.source_channel || 'manual',
        source_message: data.source_message || null,
        status: 'queued',
    });
}

module.exports = { upsertCaptureJob };
