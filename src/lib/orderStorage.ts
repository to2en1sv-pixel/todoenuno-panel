import { useEffect, useState } from 'react';
import { supabase } from '@/lib/supabase';

export const ORDERS_EVIDENCE_BUCKET = 'orders-evidence';
export const ORDERS_EVIDENCE_DOC_TITLE = '__SYSTEM_ORDERS_EVIDENCE_V1__';
const LOCAL_EVIDENCE_KEY = 'todoenuno_orders_evidence_v1';
const EVIDENCE_UPDATED_EVENT = 'todoenuno:orders-evidence-updated';

export type OrderEvidenceKind = 'guia' | 'entrega' | 'firma';

export interface OrderEvidenceRecord {
  guiaUrl?: string;
  guiaFileName?: string;
  guiaNumber?: string;
  guiaSentAt?: string;
  entregaUrl?: string;
  firmaUrl?: string;
  deliveredAt?: string;
  deliveredBy?: string;
  updatedAt?: string;
}

export type OrdersEvidenceMap = Record<string, OrderEvidenceRecord>;

function dataUrlToBlob(dataUrl: string): { blob: Blob; mimeType: string } {
  const match = dataUrl.match(/^data:([^;]+);base64,([\s\S]+)$/);
  const mimeType = match?.[1] || 'image/jpeg';
  const b64 = (match?.[2] || dataUrl).replace(/\s+/g, '');
  const binary = atob(b64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  return { blob: new Blob([bytes], { type: mimeType }), mimeType };
}

export async function ensureOrdersEvidenceBucket(): Promise<{
  ok: boolean;
  bucket: string;
  error?: string;
}> {
  try {
    const resp = await fetch(
      `/api/content-distribute?action=ensure_bucket&bucket=${ORDERS_EVIDENCE_BUCKET}`,
      { method: 'POST' }
    );
    const ct = resp.headers.get('content-type') || '';
    if (ct.includes('application/json')) {
      const json = await resp.json().catch(() => ({}));
      if (resp.ok && json?.ok) {
        return { ok: true, bucket: ORDERS_EVIDENCE_BUCKET };
      }
      return {
        ok: false,
        bucket: ORDERS_EVIDENCE_BUCKET,
        error: json?.error || `HTTP ${resp.status}`,
      };
    }
  } catch {}

  try {
    const { data, error } = await supabase.storage.getBucket(ORDERS_EVIDENCE_BUCKET);
    if (!error && data) {
      return { ok: true, bucket: ORDERS_EVIDENCE_BUCKET };
    }
  } catch {}

  return {
    ok: false,
    bucket: ORDERS_EVIDENCE_BUCKET,
    error: `El bucket "${ORDERS_EVIDENCE_BUCKET}" aún no existe o el endpoint /api solo corre en Vercel.`,
  };
}

export async function uploadOrderDataUrlToBucket(params: {
  orderId: string;
  kind: OrderEvidenceKind;
  dataUrl: string;
  fileName?: string;
}): Promise<{
  ok: boolean;
  publicUrl?: string;
  bucket: string;
  error?: string;
}> {
  const { orderId, kind, dataUrl } = params;
  const safeOrderId = String(orderId || 'sin-id').replace(/[^a-zA-Z0-9_-]/g, '');
  const { blob, mimeType } = dataUrlToBlob(dataUrl);
  const ext = mimeType.includes('png') ? 'png' : 'jpg';
  const rawName = params.fileName || `${kind}-${safeOrderId}.${ext}`;
  const safeName = rawName.replace(/[^a-zA-Z0-9._-]/g, '_');
  const folder = `pedidos/${safeOrderId}`;
  const storagePath = `${folder}/${Date.now()}-${kind}-${safeName}`;

  // 1. Asegurar bucket desde backend (usa service role en producción)
  let ensureError = '';
  try {
    const ensureResp = await fetch(
      `/api/content-distribute?action=ensure_bucket&bucket=${ORDERS_EVIDENCE_BUCKET}`,
      { method: 'POST' }
    );
    const ct = ensureResp.headers.get('content-type') || '';
    if (ct.includes('application/json')) {
      const ensureJson = await ensureResp.json().catch(() => ({}));
      if (!ensureResp.ok && ensureJson?.error) {
        ensureError = String(ensureJson.error);
      }
    }
  } catch {}

  // 2. Intentar subida directa al bucket Supabase Storage
  let directError = '';
  try {
    const { error: upErr } = await supabase.storage
      .from(ORDERS_EVIDENCE_BUCKET)
      .upload(storagePath, blob, {
        contentType: mimeType,
        upsert: true,
      });

    if (!upErr) {
      const { data: pub } = supabase.storage
        .from(ORDERS_EVIDENCE_BUCKET)
        .getPublicUrl(storagePath);
      if (pub?.publicUrl) {
        return {
          ok: true,
          publicUrl: pub.publicUrl,
          bucket: ORDERS_EVIDENCE_BUCKET,
        };
      }
    } else {
      directError = upErr.message || '';
    }
  } catch (err: any) {
    directError = err?.message || '';
  }

  // 3. Respaldo vía endpoint seguro /api/content-distribute (usa SUPABASE_SERVICE_ROLE_KEY)
  try {
    const resp = await fetch('/api/content-distribute', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        action: 'upload_base64',
        bucket: ORDERS_EVIDENCE_BUCKET,
        folder,
        fileName: `${kind}-${safeName}`,
        mimeType,
        base64Data: dataUrl,
      }),
    });

    const ct = resp.headers.get('content-type') || '';
    if (ct.includes('application/json')) {
      const data = await resp.json().catch(() => ({}));
      if (resp.ok && data?.publicUrl) {
        return {
          ok: true,
          publicUrl: String(data.publicUrl),
          bucket: ORDERS_EVIDENCE_BUCKET,
        };
      }
      return {
        ok: false,
        bucket: ORDERS_EVIDENCE_BUCKET,
        error: data?.error || ensureError || directError || 'No se pudo subir al bucket',
      };
    }
  } catch (err: any) {
    return {
      ok: false,
      bucket: ORDERS_EVIDENCE_BUCKET,
      error: err?.message || directError || 'Error subiendo evidencia al bucket',
    };
  }

  return {
    ok: false,
    bucket: ORDERS_EVIDENCE_BUCKET,
    error:
      ensureError ||
      directError ||
      `Crea el bucket público "${ORDERS_EVIDENCE_BUCKET}" en Supabase → Storage o despliega en Vercel.`,
  };
}

export function getCachedOrdersEvidenceMap(): OrdersEvidenceMap {
  try {
    const raw = localStorage.getItem(LOCAL_EVIDENCE_KEY);
    if (raw) {
      const parsed = JSON.parse(raw);
      if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
        return parsed as OrdersEvidenceMap;
      }
    }
  } catch {}
  return {};
}

function writeLocalEvidenceMap(map: OrdersEvidenceMap) {
  try {
    localStorage.setItem(LOCAL_EVIDENCE_KEY, JSON.stringify(map));
    if (typeof window !== 'undefined') {
      window.dispatchEvent(new CustomEvent(EVIDENCE_UPDATED_EVENT, { detail: map }));
    }
  } catch {}
}

export async function fetchOrdersEvidenceMap(): Promise<OrdersEvidenceMap> {
  try {
    const { data, error } = await supabase
      .from('panel_docs')
      .select('contenido')
      .eq('titulo', ORDERS_EVIDENCE_DOC_TITLE)
      .maybeSingle();

    if (!error && data?.contenido) {
      const parsed = JSON.parse(data.contenido);
      if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
        try {
          localStorage.setItem(LOCAL_EVIDENCE_KEY, JSON.stringify(parsed));
        } catch {}
        return parsed as OrdersEvidenceMap;
      }
    }
  } catch {}

  return getCachedOrdersEvidenceMap();
}

export async function saveOrderEvidence(
  orderId: string,
  patch: Partial<OrderEvidenceRecord>
): Promise<{ ok: boolean; map: OrdersEvidenceMap }> {
  const currentCloud = await fetchOrdersEvidenceMap();
  const prevEntry = currentCloud[orderId] || {};
  const nextMap: OrdersEvidenceMap = {
    ...currentCloud,
    [orderId]: {
      ...prevEntry,
      ...patch,
      updatedAt: new Date().toISOString(),
    },
  };

  writeLocalEvidenceMap(nextMap);

  try {
    const serialized = JSON.stringify(nextMap);
    const nowIso = new Date().toISOString();
    const { data: existing, error: selErr } = await supabase
      .from('panel_docs')
      .select('id')
      .eq('titulo', ORDERS_EVIDENCE_DOC_TITLE)
      .maybeSingle();

    if (selErr) return { ok: false, map: nextMap };

    if (existing?.id) {
      const { error: updErr } = await supabase
        .from('panel_docs')
        .update({
          contenido: serialized,
          categoria: 'Sistema',
          estado: 'Completado',
          updated_at: nowIso,
        })
        .eq('id', existing.id);
      return { ok: !updErr, map: nextMap };
    }

    const { error: insErr } = await supabase.from('panel_docs').insert({
      titulo: ORDERS_EVIDENCE_DOC_TITLE,
      contenido: serialized,
      categoria: 'Sistema',
      estado: 'Completado',
      updated_at: nowIso,
    });
    return { ok: !insErr, map: nextMap };
  } catch {
    return { ok: false, map: nextMap };
  }
}

export function useOrdersEvidenceMap() {
  const [evidenceMap, setEvidenceMap] = useState<OrdersEvidenceMap>(() =>
    getCachedOrdersEvidenceMap()
  );

  useEffect(() => {
    let active = true;
    fetchOrdersEvidenceMap().then((loaded) => {
      if (active) setEvidenceMap(loaded);
    });

    const onUpdated = (e: Event) => {
      const custom = e as CustomEvent<OrdersEvidenceMap>;
      if (custom.detail && typeof custom.detail === 'object') {
        setEvidenceMap(custom.detail);
      } else {
        setEvidenceMap(getCachedOrdersEvidenceMap());
      }
    };

    window.addEventListener(EVIDENCE_UPDATED_EVENT, onUpdated);
    return () => {
      active = false;
      window.removeEventListener(EVIDENCE_UPDATED_EVENT, onUpdated);
    };
  }, []);

  return { evidenceMap, setEvidenceMap };
}
