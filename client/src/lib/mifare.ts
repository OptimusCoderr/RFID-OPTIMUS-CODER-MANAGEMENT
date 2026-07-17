// MIFARE Classic block numbers used throughout this app (template layouts,
// citizen-record blocks, Live Encode's raw command console) are always
// ABSOLUTE across the whole card — e.g. sector 1's first data block is 4,
// not 0. Sector 0's block 0 is the manufacturer block (UID + factory data,
// read-only on genuine cards) and the last block of every sector is its
// trailer (Key A / access bits / Key B) — writing to either would corrupt
// the card. Mirrored server-side in server/src/utils/mifare.ts, which is
// the layer that actually enforces this at write time; these are the same
// checks surfaced here as inline hints while building a template.

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

export function mifareBlockIssue(block: number): string | null {
  if (isMifareManufacturerBlock(block)) {
    return "Block 0 is the card's manufacturer block — factory-locked, can't be written to.";
  }
  if (isMifareTrailerBlock(block)) {
    return "This is a sector trailer block (holds keys/access bits) — writing here would corrupt the sector's own keys.";
  }
  return null;
}

// Suggests the next free absolute block within a sector's writable data-block
// slots (offsets 0-2; offset 3 is always that sector's trailer, and sector
// 0's offset 0 is the card-wide manufacturer block) — used to default the
// "Add block" button to something valid instead of an arbitrary 0/1/2 count.
export function nextFreeMifareBlock(sector: number, existing: { block: number }[]): number {
  const used = new Set(existing.map((b) => b.block));
  for (let offset = 0; offset < 3; offset++) {
    const block = sector * 4 + offset;
    if (used.has(block) || isMifareManufacturerBlock(block)) continue;
    return block;
  }
  return sector * 4;
}
