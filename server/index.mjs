import http from 'node:http';
import { unlink } from 'node:fs/promises';
import { glob } from 'glob';
import { Innertube } from 'youtubei.js';
import ytdl from '@distube/ytdl-core';
import { getSubtitles } from 'youtube-caption-extractor';

const TRANSCRIPT_EXTRACTOR_TIMEOUT_MS = 12000;
const TRANSCRIPT_FALLBACK_TIMEOUT_MS = 12000;
const LANGUAGE_PREFERENCE = ['ja', 'ja-Hans', 'ja-Hant', 'en', 'en-US', 'en-GB'];

function jsonResponse(res, status, body) {
  const payload = JSON.stringify(body);
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Content-Length': Buffer.byteLength(payload),
  });
  res.end(payload);
}

function parseJsonBody(req) {
  return new Promise((resolve, reject) => {
    let data = '';
    req.on('data', (chunk) => {
      data += chunk;
      if (data.length > 5 * 1024 * 1024) {
        reject(new Error('Payload too large'));
        req.destroy();
      }
    });
    req.on('end', () => {
      if (!data) return resolve({});
      try {
        resolve(JSON.parse(data));
      } catch (error) {
        reject(error);
      }
    });
  });
}

function withTimeout(promise, ms, message) {
  return Promise.race([
    promise,
    new Promise((_, reject) => {
      setTimeout(() => reject(new Error(message)), ms);
    }),
  ]);
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function fetchTranscriptFromCaptionExtractor(videoId) {
  const fetchCore = async () => {
    for (const lang of LANGUAGE_PREFERENCE) {
      const subtitles = (await getSubtitles({ videoID: videoId, lang }).catch(() => [])) || [];
      if (subtitles.length > 0) return subtitles;
    }
    const subtitlesDefault = (await getSubtitles({ videoID: videoId }).catch(() => [])) || [];
    return subtitlesDefault;
  };

  const subtitles = await withTimeout(
    fetchCore(),
    TRANSCRIPT_EXTRACTOR_TIMEOUT_MS,
    'Caption extractor fetch timed out',
  );
  return subtitles.map((s) => ({
    start: parseFloat(s.start),
    text: s.text,
  }));
}

async function fetchTranscriptFromYoutubei(url) {
  const fetchCore = async () => {
    const youtube = await Innertube.create({ lang: 'ja', location: 'JP' });
    const videoId = ytdl.getVideoID(url);
    const info = await youtube.getInfo(videoId);

    const tracks = info.captions?.caption_tracks;
    if (!tracks || tracks.length === 0) return [];

    const prefIndex = (code) => {
      const idx = LANGUAGE_PREFERENCE.indexOf(code);
      return idx === -1 ? LANGUAGE_PREFERENCE.length : idx;
    };

    const sortedTracks = tracks.sort(
      (a, b) => prefIndex(a.language_code ?? '') - prefIndex(b.language_code ?? ''),
    );
    const bestTrack = sortedTracks[0];
    const response = await fetch(bestTrack.base_url, {
      headers: {
        'User-Agent':
          'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
      },
    });
    const xml = await response.text();

    const segments = [];
    const regex = new RegExp('<text start="([0-9.]+)"[^>]*>([^<]+)</text>', 'g');
    let match;
    while ((match = regex.exec(xml)) !== null) {
      segments.push({
        start: parseFloat(match[1]),
        text: match[2].replace(/&#39;/g, "'").replace(/&quot;/g, '"').replace(/&amp;/g, '&'),
      });
    }
    return segments;
  };

  try {
    return await withTimeout(fetchCore(), TRANSCRIPT_FALLBACK_TIMEOUT_MS, 'Transcript fallback fetch timed out');
  } catch (error) {
    if (String(error?.message || '').includes('timed out')) {
      await sleep(800);
      return await withTimeout(fetchCore(), TRANSCRIPT_FALLBACK_TIMEOUT_MS, 'Transcript fallback fetch timed out');
    }
    throw error;
  }
}

async function fetchTranscriptFast(url) {
  const videoId = ytdl.getVideoID(url);
  const errors = [];

  try {
    const extractorSegments = await fetchTranscriptFromCaptionExtractor(videoId);
    if (extractorSegments.length > 0) {
      return { segments: extractorSegments, errors };
    }
    errors.push('caption-extractor: empty');
  } catch (error) {
    errors.push(`caption-extractor: ${(error && error.message) || 'failed'}`);
  }

  try {
    const fallback = await fetchTranscriptFromYoutubei(url);
    if (fallback.length > 0) {
      return { segments: fallback, errors };
    }
    errors.push('youtubei: empty');
  } catch (error) {
    errors.push(`youtubei: ${(error && error.message) || 'failed'}`);
  }

  return { segments: [], errors };
}

async function extractTranscriptOnly(url) {
  if (!url || !ytdl.validateURL(url)) {
    throw new Error('Invalid YouTube URL');
  }

  const videoId = ytdl.getVideoID(url);

  let transcriptSegments = [];
  let transcriptErrors = [];
  try {
    const result = await fetchTranscriptFast(url);
    transcriptSegments = result.segments;
    transcriptErrors = result.errors;
  } catch {
    transcriptSegments = [];
  }
  if (transcriptSegments.length === 0) {
    const detail = transcriptErrors.length > 0 ? ` Details: ${transcriptErrors.join(' | ')}` : '';
    throw new Error(`Could not retrieve transcript.${detail}`);
  }

  const transcriptForJson = transcriptSegments.map((segment) => {
    const totalSeconds = Math.floor(segment.start);
    const hours = Math.floor(totalSeconds / 3600);
    const minutes = Math.floor((totalSeconds % 3600) / 60);
    const seconds = totalSeconds % 60;
    const timeStr =
      hours > 0
        ? `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`
        : `${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`;
    return { time: timeStr, text: segment.text };
  });

  const rawData = {
    videoId,
    url,
    transcript: transcriptForJson,
  };

  return rawData;
}

async function cleanupPlayerScripts() {
  try {
    const files = await glob('*-player-script.js', { cwd: process.cwd() });
    await Promise.all(files.map((file) => unlink(file).catch(() => {})));
  } catch {
    // ignore
  }
}

function toUserMessage(errorMessage) {
  if (errorMessage.includes('Invalid YouTube URL')) {
    return 'Invalid YouTube URL';
  }
  if (errorMessage.includes('Could not retrieve transcript')) {
    return 'Could not retrieve transcript';
  }
  return 'Internal Server Error';
}

function isRetryableError(errorMessage) {
  return errorMessage.includes('timed out');
}

const server = http.createServer(async (req, res) => {
  if (req.method === 'OPTIONS') {
    res.writeHead(204, {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'POST, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type',
    });
    res.end();
    return;
  }

  const { pathname } = new URL(req.url || '/', `http://${req.headers.host || 'localhost'}`);
  if (req.method === 'POST' && pathname === '/api/transcript') {
    try {
      const { url } = await parseJsonBody(req);
      const result = await extractTranscriptOnly(url);
      jsonResponse(res, 200, {
        content: JSON.stringify(result, null, 2),
      });
    } catch (error) {
      const rawMessage = error instanceof Error ? error.message : 'Internal Server Error';
      const message = toUserMessage(rawMessage);
      const retryable = isRetryableError(rawMessage);
      const status = rawMessage.includes('Invalid YouTube URL') ? 400 : 500;
      const details = rawMessage.includes('Could not retrieve transcript') ? rawMessage : undefined;
      jsonResponse(res, status, { error: message, retryable, ...(details ? { details } : {}) });
    } finally {
      await cleanupPlayerScripts();
    }
    return;
  }

  jsonResponse(res, 404, { error: 'Not Found' });
});

const port = Number(process.env.PORT || 3000);
server.listen(port, () => {
  console.log(`Transcript API listening on :${port}`);
});
