/**
 * useLifecycleDebug — Diagnóstico de eventos de lifecycle do navegador.
 *
 * Ativado apenas quando VITE_DEBUG_LIFECYCLE=true (via .env / .env.local).
 * Em produção (sem flag), nenhum listener é registrado e nenhum log é emitido.
 *
 * Eventos monitorados:
 *  - visibilitychange (document.hidden, visibilityState)
 *  - focus / blur (window)
 *  - pageshow / pagehide (event.persisted = BFCache)
 *  - beforeunload
 *  - performance.navigation type
 *  - document.wasDiscarded (Chrome tab discard)
 */

const ENABLED = import.meta.env.VITE_DEBUG_LIFECYCLE === 'true';

const tag = '[LIFECYCLE]';

function getNavigationType(): string {
  try {
    const entries = performance.getEntriesByType('navigation');
    if (entries.length > 0) {
      return (entries[0] as PerformanceNavigationTiming).type ?? 'unknown';
    }
  } catch {
    // older browsers
  }
  return 'unavailable';
}

export function initLifecycleDebug(): (() => void) | undefined {
  if (!ENABLED) return undefined;

  // Log initial state
  console.log(tag, 'Debug enabled. Navigation type:', getNavigationType());

  if ('wasDiscarded' in document) {
    console.log(tag, 'document.wasDiscarded:', (document as any).wasDiscarded);
  }

  const onVisibilityChange = () => {
    console.log(tag, 'visibilitychange', {
      hidden: document.hidden,
      visibilityState: document.visibilityState,
      wasDiscarded: (document as any).wasDiscarded ?? 'N/A',
    });
  };

  const onFocus = () => console.log(tag, 'focus');
  const onBlur = () => console.log(tag, 'blur');

  const onPageShow = (e: PageTransitionEvent) => {
    console.log(tag, 'pageshow', { persisted: e.persisted });
  };

  const onPageHide = (e: PageTransitionEvent) => {
    console.log(tag, 'pagehide', { persisted: e.persisted });
  };

  const onBeforeUnload = () => {
    console.log(tag, 'beforeunload');
  };

  document.addEventListener('visibilitychange', onVisibilityChange);
  window.addEventListener('focus', onFocus);
  window.addEventListener('blur', onBlur);
  window.addEventListener('pageshow', onPageShow);
  window.addEventListener('pagehide', onPageHide);
  window.addEventListener('beforeunload', onBeforeUnload);

  return () => {
    document.removeEventListener('visibilitychange', onVisibilityChange);
    window.removeEventListener('focus', onFocus);
    window.removeEventListener('blur', onBlur);
    window.removeEventListener('pageshow', onPageShow);
    window.removeEventListener('pagehide', onPageHide);
    window.removeEventListener('beforeunload', onBeforeUnload);
  };
}
