import { useEffect, useState, type ReactNode } from "react";

/**
 * A titled region that can be collapsed to just its header. The open/closed
 * state persists in localStorage under `panel:<id>` so users are not
 * re-overwhelmed on every visit.
 */
export function CollapsiblePanel({
  id,
  title,
  defaultOpen = true,
  actions,
  children,
  ariaLabel,
}: {
  id: string;
  title: string;
  defaultOpen?: boolean;
  actions?: ReactNode;
  children: ReactNode;
  ariaLabel?: string;
}) {
  const key = `panel:${id}`;
  const [open, setOpen] = useState<boolean>(() => {
    const saved = localStorage.getItem(key);
    return saved === null ? defaultOpen : saved === "1";
  });

  useEffect(() => {
    localStorage.setItem(key, open ? "1" : "0");
  }, [key, open]);

  return (
    <section className="panel" aria-label={ariaLabel ?? title}>
      <div className="panel-header">
        <button
          type="button"
          className="panel-toggle"
          aria-expanded={open}
          onClick={() => setOpen((v) => !v)}
        >
          <span aria-hidden="true" className={open ? "panel-chevron open" : "panel-chevron"}>
            ▸
          </span>
          <span className="panel-title">{title}</span>
        </button>
        {open && actions && <div className="panel-actions">{actions}</div>}
      </div>
      {open && <div className="panel-body">{children}</div>}
    </section>
  );
}

/** Clear all persisted panel/layout preferences (View menu "Reset layout"). */
export function resetLayout() {
  for (const k of Object.keys(localStorage)) {
    if (k.startsWith("panel:")) localStorage.removeItem(k);
  }
}
