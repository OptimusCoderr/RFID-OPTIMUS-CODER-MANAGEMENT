#pragma once
#include <Arduino.h>

// Every block of card data, key, and UID crossing the wire to/from the
// server is a hex string — same convention as server/src/hardware/
// pcscBridge.ts and the desktop agent. Uppercase, no separators.
namespace Hex {

inline String encode(const uint8_t *data, size_t len) {
  static const char digits[] = "0123456789ABCDEF";
  String out;
  out.reserve(len * 2);
  for (size_t i = 0; i < len; i++) {
    out += digits[(data[i] >> 4) & 0x0F];
    out += digits[data[i] & 0x0F];
  }
  return out;
}

// Returns false (leaving out untouched) if hex isn't exactly outLen*2
// valid hex characters — callers must not act on a partially-decoded buffer.
inline bool decode(const String &hex, uint8_t *out, size_t outLen) {
  if (hex.length() != outLen * 2) return false;
  for (size_t i = 0; i < outLen; i++) {
    char hi = hex[i * 2];
    char lo = hex[i * 2 + 1];
    int8_t hiVal = -1, loVal = -1;
    if (hi >= '0' && hi <= '9') hiVal = hi - '0';
    else if (hi >= 'A' && hi <= 'F') hiVal = hi - 'A' + 10;
    else if (hi >= 'a' && hi <= 'f') hiVal = hi - 'a' + 10;
    if (lo >= '0' && lo <= '9') loVal = lo - '0';
    else if (lo >= 'A' && lo <= 'F') loVal = lo - 'A' + 10;
    else if (lo >= 'a' && lo <= 'f') loVal = lo - 'a' + 10;
    if (hiVal < 0 || loVal < 0) return false;
    out[i] = static_cast<uint8_t>((hiVal << 4) | loVal);
  }
  return true;
}

} // namespace Hex
