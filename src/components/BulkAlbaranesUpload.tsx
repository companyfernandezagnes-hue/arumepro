// ==========================================
// 📦 BulkAlbaranesUpload — subida masiva de imágenes de albaranes
// Flujo:
//  1. Hash SHA-256 de cada imagen → descartar las que ya existan en la bóveda
//     (mismo file_hash en un albarán anterior).
//  2. Las que pasan el filtro se mandan a Gemini en paralelo (con retry, gracias
//     a scanBase64) y obtenemos {proveedor, num, fecha, total, lineas}.
//  3. Dedupe por metadata (proveedor + num + fecha) contra los albaranes
//     existentes — captura el caso "misma factura reenviada con otro nombre".
//  4. Pantalla de revisión: Nuevos / Repetidos por hash / Repetidos por metadata.
//  5. Botón único "Guardar X nuevos" → crea los albaranes nuevos, persistiendo
//     el file_hash para deduplicar futuras subidas.
// ==========================================

import React, { useState, useMemo } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { Upload, Loader2, X, CheckCircle2, AlertTriangle, Copy, FileImage } from 'lucide-react';
import { AppData, Albaran, BusinessUnit } from '../types';
import { sha256OfFile } from '../services/hashFile';
import { scanBase64 } from '../services/aiProviders';
import { Num } from '../services/engine';
import { basicNorm } from '../services/invoicing';
import { toast } from '../hooks/useToast';

type FileStatus =
  | { kind: 'pending' }
  | { kind: 'duplicate-hash'; existing: Albaran }
  | { kind: 'scanning' }
  | { kind: 'failed'; reason: string }
  | { kind: 'duplicate-meta'; existing: Albaran; parsed: ParsedAlbaran }
  | { kind: 'new'; parsed: ParsedAlbaran };

interface ParsedAlbaran {
  proveedor: string;
  num: string;
  fecha: string;
  total: number;
  lineas: Array<{ q?: number; n?: string; t?: number; rate?: number; u?: string }>;
}

interface FileEntry {
  id: string;
  file: File;
  hash: string;
  base64: string;
  status: FileStatus;
}

interface BulkAlbaranesUploadProps {
  isOpen: boolean;
  onClose: () => void;
  data: AppData;
  onSave: (newData: AppData) => Promise<void>;
  defaultUnitId: BusinessUnit;
}

// ── Helpers ────────────────────────────────────────────────────────────────

const fileToBase64 = (file: File): Promise<string> =>
  new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const result = reader.result as string;
      // Quitar prefijo "data:image/...;base64,"
      const idx = result.indexOf(',');
      resolve(idx >= 0 ? result.slice(idx + 1) : result);
    };
    reader.onerror = () => reject(new Error('No se pudo leer el archivo'));
    reader.readAsDataURL(file);
  });

const dedupeKey = (prov: string, num: string, fecha: string) =>
  `${basicNorm(prov || '')}::${basicNorm(num || '')}::${(fecha || '').trim()}`;

// Limita la concurrencia de promesas (evita saturar la API de Gemini)
const runWithLimit = async <T,>(items: T[], limit: number, worker: (item: T, i: number) => Promise<void>) => {
  let i = 0;
  const runners = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (i < items.length) {
      const idx = i++;
      await worker(items[idx], idx);
    }
  });
  await Promise.all(runners);
};

const PROMPT = `Analiza este albarán o factura comercial y devuelve SOLO un JSON estricto con este formato:
{"proveedor":"Nombre del proveedor","num":"Número del albarán o factura","fecha":"YYYY-MM-DD","total":0.00,"lineas":[{"q":1,"n":"Descripción del producto","t":10.50,"rate":10,"u":"kg"}]}
Si algún campo no aparece en el documento, ponlo como cadena vacía o 0.`;

// ── Componente ─────────────────────────────────────────────────────────────

export const BulkAlbaranesUpload: React.FC<BulkAlbaranesUploadProps> = ({
  isOpen, onClose, data, onSave, defaultUnitId,
}) => {
  const [phase, setPhase] = useState<'idle' | 'processing' | 'review' | 'saving'>('idle');
  const [entries, setEntries] = useState<FileEntry[]>([]);
  const [progress, setProgress] = useState({ done: 0, total: 0 });

  const albaranes = data.albaranes || [];
  const hashIndex = useMemo(() => {
    const map = new Map<string, Albaran>();
    for (const a of albaranes) if (a.file_hash) map.set(a.file_hash, a);
    return map;
  }, [albaranes]);

  const metaIndex = useMemo(() => {
    const map = new Map<string, Albaran>();
    for (const a of albaranes) {
      const k = dedupeKey(a.prov || '', a.num || '', a.date || '');
      if (!map.has(k)) map.set(k, a);
    }
    return map;
  }, [albaranes]);

  const reset = () => {
    setEntries([]);
    setProgress({ done: 0, total: 0 });
    setPhase('idle');
  };

  const handleClose = () => {
    if (phase === 'processing' || phase === 'saving') return;
    reset();
    onClose();
  };

  const handleFiles = async (files: FileList | File[]) => {
    const list = Array.from(files).filter(f => f.type.startsWith('image/'));
    if (list.length === 0) {
      toast.warning('Selecciona imágenes (JPG/PNG) de albaranes.');
      return;
    }
    setPhase('processing');
    setProgress({ done: 0, total: list.length });

    // 1. Hash en paralelo (rápido, en CPU)
    const initial: FileEntry[] = await Promise.all(
      list.map(async (file, idx) => {
        const hash = await sha256OfFile(file);
        const base64 = await fileToBase64(file);
        const dup = hashIndex.get(hash);
        return {
          id: `bulk-${Date.now()}-${idx}`,
          file,
          hash,
          base64,
          status: dup
            ? { kind: 'duplicate-hash', existing: dup } as FileStatus
            : { kind: 'pending' } as FileStatus,
        };
      })
    );
    setEntries(initial);

    // 2. Scan IA en paralelo limitado para los pendientes
    const pendientes = initial.filter(e => e.status.kind === 'pending');
    let done = initial.length - pendientes.length;
    setProgress({ done, total: initial.length });

    // Dedupe intra-lote: si la usuaria sube 3 fotos del mismo albarán (distintos
    // ángulos → distintos hashes pero mismos prov+num+fecha), sólo la primera
    // se marca como "new". Las siguientes se marcan duplicate-meta apuntando
    // a la primera del lote.
    const batchSeen = new Map<string, { id: string; parsed: ParsedAlbaran }>();

    await runWithLimit(pendientes, 3, async (entry) => {
      setEntries(prev => prev.map(e => e.id === entry.id ? { ...e, status: { kind: 'scanning' } } : e));
      try {
        const result = await scanBase64(entry.base64, entry.file.type, PROMPT);
        const raw = result.raw as any;
        const parsed: ParsedAlbaran = {
          proveedor: String(raw.proveedor || '').trim(),
          num: String(raw.num || '').trim() || 'S/N',
          fecha: String(raw.fecha || '').trim(),
          total: Num.parse(raw.total),
          lineas: Array.isArray(raw.lineas) ? raw.lineas : [],
        };
        const k = dedupeKey(parsed.proveedor, parsed.num, parsed.fecha);

        // 1º contra la bóveda (existente)
        const existingMeta = metaIndex.get(k);
        if (existingMeta) {
          setEntries(prev => prev.map(e => e.id === entry.id ? { ...e, status: { kind: 'duplicate-meta', existing: existingMeta, parsed } } : e));
          return;
        }
        // 2º contra otros del mismo lote (carpeta con repes)
        const inBatch = batchSeen.get(k);
        if (inBatch) {
          // Construir un Albaran "fake" para mostrar la referencia de la entrada hermana
          const fake: Albaran = {
            id: inBatch.id, date: inBatch.parsed.fecha, prov: inBatch.parsed.proveedor,
            num: inBatch.parsed.num, total: String(inBatch.parsed.total),
          };
          setEntries(prev => prev.map(e => e.id === entry.id ? { ...e, status: { kind: 'duplicate-meta', existing: fake, parsed } } : e));
          return;
        }
        // 3º nuevo — registrar para que las siguientes hermanas lo detecten
        batchSeen.set(k, { id: entry.id, parsed });
        setEntries(prev => prev.map(e => e.id === entry.id ? { ...e, status: { kind: 'new', parsed } } : e));
      } catch (err: any) {
        const msg = err?.message || 'IA falló';
        setEntries(prev => prev.map(e => e.id === entry.id ? { ...e, status: { kind: 'failed', reason: msg } } : e));
      } finally {
        done += 1;
        setProgress({ done, total: initial.length });
      }
    });

    setPhase('review');
  };

  const newOnes = entries.filter(e => e.status.kind === 'new');
  const dupHash = entries.filter(e => e.status.kind === 'duplicate-hash');
  const dupMeta = entries.filter(e => e.status.kind === 'duplicate-meta');
  const failed = entries.filter(e => e.status.kind === 'failed');

  const handleSave = async () => {
    if (newOnes.length === 0) {
      toast.warning('No hay albaranes nuevos para guardar.');
      return;
    }
    setPhase('saving');
    try {
      const newData: AppData = JSON.parse(JSON.stringify(data));
      if (!newData.albaranes) newData.albaranes = [];

      for (const e of newOnes) {
        if (e.status.kind !== 'new') continue;
        const p = e.status.parsed;
        const items = (p.lineas || []).map(l => ({
          q: Number(l.q) || 1,
          n: String(l.n || '').trim(),
          t: Num.parse(l.t),
          rate: Number(l.rate) || 0,
          u: String(l.u || 'uds'),
        }));
        const total = p.total || items.reduce((s, it) => s + (Number(it.t) || 0), 0);
        const fecha = p.fecha || new Date().toISOString().slice(0, 10);
        const robustId = `alb-${fecha.replace(/-/g, '')}-${Date.now().toString().slice(-6)}-${defaultUnitId}-${e.hash.slice(0, 6)}`;

        const newAlbaran: Albaran = {
          id: robustId,
          prov: (p.proveedor || 'DESCONOCIDO').toUpperCase(),
          date: fecha,
          num: p.num || 'S/N',
          total: String(Num.round2(total)),
          items: items as any,
          unitId: defaultUnitId,
          status: 'ok',
          invoiced: false,
          paid: false,
          reconciled: false,
          file_hash: e.hash,
          source: 'bulk-images',
        };
        newData.albaranes.unshift(newAlbaran);
      }
      await onSave(newData);
      toast.success(`✅ ${newOnes.length} albaranes guardados.`);
      reset();
      onClose();
    } catch (err: any) {
      toast.error(`❌ Error al guardar: ${err?.message || 'desconocido'}`);
      setPhase('review');
    }
  };

  if (!isOpen) return null;

  return (
    <AnimatePresence>
      <motion.div
        initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
        className="fixed inset-0 z-[600] flex justify-center items-center p-4 bg-slate-900/70 backdrop-blur-sm"
        onClick={handleClose}
      >
        <motion.div
          initial={{ scale: 0.96, y: 12 }} animate={{ scale: 1, y: 0 }}
          onClick={e => e.stopPropagation()}
          className="bg-white w-full max-w-3xl max-h-[85vh] rounded-2xl shadow-2xl border border-slate-200 flex flex-col overflow-hidden"
        >
          {/* Header */}
          <div className="flex items-center justify-between px-6 py-4 border-b border-slate-100 bg-slate-50">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 bg-indigo-100 rounded-xl flex items-center justify-center">
                <Upload className="w-5 h-5 text-indigo-600" />
              </div>
              <div>
                <h3 className="text-sm font-black text-slate-800 uppercase tracking-widest">Subida masiva de albaranes</h3>
                <p className="text-[10px] font-bold text-slate-500 mt-0.5">Sube las imágenes del mes — la app detecta repetidos</p>
              </div>
            </div>
            <button onClick={handleClose} disabled={phase === 'processing' || phase === 'saving'}
              className="p-2 rounded-lg hover:bg-slate-100 disabled:opacity-30 transition">
              <X className="w-4 h-4 text-slate-500" />
            </button>
          </div>

          {/* Body */}
          <div className="flex-1 overflow-y-auto px-6 py-5">
            {phase === 'idle' && (
              <label className="block border-2 border-dashed border-slate-300 rounded-2xl p-10 text-center cursor-pointer hover:border-indigo-400 hover:bg-indigo-50/30 transition">
                <FileImage className="w-12 h-12 text-slate-400 mx-auto mb-3" />
                <p className="text-sm font-black text-slate-700">Selecciona imágenes</p>
                <p className="text-[11px] font-bold text-slate-500 mt-1">JPG, PNG, HEIC… (puedes elegir varias a la vez)</p>
                <input
                  type="file" multiple accept="image/*" className="hidden"
                  onChange={e => e.target.files && handleFiles(e.target.files)}
                />
              </label>
            )}

            {phase === 'processing' && (
              <div className="text-center py-10">
                <Loader2 className="w-10 h-10 text-indigo-500 mx-auto mb-3 animate-spin" />
                <p className="text-sm font-black text-slate-700">Procesando {progress.done} / {progress.total}…</p>
                <p className="text-[11px] font-bold text-slate-500 mt-1">Hash + lectura con IA en paralelo</p>
                <div className="max-w-xs mx-auto mt-4 h-2 bg-slate-100 rounded-full overflow-hidden">
                  <div className="h-full bg-indigo-500 transition-all"
                    style={{ width: `${progress.total ? (progress.done / progress.total) * 100 : 0}%` }} />
                </div>
              </div>
            )}

            {(phase === 'review' || phase === 'saving') && (
              <div className="space-y-5">
                <Section
                  title={`Nuevos (${newOnes.length})`}
                  color="emerald"
                  icon={<CheckCircle2 className="w-4 h-4" />}
                  empty="No hay albaranes nuevos detectados."
                  items={newOnes.map(e => ({
                    key: e.id,
                    title: (e.status as any).parsed.proveedor || 'Sin proveedor',
                    sub: `Nº ${(e.status as any).parsed.num} · ${(e.status as any).parsed.fecha} · ${Num.fmt((e.status as any).parsed.total)}`,
                    hint: e.file.name,
                  }))}
                />
                <Section
                  title={`Repetidos por imagen idéntica (${dupHash.length})`}
                  color="slate"
                  icon={<Copy className="w-4 h-4" />}
                  empty="—"
                  items={dupHash.map(e => ({
                    key: e.id,
                    title: e.file.name,
                    sub: `Ya existe como ${(e.status as any).existing.num} · ${(e.status as any).existing.date}`,
                    hint: 'Misma imagen ya subida',
                  }))}
                />
                <Section
                  title={`Repetidos por nº+fecha+proveedor (${dupMeta.length})`}
                  color="amber"
                  icon={<AlertTriangle className="w-4 h-4" />}
                  empty="—"
                  items={dupMeta.map(e => ({
                    key: e.id,
                    title: (e.status as any).parsed.proveedor || 'Sin proveedor',
                    sub: `Nº ${(e.status as any).parsed.num} · ${(e.status as any).parsed.fecha}`,
                    hint: `Coincide con ${(e.status as any).existing.num} · ${(e.status as any).existing.date}`,
                  }))}
                />
                {failed.length > 0 && (
                  <Section
                    title={`No se pudieron leer (${failed.length})`}
                    color="rose"
                    icon={<AlertTriangle className="w-4 h-4" />}
                    empty="—"
                    items={failed.map(e => ({
                      key: e.id,
                      title: e.file.name,
                      sub: (e.status as any).reason,
                      hint: 'Sube esta imagen a mano',
                    }))}
                  />
                )}
              </div>
            )}
          </div>

          {/* Footer */}
          {(phase === 'review' || phase === 'saving') && (
            <div className="px-6 py-4 border-t border-slate-100 bg-slate-50 flex items-center justify-between">
              <button onClick={handleClose} disabled={phase === 'saving'}
                className="text-xs font-black text-slate-500 hover:text-slate-700 uppercase tracking-widest disabled:opacity-50">
                Cancelar
              </button>
              <button onClick={handleSave} disabled={phase === 'saving' || newOnes.length === 0}
                className="bg-indigo-600 hover:bg-indigo-500 text-white px-5 py-2.5 rounded-xl font-black text-[11px] uppercase tracking-widest transition shadow-lg flex items-center gap-2 disabled:opacity-50">
                {phase === 'saving' ? <Loader2 className="w-4 h-4 animate-spin" /> : <CheckCircle2 className="w-4 h-4" />}
                Guardar {newOnes.length} nuevos
              </button>
            </div>
          )}
        </motion.div>
      </motion.div>
    </AnimatePresence>
  );
};

// ── Sección de la pantalla de revisión ─────────────────────────────────────

const COLOR_MAP: Record<string, { bg: string; border: string; text: string; chip: string }> = {
  emerald: { bg: 'bg-emerald-50', border: 'border-emerald-200', text: 'text-emerald-700', chip: 'bg-emerald-100' },
  slate:   { bg: 'bg-slate-50',   border: 'border-slate-200',   text: 'text-slate-600',   chip: 'bg-slate-100'   },
  amber:   { bg: 'bg-amber-50',   border: 'border-amber-200',   text: 'text-amber-700',   chip: 'bg-amber-100'   },
  rose:    { bg: 'bg-rose-50',    border: 'border-rose-200',    text: 'text-rose-700',    chip: 'bg-rose-100'    },
};

interface SectionItem { key: string; title: string; sub: string; hint: string }

const Section: React.FC<{
  title: string;
  color: keyof typeof COLOR_MAP;
  icon: React.ReactNode;
  empty: string;
  items: SectionItem[];
}> = ({ title, color, icon, empty, items }) => {
  const c = COLOR_MAP[color];
  return (
    <div className={`rounded-2xl border ${c.border} ${c.bg} p-4`}>
      <div className={`flex items-center gap-2 mb-3 ${c.text}`}>
        {icon}
        <h4 className="text-[11px] font-black uppercase tracking-widest">{title}</h4>
      </div>
      {items.length === 0 ? (
        <p className="text-[11px] font-bold text-slate-400">{empty}</p>
      ) : (
        <ul className="space-y-2">
          {items.map(it => (
            <li key={it.key} className={`p-2.5 rounded-lg ${c.chip}`}>
              <p className="text-xs font-black text-slate-800 truncate">{it.title}</p>
              <p className="text-[10px] font-bold text-slate-600 truncate">{it.sub}</p>
              <p className="text-[10px] font-bold text-slate-400 truncate mt-0.5">{it.hint}</p>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
};
