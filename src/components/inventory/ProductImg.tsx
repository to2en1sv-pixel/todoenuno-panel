import { useState, useMemo, useEffect } from 'react';

export function ProductImg({
  src,
  className = '',
  fallbackClassName = ''
}: {
  src?: string | null;
  className?: string;
  fallbackClassName?: string;
}) {
  const [hasError, setHasError] = useState(false);

  const isValidSrc = useMemo(() => {
    if (!src || typeof src !== 'string') return false;
    const clean = src.trim();
    if (!clean) return false;
    if (clean.startsWith('/web/image') || clean.includes('localhost') || clean.startsWith('/web/content')) {
      return false;
    }
    return true;
  }, [src]);

  useEffect(() => {
    setHasError(false);
  }, [src]);

  if (!isValidSrc || hasError) {
    return (
      <div
        className={`flex flex-col items-center justify-center text-3xl bg-gradient-to-br from-sf to-cd select-none ${
          fallbackClassName || className || 'w-full h-full'
        }`}
      >
        <span className="text-2xl">📦</span>
        <span className="text-[9px] font-mono tx-mu mt-1">Sin imagen</span>
      </div>
    );
  }

  return (
    <img
      src={src!}
      alt=""
      className={className}
      onError={() => setHasError(true)}
      loading="lazy"
    />
  );
}
