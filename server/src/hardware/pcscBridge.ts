// Thin wrapper around the `nfc-pcsc` native PC/SC bindings.
//
// This module only runs inside the standalone agent process (see src/agent/agent.ts)
// that a company installs on the machine physically connected to an encoder
// (ACR122U, ACR1252U, PN532-over-PCSC, etc). It is intentionally NOT imported by
// the main API server — the cloud API never touches hardware directly.
//
// `nfc-pcsc` ships native bindings (via pcsclite) and is listed as an optional
// dependency so `npm install` on the API server (which never needs it) can't fail
// because of a missing PC/SC Lite dev package. We therefore require() it lazily
// and surface a clear error if it's missing.

export const KEY_TYPE_A = 0x60;
export const KEY_TYPE_B = 0x61;

export interface DetectedCard {
  uid: string;
  atr?: string;
  standard?: string;
}

type CardEventHandler = (readerName: string, card: DetectedCard) => void;

export class PcscBridge {
  private nfc: any;
  private readers = new Map<string, any>();

  onCardDetected?: CardEventHandler;
  onCardRemoved?: (readerName: string) => void;
  onReaderConnected?: (readerName: string) => void;
  onReaderDisconnected?: (readerName: string) => void;
  onError?: (err: Error) => void;

  start() {
    let NFC: any;
    try {
      ({ NFC } = require("nfc-pcsc"));
    } catch {
      throw new Error(
        "nfc-pcsc is not installed/built on this machine. Install PC/SC Lite " +
          "(`libpcsclite-dev` on Debian/Ubuntu, built-in Smart Card service on Windows/macOS), " +
          "then run `npm install` in server/ again."
      );
    }

    this.nfc = new NFC();

    this.nfc.on("reader", (reader: any) => {
      // We drive read/write ourselves instead of nfc-pcsc's auto-read behaviour.
      reader.autoProcessing = false;
      this.readers.set(reader.reader.name, reader);
      this.onReaderConnected?.(reader.reader.name);

      reader.on("card", (card: any) => {
        this.onCardDetected?.(reader.reader.name, {
          uid: card.uid,
          atr: card.atr ? Buffer.from(card.atr).toString("hex") : undefined,
          standard: card.standard,
        });
      });

      reader.on("card.off", () => this.onCardRemoved?.(reader.reader.name));
      reader.on("error", (err: Error) => this.onError?.(err));
      reader.on("end", () => {
        this.readers.delete(reader.reader.name);
        this.onReaderDisconnected?.(reader.reader.name);
      });
    });

    this.nfc.on("error", (err: Error) => this.onError?.(err));
  }

  listReaderNames(): string[] {
    return Array.from(this.readers.keys());
  }

  private getReader(readerName?: string) {
    if (readerName && this.readers.has(readerName)) return this.readers.get(readerName);
    const first = this.readers.values().next();
    if (first.done) throw new Error("No PC/SC reader is currently connected");
    return first.value;
  }

  // --- MIFARE Classic (1K/4K/Mini) — sector-based, requires key auth -------

  async authenticateMifareClassic(readerName: string | undefined, block: number, key: string, keyType: "A" | "B" = "A") {
    const reader = this.getReader(readerName);
    await reader.authenticate(block, keyType === "A" ? KEY_TYPE_A : KEY_TYPE_B, Buffer.from(key, "hex"));
  }

  async readMifareClassicBlock(readerName: string | undefined, block: number, key: string, keyType: "A" | "B" = "A") {
    const reader = this.getReader(readerName);
    await this.authenticateMifareClassic(readerName, block, key, keyType);
    const data: Buffer = await reader.read(block, 16, 16);
    return data.toString("hex");
  }

  async writeMifareClassicBlock(
    readerName: string | undefined,
    block: number,
    hexData: string,
    key: string,
    keyType: "A" | "B" = "A"
  ) {
    const reader = this.getReader(readerName);
    await this.authenticateMifareClassic(readerName, block, key, keyType);
    await reader.write(block, Buffer.from(hexData, "hex"), 16);
  }

  // --- NTAG21x / MIFARE Ultralight — page-based, generally no auth ---------

  async readNtagPage(readerName: string | undefined, page: number, pageCount = 1) {
    const reader = this.getReader(readerName);
    const data: Buffer = await reader.read(page, pageCount * 4, 4);
    return data.toString("hex");
  }

  async writeNtagPage(readerName: string | undefined, page: number, hexData: string) {
    const reader = this.getReader(readerName);
    await reader.write(page, Buffer.from(hexData, "hex"), 4);
  }

  // --- Generic ------------------------------------------------------------

  async readUid(readerName?: string): Promise<string> {
    // The UID is captured on the `card` event; this just confirms a card is present.
    const reader = this.getReader(readerName);
    if (!reader?.card) throw new Error("No card present on reader");
    return reader.card.uid;
  }
}
