/**
 * Stable entity IDs. Every musical entity gets one at creation and keeps it for
 * life, so annotations, sync anchors, and comments can reference entities across
 * edits.
 *
 * The active generator is swappable so an import can run deterministically:
 * re-importing the same source then yields identical ids, which keeps id-keyed
 * state (sync anchors, comments, saved edits) valid across a reopen.
 */

export type IdGenerator = (prefix: string) => string;

const randomGenerator: IdGenerator = (prefix) =>
  // Full 128-bit uuid (was truncated to 48 bits, a birthday-bound collision
  // risk on large scores with tens of thousands of entities).
  `${prefix}_${globalThis.crypto.randomUUID().replaceAll("-", "")}`;

let activeGenerator: IdGenerator = randomGenerator;

export function newId(prefix: string): string {
  return activeGenerator(prefix);
}

/** A deterministic, counter-based generator (e.g. bar_00000001). */
export function sequentialIdGenerator(): IdGenerator {
  const counts = new Map<string, number>();
  return (prefix) => {
    const n = (counts.get(prefix) ?? 0) + 1;
    counts.set(prefix, n);
    return `${prefix}_${n.toString(36).padStart(8, "0")}`;
  };
}

/** Run `fn` with a specific id generator, restoring the previous one after. */
export function withIdGenerator<T>(generator: IdGenerator, fn: () => T): T {
  const previous = activeGenerator;
  activeGenerator = generator;
  try {
    return fn();
  } finally {
    activeGenerator = previous;
  }
}
