import { XMLParser } from "fast-xml-parser";

/**
 * Order-preserving XML nodes. fast-xml-parser's `preserveOrder` mode keeps the
 * document order of children (essential for MusicXML cursor replay: the
 * interleaving of <note>/<backup>/<forward> carries the timing), representing
 * each element as a single-key object plus an optional `:@` attribute bag.
 */
export type XmlNode = Record<string, unknown> & { ":@"?: Record<string, string> };

const parser = new XMLParser({
  preserveOrder: true,
  ignoreAttributes: false,
  attributeNamePrefix: "@_",
  trimValues: true,
  parseTagValue: false,
});

export function parseXml(xml: string): XmlNode[] {
  return parser.parse(xml) as XmlNode[];
}

/** The tag name of a preserveOrder node (its single non-`:@` key). */
export function tagOf(node: XmlNode): string {
  for (const k of Object.keys(node)) if (k !== ":@") return k;
  return "";
}

export function childrenOf(node: XmlNode): XmlNode[] {
  const tag = tagOf(node);
  const v = node[tag];
  return Array.isArray(v) ? (v as XmlNode[]) : [];
}

export function attr(node: XmlNode, name: string): string | undefined {
  return node[":@"]?.[`@_${name}`];
}

/** Text content of a leaf element (its `#text` child). */
export function textOf(node: XmlNode): string | undefined {
  for (const c of childrenOf(node)) {
    if ("#text" in c) return String((c as Record<string, unknown>)["#text"]);
  }
  return undefined;
}

export function child(nodes: XmlNode[], tag: string): XmlNode | undefined {
  return nodes.find((n) => tagOf(n) === tag);
}

export function children(nodes: XmlNode[], tag: string): XmlNode[] {
  return nodes.filter((n) => tagOf(n) === tag);
}

/** Convenience: text of the first child element with `tag`. */
export function childText(nodes: XmlNode[], tag: string): string | undefined {
  const c = child(nodes, tag);
  return c ? textOf(c) : undefined;
}
