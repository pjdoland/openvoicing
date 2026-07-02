import { describe, expect, it } from "vitest";
import { parseDeepLink } from "../src/deep-link";

function parse(query: string) {
  return parseDeepLink(new URLSearchParams(query));
}

describe("parseDeepLink", () => {
  it("parses a valid speed", () => {
    expect(parse("speed=0.75")).toEqual({ speed: 0.75 });
  });

  it("drops out-of-range and non-numeric speed", () => {
    expect(parse("speed=0.1").speed).toBeUndefined();
    expect(parse("speed=2").speed).toBeUndefined();
    expect(parse("speed=fast").speed).toBeUndefined();
  });

  it("parses second-based loops", () => {
    expect(parse("loop=2-6.5")).toEqual({ loopSeconds: { start: 2, end: 6.5 } });
  });

  it("parses bar-based loops", () => {
    expect(parse("loop=b3-6")).toEqual({ loopBars: { fromBar: 3, toBar: 6 } });
  });

  it("rejects backwards or malformed loops", () => {
    expect(parse("loop=6-2").loopSeconds).toBeUndefined();
    expect(parse("loop=b6-2").loopBars).toBeUndefined();
    expect(parse("loop=garbage")).toEqual({});
  });

  it("parses start time and ignores zero/negative", () => {
    expect(parse("t=12.5").start).toBe(12.5);
    expect(parse("t=0").start).toBeUndefined();
    expect(parse("t=-3").start).toBeUndefined();
  });

  it("combines all params", () => {
    expect(parse("speed=0.7&loop=b2-4&t=1.5")).toEqual({
      speed: 0.7,
      loopBars: { fromBar: 2, toBar: 4 },
      start: 1.5,
    });
  });

  it("returns an empty preset with no params", () => {
    expect(parse("")).toEqual({});
  });
});
