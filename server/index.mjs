import http from 'node:http';
import { unlink } from 'node:fs/promises';
import { glob } from 'glob';
import { Innertube } from 'youtubei.js';
import ytdl from '@distube/ytdl-core';
import { getSubtitles } from 'youtube-caption-extractor';

const TRANSCRIPT_EXTRACTOR_TIMEOUT_MS = 6000;
const TRANSCRIPT_FALLBACK_TIMEOUT_MS = 4000;
const COMMENTS_TIMEOUT_MS = 10000;
const LANGUAGE_PREFERENCE = ['ja', 'ja-Hans', 'ja-Hant'];

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
    const regex = /<text start="([\\d.]+)"[^>]*>([^<]+)<\\/text>/g;
    let match;
    while ((match = regex.exec(xml)) !== null) {
      segments.push({
        start: parseFloat(match[1]),
        text: match[2].replace(/&#39;/g, "'").replace(/&quot;/g, '"').replace(/&amp;/g, '&'),
      });
    }
    return segments;
  };

  return withTimeout(fetchCore(), TRANSCRIPT_FALLBACK_TIMEOUT_MS, 'Transcript fallback fetch timed out');
}

async function fetchTranscriptFast(url) {
  const videoId = ytdl.getVideoID(url);
  try {
    const extractorSegments = await fetchTranscriptFromCaptionExtractor(videoId);
    if (extractorSegments.length > 0) return extractorSegments;
  } catch {
    // ignore and fallback
  }
  try {
    const fallback = await fetchTranscriptFromYoutubei(url);
    return fallback;
  } catch {
    return [];
  }
}

async function fetchChannelExtra(videoId) {
  const apiKey = process.env.YOUTUBE_API_KEY || process.env.GOOGLE_API_KEY;
  if (!apiKey) return null;

  try {
    const videoRes = await fetch(
      `https://www.googleapis.com/youtube/v3/videos?part=snippet&id=${videoId}&key=${apiKey}`,
    );
    if (!videoRes.ok) throw new Error(`YouTube Data API videos error: ${videoRes.status}`);
    const videoJson = await videoRes.json();
    const videoItem = videoJson.items?.[0];
    const channelId = videoItem?.snippet?.channelId;
    if (!channelId) return null;

    const channelRes = await fetch(
      `https://www.googleapis.com/youtube/v3/channels?part=snippet,statistics&id=${channelId}&key=${apiKey}`,
    );
    if (!channelRes.ok) throw new Error(`YouTube Data API channels error: ${channelRes.status}`);

    const channelJson = await channelRes.json();
    const channelItem = channelJson.items?.[0];
    if (!channelItem) return null;

    const subscribersStr = channelItem.statistics?.subscriberCount;
    const subscribers = subscribersStr ? Number(subscribersStr) || 0 : 0;
    const channelCreatedAt = channelItem.snippet?.publishedAt || '';
    return { channelId, subscribers, channelCreatedAt };
  } catch {
    return null;
  }
}

async function fetchCommentsFromInnertube(videoId) {
  const fetchCore = async () => {
    const youtube = await Innertube.create({ lang: 'ja', location: 'JP' });
    const commentsResponse = await youtube.getComments(videoId);
    const result = [];
    if (!commentsResponse || !commentsResponse.contents) return result;

    let count = 0;
    for await (const comment of commentsResponse.contents) {
      if (comment.type === 'Comment' || comment.type === 'CommentThread') {
        const commentData = comment.type === 'CommentThread' ? comment.comment : comment;
        const author = commentData?.author?.name || 'Unknown';
        const text = commentData?.content?.toString() || '';
        const likesRaw = commentData?.like_count;
        const likes = typeof likesRaw === 'string' ? Number(likesRaw.replace(/[^0-9]/g, '')) || 0 : likesRaw || 0;
        if (text) {
          result.push({ author, text, likes });
          count++;
        }
        if (count >= 500) break;
      }
    }
    return result;
  };
  return withTimeout(fetchCore(), COMMENTS_TIMEOUT_MS, 'Comments fetch timed out');
}

async function fetchCommentsFromDataApi(videoId) {
  const apiKey = process.env.YOUTUBE_API_KEY || process.env.GOOGLE_API_KEY;
  if (!apiKey) return [];
  const url =
    `https://www.googleapis.com/youtube/v3/commentThreads?part=snippet&videoId=${videoId}` +
    `&maxResults=100&textFormat=plainText&order=time&key=${apiKey}`;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`YouTube Data API commentThreads error: ${res.status}`);

  const json = await res.json();
  const items = json.items || [];
  const comments = items
    .map((item) => {
      const snippet = item?.snippet?.topLevelComment?.snippet;
      if (!snippet) return null;
      const author = snippet.authorDisplayName || 'Unknown';
      const text = snippet.textDisplay || snippet.textOriginal || '';
      const likes = typeof snippet.likeCount === 'number' ? snippet.likeCount : 0;
      if (!text) return null;
      return { author, text, likes };
    })
    .filter(Boolean);
  return comments;
}

function secondsToIsoDuration(totalSeconds) {
  const seconds = Math.max(0, Math.floor(totalSeconds || 0));
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  const secs = seconds % 60;

  const hPart = hours > 0 ? `${hours}H` : '';
  const mPart = minutes > 0 ? `${minutes}M` : '';
  const sPart = `${secs}S`;

  return `PT${hPart}${mPart}${sPart}`;
}

function parseDurationToSeconds(duration) {
  if (typeof duration === 'number') return duration;
  if (!duration) return 0;

  const parts = String(duration)
    .split(':')
    .map((p) => Number(p));
  if (parts.some((n) => Number.isNaN(n))) return 0;
  if (parts.length === 3) {
    const [h, m, s] = parts;
    return h * 3600 + m * 60 + s;
  }
  if (parts.length === 2) {
    const [m, s] = parts;
    return m * 60 + s;
  }
  if (parts.length === 1) return parts[0];
  return 0;
}

async function extractTranscriptAndMetadata(url, extractComments) {
  const apiKey = process.env.YOUTUBE_API_KEY || process.env.GOOGLE_API_KEY;
  if (!apiKey) {
    throw new Error('API key is not configured. Please set YOUTUBE_API_KEY or GOOGLE_API_KEY.');
  }
  if (!url || !ytdl.validateURL(url)) {
    throw new Error('Invalid YouTube URL');
  }

  const videoId = ytdl.getVideoID(url);
  const channelExtraPromise = fetchChannelExtra(videoId);

  let metadata = { title: 'Unknown Title', viewCount: '0', publishDate: '', author: 'Unknown Author' };
  let durationSeconds = 0;
  try {
    const info = await ytdl.getBasicInfo(url);
    const videoDetails = info.videoDetails;
    metadata = {
      title: videoDetails.title,
      viewCount: videoDetails.viewCount,
      publishDate: videoDetails.publishDate,
      author: videoDetails.author.name,
    };
    durationSeconds = parseDurationToSeconds(Number(videoDetails.lengthSeconds));
  } catch {
    const youtube = await Innertube.create({ lang: 'ja', location: 'JP' });
    const info = await youtube.getInfo(videoId);
    metadata = {
      title: info.basic_info.title || 'Unknown Title',
      viewCount: (info.basic_info.view_count || 0).toString(),
      publishDate: info.primary_info?.published?.text || '',
      author: info.basic_info.author || 'Unknown Author',
    };
    const lengthSeconds = info.basic_info?.length_seconds;
    durationSeconds = parseDurationToSeconds(lengthSeconds) || parseDurationToSeconds(info.basic_info.duration);
  }

  let transcriptSegments = [];
  try {
    transcriptSegments = await fetchTranscriptFast(url);
  } catch {
    transcriptSegments = [];
  }
  if (transcriptSegments.length === 0) {
    throw new Error('Could not retrieve transcript. The video might not have subtitles, or the request timed out.');
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

  let comments = [];
  if (extractComments) {
    try {
      comments = await fetchCommentsFromInnertube(videoId);
      if (comments.length === 0) {
        try {
          const apiComments = await fetchCommentsFromDataApi(videoId);
          if (apiComments.length > 0) comments = apiComments;
        } catch {
          // ignore
        }
      }
    } catch {
      comments = [];
    }
  }

  const channelExtra = await channelExtraPromise;
  const safeTitle = metadata.title
    .replace(/[^a-z0-9\\u3000-\\u303f\\u3040-\\u309f\\u30a0-\\u30ff\\uff00-\\uff9f\\u4e00-\\u9faf\\s]/gi, '_')
    .substring(0, 50);
  const filename = `${safeTitle}.json`;
  const viewsNumber = Number(metadata.viewCount) || 0;

  const rawData = {
    videoId,
    url,
    title: metadata.title,
    channelId: channelExtra?.channelId ?? '',
    channelName: metadata.author,
    subscribers: channelExtra?.subscribers ?? 0,
    channelCreatedAt: channelExtra?.channelCreatedAt ?? '',
    publishedAt: metadata.publishDate,
    views: viewsNumber,
    duration: durationSeconds > 0 ? secondsToIsoDuration(durationSeconds) : '',
    transcript: transcriptForJson,
    comments,
  };

  return { rawData, filename, metadata };
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
  if (errorMessage.includes('API key is not configured')) {
    return 'API key is not configured';
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
      const { url, extractComments } = await parseJsonBody(req);
      const result = await extractTranscriptAndMetadata(url, Boolean(extractComments));
      jsonResponse(res, 200, {
        filename: result.filename,
        content: JSON.stringify(result.rawData, null, 2),
        metadata: result.metadata,
      });
    } catch (error) {
      const rawMessage = error instanceof Error ? error.message : 'Internal Server Error';
      const message = toUserMessage(rawMessage);
      const retryable = isRetryableError(rawMessage);
      const status = rawMessage.includes('Invalid YouTube URL') ? 400 : 500;
      jsonResponse(res, status, { error: message, retryable });
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
