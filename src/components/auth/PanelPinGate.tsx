import { useEffect, useState, type ReactNode } from 'react';
import { ArrowRight, Eye, EyeOff, Lock, ShieldCheck } from 'lucide-react';
import {
  fetchPanelAccessConfig,
  getCachedPanelAccessConfig,
  isPanelSessionUnlocked,
  sanitizePanelPin,
  unlockPanelSession,
  verifyPanelPin,
  type PanelAccessConfig,
} from '@/lib/panelAccess';
import { enterDemoMode } from '@/lib/demoMode';

type PanelPinGateProps = {
  children: ReactNode;
};

const MAX_ATTEMPTS = 5;
const COOLDOWN_MS = 30_000;

export function PanelPinGate({ children }: PanelPinGateProps) {
  const [config, setConfig] = useState<PanelAccessConfig>(() => getCachedPanelAccessConfig());
  const [checkingConfig, setCheckingConfig] = useState<boolean>(() => !isPanelSessionUnlocked());
  const [unlocked, setUnlocked] = useState<boolean>(() => isPanelSessionUnlocked());

  const [pinInput, setPinInput] = useState('');
  const [showPin, setShowPin] = useState(false);
  const [rememberDevice, setRememberDevice] = useState(true);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [failedAttempts, setFailedAttempts] = useState(0);
  const [lockedUntil, setLockedUntil] = useState<number>(0);
  const [cooldownLeft, setCooldownLeft] = useState<number>(0);

  useEffect(() => {
    let active = true;
    const theme = localStorage.getItem('theme') || 'light';
    document.documentElement.setAttribute('data-theme', theme);

    void fetchPanelAccessConfig().then((remoteCfg) => {
      if (!active) return;
      setConfig(remoteCfg);
      if (!remoteCfg.requirePin) {
        setUnlocked(true);
      }
      setCheckingConfig(false);
    });

    return () => {
      active = false;
    };
  }, []);

  useEffect(() => {
    if (!lockedUntil) {
      setCooldownLeft(0);
      return;
    }
    const tick = () => {
      const remaining = Math.max(0, Math.ceil((lockedUntil - Date.now()) / 1000));
      setCooldownLeft(remaining);
      if (remaining <= 0) {
        setLockedUntil(0);
        setFailedAttempts(0);
        setErrorMsg(null);
      }
    };
    tick();
    const timer = window.setInterval(tick, 1000);
    return () => window.clearInterval(timer);
  }, [lockedUntil]);

  if (unlocked || !config.requirePin) {
    return <>{children}</>;
  }

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (cooldownLeft > 0) return;

    const clean = sanitizePanelPin(pinInput);
    if (clean.length < 4) {
      setErrorMsg('Ingresa un PIN de al menos 4 dígitos.');
      return;
    }

    if (verifyPanelPin(clean, config)) {
      unlockPanelSession(rememberDevice);
      setUnlocked(true);
      setErrorMsg(null);
      return;
    }

    const nextAttempts = failedAttempts + 1;
    setFailedAttempts(nextAttempts);
    setPinInput('');
    if (nextAttempts >= MAX_ATTEMPTS) {
      setLockedUntil(Date.now() + COOLDOWN_MS);
      setErrorMsg('Demasiados intentos fallidos. Espera 30 segundos antes de reintentar.');
    } else {
      setErrorMsg(`PIN incorrecto. Te quedan ${MAX_ATTEMPTS - nextAttempts} intentos.`);
    }
  };

  return (
    <div className="min-h-screen w-full bg-[var(--bg)] text-[var(--tx)] flex items-center justify-center p-6">
      <div className="w-full max-w-[400px] bg-cd border border-[var(--bd)] rounded-2xl p-6 sm:p-7 flex flex-col gap-6">
        <div className="flex items-start gap-3">
          <div className="w-10 h-10 rounded-xl bg-[var(--tx)] text-[var(--cd)] flex items-center justify-center shrink-0">
            <Lock size={18} />
          </div>
          <div className="min-w-0">
            <h1 className="text-lg font-bold tracking-tight text-[var(--tx)]">
              Acceso Privado
            </h1>
            <p className="text-xs tx-mu mt-0.5 leading-relaxed">
              Panel operativo protegido. Ingresa el PIN de administrador para continuar.
            </p>
          </div>
        </div>

        <form onSubmit={handleSubmit} className="flex flex-col gap-4">
          <div>
            <label htmlFor="panel-pin-input" className="block text-xs font-medium text-[var(--tx)] mb-1.5">
              PIN de acceso
            </label>
            <div className="relative">
              <input
                id="panel-pin-input"
                type={showPin ? 'text' : 'password'}
                inputMode="numeric"
                autoComplete="current-password"
                autoFocus
                maxLength={8}
                disabled={checkingConfig || cooldownLeft > 0}
                value={pinInput}
                onChange={(e) => {
                  setPinInput(sanitizePanelPin(e.target.value));
                  if (errorMsg && cooldownLeft === 0) setErrorMsg(null);
                }}
                placeholder="••••"
                className="w-full px-3.5 py-2.5 pr-10 rounded-lg bg-sf border border-[var(--bd)] text-base mono tracking-[0.28em] font-semibold text-[var(--tx)] placeholder:tracking-widest focus:outline-none focus:border-[var(--tx)] disabled:opacity-60"
              />
              <button
                type="button"
                onClick={() => setShowPin((v) => !v)}
                className="absolute right-2.5 top-1/2 -translate-y-1/2 p-1 text-[var(--mu)] hover:text-[var(--tx)] transition-colors"
                aria-label={showPin ? 'Ocultar PIN' : 'Mostrar PIN'}
              >
                {showPin ? <EyeOff size={15} /> : <Eye size={15} />}
              </button>
            </div>
          </div>

          <label className="flex items-center gap-2 text-xs tx-mu cursor-pointer select-none">
            <input
              type="checkbox"
              checked={rememberDevice}
              onChange={(e) => setRememberDevice(e.target.checked)}
              className="rounded border-[var(--bd)]"
            />
            <span>Recordar en este dispositivo (7 días)</span>
          </label>

          {errorMsg && (
            <div
              role="alert"
              className="text-xs font-medium px-3 py-2 rounded-lg border"
              style={{
                borderColor: 'color-mix(in srgb, var(--er) 40%, transparent)',
                background: 'color-mix(in srgb, var(--er) 8%, transparent)',
                color: 'var(--er)',
              }}
            >
              {cooldownLeft > 0 ? `Bloqueo temporal activo (${cooldownLeft}s).` : errorMsg}
            </div>
          )}

          <button
            type="submit"
            disabled={checkingConfig || cooldownLeft > 0}
            className="w-full py-2.5 px-4 rounded-lg bg-[var(--tx)] text-[var(--cd)] text-xs font-semibold hover:opacity-90 transition-opacity disabled:opacity-50 inline-flex items-center justify-center gap-2"
          >
            <ShieldCheck size={15} />
            {checkingConfig ? 'Verificando acceso...' : 'Desbloquear panel'}
          </button>
        </form>

        <div className="pt-4 border-t border-[var(--bd)] flex flex-col gap-2">
          <p className="text-[11px] tx-mu leading-relaxed">
            ¿Buscas evaluar la plataforma sin credenciales? Accede al entorno demostrativo con datos sintéticos.
          </p>
          <button
            type="button"
            onClick={() => enterDemoMode('/demo')}
            className="w-full py-2 px-3 rounded-lg bg-sf border border-[var(--bd)] hover:border-[var(--tx)] text-xs font-semibold text-[var(--tx)] transition-colors inline-flex items-center justify-center gap-1.5"
          >
            Ir a la Demo Interactiva (Nexo COD OS)
            <ArrowRight size={13} />
          </button>
        </div>
      </div>
    </div>
  );
}
