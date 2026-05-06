import { useState, useEffect, useRef, useCallback } from 'react';

/**
 * usePersistedState — useState com persistência automática em sessionStorage.
 *
 * Persiste estado de UI (filtros, aba ativa, viewMode) para que,
 * caso o Chrome descarte a aba (tab discard) ou ocorra um remount,
 * o estado seja restaurado.
 *
 * Regras:
 * - Usa sessionStorage (não sobrevive fechamento da aba, apenas da sessão).
 * - TTL padrão: 30 minutos. Entradas expiradas são ignoradas e removidas.
 * - Debounce de 300ms para não floodar storage a cada keystroke.
 * - NÃO use para dados sensíveis (tokens, senhas, dados pessoais).
 *
 * @param key   Chave única no sessionStorage (prefixada com "ps:")
 * @param defaultValue  Valor padrão caso não haja nada salvo
 * @param ttlMs  Tempo de vida em ms (padrão: 30 min)
 */
const PREFIX = 'ps:';
const DEFAULT_TTL = 30 * 60 * 1000; // 30 minutes

interface StoredEntry<T> {
  v: T;         // value
  ts: number;   // timestamp
}

function readFromStorage<T>(key: string, ttlMs: number): T | undefined {
  try {
    const raw = sessionStorage.getItem(PREFIX + key);
    if (!raw) return undefined;

    const entry: StoredEntry<T> = JSON.parse(raw);
    if (Date.now() - entry.ts > ttlMs) {
      // Expired — clean up
      sessionStorage.removeItem(PREFIX + key);
      return undefined;
    }
    return entry.v;
  } catch {
    return undefined;
  }
}

function writeToStorage<T>(key: string, value: T): void {
  try {
    const entry: StoredEntry<T> = { v: value, ts: Date.now() };
    sessionStorage.setItem(PREFIX + key, JSON.stringify(entry));
  } catch {
    // Storage full or unavailable — silently ignore
  }
}

export function usePersistedState<T>(
  key: string,
  defaultValue: T,
  ttlMs: number = DEFAULT_TTL,
): [T, (value: T | ((prev: T) => T)) => void] {
  const [state, setStateRaw] = useState<T>(() => {
    const stored = readFromStorage<T>(key, ttlMs);
    return stored !== undefined ? stored : defaultValue;
  });

  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const latestValueRef = useRef(state);

  const setState = useCallback((value: T | ((prev: T) => T)) => {
    setStateRaw((prev) => {
      const next = typeof value === 'function' ? (value as (prev: T) => T)(prev) : value;
      latestValueRef.current = next;
      return next;
    });
  }, []);

  // Debounced write to sessionStorage
  useEffect(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => {
      writeToStorage(key, state);
    }, 300);

    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
  }, [key, state]);

  // Flush on pagehide (tab discard / navigation)
  useEffect(() => {
    const flush = () => {
      writeToStorage(key, latestValueRef.current);
    };
    window.addEventListener('pagehide', flush);
    return () => window.removeEventListener('pagehide', flush);
  }, [key]);

  return [state, setState];
}
