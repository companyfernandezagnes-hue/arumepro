import React, { useState } from 'react';
import { 
  FileSpreadsheet, 
  FileText, 
  Download, 
  Upload, 
  ShieldCheck, 
  AlertTriangle,
  FileArchive,
  Loader2
} from 'lucide-react';
import { motion } from 'framer-motion';
import * as XLSX from 'xlsx';
import { jsPDF } from 'jspdf';
import 'jspdf-autotable';
import { AppData, FacturaExtended, Albaran } from '../types';
import { Num } from '../services/engine';
import { cn } from '../lib/utils';

interface ExportToolsProps {
  db: AppData | null;
  onSave: (newData: AppData) => void;
}

export const ExportTools: React.FC<ExportToolsProps> = ({ db, onSave }) => {
  const [isExporting, setIsExporting] = useState(false);

  if (!db) return null;

  // --- EXCEL EXPORT (AHORA CON FACTURAS Y ALBARANES) ---
  const exportToExcel = () => {
    setIsExporting(true);
    try {
      const wb = XLSX.utils.book_new();
      const timestamp = new Date().toISOString().split('T')[0];

      // 1. HOJA DE FACTURAS (Lo más importante para la gestoría)
      if (db.facturas && db.facturas.length > 0) {
        const facturasData = db.facturas.map((f: FacturaExtended) => {
          const total = Math.abs(Num.parse(f.total) || 0);
          const base = Num.parse(f.base) || Num.round2(total / 1.10); // Asume 10% si no hay base
          const tax = Num.parse(f.tax) || Num.round2(total - base);
          
          return {
            'Nº FACTURA': f.num || 'S/N',
            'FECHA': f.date,
            'TIPO': f.tipo.toUpperCase(),
            'PROVEEDOR/CLIENTE': f.prov || f.cliente || 'DESCONOCIDO',
            'UNIDAD NEGOCIO': f.unidad_negocio || 'REST',
            'BASE IMPONIBLE': Num.fmt(base),
            'IVA': Num.fmt(tax),
            'TOTAL': Num.fmt(total),
            'PAGADA': f.paid ? 'SÍ' : 'NO',
            'CONCILIADA BCO': f.reconciled ? 'SÍ' : 'NO',
            'ORIGEN': f.source || 'MANUAL'
          };
        });
        
        const wsFacturas = XLSX.utils.json_to_sheet(facturasData);
        // Ajustamos anchos de columna para que el contable no tenga que estirarlas a mano
        wsFacturas['!cols'] = [{wch: 15}, {wch: 12}, {wch: 10}, {wch: 35}, {wch: 15}, {wch: 15}, {wch: 12}, {wch: 12}, {wch: 10}, {wch: 15}, {wch: 15}];
        XLSX.utils.book_append_sheet(wb, wsFacturas, "Facturas");
      }

      // 2. HOJA DE ALBARANES
      if (db.albaranes && db.albaranes.length > 0) {
        const albaranesData = db.albaranes.map((alb: Albaran) => {
          const total = Math.abs(Num.parse(alb.total) || 0);
          return {
            'Nº ALBARÁN': alb.num || 'S/N',
            'FECHA': alb.date,
            'PROVEEDOR': alb.prov || 'Varios',
            'SOCIO': alb.socio || 'Arume',
            'TOTAL': Num.fmt(total),
            'FACTURADO': alb.invoiced ? 'SÍ' : 'NO',
            'PAGADO': alb.paid ? 'SÍ' : 'NO'
          };
        });

        const wsAlbaranes = XLSX.utils.json_to_sheet(albaranesData);
        wsAlbaranes['!cols'] = [{wch: 15}, {wch: 12}, {wch: 30}, {wch: 15}, {wch: 12}, {wch: 12}, {wch: 12}];
        XLSX.utils.book_append_sheet(wb, wsAlbaranes, "Albaranes");
      }

      if (wb.SheetNames.length === 0) {
        alert("No hay datos contables para exportar.");
        setIsExporting(false);
        return;
      }

      XLSX.writeFile(wb, `Contabilidad_Arume_${timestamp}.xlsx`);
    } catch (e) {
      alert("Error al generar el Excel.");
    } finally {
      setIsExporting(false);
    }
  };

  // --- PDF EXPORT (Resumen Ejecutivo) ---
  const exportToPDF = () => {
    setIsExporting(true);
    try {
      if (!db.facturas || db.facturas.length === 0) {
        alert("No hay facturas para generar el reporte.");
        setIsExporting(false);
        return;
      }

      const doc = new jsPDF() as any;
      const timestamp = new Date().toLocaleString();
      
      // Cabecera
      doc.setFontSize(22);
      doc.setTextColor(30, 41, 59); // slate-800
      doc.text("Resumen Contable - Arume ERP", 14, 20);
      
      doc.setFontSize(10);
      doc.setTextColor(100, 116, 139); // slate-500
      doc.text(`Generado el: ${timestamp}`, 14, 28);

      // Tabla de Facturas Recientes (últimas 50 para no hacer un PDF eterno)
      const facturasRecientes = [...db.facturas].sort((a,b) => (b.date || '').localeCompare(a.date || '')).slice(0, 50);
      
      const tableData = facturasRecientes.map((f: FacturaExtended) => [
        f.date,
        f.num || 'S/N',
        (f.prov || f.cliente || '').substring(0, 25), // Truncamos nombres largos
        Num.fmt(Math.abs(Num.parse(f.total))),
        f.reconciled ? 'CONCILIADA' : f.paid ? 'PAGADA' : 'PDTE'
      ]);

      doc.autoTable({
        startY: 35,
        head: [['Fecha', 'Factura', 'Titular', 'Total', 'Estado']],
        body: tableData,
        theme: 'grid',
        headStyles: { fillColor: [99, 102, 241], textColor: 255, fontStyle: 'bold' }, // Indigo-500
        styles: { fontSize: 8, cellPadding: 3 },
        alternateRowStyles: { fillColor: [248, 250, 252] }, // slate-50
      });

      doc.save(`Resumen_Ejecutivo_Arume_${new Date().toISOString().split('T')[0]}.pdf`);
    } catch (e) {
      alert("Error al generar el PDF.");
    } finally {
      setIsExporting(false);
    }
  };

  // --- BACKUP SEGURO (JSON) ---
  const downloadBackup = () => {
    // Añadimos metadata al backup por seguridad
    const backupData = {
      version: "2.0",
      timestamp: new Date().toISOString(),
      data: db
    };
    
    const dataStr = "data:text/json;charset=utf-8," + encodeURIComponent(JSON.stringify(backupData, null, 2));
    const downloadAnchorNode = document.createElement('a');
    downloadAnchorNode.setAttribute("href", dataStr);
    downloadAnchorNode.setAttribute("download", `Arume_Backup_Total_${new Date().toISOString().split('T')[0]}.json`);
    document.body.appendChild(downloadAnchorNode);
    downloadAnchorNode.click();
    downloadAnchorNode.remove();
  };

  // --- RESTORE SEGURO (JSON) ---
  const handleRestore = (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = (e) => {
      try {
        const json = JSON.parse(e.target?.result as string);
        
        // Comprobamos si es nuestro nuevo formato envuelto en 'data' o el formato antiguo
        const dbDataToRestore = json.version && json.data ? json.data : json;
        
        if (!dbDataToRestore.albaranes && !dbDataToRestore.facturas) {
          throw new Error("El archivo no tiene la estructura de Arume.");
        }

        if (confirm("⚠️ PELIGRO: Vas a sobrescribir toda la base de datos en la nube con este archivo local. ¿Estás absolutamente seguro?")) {
          onSave(dbDataToRestore);
          alert("✅ Datos restaurados con éxito. Por favor, recarga la aplicación.");
        }
      } catch (err) {
        alert("❌ Error: El archivo no es un backup válido de Arume o está corrupto.");
      }
      
      // Limpiamos el input por si quiere volver a subir el mismo
      event.target.value = '';
    };
    reader.readAsText(file);
  };

  return (
    <div className="space-y-6 max-w-4xl mx-auto pb-24">
      
      {/* SECCIÓN 1: HERRAMIENTAS GESTORÍA */}
      <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} className="bg-white p-6 md:p-8 rounded-[2rem] border border-slate-200 shadow-sm relative overflow-hidden">
        {/* Fondo decorativo */}
        <div className="absolute top-0 right-0 w-64 h-64 bg-indigo-50 rounded-full blur-3xl opacity-50 -translate-y-1/2 translate-x-1/4 pointer-events-none"></div>

        <div className="flex items-center gap-4 mb-8 relative z-10">
          <div className="w-14 h-14 bg-indigo-600 rounded-2xl flex items-center justify-center shadow-[0_0_20px_rgba(79,70,229,0.3)]">
            <FileArchive className="w-7 h-7 text-white" />
          </div>
          <div>
            <h2 className="text-2xl font-black text-slate-800 tracking-tight">Cierre Contable</h2>
            <p className="text-slate-500 font-bold text-xs uppercase tracking-widest mt-1">Exportación para Gestoría</p>
          </div>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-4 relative z-10">
          <button 
            onClick={exportToExcel}
            disabled={isExporting}
            className="flex flex-col items-start text-left p-6 bg-emerald-50 hover:bg-emerald-100 text-emerald-800 rounded-2xl border border-emerald-200 transition-all group cursor-pointer disabled:opacity-50"
          >
            <div className="flex items-center justify-between w-full mb-4">
              <div className="p-3 bg-white rounded-xl shadow-sm"><FileSpreadsheet className="w-6 h-6 text-emerald-600" /></div>
              {isExporting ? <Loader2 className="w-5 h-5 animate-spin" /> : <ArrowRightIcon color="text-emerald-500" />}
            </div>
            <span className="text-lg font-black tracking-tight mb-1">Generar Excel (.xlsx)</span>
            <p className="text-xs font-semibold text-emerald-600/80 leading-relaxed">
              Exporta todas las Facturas y Albaranes en pestañas separadas. Perfecto para importar en A3, Holded o para tu contable.
            </p>
          </button>

          <button 
            onClick={exportToPDF}
            disabled={isExporting}
            className="flex flex-col items-start text-left p-6 bg-rose-50 hover:bg-rose-100 text-rose-800 rounded-2xl border border-rose-200 transition-all group cursor-pointer disabled:opacity-50"
          >
            <div className="flex items-center justify-between w-full mb-4">
              <div className="p-3 bg-white rounded-xl shadow-sm"><FileText className="w-6 h-6 text-rose-600" /></div>
              {isExporting ? <Loader2 className="w-5 h-5 animate-spin" /> : <ArrowRightIcon color="text-rose-500" />}
            </div>
            <span className="text-lg font-black tracking-tight mb-1">Resumen Ejecutivo (.pdf)</span>
            <p className="text-xs font-semibold text-rose-600/80 leading-relaxed">
              Genera un documento en PDF listo para imprimir con las últimas 50 facturas y su estado de pago. Ideal para reuniones.
            </p>
          </button>
        </div>
      </motion.div>

      {/* SECCIÓN 2: ZONA DE PELIGRO (Seguridad) */}
      <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.1 }} className="bg-slate-900 p-6 md:p-8 rounded-[2rem] shadow-xl relative overflow-hidden">
        <div className="flex items-center gap-4 mb-8">
          <div className="w-14 h-14 bg-slate-800 rounded-2xl flex items-center justify-center border border-slate-700">
            <ShieldCheck className="w-7 h-7 text-emerald-400" />
          </div>
          <div>
            <h2 className="text-2xl font-black text-white tracking-tight">Caja Fuerte de Datos</h2>
            <p className="text-slate-400 font-bold text-xs uppercase tracking-widest mt-1">Backups y Restauración local</p>
          </div>
        </div>

        <div className="space-y-4">
          <button 
            onClick={downloadBackup}
            className="w-full flex items-center justify-between p-5 bg-slate-800 hover:bg-slate-700 border border-slate-700 hover:border-emerald-500/50 text-white rounded-2xl transition-all group cursor-pointer"
          >
            <div className="flex items-center gap-4">
              <div className="p-2 bg-emerald-500/20 rounded-lg"><Download className="w-5 h-5 text-emerald-400" /></div>
              <div className="text-left">
                <span className="block text-sm font-black uppercase tracking-widest text-emerald-50">Descargar Copia de Seguridad</span>
                <span className="text-[10px] text-slate-400 font-medium">Guarda todo Arume en tu ordenador (JSON)</span>
              </div>
            </div>
            <ArrowRightIcon color="text-emerald-500" />
          </button>

          <label className="w-full flex items-center justify-between p-5 bg-slate-800/50 hover:bg-slate-800 border-2 border-dashed border-slate-700 hover:border-amber-500/50 text-slate-300 rounded-2xl cursor-pointer transition-all group">
            <div className="flex items-center gap-4">
              <div className="p-2 bg-amber-500/10 rounded-lg"><Upload className="w-5 h-5 text-amber-400" /></div>
              <div className="text-left">
                <span className="block text-sm font-black uppercase tracking-widest text-amber-100">Restaurar desde Archivo</span>
                <span className="text-[10px] text-slate-400 font-medium">Sube un JSON para reemplazar la base de datos actual</span>
              </div>
            </div>
            <input type="file" accept=".json" onChange={handleRestore} className="hidden" />
          </label>
        </div>

        <div className="mt-6 p-4 bg-amber-500/10 border border-amber-500/20 rounded-xl flex items-start gap-3">
          <AlertTriangle className="w-5 h-5 text-amber-500 shrink-0 mt-0.5" />
          <p className="text-[10px] md:text-xs text-amber-200/80 font-bold uppercase tracking-wide leading-relaxed">
            Peligro: La función de restaurar sobreescribirá la base de datos en la nube de Supabase para todos los usuarios. Úsalo únicamente en caso de catástrofe.
          </p>
        </div>
      </motion.div>
    </div>
  );
};

const ArrowRightIcon = ({ color = "text-slate-500" }: { color?: string }) => (
  <svg className={cn("w-5 h-5 transition-transform group-hover:translate-x-1", color)} fill="none" viewBox="0 0 24 24" stroke="currentColor">
    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M9 5l7 7-7 7" />
  </svg>
);
