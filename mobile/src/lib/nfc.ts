import { Platform } from "react-native";
import NfcManager, { NfcTech } from "react-native-nfc-manager";

// Tap-in only needs the tag's UID, never its NDEF content or raw
// sector/file data — unlike the desktop agent (which does full MIFARE/
// DESFire read/write over PC/SC), this never authenticates with a key or
// touches card memory. That keeps it usable against a factory-default card
// with no key management here at all.
//
// Which "tech" to request differs by platform and by tag family, and
// there's no single value that means "any tag, just give me the UID" on
// both OSes:
// - Android exposes the transport layer directly, so NfcA (ISO14443-3,
//   what MIFARE Classic/Ultralight/NTAG present) plus IsoDep (ISO14443-4,
//   what MIFARE DESFire presents) together cover every card type this app
//   already supports elsewhere.
// - iOS's Core NFC only exposes higher-level tag-family handlers, not the
//   raw transport — MifareIOS covers the ISO14443-3 family (Classic/
//   Ultralight/NTAG), Iso7816IOS-style DESFire tags surface through the
//   same reader session as a distinct type but this library folds ISO14443
//   polling under NfcTech.IsoDep on iOS too, per its cross-platform API.
const READ_TECH = Platform.select<NfcTech[]>({
  android: [NfcTech.NfcA, NfcTech.IsoDep],
  ios: [NfcTech.IsoDep, NfcTech.MifareIOS],
  default: [NfcTech.NfcA],
}) as NfcTech[];

let started = false;

async function ensureStarted(): Promise<void> {
  if (started) return;
  await NfcManager.start();
  started = true;
}

export async function isNfcSupported(): Promise<boolean> {
  try {
    await ensureStarted();
    return await NfcManager.isSupported();
  } catch {
    // Expo Go (as opposed to a custom dev-client build) doesn't include
    // this native module at all — treat that the same as "no NFC hardware"
    // rather than crashing the Tap In screen.
    return false;
  }
}

// tag.id is the UID as a hex string from the native layer. Casing varies by
// platform/tag, so normalize to uppercase, no separators — matching the
// format the desktop agent and server already use everywhere else (see
// server/tests/api.test.ts's UID fixtures).
function normalizeUid(id: string | undefined): string | null {
  if (!id) return null;
  return id.replace(/[^0-9a-fA-F]/g, "").toUpperCase() || null;
}

export class NfcCancelledError extends Error {
  constructor() {
    super("NFC scan cancelled");
    this.name = "NfcCancelledError";
  }
}

// Opens a reader session, waits for a single tap, and resolves with that
// tag's UID — or rejects with NfcCancelledError if cancel() below was
// called first (e.g. the user left the Tap In screen mid-scan). Always
// tears the session down afterward, tap or no tap, so a failed/cancelled
// read never leaves the reader silently claimed.
export async function readTagUid(): Promise<string> {
  await ensureStarted();
  let cancelled = false;
  cancel = () => {
    cancelled = true;
    return NfcManager.cancelTechnologyRequest().catch(() => undefined);
  };

  try {
    await NfcManager.requestTechnology(READ_TECH, {
      alertMessage: "Hold your device near the card",
    });
    const tag = await NfcManager.getTag();
    if (cancelled) throw new NfcCancelledError();
    const uid = normalizeUid(tag?.id);
    if (!uid) throw new Error("Could not read a UID from this tag");
    return uid;
  } catch (err) {
    // cancelTechnologyRequest() (called by cancel() above) rejects
    // whichever of requestTechnology/getTag was still pending — surface
    // that as a cancellation rather than whatever native error it happened
    // to reject with.
    if (cancelled) throw new NfcCancelledError();
    throw err;
  } finally {
    await NfcManager.cancelTechnologyRequest().catch(() => undefined);
    cancel = defaultCancel;
  }
}

function defaultCancel() {
  return Promise.resolve();
}
let cancel: () => Promise<void> = defaultCancel;

// Lets the Tap In screen abandon an in-flight scan (navigating away,
// pressing Cancel) without waiting for a tag that may never come.
export function cancelRead(): Promise<void> {
  return cancel();
}
