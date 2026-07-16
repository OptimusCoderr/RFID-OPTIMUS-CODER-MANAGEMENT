// Converts human-readable text to/from the fixed-size hex blocks a MIFARE
// Classic card actually stores (16 bytes each). Used by the Live Encode
// "card data" flow so operators can type a name/ID number instead of hex.

export function textToHex(text: string, byteLength: number): string {
  const bytes = new TextEncoder().encode(text).slice(0, byteLength);
  const padded = new Uint8Array(byteLength);
  padded.set(bytes);
  return Array.from(padded)
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

export function hexToText(hex: string): string {
  const clean = hex.replace(/[^0-9a-fA-F]/g, "");
  const bytes = new Uint8Array(Math.floor(clean.length / 2));
  for (let i = 0; i < bytes.length; i++) {
    bytes[i] = parseInt(clean.substr(i * 2, 2), 16);
  }
  // Text shorter than the block is zero-padded on write — trim it back off on read.
  let end = bytes.length;
  while (end > 0 && bytes[end - 1] === 0) end--;
  return new TextDecoder().decode(bytes.slice(0, end));
}
