// Helper para padronizar logs e mensagens de erro do Supabase.
// Importante: manter compatível com diferentes formatos de erro (PostgREST, Auth, Storage).

export type AnySupabaseError = {
  message?: string;
  code?: string;
  details?: string;
  hint?: string;
  status?: number;
  error_description?: string;
  stack?: string;
} & Record<string, unknown>;

function pick<T extends Record<string, unknown>, K extends keyof T>(obj: T, key: K): T[K] | undefined {
  return obj && Object.prototype.hasOwnProperty.call(obj, key) ? obj[key] : undefined;
}

export function describeSupabaseError(err: unknown): string {
  const e = (err ?? {}) as AnySupabaseError;

  const msg = (e.message || e.error_description || '')?.toString().trim();
  const details = (e.details || '')?.toString().trim();
  const hint = (e.hint || '')?.toString().trim();

  const parts = [msg, details, hint].filter(Boolean);
  if (parts.length > 0) return parts.join(' | ');

  try {
    return JSON.stringify(err);
  } catch {
    return 'Erro desconhecido.';
  }
}

export function logSupabaseError(context: string, err: unknown) {
  const e = (err ?? {}) as AnySupabaseError;

  const payload = {
    context,
    message: e.message || e.error_description,
    code: e.code,
    status: (e as any).status ?? (e as any).statusCode ?? undefined,
    details: e.details,
    hint: e.hint,
    stack: e.stack,
    raw: err,
  };

  // eslint-disable-next-line no-console
  console.error('[SUPABASE_ERROR]', payload);

  // Se for um erro PostgREST, às vezes vem em campos diferentes
  const error = pick(e as any, 'error');
  if (error && typeof error === 'object') {
    // eslint-disable-next-line no-console
    console.error('[SUPABASE_ERROR:inner]', error);
  }
}
