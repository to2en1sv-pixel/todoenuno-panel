import type { ReactNode } from 'react';
export function Badge({ tone = 'neutral', children }: { tone?: 'neutral'|'ok'|'er'|'ac'; children: ReactNode }) {
  return <span className={`chip ${tone === 'ok' ? 'ok' : tone === 'er' ? 'er' : tone === 'ac' ? 'ac' : ''}`}>{children}</span>;
}
