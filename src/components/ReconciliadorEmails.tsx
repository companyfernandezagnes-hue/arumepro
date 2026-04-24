// ============================================================================
// 🤖 ReconciliadorEmails — pipeline automático factura-email vs factura-interna
// 1. Descarga emails con PDFs del proveedor
// 2. IA extrae datos de cada PDF (proveedor, num, fecha, total)
// 3. Busca match en facturas internas (agrupadas de albaranes) por:
//    - Mismo proveedor (fuzzy ±2 chars)
//    - Total ±1€ tolerancia
//    - Fecha ±15 días
// 4. Presenta resultados con acciones: aprobar/rechazar/buscar manual
// ============================================================================
import React, { useState, useCallback } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import {
  X, CheckCircle2, AlertTriangle, Mail, Loader2,
  Sparkles, RefreshCw, Link as LinkIcon, Search, ShieldCheck,
} from 'lucide-react';
import { AppData, FacturaExtended } from '../types';
import { Num } from '../services/engine';
import { cn } from '../lib/utils';
import { scanBase64 } from '../services/aiProviders';
import { GmailDirectSync } from '../services/gmailDirectSync';
import { toast } from '../hooks/useToast';
import { EmptyState } from './EmptyState';

interface Props {
  isOpen: boolean;
  onClose: () => void;
  data: AppData;
  onSave: (newData: AppData) => Promise<void>;
}

type MatchStatus = 'perfect' | 'probable' | 'no_match' | 'pending';

interface EmailPdfResult {
  id: string;
  emailFrom: string;
  emailSubject: string;
  fileName: string;
  fileBase64: string;    // PDF original en base64
  mimeType: string;
  // Datos extraídos por IA
  iaProveedor: string;
  iaNum: string;
  iaFecha: string;
  iaTotal: number;
  iaBase: number;
  iaIva: number;
  // Matching
  status: MatchStatus;
  matchedFactura?: FacturaExtended;
  diff?: number;              // diferencia en € vs matched
  reason?: string;            // explicación por qué match o no
  processed?: boolean;        // ya se aprobó/rechazó
  processedAction?: 'approved' | 'rejected';
}

// ─── Helpers ─────────────────────────────────────────────────────────────────
const norm = (s: string) => s.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^a-z0-9]+/g, '');

const daysBetween = (iso1: string, iso2: string): number => {
  try {
    const d1 = new Date(iso1).getTime();
    const d2 = new Date(iso2).getTime();
    return Math.abs(Math.floor((d1 - d2) / 86_400_000));
  } catch { return 999; }
};

// Busca la mejor factura interna que cuadre con los datos del PDF
function findBestMatch(pdfData: {
  proveedor: string; total: number; fecha: string; num: string;
}, facturas: FacturaExtended[]): { factura: FacturaExtended; status: MatchStatus; diff: number; reason: string } | null {
  const provN = norm(pdfData.proveedor);
  if (!provN || pdfData.total <= 0) return null;

  const candidates: { f: FacturaExtended; score: number; reason: string }[] = [];

  for (const f of facturas) {
    if (f.tipo !== 'compra' || (f as any).file_base64) continue; // ya tiene PDF
    const fProvN = norm(f.prov || f.cliente || '');
    if (!fProvN) continue;

    // Match nombre (score 0-3)
    let score = 0;
    let reasons: string[] = [];
    if (fProvN === provN) { score += 3; reasons.push('proveedor exacto'); }
    else if (fProvN.includes(provN.slice(0, 6)) || provN.includes(fProvN.slice(0, 6))) {
      score += 2; reasons.push('proveedor similar');
    } else continue;

    // Match número (score +3 si exacto, +1 si parcial)
    if (pdfData.num && f.num) {
      const pN = String(pdfData.num).trim().toLowerCase();
      const fN = String(f.num).trim().toLowerCase();
      if (pN === fN) { score += 3; reasons.push('nº factura exacto'); }
      else if (pN.length >= 4 && (pN.includes(fN) || fN.includes(pN))) { score += 1; reasons.push('nº factura parcial'); }
    }

    // Match total (tolerancia 1€)
    const fTotal = Math.abs(Num.parse(f.total));
    const diff = Math.abs(fTotal - pdfData.total);
    if (diff <= 0.05) { score += 3; reasons.push('total exacto'); }
    else if (diff <= 1) { score += 2; reasons.push(`total ±${diff.toFixed(2)}€`); }
    else if (diff <= 5) { score += 1; reasons.push(`total ±${diff.toFixed(2)}€`); }

    // Match fecha (±15 días)
    if (pdfData.fecha && f.date) {
      const dd = daysBetween(pdfData.fecha, f.date);
      if (dd <= 1) { score += 2; reasons.push('fecha exacta'); }
      else if (dd <= 15) { score += 1; reasons.push(`${dd}d de diferencia`); }
    }

    if (score >= 4) candidates.push({ f, score, reason: reasons.join(' · ') });
  }

  candidates.sort((a, b) => b.score - a.score);
  if (candidates.length === 0) return null;

  const best = candidates[0];
  const diff = Math.abs(Math.abs(Num.parse(best.f.total)) - pdfData.total);
  const status: MatchStatus = best.score >= 7 ? 'perfect' : 'probable';
  return { factura: best.f, status, diff, reason: best.reason };
}

// ═══════════════════════════════════════════════════════════════════════════
export const ReconciliadorEmails: React.FC<Props> = ({ isOpen, onClose, data, onSave }) => {
  const [loading, setLoading] = useState(false);
  const [progress, setProgress] = useState('');
  const [results, setResults] = useState<EmailPdfResult[]>([]);

  const facturas = data.facturas || [];

  const runPipeline = useCallback(async () => {
    setLoading(true);
    setResults([]);
    setProgress('Comprobando sesión de Gmail…');

    try {
      // 1. Asegurar token Gmail válido
      const token = await GmailDirectSync.ensureValidToken();
      if (!token) {
        toast.error('Gmail no autorizado. Ve al módulo Agente y conecta Gmail primero.');
        setLoading(false);
        return;
      }

      // 2. Descargar emails con PDFs
      setProgress('Leyendo tu correo (buscando facturas)…');
      const { emails, error } = await GmailDirectSync.fetchNewEmails(20);
      if (error) {
        toast.error(`Gmail: ${error}`);
        setLoading(false);
        return;
      }

      if (emails.length === 0) {
        setProgress('');
        setLoading(false);
        toast.info('No hay correos nuevos con PDFs.');
        return;
      }

      // 3. Por cada PDF, extraer con IA y buscar match
      const promptOCR = `Eres un auditor contable. Extrae de esta factura SOLO un JSON sin markdown:
{"proveedor":"nombre emisor","num":"número factura","fecha":"YYYY-MM-DD","total":0.00,"base":0.00,"iva":0.00}
Importes sin símbolo €, punto decimal. Si algún campo no aparece, usa 0 o "".`;

      const allResults: EmailPdfResult[] = [];
      let idx = 0;
      for (const email of emails) {
        for (const att of email.attachments) {
          idx++;
          setProgress(`Analizando adjunto ${idx}: ${att.filename}…`);
          try {
            const scan = await scanBase64(att.base64, att.mimeType, promptOCR);
            const raw: any = scan?.raw || {};
            const pdfData = {
              proveedor: String(raw.proveedor || '').trim(),
              num: String(raw.num || '').trim(),
              fecha: String(raw.fecha || '').trim(),
              total: Num.parse(raw.total),
              base: Num.parse(raw.base),
              iva: Num.parse(raw.iva),
            };

            const matchResult = findBestMatch(pdfData, facturas);

            allResults.push({
              id: `rec-${email.id}-${att.filename}`,
              emailFrom: email.from,
              emailSubject: email.subject,
              fileName: att.filename,
              fileBase64: `data:${att.mimeType};base64,${att.base64}`,
              mimeType: att.mimeType,
              iaProveedor: pdfData.proveedor,
              iaNum: pdfData.num,
              iaFecha: pdfData.fecha,
              iaTotal: pdfData.total,
              iaBase: pdfData.base,
              iaIva: pdfData.iva,
              status: matchResult ? matchResult.status : 'no_match',
              matchedFactura: matchResult?.factura,
              diff: matchResult?.diff,
              reason: matchResult?.reason || 'Sin match en tus facturas',
            });
            // Actualizar UI en tiempo real
            setResults([...allResults]);
          } catch (err: any) {
            console.warn('[Reconciliador] fallo PDF:', att.filename, err?.message);
          }
        }
      }

      setProgress('');
      setLoading(false);

      const perfect = allResults.filter(r => r.status === 'perfect').length;
      const probable = allResults.filter(r => r.status === 'probable').length;
      const noMatch = allResults.filter(r => r.status === 'no_match').length;
      toast.success(`✅ ${perfect} cuadran · 🟡 ${probable} revisar · 🔴 ${noMatch} sin match`);
    } catch (err: any) {
      toast.error('Error: ' + (err?.message || 'desconocido'));
      setLoading(false);
    }
  }, [facturas]);

  const handleApprove = async (r: EmailPdfResult) => {
    if (!r.matchedFactura) return;
    const newData = JSON.parse(JSON.stringify(data)) as AppData;
    const idx = (newData.facturas || []).findIndex((f: any) => f.id === r.matchedFactura!.id);
    if (idx === -1) return;
    (newData.facturas as any)[idx] = {
      ...(newData.facturas as any)[idx],
      file_base64: r.fileBase64,
      paid: false,               // lista para pagar, pero no pagada aún
      reviewed: true,
      status: 'approved',
      // Si la IA leyó datos que no teníamos, los completamos
      num: (newData.facturas as any)[idx].num || r.iaNum,
      base: (newData.facturas as any)[idx].base || r.iaBase,
      tax:  (newData.facturas as any)[idx].tax  || r.iaIva,
    };
    await onSave(newData);
    setResults(prev => prev.map(x => x.id === r.id ? { ...x, processed: true, processedAction: 'approved' } : x));
    toast.success('✅ PDF adjuntado a la factura. Lista para pagar.');
  };

  const handleReject = (r: EmailPdfResult) => {
    setResults(prev => prev.map(x => x.id === r.id ? { ...x, processed: true, processedAction: 'rejected' } : x));
    toast.info('Descartado. Puedes crearlo manualmente desde Compras si hace falta.');
  };

  const perfect = results.filter(r => r.status === 'perfect' && !r.processed);
  const probable = results.filter(r => r.status === 'probable' && !r.processed);
  const noMatch = results.filter(r => r.status === 'no_match' && !r.processed);
  const processed = results.filter(r => r.processed);

  if (!isOpen) return null;

  const renderResult = (r: EmailPdfResult) => {
    const Icon = r.status === 'perfect' ? CheckCircle2
      : r.status === 'probable' ? AlertTriangle
      : Search;
    const accentCls = r.status === 'perfect'
      ? 'border-[color:var(--arume-ok)]/30 bg-[color:var(--arume-ok)]/5'
      : r.status === 'probable'
      ? 'border-[color:var(--arume-warn)]/30 bg-[color:var(--arume-warn)]/5'
      : 'border-[color:var(--arume-gray-200)] bg-[color:var(--arume-gray-50)]';
    const iconColor = r.status === 'perfect' ? 'text-[color:var(--arume-ok)]'
      : r.status === 'probable' ? 'text-[color:var(--arume-warn)]'
      : 'text-[color:var(--arume-gray-500)]';

    return (
      <div key={r.id} className={cn('border rounded-2xl p-4', accentCls, r.processed && 'opacity-60')}>
        <div className="flex items-start gap-3">
          <Icon className={cn('w-5 h-5 shrink-0 mt-0.5', iconColor)}/>
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2 flex-wrap">
              <p className="font-serif text-base font-semibold text-[color:var(--arume-ink)]">{r.iaProveedor || 'Sin proveedor'}</p>
              <span className="text-[10px] font-semibold uppercase tracking-[0.15em] text-[color:var(--arume-gray-500)] bg-white px-2 py-0.5 rounded-full border border-[color:var(--arume-gray-200)]">
                {r.iaNum || 'S/N'}
              </span>
              {r.iaFecha && <span className="text-[11px] text-[color:var(--arume-gray-500)] tabular-nums">{r.iaFecha}</span>}
              <span className="ml-auto font-serif text-lg font-semibold tabular-nums text-[color:var(--arume-ink)]">{Num.fmt(r.iaTotal)}</span>
            </div>
            <p className="text-[11px] text-[color:var(--arume-gray-500)] mt-1 truncate">
              📧 {r.emailSubject} · {r.fileName}
            </p>
            {r.matchedFactura && (
              <div className="mt-2 bg-white/60 rounded-lg p-2 border border-[color:var(--arume-gray-200)]">
                <p className="text-[11px] font-semibold text-[color:var(--arume-ink)] flex items-center gap-1">
                  <LinkIcon className="w-3 h-3"/> Cuadra con tu factura interna
                </p>
                <p className="text-[11px] text-[color:var(--arume-gray-600)]">
                  {r.matchedFactura.prov || r.matchedFactura.cliente} ·
                  {' '}{r.matchedFactura.num || 'S/N'} ·
                  {' '}{r.matchedFactura.date} ·
                  {' '}<b>{Num.fmt(Math.abs(Num.parse(r.matchedFactura.total)))}</b>
                  {r.diff !== undefined && r.diff > 0.05 && (
                    <span className="text-[color:var(--arume-warn)]"> · diff {Num.fmt(r.diff)}</span>
                  )}
                </p>
                <p className="text-[10px] text-[color:var(--arume-gray-400)] mt-0.5">🤖 {r.reason}</p>
              </div>
            )}
            {r.processed ? (
              <span className={cn('inline-block mt-2 text-[10px] font-semibold uppercase tracking-[0.15em] px-2 py-0.5 rounded-full',
                r.processedAction === 'approved' ? 'bg-[color:var(--arume-ok)]/10 text-[color:var(--arume-ok)]' : 'bg-[color:var(--arume-gray-100)] text-[color:var(--arume-gray-500)]')}>
                {r.processedAction === 'approved' ? '✓ Aprobada' : '✗ Rechazada'}
              </span>
            ) : (
              <div className="flex gap-2 mt-3">
                {r.matchedFactura && (
                  <button onClick={() => handleApprove(r)}
                    className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full text-[11px] font-semibold uppercase tracking-[0.15em] bg-[color:var(--arume-ink)] text-[color:var(--arume-paper)] hover:bg-[color:var(--arume-gray-700)] transition">
                    <CheckCircle2 className="w-3.5 h-3.5"/> Aprobar y adjuntar
                  </button>
                )}
                <button onClick={() => handleReject(r)}
                  className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full text-[11px] font-semibold uppercase tracking-[0.15em] border border-[color:var(--arume-gray-200)] text-[color:var(--arume-gray-600)] hover:bg-white transition">
                  Descartar
                </button>
              </div>
            )}
          </div>
        </div>
      </div>
    );
  };

  return (
    <AnimatePresence>
      <div className="fixed inset-0 z-[400] flex items-center justify-center p-4">
        <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
          className="absolute inset-0 bg-[color:var(--arume-ink)]/70 backdrop-blur-sm cursor-default"
          onClick={onClose}
        />
        <motion.div
          initial={{ y: 40, opacity: 0, scale: 0.97 }}
          animate={{ y: 0, opacity: 1, scale: 1 }}
          exit={{ y: 40, opacity: 0, scale: 0.97 }}
          className="relative bg-[color:var(--arume-paper)] w-full max-w-3xl max-h-[90vh] rounded-2xl flex flex-col overflow-hidden"
          style={{ boxShadow: '0 24px 80px rgba(11,11,12,0.35)' }}
        >
          <span className="absolute top-0 left-0 right-0 h-[2px] bg-[color:var(--arume-gold)]"/>

          {/* Header */}
          <div className="p-6 border-b border-[color:var(--arume-gray-100)]">
            <div className="flex items-start justify-between gap-3">
              <div>
                <p className="text-[11px] font-semibold uppercase tracking-[0.2em] text-[color:var(--arume-gold)]">Agente IA · Reconciliador</p>
                <h3 className="font-serif text-2xl font-semibold tracking-tight mt-1">Auto-cuadrar facturas del correo</h3>
                <p className="text-sm text-[color:var(--arume-gray-500)] mt-1">
                  Leo los PDFs de tus correos, los comparo con tus facturas generadas y apruebas con 1 click.
                </p>
              </div>
              <button onClick={onClose}
                className="p-2 bg-[color:var(--arume-gray-50)] rounded-full hover:bg-[color:var(--arume-gray-100)] transition">
                <X className="w-4 h-4"/>
              </button>
            </div>

            <div className="flex items-center gap-3 mt-4">
              <button onClick={runPipeline} disabled={loading}
                className="inline-flex items-center gap-2 px-5 py-2.5 rounded-full text-[11px] font-semibold uppercase tracking-[0.15em] bg-[color:var(--arume-gold)] text-[color:var(--arume-ink)] hover:brightness-95 transition active:scale-[0.98] disabled:opacity-50">
                {loading
                  ? <><Loader2 className="w-3.5 h-3.5 animate-spin ai-pulse"/> {progress || 'Procesando…'}</>
                  : <><Sparkles className="w-3.5 h-3.5 ai-pulse"/> Sincronizar y cuadrar</>
                }
              </button>
              {!loading && results.length > 0 && (
                <button onClick={runPipeline}
                  className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full text-[11px] font-semibold uppercase tracking-[0.15em] text-[color:var(--arume-gray-600)] border border-[color:var(--arume-gray-200)] hover:bg-white transition">
                  <RefreshCw className="w-3 h-3"/> Reintentar
                </button>
              )}
            </div>

            {/* Resumen */}
            {results.length > 0 && (
              <div className="flex gap-2 mt-3 flex-wrap">
                {perfect.length > 0 && (
                  <span className="text-[11px] font-semibold uppercase tracking-[0.15em] bg-[color:var(--arume-ok)]/10 text-[color:var(--arume-ok)] border border-[color:var(--arume-ok)]/30 px-2.5 py-1 rounded-full">
                    ✓ {perfect.length} cuadran
                  </span>
                )}
                {probable.length > 0 && (
                  <span className="text-[11px] font-semibold uppercase tracking-[0.15em] bg-[color:var(--arume-warn)]/10 text-[color:var(--arume-warn)] border border-[color:var(--arume-warn)]/30 px-2.5 py-1 rounded-full">
                    ⚠ {probable.length} revisar
                  </span>
                )}
                {noMatch.length > 0 && (
                  <span className="text-[11px] font-semibold uppercase tracking-[0.15em] bg-[color:var(--arume-gray-100)] text-[color:var(--arume-gray-600)] px-2.5 py-1 rounded-full">
                    🔴 {noMatch.length} sin match
                  </span>
                )}
                {processed.length > 0 && (
                  <span className="text-[11px] font-semibold uppercase tracking-[0.15em] bg-[color:var(--arume-gray-50)] text-[color:var(--arume-gray-400)] px-2.5 py-1 rounded-full">
                    {processed.length} procesadas
                  </span>
                )}
              </div>
            )}
          </div>

          {/* Body */}
          <div className="flex-1 overflow-y-auto p-5 space-y-4">
            {results.length === 0 && !loading && (
              <EmptyState
                icon={Mail}
                eyebrow="Reconciliador"
                title="Pulsa «Sincronizar y cuadrar»"
                message="Conectaré con Gmail, descargaré los PDFs de tus correos y los compararé con tus facturas internas."
              />
            )}

            {perfect.length > 0 && (
              <section>
                <div className="flex items-center gap-2 mb-2">
                  <ShieldCheck className="w-4 h-4 text-[color:var(--arume-ok)]"/>
                  <p className="text-[11px] font-semibold uppercase tracking-[0.2em] text-[color:var(--arume-ok)]">Cuadran perfectamente · aprueba rápido</p>
                </div>
                <div className="space-y-2">{perfect.map(renderResult)}</div>
              </section>
            )}
            {probable.length > 0 && (
              <section>
                <div className="flex items-center gap-2 mb-2">
                  <AlertTriangle className="w-4 h-4 text-[color:var(--arume-warn)]"/>
                  <p className="text-[11px] font-semibold uppercase tracking-[0.2em] text-[color:var(--arume-warn)]">Revisar · hay pequeñas diferencias</p>
                </div>
                <div className="space-y-2">{probable.map(renderResult)}</div>
              </section>
            )}
            {noMatch.length > 0 && (
              <section>
                <div className="flex items-center gap-2 mb-2">
                  <Search className="w-4 h-4 text-[color:var(--arume-gray-500)]"/>
                  <p className="text-[11px] font-semibold uppercase tracking-[0.2em] text-[color:var(--arume-gray-500)]">Sin coincidencias · crea factura manual si procede</p>
                </div>
                <div className="space-y-2">{noMatch.map(renderResult)}</div>
              </section>
            )}
            {processed.length > 0 && (
              <section>
                <p className="text-[11px] font-semibold uppercase tracking-[0.2em] text-[color:var(--arume-gray-400)] mb-2">Procesadas</p>
                <div className="space-y-2">{processed.map(renderResult)}</div>
              </section>
            )}
          </div>
        </motion.div>
      </div>
    </AnimatePresence>
  );
};
