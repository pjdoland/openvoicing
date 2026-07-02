import { beforeEach, describe, expect, it } from "vitest";
import { IDBFactory } from "fake-indexeddb";
import { storage } from "../src/storage";

describe("storage (IndexedDB wrapper)", () => {
  beforeEach(() => {
    // Fresh database per test.
    globalThis.indexedDB = new IDBFactory();
  });

  it("round-trips values", async () => {
    await storage.set("k", { a: 1, b: "two" });
    expect(await storage.get("k")).toEqual({ a: 1, b: "two" });
  });

  it("returns undefined for missing keys", async () => {
    expect(await storage.get("nope")).toBeUndefined();
  });

  it("stores binary data", async () => {
    const bytes = new Uint8Array([1, 2, 3, 4]).buffer;
    await storage.set("bin", bytes);
    const back = (await storage.get<ArrayBuffer>("bin"))!;
    expect(new Uint8Array(back)).toEqual(new Uint8Array([1, 2, 3, 4]));
  });

  it("overwrites and deletes", async () => {
    await storage.set("k", 1);
    await storage.set("k", 2);
    expect(await storage.get("k")).toBe(2);
    await storage.delete("k");
    expect(await storage.get("k")).toBeUndefined();
  });

  it("isolates keys", async () => {
    await storage.set("a", "x");
    await storage.set("b", "y");
    expect(await storage.get("a")).toBe("x");
    expect(await storage.get("b")).toBe("y");
  });
});
