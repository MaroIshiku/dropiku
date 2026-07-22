import { useEffect, type ReactNode } from "react";
import { Icon } from "./Icon";

export function Dialog({ open, title, children, onClose, wide = false }: { open: boolean; title: string; children: ReactNode; onClose: () => void; wide?: boolean }) {
  useEffect(() => {
    if (!open) return;
    const listener = (event: KeyboardEvent) => { if (event.key === "Escape") onClose(); };
    addEventListener("keydown", listener);
    return () => removeEventListener("keydown", listener);
  }, [open, onClose]);
  if (!open) return null;
  return <div className="psu-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}>
    <section className={`psu-dialog dropiku-dialog ${wide ? "is-wide" : ""}`} role="dialog" aria-modal="true" aria-labelledby="dialog-title">
      <header className="dialog-header"><h2 id="dialog-title">{title}</h2><button className="psu-icon-button" type="button" onClick={onClose} aria-label="Close"><Icon name="close" /></button></header>
      {children}
    </section>
  </div>;
}
