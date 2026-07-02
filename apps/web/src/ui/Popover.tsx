import { useEffect, useRef, useState, type ReactNode } from "react";

/**
 * A button that toggles a small floating panel of related controls. Used to
 * tuck secondary options (loop settings, practice aids) out of the toolbar
 * until the user opens them. Closes on outside click or Escape.
 */
export function Popover({
  label,
  children,
  icon,
  active,
  title,
  className,
}: {
  label: ReactNode;
  children: ReactNode;
  icon?: ReactNode;
  active?: boolean;
  title?: string;
  className?: string;
}) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  return (
    <div className={`popover ${className ?? ""}`} ref={rootRef}>
      <button
        type="button"
        className={active ? "popover-trigger active" : "popover-trigger"}
        aria-haspopup="dialog"
        aria-expanded={open}
        title={title}
        onClick={() => setOpen((v) => !v)}
      >
        {icon}
        {label}
      </button>
      {open && <div className="popover-panel" role="dialog">{children}</div>}
    </div>
  );
}
