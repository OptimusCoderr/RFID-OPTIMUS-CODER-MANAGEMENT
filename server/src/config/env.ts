import dotenv from "dotenv";

dotenv.config();

function required(name: string, fallback?: string): string {
  const value = process.env[name] ?? fallback;
  if (!value) {
    throw new Error(`Missing required environment variable: ${name}`);
  }
  return value;
}

export const env = {
  nodeEnv: process.env.NODE_ENV ?? "development",
  port: Number(process.env.PORT ?? 4000),
  clientOrigin: process.env.CLIENT_ORIGIN ?? "http://localhost:5173",
  databaseUrl: required("DATABASE_URL"),
  jwt: {
    // Used as better-auth's own signing secret (sessions + JWKS private key
    // encryption) — see src/auth/index.ts.
    accessSecret: required("JWT_ACCESS_SECRET"),
  },
  encryptionKey: required("ENCRYPTION_KEY"),
  appUrl: process.env.APP_URL ?? "http://localhost:5173",
  smtp: {
    host: process.env.SMTP_HOST,
    port: Number(process.env.SMTP_PORT ?? 587),
    user: process.env.SMTP_USER,
    password: process.env.SMTP_PASSWORD,
    from: process.env.SMTP_FROM ?? "RFID Manager <no-reply@rfidmanager.local>",
  },
};
