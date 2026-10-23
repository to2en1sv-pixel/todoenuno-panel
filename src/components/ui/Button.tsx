import type { ButtonHTMLAttributes } from 'react';
type Variant = 'primary' | 'secondary' | 'danger';
export function Button({
  variant = 'secondary', className = '', children, ...rest
}: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: Variant }) {
  const base = 'inline-flex items-center gap-2 px-3 py-2 rounded-lg text-sm font-semibold disabled:opacity-50 disabled:cursor-not-allowed transition';
  const styles: Record<Variant, string> = {
    primary:   'text-white',
    secondary: 'bg-cd bd',
    danger:    'text-white',
  };
  const inline: React.CSSProperties =
    variant === 'primary' ? { background: 'var(--ac)', border: '1px solid var(--ac)' } :
    variant === 'danger'  ? { background: 'var(--er)', border: '1px solid var(--er)' } :
                            {};
  return (
    <button className={`${base} ${styles[variant]} ${className}`} style={{ ...inline, ...rest.style }} {...rest}>
      {children}
    </button>
  );
}
