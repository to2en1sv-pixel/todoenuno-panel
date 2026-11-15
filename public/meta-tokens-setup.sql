-- ============================================================================
-- TODOENUNO OS · Tablas Seguras para Tokens de Publicación y Meta Ads
-- Ejecutar en Supabase SQL Editor (RLS habilitado: solo backend con service_role)
-- ============================================================================

-- 1. Tokens de publicación por página (separado de fb_pages para no tocar Social Inbox)
CREATE TABLE IF NOT EXISTS public.fb_publish_pages (
  page_id TEXT PRIMARY KEY,
  page_name TEXT NOT NULL,
  publish_token TEXT NOT NULL,
  niche TEXT,
  active BOOLEAN NOT NULL DEFAULT true,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE public.fb_publish_pages ENABLE ROW LEVEL SECURITY;
-- Sin políticas para anon/authenticated: ningún navegador puede leer publish_token.

-- 2. Cuentas publicitarias de Meta Ads (requiere System User Token con ads_read + read_insights)
CREATE TABLE IF NOT EXISTS public.meta_ad_accounts (
  ad_account_id TEXT PRIMARY KEY, -- Formato: act_123456789012345
  account_name TEXT NOT NULL,
  access_token TEXT NOT NULL,
  page_id TEXT, -- Opcional: vincular cuenta publicitaria a una de tus 4 páginas/nichos
  currency TEXT NOT NULL DEFAULT 'USD',
  active BOOLEAN NOT NULL DEFAULT true,
  last_synced_at TIMESTAMPTZ,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE public.meta_ad_accounts ENABLE ROW LEVEL SECURITY;
-- Sin políticas para anon/authenticated: ningún navegador puede leer access_token.

-- Ejemplo de inserción cuando tengas tus tokens de System User:
-- INSERT INTO public.fb_publish_pages (page_id, page_name, publish_token, niche)
-- VALUES ('123456789', 'Todo En Uno', 'EAA...', 'General')
-- ON CONFLICT (page_id) DO UPDATE SET publish_token = EXCLUDED.publish_token, updated_at = now();
--
-- INSERT INTO public.meta_ad_accounts (ad_account_id, account_name, access_token, page_id)
-- VALUES ('act_987654321', 'Cuenta Principal SV', 'EAA...', '123456789')
-- ON CONFLICT (ad_account_id) DO UPDATE SET access_token = EXCLUDED.access_token, updated_at = now();
