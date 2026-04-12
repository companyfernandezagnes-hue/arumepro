import React, { useEffect, useRef, useState, useCallback, useMemo } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { cn } from './lib/utils';
import { useSwipeUpToReveal } from './hooks/useSwipeUpToReveal';

export type DockItem<T extends string> = {
  key: T;
  label: string;
  icon: React.ComponentType<{ className?: string }>;
  group?: 'main' | 'fin' | 'ops';
};

type Props<T extends string> = {
  items: DockItem<T>[];
  activeKey: T;
  onChange: (key: T) => void;
  isOffline?: boolean;
  isSyncing?: boolean;
  hotZone?: number;
};

export function AutoHideDock<T extends string>({
  items, activeKey, onChange, isOffline, isSyncing, hotZone = 30,
}: Props<T>) {

  const [visible, setVisible] = useState(false);
  const [hoveringDock, setHoveringDock] = useState(false);
  const [lastMove, setLastMove] = useState(0);
  const hideTimerRef = useRef<number | null>(null);

  const onMouseMove = useCallback((e: MouseEvent) => {
    setLastMove(Date.now());
    const y = e.clientY;
    const h = window.innerHeight;
    if (h - y <= hotZone) setVisible(true);
  }, [hotZone]);

  useSwipeUpToReveal({
    edgeHeight: 40,
    onReveal: () => setVisible(true),
    onlyCoarsePointer: true,
  });

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const active = document.activeElement as HTMLElement;
      const isTyping = active && (active.tagName === 'INPUT' || active.tagName === 'TEXTAREA');
      if (!isTyping && e.key.toLowerCase() === 'd') setVisible(v => !v);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  useEffect(() => {
    window.addEventListener('mousemove', onMouseMove);
    return () => window.removeEventListener('mousemove', onMouseMove);
  }, [onMouseMove]);

  useEffect(() => {
    if (!visible) return;
    if (hideTimerRef.current) window.clearTimeout(hideTimerRef.current);
    hideTimerRef.current = window.setTimeout(() => {
      if (!hoveringDock && Date.now() - lastMove > 2000) setVisible(false);
    }, 2500);
    return () => { if (hideTimerRef.current) window.clearTimeout(hideTimerRef.current); };
  }, [visible, hoveringDock, lastMove]);

  const groups = useMemo(() => ({
    main: items.filter(i => (i.group ?? 'main') === 'main'),
    fin:  items.filter(i => i.group === 'fin'),
    ops:  items.filter(i => i.group === 'ops'),
  }), [items]);

  // Touch scroll horizontal sin interferir con swipe de pagina
  const scrollRef = useRef<HTMLDivElement>(null);
  const touchState = useRef<{ startX: number; startY: number; scrollLeft: number; locked: boolean }>({
    startX: 0, startY: 0, scrollLeft: 0, locked: false,
  });

  const onTouchStart = useCallback((e: React.TouchEvent) => {
    const el = scrollRef.current;
    if (!el) return;
    touchState.current = {
      startX: e.touches[0].clientX,
      startY: e.touches[0].clientY,
      scrollLeft: el.scrollLeft,
      locked: false,
    };
  }, []);

  const onTouchMove = useCallback((e: React.TouchEvent) => {
    const el = scrollRef.current;
    if (!el) return;
    const dx = e.touches[0].clientX - touchState.current.startX;
    const dy = e.touches[0].clientY - touchState.current.startY;
    if (!touchState.current.locked) {
      if (Math.abs(dx) > Math.abs(dy) + 5) {
        touchState.current.locked = true;
      } else if (Math.abs(dy) > Math.abs(dx) + 5) {
        return;
      }
    }
    if (touchState.current.locked) {
      e.stopPropagation();
      el.scrollLeft = touchState.current.scrollLeft - dx;
    }
  }, []);

  return (
    <>
      <AnimatePresence>
        {!visible && (
          <motion.div
            initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
            className="fixed bottom-2 left-1/2 -translate-x-1/2 w-16 h-1.5 rounded-full bg-slate-300/60 z-[119] pointer-events-none"
            style={{ marginBottom: 'env(safe-area-inset-bottom)' }}
          />
        )}
      </AnimatePresence>

      <AnimatePresence>
        {visible && (
          <motion.nav
            role="navigation" aria-label="Menu principal"
            initial={{ y: 96, opacity: 0 }} animate={{ y: 0, opacity: 1 }} exit={{ y: 96, opacity: 0 }}
            transition={{ type: 'spring', stiffness: 320, damping: 28 }}
            className="fixed bottom-0 left-0 right-0 z-[120] px-4 pb-4 md:pb-6 pt-10"
            onMouseEnter={() => setHoveringDock(true)}
            onMouseLeave={() => setHoveringDock(false)}
          >
            <div
              className={cn(
                "mx-auto max-w-fit rounded-2xl border border-slate-200/50 bg-white/80 backdrop-blur-xl shadow-2xl",
                "px-3 sm:px-4 py-2.5",
              )}
              style={{ paddingBottom: 'calc(0.75rem + env(safe-area-inset-bottom))' }}
            >
              <div
                ref={scrollRef}
                className="flex items-center gap-1.5 overflow-x-auto no-scrollbar"
                style={{ WebkitOverflowScrolling: 'touch', touchAction: 'pan-x' }}
                onTouchStart={onTouchStart}
                onTouchMove={onTouchMove}
              >
                {groups.main.map(it => <DockButton key={it.key} item={it} active={it.key === activeKey} onClick={() => onChange(it.key)} />)}
                <div className="w-px h-6 bg-slate-200 mx-1 shrink-0" />
                {groups.fin.map(it => <DockButton key={it.key} item={it} active={it.key === activeKey} onClick={() => onChange(it.key)} />)}
                <div className="w-px h-6 bg-slate-200 mx-1 shrink-0" />
                {groups.ops.map(it => <DockButton key={it.key} item={it} active={it.key === activeKey} onClick={() => onChange(it.key)} />)}
              </div>

              <div className="mt-2 flex items-center gap-2 px-1 justify-center opacity-70 hover:opacity-100 transition-opacity">
                <span className="text-[9px] font-bold text-slate-400 uppercase tracking-widest flex items-center gap-1">
                  Atajos: <kbd className="px-1.5 py-0.5 bg-slate-100 border border-slate-200 rounded text-slate-600">D</kbd> Dock <kbd className="px-1.5 py-0.5 bg-slate-100 border border-slate-200 rounded text-slate-600 ml-1">K</kbd> Buscador
                </span>
                {isOffline && <span className="ml-auto text-[9px] font-black uppercase bg-amber-50 text-amber-600 border border-amber-200 px-2 py-0.5 rounded">Offline</span>}
                {isSyncing && !isOffline && <span className="ml-auto text-[9px] font-black uppercase text-indigo-600">Sincronizando...</span>}
              </div>
            </div>
          </motion.nav>
        )}
      </AnimatePresence>
    </>
  );
}

function DockButton<T extends string>({ item, active, onClick }: { item: DockItem<T>, active: boolean, onClick: () => void }) {
  const Icon = item.icon;
  return (
    <button
      type="button" title={item.label} onClick={onClick}
      className={cn(
        "min-w-[64px] h-12 px-3 rounded-xl border text-[10px] sm:text-xs font-black uppercase tracking-wider flex items-center justify-center gap-2 transition active:scale-[0.95]",
        active ? "bg-slate-900 text-white border-slate-900 shadow-lg shadow-slate-900/20" : "bg-white text-slate-600 border-slate-200 hover:bg-slate-50 hover:border-slate-300"
      )}
    >
      <Icon className={cn("w-4 h-4 shrink-0", active ? "text-white" : "text-slate-500")} />
      <span className="hidden sm:block">{item.label}</span>
    </button>
  );
}
