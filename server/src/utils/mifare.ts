// MIFARE Classic block-number helpers. Block numbers throughout this app
// (template layouts, citizen-record blocks, WRITE_BLOCK command args) are
// always ABSOLUTE across the whole card — e.g. sector 1's first data block
// is 4, not 0. Sector 0's block 0 is the manufacturer block (UID + factory
// data, read-only on genuine cards) and the last block of every sector is
// its trailer (Key A / access bits / Key B) — writing to either corrupts
// the card. This is the real enforcement layer (validators/template.ts at
// template-authoring time, websocket/index.ts at write time); mirrored
// client-side in client/src/lib/mifare.ts purely as an inline UI hint.

export function isMifareManufacturerBlock(block: number): boolean {
  return block === 0;
}

// True for every sector trailer: block % 4 === 3 for MIFARE Classic
// Mini/1K and 4K's first 32 sectors (blocks 0-127), and every 16th block
// from 128 on for 4K's extended sectors 32-39 (16 blocks/sector instead of 4).
export function isMifareTrailerBlock(block: number): boolean {
  if (block < 128) return block % 4 === 3;
  return (block - 128) % 16 === 15;
}

export function isProtectedMifareBlock(block: number): boolean {
  return isMifareManufacturerBlock(block) || isMifareTrailerBlock(block);
}
