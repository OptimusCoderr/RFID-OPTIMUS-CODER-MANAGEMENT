// Pulled out of nfc.ts as a standalone, dependency-free module (no
// react-native / react-native-nfc-manager imports) specifically so it's
// unit-testable under plain Jest without needing the jest-expo preset or
// any native-module mocking — see nfcUid.test.ts.

// tag.id is the UID as a hex string from the native layer. Casing varies by
// platform/tag, so normalize to uppercase, no separators — matching the
// format the desktop agent and server already use everywhere else (see
// server/tests/api.test.ts's UID fixtures).
export function normalizeUid(id: string | undefined): string | null {
  if (!id) return null;
  return id.replace(/[^0-9a-fA-F]/g, "").toUpperCase() || null;
}
