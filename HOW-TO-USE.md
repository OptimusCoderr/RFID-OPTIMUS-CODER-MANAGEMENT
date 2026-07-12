# How to Use the RFID / NFC Management System

A complete, practical guide to running this system — from getting it installed,
to registering your business, to issuing your first card. It's written for
three audiences at once: the person setting up the server, the company admin
configuring their organization, and the day-to-day staff (front desk,
security, registrar's office) who scan and write cards.

If you just want a fast path to "it's running," see the top-level
[README.md](README.md). This document goes deeper on *how to actually use
it* once it's up.

---

## Table of contents

1. [What this system is](#1-what-this-system-is)
2. [Core concepts](#2-core-concepts)
3. [Getting it running](#3-getting-it-running)
4. [Getting your company set up](#4-getting-your-company-set-up)
5. [Roles and permissions](#5-roles-and-permissions)
6. [Everyday workflows](#6-everyday-workflows)
   - [6.1 Managing your team](#61-managing-your-team-users)
   - [6.2 Card holders](#62-card-holders)
   - [6.3 Card templates](#63-card-templates)
   - [6.4 Registering and encoding cards](#64-registering-and-encoding-cards)
   - [6.5 Card lifecycle](#65-card-lifecycle-block-unblock-lost-retire)
   - [6.6 Restricting a card to specific encoders](#66-restricting-a-card-to-specific-encoders)
   - [6.7 Access zones](#67-access-zones)
   - [6.8 Bulk actions and CSV import/export](#68-bulk-actions-and-csv-importexport)
   - [6.9 Notifications](#69-notifications)
   - [6.10 Dashboard and audit logs](#610-dashboard-and-audit-logs)
   - [6.11 Your profile and active sessions](#611-your-profile-and-active-sessions)
   - [6.12 Company settings](#612-company-settings)
   - [6.13 MIFARE DESFire partitioning (applications & files)](#613-mifare-desfire-partitioning-applications--files)
7. [Worked examples by industry](#7-worked-examples-by-industry)
   - [7.1 Hotel](#71-hotel)
   - [7.2 Business / office](#72-business--office)
   - [7.3 University](#73-university)
8. [Setting up a physical encoder](#8-setting-up-a-physical-encoder)
9. [Configuration reference](#9-configuration-reference)
10. [Deployment](#10-deployment)
11. [Security notes](#11-security-notes)
12. [Troubleshooting](#12-troubleshooting)
13. [API quick reference](#13-api-quick-reference)

---

## 1. What this system is

This is a **multi-tenant** platform: many unrelated businesses (a hotel, a
university, a logistics company) can each use the same running system while
seeing nothing of each other's data. Every company gets:

- Its own users and roles (front desk staff, IT admins, security managers…)
- Its own inventory of physical cards/tags (MIFARE, NTAG, 125kHz, etc.)
- Its own encoders (the USB/serial readers that actually write the cards)
- Its own card holders (guests, employees, students — whoever the cards belong to)
- Its own audit trail of every read/write/block/assign action

Nothing about one company (its cards, its users, its logs) is ever visible to
another company. A `SUPER_ADMIN` role exists above all companies for
platform operators, but day-to-day usage never needs it.

## 2. Core concepts

| Concept | What it is |
|---|---|
| **Company** | A tenant. A hotel, a business, a university department — anything issuing its own cards. |
| **User** | A person who logs into the dashboard. Belongs to exactly one company (except `SUPER_ADMIN`). |
| **Card holder** | The person a card is *for* — a guest, employee, or student. Not a login; just a record (name, department/room, employee/student ID, photo). |
| **Card** | A physical RFID/NFC tag: a UID, a type (MIFARE Classic 1K, NTAG213, 125kHz Prox, etc.), a status, optionally assigned to a holder. |
| **Card template** | A reusable memory layout (which MIFARE sectors/keys, which NTAG pages, or which DESFire applications/files, mean what) applied when a card of that type is registered. |
| **DESFire application / file** | Real card **partitioning**, specific to MIFARE DESFire: the card's memory is divided into independent, separately-keyed applications (e.g. one for building access, one for a canteen wallet), each containing its own files. Distinct from — and more capable than — MIFARE Classic's sector/key layout. See [6.13](#613-mifare-desfire-partitioning-applications--files). |
| **Encoder** | The physical reader/writer device (ACR122U, PN532, OMNIKEY, etc.) that talks to cards. Each encoder authenticates to the API with its own `agentKey`. |
| **Local agent** | A small process (`npm run agent`) that runs on the machine physically connected to an encoder and bridges it to the cloud dashboard over a websocket. |
| **Access zone** | An optional grouping of cards by the physical area/system they unlock (e.g. "Pool", "Server Room", "Loading Dock"). |
| **Card–encoder allocation** | An optional restriction: by default any card works with any encoder in the company; you can restrict specific cards to specific encoder(s) (e.g. a master key that must only ever be written at the security desk). |
| **Operation log** | An immutable audit entry for every register/assign/block/encode/etc action, who did it, and when. |

## 3. Getting it running

### Option A — local development

```bash
cd server
npm install
npm run prisma:seed     # creates server/.env, provisions a local database, migrates, seeds demo data
npm run dev              # http://localhost:4000
```

```bash
cd client
npm install
npm run dev               # http://localhost:5173
```

No database setup step is required — unless a real `DATABASE_URL` is already
configured, the server automatically provisions and reuses a local embedded
PostgreSQL instance (no Docker, no system install) the first time you run
anything. See the [README](README.md#getting-started-local-development) for
full details, and [Running it in VS Code](README.md#running-it-in-vs-code)
if you're working from the editor.

Seeded demo logins (only present after `npm run prisma:seed`):

| Role | Email | Password |
|---|---|---|
| Super Admin | `admin@rfidmanager.local` | `ChangeMe123!` |
| Company Admin | `admin@acme-logistics.example` | `ChangeMe123!` |
| Operator | `operator@acme-logistics.example` | `ChangeMe123!` |

### Option B — Docker Compose

```bash
ENCRYPTION_KEY=$(node -e "console.log(require('crypto').randomBytes(32).toString('hex'))") \
  docker compose up -d --build
```

This starts Postgres, the API (port 4000), and the client (port 5173) as
three containers. See [Deployment](#10-deployment) below for production
considerations.

## 4. Getting your company set up

There are two ways a company comes into existence:

### 4.1 Self-service registration (the normal path)

Any business — a hotel, an office, a university — can register itself
without anyone's help:

1. Go to `/register` on the running client (e.g.
   `http://localhost:5173/register`).
2. Fill in:
   - **Company / organization name** — e.g. "Sunrise Boutique Hotel"
   - **URL slug** — auto-filled from the name, lowercase/hyphenated,
     must be unique platform-wide
   - **Company contact email** (optional)
   - **Your full name, email, and password** — this becomes your personal
     login
3. Submit. You're immediately signed in as that company's **`COMPANY_ADMIN`**
   — the highest role within your own company — with an empty inventory
   ready to fill in.

There is nothing further to approve; registration is instant and
self-contained. If the slug or email is already taken you'll get a clear
error asking you to pick another.

### 4.2 Platform-admin-created companies (alternative path)

A `SUPER_ADMIN` (the platform operator) can also create a company directly
from the **Companies** page and then create its first `COMPANY_ADMIN` user
from the **Users** page. This is mainly useful for the platform operator
onboarding a customer on their behalf, or for demo/seed data. Most
businesses should just use self-registration.

### 4.3 After you have a company

Once you're signed in as `COMPANY_ADMIN`, a sensible setup order is:

1. **Company settings** — fill in address/logo/contact details.
2. **Users** — invite your team (front desk, managers, security) with
   appropriate roles.
3. **Card templates** — define the memory layout for whichever card
   types you'll issue.
4. **Encoders** — register each physical reader/writer and run the local
   agent next to it.
5. **Card holders** — optional, but useful if you'll assign cards to
   named people (guests, employees, students) rather than just tracking
   raw inventory.
6. Start registering and writing cards from **Live Encode**.

## 5. Roles and permissions

Five roles exist, from broadest to narrowest:

| Role | Scope | Can do |
|---|---|---|
| `SUPER_ADMIN` | Whole platform | Everything, across every company. Only needed for platform operation. |
| `COMPANY_ADMIN` | Own company | Everything within their company: manage users, company settings, cards, holders, encoders, templates, zones. |
| `MANAGER` | Own company | Manage cards/holders/encoders/templates/zones, run card-encoder allocation, block/retire cards. Cannot manage users or company settings. |
| `OPERATOR` | Own company | Day-to-day work: register cards, assign/unassign holders, mark a card lost, run encode operations. Cannot delete/retire, manage encoders, or manage users. |
| `VIEWER` | Own company | Read-only access to everything in their company. |

The exact gating per action:

| Action | Roles allowed |
|---|---|
| Create/delete a company | `SUPER_ADMIN` |
| Update company settings | `SUPER_ADMIN`, `COMPANY_ADMIN` |
| Create/update/delete users | `SUPER_ADMIN`, `COMPANY_ADMIN` |
| Create/update/rotate-key/delete encoders | `SUPER_ADMIN`, `COMPANY_ADMIN` |
| Create/update/delete card templates | `SUPER_ADMIN`, `COMPANY_ADMIN`, `MANAGER` |
| Create/update card holders | `SUPER_ADMIN`, `COMPANY_ADMIN`, `MANAGER`, `OPERATOR` |
| Delete card holders | `SUPER_ADMIN`, `COMPANY_ADMIN`, `MANAGER` |
| Register/assign/unassign/mark-lost a card | `SUPER_ADMIN`, `COMPANY_ADMIN`, `MANAGER`, `OPERATOR` |
| Block/unblock/retire a card, delete a card | `SUPER_ADMIN`, `COMPANY_ADMIN`, `MANAGER` |
| Grant/revoke a card's encoder allocation | `SUPER_ADMIN`, `COMPANY_ADMIN`, `MANAGER` |
| Manage access zones | `SUPER_ADMIN`, `COMPANY_ADMIN`, `MANAGER` |
| View cards/holders/encoders/logs/dashboard | Everyone signed in (scoped to their own company) |
| Decrypt/retrieve a card's stored sector keys | `SUPER_ADMIN`, `COMPANY_ADMIN`, `MANAGER` |

Whatever your role, you only ever see and act on **your own company's**
data — this is enforced on the server for every request, not just hidden in
the UI, so even a crafted API call can't reach across companies (unless
you're `SUPER_ADMIN`).

## 6. Everyday workflows

### 6.1 Managing your team (Users)

`COMPANY_ADMIN`s manage their team from **Users**:

1. Click **New user**.
2. Enter their name, email, a temporary password, and pick a role
   (`COMPANY_ADMIN`, `MANAGER`, `OPERATOR`, or `VIEWER`).
3. They can sign in immediately with that email/password, or you can send
   them to `/forgot-password` to set their own.
4. Deactivate (rather than delete) a user who leaves — this immediately
   revokes their access without losing the audit trail of actions they
   performed while employed.

### 6.2 Card holders

Card holders represent *who a card belongs to* — a hotel guest, an
employee, a student. From **Card Holders**:

1. Click **New holder**, enter name and whatever's relevant (department,
   employee/student ID, phone, email, photo).
2. Open a holder's detail page to see every card currently or previously
   assigned to them, and their full history.
3. Card holders are optional — you can track cards purely as inventory
   (e.g. blank visitor tags) without ever assigning a holder.

### 6.3 Card templates

Templates capture *what a card's memory means* so you don't have to
re-decide it every time you register one:

1. From **Templates**, click **New template**.
2. Pick the card type. For MIFARE Classic types you define per-sector
   Key A/Key B; for NTAG/Ultralight types you define page ranges and their
   purpose (e.g. pages 4–6 = NDEF message).
3. Optionally mark it **default for this card type** — it'll be
   pre-selected whenever you register a new card of that type.
4. Templates are informational/configuration metadata; the actual
   encode/write happens from the **Live Encode** page using whichever
   template you attach to a card.

### 6.4 Registering and encoding cards

There are three ways to get a card into the system:

**A. Manual registration** (no encoder needed) — **Cards → Register card**:
enter the UID by hand (e.g. printed on the card or read with any app),
pick the card type and optional template/label/notes.

**B. Live, at an encoder** — **Live Encode** page:
1. Plug in the encoder and start its local agent (see
   [Setting up a physical encoder](#8-setting-up-a-physical-encoder)).
2. On the Live Encode page, select that encoder from the dropdown — its
   live status (Online/Offline/Busy) shows immediately.
3. Tap a card on the reader. If it's unknown, a quick "register it" panel
   appears — pick the card type and optional label, and register.
4. If it's already known, its status/holder shows immediately with a link
   to its detail page.
5. Use the **Send command** panel to fire read/write/format/lock/key-change
   operations at whatever card is currently on the reader — e.g. write a
   MIFARE Classic block with a given key, or write an NTAG page. Every
   command and its result appears in the live event log at the bottom, and
   is written to the audit trail.

**C. Bulk import** — see [6.8](#68-bulk-actions-and-csv-importexport).

### 6.5 Card lifecycle (block, unblock, lost, retire)

From a card's detail page (or in bulk from the Cards list):

- **Assign / Unassign** — attach or detach a card holder.
- **Block / Unblock** — temporarily disable a card (lost-then-found,
  suspected compromise, employee on leave). A blocked card cannot be used
  to encode/write until unblocked; a notification goes to company admins.
- **Mark lost** — like Block, but semantically "this card is gone" and
  notifies admins as `CARD_LOST`.
- **Retire** — permanently end a card's life (replaced, decommissioned).
  Retired cards stay in the audit trail but are excluded from active use.
- The system also auto-expires cards past their `expiresAt` date via a
  daily background job, and warns admins 7 days ahead of expiry.

### 6.6 Restricting a card to specific encoders

By default, **any card can be used with any encoder in your company** — no
setup needed. If you need tighter control (e.g. a grand-master key that
should only ever be written at the security office, never at a guest-facing
kiosk), you can opt a specific card into a restriction:

1. Open the card's detail page.
2. Under **Allowed encoders**, pick an encoder from the dropdown and click
   **Add**. The card is now restricted — it can only be used with the
   encoder(s) you've explicitly allowed.
3. Add more encoders the same way, or remove one by clicking the **×** on
   its badge. Removing the *last* allocation makes the card unrestricted
   again.
4. This is enforced **server-side**, not just hidden in the UI: if someone
   tries to run a command against a restricted card from a non-allowed
   encoder (via Live Encode or directly over the websocket API), the
   command is rejected with `"This card is not allocated to this encoder"`.
   The Live Encode page also proactively warns and disables the send button
   when the currently selected encoder isn't on a detected card's allowlist.

This is opt-in per card — you never have to configure it, and a company with
zero allocations behaves exactly as if the feature didn't exist.

### 6.7 Access zones

Access zones are a lightweight way to model "what does this card open,"
layered on top of the inventory system (this platform manages the *cards*,
not physical door hardware itself):

1. **Zones → New zone** — e.g. "Pool Deck", "Server Room", "3rd Floor".
2. **Grant access to a card** by UID from the zone's card.
3. A card's detail page lists every zone it currently has access to.

### 6.8 Bulk actions and CSV import/export

From the **Cards** page:

- **Export CSV** — exports the currently filtered list (respects your
  status/type/search filters) as a CSV download.
- **Import CSV** — upload a CSV with `uid, cardType, label` columns
  (header row required) to bulk-register up to 500 cards at once. You'll
  see a preview before committing, and a per-row result (created / skipped
  as duplicate / error) afterward.
- **Select rows** (checkboxes) to block/unblock several cards at once, or
  export just the selection.

### 6.9 Notifications

Company admins and managers automatically get in-app notifications
(bell icon, top right) — delivered live over websocket and persisted for
later — when:

- A card is blocked or reported lost
- A card is expiring within 7 days, or auto-expired
- An encoder goes offline

Click a notification to jump straight to the relevant card/encoder; mark
individual ones read or **mark all as read**.

### 6.10 Dashboard and audit logs

- **Dashboard** — at-a-glance counts of cards by status/type, encoders by
  status, total holders, and recent activity.
- **Logs** — the full, filterable audit trail (by card, encoder, user,
  operation type, date range), exportable to CSV. Every register, assign,
  block, encode command, and more is recorded here with who did it and
  when — this is your compliance/audit record.

### 6.11 Your profile and active sessions

From **Profile**:

- Update your name or change your password.
- **Sessions** — see every device currently signed in as you (best-effort
  browser/OS and IP), and revoke any of them remotely (e.g. a lost laptop).
- Forgot your password? Use **Forgot password?** on the login screen —
  a reset link is emailed (or logged to the server console if SMTP isn't
  configured, for local dev) and expires after 1 hour. Resetting revokes
  every other active session as a precaution.

### 6.12 Company settings

`COMPANY_ADMIN`s can update their company's name, contact details, address,
and logo from **Company Settings**. `SUPER_ADMIN`s manage every company from
the **Companies** page, including deactivating one without deleting its data.

### 6.13 MIFARE DESFire partitioning (applications & files)

MIFARE Classic's "sectors" and NTAG's "pages" are simple memory layouts —
useful, but not real isolation. **MIFARE DESFire** (EV1/EV2/EV3) supports
genuine **partitioning**: the card is divided into independent
**applications**, each identified by a 3-byte AID and protected by its own
key(s), and each application holds its own **files**. This is what lets one
physical card safely serve multiple purposes at once — e.g. a university ID
with a building-access application the security office controls, and a
completely separate library-loans application the library controls, neither
able to read or write the other's data.

**1. Design the partition layout in a template.** From **Templates → New
template**, pick a DESFire card type (`MIFARE_DESFIRE_EV1/EV2/EV3`) and use
the **Applications** editor:
- **Add application** — set its AID (3 bytes hex, e.g. `F00001`), a name,
  and how many AES keys it has (1–14; typically one key per role that needs
  distinct access, e.g. a "read" key and a separate "admin" key).
- **Add file** within an application — pick a file type:
  - **Standard/Backup Data** — a fixed-size byte blob (e.g. an employee ID, a
    photo hash, an access-level flag).
  - **Value** — a signed integer balance with credit/debit semantics (e.g. a
    prepaid canteen balance).
  - **Linear/Cyclic Record** — an append-only (or ring-buffer) log of
    fixed-size records (e.g. a tap-in/tap-out access log).

**2. Provision a physical card from Live Encode.** With the card on the
reader, use the **Send command** dropdown:
1. **DESFire: create application** (admin-only, one time per AID) — creates
   the partition you designed in the template.
2. **DESFire: select application** — every subsequent command operates on
   whichever application is currently selected.
3. **DESFire: create file** (admin-only) — creates each file inside the
   selected application.
4. **DESFire: authenticate (AES)** — proves possession of that application's
   key before any access-restricted read/write will succeed.
5. **DESFire: read file** / **write file** — read or write the file's data
   once authenticated.
6. **DESFire: delete file** / **delete application** / **format card** —
   admin-only, destructive, and asks for confirmation before sending.

Every one of these is a real native DESFire command sent to the physical
card over the local agent — this isn't simulated. **Create application**,
**delete application**, **delete file**, and **format card** additionally
require `MANAGER` role or above (unlike the routine read/write commands,
which any signed-in company member can run) since they can destroy another
card's partition or wipe a card outright.

**Known limitations** — read these before relying on this for anything
security-critical:

- **Only AES authentication is implemented** (DESFire's modern,
  EV1/EV2/EV3-standard method). Legacy DES/2K3DES/3K3DES key authentication
  is not supported — application keys must be AES.
- **Only Plain communication mode is implemented** for file reads/writes —
  the payload travels as-is after authentication, with no per-command MAC or
  encryption. This is a normal, supported DESFire mode (and the
  authentication step itself is real, correctly-implemented AES mutual
  authentication with proper session-key derivation), but it is not
  DESFire's maximum-security mode. Don't rely on this alone for
  payment-grade or otherwise highly sensitive data.
- **Access rights default to "authenticating key required" for everything**
  (read, write, read&write, and change-access all default to key index 0)
  unless you explicitly mark a file's right as "free" — this platform
  intentionally does not default any file to public/free access.
- This integration has been built and unit-tested against the DESFire
  protocol specification (APDU framing, status codes, and the full AES
  mutual-authentication handshake all have automated tests — see
  `server/src/hardware/desfireCrypto.test.ts`), but has not been verified
  against physical DESFire hardware. Test thoroughly with your actual cards
  and reader before any production rollout.

## 7. Worked examples by industry

### 7.1 Hotel

1. Register at `/register` as "Sunrise Boutique Hotel."
2. Create a template "Room key (MIFARE Classic 1K)" with your door-lock
   vendor's sector layout.
3. Register your front-desk encoder ("Front Desk ACR122U"), copy its agent
   key, and run the local agent on the front-desk PC.
4. Create card holders as guests check in (name + room number in
   "department"), or skip holders entirely and just track "Room 204 key"
   as a label.
5. At check-in: tap a blank card on **Live Encode**, register it with the
   room-key template, write the room code via **Send command**, and hand it
   over.
6. At check-out: **Block** the card (or **Retire** if it won't be reused).
7. Lost a key mid-stay? **Mark lost**, then register/write a replacement.

### 7.2 Business / office

1. Register your company, then invite an IT admin (`MANAGER`) and security
   desk staff (`OPERATOR`) from **Users**.
2. Create card holders for every employee (name, department, employee ID).
3. Define a "Employee Badge" template with your access-control sector
   layout.
4. Set up **Access zones** per restricted area ("Server Room", "Executive
   Floor") and grant access per badge as needed.
5. Register each employee's badge, assign it to their holder record.
6. Offboarding: **Unassign** the holder and **Retire** the badge.
7. For a sensitive area's master override card, use
   [6.6](#66-restricting-a-card-to-specific-encoders) to lock it to only the
   security-desk encoder.

### 7.3 University

1. Register your university (or per-department company if you want fully
   separate inventories).
2. Create templates for "Student ID (MIFARE DESFire EV2)" and
   "Visitor Tag (NTAG213)."
3. Register encoders at the registrar's office and library front desk.
4. Bulk-import a semester's new students via CSV (UID pre-printed by your
   card vendor, or scan-and-register one by one at orientation).
5. Assign each card to a student card-holder record (name, student ID,
   department).
6. Use **Access zones** for dorms, labs, and libraries.
7. Lost card reported: **Mark lost**, issue a replacement, keep the old
   UID's history intact in the audit log for that student.

## 8. Setting up a physical encoder

The cloud dashboard never talks to hardware directly — a small local agent
process bridges a physical reader to your dashboard:

1. From **Encoders**, click **Register encoder**, fill in name/type/
   connection/location. On save, you're shown a one-time **agent key** —
   copy it now, it's never shown again (you can rotate it later if lost).
2. On the machine physically connected to the reader:
   ```bash
   cd server
   npm install     # nfc-pcsc is optional; needs PC/SC Lite (Linux: libpcsclite-dev)
                    # or the built-in Smart Card service (Windows/macOS)
   AGENT_SERVER_URL=https://your-server AGENT_KEY=<the copied key> npm run agent
   ```
3. Once connected, the encoder's status flips to **Online** across every
   connected dashboard in real time, and it becomes selectable on
   **Live Encode**.
4. If the agent key leaks or you're decommissioning a reader, use
   **Rotate key** (invalidates the old key immediately) or delete the
   encoder entirely.

Supported reader families: ACR122U, ACR1252U, ACR1281U, PN532, OMNIKEY
5022/5427, and generic PC/SC devices, plus a generic serial path for
125kHz hardware.

## 9. Configuration reference

All server configuration lives in `server/.env` (see
`server/.env.example` for the full annotated list):

| Variable | Purpose |
|---|---|
| `DATABASE_URL` | PostgreSQL connection string. Leave unset for local dev — a database is auto-provisioned. |
| `PORT` | API port (default `4000`). |
| `CLIENT_ORIGIN` | Allowed CORS origin for the dashboard (and websocket). |
| `JWT_ACCESS_SECRET` / `JWT_REFRESH_SECRET` | Signing secrets for access/refresh tokens — must be random and kept secret in any real deployment. |
| `JWT_ACCESS_TTL` / `JWT_REFRESH_TTL` | Token lifetimes (default `15m` / `30d`). |
| `ENCRYPTION_KEY` | 32-byte hex key used to encrypt MIFARE sector keys at rest (AES-256-GCM). |
| `SEED_SUPER_ADMIN_EMAIL` / `SEED_SUPER_ADMIN_PASSWORD` | Used only by `prisma/seed.ts`. |
| `APP_URL` | Public URL of the web client, used to build links in emails. |
| `SMTP_HOST` / `SMTP_PORT` / `SMTP_USER` / `SMTP_PASSWORD` / `SMTP_FROM` | Optional outgoing email for password resets. If unset, reset links are logged to the server console instead — fine for local dev, not for production. |

The zero-config local dev flow auto-generates real random secrets on first
run — for anything shared or production-facing, set your own values
explicitly rather than relying on that.

## 10. Deployment

`docker-compose.yml` at the repo root brings up Postgres, the API, and an
Nginx-served build of the client:

```bash
ENCRYPTION_KEY=$(node -e "console.log(require('crypto').randomBytes(32).toString('hex'))") \
JWT_ACCESS_SECRET=$(node -e "console.log(require('crypto').randomBytes(32).toString('hex'))") \
JWT_REFRESH_SECRET=$(node -e "console.log(require('crypto').randomBytes(32).toString('hex'))") \
  docker compose up -d --build
```

The `server` container runs `prisma migrate deploy` automatically on boot
before starting the API. For a real production deployment beyond this
compose file, put the API behind TLS, point `DATABASE_URL` at a managed
Postgres instance, set real JWT/encryption secrets (never the defaults from
`.env.example`), and configure SMTP so password reset emails actually send.

## 11. Security notes

- Sector/page keys are encrypted at rest (AES-256-GCM); only `MANAGER`+
  roles can request the decrypted keys, and only via an authenticated,
  company-scoped request.
- Access tokens are short-lived (15 min default) and refresh tokens rotate
  on every use; refresh tokens are stored server-side as salted hashes so
  any session can be remotely revoked (see [6.11](#611-your-profile-and-active-sessions)).
- Every tenant-scoped endpoint enforces company isolation in middleware,
  independent of what a client sends — a `MANAGER` at one company literally
  cannot address another company's card even by guessing its ID.
- Card-encoder allocation restrictions (6.6) are enforced in the same
  server-side layer that handles live encode commands, not just in the UI.
- Self-service company registration is rate-limited to reduce abuse, and
  slug/email uniqueness is enforced at the database level.
- DESFire's destructive commands (create/delete application, delete file,
  format card) are role-gated to `MANAGER`+ server-side, on top of the
  existing company-scoping check — a `VIEWER`/`OPERATOR` cannot wipe a card
  or delete another partition even by calling the websocket API directly.
  See [6.13](#613-mifare-desfire-partitioning-applications--files) for the
  DESFire integration's specific cryptographic scope and limits.

## 12. Troubleshooting

| Symptom | Likely cause / fix |
|---|---|
| "Encoder is offline" when sending a command | The local agent for that encoder isn't running or lost connection — restart `npm run agent` on the machine with the reader plugged in. |
| "This card is not allocated to this encoder" | The card has an active encoder restriction (6.6) that doesn't include the encoder you're using — either add that encoder to its allowlist, or use an allowed one. |
| Can't create a second company with the name/slug you want | Slugs are unique platform-wide — pick a different slug (the company name itself can repeat). |
| Password reset email never arrives | `SMTP_HOST` isn't configured — check the server console log instead; the reset link is printed there in that case. |
| `groupadd: Permission denied` during local dev setup | You're running as a non-root user on your own machine, which is the normal/expected case — this is handled automatically; if you still see it, make sure you're on the latest version of this repo. |
| Local dev database seems stuck/stale after a reboot | The auto-provisioned local Postgres restarts itself automatically on the next `npm run dev`/`npm test`; if something still seems off, delete `server/.local-db/` to force a clean re-provision (you'll lose local dev data, not anything real). |

## 13. API quick reference

All endpoints are under `/api`, JSON in/out, JWT bearer auth (`Authorization:
Bearer <accessToken>`) except where noted. Every list/detail endpoint is
implicitly scoped to the caller's own company unless they're `SUPER_ADMIN`.

| Area | Endpoints |
|---|---|
| Auth | `POST /auth/login`, `POST /auth/register-company`, `POST /auth/refresh`, `POST /auth/logout`, `GET/PATCH /auth/me`, `POST /auth/forgot-password`, `POST /auth/reset-password`, `GET /auth/sessions`, `DELETE /auth/sessions/:id` |
| Companies | `GET/POST /companies`, `GET/PATCH/DELETE /companies/:id` |
| Users | `GET/POST /users`, `GET/PATCH/DELETE /users/:id` |
| Card holders | `GET/POST /holders`, `GET/PATCH/DELETE /holders/:id` |
| Card templates | `GET/POST /templates`, `GET/PATCH/DELETE /templates/:id` |
| Encoders | `GET/POST /encoders`, `GET/PATCH/DELETE /encoders/:id`, `POST /encoders/:id/rotate-key` |
| Cards | `GET/POST /cards`, `GET/PATCH/DELETE /cards/:id`, `GET /cards/:id/keys`, `POST /cards/:id/assign`, `POST /cards/:id/unassign`, `POST /cards/:id/block`, `POST /cards/:id/unblock`, `POST /cards/:id/lost`, `POST /cards/:id/retire`, `POST /cards/:id/encoders/grant`, `POST /cards/:id/encoders/revoke`, `GET /cards/export`, `POST /cards/bulk-import` |
| Access zones | `GET/POST /zones`, `PATCH/DELETE /zones/:id`, `POST /zones/:id/grant`, `POST /zones/:id/revoke` |
| Notifications | `GET /notifications`, `POST /notifications/:id/read`, `POST /notifications/read-all` |
| Dashboard | `GET /dashboard/stats` |
| Audit logs | `GET /logs`, `GET /logs/export` |
| Live encode (websocket, `/dashboard` namespace) | `encoder:command` (emit — includes MIFARE Classic/NTAG commands plus `LIST_APPLICATIONS`/`SELECT_APPLICATION`/`AUTH_APPLICATION`/`READ_FILE`/`WRITE_FILE`/`CREATE_APPLICATION`/`CREATE_FILE`/`DELETE_FILE`/`DELETE_APPLICATION`/`FORMAT_PICC` for DESFire — see [6.13](#613-mifare-desfire-partitioning-applications--files)), `encoder:status` / `card:detected` / `encoder:commandResult` (listen) |
| Hardware agent (websocket, `/agent` namespace) | authenticates with an encoder's `agentKey`; emits `heartbeat`, `card:detected`, `command:result`; listens for `command` |

For a runnable, pre-chained example of the REST calls (login → register a
company/card → block it → check the resulting notification), open
[`api-requests.http`](api-requests.http) at the repo root with VS Code's
REST Client extension.
