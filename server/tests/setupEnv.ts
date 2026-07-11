// Runs before any test file. Provides safe defaults for env vars the config
// module requires, without clobbering real values a CI job (or a developer's
// shell) may already have exported — e.g. a real DATABASE_URL for the
// integration tests.
process.env.DATABASE_URL ??= "postgresql://rfid_user:rfid_password@localhost:5432/rfid_management_test?schema=public";
process.env.JWT_ACCESS_SECRET ??= "test-access-secret-please-change-1234567890";
process.env.JWT_REFRESH_SECRET ??= "test-refresh-secret-please-change-1234567890";
process.env.ENCRYPTION_KEY ??= "0".repeat(64);
process.env.CLIENT_ORIGIN ??= "http://localhost:5173";
process.env.NODE_ENV ??= "test";
