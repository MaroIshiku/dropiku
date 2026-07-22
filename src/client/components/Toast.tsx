import { createContext, useCallback, useContext, useMemo, useState, type ReactNode } from "react";

type ToastKind = "default" | "error";
type ShowToast = (message: string, kind?: ToastKind) => void;
const ToastContext = createContext<ShowToast>(() => undefined);

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toast, setToast] = useState<{ message: string; kind: ToastKind } | null>(null);
  const show = useCallback<ShowToast>((message, kind = "default") => {
    setToast({ message, kind });
    window.setTimeout(() => setToast(null), 3600);
  }, []);
  const value = useMemo(() => show, [show]);
  return <ToastContext.Provider value={value}>{children}<div id="psu-toast-host" className={`psu-toast-host ${toast ? "is-visible" : ""} ${toast?.kind === "error" ? "is-error" : ""}`} aria-live="polite">{toast?.message}</div></ToastContext.Provider>;
}

export function useToast(): ShowToast {
  return useContext(ToastContext);
}
