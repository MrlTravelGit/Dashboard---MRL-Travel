import { supabase } from './client';

/**
 * Invoca uma Edge Function garantindo que o Authorization use o access_token atual.
 * Se o token estiver expirado (401 / Invalid JWT), tenta refresh e reexecuta 1 vez.
 */
export async function invokeWithAuth<T = any>(
  functionName: string,
  options: {
    body?: any;
    headers?: Record<string, string>;
    method?: string;
  } = {},
  retryOnce = true,
) {
  const getAccessToken = async () => {
    const { data } = await supabase.auth.getSession();
    return data.session?.access_token ?? null;
  };

  const doInvoke = async (accessToken: string | null) => {
    const headers: Record<string, string> = {
      ...(options.headers || {}),
    };

    if (accessToken) {
      headers.Authorization = `Bearer ${accessToken}`;
    }

    // supabase-js aceita "body" e "headers" (e outros campos) no invoke
    return supabase.functions.invoke<T>(functionName, {
      ...(options as any),
      headers,
    } as any);
  };

  let token = await getAccessToken();
  let res = await doInvoke(token);

  const isInvalidJwt = (err: any) => {
    const msg = (err?.message || err?.toString?.() || '').toLowerCase();
    return (
      err?.status === 401 ||
      msg.includes('invalid jwt') ||
      msg.includes('jwt') && msg.includes('invalid')
    );
  };

  if (res.error && retryOnce && isInvalidJwt(res.error)) {
    // tenta refresh da sessão
    await supabase.auth.refreshSession();
    token = await getAccessToken();
    res = await doInvoke(token);
  }

  return res;
}
