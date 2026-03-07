import React, { useState } from 'react';
import { 
  Upload, 
  FileSpreadsheet, 
  CheckCircle2, 
  Database, 
  AlertCircle,
  ArrowRight,
  FileText,
  Sparkles,
  Loader2,
  Send
} from 'lucide-react';
import { motion } from 'motion/react';
import * as XLSX from 'xlsx';
import { GoogleGenAI } from "@google/genai";
import { AppData } from '../types';
import { Num, DateUtil } from '../services/engine';
import { cn } from '../lib/utils';

// Conexión con tu flujo de automatización
const n8nWebhookURL = "https://n8n.permatunnelopen.org/webhook/albaranes-ai";

interface ImportViewProps {
  data: AppData;
  onSave: (newData: AppData) => Promise<void>;
  onNavigate: (tab: string) => void;
}

export const ImportView = ({ data, onSave, onNavigate }: ImportViewProps) => {
  const [importMode, setImportMode] = useState<'tpv' | 'albaranes' | 'pdf'>('tpv');
  const [isScanning, setIsScanning] = useState(false);
  const [processedData, setProcessedData] = useState<{
    cierre?: any;
    ventasMenu?: any;
    albaranes?: any[];
    facturaPdf?: any;
  } | null>(null);
  const [isDragging, setIsDragging] = useState(false);

  // Generador de Hash para evitar duplicados (Igual que en n8n)
  const generarHash = async (prov: string, num: string, date: string, total: number) => {
    const text = `${prov.toLowerCase().trim()}|${num.toLowerCase().trim()}|${date}|${total.toFixed(2)}`;
    const encoder = new TextEncoder();
    const data = encoder.encode(text);
    const hashBuffer = await crypto.subtle.digest('SHA-256', data);
    const hashArray = Array.from(new Uint8Array(hashBuffer));
    return hashArray.map(b => b.toString(16).padStart(2, '0')).join('');
  };

  const handleFileUpload = async (e: React.ChangeEvent<HTMLInputElement> | React.DragEvent) => {
    let file: File | undefined;
    
    if ('files' in e.target && e.target.files) {
      file = e.target.files[0];
    } else if ('dataTransfer' in e && e.dataTransfer.files) {
      file = e.dataTransfer.files[0];
    }

    if (!file) return;

    if (importMode === 'pdf') {
      if (file.type !== 'application/pdf') {
        alert("⚠️ Por favor, sube un archivo PDF válido.");
        return;
      }
      await escanearFacturaConIA(file);
      return;
    }

    const reader = new FileReader();
    reader.onload = (evt) => {
      try {
        const bstr = evt.target?.result;
        const wb = XLSX.read(bstr, { type: 'binary' });
        const wsname = wb.SheetNames[0];
        const ws = wb.Sheets[wsname];
        const rows = XLSX.utils.sheet_to_json(ws) as any[];

        procesarArchivo(rows);
      } catch (err) {
        console.error("Error leyendo Excel:", err);
        alert("Error al leer el archivo. Asegúrate de que es un Excel o CSV válido.");
      }
    };
    reader.readAsBinaryString(file);
  };

  const escanearFacturaConIA = async (file: File) => {
    const apiKey = localStorage.getItem('gemini_api_key');
    if (!apiKey) {
      alert("⚠️ No tienes la clave de IA conectada. Ve a la pestaña 'IA' primero para conectar tu cerebro Gemini.");
      return;
    }

    setIsScanning(true);
    setProcessedData(null);

    try {
      const buffer = await file.arrayBuffer();
      const base64String = btoa(new Uint8Array(buffer).reduce((data, byte) => data + String.fromCharCode(byte), ''));

      const ai = new GoogleGenAI({ apiKey: apiKey });
      
      const response = await ai.models.generateContent({
        model: "gemini-2.5-flash",
        contents: [
          {
            role: "user",
            parts: [
              { inlineData: { data: base64String, mimeType: "application/pdf" } },
              { text: `Extrae de esta factura los siguientes datos en formato JSON estricto: 
              "proveedor" (nombre), "fecha" (YYYY-MM-DD), "num_factura" (número identificador), "total" (número total con IVA), "iva" (número del importe del IVA), "base" (número de la base imponible). No incluyas markdown, solo el JSON puro.` }
            ]
          }
        ],
      });

      const textRes = response.text?.replace(/```json/g, '').replace(/```/g, '').trim();
      const datosIA = JSON.parse(textRes || "{}");

      if (!datosIA.proveedor) throw new Error("No se pudo leer el proveedor");

      const prov = datosIA.proveedor;
      const numFactura = datosIA.num_factura || `S/N-${Math.floor(Math.random() * 1000)}`;
      const fecha = datosIA.fecha || DateUtil.today();
      const totalPdf = Num.parse(datosIA.total || 0);
      
      const hashFactura = await generarHash(prov, numFactura, fecha, totalPdf);

      setProcessedData({
        facturaPdf: {
          id: `fac-ia-${Date.now()}`,
          hash: hashFactura,
          proveedor: prov,
          num_factura: numFactura,
          fecha: fecha,
          base: Num.parse(datosIA.base || 0),
          iva: Num.parse(datosIA.iva || 0),
          total_pdf: totalPdf,
          pagada: false, // CLAVE PARA TU ATRASO: Entra como pendiente
          cuadra: false, // CLAVE: Falso hasta que el sistema lo verifique
          status: 'pendiente',
          notas: "Escaneada manualmente con IA ✨"
        }
      });

    } catch (error) {
      console.error("Error AI PDF:", error);
      alert("Hubo un error al escanear el PDF con la IA. Revisa el documento e inténtalo de nuevo.");
    } finally {
      setIsScanning(false);
    }
  };

  const procesarArchivo = (filas: any[]) => {
    if (importMode === 'tpv') procesarDatosDelTPV(filas);
    else procesarAlbaranesExcel(filas);
  };

  const procesarAlbaranesExcel = (filas: any[]) => {
    if (filas.length === 0) return alert("El archivo está vacío");
    const agrupados: Record<string, any> = {};
    filas.forEach(fila => {
      const prov = fila['Proveedor'] || fila['PROVEEDOR'] || fila['Prov'] || 'Desconocido';
      const fecha = fila['Fecha'] || fila['FECHA'] || DateUtil.today();
      const producto = fila['Producto'] || fila['Articulo'] || 'Varios';
      const cantidad = Num.parse(fila['Cantidad'] || fila['Uds'] || 1);
      const total = Num.parse(fila['Total'] || fila['Importe'] || 0);
      const socio = fila['Socio'] || fila['SOCIO'] || 'Arume';

      const key = `${prov}-${fecha}-${socio}`;
      if (!agrupados[key]) {
        agrupados[key] = {
          id: `alb-imp-${Date.now()}-${Math.random().toString(36).substr(2, 5)}`,
          prov, date: fecha, socio, items: [], total: 0, invoiced: false, paid: false, status: 'ok'
        };
      }
      agrupados[key].items.push({ q: cantidad, n: producto, t: total, unit: cantidad > 0 ? total / cantidad : total, rate: 10 });
      agrupados[key].total += total;
    });
    setProcessedData({ albaranes: Object.values(agrupados) });
  };

  const procesarDatosDelTPV = (filas: any[]) => {
    if (filas.length === 0) return alert("El archivo está vacío");
    let totalVentaDelDia = 0;
    let desglosePlatos: any[] = [];
    filas.forEach(fila => {
      const nombreProducto = fila['Producto'] || fila['Articulo'] || fila['PRODUCTO'] || fila['ARTICULO'];
      const cantidadVendida = Num.parse(fila['Cantidad'] || fila['Uds'] || fila['CANTIDAD'] || fila['UDS']);
      const totalLinea = Num.parse(fila['Total'] || fila['Importe'] || fila['TOTAL'] || fila['IMPORTE']);
      if (nombreProducto && cantidadVendida > 0) {
        totalVentaDelDia += totalLinea;
        desglosePlatos.push({ nombre: nombreProducto, cantidad: cantidadVendida, total: totalLinea });
      }
    });
    const fechaHoy = DateUtil.today();
    setProcessedData({
      cierre: { id: `cierre-imp-${Date.now()}`, date: fechaHoy, totalVenta: totalVentaDelDia, origen: 'Importación TPV', efectivo: 0, tarjeta: 0, apps: 0, notas: "Importado desde TPV", descuadre: 0 },
      ventasMenu: { fecha: fechaHoy, platos: desglosePlatos }
    });
  };

  // Función opcional para mandar al webhook de automatización
  const enviarAN8n = async (datosFactura: any) => {
    try {
      await fetch(n8nWebhookURL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(datosFactura)
      });
    } catch (e) {
      console.warn("No se pudo conectar con el webhook de n8n", e);
    }
  };

  const handleConfirm = async () => {
    if (!processedData) return;

    const newData = { ...data };
    
    if (importMode === 'tpv') {
      if (!newData.cierres) newData.cierres = [];
      newData.cierres.push(processedData.cierre);
      if (!newData.ventas_menu) newData.ventas_menu = [];
      newData.ventas_menu.push(processedData.ventasMenu);
      await onSave(newData);
      onNavigate('dashboard');
    } else if (importMode === 'albaranes' && processedData.albaranes) {
      if (!newData.albaranes) newData.albaranes = [];
      newData.albaranes = [...newData.albaranes, ...processedData.albaranes];
      await onSave(newData);
      onNavigate('albaranes');
    } else if (importMode === 'pdf' && processedData.facturaPdf) {
      if (!newData.facturas) newData.facturas = [];
      newData.facturas.push(processedData.facturaPdf);
      
      // Enviamos copia a tu sistema n8n para que verifique si cuadra
      await enviarAN8n(processedData.facturaPdf);
      
      await onSave(newData);
      onNavigate('facturas'); // Aquí es donde verás la lista ordenada
    }
    alert("¡Datos integrados en el ERP con éxito!");
  };

  return (
    <div className="max-w-2xl mx-auto space-y-6 animate-fade-in pb-24">
      <div className="bg-white p-8 rounded-[2.5rem] shadow-xl border border-slate-100">
        <header className="text-center mb-8">
          <div className="w-16 h-16 bg-indigo-50 text-indigo-600 rounded-full flex items-center justify-center text-3xl mx-auto mb-4">
            <Upload className="w-8 h-8" />
          </div>
          <h2 className="text-2xl font-black text-slate-800 tracking-tighter">Importador Inteligente</h2>
          <p className="text-[10px] font-bold text-slate-400 uppercase tracking-widest mt-1">Sube tus archivos de ventas o gastos</p>
        </header>

        <div className="flex items-center gap-2 p-1 bg-slate-100 rounded-2xl mb-6">
          <button onClick={() => { setImportMode('tpv'); setProcessedData(null); }} className={cn("flex-1 py-3 rounded-xl font-black text-xs transition", importMode === 'tpv' ? "bg-white shadow text-indigo-600" : "text-slate-400 hover:bg-slate-200")}>
            VENTAS TPV
          </button>
          <button onClick={() => { setImportMode('albaranes'); setProcessedData(null); }} className={cn("flex-1 py-3 rounded-xl font-black text-xs transition", importMode === 'albaranes' ? "bg-white shadow text-indigo-600" : "text-slate-400 hover:bg-slate-200")}>
            ALBARANES
          </button>
          <button onClick={() => { setImportMode('pdf'); setProcessedData(null); }} className={cn("flex-1 py-3 rounded-xl font-black text-xs transition flex items-center justify-center gap-1", importMode === 'pdf' ? "bg-indigo-600 shadow text-white" : "text-slate-400 hover:bg-slate-200")}>
            <Sparkles className="w-3.5 h-3.5" /> IA PDF
          </button>
        </div>

        <div 
          onDragOver={(e) => { e.preventDefault(); setIsDragging(true); }}
          onDragLeave={() => setIsDragging(false)}
          onDrop={(e) => { e.preventDefault(); setIsDragging(false); handleFileUpload(e); }}
          className={cn(
            "border-2 border-dashed rounded-[2rem] p-12 text-center transition-all cursor-pointer relative group",
            isDragging ? "border-indigo-500 bg-indigo-50" : "border-slate-200 hover:border-indigo-300 hover:bg-slate-50",
            isScanning && "opacity-50 pointer-events-none"
          )}
        >
          <input 
            type="file" 
            onChange={handleFileUpload}
            accept={importMode === 'pdf' ? ".pdf" : ".xlsx, .xls, .csv"} 
            className="absolute inset-0 w-full h-full opacity-0 cursor-pointer" 
          />
          <div className="space-y-4">
            <div className="w-16 h-16 bg-white rounded-2xl shadow-sm border border-slate-100 flex items-center justify-center mx-auto group-hover:scale-110 transition-transform">
              {isScanning ? <Loader2 className="w-8 h-8 text-indigo-500 animate-spin" /> : 
               importMode === 'pdf' ? <FileText className="w-8 h-8 text-indigo-500" /> : <FileSpreadsheet className="w-8 h-8 text-indigo-500" />}
            </div>
            <div>
              <p className="text-sm font-black text-slate-600">
                {isScanning ? "El Cerebro IA está leyendo el documento..." : "Pulsa aquí o arrastra tu archivo"}
              </p>
              <p className="text-[10px] text-slate-400 mt-1 font-bold uppercase tracking-widest">
                {importMode === 'pdf' ? "Formatos: .pdf" : "Formatos: .xlsx, .csv"}
              </p>
            </div>
          </div>
        </div>

        {processedData && (
          <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} className="mt-8 bg-emerald-50 p-6 rounded-[2rem] border border-emerald-100 space-y-4">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 bg-emerald-500 text-white rounded-full flex items-center justify-center">
                <CheckCircle2 className="w-6 h-6" />
              </div>
              <div>
                <h3 className="font-black text-emerald-900 text-sm uppercase tracking-tight">Lectura Exitosa</h3>
                <p className="text-[10px] text-emerald-600 font-bold uppercase">Datos listos para procesar</p>
              </div>
            </div>

            <div className="bg-white/50 rounded-2xl p-4 space-y-2">
              {importMode === 'pdf' && processedData.facturaPdf && (
                <>
                  <div className="flex justify-between items-center">
                    <span className="text-[10px] font-black text-emerald-800 uppercase">Proveedor</span>
                    <span className="text-xs font-bold text-emerald-700">{processedData.facturaPdf.proveedor}</span>
                  </div>
                  <div className="flex justify-between items-center">
                    <span className="text-[10px] font-black text-emerald-800 uppercase">Nº Factura</span>
                    <span className="text-xs font-bold text-emerald-700">{processedData.facturaPdf.num_factura}</span>
                  </div>
                  <div className="flex justify-between items-center">
                    <span className="text-[10px] font-black text-emerald-800 uppercase">Total Factura</span>
                    <span className="text-xs font-bold text-emerald-700">{Num.fmt(processedData.facturaPdf.total_pdf)}</span>
                  </div>
                </>
              )}
              {importMode === 'tpv' && (
                <div className="flex justify-between items-center">
                    <span className="text-[10px] font-black text-emerald-800 uppercase">Total Venta</span>
                    <span className="text-xs font-bold text-emerald-700">{Num.fmt(processedData.cierre?.totalVenta)}</span>
                </div>
              )}
            </div>

            <button onClick={handleConfirm} className="w-full bg-emerald-600 hover:bg-emerald-700 text-white font-black py-4 rounded-2xl transition shadow-lg flex items-center justify-center gap-2 group">
              <Database className="w-4 h-4" />
              <span>GUARDAR EN PENDIENTES</span>
              <ArrowRight className="w-4 h-4 group-hover:translate-x-1 transition-transform" />
            </button>
          </motion.div>
        )}
      </div>
    </div>
  );
};
