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

import crypto from "crypto";
import { createRequire } from "module";
import {
  buildWrappedApdu,
  buildContinueApdu,
  parseDesfireResponse,
  buildAesAuthStep2,
  finishAesAuth,
  aidToBytes,
  bytesToAid,
  packUint24LE,
  unpackInt32LE,
  packInt32LE,
  packAccessRights,
  packKeySettings2,
  unpackAccessRights,
  type DesfireAccessRights,
} from "./desfireCrypto.js";

export const KEY_TYPE_A = 0x60;
export const KEY_TYPE_B = 0x61;

// nfc-pcsc is a CommonJS package; createRequire lets an ES module load it
// synchronously exactly like the pre-ESM code did (no functional change).
const require = createRequire(import.meta.url);

const DESFIRE_CMD = {
  GET_VERSION: 0x60,
  GET_APPLICATION_IDS: 0x6a,
  SELECT_APPLICATION: 0x5a,
  CREATE_APPLICATION: 0xca,
  DELETE_APPLICATION: 0xda,
  GET_FILE_IDS: 0x6f,
  GET_FILE_SETTINGS: 0xf5,
  CREATE_STD_DATA_FILE: 0xcd,
  CREATE_BACKUP_DATA_FILE: 0xcb,
  CREATE_VALUE_FILE: 0xcc,
  CREATE_LINEAR_RECORD_FILE: 0xc1,
  CREATE_CYCLIC_RECORD_FILE: 0xc0,
  DELETE_FILE: 0xdf,
  READ_DATA: 0xbd,
  WRITE_DATA: 0x3d,
  GET_VALUE: 0x6c,
  CREDIT: 0x0c,
  DEBIT: 0xdc,
  WRITE_RECORD: 0x3b,
  READ_RECORDS: 0xbb,
  COMMIT_TRANSACTION: 0xc7,
  ABORT_TRANSACTION: 0xa7,
  AUTHENTICATE_AES: 0xaa,
  ADDITIONAL_FRAME: 0xaf,
  FORMAT_PICC: 0xfc,
} as const;

export interface DetectedCard {
  uid: string;
  atr?: string;
  standard?: string;
}

type CardEventHandler = (readerName: string, card: DetectedCard) => void;

export class PcscBridge {
  private nfc: any;
  private readers = new Map<string, any>();
  // A DESFire AES session is tied to one physical card's contactless
  // presence — it must never survive a card swap or removal.
  private desfireSession: { keyNo: number } | null = null;

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
          "then run `npm install` again in this agent's folder."
      );
    }

    this.nfc = new NFC();

    this.nfc.on("reader", (reader: any) => {
      // We drive read/write ourselves instead of nfc-pcsc's auto-read behaviour.
      reader.autoProcessing = false;
      this.readers.set(reader.reader.name, reader);
      this.onReaderConnected?.(reader.reader.name);

      reader.on("card", (card: any) => {
        this.desfireSession = null;
        // With autoProcessing off, nfc-pcsc never issues its own Get UID
        // command (it's bundled into the auto-read path we deliberately
        // skip to avoid it auto-selecting an AID on DESFire cards), so
        // card.uid is always undefined here — fetch it ourselves instead.
        this.fetchUid(reader)
          .then((uid) => {
            this.onCardDetected?.(reader.reader.name, {
              uid,
              atr: card.atr ? Buffer.from(card.atr).toString("hex") : undefined,
              standard: card.standard,
            });
          })
          .catch((err) => this.onError?.(err instanceof Error ? err : new Error(String(err))));
      });

      reader.on("card.off", () => {
        this.desfireSession = null;
        this.onCardRemoved?.(reader.reader.name);
      });
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

  // Standard PC/SC "Get Data" pseudo-APDU for the currently presented card's
  // UID — the same command nfc-pcsc's own auto-read path would issue, done
  // manually here since that auto-read path is deliberately disabled (see
  // the `reader.autoProcessing = false` comment in start()).
  private async fetchUid(reader: any): Promise<string> {
    const response = await this.transmit(reader, Buffer.from([0xff, 0xca, 0x00, 0x00, 0x00]), 12);
    const statusCode = response.subarray(-2).readUInt16BE(0);
    if (statusCode !== 0x9000) {
      throw new Error(`Could not read card UID (status 0x${statusCode.toString(16).padStart(4, "0")})`);
    }
    return response.subarray(0, -2).toString("hex");
  }

  async readUid(readerName?: string): Promise<string> {
    const reader = this.getReader(readerName);
    if (!reader?.card) throw new Error("No card present on reader");
    return this.fetchUid(reader);
  }

  // --- MIFARE DESFire (EV1/EV2/EV3) — application/file partitioning -------
  //
  // See desfireCrypto.ts for the scope/limitations of what's implemented
  // (AES authentication, Plain communication mode only).

  private async transmit(reader: any, apdu: Buffer, responseMaxLength: number): Promise<Buffer> {
    return await reader.transmit(apdu, responseMaxLength);
  }

  // Sends one DESFire native command and follows additional-frame (0x91AF)
  // chaining until the full response has been collected.
  private async sendDesfireCommand(
    readerName: string | undefined,
    ins: number,
    data?: Buffer,
    responseMaxLength = 64
  ): Promise<Buffer> {
    const reader = this.getReader(readerName);
    let resp = parseDesfireResponse(await this.transmit(reader, buildWrappedApdu(ins, data), responseMaxLength));
    let all = resp.data;
    while (resp.moreFrames) {
      resp = parseDesfireResponse(await this.transmit(reader, buildContinueApdu(), responseMaxLength));
      all = Buffer.concat([all, resp.data]);
    }
    return all;
  }

  async getDesfireVersion(readerName?: string): Promise<{ hardware: string; software: string; uid: string }> {
    const data = await this.sendDesfireCommand(readerName, DESFIRE_CMD.GET_VERSION, undefined, 64);
    return {
      hardware: data.subarray(0, 7).toString("hex"),
      software: data.subarray(7, 14).toString("hex"),
      uid: data.subarray(14, 21).toString("hex"),
    };
  }

  async listApplications(readerName?: string): Promise<string[]> {
    const data = await this.sendDesfireCommand(readerName, DESFIRE_CMD.GET_APPLICATION_IDS, undefined, 64);
    const aids: string[] = [];
    for (let i = 0; i + 3 <= data.length; i += 3) {
      aids.push(bytesToAid(data.subarray(i, i + 3)));
    }
    return aids;
  }

  async selectApplication(readerName: string | undefined, aid: string): Promise<void> {
    await this.sendDesfireCommand(readerName, DESFIRE_CMD.SELECT_APPLICATION, aidToBytes(aid));
    // A new selection always starts unauthenticated for that application.
    this.desfireSession = null;
  }

  // keySettings1 defaults to a permissive-but-standard "0x0F": app master key
  // changeable, free directory listing, free create/delete-file, config
  // changeable (all gated behind the app's own key auth for anything other
  // than listing). See the DESFire datasheet's KeySettings1 bit table for
  // the raw semantics if you need a different policy.
  async createApplication(readerName: string | undefined, aid: string, keyCount: number, keySettings1 = 0x0f): Promise<void> {
    const data = Buffer.concat([aidToBytes(aid), Buffer.from([keySettings1, packKeySettings2(keyCount, "AES")])]);
    await this.sendDesfireCommand(readerName, DESFIRE_CMD.CREATE_APPLICATION, data);
  }

  async deleteApplication(readerName: string | undefined, aid: string): Promise<void> {
    await this.sendDesfireCommand(readerName, DESFIRE_CMD.DELETE_APPLICATION, aidToBytes(aid));
  }

  async getFileIds(readerName?: string): Promise<number[]> {
    const data = await this.sendDesfireCommand(readerName, DESFIRE_CMD.GET_FILE_IDS);
    return Array.from(data);
  }

  async getFileSettings(readerName: string | undefined, fileId: number) {
    const data = await this.sendDesfireCommand(readerName, DESFIRE_CMD.GET_FILE_SETTINGS, Buffer.from([fileId]));
    return {
      fileType: data[0],
      communicationSettings: data[1],
      accessRights: unpackAccessRights(data.subarray(2, 4)),
      // Type-specific trailing fields (size, value limits, record layout) —
      // left raw since their shape depends on fileType.
      raw: data.subarray(4).toString("hex"),
    };
  }

  // Communication settings byte is always 0x00 (Plain) — the only mode this
  // bridge's read/write implementation speaks.
  private async createDataFile(
    readerName: string | undefined,
    command: number,
    fileId: number,
    sizeBytes: number,
    accessRights?: DesfireAccessRights
  ): Promise<void> {
    const data = Buffer.concat([Buffer.from([fileId, 0x00]), packAccessRights(accessRights), packUint24LE(sizeBytes)]);
    await this.sendDesfireCommand(readerName, command, data);
  }

  async createStdDataFile(readerName: string | undefined, fileId: number, sizeBytes: number, accessRights?: DesfireAccessRights) {
    await this.createDataFile(readerName, DESFIRE_CMD.CREATE_STD_DATA_FILE, fileId, sizeBytes, accessRights);
  }

  async createBackupDataFile(readerName: string | undefined, fileId: number, sizeBytes: number, accessRights?: DesfireAccessRights) {
    await this.createDataFile(readerName, DESFIRE_CMD.CREATE_BACKUP_DATA_FILE, fileId, sizeBytes, accessRights);
  }

  async createValueFile(
    readerName: string | undefined,
    fileId: number,
    limits: { minValue: number; maxValue: number; initialValue: number; limitedCreditEnabled?: boolean },
    accessRights?: DesfireAccessRights
  ): Promise<void> {
    const data = Buffer.concat([
      Buffer.from([fileId, 0x00]),
      packAccessRights(accessRights),
      packInt32LE(limits.minValue),
      packInt32LE(limits.maxValue),
      packInt32LE(limits.initialValue),
      Buffer.from([limits.limitedCreditEnabled ? 0x01 : 0x00]),
    ]);
    await this.sendDesfireCommand(readerName, DESFIRE_CMD.CREATE_VALUE_FILE, data);
  }

  async createRecordFile(
    readerName: string | undefined,
    fileId: number,
    cyclic: boolean,
    recordSize: number,
    maxRecords: number,
    accessRights?: DesfireAccessRights
  ): Promise<void> {
    const data = Buffer.concat([
      Buffer.from([fileId, 0x00]),
      packAccessRights(accessRights),
      packUint24LE(recordSize),
      packUint24LE(maxRecords),
    ]);
    await this.sendDesfireCommand(
      readerName,
      cyclic ? DESFIRE_CMD.CREATE_CYCLIC_RECORD_FILE : DESFIRE_CMD.CREATE_LINEAR_RECORD_FILE,
      data
    );
  }

  async deleteFile(readerName: string | undefined, fileId: number): Promise<void> {
    await this.sendDesfireCommand(readerName, DESFIRE_CMD.DELETE_FILE, Buffer.from([fileId]));
  }

  // AES mutual authentication (native command 0xAA). On success, the
  // currently-selected application is authenticated for the given key index
  // for the remainder of this card's contactless session.
  async authenticateDesfireAes(readerName: string | undefined, keyNo: number, keyHex: string): Promise<void> {
    const reader = this.getReader(readerName);
    const key = Buffer.from(keyHex, "hex");
    if (key.length !== 16) throw new Error("DESFire: AES key must be 16 bytes (32 hex characters)");

    const step1 = parseDesfireResponse(
      await this.transmit(reader, buildWrappedApdu(DESFIRE_CMD.AUTHENTICATE_AES, Buffer.from([keyNo])), 32)
    );
    if (!step1.moreFrames) throw new Error("DESFire: card did not start the authentication handshake as expected");

    const step2 = buildAesAuthStep2(key, step1.data, (n) => crypto.randomBytes(n));
    const step2Resp = parseDesfireResponse(
      await this.transmit(reader, buildWrappedApdu(DESFIRE_CMD.ADDITIONAL_FRAME, step2.commandData), 32)
    );
    finishAesAuth(key, step2.commandData, step2Resp.data, step2.rndA, step2.rndB);

    this.desfireSession = { keyNo };
  }

  isDesfireAuthenticated(): boolean {
    return this.desfireSession !== null;
  }

  async readFileData(readerName: string | undefined, fileId: number, offset = 0, length = 0): Promise<string> {
    const data = Buffer.concat([Buffer.from([fileId]), packUint24LE(offset), packUint24LE(length)]);
    const result = await this.sendDesfireCommand(readerName, DESFIRE_CMD.READ_DATA, data, 128);
    return result.toString("hex");
  }

  // Backup Data / Value / Record files require CommitTransaction to persist
  // a write; Standard Data files apply immediately. Committing unconditionally
  // is safe either way — DESFire treats it as a no-op when nothing is pending.
  private async commitIfPending(readerName?: string): Promise<void> {
    try {
      await this.sendDesfireCommand(readerName, DESFIRE_CMD.COMMIT_TRANSACTION);
    } catch {
      // Nothing pending, or this file type doesn't use transactions — ignore.
    }
  }

  async writeFileData(readerName: string | undefined, fileId: number, hexData: string, offset = 0): Promise<void> {
    const payload = Buffer.from(hexData, "hex");
    const data = Buffer.concat([Buffer.from([fileId]), packUint24LE(offset), packUint24LE(payload.length), payload]);
    await this.sendDesfireCommand(readerName, DESFIRE_CMD.WRITE_DATA, data);
    await this.commitIfPending(readerName);
  }

  async getValue(readerName: string | undefined, fileId: number): Promise<number> {
    const data = await this.sendDesfireCommand(readerName, DESFIRE_CMD.GET_VALUE, Buffer.from([fileId]));
    return unpackInt32LE(data);
  }

  async creditValue(readerName: string | undefined, fileId: number, amount: number): Promise<void> {
    await this.sendDesfireCommand(readerName, DESFIRE_CMD.CREDIT, Buffer.concat([Buffer.from([fileId]), packInt32LE(amount)]));
    await this.commitIfPending(readerName);
  }

  async debitValue(readerName: string | undefined, fileId: number, amount: number): Promise<void> {
    await this.sendDesfireCommand(readerName, DESFIRE_CMD.DEBIT, Buffer.concat([Buffer.from([fileId]), packInt32LE(amount)]));
    await this.commitIfPending(readerName);
  }

  async readRecords(readerName: string | undefined, fileId: number, offset = 0, count = 0): Promise<string> {
    const data = Buffer.concat([Buffer.from([fileId]), packUint24LE(offset), packUint24LE(count)]);
    const result = await this.sendDesfireCommand(readerName, DESFIRE_CMD.READ_RECORDS, data, 256);
    return result.toString("hex");
  }

  async writeRecord(readerName: string | undefined, fileId: number, hexData: string, offset = 0): Promise<void> {
    const payload = Buffer.from(hexData, "hex");
    const data = Buffer.concat([Buffer.from([fileId]), packUint24LE(offset), packUint24LE(payload.length), payload]);
    await this.sendDesfireCommand(readerName, DESFIRE_CMD.WRITE_RECORD, data);
    await this.commitIfPending(readerName);
  }

  async formatDesfirePicc(readerName?: string): Promise<void> {
    await this.sendDesfireCommand(readerName, DESFIRE_CMD.FORMAT_PICC);
    this.desfireSession = null;
  }
}
