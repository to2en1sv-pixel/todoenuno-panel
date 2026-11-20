const DEMO_SESSION_KEY = 'nexo_demo_sandbox_v1';
const DEMO_RESET_EVENT = 'nexo:demo-reset';

function readUrlDemoParam(): 'on' | 'off' | null {
  if (typeof window === 'undefined') return null;
  try {
    const params = new URLSearchParams(window.location.search);
    const val = (params.get('demo') || '').trim().toLowerCase();
    if (val === '1' || val === 'true' || val === 'on' || val === 'yes') return 'on';
    if (val === '0' || val === 'false' || val === 'off' || params.get('exit_demo') === '1') return 'off';
  } catch {
    // ignore malformed URL
  }
  return null;
}

export function isDemoMode(): boolean {
  if (typeof window === 'undefined') return false;

  const urlSignal = readUrlDemoParam();
  if (urlSignal === 'off') {
    try {
      window.sessionStorage.removeItem(DEMO_SESSION_KEY);
    } catch {
      // ignore storage restrictions
    }
    return false;
  }

  const pathname = window.location.pathname || '/';
  if (pathname === '/demo' || pathname.startsWith('/demo/')) {
    try {
      window.sessionStorage.setItem(DEMO_SESSION_KEY, '1');
    } catch {
      // ignore storage restrictions
    }
    return true;
  }

  if (urlSignal === 'on') {
    try {
      window.sessionStorage.setItem(DEMO_SESSION_KEY, '1');
    } catch {
      // ignore storage restrictions
    }
    return true;
  }

  try {
    return window.sessionStorage.getItem(DEMO_SESSION_KEY) === '1';
  } catch {
    return false;
  }
}

export function enterDemoMode(targetPath = '/'): void {
  if (typeof window === 'undefined') return;
  try {
    window.sessionStorage.setItem(DEMO_SESSION_KEY, '1');
  } catch {
    // ignore
  }
  const cleanTarget = targetPath.startsWith('/') ? targetPath : `/${targetPath}`;
  const sep = cleanTarget.includes('?') ? '&' : '?';
  window.location.assign(`${cleanTarget}${sep}demo=1`);
}

export function exitDemoMode(): void {
  if (typeof window === 'undefined') return;
  try {
    window.sessionStorage.removeItem(DEMO_SESSION_KEY);
  } catch {
    // ignore
  }
  window.location.assign('/?demo=0');
}

export function getDemoShareUrl(): string {
  if (typeof window === 'undefined') return '/demo';
  return `${window.location.origin}/demo`;
}

export function notifyDemoReset(): void {
  if (typeof window === 'undefined') return;
  window.dispatchEvent(new CustomEvent(DEMO_RESET_EVENT));
}

export { DEMO_RESET_EVENT };
