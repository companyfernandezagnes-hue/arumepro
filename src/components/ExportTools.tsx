import React from 'react';
import { 
  FileSpreadsheet, 
  FileText, 
  Download, 
  Upload, 
  ShieldCheck, 
  AlertTriangle 
} from 'lucide-react';
import * as XLSX from 'xlsx';
import { jsPDF } from 'jspdf';
import 'jspdf-autotable';
import { AppData } from '../types';
import { Num } from '../services/engine';

interface ExportToolsProps {
  db: AppData | null;
  onSave: (newData: AppData) => void;
}

export const ExportTools: React.FC<ExportToolsProps> = ({ db, onSave }) => {
  if (!db) return null;

  // --- EXCEL EXPORT ---
  const exportToExcel = () => {
    if (!db.albaranes || db.albaranes.length === 0) {
      alert("No hay albaranes para exportar.");
      return;
    }

    // 🚀 FIX: Variables corregidas (prov, socio, num) para que coincidan con tu motor real
    const data = db.albaranes.map((alb: any) => ({
      Fecha: alb.date,
      Proveedor: alb.prov,
      Total: Num.fmt(alb.total),
      Estado: alb.paid ? 'Pagado' : 'Pendiente',
      Socio: alb.socio || 'Arume',
      Referencia: alb.num || 'S/N'
    }));

    const ws = XLSX.utils.json_to_sheet(data);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "Albaranes");
    
    // Descargar archivo
    XLSX.writeFile(wb, `Arume_Albaranes_${new Date().toISOString().split('T')[0]}.xlsx`);
  };

  // --- PDF EXPORT ---
  const exportToPDF = () => {
    if (!db.albaranes || db.albaranes.length === 0) {
      alert("No hay albaranes para exportar.");
      return;
    }

    const doc = new jsPDF() as any;
    
    // Título
    doc.setFontSize(18);
    doc.text("Listado de Albaranes - Arume ERP", 14, 22);
    doc.setFontSize(11);
    doc.setTextColor(100);
    doc.text(`Generado el: ${new Date().toLocaleString()}`, 14, 30);

    // 🚀 FIX: Variables corregidas (prov)
    const tableData = db.albaranes.map((alb: any) => [
      alb.date,
      alb.prov,
      Num.fmt(alb.total),
      alb.paid ? 'PAGADO' : 'PENDIENTE'
    ]);

    doc.autoTable({
      startY: 40,
      head: [['Fecha', 'Proveedor', 'Total', 'Estado']],
      body: tableData,
      theme: 'grid',
      headStyles: { fillColor: [79, 70, 229] }, // Indigo-600 de Tailwind
    });

    doc.save(`Arume_Albaranes_${new Date().toISOString().split('T')[0]}.pdf`);
  };

  // --- BACKUP (JSON) ---
  const downloadBackup = () => {
    const dataStr = "data:text/json;charset=utf-8," + encodeURIComponent(JSON.stringify(db, null, 2));
    const downloadAnchorNode = document.createElement('a');
    downloadAnchorNode.setAttribute("href", dataStr);
    downloadAnchorNode.setAttribute("download", `Arume_Backup_Full_${new Date().toISOString().split('T')[0]}.json`);
    document.body.appendChild(downloadAnchorNode);
    downloadAnchorNode.click();
    downloadAnchorNode.remove();
  };

  // --- RESTORE (JSON) ---
  const handleRestore = (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = (e) => {
      try {
        const json = JSON.parse(e.target?.result as string);
        if (confirm("⚠️ ¿Estás seguro? Esto reemplazará TODOS los datos actuales con los de la copia de seguridad.")) {
          onSave(json);
          alert("✅ Datos restaurados con éxito.");
        }
      } catch (err) {
        alert("❌ Error: El archivo no es un backup válido de Arume.");
      }
    };
    reader.readAsText(file);
  };

  return (
    <div className="space-y-6">
      {/* Sección de Exportación */}
      <div className="bg-white p-6 rounded-2xl border border-slate-100 shadow-sm">
        <div className="flex items-center gap-3 mb-4">
          <div className="w-10 h-10 bg-indigo-50 rounded-xl flex items-center justify-center">
            <FileSpreadsheet className="w-5 h-5 text-indigo-600" />
          </div>
          <div>
            <h3 className="text-sm font-black text-slate-800 uppercase tracking-tight">Exportar Datos</h3>
            <p className="text-[10px] text-slate-400 font-bold uppercase">Genera archivos para contabilidad</p>
          </div>
        </div>

        <div className="grid grid-cols-2 gap-3">
          <button 
            onClick={exportToExcel}
            className="flex items-center justify-center gap-2 p-4 bg-emerald-50 hover:bg-emerald-100 text-emerald-700 rounded-xl border border-emerald-100 transition-colors group cursor-pointer"
          >
            <FileSpreadsheet className="w-4 h-4 group-hover:scale-110 transition-transform" />
            <span className="text-xs font-black uppercase">Excel</span>
          </button>
          <button 
            onClick={exportToPDF}
            className="flex items-center justify-center gap-2 p-4 bg-rose-50 hover:bg-rose-100 text-rose-700 rounded-xl border border-rose-100 transition-colors group cursor-pointer"
          >
            <FileText className="w-4 h-4 group-hover:scale-110 transition-transform" />
            <span className="text-xs font-black uppercase">PDF</span>
          </button>
        </div>
      </div>

      {/* Sección de Seguridad / Backup */}
      <div className="bg-slate-900 p-6 rounded-2xl shadow-xl">
        <div className="flex items-center gap-3 mb-4">
          <div className="w-10 h-10 bg-slate-800 rounded-xl flex items-center justify-center">
            <ShieldCheck className="w-5 h-5 text-emerald-400" />
          </div>
          <div>
            <h3 className="text-sm font-black text-white uppercase tracking-tight">Copia de Seguridad</h3>
            <p className="text-[10px] text-slate-400 font-bold uppercase">Descarga toda tu app en un archivo</p>
          </div>
        </div>

        <div className="space-y-3">
          <button 
            onClick={downloadBackup}
            className="w-full flex items-center justify-between p-4 bg-slate-800 hover:bg-slate-700 text-white rounded-xl transition-colors group cursor-pointer"
          >
            <div className="flex items-center gap-3">
              <Download className="w-4 h-4 text-emerald-400" />
              <span className="text-xs font-black uppercase">Descargar Backup Total</span>
            </div>
            <ArrowRightIcon />
          </button>

          <label className="w-full flex items-center justify-between p-4 bg-slate-800/50 hover:bg-slate-800 border border-dashed border-slate-700 text-slate-300 rounded-xl cursor-pointer transition-colors group">
            <div className="flex items-center gap-3">
              <Upload className="w-4 h-4 text-amber-400" />
              <span className="text-xs font-black uppercase">Restaurar desde archivo</span>
            </div>
            <input type="file" accept=".json" onChange={handleRestore} className="hidden" />
          </label>
        </div>

        <div className="mt-4 p-3 bg-amber-500/10 border border-amber-500/20 rounded-lg flex gap-3">
          <AlertTriangle className="w-4 h-4 text-amber-500 shrink-0" />
          <p className="text-[9px] text-amber-200/80 font-bold uppercase leading-relaxed">
            Usa la restauración solo si quieres cambiar de dispositivo o recuperar datos perdidos. Esto borrará lo que tengas ahora.
          </p>
        </div>
      </div>
    </div>
  );
};

const ArrowRightIcon = () => (
  <svg className="w-4 h-4 text-slate-500 group-hover:translate-x-1 transition-transform" fill="none" viewBox="0 0 24 24" stroke="currentColor">
    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
  </svg>
);
