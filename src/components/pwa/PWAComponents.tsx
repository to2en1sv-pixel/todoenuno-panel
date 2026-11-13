import { useState } from 'react';
import { Download, Share, Smartphone, WifiOff, X } from 'lucide-react';
import { useOnlineStatus, usePWAInstall } from '@/hooks/usePWAInstall';

export function PWAInstallButton({ compact = false }: { compact?: boolean }) {
  const { isInstallable, isInstalled, isIOS, install } = usePWAInstall();
  const [showIOSGuide, setShowIOSGuide] = useState(false);

  if (isInstalled) {
    return null;
  }

  if (isInstallable) {
    return (
      <button
        type="button"
        onClick={() => void install()}
        className={
          compact
            ? 'inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-xs font-semibold cursor-pointer whitespace-nowrap shrink-0'
            : 'w-full inline-flex items-center justify-center gap-2 px-3 py-2.5 rounded-xl text-xs font-semibold transition-opacity hover:opacity-90 cursor-pointer whitespace-nowrap'
        }
        style={{ background: 'var(--ac)', color: '#ffffff' }}
      >
        <Download size={14} />
        <span>Instalar App</span>
      </button>
    );
  }

  if (isIOS) {
    return (
      <>
        <button
          type="button"
          onClick={() => setShowIOSGuide(true)}
          className={
            compact
              ? 'inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg bg-sf bd text-xs font-medium cursor-pointer whitespace-nowrap shrink-0'
              : 'w-full inline-flex items-center justify-center gap-2 px-3 py-2 rounded-xl bg-sf bd text-xs font-medium hover:border-[var(--ac)] transition-colors cursor-pointer whitespace-nowrap'
          }
        >
          <Smartphone size={14} style={{ color: 'var(--ac)' }} />
          <span>Instalar en iPhone</span>
        </button>

        {showIOSGuide && (
          <div
            className="fixed inset-0 z-50 flex items-center justify-center bg-black/55 p-4"
            onClick={() => setShowIOSGuide(false)}
          >
            <div
              onClick={(e) => e.stopPropagation()}
              className="w-full max-w-sm rounded-2xl bg-cd bd p-5 text-[var(--tx)] shadow-xl"
            >
              <div className="flex items-center justify-between gap-2 mb-3">
                <h3 className="text-sm font-bold">Instalar TODOENUNO OS en iPhone / iPad</h3>
                <button
                  type="button"
                  onClick={() => setShowIOSGuide(false)}
                  aria-label="Cerrar guía iOS"
                  className="p-1.5 rounded-lg bg-sf bd tx-mu cursor-pointer"
                >
                  <X size={14} />
                </button>
              </div>
              <ol className="text-xs tx-mu space-y-2 leading-relaxed">
                <li className="flex items-start gap-2">
                  <span className="font-bold text-[var(--tx)]">1.</span>
                  <span>
                    En Safari, toca el botón <strong className="text-[var(--tx)]">Compartir</strong>{' '}
                    <Share size={12} className="inline mx-0.5" /> en la barra inferior.
                  </span>
                </li>
                <li className="flex items-start gap-2">
                  <span className="font-bold text-[var(--tx)]">2.</span>
                  <span>
                    Desliza hacia abajo y selecciona{' '}
                    <strong className="text-[var(--tx)]">Agregar a inicio</strong>.
                  </span>
                </li>
                <li className="flex items-start gap-2">
                  <span className="font-bold text-[var(--tx)]">3.</span>
                  <span>
                    Confirma pulsando <strong className="text-[var(--tx)]">Agregar</strong> para abrirla en pantalla completa.
                  </span>
                </li>
              </ol>
              <button
                type="button"
                onClick={() => setShowIOSGuide(false)}
                className="mt-4 w-full py-2.5 rounded-xl text-xs font-semibold cursor-pointer"
                style={{ background: 'var(--tx)', color: 'var(--cd)' }}
              >
                Entendido
              </button>
            </div>
          </div>
        )}
      </>
    );
  }

  return null;
}

export function OfflineIndicator() {
  const isOnline = useOnlineStatus();

  if (isOnline) return null;

  return (
    <div
      className="fixed bottom-4 left-4 right-4 sm:right-auto z-50 flex items-center gap-2 rounded-xl px-3.5 py-2.5 text-xs font-semibold shadow-lg"
      style={{ background: 'var(--ac)', color: '#ffffff' }}
      role="status"
      aria-live="polite"
    >
      <WifiOff size={14} className="shrink-0" />
      <span>Sin conexión a internet — Mostrando vista en caché</span>
    </div>
  );
}
