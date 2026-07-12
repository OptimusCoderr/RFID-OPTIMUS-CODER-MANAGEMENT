// Pure, hardware-free building blocks for talking to MIFARE DESFire
// (EV1/EV2/EV3) cards: APDU framing, status codes, and the AES mutual
// authentication crypto. Kept separate from pcscBridge.ts (which needs a
// live PC/SC reader) specifically so this logic can be unit tested without
// physical hardware.
//
// Scope, deliberately: this implements DESFire's "legacy-compatible" AES
// authentication (native command 0xAA), which every EV1/EV2/EV3 card
// supports for backward compatibility, and Plain communication mode for
// file reads/writes (payload sent as-is after authentication, no per-command
// MAC or encryption). It does NOT implement legacy DES/3DES authentication,
// the newer EV2 secure-messaging authentication (AuthenticateEV2First,
// native command 0x71), or DESFire's MAC/Encrypted communication modes —
// all of that is real additional protocol surface beyond what's needed to
// get application/file partitioning working.
import crypto from "crypto";

// --- ISO 7816 wrapping (CLA=0x90) for DESFire native commands over PC/SC ---

export function buildWrappedApdu(ins: number, data: Buffer = Buffer.alloc(0)): Buffer {
  if (data.length > 255) throw new Error("DESFire: single-frame command data must be <= 255 bytes");
  return Buffer.concat([Buffer.from([0x90, ins, 0x00, 0x00, data.length]), data, Buffer.from([0x00])]);
}

// Sent to request the next frame of a multi-frame (chunked) response.
export function buildContinueApdu(): Buffer {
  return Buffer.from([0x90, 0xaf, 0x00, 0x00, 0x00]);
}

export interface DesfireResponse {
  data: Buffer;
  sw1: number;
  sw2: number;
  success: boolean;
  moreFrames: boolean;
}

const STATUS_MESSAGES: Record<number, string> = {
  0x9d: "Permission denied",
  0xae: "Authentication error",
  0x1c: "Illegal command code",
  0x1e: "Integrity error",
  0x40: "No such key",
  0x7e: "Length error",
  0x97: "Crypto error",
  0xa0: "Application not found",
  0xa1: "Application integrity error",
  0xbe: "Boundary error (offset/length out of range)",
  0xc1: "Card integrity error",
  0xca: "Command aborted",
  0xcd: "Card disabled",
  0xce: "Count error (too many applications/files)",
  0xde: "Duplicate error (AID or file already exists)",
  0xee: "EEPROM error",
  0xf0: "File not found",
  0xf1: "File integrity error",
};

export function parseDesfireResponse(resp: Buffer): DesfireResponse {
  if (resp.length < 2) throw new Error("DESFire: malformed response (too short)");
  const sw1 = resp[resp.length - 2];
  const sw2 = resp[resp.length - 1];
  const data = resp.subarray(0, resp.length - 2);

  if (sw1 !== 0x91) {
    throw new Error(`DESFire: unexpected status wrapper (0x${sw1.toString(16)}${sw2.toString(16)})`);
  }
  if (sw2 === 0x00) return { data, sw1, sw2, success: true, moreFrames: false };
  if (sw2 === 0xaf) return { data, sw1, sw2, success: true, moreFrames: true };

  const message = STATUS_MESSAGES[sw2] ?? `unknown status 0x${sw2.toString(16)}`;
  throw new Error(`DESFire command failed: ${message} (0x91${sw2.toString(16).padStart(2, "0")})`);
}

// --- AES mutual authentication (native command 0xAA) ------------------------

export function rotateLeftOneByte(buf: Buffer): Buffer {
  if (buf.length === 0) return buf;
  return Buffer.concat([buf.subarray(1), buf.subarray(0, 1)]);
}

// SessionKey = RndA[0:4] || RndB[0:4] || RndA[12:16] || RndB[12:16]
export function deriveAesSessionKey(rndA: Buffer, rndB: Buffer): Buffer {
  if (rndA.length !== 16 || rndB.length !== 16) {
    throw new Error("DESFire: AES RndA/RndB must each be 16 bytes");
  }
  return Buffer.concat([rndA.subarray(0, 4), rndB.subarray(0, 4), rndA.subarray(12, 16), rndB.subarray(12, 16)]);
}

// DESFire native crypto never pads — callers must only pass whole 16-byte blocks.
export function aesCbcEncryptNoPad(key: Buffer, iv: Buffer, data: Buffer): Buffer {
  if (data.length % 16 !== 0) throw new Error("DESFire: AES data must be a multiple of 16 bytes");
  const cipher = crypto.createCipheriv("aes-128-cbc", key, iv);
  cipher.setAutoPadding(false);
  return Buffer.concat([cipher.update(data), cipher.final()]);
}

export function aesCbcDecryptNoPad(key: Buffer, iv: Buffer, data: Buffer): Buffer {
  if (data.length % 16 !== 0) throw new Error("DESFire: AES data must be a multiple of 16 bytes");
  const decipher = crypto.createDecipheriv("aes-128-cbc", key, iv);
  decipher.setAutoPadding(false);
  return Buffer.concat([decipher.update(data), decipher.final()]);
}

export interface AesAuthStep2 {
  // What to send as the second command's data (encrypted RndA || rotated RndB).
  commandData: Buffer;
  // Needed to verify the card's reply and to derive the session key.
  rndA: Buffer;
  rndB: Buffer;
}

// Given the card's encrypted RndB (from the first AuthenticateAES exchange)
// and the key, produces everything needed to send the second command.
export function buildAesAuthStep2(key: Buffer, encryptedRndB: Buffer, randomBytes: (n: number) => Buffer): AesAuthStep2 {
  const rndB = aesCbcDecryptNoPad(key, Buffer.alloc(16, 0), encryptedRndB);
  const rndA = randomBytes(16);
  const rndBRotated = rotateLeftOneByte(rndB);
  const plaintext = Buffer.concat([rndA, rndBRotated]);
  // IV chaining: the card's ciphertext from step 1 becomes our IV for step 2.
  const commandData = aesCbcEncryptNoPad(key, encryptedRndB, plaintext);
  return { commandData, rndA, rndB };
}

// Verifies the card's step-2 reply (encrypted, rotated RndA) and derives the session key.
export function finishAesAuth(key: Buffer, step2CommandData: Buffer, encryptedRndAReply: Buffer, rndA: Buffer, rndB: Buffer): Buffer {
  // IV chaining continues: IV for this decrypt is the last ciphertext block we sent.
  const iv = step2CommandData.subarray(step2CommandData.length - 16);
  const rndAReply = aesCbcDecryptNoPad(key, iv, encryptedRndAReply);
  const expected = rotateLeftOneByte(rndA);
  if (!rndAReply.equals(expected)) {
    throw new Error("DESFire: authentication failed (card's RndA confirmation didn't match — wrong key?)");
  }
  return deriveAesSessionKey(rndA, rndB);
}

// --- Field packing/unpacking ------------------------------------------------

// DESFire AIDs and most multi-byte length/offset fields are little-endian.
export function aidToBytes(aidHex: string): Buffer {
  if (!/^[0-9a-fA-F]{6}$/.test(aidHex)) throw new Error("DESFire: AID must be 3 bytes of hex");
  const be = Buffer.from(aidHex, "hex");
  return Buffer.from([be[2], be[1], be[0]]);
}

export function bytesToAid(buf: Buffer): string {
  if (buf.length !== 3) throw new Error("DESFire: AID buffer must be 3 bytes");
  return Buffer.from([buf[2], buf[1], buf[0]]).toString("hex").toUpperCase();
}

export function packUint24LE(n: number): Buffer {
  const buf = Buffer.alloc(3);
  buf.writeUIntLE(n, 0, 3);
  return buf;
}

export function unpackUint24LE(buf: Buffer): number {
  return buf.readUIntLE(0, 3);
}

export function packInt32LE(n: number): Buffer {
  const buf = Buffer.alloc(4);
  buf.writeInt32LE(n, 0);
  return buf;
}

export function unpackInt32LE(buf: Buffer): number {
  return buf.readInt32LE(0);
}

export interface DesfireAccessRights {
  read?: number;
  write?: number;
  readWrite?: number;
  change?: number;
}

// 2-byte, little-endian: high byte = (Read<<4)|Write, low byte = (ReadWrite<<4)|Change.
// Secure-by-default: any unspecified right requires the authenticating key (index 0),
// never "free" (0xE) — free access must be opted into explicitly per file.
export function packAccessRights(rights: DesfireAccessRights = {}): Buffer {
  const read = rights.read ?? 0;
  const write = rights.write ?? 0;
  const readWrite = rights.readWrite ?? 0;
  const change = rights.change ?? 0;
  for (const [name, value] of [["read", read], ["write", write], ["readWrite", readWrite], ["change", change]] as const) {
    if (value < 0 || value > 15) throw new Error(`DESFire: access right "${name}" must be a key index 0-15`);
  }
  const highByte = (read << 4) | write;
  const lowByte = (readWrite << 4) | change;
  return Buffer.from([lowByte, highByte]);
}

export function unpackAccessRights(buf: Buffer): Required<DesfireAccessRights> {
  const lowByte = buf[0];
  const highByte = buf[1];
  return {
    read: (highByte >> 4) & 0x0f,
    write: highByte & 0x0f,
    readWrite: (lowByte >> 4) & 0x0f,
    change: lowByte & 0x0f,
  };
}

// KeySettings2 packs key count (low nibble) and key type (bits 6-7): 0=DES/2K3DES, 1=3K3DES, 2=AES.
export function packKeySettings2(keyCount: number, keyType: "AES" = "AES") {
  if (keyCount < 1 || keyCount > 14) throw new Error("DESFire: keyCount must be 1-14");
  const typeCode = keyType === "AES" ? 0b10 : 0b00;
  return (typeCode << 6) | keyCount;
}
