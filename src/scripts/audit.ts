import { createClient } from '@supabase/supabase-js';
import fs from 'fs';
import path from 'path';

// --- Configuración Inicial ---
const now = new Date();
const month = now.getMonth() + 1; // 1-12
const year = now.getFullYear();

function ensureDir(p: string){ if(!fs.existsSync(p)) fs.mkdirSync(p,{recursive:true}); }
ensureDir('out');

function normalizeDesc(s=''){
  return s.toUpperCase().normalize('NFD').replace(/[\u0300-\u036f]/g,'').replace(/[\u00A0\u202F\s]+/g,' ').trim();
}

function nearDate(d1: string, d2: string, days=2){
  const A = new Date(d1).getTime(), B = new Date(d2).getTime();
  return Math.abs(A-B) <= days*86400000;
}

async function main(){
  const url = process.env.SUPABASE_URL!;
  const key = process.env.SUPABASE_SERVICE_ROLE!; 
  if(!url || !key) throw new Error('Faltan claves de seguridad (SUPABASE_URL o SERVICE_ROLE)');

  console.log("🕵️‍♂️ CFO Virtual: Conectando a la base de datos de Arume...");
  const sb = createClient(url, key, { auth: { persistSession:false }});
  
  // Multi-empresa: una fila por empresa (empresa_id 'arume' | 'raco')
  const { data: rows, error } = await sb.from('arume_data').select('empresa_id,data,updated_at,version').limit(100);
  if(error) throw error;
  if(!rows || rows.length === 0) throw new Error('No hay filas en arume_data');

  // --- Snapshot (Copia de Seguridad de Emergencia) de TODAS las empresas ---
  let root:any = {};
  for (const row of rows) {
    const d:any = row?.data || {};
    const eid = (row as any).empresa_id || 'desconocida';
    fs.writeFileSync(`out/${eid}_data_snapshot.json`, JSON.stringify(d,null,2), 'utf8');
    console.log(`✅ Copia de seguridad guardada: ${eid} (version ${(row as any).version ?? '?'})`);
    if (eid === 'arume') root = d;
  }
  if (!root || typeof root !== 'object') throw new Error('JSON maestro de arume inválido o vacío');
  // Compatibilidad con el nombre antiguo del snapshot
  fs.writeFileSync('out/arume_data_snapshot.json', JSON.stringify(root,null,2), 'utf8');

  const albaranes = Array.isArray(root.albaranes) ? root.albaranes : [];
  const facturas  = Array.isArray(root.facturas)  ? root.facturas  : [];
  const banco     = Array.isArray(root.banco)     ? root.banco     : [];

  console.log("🕵️‍♂️ Analizando Duplicados...");
  function dedupeKey(x:any){
    const prov = (x.prov || x.cliente || '').toString().toUpperCase().trim();
    const num  = (x.num || '').toString().toUpperCase().trim();
    const tot  = Number(x.total || 0).toFixed(2);
    return `${prov}|${num}|${tot}`;
  }

  const dupAlbs: any[] = [];
  const seenAlb = new Map<string, any>();
  for(const a of albaranes){
    const k = dedupeKey(a);
    if(seenAlb.has(k)) dupAlbs.push({ a, dupOf: seenAlb.get(k) });
    else seenAlb.set(k, a);
  }

  const dupFacs: any[] = [];
  const seenFac = new Map<string, any>();
  for(const f of facturas){
    const k = dedupeKey(f);
    if(seenFac.has(k)) dupFacs.push({ f, dupOf: seenFac.get(k) });
    else seenFac.set(k, f);
  }

  // --- IVA Sospechoso ---
  const ivaSuspect: any[] = [];
  for(const f of facturas){
    const hasTaxes = ('iva' in f) || ('taxes' in f) || ('lines' in f);
    const t = Number(f.total || 0);
    if(!hasTaxes && Math.abs(t) > 0.01) ivaSuspect.push({ f, reason:'sin_desglose' });
  }

  const alerts: string[] = [];
  let status: 'ok'|'warn'|'fail' = 'ok';

  if (dupAlbs.length || dupFacs.length) {
    alerts.push(`⚠️ Se encontraron DUPLICADOS: Albaranes (${dupAlbs.length}), Facturas (${dupFacs.length})`);
    status = 'fail';
  }
  if (ivaSuspect.length) {
    alerts.push(`⚠️ Hay ${ivaSuspect.length} facturas sin el IVA desglosado.`);
    status = status === 'ok' ? 'warn' : status;
  }

  // Generar reporte
  const summary = [
    `# 🛡️ Reporte del CFO Virtual · ${year}-${String(month).padStart(2,'0')}`,
    `**ESTADO GENERAL:** ${status.toUpperCase()}`,
    `- 🚚 Albaranes revisados: ${albaranes.length}`,
    `- 🧾 Facturas revisadas: ${facturas.length}`,
    `- 🏦 Movimientos de banco: ${banco.length}`,
    alerts.length ? `\n## 🚨 Alertas Detectadas\n- ${alerts.join('\n- ')}` : '\n## ✅ Todo en orden. La contabilidad cuadra perfecta.'
  ].join('\n');
  
  fs.writeFileSync('out/audit-summary.md', summary, 'utf8');
  console.log("📄 Reporte finalizado. Estado:", status.toUpperCase());

  // Señal de fallo para que GitHub te avise
  if (status === 'fail') process.exit(1);
}

main().catch(err => {
      console.error('❌ Error crítico en Auditoría:', err?.message || err);
    // Generar summary de error para que los pasos posteriores no fallen
               try {
                     ensureDir('out');
                     const errorSummary = [
                             `# 🛡️ Reporte del CFO Virtual · ${year}-${String(month).padStart(2,'0')}`,
                             `**ESTADO GENERAL:** ERROR`,
                             ``,
                             `## 🚨 Error Crítico`,
                             `El script de auditoría falló antes de poder conectar o procesar datos.`,
                             ``,
                             `**Detalle del error:** ${err?.message || String(err)}`,
                             ``,
                             `> Verifica que los secrets SUPABASE_URL y SUPABASE_SERVICE_ROLE sean correctos y que la base de datos esté accesible.`
                           ].join('\n');
                     fs.writeFileSync('out/audit-summary.md', errorSummary, 'utf8');
                     console.log('📄 Summary de error guardado en out/audit-summary.md');
               } catch (writeErr) {
                     console.error('⚠️ No se pudo guardar el summary de error:', writeErr);
               }
    process.exit(1);
});
