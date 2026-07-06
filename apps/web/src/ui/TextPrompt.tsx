import { useEffect, useRef, useState } from "react";

export interface TextPromptRequest {
  label: string;
  initial?: string;
  placeholder?: string;
  /** Optional live preview of the current value (e.g. a parsed chord). */
  preview?: (value: string) => string | null;
  submit: (value: string) => void;
}

/**
 * A small styled, non-blocking replacement for window.prompt: keeps the user in
 * context, is keyboard- and touch-friendly (native prompt() is neither), and
 * can show a live preview of what they're typing. Enter submits, Escape cancels.
 */
export function TextPrompt({
  request,
  onClose,
}: {
  request: TextPromptRequest;
  onClose: () => void;
}) {
  const [value, setValue] = useState(request.initial ?? "");
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    inputRef.current?.focus();
    inputRef.current?.select();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onClose]);

  function commit() {
    request.submit(value);
    onClose();
  }

  const preview = request.preview?.(value) ?? null;

  return (
    <div className="prompt-backdrop" role="dialog" aria-modal="true" aria-label={request.label} onMouseDown={onClose}>
      <div className="prompt-card" onMouseDown={(e) => e.stopPropagation()}>
        <label className="prompt-label">
          {request.label}
          <input
            ref={inputRef}
            className="prompt-input"
            value={value}
            placeholder={request.placeholder}
            onChange={(e) => setValue(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") commit();
            }}
          />
        </label>
        {preview && <div className="prompt-preview">{preview}</div>}
        <div className="prompt-actions">
          <button onClick={onClose}>Cancel</button>
          <button className="btn-primary" onClick={commit}>
            OK
          </button>
        </div>
      </div>
    </div>
  );
}
