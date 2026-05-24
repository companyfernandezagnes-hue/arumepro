import React, { createContext, useContext, useState, useCallback, useMemo } from 'react';
import { EmpresaId, EmpresaConfig, EMPRESAS_DEFAULT, EMPRESA_MODULES } from '../types';

const LS_KEY = 'arume_empresa_activa';

interface EmpresaContextValue {
  empresaActiva: EmpresaId;
  setEmpresaActiva: (id: EmpresaId) => void;
  empresaConfig: EmpresaConfig;
  empresas: EmpresaConfig[];
  modulosPermitidos: Set<string>;
}

const EmpresaContext = createContext<EmpresaContextValue | null>(null);

function getInitialEmpresa(): EmpresaId {
  try {
    const stored = localStorage.getItem(LS_KEY);
    if (stored === 'arume' || stored === 'raco') return stored;
  } catch {/* noop */}
  return 'arume';
}

export function EmpresaProvider({ children }: { children: React.ReactNode }) {
  const [empresaActiva, setEmpresaActivaState] = useState<EmpresaId>(getInitialEmpresa);

  const setEmpresaActiva = useCallback((id: EmpresaId) => {
    setEmpresaActivaState(id);
    try { localStorage.setItem(LS_KEY, id); } catch {/* noop */}
  }, []);

  const empresaConfig = useMemo(
    () => EMPRESAS_DEFAULT.find(e => e.id === empresaActiva) ?? EMPRESAS_DEFAULT[0],
    [empresaActiva]
  );

  const modulosPermitidos = useMemo(
    () => EMPRESA_MODULES[empresaActiva],
    [empresaActiva]
  );

  const value = useMemo<EmpresaContextValue>(() => ({
    empresaActiva,
    setEmpresaActiva,
    empresaConfig,
    empresas: EMPRESAS_DEFAULT,
    modulosPermitidos,
  }), [empresaActiva, setEmpresaActiva, empresaConfig, modulosPermitidos]);

  return (
    <EmpresaContext.Provider value={value}>
      {children}
    </EmpresaContext.Provider>
  );
}

export function useEmpresa(): EmpresaContextValue {
  const ctx = useContext(EmpresaContext);
  if (!ctx) throw new Error('useEmpresa debe usarse dentro de EmpresaProvider');
  return ctx;
}
