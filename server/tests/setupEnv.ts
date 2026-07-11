// Runs before any test file. Provides safe defaults for env vars the config
// module requires, without clobbering real values a CI job (or a developer's
// shell) may already have exported. DATABASE_URL is deliberately not
// defaulted here — tests/globalSetup.ts owns that (auto-provisioning a local
// database when none is configured) and runs before this file, in the same
// process tree, so its value is already in process.env by the time we get here.
process.env.JWT_ACCESS_SECRET ??= "test-access-secret-please-change-1234567890";
process.env.JWT_REFRESH_SECRET ??= "test-refresh-secret-please-change-1234567890";
process.env.ENCRYPTION_KEY ??= "0".repeat(64);
process.env.CLIENT_ORIGIN ??= "http://localhost:5173";
process.env.NODE_ENV ??= "test";
