const fs = require('fs');
const fsp = require('fs/promises');
const os = require('os');
const path = require('path');
const { spawn } = require('child_process');
const axios = require('axios');
const cheerio = require('cheerio');
const { chat } = require('./llm');
const queries = require('../db/queries');
const { getModelsDir } = require('../utils/paths');

const USER_AGENT = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36';
const TRANSCRIPT_REPAIR_CHARS = 24000;
const TRANSCRIPT_REPAIR_CHUNK = 3200;

function isVideoPlatform(platform) {
    return platform === 'bilibili' || platform === 'youtube' || platform === 'douyin';
}

function isVideoEntry(entryOrPlatform) {
    if (!entryOrPlatform || typeof entryOrPlatform === 'string') return isVideoPlatform(entryOrPlatform);
    const platform = entryOrPlatform.platform;
    if (platform === 'bilibili' || platform === 'youtube') return true;
    if (platform !== 'douyin') return false;

    const source = entryOrPlatform.source_data || {};
    const type = String(source.content_type || '').toLowerCase();
    if (['note', 'image', 'images', 'photo', 'photos', '图文'].includes(type)) return false;
    if (['video', 'aweme_video'].includes(type)) return true;
    if (source.video_url || source.videoUrl || source.play_addr || source.playAddr) return true;
    const url = `${entryOrPlatform.url || ''} ${source.final_url || ''}`.toLowerCase();
    if (/\/note\//i.test(url)) return false;
    if (/\/video\//i.test(url)) return true;
    return false;
}

async function ensureVideoTranscript(entry, progress = async () => {}, { force = false } = {}) {
    if (!isVideoEntry(entry)) return { ok: false, reason: getNonVideoReason(entry) };

    const sourceData = entry.source_data || {};
    const existing = sourceData.transcript_clean || sourceData.subtitle_text || sourceData.transcript_raw;
    if (!force && existing && String(existing).trim().length > 420) {
        return { ok: true, text: existing, source: sourceData.transcript_source || 'stored-transcript' };
    }

    await progress(10, '查找官方字幕');
    const subtitle = await extractPlatformSubtitles(entry).catch(() => null);
    if (subtitle?.text && subtitle.text.length > 420) {
        await saveTranscript(entry, {
            subtitle_text: subtitle.text,
            transcript_clean: subtitle.text,
            transcript_source: subtitle.source,
            transcript_language: subtitle.language || null,
        });
        return { ok: true, text: subtitle.text, source: subtitle.source };
    }

    await progress(18, '下载音频');
    const raw = await transcribeEntryAudio(entry, progress);
    if (!raw?.text) return raw;

    await saveTranscript(entry, {
        transcript_raw: raw.text,
        transcript_source: raw.source,
        transcript_language: raw.language || null,
    });

    await progress(72, '修正转写文本');
    const cleaned = await cleanTranscriptWithLlm(raw.text, entry).catch(() => raw.text);
    await saveTranscript(entry, {
        transcript_raw: raw.text,
        transcript_clean: cleaned,
        transcript_source: raw.source,
        transcript_language: raw.language || null,
    });
    return { ok: true, text: cleaned, source: raw.source };
}

async function extractPlatformSubtitles(entry) {
    if (entry.platform === 'bilibili') return extractBilibiliSubtitles(entry);
    if (entry.platform === 'youtube') return extractYoutubeSubtitles(entry);
    return null;
}

async function extractBilibiliSubtitles(entry) {
    const source = entry.source_data || {};
    const bvid = source.bvid || entry.url?.match(/BV[a-zA-Z0-9]+/)?.[0];
    if (!bvid) return null;
    const cid = source.cid || await fetchBilibiliCid(bvid);
    if (!cid) return null;

    const player = await axios.get('https://api.bilibili.com/x/player/v2', {
        params: { bvid, cid },
        headers: { 'User-Agent': USER_AGENT, Referer: 'https://www.bilibili.com' },
        timeout: 12000,
    });
    const subtitles = player.data?.data?.subtitle?.subtitles || [];
    if (!subtitles.length) return null;
    const chosen = chooseSubtitle(subtitles.map(item => ({
        url: item.subtitle_url,
        language: item.lan,
        label: item.lan_doc,
    })));
    if (!chosen?.url) return null;
    const subtitleUrl = normalizeUrl(chosen.url, 'https:');
    const response = await axios.get(subtitleUrl, {
        headers: { 'User-Agent': USER_AGENT, Referer: 'https://www.bilibili.com' },
        timeout: 15000,
    });
    const body = response.data?.body || [];
    const text = normalizeTranscript(body.map(line => line.content).join('\n'));
    return text ? { text, language: chosen.language, source: 'bilibili-subtitle' } : null;
}

async function fetchBilibiliCid(bvid) {
    const response = await axios.get('https://api.bilibili.com/x/web-interface/view', {
        params: { bvid },
        headers: { 'User-Agent': USER_AGENT, Referer: 'https://www.bilibili.com' },
        timeout: 12000,
    });
    return response.data?.data?.cid || response.data?.data?.pages?.[0]?.cid || null;
}

async function extractYoutubeSubtitles(entry) {
    const response = await axios.get(entry.url, {
        headers: { 'User-Agent': USER_AGENT, 'Accept-Language': 'zh-CN,zh;q=0.9,en;q=0.8' },
        timeout: 15000,
    });
    const player = extractYoutubePlayerResponse(response.data);
    const tracks = player?.captions?.playerCaptionsTracklistRenderer?.captionTracks || [];
    if (!tracks.length) return null;
    const chosen = chooseSubtitle(tracks.map(track => ({
        url: track.baseUrl,
        language: track.languageCode,
        label: track.name?.simpleText || track.name?.runs?.map(run => run.text).join('') || '',
    })));
    if (!chosen?.url) return null;

    const url = chosen.url.includes('fmt=') ? chosen.url : `${chosen.url}&fmt=json3`;
    const transcript = await axios.get(url, { headers: { 'User-Agent': USER_AGENT }, timeout: 15000 });
    const text = parseYoutubeCaptionResponse(transcript.data);
    return text ? { text, language: chosen.language, source: 'youtube-caption' } : null;
}

function extractYoutubePlayerResponse(html) {
    const marker = 'ytInitialPlayerResponse';
    const start = html.indexOf(marker);
    if (start < 0) return null;
    const braceStart = html.indexOf('{', start);
    if (braceStart < 0) return null;
    const json = extractBalancedJson(html, braceStart);
    if (!json) return null;
    try { return JSON.parse(json); } catch { return null; }
}

function parseYoutubeCaptionResponse(payload) {
    if (typeof payload === 'string') {
        const $ = cheerio.load(payload, { xmlMode: true });
        return normalizeTranscript($('text').map((_, el) => $(el).text()).get().join('\n'));
    }
    const events = payload?.events || [];
    return normalizeTranscript(events.flatMap(event => event.segs || []).map(seg => seg.utf8 || '').join(''));
}

async function transcribeEntryAudio(entry, progress = async () => {}) {
    const setup = await getTranscriptionSetupStatus();
    const { ytDlp, ffmpeg, whisper, modelPath, language, maxDuration } = setup;

    if (!setup.ready) {
        return {
            ok: false,
            reason: setup.reason,
            setup_action: 'install_local_stt',
            setup_command: 'npm run setup:stt',
            missing_tools: setup.missingTools,
            model_path: modelPath,
        };
    }

    const workDir = await fsp.mkdtemp(path.join(os.tmpdir(), 'infomind-stt-'));
    try {
        const mediaUrl = getTranscriptMediaUrl(entry);
        const directVideoUrl = getDirectVideoUrl(entry);
        const knownDuration = getKnownDuration(entry);
        let meta = null;
        try {
            meta = await runJson(ytDlp, [
                ...getYtDlpRequestArgs(entry),
                '--dump-json',
                '--no-playlist',
                mediaUrl,
            ], { timeout: 45000 });
        } catch (err) {
            if (!directVideoUrl) {
                return {
                    ok: false,
                    reason: buildVideoDownloadReason(entry, err),
                    setup_action: 'manual_transcript',
                };
            }
        }

        const duration = Number(meta?.duration || knownDuration || 0);
        if (duration && duration > maxDuration) {
            return { ok: false, reason: `视频时长 ${Math.round(duration / 60)} 分钟，超过自动转写上限。`, setup_action: 'manual_transcript' };
        }

        const wavPath = path.join(workDir, 'audio.wav');
        let downloaded = null;
        try {
            downloaded = await downloadAudioWithYtDlp(entry, ytDlp, mediaUrl, workDir);
        } catch (downloadErr) {
            if (!directVideoUrl) {
                return {
                    ok: false,
                    reason: buildVideoDownloadReason(entry, downloadErr),
                    setup_action: 'manual_transcript',
                };
            }
            try {
                await progress(42, '音频转码');
                await transcodeRemoteVideo(ffmpeg, directVideoUrl, wavPath, entry);
            } catch (directErr) {
                return {
                    ok: false,
                    reason: buildVideoDownloadReason(entry, directErr),
                    setup_action: 'manual_transcript',
                };
            }
        }

        if (downloaded) {
            await progress(42, '音频转码');
            await run(ffmpeg, ['-y', '-i', downloaded, '-ar', '16000', '-ac', '1', wavPath], { timeout: 15 * 60 * 1000 });
        }

        if (!fs.existsSync(wavPath)) return { ok: false, reason: '音频下载或转码失败，未生成可转写文件。' };

        await progress(52, '本地语音转文字');
        const outputBase = path.join(workDir, 'transcript');
        const whisperArgs = ['-m', modelPath, '-f', wavPath, '-otxt', '-of', outputBase, '-nt', '-l', language || 'auto'];
        const result = await run(whisper, whisperArgs, { timeout: 60 * 60 * 1000 });
        const textPath = `${outputBase}.txt`;
        const text = fs.existsSync(textPath) ? await fsp.readFile(textPath, 'utf8') : result.stdout;
        const normalized = normalizeTranscript(text);
        return normalized ? { ok: true, text: normalized, source: 'whisper.cpp', language } : { ok: false, reason: '本地转写没有产生有效文本。' };
    } finally {
        await fsp.rm(workDir, { recursive: true, force: true }).catch(() => {});
    }
}

async function downloadAudioWithYtDlp(entry, ytDlp, mediaUrl, workDir) {
    await run(ytDlp, [
        ...getYtDlpRequestArgs(entry),
        '--no-playlist',
        '-f', entry.platform === 'douyin' ? 'ba/bestaudio/best' : 'ba/bestaudio',
        '-x',
        '--audio-format', 'wav',
        '--audio-quality', '5',
        '-o', path.join(workDir, 'source.%(ext)s'),
        mediaUrl,
    ], { timeout: 30 * 60 * 1000 });

    const downloaded = (await fsp.readdir(workDir)).find(name => /^source\./.test(name));
    if (!downloaded) throw new Error('音频下载失败，未生成可转写文件。');
    return path.join(workDir, downloaded);
}

async function transcodeRemoteVideo(ffmpeg, videoUrl, wavPath, entry) {
    await run(ffmpeg, [
        '-y',
        '-headers', buildFfmpegHeaders(entry),
        '-i', videoUrl,
        '-vn',
        '-ar', '16000',
        '-ac', '1',
        wavPath,
    ], { timeout: 30 * 60 * 1000 });
}

function getTranscriptMediaUrl(entry) {
    const source = entry.source_data || {};
    if (entry.platform === 'douyin') {
        return source.final_url || entry.url;
    }
    return entry.url;
}

function getDirectVideoUrl(entry) {
    const source = entry.source_data || {};
    const candidates = [
        source.video_url,
        source.videoUrl,
        source.play_addr,
        source.playAddr,
        source.download_url,
        source.downloadUrl,
    ];
    return candidates.find(value => typeof value === 'string' && /^https?:\/\//i.test(value)) || null;
}

function getKnownDuration(entry) {
    const source = entry.source_data || {};
    const value = source.duration || source.duration_seconds || source.durationSeconds || source.video_duration || source.videoDuration;
    const number = Number(value);
    if (!Number.isFinite(number) || number <= 0) return null;
    return number > 10000 ? Math.round(number / 1000) : Math.round(number);
}

function getYtDlpRequestArgs(entry) {
    return [
        '--user-agent', USER_AGENT,
        '--referer', getPlatformReferer(entry),
        '--add-header', 'Accept-Language:zh-CN,zh;q=0.9,en;q=0.8',
    ];
}

function buildFfmpegHeaders(entry) {
    return [
        `User-Agent: ${USER_AGENT}`,
        `Referer: ${getPlatformReferer(entry)}`,
        'Accept-Language: zh-CN,zh;q=0.9,en;q=0.8',
        '',
    ].join('\r\n');
}

function getPlatformReferer(entry) {
    if (entry.platform === 'bilibili') return 'https://www.bilibili.com/';
    if (entry.platform === 'youtube') return 'https://www.youtube.com/';
    if (entry.platform === 'douyin') return 'https://www.douyin.com/';
    try {
        return new URL(entry.url).origin + '/';
    } catch {
        return entry.url || '';
    }
}

function buildVideoDownloadReason(entry, err) {
    const detail = String(err?.message || err || '').replace(/\s+/g, ' ').slice(0, 220);
    if (entry.platform === 'douyin') {
        return `抖音视频无法自动下载音频。可能是短链过期、视频权限限制或平台阻止后端直连。请先用已登录浏览器里的 InfoMind Clipper 收录字幕/正文；仍不足时再使用本地转写或 Agent 增强。${detail ? ` 细节：${detail}` : ''}`;
    }
    return `无法自动下载视频音频。${detail ? `细节：${detail}` : ''}`;
}

function getNonVideoReason(entry) {
    if (entry?.platform === 'douyin') {
        return '当前抖音条目被识别为图文内容，不会进入音频转写。请在已登录浏览器里使用 InfoMind Clipper 重新收录图文正文和图片。';
    }
    return '当前条目不是视频平台内容。';
}

async function getTranscriptionSetupStatus() {
    const ytDlp = await findCommand([
        'yt-dlp',
        path.join(os.homedir(), 'Library/Python/3.9/bin/yt-dlp'),
        path.join(os.homedir(), 'Library/Python/3.10/bin/yt-dlp'),
        path.join(os.homedir(), 'Library/Python/3.11/bin/yt-dlp'),
        path.join(os.homedir(), 'Library/Python/3.12/bin/yt-dlp'),
    ]);
    const ffmpeg = await findCommand(['ffmpeg', '/opt/homebrew/bin/ffmpeg', '/usr/local/bin/ffmpeg']);
    const whisper = await findCommand(['whisper-cli', '/opt/homebrew/bin/whisper-cli', '/usr/local/bin/whisper-cli', 'main', 'whisper']);
    const modelPath = process.env.INFOMIND_STT_MODEL_PATH || path.join(getModelsDir(), 'ggml-base.bin');
    const maxDuration = Number(process.env.INFOMIND_STT_MAX_DURATION || 7200);
    const language = process.env.INFOMIND_STT_LANGUAGE || 'auto';
    const missingTools = [];
    if (!ytDlp) missingTools.push('yt-dlp');
    if (!ffmpeg) missingTools.push('ffmpeg');
    if (!whisper) missingTools.push('whisper.cpp');

    if (missingTools.length) {
        return {
            ready: false,
            reason: `缺少本地转写组件：${missingTools.join('、')}。请先在项目目录运行 npm run setup:stt，然后重新生成解读。`,
            missingTools,
            ytDlp,
            ffmpeg,
            whisper,
            modelPath,
            maxDuration,
            language,
        };
    }
    if (!fs.existsSync(modelPath)) {
        return {
            ready: false,
            reason: `缺少 Whisper 模型文件：${modelPath}。请先在项目目录运行 npm run setup:stt 下载默认模型，然后重新生成解读。`,
            missingTools: ['ggml-base.bin'],
            ytDlp,
            ffmpeg,
            whisper,
            modelPath,
            maxDuration,
            language,
        };
    }
    return { ready: true, missingTools, ytDlp, ffmpeg, whisper, modelPath, maxDuration, language };
}

async function cleanTranscriptWithLlm(text, entry) {
    const clipped = String(text || '').slice(0, TRANSCRIPT_REPAIR_CHARS);
    const chunks = chunkText(clipped, TRANSCRIPT_REPAIR_CHUNK);
    const cleaned = [];
    for (let index = 0; index < chunks.length; index += 1) {
        const prompt = `你在修正语音转文字稿。只修正错别字、断句、标点和明显术语识别错误，不要总结，不要扩写，不要加入外部信息。

标题：${entry.title || '无标题'}
作者：${entry.author || '未知'}
平台：${entry.platform || '未知'}

转写片段 ${index + 1}/${chunks.length}：
${chunks[index]}

请只返回修正后的正文，不要解释。`;
        const repaired = await chat([{ role: 'user', content: prompt }], { temperature: 0.1, maxTokens: 2200, timeout: 90000 });
        cleaned.push(repaired.trim() || chunks[index]);
    }
    return normalizeTranscript(cleaned.join('\n\n'));
}

async function saveTranscript(entry, updates) {
    const sourceData = {
        ...(entry.source_data || {}),
        ...updates,
        transcript_updated_at: new Date().toISOString(),
    };
    queries.updateEntry(entry.id, { source_data: sourceData });
}

function chooseSubtitle(tracks) {
    const normalized = tracks.filter(track => track?.url);
    return normalized.find(track => /^zh/i.test(track.language || '') || /中文|Chinese/i.test(track.label || ''))
        || normalized.find(track => /^en/i.test(track.language || '') || /English/i.test(track.label || ''))
        || normalized[0]
        || null;
}

function normalizeUrl(url, protocol = 'https:') {
    return String(url || '').startsWith('//') ? protocol + url : url;
}

function normalizeTranscript(value) {
    const lines = String(value || '')
        .replace(/\r/g, '\n')
        .replace(/\[[^\]]{1,30}\]/g, ' ')
        .split('\n')
        .map(line => line.replace(/\s+/g, ' ').trim())
        .filter(Boolean);
    const deduped = [];
    for (const line of lines) {
        if (line !== deduped[deduped.length - 1]) deduped.push(line);
    }
    return deduped.join('\n').replace(/\n{3,}/g, '\n\n').trim();
}

function extractBalancedJson(text, start) {
    let depth = 0;
    let inString = false;
    let escape = false;
    for (let i = start; i < text.length; i += 1) {
        const char = text[i];
        if (escape) { escape = false; continue; }
        if (char === '\\') { escape = true; continue; }
        if (char === '"') inString = !inString;
        if (inString) continue;
        if (char === '{') depth += 1;
        if (char === '}') depth -= 1;
        if (depth === 0) return text.slice(start, i + 1);
    }
    return null;
}

function chunkText(text, size) {
    const chunks = [];
    for (let i = 0; i < text.length; i += size) chunks.push(text.slice(i, i + size));
    return chunks;
}

async function findCommand(candidates) {
    for (const command of candidates) {
        if (command.includes('/') && fs.existsSync(command)) return command;
        try {
            await run(command, ['--help'], { timeout: 5000, allowFailure: true });
            return command;
        } catch {}
    }
    return null;
}

async function runJson(command, args, options) {
    const result = await run(command, args, options);
    return JSON.parse(result.stdout);
}

function run(command, args, { timeout = 30000, allowFailure = false } = {}) {
    return new Promise((resolve, reject) => {
        const child = spawn(command, args, { stdio: ['ignore', 'pipe', 'pipe'] });
        let stdout = '';
        let stderr = '';
        const timer = setTimeout(() => {
            child.kill('SIGTERM');
            reject(new Error(`${command} timed out`));
        }, timeout);
        child.stdout.on('data', data => { stdout += data.toString(); });
        child.stderr.on('data', data => { stderr += data.toString(); });
        child.on('error', err => {
            clearTimeout(timer);
            reject(err);
        });
        child.on('close', code => {
            clearTimeout(timer);
            if (code !== 0 && !allowFailure) {
                reject(new Error(`${command} exited with ${code}: ${stderr.slice(-800)}`));
                return;
            }
            resolve({ stdout, stderr, code });
        });
    });
}

module.exports = {
    ensureVideoTranscript,
    extractPlatformSubtitles,
    transcribeEntryAudio,
    cleanTranscriptWithLlm,
    getTranscriptionSetupStatus,
    isVideoPlatform,
    isVideoEntry,
};
