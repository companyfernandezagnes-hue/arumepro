import React, { useState, useEffect } from 'react';
import { ShieldCheck, Lock, AlertCircle } from 'lucide-react';
import { motion } from 'framer-motion';

// 🔑 CAMBIA ESTE NÚMERO POR EL PIN QUE TÚ QUIERAS
const SECRET_PIN = "1414"; 

export const AuthScreen = ({ children }: { children: React.ReactNode }) => {
  const [isAuthenticated, setIsAuthenticated] = useState(false);
  const [pin, setPin] = useState('');
  const [error, setError] = useState(false);

  // Comprueba si ya habías puesto el PIN antes para no pedírtelo cada vez que recargas
  useEffect(() => {
    const isLogged = localStorage.getItem('arume_secure_session');
    if (isLogged === 'active') {
      setIsAuthenticated(true);
    }
  }, []);

  const handleKeypad = (num: string) => {
    if (pin.length < 4) {
      const newPin = pin + num;
      setPin(newPin);

      if (newPin.length === 4) {
        if (newPin === SECRET_PIN) {
          localStorage.setItem('arume_secure_session', 'active');
          setIsAuthenticated(true);
        } else {
          setError(true);
          setTimeout(() => {
            setPin('');
            setError(false);
          }, 800);
        }
      }
    }
  };

  const handleDelete = () => {
    setPin(pin.slice(0, -1));
  };

  // Si está autenticada, mostramos la App normal
  if (isAuthenticated) {
    return <>{children}</>;
  }

  // Si NO está autenticada, mostramos el Escudo
  return (
    <div className="min-h-screen bg-slate-900 flex flex-col items-center justify-center p-4 relative overflow-hidden">
      <div className="absolute top-0 left-0 w-full h-2 bg-gradient-to-r from-emerald-400 via-indigo-500 to-rose-500" />
      
      <motion.div 
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        className="bg-slate-800 p-8 rounded-[3rem] shadow-2xl border border-slate-700 max-w-sm w-full flex flex-col items-center"
      >
        <div className="w-16 h-16 bg-slate-900 rounded-full flex items-center justify-center border-2 border-indigo-500 mb-6 shadow-[0_0_15px_rgba(99,102,241,0.5)]">
          <Lock className="w-8 h-8 text-indigo-400" />
        </div>
        
        <h1 className="text-2xl font-black text-white tracking-tighter mb-1">ARUME HQ</h1>
        <p className="text-[10px] font-bold text-slate-400 uppercase tracking-widest mb-8">Acceso Restringido</p>

        {/* Los 4 puntitos del PIN */}
        <motion.div 
          animate={error ? { x: [-10, 10, -10, 10, 0] } : {}}
          transition={{ duration: 0.4 }}
          className="flex gap-4 mb-8"
        >
          {[0, 1, 2, 3].map((i) => (
            <div 
              key={i} 
              className={`w-4 h-4 rounded-full transition-all duration-300 ${
                error ? 'bg-rose-500' :
                pin.length > i ? 'bg-indigo-400 scale-125 shadow-[0_0_10px_rgba(99,102,241,0.8)]' : 'bg-slate-700'
              }`}
            />
          ))}
        </motion.div>

        {/* Teclado Numérico */}
        <div className="grid grid-cols-3 gap-4 w-full">
          {[1, 2, 3, 4, 5, 6, 7, 8, 9].map((num) => (
            <button
              key={num}
              onClick={() => handleKeypad(num.toString())}
              className="h-16 rounded-2xl bg-slate-700/50 text-white text-2xl font-bold hover:bg-indigo-600 transition-colors active:scale-95"
            >
              {num}
            </button>
          ))}
          <div className="h-16" /> {/* Espacio vacío */}
          <button
            onClick={() => handleKeypad('0')}
            className="h-16 rounded-2xl bg-slate-700/50 text-white text-2xl font-bold hover:bg-indigo-600 transition-colors active:scale-95"
          >
            0
          </button>
          <button
            onClick={handleDelete}
            className="h-16 rounded-2xl bg-slate-700/50 text-slate-400 text-sm font-bold hover:bg-rose-600 hover:text-white transition-colors active:scale-95 flex items-center justify-center uppercase tracking-wider"
          >
            Del
          </button>
        </div>

        {error && (
          <p className="text-rose-400 text-[10px] font-bold uppercase tracking-widest mt-6 flex items-center gap-1">
            <AlertCircle className="w-3 h-3" /> PIN Incorrecto
          </p>
        )}
      </motion.div>
    </div>
  );
};
