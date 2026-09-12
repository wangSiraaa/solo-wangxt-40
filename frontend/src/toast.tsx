import { createContext, useCallback, useContext, useState } from 'react';
import type { ReactNode } from 'react';

interface Toast {
  id: number;
  text: string;
  err?: boolean;
}
const ToastCtx = createContext<(text: string, err?: boolean) => void>(() => {});
export const useToast = () => useContext(ToastCtx);

export function ToastProvider({ children }: { children: ReactNode }) {
  const [items, setItems] = useState<Toast[]>([]);
  const push = useCallback((text: string, err?: boolean) => {
    const id = Date.now() + Math.random();
    setItems((t) => [...t, { id, text, err }]);
    setTimeout(() => setItems((t) => t.filter((x) => x.id !== id)), 6000);
  }, []);
  return (
    <ToastCtx.Provider value={push}>
      {children}
      <div className="toast">
        {items.map((t) => (
          <div key={t.id} className={`t ${t.err ? 'err' : ''}`}>
            {t.text}
          </div>
        ))}
      </div>
    </ToastCtx.Provider>
  );
}

/** 包一层错误提示的动作执行器 */
export function useAction() {
  const toast = useToast();
  return async (fn: () => Promise<any>, ok?: string) => {
    try {
      const r = await fn();
      if (ok) toast(ok);
      return r;
    } catch (e: any) {
      let msg = String(e?.message ?? e);
      try {
        msg = JSON.parse(msg.slice(msg.indexOf('{')))?.message ?? msg;
      } catch {}
      toast(msg, true);
      throw e;
    }
  };
}
