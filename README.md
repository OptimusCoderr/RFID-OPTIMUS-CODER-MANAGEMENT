# RFID / NFC Management System

A multi-tenant platform for managing companies, their RFID/NFC card inventory,
card holders, and physical encoders (readers/writers). Built with
**React + TypeScript**, **Node.js/Express + TypeScript**, **PostgreSQL** (via
Prisma), and **Socket.IO** for live encode/read operations.

## What it does

- **Multi-company (multi-tenant)** — any business (hotel, office, university,
  etc) can self-register at `/register` and immediately get its own login and
  fully isolated card/holder/encoder/template/audit-log inventory; a super
  admin can also create companies directly. Every other company's data is
  invisible to them.
- **Card compatibility** — MIFARE Classic 1K/4K/Mini, MIFARE Ultralight/C,
  MIFARE DESFire EV1/EV2/EV3, MIFARE Plus, NTAG213/215/216, and generic
  125kHz tags (EM4100, HID Prox, T5577), plus generic ISO14443A/15693.
- **Card templates** — define the MIFARE Classic sector/key layout, the
  NTAG/Ultralight page map, or a MIFARE DESFire application/file partition
  layout once, then apply it whenever a card of that type is registered.
- **MIFARE DESFire partitioning** — real application/file support (not just
  sectors): define isolated applications (e.g. one for building access, a
  separate one for a canteen wallet) each with their own AES key(s) and
  files, and provision/read/write them from Live Encode. See
  [HOW-TO-USE.md](HOW-TO-USE.md#613-mifare-desfire-partitioning-applications--files)
  for what's supported and its limits (AES authentication and Plain
  communication mode only — no legacy DES/3DES, no MAC/Encrypted comms).
- **Card lifecycle** — register, assign to a holder, unassign, block/unblock,
  mark lost, retire — every transition is written to an audit log.
- **Access zones** — group cards by the physical areas/systems they should
  unlock (optional access-control layer on top of inventory management).
- **Card–encoder allocation** — every company can register an unlimited
  number of cards and encoders. By default any card can be used with any
  encoder in the company; optionally, specific cards can be restricted to
  one or more specific encoders, and the live-encode command flow enforces
  that restriction server-side.
- **Live Encode console** — a real-time page that shows cards as they're
  tapped on a connected encoder and lets you fire read/write commands at it
  from the browser, over a websocket.
- **Role-based access control** — `SUPER_ADMIN`, `COMPANY_ADMIN`, `MANAGER`,
  `OPERATOR`, `VIEWER`.
- **Encrypted key storage** — MIFARE sector keys are encrypted at rest
  (AES-256-GCM) and are only ever decrypted server-side for an authorized
  encode operation.
- **In-app notifications** — company admins/managers get live (websocket) and
  in-app alerts when a card is blocked, reported lost, expires soon, or
  auto-expires, and when an encoder drops offline.
- **Card expiry automation** — a daily job (plus one on boot) flags cards
  expiring within 7 days and auto-retires anything already past expiry.
- **Password reset** — self-service forgot/reset password flow; emails send
  over SMTP if configured, otherwise the reset link is logged to the server
  console for local dev.
- **CSV export/import** — export the card inventory or audit log to CSV with
  the current filters applied, or bulk-register cards from a CSV upload.
- **Global quick search** — `⌘K`/`Ctrl+K` command palette to jump straight to
  a card or card holder from anywhere in the app.
- **Dark mode**, a self-service profile page, and a company settings page for
  company admins.
- **Session management** — see every device signed in to your account (with a
  best-effort browser/OS + IP summary) and revoke any of them remotely.
- **Card holder and encoder detail pages** — full history and management for
  an individual holder or encoder, not just the list view.
- **Bulk card actions** — select multiple cards to block/unblock together or
  export just the selection to CSV.

## Architecture

```
┌─────────────┐        HTTPS/REST         ┌──────────────┐        SQL        ┌────────────┐
│   React     │ ────────────────────────► │  Node/Express │ ─────────────────►│ PostgreSQL │
│  (client/)  │ ◄──────────────────────── │   (server/)   │ ◄─────────────────│            │
└─────────────┘      Socket.IO /dashboard └──────┬───────┘                   └────────────┘
                                                   │ Socket.IO /agent
                                                   ▼
                                     ┌───────────────────────────┐
                                     │   Local hardware agent     │   PC/SC (nfc-pcsc)
                                     │  (server/src/agent/agent.ts)│──────────────────►  ACR122U / ACR1252U /
                                     │  runs on the machine with   │                     PN532 / etc, physically
                                     │  the physical encoder       │                     reading MIFARE/NTAG/125kHz
                                     └───────────────────────────┘
```

The cloud API never talks to hardware directly. A small **local agent**
process runs on whatever machine has the USB/serial encoder plugged in,
using `nfc-pcsc` for PC/SC-class readers. It authenticates to the API with a
per-encoder `agentKey` and bridges card events/commands over its own
websocket namespace. This means the dashboard can be hosted anywhere while
encoding still happens locally, which is how virtually every commercial
badge-encoding system is built. Setting that agent up doesn't require this
platform's source code — the dashboard's **Encoders** page has a
**Download agent** button that produces a small, ready-to-run `.zip`
(server URL and key already filled in); see
[HOW-TO-USE.md](HOW-TO-USE.md#8-setting-up-a-physical-encoder) for the full
walkthrough.

## Repository layout

```
server/           Express + TypeScript API, Prisma schema, websocket layer,
                   PC/SC hardware bridge, standalone agent script
client/            React + TypeScript + Vite + Tailwind dashboard
docker-compose.yml Postgres + API + client for local/dev deployment
```

## Getting started (local development)

### 1. Server

```bash
cd server
npm install
npm run prisma:seed     # creates server/.env, provisions a local database, migrates, seeds
npm run dev              # http://localhost:4000
```

That's it — no database setup step. Unless `DATABASE_URL` is already configured
(in `server/.env` or your shell), the tooling automatically:

- creates `server/.env` from `.env.example` with freshly generated secrets
  (JWT signing keys, the card-key encryption key) on first run,
- provisions a local, embedded PostgreSQL instance — no Docker, no system
  Postgres install — with data persisted in `server/.local-db/` across
  restarts,
- runs migrations against it.

This happens on `npm run dev`, `npm run prisma:seed`/`prisma:migrate`/`prisma:studio`,
and `npm test` alike, however they're invoked (including from a debugger or
an IDE's test runner) — see [Running it in VS Code](#running-it-in-vs-code)
below. Point `DATABASE_URL` at a real PostgreSQL 14+ instance instead — e.g.
`docker compose up -d postgres`, a system install, or a managed database — to
skip all of this and use that instead; a configured `DATABASE_URL` is always
respected as-is and nothing local ever gets started.

Seeded logins (see console output after `prisma:seed`):

| Role          | Email                              | Password      |
| ------------- | ----------------------------------- | ------------- |
| Super Admin   | admin@rfidmanager.local             | ChangeMe123!  |
| Company Admin | admin@acme-logistics.example        | ChangeMe123!  |
| Operator      | operator@acme-logistics.example     | ChangeMe123!  |

### 2. Client

```bash
cd client
npm install
npm run dev               # http://localhost:5173
```

The Vite dev server proxies `/api` and `/socket.io` to `localhost:4000`.

### 3. Local hardware agent (optional — needs a physical reader)

Register the encoder from the dashboard's **Encoders** page first, then use
the **Download agent** button that appears — it produces a small `.zip`
with the server URL and a one-time `agentKey` already filled in. On the
machine with the ACR122U/ACR1252U/PN532/etc plugged in:

```bash
unzip rfid-agent-*.zip && cd rfid-agent-*
npm install                # pulls in just the ~3 packages the agent needs,
                            # not this repo's full source/build tooling.
                            # nfc-pcsc is an optional dependency; it needs
                            # PC/SC Lite (Linux: libpcsclite-dev) or the
                            # built-in Smart Card service (Windows/macOS)
npm start
```

Prefer running it from source instead (e.g. you're developing against this
platform)? The download panel's "Advanced" section has the equivalent
`AGENT_SERVER_URL=... AGENT_KEY=... npm run agent` command to run from
`server/` in this repo.

## Running it in VS Code

The repo ships a `.vscode/` folder so this mostly works out of the box:

1. **Open the repo root** in VS Code (not the `server/` or `client/`
   subfolder — the workspace config assumes the root).
2. VS Code will prompt you to install the recommended extensions
   (`.vscode/extensions.json`): Prisma, ESLint, Tailwind CSS IntelliSense,
   DotENV, REST Client, and the Vitest explorer. Accept it.
3. `npm install` in `server/` and `client/` (or use the tasks below).
   There's no `.env` to create by hand and no database to set up first — see
   [Getting started](#getting-started-local-development) above; it's handled
   automatically no matter which of the entry points below you use.
4. Open the **Run and Debug** panel (`Ctrl+Shift+D` / `Cmd+Shift+D`) and pick
   a configuration from `.vscode/launch.json`:
   - **"Server: Debug (tsx)"** — runs the API with breakpoints, auto-restarts
     on file changes. First run provisions the local database automatically.
   - **"Client: Launch Chrome"** — starts the Vite dev server (via its
     `preLaunchTask`) and opens it in a debuggable Chrome instance.
   - **"Full stack: server + client"** — a compound launch that starts both
     at once. This is the fastest way to get the whole app running with
     breakpoints on either side.
   - **"Server: Debug tests (vitest)"** — runs the test suite under the
     debugger; also self-provisions a (separate) local test database.
5. Alternatively, use **Terminal → Run Task** (`.vscode/tasks.json`) for
   non-debug runs: `Server: install`, `Server: migrate`, `Server: seed`,
   `Server: dev`, `Server: test`, `Client: install`, `Client: dev`, or the
   combined `Dev: server + client`.
6. To poke at the API directly without the UI, open **`api-requests.http`**
   at the repo root with the REST Client extension and click "Send Request"
   above each block — it logs in as the seeded company admin, captures the
   token, and chains it into the rest of the calls (list cards, register a
   card, block it, check the notification it generated, etc). Run the
   **"Server: seed"** task first so those credentials exist.
7. Set breakpoints in `server/src/**` or `client/src/**` as usual — both
   debug configs use source maps, so they land on your TypeScript/TSX, not
   compiled output.

## Testing

```bash
cd server
npm test          # unit tests + an integration suite against a real Postgres
```

The integration suite (`server/tests/api.test.ts`) runs the actual Express
app through `supertest` against a dedicated `rfid_management_test` database
(auto-provisioned and migrated by `server/tests/globalSetup.ts` — the same
zero-config local database described above, unless `DATABASE_URL` is already
set) and covers the core happy path — company/user provisioning, card
registration, lifecycle actions, notification generation, and cross-company
RBAC isolation. Unit tests cover the pure-function pieces (encryption
round-trips, JWT signing, CSV escaping, RBAC scoping helpers) with no DB
required. This works the same way whether you run `npm test`, `npx vitest`,
or use an IDE's test runner directly.

CI (`.github/workflows/ci.yml`) runs both on every push/PR: the server job
spins up a Postgres service container and runs typecheck + build + the full
test suite; the client job typechecks and builds the Vite app.

## Full stack

- **Frontend**: React 18, TypeScript, Vite, Tailwind CSS, React Router,
  TanStack Query, Socket.IO client
- **Backend**: Node.js (ESM), Express, TypeScript, Prisma ORM, PostgreSQL,
  Socket.IO, Zod validation, [better-auth](https://better-auth.com) (email/
  password + short-lived bearer JWTs verified statelessly via JWKS), Helmet,
  rate limiting
- **Hardware bridge**: `nfc-pcsc` (PC/SC), standard PC/SC pseudo-APDUs for
  MIFARE Classic key authentication, page-level read/write for
  NTAG/Ultralight
- **Background jobs**: `node-cron` for the daily card-expiry sweep
- **Email**: `nodemailer`, optional — falls back to logging the message to
  the server console when `SMTP_HOST` isn't set (see `server/.env.example`)
- **Infra**: Docker Compose (Postgres + API + Nginx-served client)

## Security notes

- MIFARE sector keys are encrypted at rest with AES-256-GCM; only
  `MANAGER`+ roles can request decrypted keys via `GET /cards/:id/keys`,
  and only for an authorized encode operation.
- Auth is handled by [better-auth](https://better-auth.com): passwords are
  hashed with scrypt, sessions are managed and revocable server-side (see
  Profile → Active sessions), and every app API call / the dashboard
  websocket authenticates with a separate short-lived (15 min) JWT minted
  from that session and verified statelessly via JWKS (no DB round-trip per
  request). This app's own `Role` + `companyId` fields live directly on the
  user record (as better-auth "additionalFields"), so RBAC/company-scoping
  middleware is unaffected by the auth backend.
- Every tenant-scoped endpoint enforces company isolation in middleware
  (`assertCompanyAccess` / `scopedCompanyId`), independent of what a client
  sends.
- The zero-config local dev flow auto-generates real random secrets into
  `server/.env` on first run — but for any shared or production deployment,
  set your own `ENCRYPTION_KEY` and JWT secrets explicitly rather than
  relying on that. The placeholder values in `server/.env.example` are all
  zeros / obviously fake on purpose, precisely so they're never mistaken for
  something safe to deploy with.
