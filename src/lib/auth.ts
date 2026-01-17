import { supabase } from './supabase';

function formatSignInErrorMessage(message: string): string {
  if (message.includes('Failed to fetch')) {
    return 'Supabaseへの接続に失敗しました。ネットワーク・広告ブロッカー・Supabaseの設定（URL/認証）を確認してから再試行してください。';
  }
  if (message.includes('missing OAuth secret')) {
    return 'Supabase側でGoogle OAuthのClient Secretが未設定です。Supabase Dashboard → Authentication → Providers → Google で Client ID / Client Secret を設定してください。';
  }
  if (message.includes('Unsupported provider')) {
    return 'Supabase側でGoogle Providerが無効、または設定不足です。Supabase Dashboard → Authentication → Providers でGoogleを有効化し、Client ID / Client Secret を設定してください。';
  }
  if (message.startsWith('server_error')) {
    const redirectTo = chrome.identity.getRedirectURL('supabase-auth');
    if (message.includes('Database error saving new user')) {
      return `Supabase側DBで新規ユーザー保存に失敗しています（${message}）。auth.users のトリガー（create_inbox_folder）や folders/memos の制約が原因の可能性が高いです。Redirect URLs は ${redirectTo} を許可した上で、DBスキーマも確認してください。`;
    }
    return `認証サーバー側でエラーが返されました（${message}）。Supabase Dashboard → Authentication → Providers → Google の設定と、Authentication → URL Configuration のRedirect URLsに ${redirectTo} が許可されているか確認してください。`;
  }
  if (message.includes('ERR_BLOCKED_BY_CLIENT') || message.includes('is blocked')) {
    const id = chrome.runtime.id;
    return `認証の戻り先（chromiumapp.org）がブロックされています。広告ブロッカー等で https://${id}.chromiumapp.org/* を許可してから再試行してください。`;
  }
  return message;
}

function parseOAuthResultUrl(resultUrl: string): { code?: string; error?: string } {
  const url = new URL(resultUrl);
  const hashParams = new URLSearchParams(url.hash.startsWith('#') ? url.hash.slice(1) : url.hash);

  const error = url.searchParams.get('error') || hashParams.get('error');
  const errorDescription = url.searchParams.get('error_description') || hashParams.get('error_description');
  if (error || errorDescription) {
    const combined = [error, errorDescription].filter(Boolean).join(': ');
    return { error: combined || '認証に失敗しました' };
  }

  const code = url.searchParams.get('code') || hashParams.get('code') || undefined;
  if (code) {
    return { code };
  }

  const accessToken = hashParams.get('access_token');
  const refreshToken = hashParams.get('refresh_token');
  if (accessToken && refreshToken) {
    return { code: `implicit:${accessToken}:${refreshToken}` };
  }

  return { error: '認証結果URLから code を取得できませんでした' };
}

async function launchWebAuthFlow(url: string): Promise<string> {
  return await new Promise((resolve, reject) => {
    chrome.identity.launchWebAuthFlow({ url, interactive: true }, (resultUrl) => {
      const lastError = chrome.runtime.lastError;
      if (lastError) {
        reject(new Error(lastError.message));
        return;
      }
      if (!resultUrl) {
        reject(new Error('No result URL returned'));
        return;
      }
      resolve(resultUrl);
    });
  });
}

// =========================================
// 認証状態管理
// =========================================

export interface AuthState {
  isAuthenticated: boolean;
  userId: string | null;
  email: string | null;
}

/**
 * 現在の認証状態を取得
 */
export async function getAuthState(): Promise<AuthState> {
  const { data: { session } } = await supabase.auth.getSession();

  return {
    isAuthenticated: !!session,
    userId: session?.user?.id || null,
    email: session?.user?.email || null
  };
}

/**
 * Googleでサインイン（新しいタブで認証）
 */
export async function signInWithGoogle(): Promise<{ success: boolean; error?: string }> {
  try {
    const redirectTo = chrome.identity.getRedirectURL('supabase-auth');

    const { data, error } = await supabase.auth.signInWithOAuth({
      provider: 'google',
      options: {
        skipBrowserRedirect: true,
        redirectTo
      }
    });

    if (error) {
      console.error('[Auth] Sign in error:', error);
      return { success: false, error: formatSignInErrorMessage(error.message) };
    }

    if (!data.url) {
      return { success: false, error: 'No auth URL returned' };
    }

    const resultUrl = await launchWebAuthFlow(data.url);
    const parsed = parseOAuthResultUrl(resultUrl);
    if (parsed.error) {
      return { success: false, error: formatSignInErrorMessage(parsed.error) };
    }

    if (!parsed.code) {
      return { success: false, error: 'No auth code returned' };
    }

    if (parsed.code.startsWith('implicit:')) {
      const [, accessToken, refreshToken] = parsed.code.split(':');
      const { error: setError } = await supabase.auth.setSession({
        access_token: accessToken,
        refresh_token: refreshToken
      });
      if (setError) {
        return { success: false, error: formatSignInErrorMessage(setError.message) };
      }
      return { success: true };
    }

    const { error: exchangeError } = await supabase.auth.exchangeCodeForSession(parsed.code);
    if (exchangeError) {
      return { success: false, error: formatSignInErrorMessage(exchangeError.message) };
    }

    return { success: true };
  } catch (error) {
    console.error('[Auth] Sign in exception:', error);
    const message = error instanceof Error ? error.message : String(error);
    return { success: false, error: formatSignInErrorMessage(message) };
  }
}

/**
 * サインアウト
 */
export async function signOut(): Promise<{ success: boolean; error?: string }> {
  try {
    const { error } = await supabase.auth.signOut();

    if (error) {
      console.error('[Auth] Sign out error:', error);
      return { success: false, error: error.message };
    }

    return { success: true };
  } catch (error) {
    console.error('[Auth] Sign out exception:', error);
    const message = error instanceof Error ? error.message : String(error);
    return { success: false, error: message };
  }
}

/**
 * 認証状態の変更を監視
 */
export function onAuthStateChange(callback: (state: AuthState) => void) {
  return supabase.auth.onAuthStateChange((event, session) => {
    console.log('[Auth] State changed:', event, session?.user?.email);

    callback({
      isAuthenticated: !!session,
      userId: session?.user?.id || null,
      email: session?.user?.email || null
    });
  });
}
