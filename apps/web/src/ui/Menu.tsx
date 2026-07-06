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
  /**
   * Id of a hidden `<input type="file">` this item opens. Rendered as a native
   * `<label>` so the browser opens the file picker itself, which is more robust
   * than a programmatic input.click() (some browsers refuse the latter).
   */
  fileInputId?: string;
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
        aria-label={label}
      >
        {icon}
        <span className="menu-trigger-label">{label}</span>
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
            ) : item.fileInputId ? (
              <li key={i} role="none">
                {/* Native label: clicking opens the file picker via the browser,
                    not a programmatic click. Keyboard activation triggers the
                    input from within the key gesture, which browsers do allow. */}
                <label
                  role="menuitem"
                  className={item.disabled ? "menu-item menu-item-disabled" : "menu-item"}
                  htmlFor={item.disabled ? undefined : item.fileInputId}
                  aria-disabled={item.disabled}
                  tabIndex={item.disabled ? -1 : 0}
                  onClick={item.disabled ? undefined : () => setOpen(false)}
                  onKeyDown={(e) => {
                    if (!item.disabled && (e.key === "Enter" || e.key === " ")) {
                      e.preventDefault();
                      document.getElementById(item.fileInputId!)?.click();
                      setOpen(false);
                    }
                  }}
                >
                  <span className="menu-item-check" aria-hidden="true" />
                  <span className="menu-item-label">{item.label}</span>
                </label>
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
