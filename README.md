# RFID / NFC Management System

A multi-tenant platform for managing companies, their RFID/NFC card inventory,
card holders, and physical encoders (readers/writers). Built with
**React + TypeScript**, **Node.js/Express + TypeScript**, **PostgreSQL** (via
Prisma), and **Socket.IO** for live encode/read operations.

## What it does

- **Multi-company (multi-tenant)** — a super admin creates companies; each
  company's users, cards, holders, encoders, templates, and audit logs are
  fully isolated from every other company.
- **Card compatibility** — MIFARE Classic 1K/4K/Mini, MIFARE Ultralight/C,
  MIFARE DESFire EV1/EV2/EV3, MIFARE Plus, NTAG213/215/216, and generic
  125kHz tags (EM4100, HID Prox, T5577), plus generic ISO14443A/15693.
- **Card templates** — define the MIFARE Classic sector/key layout or the
  NTAG/Ultralight page map once, then apply it whenever a card of that type
  is registered.
- **Card lifecycle** — register, assign to a holder, unassign, block/unblock,
  mark lost, retire — every transition is written to an audit log.
- **Access zones** — group cards by the physical areas/systems they should
  unlock (optional access-control layer on top of inventory management).
- **Live Encode console** — a real-time page that shows cards as they're
  tapped on a connected encoder and lets you fire read/write commands at it
  from the browser, over a websocket.
- **Role-based access control** — `SUPER_ADMIN`, `COMPANY_ADMIN`, `MANAGER`,
  `OPERATOR`, `VIEWER`.
- **Encrypted key storage** — MIFARE sector keys are encrypted at rest
  (AES-256-GCM) and are only ever decrypted server-side for an authorized
  encode operation.

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
process (same codebase, `npm run agent`) runs on whatever machine has the
USB/serial encoder plugged in, using `nfc-pcsc` for PC/SC-class readers. It
authenticates to the API with a per-encoder `agentKey` and bridges card
events / commands over its own websocket namespace. This means the
dashboard can be hosted anywhere while encoding still happens locally,
which is how virtually every commercial badge-encoding system is built.

## Repository layout

```
server/           Express + TypeScript API, Prisma schema, websocket layer,
                   PC/SC hardware bridge, standalone agent script
client/            React + TypeScript + Vite + Tailwind dashboard
docker-compose.yml Postgres + API + client for local/dev deployment
```

## Getting started (local development)

### 1. Database

```bash
docker compose up -d postgres
```

or point `DATABASE_URL` at any PostgreSQL 14+ instance.

### 2. Server

```bash
cd server
cp .env.example .env    # fill in JWT secrets + a real 32-byte ENCRYPTION_KEY
npm install
npm run prisma:migrate  # creates tables
npm run prisma:seed     # demo company, users, cards, templates
npm run dev              # http://localhost:4000
```

Generate a proper encryption key:

```bash
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
```

Seeded logins (see console output after `prisma:seed`):

| Role          | Email                              | Password      |
| ------------- | ----------------------------------- | ------------- |
| Super Admin   | admin@rfidmanager.local             | ChangeMe123!  |
| Company Admin | admin@acme-logistics.example        | ChangeMe123!  |
| Operator      | operator@acme-logistics.example     | ChangeMe123!  |

### 3. Client

```bash
cd client
npm install
npm run dev               # http://localhost:5173
```

The Vite dev server proxies `/api` and `/socket.io` to `localhost:4000`.

### 4. Local hardware agent (optional — needs a physical reader)

On the machine with the ACR122U/ACR1252U/PN532/etc plugged in:

```bash
cd server
npm install               # nfc-pcsc is an optional dependency; it needs
                           # PC/SC Lite (Linux: libpcsclite-dev) or the
                           # built-in Smart Card service (Windows/macOS)
AGENT_SERVER_URL=http://localhost:4000 AGENT_KEY=<from Encoders page> npm run agent
```

Register the encoder from the dashboard's **Encoders** page first — it
generates the `agentKey` shown exactly once.

## Full stack

- **Frontend**: React 18, TypeScript, Vite, Tailwind CSS, React Router,
  TanStack Query, Socket.IO client
- **Backend**: Node.js, Express, TypeScript, Prisma ORM, PostgreSQL,
  Socket.IO, Zod validation, JWT auth (access + rotating refresh tokens),
  bcrypt, Helmet, rate limiting
- **Hardware bridge**: `nfc-pcsc` (PC/SC), standard PC/SC pseudo-APDUs for
  MIFARE Classic key authentication, page-level read/write for
  NTAG/Ultralight
- **Infra**: Docker Compose (Postgres + API + Nginx-served client)

## Security notes

- MIFARE sector keys are encrypted at rest with AES-256-GCM; only
  `MANAGER`+ roles can request decrypted keys via `GET /cards/:id/keys`,
  and only for an authorized encode operation.
- Access/refresh tokens are short-lived and rotated on every refresh;
  refresh tokens are stored server-side as salted hashes so they can be
  revoked.
- Every tenant-scoped endpoint enforces company isolation in middleware
  (`assertCompanyAccess` / `scopedCompanyId`), independent of what a client
  sends.
- Change every default in `server/.env.example` before deploying —
  especially `ENCRYPTION_KEY` and the JWT secrets. The example key is all
  zeros purely as a placeholder; generate a real one with the command
  above before storing any card keys with it.
