import { describe, it, expect } from "vitest";
import { encryptSecret, decryptSecret, generateAgentKey } from "./crypto.js";

describe("crypto", () => {
  it("round-trips plaintext through encrypt/decrypt", () => {
    const plaintext = JSON.stringify({ sector: 1, keyA: "FFFFFFFFFFFF" });
    const encrypted = encryptSecret(plaintext);
    expect(encrypted).not.toContain("FFFFFFFFFFFF");
    expect(decryptSecret(encrypted)).toBe(plaintext);
  });

  it("produces a different ciphertext each time (random IV)", () => {
    const a = encryptSecret("same input");
    const b = encryptSecret("same input");
    expect(a).not.toBe(b);
  });

  it("rejects a tampered ciphertext", () => {
    const encrypted = encryptSecret("sensitive-value");
    const [iv, tag, data] = encrypted.split(".");
    const tamperedByte = Buffer.from(data, "base64");
    tamperedByte[0] ^= 0xff;
    const tampered = [iv, tag, tamperedByte.toString("base64")].join(".");
    expect(() => decryptSecret(tampered)).toThrow();
  });

  it("rejects a malformed payload", () => {
    expect(() => decryptSecret("not-a-valid-payload")).toThrow();
  });

  it("generates agent keys of consistent, sufficient length", () => {
    const key1 = generateAgentKey();
    const key2 = generateAgentKey();
    expect(key1).not.toBe(key2);
    expect(key1).toMatch(/^[0-9a-f]{48}$/);
  });
});
