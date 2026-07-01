/**
 * Stable entity IDs. Every musical entity gets one at creation and keeps it for
 * life, so annotations, sync anchors, and comments can reference entities across edits.
 */
export function newId(prefix: string): string {
  const uuid = globalThis.crypto.randomUUID().replaceAll("-", "");
  return `${prefix}_${uuid.slice(0, 12)}`;
}
