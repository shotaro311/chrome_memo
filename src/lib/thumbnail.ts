import { supabase } from './supabase';
import { getAuthState } from './auth';

export const THUMBNAIL_BUCKET_ID = 'memo-thumbnails';
export const DEFAULT_THUMBNAIL_SIGNED_URL_EXPIRES_SEC = 60 * 10;

export function buildThumbnailPath(params: { userId: string; noteId: string }) {
  return `${params.userId}/${params.noteId}.webp`;
}

export async function uploadThumbnailWebp(params: { path: string; data: ArrayBuffer }) {
  const authState = await getAuthState();
  if (!authState.isAuthenticated || !authState.userId) {
    return { success: false, error: 'Not authenticated' as const };
  }

  const blob = new Blob([params.data], { type: 'image/webp' });
  const { error } = await supabase.storage.from(THUMBNAIL_BUCKET_ID).upload(params.path, blob, {
    contentType: 'image/webp',
    upsert: true
  });

  if (error) {
    console.error('[Thumbnail] Upload error:', error);
    return { success: false, error: error.message };
  }

  return { success: true };
}

export async function deleteThumbnail(params: { path: string }) {
  const authState = await getAuthState();
  if (!authState.isAuthenticated || !authState.userId) {
    return { success: false, error: 'Not authenticated' as const };
  }

  const { error } = await supabase.storage.from(THUMBNAIL_BUCKET_ID).remove([params.path]);
  if (error) {
    console.error('[Thumbnail] Delete error:', error);
    return { success: false, error: error.message };
  }
  return { success: true };
}

export async function createThumbnailSignedUrl(params: { path: string; expiresIn: number }) {
  const authState = await getAuthState();
  if (!authState.isAuthenticated || !authState.userId) {
    return { success: false, error: 'Not authenticated' as const };
  }

  const { data, error } = await supabase.storage
    .from(THUMBNAIL_BUCKET_ID)
    .createSignedUrl(params.path, params.expiresIn);
  if (error || !data?.signedUrl) {
    console.error('[Thumbnail] Signed URL error:', error);
    return { success: false, error: error?.message || 'Failed to create signed URL' };
  }
  return { success: true, url: data.signedUrl };
}

export async function downloadThumbnailWebp(
  params: { path: string }
): Promise<{ success: true; buffer: ArrayBuffer } | { success: false; error: string }> {
  const authState = await getAuthState();
  if (!authState.isAuthenticated || !authState.userId) {
    return { success: false, error: 'Not authenticated' };
  }

  const { data, error } = await supabase.storage.from(THUMBNAIL_BUCKET_ID).download(params.path);
  if (error || !data) {
    console.error('[Thumbnail] Download error:', error);
    return { success: false, error: error?.message || 'Failed to download thumbnail' };
  }

  try {
    const buffer = await data.arrayBuffer();
    return { success: true, buffer };
  } catch (e) {
    return { success: false, error: `Failed to read thumbnail: ${String(e)}` };
  }
}
