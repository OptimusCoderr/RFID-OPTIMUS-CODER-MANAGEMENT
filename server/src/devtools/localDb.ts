// Zero-config local development database.
//
// Unless a real DATABASE_URL is provided (via server/.env or the shell
// environment), the dev/test tooling in this file provisions and reuses a
// local embedded PostgreSQL instance — no Docker, no system Postgres install,
// no manual setup. Data persists across restarts in server/.local-db/.
//
// This module is intentionally kept out of src/ — it's dev/test tooling only
// and its dependencies (embedded-postgres, pg) are devDependencies that must
// never be required by the production build.
import fs from "fs";
import path from "path";
import crypto from "crypto";
import { execSync } from "child_process";
import { fileURLToPath } from "url";
import { Client } from "pg";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SERVER_ROOT = path.join(__dirname, "..", "..");
const DATA_DIR = path.join(SERVER_ROOT, ".local-db");
const HOST = "127.0.0.1";
const PORT = Number(process.env.LOCAL_DB_PORT ?? 55432);
const USER = "rfid_local";
const PASSWORD = "rfid_local";

// Postgres refuses to run its own binaries as root. `createPostgresUser`
// works around that by creating a dedicated system user to run them as
// instead — but doing so requires root/sudo itself (groupadd/useradd), and
// is actively wrong (and will fail with a permissions error) for the common
// case of a regular, non-root developer machine. Only opt into it when we
// really are root (true in most containers/CI, false on a normal desktop).
const IS_ROOT = process.getuid?.() === 0;

function adminUrl(): string {
  return `postgresql://${USER}:${PASSWORD}@${HOST}:${PORT}/postgres`;
}

function localDbUrl(dbName: string): string {
  return `postgresql://${USER}:${PASSWORD}@${HOST}:${PORT}/${dbName}?schema=public`;
}

// True only for URLs matching our own generated pattern (host/port/user) —
// used to tell "a real URL the developer configured" apart from "our own
// previously auto-provisioned URL, persisted into .env, that may or may not
// still be running" without needing a separate marker/flag.
function isOwnLocalUrl(url: string): boolean {
  return url.startsWith(`postgresql://${USER}:${PASSWORD}@${HOST}:${PORT}/`);
}

async function isReachable(): Promise<boolean> {
  const client = new Client({ connectionString: adminUrl(), connectionTimeoutMillis: 1500 });
  try {
    await client.connect();
    await client.end();
    return true;
  } catch {
    return false;
  }
}

// Returns true if the database had to be created (i.e. it's brand new).
async function ensureDatabaseExists(dbName: string): Promise<boolean> {
  const client = new Client({ connectionString: adminUrl() });
  await client.connect();
  try {
    const { rowCount } = await client.query("SELECT 1 FROM pg_database WHERE datname = $1", [dbName]);
    if (rowCount === 0) {
      await client.query(`CREATE DATABASE "${dbName}"`);
      console.log(`[local-db] Created database "${dbName}"`);
      return true;
    }
    return false;
  } finally {
    await client.end();
  }
}

// Tracked so callers (notably tests/globalSetup.ts) can explicitly stop the
// instance we started as part of an orderly teardown, rather than relying on
// the library's own exit-hook — which can leave Node's event loop waiting on
// the child process's I/O for several seconds after a graceful `vitest run`.
let startedInstance: import("embedded-postgres").default | null = null;

export async function stopLocalDatabase(): Promise<void> {
  if (startedInstance) {
    await startedInstance.stop();
    startedInstance = null;
  }
}

function runMigrations(databaseUrl: string) {
  console.log("[local-db] Applying migrations to the fresh database...");
  execSync("npx prisma migrate deploy", {
    cwd: SERVER_ROOT,
    stdio: "inherit",
    env: { ...process.env, DATABASE_URL: databaseUrl },
  });
}

// Starts (or reuses) the embedded PostgreSQL cluster and ensures `dbName`
// exists on it, migrating it if it was just created. Never touches a
// user-provided DATABASE_URL — callers are expected to check for one first.
export async function ensureLocalDatabase(dbName: string): Promise<string> {
  if (!(await isReachable())) {
    console.log(`[local-db] Starting embedded local PostgreSQL (data: ${DATA_DIR})`);

    const { default: EmbeddedPostgres } = await import("embedded-postgres");
    const pg = new EmbeddedPostgres({
      databaseDir: DATA_DIR,
      user: USER,
      password: PASSWORD,
      port: PORT,
      persistent: true,
      createPostgresUser: IS_ROOT,
    });

    const alreadyInitialised = fs.existsSync(path.join(DATA_DIR, "PG_VERSION"));
    if (!alreadyInitialised) {
      await pg.initialise();
    }

    try {
      await pg.start();
      startedInstance = pg;
    } catch (err) {
      // Most likely another terminal/process won the race and started it first.
      if (!(await isReachable())) throw err;
    }
  }

  const url = localDbUrl(dbName);
  const justCreated = await ensureDatabaseExists(dbName);
  if (justCreated) runMigrations(url);

  console.log(`[local-db] Ready at ${HOST}:${PORT} (database "${dbName}")`);
  return url;
}

function setEnvValue(envPath: string, key: string, value: string) {
  const content = fs.readFileSync(envPath, "utf8");
  const line = `${key}="${value}"`;
  const pattern = new RegExp(`^#?\\s*${key}=.*$`, "m");
  const next = pattern.test(content) ? content.replace(pattern, line) : `${content.trimEnd()}\n${line}\n`;
  fs.writeFileSync(envPath, next);
}

function ensureEnvFile(): string {
  const envPath = path.join(SERVER_ROOT, ".env");
  if (fs.existsSync(envPath)) return envPath;

  const examplePath = path.join(SERVER_ROOT, ".env.example");
  let content = fs.readFileSync(examplePath, "utf8");
  const randomHex = (bytes: number) => crypto.randomBytes(bytes).toString("hex");

  content = content
    .replace(/^DATABASE_URL=.*$/m, "# DATABASE_URL left unset on purpose — a local database is created automatically.")
    .replace(/^JWT_ACCESS_SECRET=.*$/m, `JWT_ACCESS_SECRET="${randomHex(32)}"`)
    .replace(/^JWT_REFRESH_SECRET=.*$/m, `JWT_REFRESH_SECRET="${randomHex(32)}"`)
    .replace(/^ENCRYPTION_KEY=.*$/m, `ENCRYPTION_KEY="${randomHex(32)}"`);

  fs.writeFileSync(envPath, content);
  console.log("[local-db] Created server/.env with freshly generated secrets for local development");
  return envPath;
}

// Full zero-config bootstrap: creates server/.env on first run (with random
// secrets), then provisions and persists a local database URL into it unless
// one is already present. Idempotent — safe to call on every invocation.
export async function ensureDevEnvironment(): Promise<void> {
  const envPath = ensureEnvFile();

  // Load without clobbering anything already set in the real process env.
  const dotenv = await import("dotenv");
  dotenv.config({ path: envPath });

  const current = process.env.DATABASE_URL;
  if (current && !isOwnLocalUrl(current)) {
    console.log("[local-db] Using DATABASE_URL from server/.env");
    return;
  }

  // Either nothing is configured yet, or it's our own previously-provisioned
  // local URL, persisted from an earlier run, that may not still be running
  // (e.g. after a reboot) — ensureLocalDatabase verifies and restarts it.
  const url = await ensureLocalDatabase("rfid_management");
  if (url !== current) setEnvValue(envPath, "DATABASE_URL", url);
  process.env.DATABASE_URL = url;
}
