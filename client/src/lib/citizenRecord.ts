// Mirrors server/src/utils/crypto.ts's CARD_RECORD_OVERHEAD_BYTES /
// citizenRecordCapacityBytes exactly — the server is the actual source of
// truth and re-validates on write, this is purely so the UI can estimate
// capacity before sending anything.
export const CITIZEN_RECORD_OVERHEAD_BYTES = 16;

export function citizenRecordCapacityBytes(blockCount: number): number {
  return blockCount * 16 - CITIZEN_RECORD_OVERHEAD_BYTES;
}

// Same JSON encoding prepareCitizenWrite (server) uses: `JSON.stringify({ [field]: value })`.
export function citizenRecordPlaintextBytes(fields: Record<string, string>): number {
  return new TextEncoder().encode(JSON.stringify(fields)).length;
}

// A generous per-field value budget for estimating capacity at
// template-authoring time, when actual values (entered later, per card)
// aren't known yet — long enough for a name/date/ID-number-ish value
// without wildly over-allocating blocks.
const ESTIMATED_VALUE_BYTES_PER_FIELD = 24;

// Matches citizenRecordSchema.blocks' max in server/src/validators/template.ts
// — a template with more blocks than this is rejected outright, so the
// estimate must never suggest exceeding it.
export const MAX_CITIZEN_RECORD_BLOCKS = 16;

// How many 16-byte blocks a record with this field set will likely need,
// generously estimated (real capacity is re-checked against actual values
// server-side on every write — see prepareCitizenWrite) and capped at the
// server's hard maximum. Field sets whose names alone are long enough to
// exceed that cap will need short values and/or fewer fields — the live
// bytes-used indicator in CitizenDataPanel catches that at write time.
export function estimateNeededBlocks(fields: string[]): number {
  const emptyValues = Object.fromEntries(fields.map((f) => [f, ""]));
  const structureBytes = citizenRecordPlaintextBytes(emptyValues);
  const valueBudget = fields.length * ESTIMATED_VALUE_BYTES_PER_FIELD;
  const neededBytes = structureBytes + valueBudget;
  const blocks = Math.max(2, Math.ceil((neededBytes + CITIZEN_RECORD_OVERHEAD_BYTES) / 16));
  return Math.min(blocks, MAX_CITIZEN_RECORD_BLOCKS);
}

// Picks free MIFARE Classic data blocks for a citizen record, skipping
// sector 0 (manufacturer/UID sector), sector trailer blocks (every 4th
// block, which hold keys rather than data), and any block already claimed
// by the template's plain labeled blocks or the record's existing block
// list. Purely a starting suggestion for the template author — the result
// is a normal, still-editable sector/block list, not a hidden allocation.
export function pickFreeCitizenBlocks(
  count: number,
  usedBlocks: { sector: number; block: number }[]
): { sector: number; block: number }[] {
  const used = new Set(usedBlocks.map((b) => `${b.sector}:${b.block}`));
  const picked: { sector: number; block: number }[] = [];

  for (let sector = 1; picked.length < count && sector <= 15; sector++) {
    for (let offset = 0; offset < 3 && picked.length < count; offset++) {
      const block = sector * 4 + offset;
      const key = `${sector}:${block}`;
      if (used.has(key)) continue;
      picked.push({ sector, block });
    }
  }

  return picked;
}
