import { describe, it, expect } from "vitest";
import crypto from "crypto";
import {
  buildWrappedApdu,
  buildContinueApdu,
  parseDesfireResponse,
  rotateLeftOneByte,
  deriveAesSessionKey,
  aesCbcEncryptNoPad,
  aesCbcDecryptNoPad,
  buildAesAuthStep2,
  finishAesAuth,
  aidToBytes,
  bytesToAid,
  packUint24LE,
  unpackUint24LE,
  packInt32LE,
  unpackInt32LE,
  packAccessRights,
  unpackAccessRights,
  packKeySettings2,
} from "./desfireCrypto";

describe("buildWrappedApdu", () => {
  it("wraps a command with no data", () => {
    expect(buildWrappedApdu(0x60)).toEqual(Buffer.from([0x90, 0x60, 0x00, 0x00, 0x00, 0x00]));
  });

  it("wraps a command with data, Lc reflecting data length", () => {
    const data = Buffer.from([0x01, 0x02, 0x03]);
    expect(buildWrappedApdu(0x5a, data)).toEqual(Buffer.from([0x90, 0x5a, 0x00, 0x00, 0x03, 0x01, 0x02, 0x03, 0x00]));
  });

  it("rejects data over 255 bytes (single-frame limit)", () => {
    expect(() => buildWrappedApdu(0x3d, Buffer.alloc(256))).toThrow();
  });
});

describe("buildContinueApdu", () => {
  it("is the fixed 'get next frame' APDU", () => {
    expect(buildContinueApdu()).toEqual(Buffer.from([0x90, 0xaf, 0x00, 0x00, 0x00]));
  });
});

describe("parseDesfireResponse", () => {
  it("parses a success response", () => {
    const resp = Buffer.from([0xaa, 0xbb, 0x91, 0x00]);
    const parsed = parseDesfireResponse(resp);
    expect(parsed.success).toBe(true);
    expect(parsed.moreFrames).toBe(false);
    expect(parsed.data).toEqual(Buffer.from([0xaa, 0xbb]));
  });

  it("flags a chained/more-frames response", () => {
    const resp = Buffer.from([0x01, 0x91, 0xaf]);
    const parsed = parseDesfireResponse(resp);
    expect(parsed.success).toBe(true);
    expect(parsed.moreFrames).toBe(true);
  });

  it("throws with a readable message for a known error code", () => {
    const resp = Buffer.from([0x91, 0xae]); // authentication error
    expect(() => parseDesfireResponse(resp)).toThrow(/Authentication error/);
  });

  it("throws for an unrecognized status byte", () => {
    const resp = Buffer.from([0x91, 0x77]);
    expect(() => parseDesfireResponse(resp)).toThrow(/unknown status/);
  });

  it("throws on a malformed (too-short) response", () => {
    expect(() => parseDesfireResponse(Buffer.from([0x91]))).toThrow();
  });

  it("throws when the status wrapper isn't 0x91", () => {
    expect(() => parseDesfireResponse(Buffer.from([0x90, 0x00]))).toThrow(/unexpected status wrapper/);
  });
});

describe("rotateLeftOneByte", () => {
  it("moves the first byte to the end", () => {
    expect(rotateLeftOneByte(Buffer.from([1, 2, 3, 4]))).toEqual(Buffer.from([2, 3, 4, 1]));
  });

  it("handles an empty buffer without throwing", () => {
    expect(rotateLeftOneByte(Buffer.alloc(0))).toEqual(Buffer.alloc(0));
  });
});

describe("deriveAesSessionKey", () => {
  it("concatenates the documented byte ranges of RndA/RndB", () => {
    const rndA = Buffer.from(Array.from({ length: 16 }, (_, i) => i)); // 0..15
    const rndB = Buffer.from(Array.from({ length: 16 }, (_, i) => 100 + i)); // 100..115
    const session = deriveAesSessionKey(rndA, rndB);
    expect(session).toEqual(Buffer.concat([rndA.subarray(0, 4), rndB.subarray(0, 4), rndA.subarray(12, 16), rndB.subarray(12, 16)]));
    expect(session).toHaveLength(16);
  });

  it("rejects RndA/RndB that aren't 16 bytes", () => {
    expect(() => deriveAesSessionKey(Buffer.alloc(8), Buffer.alloc(16))).toThrow();
  });
});

describe("aesCbcEncryptNoPad / aesCbcDecryptNoPad", () => {
  const key = crypto.randomBytes(16);
  const iv = Buffer.alloc(16, 0);

  it("round-trips exact-block-size data with no padding added", () => {
    const plaintext = crypto.randomBytes(32);
    const ciphertext = aesCbcEncryptNoPad(key, iv, plaintext);
    expect(ciphertext).toHaveLength(32);
    expect(aesCbcDecryptNoPad(key, iv, ciphertext)).toEqual(plaintext);
  });

  it("rejects data that isn't a multiple of 16 bytes", () => {
    expect(() => aesCbcEncryptNoPad(key, iv, Buffer.alloc(15))).toThrow();
    expect(() => aesCbcDecryptNoPad(key, iv, Buffer.alloc(17))).toThrow();
  });
});

// Full mutual-authentication round trip, simulating both the reader (this
// module) and the card (using the same primitives with known-good, manually
// verified IV chaining) — the strongest check possible without real hardware.
describe("AES mutual authentication round trip", () => {
  const key = crypto.randomBytes(16);

  function simulateCard(cardKey: Buffer) {
    const cardRndB = crypto.randomBytes(16);
    const encryptedRndB = aesCbcEncryptNoPad(cardKey, Buffer.alloc(16, 0), cardRndB);
    return {
      cardRndB,
      encryptedRndB,
      // Given the reader's step-2 ciphertext, decrypts it, checks the
      // rotated RndB, and produces the encrypted RndA' reply.
      respondToStep2(step2CommandData: Buffer) {
        const iv = encryptedRndB; // IV chains from the card's own first ciphertext
        const plaintext = aesCbcDecryptNoPad(cardKey, iv, step2CommandData);
        const readerRndA = plaintext.subarray(0, 16);
        const rotatedRndBFromReader = plaintext.subarray(16, 32);
        expect(rotatedRndBFromReader).toEqual(rotateLeftOneByte(cardRndB));

        const rotatedRndA = rotateLeftOneByte(readerRndA);
        const replyIv = step2CommandData.subarray(step2CommandData.length - 16);
        return aesCbcEncryptNoPad(cardKey, replyIv, rotatedRndA);
      },
    };
  }

  it("derives matching session keys on both sides for a correct key", () => {
    const card = simulateCard(key);

    const step2 = buildAesAuthStep2(key, card.encryptedRndB, (n) => crypto.randomBytes(n));
    expect(step2.rndB).toEqual(card.cardRndB);

    const encryptedRndAReply = card.respondToStep2(step2.commandData);

    const sessionKey = finishAesAuth(key, step2.commandData, encryptedRndAReply, step2.rndA, step2.rndB);
    expect(sessionKey).toEqual(deriveAesSessionKey(step2.rndA, card.cardRndB));
    expect(sessionKey).toHaveLength(16);
  });

  it("fails when the reader and card keys don't match", () => {
    const wrongKey = crypto.randomBytes(16);
    const card = simulateCard(key);

    // Reader (wrongly) uses a different key than the card.
    const step2 = buildAesAuthStep2(wrongKey, card.encryptedRndB, (n) => crypto.randomBytes(n));
    // Card replies using its own (correct) key, so the exchange desyncs —
    // the reader's final verification must reject it rather than silently
    // deriving a bogus session key.
    const cardIv = card.encryptedRndB;
    let encryptedRndAReply: Buffer;
    try {
      const plaintext = aesCbcDecryptNoPad(key, cardIv, step2.commandData);
      const rotatedRndA = rotateLeftOneByte(plaintext.subarray(0, 16));
      encryptedRndAReply = aesCbcEncryptNoPad(key, step2.commandData.subarray(step2.commandData.length - 16), rotatedRndA);
    } catch {
      encryptedRndAReply = crypto.randomBytes(16);
    }

    expect(() => finishAesAuth(wrongKey, step2.commandData, encryptedRndAReply, step2.rndA, step2.rndB)).toThrow(
      /authentication failed/
    );
  });
});

describe("aidToBytes / bytesToAid", () => {
  it("reverses byte order (DESFire AIDs are transmitted LSB first)", () => {
    expect(aidToBytes("F00001")).toEqual(Buffer.from([0x01, 0x00, 0xf0]));
  });

  it("round-trips through both directions", () => {
    const aid = "A1B2C3";
    expect(bytesToAid(aidToBytes(aid))).toBe(aid.toUpperCase());
  });

  it("rejects a malformed AID", () => {
    expect(() => aidToBytes("ZZZZZZ")).toThrow();
    expect(() => aidToBytes("F0001")).toThrow();
  });
});

describe("packUint24LE / unpackUint24LE", () => {
  it("round-trips values across the 24-bit range", () => {
    for (const n of [0, 1, 255, 65536, 16777215]) {
      expect(unpackUint24LE(packUint24LE(n))).toBe(n);
    }
  });
});

describe("packInt32LE / unpackInt32LE", () => {
  it("round-trips positive and negative values", () => {
    for (const n of [0, 1, -1, 2147483647, -2147483648]) {
      expect(unpackInt32LE(packInt32LE(n))).toBe(n);
    }
  });
});

describe("packAccessRights / unpackAccessRights", () => {
  it("defaults every unspecified right to key index 0 (secure by default)", () => {
    const packed = packAccessRights({});
    expect(unpackAccessRights(packed)).toEqual({ read: 0, write: 0, readWrite: 0, change: 0 });
  });

  it("round-trips explicit values, including 'free' (0xE)", () => {
    const rights = { read: 0xe, write: 3, readWrite: 0xf, change: 1 };
    expect(unpackAccessRights(packAccessRights(rights))).toEqual(rights);
  });

  it("rejects an out-of-range key index", () => {
    expect(() => packAccessRights({ read: 16 })).toThrow();
    expect(() => packAccessRights({ change: -1 })).toThrow();
  });
});

describe("packKeySettings2", () => {
  it("packs AES type bits (0b10) and key count into one byte", () => {
    expect(packKeySettings2(1, "AES")).toBe(0b10_000001);
    expect(packKeySettings2(14, "AES")).toBe(0b10_001110);
  });

  it("rejects an out-of-range key count", () => {
    expect(() => packKeySettings2(0)).toThrow();
    expect(() => packKeySettings2(15)).toThrow();
  });
});
