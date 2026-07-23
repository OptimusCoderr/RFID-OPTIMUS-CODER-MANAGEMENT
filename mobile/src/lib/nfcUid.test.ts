import { normalizeUid } from "./nfcUid";

describe("normalizeUid", () => {
  it("uppercases and passes through already-clean hex", () => {
    expect(normalizeUid("04a1b2c3")).toBe("04A1B2C3");
  });

  it("strips separators some native layers include (colons, spaces)", () => {
    expect(normalizeUid("04:A1:B2:C3")).toBe("04A1B2C3");
    expect(normalizeUid("04 A1 B2 C3")).toBe("04A1B2C3");
  });

  it("returns null for undefined input", () => {
    expect(normalizeUid(undefined)).toBeNull();
  });

  it("returns null for an empty string", () => {
    expect(normalizeUid("")).toBeNull();
  });

  it("returns null when nothing hex-like survives stripping", () => {
    expect(normalizeUid(":: ::")).toBeNull();
  });

  it("preserves a 7-byte UID's full length (MIFARE Ultralight/NTAG/DESFire)", () => {
    expect(normalizeUid("04a1b2c3d4e5f6")).toBe("04A1B2C3D4E5F6");
  });
});
