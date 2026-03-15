import React, { useState, useEffect, useCallback } from 'react';
import { ShieldCheck, Lock, AlertCircle, Fingerprint } from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';

// 🔑 EL PIN MAESTRO DE ACCESO
const SECRET_PIN = "1414"; 

export const AuthScreen = ({ children }: { children: React.ReactNode }) => {
  const [isAuthenticated, setIsAuthenticated] = useState(false);
  const [pin, setPin] = useState('');
  const [error, setError] = useState(false);
  const [success, setSuccess] = useState(false);

  // 1. Comprueba la sesión al cargar
  useEffect(() => {
    const isLogged = localStorage.getItem('arume_secure_session');
    if (isLogged === 'active') {
      setIsAuthenticated(true);
    }
  }, []);

  // 2. Lógica del Teclado (Mejorada para no colapsar con escrituras rápidas)
  const handleKeypad = useCallback((num: string) => {
    if (error || success) return; // Bloquea si está en animación de error o éxito

    setPin((prev) => {
      if (prev.length >= 4) return prev;
      const newPin = prev + num;

      if (newPin.length === 4) {
        if (newPin === SECRET_PIN) {
          setSuccess(true);
          // Micro-pausa premium antes de entrar
          setTimeout(() => {
            localStorage.setItem('arume_secure_session', 'active');
            setIsAuthenticated(true);
          }, 400);
        } else {
          setError(true);
          // Agitación y limpieza
          setTimeout(() => {
            setPin('');
            setError(false);
          }, 800);
        }
      }
      return newPin;
    });
  }, [error, success]);

  const handleDelete = useCallback(() => {
    if (error || success) return;
    setPin((prev) => prev.slice(0, -1));
  }, [error, success]);

  // 🚀 INNOVACIÓN 1: Soporte para Teclado Físico (Súper rápido en Desktop)
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (/^[0-9]$/.test(e.key)) {
        handleKeypad(e.key);
      } else if (e.key === 'Backspace') {
        handleDelete();
      }
    };
    
    if (!isAuthenticated) {
      window.addEventListener('keydown', handleKeyDown);
    }
    
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isAuthenticated, handleKeypad, handleDelete]);


  // Si está autenticada, mostramos la App normal
  if (isAuthenticated) {
    return <>{children}</>;
  }

  // Si NO está autenticada, mostramos el Escudo Premium
  return (
    <div className="min-h-screen bg-slate-900 flex flex-col items-center justify-center p-4 relative overflow-hidden select-none">
      {/* Barra de energía superior */}
      <div className="absolute top-0 left-0 w-full h-1.5 bg-gradient-to-r from-emerald-400 via-indigo-500 to-purple-600" />
      
      {/* Fondo con brillo sutil */}
      <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
         <div className="w-[500px] h-[500px] bg-indigo-600/10 rounded-full blur-[100px]" />
      </div>

      <motion.div 
        initial={{ opacity: 0, y: 20, scale: 0.95 }}
        animate={{ opacity: 1, y: 0, scale: 1 }}
        transition={{ type: "spring", damping: 25, stiffness: 300 }}
        className="bg-slate-800/80 backdrop-blur-xl p-8 rounded-[3rem] shadow-2xl border border-slate-700 max-w-sm w-full flex flex-col items-center relative z-10"
      >
        <div className={cn(
          "w-16 h-16 rounded-full flex items-center justify-center border-2 mb-6 transition-all duration-500",
          success ? "bg-emerald-500/20 border-emerald-500 shadow-[0_0_30px_rgba(16,185,129,0.5)]" : 
          error ? "bg-rose-500/20 border-rose-500" : "bg-slate-900 border-indigo-500 shadow-[0_0_20px_rgba(99,102,241,0.3)]"
        )}>
          {success ? <ShieldCheck className="w-8 h-8 text-emerald-400" /> : <Lock className="w-8 h-8 text-indigo-400" />}
        </div>
        
        <h1 className="text-2xl font-black text-white tracking-tighter mb-1">ARUME HQ</h1>
        <p className="text-[10px] font-bold text-indigo-400 uppercase tracking-widest mb-8 flex items-center gap-1.5">
          <Fingerprint className="w-3.5 h-3.5" /> Acceso Encriptado
        </p>

        {/* Los 4 puntitos del PIN */}
        <motion.div 
          animate={error ? { x: [-10, 10, -10, 10, 0] } : {}}
          transition={{ duration: 0.4 }}
          className="flex gap-5 mb-8"
        >
          {[0, 1, 2, 3].map((i) => (
            <div 
              key={i} 
              className={cn(
                "w-4 h-4 rounded-full transition-all duration-300",
                success ? "bg-emerald-400 scale-125 shadow-[0_0_15px_rgba(16,185,129,0.8)]" :
                error ? "bg-rose-500" :
                pin.length > i ? "bg-indigo-400 scale-125 shadow-[0_0_10px_rgba(99,102,241,0.8)]" : "bg-slate-700 shadow-inner"
              )}
            />
          ))}
        </motion.div>

        {/* Teclado Numérico */}
        <div className="grid grid-cols-3 gap-3 md:gap-4 w-full">
          {[1, 2, 3, 4, 5, 6, 7, 8, 9].map((num) => (
            <button
              key={num}
              onClick={() => handleKeypad(num.toString())}
              disabled={error || success}
              className="h-16 rounded-2xl bg-slate-700/50 text-white text-2xl font-black hover:bg-indigo-600 transition-colors active:scale-95 border border-slate-600/50 disabled:opacity-50"
            >
              {num}
            </button>
          ))}
          <div className="h-16" /> {/* Espacio vacío */}
          <button
            onClick={() => handleKeypad('0')}
            disabled={error || success}
            className="h-16 rounded-2xl bg-slate-700/50 text-white text-2xl font-black hover:bg-indigo-600 transition-colors active:scale-95 border border-slate-600/50 disabled:opacity-50"
          >
            0
          </button>
          <button
            onClick={handleDelete}
            disabled={error || success || pin.length === 0}
            className="h-16 rounded-2xl bg-slate-700/50 text-slate-400 text-sm font-black hover:bg-rose-600 hover:text-white transition-colors active:scale-95 flex items-center justify-center uppercase tracking-wider border border-slate-600/50 disabled:opacity-50"
          >
            Del
          </button>
        </div>

        {/* Mensaje de Error (Con espacio reservado para no mover el teclado) */}
        <div className="h-6 mt-6 flex items-center justify-center">
          <AnimatePresence>
            {error && (
              <motion.p 
                initial={{ opacity: 0, y: -10 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }}
                className="text-rose-400 text-[10px] font-bold uppercase tracking-widest flex items-center gap-1.5 bg-rose-500/10 px-3 py-1 rounded-full border border-rose-500/20"
              >
                <AlertCircle className="w-3.5 h-3.5" /> PIN Incorrecto
              </motion.p>
            )}
            {success && (
              <motion.p 
                initial={{ opacity: 0, y: -10 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }}
                className="text-emerald-400 text-[10px] font-bold uppercase tracking-widest flex items-center gap-1.5 bg-emerald-500/10 px-3 py-1 rounded-full border border-emerald-500/20"
              >
                <ShieldCheck className="w-3.5 h-3.5" /> Acceso Concedido
              </motion.p>
            )}
          </AnimatePresence>
        </div>

      </motion.div>
    </div>
  );
};
