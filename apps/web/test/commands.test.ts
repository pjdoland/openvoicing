import { describe, expect, it } from "vitest";
import { filterCommands, type Command } from "../src/ui/commands";

const cmd = (id: string, label: string, group = "Transport", enabled = true): Command => ({
  id,
  label,
  group,
  run: () => {},
  enabled,
});

const commands = [
  cmd("play", "Play / pause"),
  cmd("stop", "Stop"),
  cmd("midi", "Export MIDI", "File"),
  cmd("xml", "Export MusicXML", "File"),
  cmd("auto", "Auto sync", "Sync"),
  cmd("dark", "Dark theme", "View", false),
];

describe("filterCommands", () => {
  it("returns all enabled commands for an empty query", () => {
    const all = filterCommands(commands, "");
    expect(all).toHaveLength(5);
    expect(all.find((c) => c.id === "dark")).toBeUndefined();
  });

  it("ranks label-prefix matches highest", () => {
    const r = filterCommands(commands, "export");
    expect(r.map((c) => c.id)).toEqual(["midi", "xml"]);
  });

  it("matches on group as a fallback", () => {
    const r = filterCommands(commands, "sync");
    expect(r[0]!.id).toBe("auto");
  });

  it("excludes disabled commands from results", () => {
    expect(filterCommands(commands, "dark")).toHaveLength(0);
  });

  it("returns nothing for a non-match", () => {
    expect(filterCommands(commands, "zzzz")).toHaveLength(0);
  });
});
