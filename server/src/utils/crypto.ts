import crypto from "crypto";
import { env } from "../config/env.js";

const ALGORITHM = "aes-256-gcm";
const IV_LENGTH = 12;

function getKey(): Buffer {
  const key = Buffer.from(env.encryptionKey, "hex");
  if (key.length !== 32) {
    throw new Error("ENCRYPTION_KEY must decode to exactly 32 bytes (64 hex chars)");
  }
  return key;
}

// Encrypts arbitrary plaintext (e.g. a JSON blob of MIFARE sector keys) for at-rest storage.
// Output format: base64(iv).base64(authTag).base64(ciphertext)
export function encryptSecret(plaintext: string): string {
  const iv = crypto.randomBytes(IV_LENGTH);
  const cipher = crypto.createCipheriv(ALGORITHM, getKey(), iv);
  const ciphertext = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  const authTag = cipher.getAuthTag();
  return [iv.toString("base64"), authTag.toString("base64"), ciphertext.toString("base64")].join(".");
}

export function decryptSecret(payload: string): string {
  const [ivB64, tagB64, dataB64] = payload.split(".");
  if (!ivB64 || !tagB64 || !dataB64) {
    throw new Error("Malformed encrypted payload");
  }
  const decipher = crypto.createDecipheriv(ALGORITHM, getKey(), Buffer.from(ivB64, "base64"));
  decipher.setAuthTag(Buffer.from(tagB64, "base64"));
  const plaintext = Buffer.concat([
    decipher.update(Buffer.from(dataB64, "base64")),
    decipher.final(),
  ]);
  return plaintext.toString("utf8");
}

export function generateAgentKey(): string {
  return crypto.randomBytes(24).toString("hex");
}

// A MIFARE Classic sector key is exactly 6 bytes (Key A or Key B).
export function generateMifareKey(): string {
  return crypto.randomBytes(6).toString("hex");
}

// Encrypts data written directly onto a card's own data blocks (a "citizen
// record" — see cardController.ts) — distinct from encryptSecret, which is
// for at-rest database storage and uses a verbose base64/dot-joined format.
// Every byte here costs a physical 16-byte block, so this uses a compact
// raw-binary layout (nonce || ciphertext || tag, no separators) and a
// shorter-than-usual 8-byte nonce/tag (vs the normal 12/16) to leave more
// room for actual data. A per-card random key (see generateDataKey) and
// per-write random nonce keep an 8-byte nonce's collision risk negligible
// at this scale; an 8-byte tag still gives genuine, if reduced-margin,
// tamper detection — an appropriate trade for a low-volume, offline medium
// this constrained, not a general-purpose recommendation.
const CARD_NONCE_LENGTH = 8;
const CARD_TAG_LENGTH = 8;
export const CARD_RECORD_OVERHEAD_BYTES = CARD_NONCE_LENGTH + CARD_TAG_LENGTH;

export function citizenRecordCapacityBytes(blockCount: number): number {
  return blockCount * 16 - CARD_RECORD_OVERHEAD_BYTES;
}

export function encryptForCard(plaintext: Buffer, keyHex: string): Buffer {
  const key = Buffer.from(keyHex, "hex");
  const nonce = crypto.randomBytes(CARD_NONCE_LENGTH);
  const cipher = crypto.createCipheriv("aes-256-gcm", key, nonce, { authTagLength: CARD_TAG_LENGTH });
  const ciphertext = Buffer.concat([cipher.update(plaintext), cipher.final()]);
  const tag = cipher.getAuthTag();
  return Buffer.concat([nonce, ciphertext, tag]);
}

export function decryptForCard(blob: Buffer, keyHex: string): Buffer {
  const key = Buffer.from(keyHex, "hex");
  const nonce = blob.subarray(0, CARD_NONCE_LENGTH);
  const tag = blob.subarray(blob.length - CARD_TAG_LENGTH);
  const ciphertext = blob.subarray(CARD_NONCE_LENGTH, blob.length - CARD_TAG_LENGTH);
  const decipher = crypto.createDecipheriv("aes-256-gcm", key, nonce, { authTagLength: CARD_TAG_LENGTH });
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(ciphertext), decipher.final()]);
}

// A card-data encryption key is a full AES-256 key — unlike a MIFARE sector
// key, it never needs to leave the server (see prepareCitizenWrite),
// so there's no hardware-imposed size limit on it.
export function generateDataKey(): string {
  return crypto.randomBytes(32).toString("hex");
}
