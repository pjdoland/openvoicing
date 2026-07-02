import {
  useEffect,
  useId,
  useRef,
  useState,
  type ReactNode,
} from "react";

export interface MenuItem {
  label?: string;
  onSelect?: () => void;
  shortcut?: string;
  disabled?: boolean;
  checked?: boolean;
  /** A non-interactive section heading. */
  heading?: boolean;
  /** A visual divider (no label needed). */
  divider?: boolean;
  /** Render a submenu of items instead of an action. */
  submenu?: MenuItem[];
}

/**
 * An accessible dropdown menu: a trigger button and a popup list. Closes on
 * outside click, Escape, or selection; arrow keys move focus.
 */
export function Menu({
  label,
  items,
  icon,
  className,
}: {
  label: string;
  items: MenuItem[];
  icon?: ReactNode;
  className?: string;
}) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const menuId = useId();

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
    <div className={`menu ${className ?? ""}`} ref={rootRef}>
      <button
        type="button"
        className="menu-trigger"
        aria-haspopup="menu"
        aria-expanded={open}
        aria-controls={open ? menuId : undefined}
        onClick={() => setOpen((v) => !v)}
      >
        {icon}
        {label}
        <span aria-hidden="true" className="menu-caret">
          ▾
        </span>
      </button>
      {open && (
        <ul className="menu-list" id={menuId} role="menu" aria-label={label}>
          {items.map((item, i) =>
            item.divider ? (
              <li key={i} className="menu-divider" role="separator" />
            ) : item.heading ? (
              <li key={i} className="menu-heading" role="presentation">
                {item.label}
              </li>
            ) : (
              <li key={i} role="none">
                <button
                  type="button"
                  role="menuitem"
                  className="menu-item"
                  disabled={item.disabled}
                  aria-checked={item.checked}
                  onClick={() => {
                    item.onSelect?.();
                    setOpen(false);
                  }}
                >
                  <span className="menu-item-check" aria-hidden="true">
                    {item.checked ? "✓" : ""}
                  </span>
                  <span className="menu-item-label">{item.label}</span>
                  {item.shortcut && <kbd className="menu-item-shortcut">{item.shortcut}</kbd>}
                </button>
              </li>
            ),
          )}
        </ul>
      )}
    </div>
  );
}
