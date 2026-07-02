export interface Command {
  id: string;
  label: string;
  group: string;
  /** Human-readable shortcut, shown in the palette and menus. */
  shortcut?: string;
  run: () => void;
  enabled?: boolean;
}

/** Rank commands for a query: prefix > word-start > substring; empty = all. */
export function filterCommands(commands: Command[], query: string): Command[] {
  const q = query.trim().toLowerCase();
  if (!q) return commands.filter((c) => c.enabled !== false);
  const scored: Array<{ c: Command; score: number }> = [];
  for (const c of commands) {
    if (c.enabled === false) continue;
    const hay = `${c.group} ${c.label}`.toLowerCase();
    const label = c.label.toLowerCase();
    let score = -1;
    if (label.startsWith(q)) score = 3;
    else if (new RegExp(`\\b${escapeRegExp(q)}`).test(label)) score = 2;
    else if (hay.includes(q)) score = 1;
    if (score >= 0) scored.push({ c, score });
  }
  scored.sort((a, b) => b.score - a.score || a.c.label.localeCompare(b.c.label));
  return scored.map((s) => s.c);
}

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
