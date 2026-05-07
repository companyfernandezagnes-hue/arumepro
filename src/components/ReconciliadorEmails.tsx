// ============================================================================
// 🤖 ReconciliadorEmails — pipeline: factura-email → subset-sum vs albaranes
// 1. Descarga emails con PDFs de proveedores (Gmail API)
// 2. Descarga cada adjunto bajo demanda (lazy)
// 3. IA extrae datos de cada PDF (proveedor, num, fecha, total, base, iva)
// 4. smartMatchInvoiceToAlbaranes cruza contra albaranes por subset-sum
// 5. Presenta resultados con acciones: aprobar (crea factura + vincula) / descartar
// ============================================================================
import React, { useState, useCallback } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import {
  X, CheckCircle2, AlertTriangle, Mail, Loader2,
  Sparkles, RefreshCw, Link as LinkIcon, Search, ShieldCheck,
} from 'lucide-react';
import { AppData, Albaran, FacturaExtended } from '../types';
import { Num } from '../services/engine';
import { cn } from '../lib/utils';
import { scanBase64 } from '../services/aiProviders';
import { GmailDirectSync } from '../services/gmailDirectSync';
import { smartMatchInvoiceToAlbaranes, SmartMatchResult } from '../services/invoiceMatcher';
import { toast } from '../hooks/useToast';
import { EmptyState } from './EmptyState';

interface Props {
  isOpen: boolean;
  onClose: () => void;
  data: AppData;
  onSave: (newData: AppData) => Promise<void>;
}

interface EmailPdfResult {
  id: string;
  emailFrom: string;
  emailSubject: string;
  emailMessageId: string;
  fileName: string;
  fileBase64: string;
  mimeType: string;
  // Datos extraídos por IA
  iaProveedor: string;
  iaNum: string;
  iaFecha: string;
  iaTotal: number;
  iaBase: number;
  iaIva: number;
  // Match contra albaranes
  match: SmartMatchResult;
  // Estado de procesado
  processed?: boolean;
  processedAction?: 'approved' | 'rejected';
}

// ═══════════════════════════════════════════════════════════════════════════
export const ReconciliadorEmails: React.FC<Props> = ({ isOpen, onClose, data, onSave }) => {
  const [loading, setLoading] = useState(false);
  const [progress, setProgress] = useState('');
  const [results, setResults] = useState<EmailPdfResult[]>([]);

  const albaranes = data.albaranes || [];

  const runPipeline = useCallback(async () => {
    setLoading(true);
    setResults([]);
    setProgress('Comprobando sesión de Gmail…');

    try {
      // 1. Asegurar token Gmail válido
      const token = await GmailDirectSync.ensureValidToken();
      if (!token) {
        toast.error('Gmail no autorizado. Ve a Ajustes → Agente y conecta Gmail primero.');
        setLoading(false);
        return;
      }

      // 2. Descargar lista de emails con PDFs (SIN contenido aún — lazy)
      setProgress('Leyendo tu correo (buscando facturas)…');
      const { emails, error } = await GmailDirectSync.fetchNewEmails(20, false);
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

      // 3. Por cada PDF: descargar contenido → OCR → match contra albaranes
      const promptOCR = `Eres un auditor contable. Extrae de esta factura/albarán SOLO un JSON sin markdown:
{"proveedor":"nombre emisor (NO el receptor/cliente)","num":"número factura","fecha":"YYYY-MM-DD","total":0.00,"base":0.00,"iva":0.00}
El EMISOR es quien vende y emite la factura. El RECEPTOR (Arume, Agnès, etc.) NUNCA es el proveedor.
Importes sin símbolo €, punto decimal. Si algún campo no aparece, usa 0 o "".`;

      const allResults: EmailPdfResult[] = [];
      let idx = 0;
      for (const email of emails) {
        for (const att of email.attachments) {
          idx++;
          setProgress(`Descargando y analizando ${idx}/${emails.reduce((s, e) => s + e.attachments.length, 0)}: ${att.filename}…`);
          try {
            // 3a. Descargar el contenido del PDF bajo demanda
            let base64 = att.base64;
            if (!base64 && att.attachmentId) {
              base64 = await GmailDirectSync.fetchAttachmentBase64(email.id, att.attachmentId) || '';
            }
            if (!base64) {
              console.warn('[Reconciliador] Sin contenido para:', att.filename);
              continue;
            }

            // 3b. OCR del PDF
            const scan = await scanBase64(base64, att.mimeType || 'application/pdf', promptOCR);
            const raw: any = scan?.raw || {};
            const pdfData = {
              proveedor: String(raw.proveedor || '').trim(),
              num: String(raw.num || '').trim(),
              fecha: String(raw.fecha || '').trim(),
              total: Num.parse(raw.total),
              base: Num.parse(raw.base),
              iva: Num.parse(raw.iva),
            };

            // 3c. Match contra albaranes (subset-sum)
            const match = smartMatchInvoiceToAlbaranes(
              {
                proveedor: pdfData.proveedor,
                total: pdfData.total,
                fecha: pdfData.fecha,
                num_factura: pdfData.num,
              },
              albaranes.filter(a => !a.invoiced),
            );

            allResults.push({
              id: `rec-${email.id}-${att.filename}`,
              emailFrom: email.from,
              emailSubject: email.subject,
              emailMessageId: email.id,
              fileName: att.filename,
              fileBase64: base64,
              mimeType: att.mimeType || 'application/pdf',
              iaProveedor: pdfData.proveedor,
              iaNum: pdfData.num,
              iaFecha: pdfData.fecha,
              iaTotal: pdfData.total,
              iaBase: pdfData.base,
              iaIva: pdfData.iva,
              match,
            });
            setResults([...allResults]);
          } catch (err: any) {
            console.warn('[Reconciliador] fallo PDF:', att.filename, err?.message);
          }
        }
      }

      setProgress('');
      setLoading(false);

      const alta = allResults.filter(r => r.match.confidence === 'alta').length;
      const media = allResults.filter(r => r.match.confidence === 'media').length;
      const rest = allResults.length - alta - media;
      toast.success(`✅ ${alta} cuadran · 🟡 ${media} revisar · 🔴 ${rest} sin match`);
    } catch (err: any) {
      toast.error('Error: ' + (err?.message || 'desconocido'));
      setLoading(false);
    }
  }, [albaranes]);

  // Aprobar = crear factura de compra + vincular albaranes matched
  const handleApprove = async (r: EmailPdfResult) => {
    const newData = JSON.parse(JSON.stringify(data)) as AppData;
    if (!newData.facturas) newData.facturas = [];

    const facturaId = `fac-email-${Date.now()}-${Math.random().toString(36).slice(2, 5)}`;
    const nuevaFactura: FacturaExtended = {
      id: facturaId,
      tipo: 'compra',
      num: r.iaNum || 'S/N',
      date: r.iaFecha || new Date().toISOString().slice(0, 10),
      prov: r.iaProveedor,
      total: r.iaTotal,
      base: r.iaBase,
      tax: r.iaIva,
      paid: false,
      reconciled: r.match.confidence === 'alta',
      source: 'gmail-sync',
      status: r.match.confidence === 'alta' ? 'approved' : 'draft',
      file_base64: `data:${r.mimeType};base64,${r.fileBase64}`,
      albaranIdsArr: r.match.matchedAlbaranIds,
      albaranIds: r.match.matchedAlbaranIds.join(','),
      reviewed: true,
    };
    newData.facturas.unshift(nuevaFactura);

    // Marcar albaranes como facturados
    if (r.match.matchedAlbaranIds.length > 0 && newData.albaranes) {
      const matchedSet = new Set(r.match.matchedAlbaranIds);
      for (const alb of newData.albaranes) {
        if (matchedSet.has(alb.id)) {
          alb.invoiced = true;
        }
      }
    }

    // Marcar email como leído en Gmail
    try {
      await GmailDirectSync.markAsRead(r.emailMessageId);
    } catch { /* no bloquea */ }

    await onSave(newData);
    setResults(prev => prev.map(x => x.id === r.id ? { ...x, processed: true, processedAction: 'approved' } : x));
    toast.success(`✅ Factura creada de ${r.iaProveedor} · ${r.match.matchedAlbaranIds.length} albaranes vinculados`);
  };

  const handleReject = (r: EmailPdfResult) => {
    setResults(prev => prev.map(x => x.id === r.id ? { ...x, processed: true, processedAction: 'rejected' } : x));
    toast.info('Descartado.');
  };

  // Agrupar resultados por calidad de match
  const alta = results.filter(r => r.match.confidence === 'alta' && !r.processed);
  const media = results.filter(r => r.match.confidence === 'media' && !r.processed);
  const baja = results.filter(r => (r.match.confidence === 'baja' || r.match.confidence === 'nula' || r.match.confidence === 'sin_proveedor') && !r.processed);
  const processed = results.filter(r => r.processed);

  if (!isOpen) return null;

  const renderResult = (r: EmailPdfResult) => {
    const m = r.match;
    const isAlta = m.confidence === 'alta';
    const isMedia = m.confidence === 'media';
    const Icon = isAlta ? CheckCircle2 : isMedia ? AlertTriangle : Search;
    const accentCls = isAlta
      ? 'border-[color:var(--arume-ok)]/30 bg-[color:var(--arume-ok)]/5'
      : isMedia
      ? 'border-[color:var(--arume-warn)]/30 bg-[color:var(--arume-warn)]/5'
      : 'border-[color:var(--arume-gray-200)] bg-[color:var(--arume-gray-50)]';
    const iconColor = isAlta ? 'text-[color:var(--arume-ok)]'
      : isMedia ? 'text-[color:var(--arume-warn)]'
      : 'text-[color:var(--arume-gray-500)]';

    return (
      <div key={r.id} className={cn('border rounded-2xl p-4', accentCls, r.processed && 'opacity-60')}>
        <div className="flex items-start gap-3">
          <Icon className={cn('w-5 h-5 shrink-0 mt-0.5', iconColor)}/>
          <div className="flex-1 min-w-0">
            {/* Cabecera: proveedor + num + fecha + total */}
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

            {/* Comparación factura vs albaranes */}
            <div className="mt-2 bg-white/60 rounded-lg p-3 border border-[color:var(--arume-gray-200)]">
              {m.matchedAlbaranIds.length > 0 ? (
                <>
                  <div className="flex items-center gap-1.5 mb-1.5">
                    <LinkIcon className="w-3 h-3 text-[color:var(--arume-ink)]"/>
                    <p className="text-[11px] font-semibold text-[color:var(--arume-ink)]">
                      {m.matchType === 'subset_sum' ? 'Subset-sum cuadra' :
                       m.matchType === 'todos_albaranes' ? 'Todos los albaranes cuadran' :
                       m.matchType === 'num_factura' ? 'Match por nº factura' :
                       'Match aproximado'}
                    </p>
                  </div>
                  <div className="grid grid-cols-3 gap-2 text-center">
                    <div>
                      <p className="text-[9px] font-semibold uppercase tracking-[0.15em] text-[color:var(--arume-gray-400)]">Factura</p>
                      <p className="text-sm font-serif font-semibold tabular-nums text-[color:var(--arume-ink)]">{Num.fmt(m.emailTotal)}</p>
                    </div>
                    <div>
                      <p className="text-[9px] font-semibold uppercase tracking-[0.15em] text-[color:var(--arume-gray-400)]">{m.matchedAlbaranIds.length} albarán(es)</p>
                      <p className="text-sm font-serif font-semibold tabular-nums text-[color:var(--arume-ink)]">{Num.fmt(m.matchedTotal)}</p>
                    </div>
                    <div>
                      <p className="text-[9px] font-semibold uppercase tracking-[0.15em] text-[color:var(--arume-gray-400)]">Diferencia</p>
                      <p className={cn(
                        'text-sm font-serif font-semibold tabular-nums',
                        Math.abs(m.diferencia) <= 1 ? 'text-[color:var(--arume-ok)]' :
                        Math.abs(m.diferencia) <= 5 ? 'text-[color:var(--arume-warn)]' :
                        'text-[color:var(--arume-error,#dc2626)]'
                      )}>{m.diferencia >= 0 ? '+' : ''}{Num.fmt(m.diferencia)}</p>
                    </div>
                  </div>
                  {m.albaranesConsiderados > m.matchedAlbaranIds.length && (
                    <p className="text-[10px] text-[color:var(--arume-gray-400)] mt-1.5">
                      De {m.albaranesConsiderados} albaranes del proveedor, {m.matchedAlbaranIds.length} cuadran con esta factura.
                    </p>
                  )}
                </>
              ) : (
                <div className="flex items-center gap-2">
                  <Search className="w-3.5 h-3.5 text-[color:var(--arume-gray-400)]"/>
                  <p className="text-[11px] text-[color:var(--arume-gray-500)]">{m.errorMsg || 'Sin albaranes que coincidan.'}</p>
                </div>
              )}
            </div>

            {/* Acciones */}
            {r.processed ? (
              <span className={cn('inline-block mt-2 text-[10px] font-semibold uppercase tracking-[0.15em] px-2 py-0.5 rounded-full',
                r.processedAction === 'approved' ? 'bg-[color:var(--arume-ok)]/10 text-[color:var(--arume-ok)]' : 'bg-[color:var(--arume-gray-100)] text-[color:var(--arume-gray-500)]')}>
                {r.processedAction === 'approved' ? '✓ Factura creada + albaranes vinculados' : '✗ Descartada'}
              </span>
            ) : (
              <div className="flex gap-2 mt-3">
                <button onClick={() => handleApprove(r)}
                  className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full text-[11px] font-semibold uppercase tracking-[0.15em] bg-[color:var(--arume-ink)] text-[color:var(--arume-paper)] hover:bg-[color:var(--arume-gray-700)] transition">
                  <CheckCircle2 className="w-3.5 h-3.5"/>
                  {m.matchedAlbaranIds.length > 0 ? 'Aprobar y vincular' : 'Crear factura sin vincular'}
                </button>
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
                <h3 className="font-serif text-2xl font-semibold tracking-tight mt-1">Facturas del correo vs Albaranes</h3>
                <p className="text-sm text-[color:var(--arume-gray-500)] mt-1">
                  Leo los PDFs de tus correos, los comparo con tus albaranes por subset-sum, y apruebas con 1 click.
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
                {alta.length > 0 && (
                  <span className="text-[11px] font-semibold uppercase tracking-[0.15em] bg-[color:var(--arume-ok)]/10 text-[color:var(--arume-ok)] border border-[color:var(--arume-ok)]/30 px-2.5 py-1 rounded-full">
                    ✓ {alta.length} cuadran
                  </span>
                )}
                {media.length > 0 && (
                  <span className="text-[11px] font-semibold uppercase tracking-[0.15em] bg-[color:var(--arume-warn)]/10 text-[color:var(--arume-warn)] border border-[color:var(--arume-warn)]/30 px-2.5 py-1 rounded-full">
                    ⚠ {media.length} revisar
                  </span>
                )}
                {baja.length > 0 && (
                  <span className="text-[11px] font-semibold uppercase tracking-[0.15em] bg-[color:var(--arume-gray-100)] text-[color:var(--arume-gray-600)] px-2.5 py-1 rounded-full">
                    🔴 {baja.length} sin match
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
                message="Conectaré con Gmail, descargaré los PDFs de tus correos y los compararé con tus albaranes pendientes de facturar."
              />
            )}

            {alta.length > 0 && (
              <section>
                <div className="flex items-center gap-2 mb-2">
                  <ShieldCheck className="w-4 h-4 text-[color:var(--arume-ok)]"/>
                  <p className="text-[11px] font-semibold uppercase tracking-[0.2em] text-[color:var(--arume-ok)]">Cuadran con tus albaranes · aprueba rápido</p>
                </div>
                <div className="space-y-2">{alta.map(renderResult)}</div>
              </section>
            )}
            {media.length > 0 && (
              <section>
                <div className="flex items-center gap-2 mb-2">
                  <AlertTriangle className="w-4 h-4 text-[color:var(--arume-warn)]"/>
                  <p className="text-[11px] font-semibold uppercase tracking-[0.2em] text-[color:var(--arume-warn)]">Revisar · diferencia pequeña entre factura y albaranes</p>
                </div>
                <div className="space-y-2">{media.map(renderResult)}</div>
              </section>
            )}
            {baja.length > 0 && (
              <section>
                <div className="flex items-center gap-2 mb-2">
                  <Search className="w-4 h-4 text-[color:var(--arume-gray-500)]"/>
                  <p className="text-[11px] font-semibold uppercase tracking-[0.2em] text-[color:var(--arume-gray-500)]">Sin coincidencias · revisa manualmente</p>
                </div>
                <div className="space-y-2">{baja.map(renderResult)}</div>
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
