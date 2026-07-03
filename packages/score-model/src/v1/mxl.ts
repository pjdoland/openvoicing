import { strFromU8, unzipSync } from "fflate";
import { child, childrenOf, parseXml, tagOf, type XmlNode } from "./xml";

/** True if the bytes are a ZIP archive (the .mxl compressed MusicXML container). */
export function isMxl(data: Uint8Array): boolean {
  return data.length > 3 && data[0] === 0x50 && data[1] === 0x4b && data[2] === 0x03 && data[3] === 0x04;
}

/**
 * Extract the root MusicXML document from a compressed `.mxl` container. The
 * container is a ZIP whose `META-INF/container.xml` names the rootfile (falling
 * back to the first non-META `.xml`/`.musicxml` entry).
 */
export function unwrapMxl(data: Uint8Array): string {
  const entries = unzipSync(data);
  const rootPath = findRootFile(entries) ?? firstScoreEntry(entries);
  if (!rootPath || !entries[rootPath]) throw new Error("no MusicXML rootfile found in .mxl container");
  return strFromU8(entries[rootPath]!);
}

/** Read META-INF/container.xml and return the first rootfile's full-path. */
function findRootFile(entries: Record<string, Uint8Array>): string | undefined {
  const container = entries["META-INF/container.xml"];
  if (!container) return undefined;
  const roots = parseXml(strFromU8(container)).find((n) => tagOf(n) === "container");
  if (!roots) return undefined;
  const rootfiles = firstChild(childrenOf(roots), "rootfiles");
  if (!rootfiles) return undefined;
  const rootfile = firstChild(childrenOf(rootfiles), "rootfile");
  return rootfile?.[":@"]?.["@_full-path"];
}

function firstChild(nodes: XmlNode[], tag: string): XmlNode | undefined {
  return child(nodes, tag);
}

function firstScoreEntry(entries: Record<string, Uint8Array>): string | undefined {
  return Object.keys(entries).find(
    (name) => !name.startsWith("META-INF/") && (name.endsWith(".xml") || name.endsWith(".musicxml")),
  );
}
