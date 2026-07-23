// Deliberately NOT jest-expo — every current test target (src/lib/nfcUid.ts)
// has zero react-native/expo imports, so plain ts-jest avoids pulling in
// React Native's Jest environment/native-module mocking machinery for
// something that doesn't need it. If a future test needs to render a
// component or touch a native module, that's the point to add jest-expo
// (or a per-file mock) rather than widening this config speculatively now.
/** @type {import('jest').Config} */
module.exports = {
  preset: "ts-jest",
  testEnvironment: "node",
  testMatch: ["<rootDir>/src/**/*.test.ts"],
};
