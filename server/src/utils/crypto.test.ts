import { describe, it, expect } from "vitest";
import {
  encryptSecret,
  decryptSecret,
  generateAgentKey,
  generateMifareKey,
  encryptForCard,
  decryptForCard,
  citizenRecordCapacityBytes,
  generateDataKey,
} from "./crypto.js";

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

  it("generates 6-byte MIFARE keys", () => {
    const key1 = generateMifareKey();
    const key2 = generateMifareKey();
    expect(key1).not.toBe(key2);
    expect(key1).toMatch(/^[0-9a-f]{12}$/);
  });

  it("generates 32-byte data keys", () => {
    const key1 = generateDataKey();
    const key2 = generateDataKey();
    expect(key1).not.toBe(key2);
    expect(key1).toMatch(/^[0-9a-f]{64}$/);
  });

  it("round-trips on-card data and produces a block-multiple-sized blob", () => {
    const key = generateDataKey();
    const capacity = citizenRecordCapacityBytes(2); // 2 blocks = 32 bytes
    const plaintext = Buffer.concat([Buffer.from("hello"), Buffer.alloc(capacity - 5)]);
    const blob = encryptForCard(plaintext, key);
    expect(blob.length).toBe(2 * 16);
    expect(decryptForCard(blob, key)).toEqual(plaintext);
  });

  it("rejects on-card data decrypted with the wrong key", () => {
    const blob = encryptForCard(Buffer.from("secret"), generateDataKey());
    expect(() => decryptForCard(blob, generateDataKey())).toThrow();
  });

  it("rejects tampered on-card data", () => {
    const key = generateDataKey();
    const blob = encryptForCard(Buffer.from("secret"), key);
    blob[blob.length - 1] ^= 0xff;
    expect(() => decryptForCard(blob, key)).toThrow();
  });

  it("computes on-card capacity accounting for the nonce+tag overhead", () => {
    expect(citizenRecordCapacityBytes(1)).toBe(0);
    expect(citizenRecordCapacityBytes(2)).toBe(16);
    expect(citizenRecordCapacityBytes(4)).toBe(48);
  });
});
