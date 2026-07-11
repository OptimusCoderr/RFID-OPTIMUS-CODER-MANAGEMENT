import { execSync } from "child_process";

// A dedicated database so integration tests never touch real dev/prod data.
// Overridable via a real DATABASE_URL from the environment (e.g. in CI).
const TEST_DATABASE_URL = "postgresql://rfid_user:rfid_password@localhost:5432/rfid_management_test?schema=public";

export default async function setup() {
  process.env.DATABASE_URL = process.env.DATABASE_URL ?? TEST_DATABASE_URL;
  execSync("npx prisma migrate deploy", { stdio: "inherit" });
}
