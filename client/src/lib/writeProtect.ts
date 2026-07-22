// Every button that a write-protected card should block (generating keys,
// writing/deleting citizen data, etc.) used to hand-write its own version of
// this ternary, drifting into three slightly different wordings. One
// canonical message here, with an optional fallback for buttons that also
// have something to say when the card *isn't* write-protected.
const WRITE_PROTECT_TITLE = "Remove write protection first";

export function writeProtectTitle(writeProtected: boolean, fallback?: string): string | undefined {
  return writeProtected ? WRITE_PROTECT_TITLE : fallback;
}
