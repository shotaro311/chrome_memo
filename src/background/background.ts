import {
  BACKUP_SCHEMA_VERSION,
  INBOX_FOLDER_ID,
  LIMITS,
  MessageType,
  type BackupFile,
  type BackupThumbnailV1,
  type Folder,
  type Note,
  type NoteMetadata,
  type QuickMemo,
  type TranscriptItem,
  Message,
  Response
} from '../types';
import {
  initializeStorage,
  getFolders,
  createFolder,
  deleteFolder,
  renameFolder,
  updateFolderOrder,
  getNotesInFolder,
  getNote,
  getAllNotes,
  createNote,
  updateNote,
  deleteNote,
  markNoteAsOpened,
  getRecentNotes,
  getQuickMemo,
  updateQuickMemo,
  saveQuickMemoAsNote,
  searchNotes,
  getSettings,
  updateSettings
} from '../utils/storage';
import { getAuthState, onAuthStateChange, signInWithGoogle, signOut } from '../lib/auth';
import {
  deleteFolder as deleteFolderSync,
  deleteMemo,
  downloadOnlySync,
  fullSync,
  uploadFolder,
  uploadMemo,
  uploadOnlySync,
  uploadQuickMemo
} from '../lib/sync';
import { chromeStorage } from '../lib/chromeStorage';
import { generateGeminiText } from '../lib/gemini';
import {
  buildThumbnailPath,
  createThumbnailSignedUrl,
  deleteThumbnail,
  downloadThumbnailWebp,
  uploadThumbnailWebp,
  DEFAULT_THUMBNAIL_SIGNED_URL_EXPIRES_SEC
} from '../lib/thumbnail';

function isIgnorableFetchRejection(reason: unknown): boolean {
  if (reason instanceof TypeError && reason.message === 'Failed to fetch') {
    return true;
  }

  if (typeof reason === 'object' && reason !== null) {
    const { name, message } = reason as { name?: unknown; message?: unknown };
    if (name === 'AuthRetryableFetchError' && message === 'Failed to fetch') {
      return true;
    }
  }

  return false;
}

// Supabase の自動リフレッシュ等で一時的な通信失敗が unhandled rejection として上がることがあるため抑制する
globalThis.addEventListener('unhandledrejection', (event) => {
  if (!isIgnorableFetchRejection(event.reason)) return;
  console.warn('[Background] Ignored unhandled rejection:', event.reason);
  event.preventDefault();
});

function base64ToArrayBuffer(base64: string) {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes.buffer;
}

function arrayBufferToBase64(buffer: ArrayBuffer) {
  const bytes = new Uint8Array(buffer);
  const chunkSize = 0x8000;
  let binary = '';
  for (let i = 0; i < bytes.length; i += chunkSize) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunkSize));
  }
  return btoa(binary);
}

function normalizeKey(text: string) {
  return text.trim().toLowerCase();
}

function generateImportId(): string {
  return `${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
}

function normalizeThumbnailData(data: unknown) {
  if (typeof data === 'string') {
    return { success: true as const, buffer: base64ToArrayBuffer(data) };
  }
  if (data instanceof ArrayBuffer) {
    return { success: true as const, buffer: data };
  }
  if (typeof SharedArrayBuffer !== 'undefined' && data instanceof SharedArrayBuffer) {
    const copy = new Uint8Array(data.byteLength);
    copy.set(new Uint8Array(data));
    return { success: true as const, buffer: copy.buffer };
  }
  if (ArrayBuffer.isView(data)) {
    const view = data as ArrayBufferView;
    const copy = new Uint8Array(view.byteLength);
    copy.set(new Uint8Array(view.buffer, view.byteOffset, view.byteLength));
    return { success: true as const, buffer: copy.buffer };
  }
  return { success: false as const, error: 'サムネのデータ形式が不正です' };
}

// ========================================
// YouTube字幕取得（hand-off準拠）
// ========================================

const YOUTUBE_TRANSCRIPT_LANG_PRIORITY = ['ja', 'ja-Hans', 'ja-Hant'];

function extractJsonObjectFromHtml(html: string, token: string) {
  const tokenIndex = html.indexOf(token);
  if (tokenIndex === -1) return null;
  const startIndex = html.indexOf('{', tokenIndex);
  if (startIndex === -1) return null;
  const jsonText = sliceJsonObject(html, startIndex);
  if (!jsonText) return null;
  try {
    return JSON.parse(jsonText);
  } catch (error) {
    console.error('[Background] Failed to parse JSON:', error);
    return null;
  }
}

function sliceJsonObject(text: string, startIndex: number) {
  let depth = 0;
  let inString = false;
  let escaped = false;

  for (let i = startIndex; i < text.length; i += 1) {
    const ch = text[i];

    if (inString) {
      if (escaped) {
        escaped = false;
        continue;
      }
      if (ch === '\\') {
        escaped = true;
        continue;
      }
      if (ch === '"') {
        inString = false;
      }
      continue;
    }

    if (ch === '"') {
      inString = true;
      continue;
    }
    if (ch === '{') {
      depth += 1;
      continue;
    }
    if (ch === '}') {
      depth -= 1;
      if (depth === 0) {
        return text.slice(startIndex, i + 1);
      }
    }
  }

  return null;
}

function decodeHtmlEntities(text: string) {
  return text
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&#(\d+);/g, (_, code) => String.fromCharCode(Number(code)))
    .replace(/&#x([0-9a-fA-F]+);/g, (_, code) => String.fromCharCode(parseInt(code, 16)));
}

function formatTranscriptTime(seconds: number) {
  const total = Math.max(0, Math.floor(seconds));
  const hours = Math.floor(total / 3600);
  const minutes = Math.floor((total % 3600) / 60);
  const secs = total % 60;
  const pad = (value: number) => String(value).padStart(2, '0');
  return hours > 0 ? `${pad(hours)}:${pad(minutes)}:${pad(secs)}` : `${pad(minutes)}:${pad(secs)}`;
}

function parseTranscriptXml(xml: string): TranscriptItem[] {
  const items: TranscriptItem[] = [];
  const normalized = xml.replace(/<br\s*\/?>/gi, '\n');
  const regex = /<text[^>]*start="([\d.]+)"[^>]*>([\s\S]*?)<\/text>/g;
  let match: RegExpExecArray | null = null;

  while ((match = regex.exec(normalized)) !== null) {
    const start = Number(match[1]);
    if (!Number.isFinite(start)) continue;
    const rawText = decodeHtmlEntities(match[2] ?? '');
    const cleaned = rawText.replace(/\s+/g, ' ').trim();
    if (!cleaned) continue;
    items.push({ time: formatTranscriptTime(start), text: cleaned });
  }

  return items;
}

function parseTranscriptJson3(jsonText: string): TranscriptItem[] {
  try {
    const data = JSON.parse(jsonText);
    const events = data?.events;
    if (!Array.isArray(events)) return [];

    const items: TranscriptItem[] = [];
    for (const event of events) {
      const startMs = Number(event?.tStartMs ?? 0);
      if (!Number.isFinite(startMs)) continue;
      const segs = event?.segs;
      if (!Array.isArray(segs)) continue;

      const text = segs.map((seg: { utf8?: string }) => seg.utf8 ?? '').join('');
      const cleaned = text.replace(/\s+/g, ' ').trim();
      if (!cleaned || cleaned === '\n') continue;
      items.push({ time: formatTranscriptTime(startMs / 1000), text: cleaned });
    }

    return items;
  } catch {
    return [];
  }
}

function selectCaptionTrack(tracks: Array<{ languageCode?: string; baseUrl?: string }>) {
  for (const lang of YOUTUBE_TRANSCRIPT_LANG_PRIORITY) {
    const found = tracks.find((track) => track.languageCode === lang);
    if (found) return found;
  }
  return tracks[0] ?? null;
}

function withSearchParam(url: string, key: string, value: string) {
  try {
    const target = new URL(url);
    target.searchParams.set(key, value);
    return target.toString();
  } catch {
    const separator = url.includes('?') ? '&' : '?';
    return `${url}${separator}${encodeURIComponent(key)}=${encodeURIComponent(value)}`;
  }
}

function extractInnertubeApiKey(html: string) {
  return html.match(/"INNERTUBE_API_KEY":"([^"]+)"/)?.[1] ?? null;
}

function extractInnertubeClientVersion(html: string) {
  return (
    html.match(/"INNERTUBE_CONTEXT_CLIENT_VERSION":"([^"]+)"/)?.[1] ??
    html.match(/"INNERTUBE_CLIENT_VERSION":"([^"]+)"/)?.[1] ??
    null
  );
}

function extractCaptionTracksFromPlayerResponse(playerResponse: any) {
  const tracks = playerResponse?.captions?.playerCaptionsTracklistRenderer?.captionTracks;
  return Array.isArray(tracks) ? tracks : null;
}

async function fetchCaptionItemsFromBaseUrl(baseUrl: string, referrerUrl?: string) {
  const candidates = [
    { label: 'json3', url: withSearchParam(baseUrl, 'fmt', 'json3') },
    { label: 'srv3', url: withSearchParam(baseUrl, 'fmt', 'srv3') },
  ];

  for (const candidate of candidates) {
    const response = await fetch(candidate.url, {
      cache: 'no-store',
      credentials: 'include',
      referrer: referrerUrl,
    });
    const contentType = response.headers.get('content-type') ?? '';
    if (!response.ok) {
      console.warn('[Background] Caption fetch failed:', candidate.label, response.status);
      continue;
    }

    const text = await response.text();
    if (!text.trim()) {
      console.warn('[Background] Caption fetch empty:', candidate.label, contentType);
      continue;
    }

    const items = text.trim().startsWith('{') ? parseTranscriptJson3(text) : parseTranscriptXml(text);
    if (items.length > 0) return items;
    console.warn('[Background] Caption parsed empty:', candidate.label, contentType);
  }

  return [];
}

async function fetchCaptionTracksViaInnerTubePlayer(
  videoId: string,
  apiKey: string,
  clientVersion?: string,
  options?: { credentials?: RequestCredentials; referrerUrl?: string },
) {
  const endpoint = `https://www.youtube.com/youtubei/v1/player?key=${encodeURIComponent(apiKey)}`;
  const payload = {
    context: {
      client: {
        clientName: 'WEB',
        clientVersion: clientVersion || '2.20241201.00.00',
        hl: 'ja',
        gl: 'JP',
      },
    },
    videoId,
  };

  const response = await fetch(endpoint, {
    method: 'POST',
    credentials: options?.credentials ?? 'omit',
    referrer: options?.referrerUrl,
    headers: {
      'Content-Type': 'application/json',
      'X-Youtube-Client-Name': '1',
      'X-Youtube-Client-Version': payload.context.client.clientVersion,
    },
    body: JSON.stringify(payload),
  });

  if (!response.ok) {
    throw new Error(`InnerTube player failed (HTTP ${response.status})`);
  }

  const data = await response.json();
  return extractCaptionTracksFromPlayerResponse(data);
}

async function fetchYoutubeTranscript(videoId: string) {
  console.log('[Background] Fetching transcript for video:', videoId);
  const watchUrl = `https://www.youtube.com/watch?v=${encodeURIComponent(videoId)}`;
  const response = await fetch(watchUrl, { credentials: 'include' });
  if (!response.ok) {
    return { success: false as const, error: `YouTubeの取得に失敗しました（HTTP ${response.status}）` };
  }

  const html = await response.text();
  console.log('[Background] HTML length:', html.length);

  const apiKey = extractInnertubeApiKey(html);
  const clientVersion = extractInnertubeClientVersion(html);

  const playerResponse = extractJsonObjectFromHtml(html, 'ytInitialPlayerResponse');
  let tracks = extractCaptionTracksFromPlayerResponse(playerResponse);
  console.log('[Background] playerResponse found:', !!playerResponse);
  console.log('[Background] tracks:', tracks ? `found ${tracks.length}` : 'not found');

  if (!tracks || tracks.length === 0) {
    if (!apiKey) {
      return { success: false as const, error: 'INNERTUBE_API_KEYが見つかりませんでした' };
    }

    try {
      tracks = await fetchCaptionTracksViaInnerTubePlayer(videoId, apiKey, clientVersion || undefined, {
        credentials: 'omit',
        referrerUrl: watchUrl,
      });
      console.log('[Background] tracks (InnerTube):', tracks ? `found ${tracks.length}` : 'not found');
    } catch (error) {
      console.warn('[Background] InnerTube player fallback failed:', error);
      tracks = null;
    }

    if (!tracks || tracks.length === 0) {
      return { success: false as const, error: '字幕が見つかりませんでした' };
    }
  }

  console.log('[Background] Available tracks:', tracks.map((t: { languageCode?: string; name?: { simpleText?: string } }) =>
    `${t.languageCode} (${t.name?.simpleText || 'unknown'})`
  ).join(', '));

  const track = selectCaptionTrack(tracks);
  console.log('[Background] Selected track:', track?.languageCode);

  const preferredLanguageCode = track?.languageCode;
  const baseUrl = track?.baseUrl;
  if (!baseUrl) {
    return { success: false as const, error: '字幕URLが見つかりませんでした' };
  }

  console.log('[Background] Fetching caption from URL');
  let items = await fetchCaptionItemsFromBaseUrl(baseUrl, watchUrl);

  if (items.length === 0 && apiKey) {
    try {
      const refreshedTracks = await fetchCaptionTracksViaInnerTubePlayer(videoId, apiKey, clientVersion || undefined, {
        credentials: 'omit',
        referrerUrl: watchUrl,
      });
      if (refreshedTracks && refreshedTracks.length > 0) {
        const refreshedTrack =
          (preferredLanguageCode
            ? refreshedTracks.find((t: { languageCode?: string }) => t.languageCode === preferredLanguageCode)
            : null) || selectCaptionTrack(refreshedTracks);

        const refreshedBaseUrl = refreshedTrack?.baseUrl;
        if (refreshedBaseUrl && refreshedBaseUrl !== baseUrl) {
          console.log('[Background] Retrying caption fetch with InnerTube baseUrl');
          items = await fetchCaptionItemsFromBaseUrl(refreshedBaseUrl, watchUrl);
        }
      }
    } catch (error) {
      console.warn('[Background] InnerTube retry failed:', error);
    }
  }
  console.log('[Background] Parsed items count:', items.length);

  if (items.length === 0) {
    return { success: false as const, error: '字幕が空でした' };
  }

  return { success: true as const, items };
}

async function fetchTranscriptViaServer(videoId: string): Promise<{ success: true; data: TranscriptItem[] } | { success: false; error: string }> {
  const apiBase = (await chromeStorage.getItem('transcriptApiUrl'))?.trim();
  if (!apiBase) {
    return { success: false, error: 'transcriptApiUrl is not set' };
  }

  const endpoint = apiBase.replace(/\/$/, '') + '/api/transcript';
  const payload = {
    url: `https://www.youtube.com/watch?v=${encodeURIComponent(videoId)}`,
    extractComments: false
  };

  try {
    const response = await fetch(endpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });

    if (!response.ok) {
      return { success: false, error: `Transcript API failed: HTTP ${response.status}` };
    }

    const data = await response.json();
    const rawData = typeof data?.content === 'string' ? JSON.parse(data.content) : data;
    const transcript = rawData?.transcript;

    if (!Array.isArray(transcript) || transcript.length === 0) {
      return { success: false, error: '字幕が空でした' };
    }

    const items = transcript
      .map((t: { time?: string; text?: string }) => ({
        time: String(t.time ?? ''),
        text: String(t.text ?? '').trim()
      }))
      .filter((t: { time: string; text: string }) => t.text.length > 0);

    if (items.length === 0) {
      return { success: false, error: '字幕が空でした' };
    }

    return { success: true, data: items };
  } catch (error) {
    return { success: false, error: (error as Error).message || 'Transcript API fetch failed' };
  }
}

// MAINワールドでスクリプトを実行して字幕を取得（CORS回避）
async function fetchTranscriptViaMainWorld(videoId: string, tabId: number): Promise<{ success: true; data: TranscriptItem[] } | { success: false; error: string }> {
  console.log('[Background] Fetching transcript via MAIN world for:', videoId);

  try {
    const results = await chrome.scripting.executeScript({
      target: { tabId },
      world: 'MAIN',
      func: async (videoId: string) => {
        // この関数はページのコンテキストで実行される（CORSなし）

        function formatTime(seconds: number): string {
          const total = Math.max(0, Math.floor(seconds));
          const hours = Math.floor(total / 3600);
          const minutes = Math.floor((total % 3600) / 60);
          const secs = total % 60;
          const pad = (v: number) => String(v).padStart(2, '0');
          return hours > 0 ? `${pad(hours)}:${pad(minutes)}:${pad(secs)}` : `${pad(minutes)}:${pad(secs)}`;
        }

        function decodeHtmlEntities(text: string): string {
          return text
            .replace(/<br\s*\/?>/gi, '\n')
            .replace(/&amp;/g, '&')
            .replace(/&lt;/g, '<')
            .replace(/&gt;/g, '>')
            .replace(/&quot;/g, '"')
            .replace(/&#39;/g, "'")
            .replace(/&#(\d+);/g, (_, code) => String.fromCharCode(Number(code)))
            .replace(/&#x([0-9a-fA-F]+);/g, (_, code) => String.fromCharCode(parseInt(code, 16)));
        }

        function parseXml(xml: string): Array<{ time: string; text: string }> {
          const items: Array<{ time: string; text: string }> = [];
          try {
            const parser = new DOMParser();
            const doc = parser.parseFromString(xml, 'text/xml');
            const nodes = Array.from(doc.getElementsByTagName('text'));
            if (nodes.length > 0) {
              for (const node of nodes) {
                const start = Number(node.getAttribute('start') || '0');
                if (!Number.isFinite(start)) continue;
                const rawText = decodeHtmlEntities(node.textContent || '');
                const cleaned = rawText.replace(/\s+/g, ' ').trim();
                if (cleaned) {
                  items.push({ time: formatTime(start), text: cleaned });
                }
              }
              return items;
            }
          } catch {
            // ignore and fallback
          }
          const normalized = xml.replace(/<br\s*\/?>/gi, '\n');
          const regex = /<text[^>]*start="([\d.]+)"[^>]*>([\s\S]*?)<\/text>/g;
          let match;
          while ((match = regex.exec(normalized)) !== null) {
            const start = Number(match[1]);
            if (!Number.isFinite(start)) continue;
            const rawText = decodeHtmlEntities(match[2] || '');
            const cleaned = rawText.replace(/\s+/g, ' ').trim();
            if (cleaned) {
              items.push({ time: formatTime(start), text: cleaned });
            }
          }
          return items;
        }

        function parseJson(jsonText: string): Array<{ time: string; text: string }> {
          try {
            const data = JSON.parse(jsonText);
            const events = data?.events;
            if (!Array.isArray(events)) return [];
            const items: Array<{ time: string; text: string }> = [];
            for (const event of events) {
              const startMs = event.tStartMs || 0;
              const segs = event.segs;
              if (!Array.isArray(segs)) continue;
              const text = segs.map((seg: { utf8?: string }) => seg.utf8 || '').join('');
              const cleaned = text.replace(/\s+/g, ' ').trim();
              if (cleaned && cleaned !== '\n') {
                items.push({ time: formatTime(startMs / 1000), text: cleaned });
              }
            }
            return items;
          } catch {
            return [];
          }
        }

        function withParam(url: string, key: string, value: string): string {
          try {
            const target = new URL(url);
            target.searchParams.set(key, value);
            return target.toString();
          } catch {
            const sep = url.includes('?') ? '&' : '?';
            return `${url}${sep}${encodeURIComponent(key)}=${encodeURIComponent(value)}`;
          }
        }

        async function fetchCaptionText(
          url: string,
          label: string,
          params: { referrerUrl?: string; credentials: RequestCredentials },
        ) {
          const response = await fetch(url, {
            credentials: params.credentials,
            cache: 'no-store',
            referrer: params.referrerUrl,
          });
          const contentType = response.headers.get('content-type');
          const contentLength = response.headers.get('content-length');
          console.log(
            `[MAIN] ${label} status:`,
            response.status,
            'type:',
            response.type,
            'content-type:',
            contentType,
            'content-length:',
            contentLength,
            'redirected:',
            response.redirected,
          );
          const text = response.ok ? await response.text() : '';
          console.log(`[MAIN] ${label} length:`, text.length, 'url:', response.url);
          return text;
        }

        async function fetchCaptionItemsFromBaseUrl(baseUrl: string, labelPrefix: string, referrerUrl?: string) {
          const candidates = [
            { label: `${labelPrefix} Base`, url: baseUrl },
            { label: `${labelPrefix} JSON`, url: withParam(baseUrl, 'fmt', 'json3') },
            { label: `${labelPrefix} XML`, url: withParam(baseUrl, 'fmt', 'srv3') },
          ];

          const tried = new Set<string>();
          for (const candidate of candidates) {
            if (tried.has(candidate.url)) continue;
            tried.add(candidate.url);

            const captionTextInclude = await fetchCaptionText(candidate.url, candidate.label, {
              credentials: 'include',
              referrerUrl,
            });

            let captionText = captionTextInclude;
            if (!captionText.trim()) {
              const captionTextOmit = await fetchCaptionText(candidate.url, `${candidate.label} (omit)`, {
                credentials: 'omit',
                referrerUrl,
              });
              captionText = captionTextOmit;
            }

            if (!captionText.trim()) continue;
            const items = captionText.trim().startsWith('{') ? parseJson(captionText) : parseXml(captionText);
            if (items.length > 0) {
              return items;
            }
          }

          throw new Error('字幕データが空です');
        }

        try {
          console.log('[MAIN] Fetching transcript for:', videoId);

          // InnerTube APIを使用して字幕を取得
          // これはYouTubeが内部で使用しているAPIで、より確実に動作する
          async function fetchViaInnerTube(): Promise<Array<{ time: string; text: string }>> {
            console.log('[MAIN] Trying InnerTube player API...');

            const ytcfg = (window as any)?.ytcfg;
            const apiKey = ytcfg?.get?.('INNERTUBE_API_KEY');
            const context = ytcfg?.get?.('INNERTUBE_CONTEXT');
            const clientName =
              ytcfg?.get?.('INNERTUBE_CONTEXT_CLIENT_NAME') ??
              ytcfg?.get?.('INNERTUBE_CLIENT_NAME');
            const clientVersion =
              ytcfg?.get?.('INNERTUBE_CONTEXT_CLIENT_VERSION') ??
              ytcfg?.get?.('INNERTUBE_CLIENT_VERSION');
            const visitorData = ytcfg?.get?.('VISITOR_DATA');
            const signatureTimestamp = ytcfg?.get?.('STS');

            if (!apiKey || !context) {
              throw new Error('InnerTube: ytcfg is missing');
            }

            const endpoint = `https://www.youtube.com/youtubei/v1/player?key=${encodeURIComponent(apiKey)}`;
            const payload: any = {
              context: {
                ...context,
                client: {
                  ...(context.client || {}),
                  hl: context.client?.hl || 'ja',
                  gl: context.client?.gl || 'JP',
                  clientName: context.client?.clientName || 'WEB',
                  clientVersion: context.client?.clientVersion || '2.20241201.00.00'
                }
              },
              videoId
            };

            if (signatureTimestamp) {
              payload.playbackContext = {
                contentPlaybackContext: { signatureTimestamp }
              };
            }

            const headers: Record<string, string> = {
              'Content-Type': 'application/json'
            };
            if (clientName !== undefined && clientName !== null) {
              headers['X-Youtube-Client-Name'] = String(clientName);
            }
            if (clientVersion) {
              headers['X-Youtube-Client-Version'] = String(clientVersion);
            }
            if (visitorData) {
              headers['X-Goog-Visitor-Id'] = String(visitorData);
            }

            const response = await fetch(endpoint, {
              method: 'POST',
              headers,
              credentials: 'include',
              body: JSON.stringify(payload)
            });

            if (!response.ok) {
              throw new Error(`InnerTube player failed: HTTP ${response.status}`);
            }

            const data = await response.json();
            console.log('[MAIN] InnerTube player response received');

            const tracks = data?.captions?.playerCaptionsTracklistRenderer?.captionTracks;
            if (!Array.isArray(tracks) || tracks.length === 0) {
              throw new Error('InnerTube: No captionTracks found');
            }

            const langPriority = ['ja', 'ja-Hans', 'ja-Hant', 'en', 'en-US', 'en-GB'];
            let track = null;
            for (const lang of langPriority) {
              track = tracks.find((t: { languageCode?: string }) => t.languageCode === lang);
              if (track) break;
            }
            if (!track) track = tracks[0];

            let baseUrl = track?.baseUrl || track?.url;
            if (!baseUrl && track?.signatureCipher) {
              const params = new URLSearchParams(track.signatureCipher);
              const url = params.get('url');
              const sp = params.get('sp') || 'signature';
              const s = params.get('s');
              if (url) {
                baseUrl = s ? `${url}&${sp}=${s}` : url;
              }
            }

            if (!baseUrl) {
              throw new Error('InnerTube: baseUrl not found');
            }

            console.log('[MAIN] InnerTube selected track:', track.languageCode);
            const watchUrl = `https://www.youtube.com/watch?v=${encodeURIComponent(videoId)}`;
            return await fetchCaptionItemsFromBaseUrl(baseUrl, 'InnerTube Caption', watchUrl);
          }

          // timedtext APIを使用（フォールバック）
          async function fetchViaTimedText(): Promise<Array<{ time: string; text: string }>> {
            console.log('[MAIN] Trying timedtext API...');

            const watchUrl = `https://www.youtube.com/watch?v=${encodeURIComponent(videoId)}`;
            const pageResponse = await fetch(watchUrl, { credentials: 'include' });
            if (!pageResponse.ok) throw new Error('Failed to fetch YouTube page');

            const html = await pageResponse.text();
            console.log('[MAIN] HTML length:', html.length);

            function extractCaptionTracksFromCaptionsJson(htmlText: string) {
              const token = '"captions":';
              const parts = htmlText.split(token);
              if (parts.length < 2) return null;
              const rest = parts[1];
              const endTokens = [',"videoDetails"', ',"microformat"', ',"playbackTracking"'];
              let endIndex = -1;
              for (const endToken of endTokens) {
                const idx = rest.indexOf(endToken);
                if (idx !== -1) {
                  endIndex = idx;
                  break;
                }
              }
              if (endIndex === -1) return null;
              const raw = rest.slice(0, endIndex);
              const cleaned = raw.replace(/\n/g, '').replace(/\\n/g, '');
              try {
                const captionsJson = JSON.parse(cleaned);
                return captionsJson?.playerCaptionsTracklistRenderer?.captionTracks || null;
              } catch {
                return null;
              }
            }

            let tracks = extractCaptionTracksFromCaptionsJson(html);
            let trackSource = 'captions-split';
            if (!Array.isArray(tracks) || tracks.length === 0) {
              const tokenIndex = html.indexOf('ytInitialPlayerResponse');
              if (tokenIndex === -1) throw new Error('ytInitialPlayerResponse not found');

              const startIndex = html.indexOf('{', tokenIndex);
              if (startIndex === -1) throw new Error('JSON start not found');

              let depth = 0, inString = false, escaped = false;
              let endIndex = startIndex;
              for (let i = startIndex; i < html.length; i++) {
                const ch = html[i];
                if (inString) {
                  if (escaped) { escaped = false; continue; }
                  if (ch === '\\') { escaped = true; continue; }
                  if (ch === '"') { inString = false; }
                  continue;
                }
                if (ch === '"') { inString = true; continue; }
                if (ch === '{') { depth++; continue; }
                if (ch === '}') {
                  depth--;
                  if (depth === 0) { endIndex = i + 1; break; }
                }
              }

              const jsonText = html.slice(startIndex, endIndex);
              const playerResponse = JSON.parse(jsonText);
              console.log('[MAIN] playerResponse parsed');
              tracks = playerResponse?.captions?.playerCaptionsTracklistRenderer?.captionTracks;
              trackSource = 'ytInitialPlayerResponse';
            }

            if (!Array.isArray(tracks) || tracks.length === 0) {
              throw new Error('字幕トラックが見つかりませんでした');
            }

            console.log('[MAIN] Caption tracks source:', trackSource);
            console.log('[MAIN] Available tracks:', tracks.map((t: { languageCode?: string }) => t.languageCode).join(', '));

            const langPriority = ['ja', 'ja-Hans', 'ja-Hant', 'en', 'en-US', 'en-GB'];
            let track = null;
            for (const lang of langPriority) {
              track = tracks.find((t: { languageCode?: string }) => t.languageCode === lang);
              if (track) break;
            }
            if (!track) track = tracks[0];

            let baseUrl = track?.baseUrl || track?.url;
            if (!baseUrl && track?.signatureCipher) {
              const params = new URLSearchParams(track.signatureCipher);
              const url = params.get('url');
              const sp = params.get('sp') || 'signature';
              const s = params.get('s');
              if (url) {
                baseUrl = s ? `${url}&${sp}=${s}` : url;
              }
            }
            if (!baseUrl) throw new Error('字幕URLが見つかりませんでした');

            console.log('[MAIN] Selected track:', track.languageCode);

            return await fetchCaptionItemsFromBaseUrl(baseUrl, 'Caption', watchUrl);
          }

          // まずInnerTube APIを試し、失敗したらtimedtextにフォールバック
          let items: Array<{ time: string; text: string }> = [];

          try {
            items = await fetchViaInnerTube();
          } catch (innerTubeError) {
            console.log('[MAIN] InnerTube failed:', (innerTubeError as Error).message);
            console.log('[MAIN] Falling back to timedtext...');
            items = await fetchViaTimedText();
          }

          console.log('[MAIN] Final parsed items:', items.length);
          if (items.length === 0) throw new Error('字幕のパースに失敗しました');

          return { success: true, items };

        } catch (error) {
          console.error('[MAIN] Error:', error);
          return { success: false, error: (error as Error).message || '字幕の取得に失敗しました' };
        }
      },
      args: [videoId]
    });

    const result = results[0]?.result;
    if (!result) {
      return { success: false, error: 'スクリプト実行結果が取得できませんでした' };
    }

    if (result.success && result.items) {
      console.log('[Background] MAIN world transcript success:', result.items.length, 'items');
      return { success: true, data: result.items as TranscriptItem[] };
    } else {
      return { success: false, error: result.error || '字幕の取得に失敗しました' };
    }
  } catch (error) {
    console.error('[Background] MAIN world execution error:', error);
    return { success: false, error: (error as Error).message || 'スクリプト実行に失敗しました' };
  }
}

// ========================================
// インストール時の初期化
// ========================================

chrome.runtime.onInstalled.addListener(async () => {
  console.log('[Background] Extension installed');
  await initializeStorage();
});

// ========================================
// 認証状態の監視と自動同期
// ========================================

// 認証状態の変更を監視
onAuthStateChange((state) => {
  console.log('[Background] Auth state changed:', state);
});

// ========================================
// アイコンクリック時の処理
// ========================================

chrome.action.onClicked.addListener(async (tab) => {
  console.log('[Background] Action icon clicked');

  if (!tab?.id) {
    console.error('[Background] No active tab found');
    return;
  }

  // 注入不可ページのチェック
  if (isInjectionBlockedUrl(tab.url)) {
    console.warn('[Background] Cannot inject into this page:', tab.url);
    return;
  }

  try {
    // パネルを開く
    await chrome.tabs.sendMessage(tab.id, {
      type: MessageType.OPEN_PANEL
    });
  } catch (error) {
    console.error('[Background] Error opening panel:', error);
  }
});

// ========================================
// ショートカットキーの処理
// ========================================

chrome.commands.onCommand.addListener(async (command) => {
  console.log('[Background] Command received:', command);

  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab?.id) {
    console.error('[Background] No active tab found');
    return;
  }

  // 注入不可ページのチェック
  if (isInjectionBlockedUrl(tab.url)) {
    console.warn('[Background] Cannot inject into this page:', tab.url);

    // ショートカット案内をポップアップ内で表示するために設定を更新
    // （実際のエラー表示はPopup側で行う）
    return;
  }

  try {
    switch (command) {
      case 'toggle-panel':
        // パネルの開閉
        await chrome.tabs.sendMessage(tab.id, {
          type: MessageType.TOGGLE_PANEL
        });
        break;

      default:
        console.warn('[Background] Unknown command:', command);
    }
  } catch (error) {
    console.error('[Background] Error handling command:', error);
  }
});

// ========================================
// メッセージハンドラ
// ========================================

chrome.runtime.onMessage.addListener((message: Message, sender, sendResponse) => {
  const isGeminiMessage = message.type === MessageType.GEMINI_GENERATE;
  if (isGeminiMessage) {
    console.log('[Background] Message received:', { type: message.type });
  } else {
    console.log('[Background] Message received:', message);
  }

  // FETCH_TRANSCRIPT_MAIN_WORLD の場合は sender.tab.id を使用
  const senderTabId = sender.tab?.id;

  handleMessage(message, senderTabId)
    .then(response => {
      if (isGeminiMessage) {
        console.log('[Background] Sending response:', { success: response.success });
      } else {
        console.log('[Background] Sending response:', response);
      }
      sendResponse(response);
    })
    .catch(error => {
      console.error('[Background] Error handling message:', error);
      sendResponse({
        success: false,
        error: error.message || '不明なエラーが発生しました'
      });
    });

  // 非同期レスポンスを返すためにtrueを返す
  return true;
});

/**
 * メッセージを処理
 */
async function handleMessage(message: Message, senderTabId?: number): Promise<Response> {
  try {
    switch (message.type) {
      // 認証
      case MessageType.AUTH_SIGN_IN: {
        const result = await signInWithGoogle();
        if (!result.success) {
          return { success: false, error: result.error || 'サインインに失敗しました' };
        }
        return { success: true, data: null };
      }

      case MessageType.AUTH_SIGN_OUT: {
        const result = await signOut();
        if (!result.success) {
          return { success: false, error: result.error || 'サインアウトに失敗しました' };
        }
        return { success: true, data: null };
      }

      case MessageType.AUTH_GET_STATE: {
        const state = await getAuthState();
        return { success: true, data: state };
      }

      case MessageType.AUTH_SYNC_NOW: {
        const result = await fullSync();
        if (!result.success) {
          return { success: false, error: result.error || '同期に失敗しました' };
        }
        return { success: true, data: null };
      }

      case MessageType.AUTH_SYNC_FROM_REMOTE: {
        const result = await downloadOnlySync();
        if (!result.success) {
          return { success: false, error: result.error || '同期に失敗しました' };
        }
        return { success: true, data: null };
      }

      case MessageType.AUTH_SYNC_TO_REMOTE: {
        const result = await uploadOnlySync();
        if (!result.success) {
          return { success: false, error: result.error || '同期に失敗しました' };
        }
        return { success: true, data: null };
      }

      // 設定
      case MessageType.GET_SETTINGS: {
        const settings = await getSettings();
        return { success: true, data: settings };
      }

      case MessageType.UPDATE_SETTINGS: {
        const settings = await updateSettings(message.updates);
        return { success: true, data: settings };
      }

      // AI
      case MessageType.GEMINI_GENERATE: {
        const apiKey = await chromeStorage.getItem('geminiApiKey');
        if (!apiKey) {
          return { success: false, error: 'Gemini APIキーが未設定です' };
        }
        const result = await generateGeminiText({
          apiKey,
          prompt: message.prompt,
          model: message.model
        });
        if (!result.success) {
          return { success: false, error: result.error || 'Geminiの呼び出しに失敗しました' };
        }
        return { success: true, data: result.text };
      }

      case MessageType.GET_YOUTUBE_TRANSCRIPT: {
        const videoId = message.videoId?.trim();
        if (!videoId) {
          return { success: false, error: '動画IDが不正です' };
        }
        const result = await fetchYoutubeTranscript(videoId);
        if (!result.success) {
          return { success: false, error: result.error };
        }
        return { success: true, data: result.items };
      }

      case MessageType.FETCH_TRANSCRIPT_MAIN_WORLD: {
        const videoId = (message as { videoId: string }).videoId?.trim();
        if (!videoId) {
          return { success: false, error: '動画IDが不正です' };
        }
        if (!senderTabId) {
          return { success: false, error: 'タブIDが取得できませんでした' };
        }
        try {
          const serverResult = await fetchTranscriptViaServer(videoId);
          if (serverResult.success) {
            return serverResult;
          }
          if (serverResult.error !== 'transcriptApiUrl is not set') {
            console.warn('[Background] Transcript API failed, falling back:', serverResult.error);
          }

          const bgResult = await fetchYoutubeTranscript(videoId);
          if (bgResult.success) {
            return { success: true, data: bgResult.items };
          }
          console.warn('[Background] Background transcript failed, falling back:', bgResult.error);

          const result = await fetchTranscriptViaMainWorld(videoId, senderTabId);
          return result;
        } catch (error) {
          return { success: false, error: (error as Error).message || '字幕取得に失敗しました' };
        }
      }

      // フォルダ操作
      case MessageType.GET_FOLDERS: {
        const folders = await getFolders();
        return { success: true, data: folders };
      }

      case MessageType.CREATE_FOLDER: {
        const folder = await createFolder(message.name);
        return { success: true, data: folder };
      }

      case MessageType.DELETE_FOLDER: {
        const notesInFolder = await getNotesInFolder(message.folderId);
        const thumbnailPaths = notesInFolder
          .map(note => note.thumbnailPath)
          .filter((path): path is string => Boolean(path));

        await deleteFolder(message.folderId);
        const syncResult = await deleteFolderSync(message.folderId);
        if (!syncResult.success && syncResult.error !== 'Not authenticated') {
          console.error('[Background] Delete folder sync error:', syncResult.error);
        }
        for (const path of thumbnailPaths) {
          const deleteResult = await deleteThumbnail({ path });
          if (!deleteResult.success && deleteResult.error !== 'Not authenticated') {
            console.error('[Background] Delete thumbnail error:', deleteResult.error);
          }
        }
        return { success: true, data: null };
      }

      case MessageType.RENAME_FOLDER: {
        await renameFolder(message.folderId, message.newName);
        return { success: true, data: null };
      }

      case MessageType.UPDATE_FOLDER_ORDER: {
        await updateFolderOrder(message.order);
        return { success: true, data: null };
      }

      // メモ操作
      case MessageType.GET_NOTES_IN_FOLDER: {
        const notes = await getNotesInFolder(message.folderId);
        return { success: true, data: notes };
      }

      case MessageType.GET_NOTE: {
        const note = await getNote(message.noteId);
        return { success: true, data: note };
      }

      case MessageType.CREATE_NOTE: {
        const note = await createNote(message.folderId, message.title);
        return { success: true, data: note };
      }

      case MessageType.UPDATE_NOTE: {
        const note = await updateNote(message.noteId, {
          title: message.title,
          content: message.content,
          folderId: message.folderId,
          thumbnailPath: message.thumbnailPath
        });
        return { success: true, data: note };
      }

      case MessageType.DELETE_NOTE: {
        const note = await getNote(message.noteId);
        if (note?.thumbnailPath) {
          const deleteResult = await deleteThumbnail({ path: note.thumbnailPath });
          if (!deleteResult.success && deleteResult.error !== 'Not authenticated') {
            console.error('[Background] Delete thumbnail error:', deleteResult.error);
          }
        }
        await deleteNote(message.noteId);
        const syncResult = await deleteMemo(message.noteId);
        if (!syncResult.success && syncResult.error !== 'Not authenticated') {
          console.error('[Background] Delete memo sync error:', syncResult.error);
        }
        return { success: true, data: null };
      }

      case MessageType.OPEN_NOTE: {
        await markNoteAsOpened(message.noteId);
        const note = await getNote(message.noteId);
        return { success: true, data: note };
      }

      case MessageType.SET_NOTE_THUMBNAIL: {
        const authState = await getAuthState();
        if (!authState.isAuthenticated || !authState.userId) {
          return { success: false, error: 'サインインが必要です' };
        }

        const note = await getNote(message.noteId);
        if (!note) {
          return { success: false, error: 'メモが見つかりません' };
        }

        const nextPath = buildThumbnailPath({ userId: authState.userId, noteId: note.id });
        const prevPath = note.thumbnailPath;

        const normalized = normalizeThumbnailData(message.data);
        if (!normalized.success) {
          return { success: false, error: normalized.error };
        }

	        const uploadResult = await uploadThumbnailWebp({ path: nextPath, data: normalized.buffer });
        if (!uploadResult.success) {
          return {
            success: false,
            error:
	              uploadResult.error === 'Not authenticated'
	                ? 'サインインが必要です'
	                : (uploadResult.error ?? 'サムネのアップロードに失敗しました')
	          };
	        }

	        const memoUploadResult = await uploadMemo({
	          ...note,
	          thumbnailPath: nextPath,
	          updatedAt: Date.now()
	        });
	        if (!memoUploadResult.success) {
	          await deleteThumbnail({ path: nextPath });
	          return {
	            success: false,
	            error:
	              memoUploadResult.error === 'Not authenticated'
	                ? 'サインインが必要です'
	                : (memoUploadResult.error ?? '同期に失敗しました')
	          };
	        }

        const updatedNote = await updateNote(note.id, { thumbnailPath: nextPath });
        if (prevPath && prevPath !== nextPath) {
          const deleteResult = await deleteThumbnail({ path: prevPath });
          if (!deleteResult.success && deleteResult.error !== 'Not authenticated') {
            console.error('[Background] Delete thumbnail error:', deleteResult.error);
          }
        }
        return { success: true, data: updatedNote };
      }

      case MessageType.DELETE_NOTE_THUMBNAIL: {
        const authState = await getAuthState();
        if (!authState.isAuthenticated || !authState.userId) {
          return { success: false, error: 'サインインが必要です' };
        }

        const note = await getNote(message.noteId);
        if (!note) {
          return { success: false, error: 'メモが見つかりません' };
        }
        if (!note.thumbnailPath) {
          return { success: true, data: note };
        }

	        const memoUploadResult = await uploadMemo({
	          ...note,
	          thumbnailPath: undefined,
	          updatedAt: Date.now()
	        });
	        if (!memoUploadResult.success) {
	          return {
	            success: false,
	            error:
	              memoUploadResult.error === 'Not authenticated'
	                ? 'サインインが必要です'
	                : (memoUploadResult.error ?? '同期に失敗しました')
	          };
	        }

        const updatedNote = await updateNote(note.id, { thumbnailPath: null });
        const deleteResult = await deleteThumbnail({ path: note.thumbnailPath });
        if (!deleteResult.success && deleteResult.error !== 'Not authenticated') {
          console.error('[Background] Delete thumbnail error:', deleteResult.error);
        }
        return { success: true, data: updatedNote };
      }

      case MessageType.GET_NOTE_THUMBNAIL_URL: {
        const authState = await getAuthState();
        if (!authState.isAuthenticated || !authState.userId) {
          return { success: false, error: 'サインインが必要です' };
        }

        const note = await getNote(message.noteId);
        if (!note) {
          return { success: false, error: 'メモが見つかりません' };
        }
        if (!note.thumbnailPath) {
          return { success: false, error: 'サムネが設定されていません' };
        }

	        const signed = await createThumbnailSignedUrl({
	          path: note.thumbnailPath,
	          expiresIn: message.expiresIn ?? DEFAULT_THUMBNAIL_SIGNED_URL_EXPIRES_SEC
	        });
	        if (!signed.success) {
	          return {
	            success: false,
	            error:
	              signed.error === 'Not authenticated'
	                ? 'サインインが必要です'
	                : (signed.error ?? '署名URLの取得に失敗しました')
	          };
	        }
        return { success: true, data: signed.url };
      }

      case MessageType.GET_RECENT_NOTES: {
        const notes = await getRecentNotes();
        return { success: true, data: notes };
      }

	      case MessageType.GET_EXPORT_DATA: {
	        return await handleGetExportData();
	      }

	      case MessageType.IMPORT_BACKUP_DATA: {
	        return await handleImportBackupData(message.data);
	      }

      // 下書きメモ操作
      case MessageType.GET_QUICK_MEMO: {
        const quickMemo = await getQuickMemo();
        return { success: true, data: quickMemo };
      }

      case MessageType.UPDATE_QUICK_MEMO: {
        const quickMemo = await updateQuickMemo(message.content);
        return { success: true, data: quickMemo };
      }

      case MessageType.SAVE_QUICK_MEMO_AS_NOTE: {
        const note = await saveQuickMemoAsNote(message.folderId, message.title);
        return { success: true, data: note };
      }

      // 検索
      case MessageType.SEARCH_NOTES: {
        const notes = await searchNotes(message.query, message.folderId);
        return { success: true, data: notes };
      }

      default:
        return { success: false, error: '不明なメッセージタイプです' };
    }
  } catch (error: any) {
    return { success: false, error: error.message || '不明なエラーが発生しました' };
  }
}

// ========================================
// バックアップ（エクスポート/インポート）
// ========================================

async function handleGetExportData(): Promise<Response<BackupFile>> {
  const [folders, notes, quickMemo, settings, syncData] = await Promise.all([
    getFolders(),
    getAllNotes(),
    getQuickMemo(),
    getSettings(),
    chrome.storage.sync.get(['folderOrder'])
  ]);

  const folderOrder = Array.isArray(syncData.folderOrder) ? syncData.folderOrder : undefined;

  const notesWithThumbnail = notes.filter((note) => typeof note.thumbnailPath === 'string' && note.thumbnailPath.length > 0);
  let thumbnailsByNoteId: Record<string, BackupThumbnailV1> | undefined = undefined;

  if (notesWithThumbnail.length > 0) {
    const authState = await getAuthState();
    if (!authState.isAuthenticated) {
      console.warn('[Export] Not authenticated. Exporting without thumbnails.');
    } else {
      thumbnailsByNoteId = {};

      for (const note of notesWithThumbnail) {
        const result = await downloadThumbnailWebp({ path: note.thumbnailPath as string });
        if (!result.success) {
          console.warn('[Export] Skip thumbnail export:', { noteId: note.id, error: result.error });
          continue;
        }

        thumbnailsByNoteId[note.id] = {
          mimeType: 'image/webp',
          base64: arrayBufferToBase64(result.buffer)
        };
      }

      if (Object.keys(thumbnailsByNoteId).length === 0) {
        thumbnailsByNoteId = undefined;
      }
    }
  }

  const data: BackupFile = {
    schemaVersion: BACKUP_SCHEMA_VERSION,
    exportedAt: new Date().toISOString(),
    folders,
    folderOrder,
    notes,
    quickMemo,
    settings,
    thumbnailsByNoteId
  };

  return { success: true, data };
}

function validateBackupFile(data: unknown): { success: true; backup: BackupFile } | { success: false; error: string } {
  if (!data || typeof data !== 'object') {
    return { success: false, error: 'バックアップ形式が不正です' };
  }

  const obj = data as Record<string, unknown>;

  const rawSchemaVersion = obj.schemaVersion;
  let schemaVersion: number | null = null;

  // 旧形式（schemaVersionなし）も受け付ける
  if (rawSchemaVersion === undefined || rawSchemaVersion === null) {
    schemaVersion = 0;
  } else if (typeof rawSchemaVersion === 'number') {
    schemaVersion = rawSchemaVersion;
  } else if (typeof rawSchemaVersion === 'string') {
    const parsed = Number(rawSchemaVersion);
    schemaVersion = Number.isFinite(parsed) ? parsed : null;
  }

  if (schemaVersion === null || (schemaVersion !== BACKUP_SCHEMA_VERSION && schemaVersion !== 0)) {
    return { success: false, error: 'バックアップのバージョンが不正です' };
  }

  if (typeof obj.exportedAt !== 'string') {
    return { success: false, error: 'バックアップ形式が不正です（exportedAt）' };
  }
  if (!Array.isArray(obj.folders) || !Array.isArray(obj.notes)) {
    return { success: false, error: 'バックアップ形式が不正です（folders/notes）' };
  }

  const quickMemo = obj.quickMemo as Record<string, unknown> | undefined;
  if (!quickMemo || typeof quickMemo.content !== 'string' || typeof quickMemo.updatedAt !== 'number') {
    return { success: false, error: 'バックアップ形式が不正です（quickMemo）' };
  }

  const settings = obj.settings as Record<string, unknown> | undefined;
  if (
    !settings ||
    typeof settings.shortcutGuideShown !== 'boolean' ||
    typeof settings.memoFontSize !== 'number' ||
    typeof settings.panelLastWidth !== 'number' ||
    typeof settings.panelLastHeight !== 'number'
  ) {
    return { success: false, error: 'バックアップ形式が不正です（settings）' };
  }

  const folderOrder = Array.isArray(obj.folderOrder) ? (obj.folderOrder as string[]) : undefined;
  const thumbnailsByNoteId =
    obj.thumbnailsByNoteId && typeof obj.thumbnailsByNoteId === 'object'
      ? (obj.thumbnailsByNoteId as Record<string, BackupThumbnailV1>)
      : undefined;

  return {
    success: true,
    backup: {
      schemaVersion: BACKUP_SCHEMA_VERSION,
      exportedAt: obj.exportedAt as string,
      folders: obj.folders as Folder[],
      folderOrder,
      notes: obj.notes as Note[],
      quickMemo: obj.quickMemo as QuickMemo,
      settings: obj.settings as any,
      thumbnailsByNoteId
    }
  };
}

function buildUniqueTitle(params: { desiredTitle: string; used: Set<string> }) {
  const base = params.desiredTitle.trim() || 'Imported Note';
  let candidate = base;
  let suffix = 2;

  while (params.used.has(normalizeKey(candidate))) {
    candidate = `${base} (import ${suffix})`;
    suffix += 1;
  }

  params.used.add(normalizeKey(candidate));
  return candidate;
}

async function handleImportBackupData(
  rawData: unknown
): Promise<Response<{
  addedFolders: number;
  addedNotes: number;
  restoredThumbnails: number;
  sync: { success: boolean; error?: string };
}>> {
  const validated = validateBackupFile(rawData);
  if (!validated.success) {
    return { success: false, error: validated.error };
  }

  const backup = validated.backup;

  const [syncData, localData] = await Promise.all([
    chrome.storage.sync.get(['folders', 'folderOrder', 'settings']),
    chrome.storage.local.get(['notes', 'quickMemo', 'noteMetadata'])
  ]);

  const existingFolderMap = (syncData.folders || {}) as Record<string, Folder>;
  const existingNotesMap = (localData.notes || {}) as Record<string, Note>;
  const existingMetadataMap = (localData.noteMetadata || {}) as Record<string, NoteMetadata>;

  const existingFolderIdByName = new Map<string, string>();
  for (const folder of Object.values(existingFolderMap)) {
    existingFolderIdByName.set(normalizeKey(folder.name), folder.id);
  }

  const folderIdMap = new Map<string, string>();
  folderIdMap.set(INBOX_FOLDER_ID, INBOX_FOLDER_ID);

  const foldersToAdd: Record<string, Folder> = {};
  let addedFolders = 0;

  for (const folder of backup.folders) {
    if (!folder || typeof folder !== 'object') {
      return { success: false, error: 'バックアップ形式が不正です（folder）' };
    }

    const f = folder as Folder;
    if (f.id === INBOX_FOLDER_ID || f.isSystem) {
      folderIdMap.set(f.id, INBOX_FOLDER_ID);
      continue;
    }

    const name = typeof f.name === 'string' ? f.name.trim() : '';
    if (!name) {
      return { success: false, error: 'バックアップ形式が不正です（folder.name）' };
    }

    const existingId = existingFolderIdByName.get(normalizeKey(name));
    if (existingId) {
      folderIdMap.set(f.id, existingId);
      continue;
    }

    let id = typeof f.id === 'string' ? f.id : generateImportId();
    if (!id || id === INBOX_FOLDER_ID || existingFolderMap[id] || foldersToAdd[id]) {
      id = generateImportId();
    }

    foldersToAdd[id] = {
      id,
      name,
      createdAt: typeof f.createdAt === 'number' ? f.createdAt : Date.now(),
      isSystem: false
    };

    folderIdMap.set(f.id, id);
    existingFolderIdByName.set(normalizeKey(name), id);
    addedFolders += 1;
  }

  if (Object.keys(existingFolderMap).length + Object.keys(foldersToAdd).length > LIMITS.MAX_FOLDERS) {
    return { success: false, error: `フォルダ数の上限（${LIMITS.MAX_FOLDERS}）に達するため、インポートできません` };
  }

  const mergedFolderMap: Record<string, Folder> = { ...existingFolderMap, ...foldersToAdd };

  const existingFolderOrder = Array.isArray(syncData.folderOrder) ? syncData.folderOrder : undefined;
  let nextFolderOrder: string[] | undefined = existingFolderOrder ? [...existingFolderOrder] : undefined;

  if (nextFolderOrder && Object.keys(foldersToAdd).length > 0) {
    const importedOrderSource = Array.isArray(backup.folderOrder)
      ? backup.folderOrder
      : backup.folders.map(folder => (folder as Folder).id);

    const seen = new Set(nextFolderOrder);
    for (const oldId of importedOrderSource) {
      const mappedId = folderIdMap.get(oldId);
      if (!mappedId || mappedId === INBOX_FOLDER_ID) continue;
      if (!mergedFolderMap[mappedId]) continue;
      if (seen.has(mappedId)) continue;
      nextFolderOrder.push(mappedId);
      seen.add(mappedId);
    }
  }

  const existingCountsByFolder = new Map<string, number>();
  const usedTitlesByFolder = new Map<string, Set<string>>();

  for (const note of Object.values(existingNotesMap)) {
    existingCountsByFolder.set(note.folderId, (existingCountsByFolder.get(note.folderId) ?? 0) + 1);
    const set = usedTitlesByFolder.get(note.folderId) ?? new Set<string>();
    set.add(normalizeKey(note.title));
    usedTitlesByFolder.set(note.folderId, set);
  }

  const incomingCountsByFolder = new Map<string, number>();
  for (const note of backup.notes) {
    const n = note as Note;
    const folderId = folderIdMap.get(n.folderId) ?? INBOX_FOLDER_ID;
    incomingCountsByFolder.set(folderId, (incomingCountsByFolder.get(folderId) ?? 0) + 1);
  }

  for (const [folderId, count] of incomingCountsByFolder) {
    const current = existingCountsByFolder.get(folderId) ?? 0;
    if (current + count > LIMITS.MAX_NOTES_PER_FOLDER) {
      return { success: false, error: `フォルダ内メモ数の上限（${LIMITS.MAX_NOTES_PER_FOLDER}）に達するため、インポートできません` };
    }
  }

  if (Object.keys(existingNotesMap).length + backup.notes.length > LIMITS.MAX_TOTAL_NOTES) {
    return { success: false, error: `総メモ数の上限（${LIMITS.MAX_TOTAL_NOTES}）に達するため、インポートできません` };
  }

  const notesToAdd: Record<string, Note> = {};
  const metadataToAdd: Record<string, NoteMetadata> = {};
  const noteIdMap = new Map<string, string>();

  for (const note of backup.notes) {
    if (!note || typeof note !== 'object') {
      return { success: false, error: 'バックアップ形式が不正です（note）' };
    }

    const n = note as Note;
    if (typeof n.id !== 'string' || typeof n.content !== 'string' || typeof n.title !== 'string' || typeof n.folderId !== 'string') {
      return { success: false, error: 'バックアップ形式が不正です（note fields）' };
    }

    if (n.content.length > LIMITS.MAX_NOTE_LENGTH) {
      return { success: false, error: `メモの最大文字数（${LIMITS.MAX_NOTE_LENGTH}）を超えているため、インポートできません` };
    }

    const folderId = folderIdMap.get(n.folderId) ?? INBOX_FOLDER_ID;

    let id = generateImportId();
    while (existingNotesMap[id] || notesToAdd[id]) {
      id = generateImportId();
    }

    const used = usedTitlesByFolder.get(folderId) ?? new Set<string>();
    const title = buildUniqueTitle({ desiredTitle: n.title, used });
    usedTitlesByFolder.set(folderId, used);

    const createdAt = typeof n.createdAt === 'number' ? n.createdAt : Date.now();
    const updatedAt = typeof n.updatedAt === 'number' ? n.updatedAt : createdAt;
    const lastOpenedAt = typeof n.lastOpenedAt === 'number' ? n.lastOpenedAt : 0;

    notesToAdd[id] = {
      id,
      folderId,
      title,
      content: n.content,
      createdAt,
      updatedAt,
      lastOpenedAt
    };

    noteIdMap.set(n.id, id);
  }

  const thumbnailsByNoteId = backup.thumbnailsByNoteId ?? {};
  const thumbnailKeys = Object.keys(thumbnailsByNoteId);

  let restoredThumbnails = 0;

  if (thumbnailKeys.length > 0) {
    const authState = await getAuthState();
    if (!authState.isAuthenticated || !authState.userId) {
      return { success: false, error: 'サムネイルの復元にはサインインが必要です' };
    }

    for (const oldNoteId of thumbnailKeys) {
      const thumb = thumbnailsByNoteId[oldNoteId] as BackupThumbnailV1 | undefined;
      if (!thumb || thumb.mimeType !== 'image/webp' || typeof thumb.base64 !== 'string') {
        return { success: false, error: 'バックアップ形式が不正です（thumbnail）' };
      }

      const newNoteId = noteIdMap.get(oldNoteId);
      if (!newNoteId) continue;

      const buffer = base64ToArrayBuffer(thumb.base64);
      const path = buildThumbnailPath({ userId: authState.userId, noteId: newNoteId });
      const uploaded = await uploadThumbnailWebp({ path, data: buffer });
      if (!uploaded.success) {
        return { success: false, error: uploaded.error ?? 'サムネイルの復元に失敗しました' };
      }

      notesToAdd[newNoteId].thumbnailPath = path;
      restoredThumbnails += 1;
    }
  }

  for (const note of Object.values(notesToAdd)) {
    metadataToAdd[note.id] = {
      id: note.id,
      folderId: note.folderId,
      title: note.title,
      thumbnailPath: note.thumbnailPath,
      createdAt: note.createdAt,
      updatedAt: note.updatedAt,
      lastOpenedAt: note.lastOpenedAt
    };
  }

  await Promise.all([
    chrome.storage.sync.set({
      folders: mergedFolderMap,
      ...(nextFolderOrder ? { folderOrder: nextFolderOrder } : {}),
      settings: backup.settings
    }),
    chrome.storage.local.set({
      notes: { ...existingNotesMap, ...notesToAdd },
      noteMetadata: { ...existingMetadataMap, ...metadataToAdd },
      quickMemo: backup.quickMemo
    })
  ]);

  const authState = await getAuthState();
  let sync: { success: boolean; error?: string } = { success: false, error: '未サインインのため、Supabaseへの同期は行っていません' };

  if (authState.isAuthenticated) {
    let syncError: string | null = null;
    const folderIds = new Set<string>();

    for (const note of Object.values(notesToAdd)) {
      folderIds.add(note.folderId);
    }

    for (const folderId of folderIds) {
      const folder = mergedFolderMap[folderId];
      if (!folder) continue;
      const result = await uploadFolder(folder);
      if (!result.success) {
        syncError = result.error || 'Supabaseへのフォルダ同期に失敗しました';
        break;
      }
    }

    if (!syncError) {
      for (const note of Object.values(notesToAdd)) {
        const result = await uploadMemo(note);
        if (!result.success) {
          syncError = result.error || 'Supabaseへのメモ同期に失敗しました';
          break;
        }
      }
    }

    if (!syncError) {
      const result = await uploadQuickMemo(backup.quickMemo);
      if (!result.success) {
        syncError = result.error || 'Supabaseへの下書きメモ同期に失敗しました';
      }
    }

    sync = syncError ? { success: false, error: syncError } : { success: true };
  }

  return {
    success: true,
    data: {
      addedFolders,
      addedNotes: Object.keys(notesToAdd).length,
      restoredThumbnails,
      sync
    }
  };
}

// ========================================
// ユーティリティ
// ========================================

/**
 * 注入がブロックされるURLかどうかを判定
 */
function isInjectionBlockedUrl(url: string | undefined): boolean {
  if (!url) return true;

  const blockedPrefixes = [
    'chrome://',
    'chrome-extension://',
    'edge://',
    'about:',
    'view-source:'
  ];

  const blockedDomains = [
    'chrome.google.com/webstore'
  ];

  // プレフィックスチェック
  for (const prefix of blockedPrefixes) {
    if (url.startsWith(prefix)) {
      return true;
    }
  }

  // ドメインチェック
  for (const domain of blockedDomains) {
    if (url.includes(domain)) {
      return true;
    }
  }

  return false;
}

console.log('[Background] Service worker loaded');
