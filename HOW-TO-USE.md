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
   - [4.4 Industries and modules](#44-industries-and-modules)
5. [Roles and permissions](#5-roles-and-permissions)
6. [Everyday workflows](#6-everyday-workflows)
   - [6.1 Managing your team](#61-managing-your-team-users)
   - [6.2 Card holders](#62-card-holders)
   - [6.3 Card templates](#63-card-templates)
   - [6.4 Registering and encoding cards](#64-registering-and-encoding-cards)
   - [6.5 Storing structured data on a card (business/university IDs) and random per-card keys](#65-storing-structured-data-on-a-card-businessuniversity-ids-and-random-per-card-keys)
   - [6.6 Card lifecycle](#66-card-lifecycle-block-unblock-lost-retire)
   - [6.7 Restricting a card to specific encoders](#67-restricting-a-card-to-specific-encoders)
   - [6.8 Access zones](#68-access-zones)
   - [6.9 Bulk actions and CSV import/export](#69-bulk-actions-and-csv-importexport)
   - [6.10 Notifications](#610-notifications)
   - [6.11 Dashboard and audit logs](#611-dashboard-and-audit-logs)
   - [6.12 Your profile and active sessions](#612-your-profile-and-active-sessions)
   - [6.13 Company settings](#613-company-settings)
   - [6.14 MIFARE DESFire partitioning (applications & files)](#614-mifare-desfire-partitioning-applications--files)
   - [6.15 Attendance (check-in / check-out)](#615-attendance-check-in--check-out)
   - [6.16 Visitors](#616-visitors)
   - [6.17 Maintenance](#617-maintenance)
7. [Worked examples by industry](#7-worked-examples-by-industry)
   - [7.1 Hotel](#71-hotel)
   - [7.2 Business / office](#72-business--office)
   - [7.3 University](#73-university)
   - [7.4 National ID / government ID](#74-national-id--government-id)
   - [7.5 Inventory / asset tracking](#75-inventory--asset-tracking)
   - [7.6 e-Healthcare](#76-e-healthcare)
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
| **Industry** | What kind of organization a company is (University, Hotel, Business/Office, e-Government). Optional; sets a starting **module** list. See [4.4](#44-industries-and-modules). |
| **Module** | A slice of the app (Cards, Encoders, Templates, Card Holders, Access Zones, Attendance, Audit Logs, National ID data, Visitors, Maintenance) a company can be granted or denied. See [4.4](#44-industries-and-modules). |
| **User** | A person who logs into the dashboard. Belongs to exactly one company (except `SUPER_ADMIN`). |
| **Card holder** | The person a card is *for* — a guest, employee, or student. Not a login; just a record (name, department/room, employee/student ID, photo). |
| **Card** | A physical RFID/NFC tag: a UID, a type (MIFARE Classic 1K, NTAG213, 125kHz Prox, etc.), a status, optionally assigned to a holder. |
| **Card template** | A reusable memory layout (which MIFARE sectors/keys, which NTAG pages, or which DESFire applications/files, mean what) applied when a card of that type is registered. |
| **DESFire application / file** | Real card **partitioning**, specific to MIFARE DESFire: the card's memory is divided into independent, separately-keyed applications (e.g. one for building access, one for a canteen wallet), each containing its own files. Distinct from — and more capable than — MIFARE Classic's sector/key layout. See [6.14](#614-mifare-desfire-partitioning-applications--files). |
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
   - **What kind of organization is this?** — University/School, Hotel,
     Business/Office, e-Government (National ID), or General if none fit.
     This sets which features you start with; see
     [4.4](#44-industries-and-modules).
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
businesses should just use self-registration. The creation form includes
the same industry picker as self-registration, and — unlike self-registered
companies — a `SUPER_ADMIN` can fine-tune the exact module list afterward
from the same page (see [4.4](#44-industries-and-modules)).

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

### 4.4 Industries and modules

Instead of every company seeing the entire application, a company can be
scoped down to just the pieces relevant to its business — a hotel doesn't
need to see "National ID data," and a government registrar's office
probably doesn't need "Attendance."

- **Industry** is a label (`University`, `Hotel`, `Business/Office`,
  `e-Government — National ID`, `Inventory / Asset tracking`,
  `e-Healthcare`, or `General`) picked at registration, or set later by a
  `SUPER_ADMIN`. Picking one seeds a starting **module** list; it's a
  convenience default, not a hard rule.
- **Modules** are the actual gate: Cards, Encoders (+ Live Encode),
  Templates, Card Holders, Access Zones, Attendance, Audit Logs, National
  ID / citizen data, Visitors, and Maintenance. A company only sees nav
  links and can only navigate to pages for modules it has enabled — both
  hiding the link *and* blocking direct navigation to the URL, not just a
  UI nicety.
- **A company with no modules explicitly set is unrestricted** — every
  module is visible. This is deliberate: every company that existed before
  this feature, and any new company registered without picking an industry
  ("General"), behaves exactly as the whole app always has. Gating only
  turns on once a `SUPER_ADMIN` (directly, or via an industry pick at
  registration) gives a company a real module list.
- University, Hotel, Business/Office, Government ID, Inventory, and
  Healthcare all start with the same full core module set (Cards, Encoders,
  Templates, Card Holders, Access Zones, Attendance, Audit Logs) — nothing
  about the existing feature set maps cleanly to "exclude this for hotels"
  yet. On top of that core set, each industry's preset adds what's actually
  specific to it:
  - **National ID / citizen data** ([6.5](#65-storing-structured-data-on-a-card-businessuniversity-ids-and-random-per-card-keys)) —
    only Government ID and Healthcare, since both need an encrypted
    identity record on the card (see
    [7.4](#74-national-id--government-id) and [7.6](#76-e-healthcare)).
  - **Visitors** ([6.16](#616-visitors)) — University, Hotel, Business,
    Government ID, and Healthcare, everywhere a temporary/guest pass is a
    common front-desk need.
  - **Maintenance** ([6.17](#617-maintenance)) — Business and Inventory,
    where tracking equipment service/repair actually applies.
  - Inventory itself reuses the exact same Cards/Holders/Attendance/Zones
    model for tracking physical items instead of access credentials (see
    [7.5](#75-inventory--asset-tracking)) — no dedicated "item" concept
    exists separately from Card.
- A `SUPER_ADMIN` can change any company's industry and individual modules
  from the **Companies** page (the gear icon on a company's card). Picking
  an industry there fills in its defaults as a starting point; the
  checkboxes underneath are what actually gets saved, so you can freely
  add/remove individual modules regardless of industry. A `COMPANY_ADMIN`
  can see their own company's industry and enabled modules (read-only) from
  **Company Settings**, but can't change them — that's a platform-level
  decision.

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

A `SUPER_ADMIN` isn't attached to any single company, so every "create"
form that makes a company-scoped record (encoders, templates, zones, card
holders, cards, visitor passes) shows an extra required **Company** field
for them to pick which company the new record belongs to. Everyone else
doesn't see that field — their own company is used automatically.

Browsing across every company at once is also organized by company for a
`SUPER_ADMIN`: **Users**, **Card Holders**, and **Encoders** are split into
one section per company (with a count), instead of one long mixed list.
**Cards** works a little differently since it's paginated (a company could
have thousands) — each page is still pre-sorted so a company's cards
cluster together with a header, and a **Company** dropdown next to the
other filters lets you scope the whole list down to just one company's
cards, paged normally. Everyone else only ever has one company's data to
begin with, so they see the plain list as before.

## 6. Everyday workflows

### 6.1 Managing your team (Users)

`COMPANY_ADMIN`s manage their team from **Users**:

1. Click **New user**.
2. Enter their name, email, a temporary password, and pick a role
   (`COMPANY_ADMIN`, `MANAGER`, `OPERATOR`, or `VIEWER`).
3. They can sign in immediately with that email/password, or you can send
   them to `/forgot-password` to set their own.
4. **Edit** (pencil icon) — update a user's name, role, or reset their
   password on their behalf (they don't need to know the old one — this is
   different from the self-service password change on the Profile page).
   Email can't be changed here; it's their sign-in identity.
5. **Disable / Reactivate** (the ban/checkmark icon) — disabling
   immediately revokes access without losing the audit trail of actions
   they performed while employed; reactivating restores it. Prefer this
   over deleting for anyone who might come back, or whose past actions
   (registrations, blocks, encodes) you want to keep attributed to a real
   person in the [audit log](#611-dashboard-and-audit-logs).
6. **Delete** (trash icon) — permanently removes the account. Use this for
   accounts created by mistake or that never need an audit trail kept;
   otherwise prefer disabling.

You can't edit, disable, or delete your own account from this page — that
prevents accidentally locking yourself out. Update your own name/password
from [Profile](#612-your-profile-and-active-sessions) instead. A
`COMPANY_ADMIN` also can't promote anyone to `SUPER_ADMIN` (platform-wide
access) — only a `SUPER_ADMIN` can grant that role.

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
2. Optionally pick **Start from a preset** first — ready-made starting
   points grouped by industry:
   - **University**: Student ID (plain, or **Encrypted**), Staff/Faculty
     ID, Library Card
   - **Inventory**: Asset Tag, Equipment Check-out Tag
   - **Business**: Employee Badge (plain, or **Encrypted**), Visitor
     Badge, and three **Secure Access Card** presets — one each for
     MIFARE DESFire EV1, EV2, and EV3, using AES mutual authentication
   - **Hotel**: Room Key Card, Staff Master Key
   - **e-Government**: Government Worker ID (plain), National ID Card
     (**Encrypted**)
   - **e-Healthcare**: Hospital Staff Badge (plain), Hospital Visitor
     Pass, Patient ID Card (**Encrypted**)

   Picking one fills in the name, card type, and a starting set of
   labeled blocks, DESFire applications/files, or (for **Encrypted**
   presets) an AES-256-GCM encrypted record — everything stays fully
   editable afterward, and it's just a head start, not a locked-in
   choice. Pick **Start from scratch** to skip it. The **Encrypted**
   presets only appear if your company has the "National ID / citizen
   data" module enabled (see [4.4](#44-industries-and-modules)) — that's
   what makes them usable afterward in Live Encode; everyone else sees
   the plain-field version of the same preset where one exists.
3. Pick the card type. For MIFARE Classic types you define per-sector
   Key A/Key B and label individual data blocks; for NTAG/Ultralight
   types you define page ranges and their purpose (e.g. pages 4–6 = NDEF
   message); for DESFire types you define applications and files (see
   [6.14](#614-mifare-desfire-partitioning-applications--files)).
4. **Protected MIFARE Classic blocks.** Every sector's last block is a
   key/access-bits trailer, and block 0 (inside sector 0) is the card's
   factory-locked manufacturer block — labeling either one shows a red
   inline warning and is rejected on submit, both here and for an
   encrypted record's block list. This is enforced server-side too (at
   template-creation time, and again at the moment Live Encode actually
   writes a block, including from the raw "Send command" console), not
   just hinted at in this form.
5. Optionally mark it **default for this card type** — it'll be
   pre-selected whenever you register a new card of that type.
6. Templates are informational/configuration metadata; the actual
   encode/write happens from the **Live Encode** page using whichever
   template you attach to a card.
7. Templates you create from a preset are ordinary templates — **edit**
   (pencil icon) or **delete** (trash icon) them the same as any other;
   nothing about starting from a preset restricts what you can do with it
   afterward. Editing reopens the same form pre-filled with the
   template's current name, card type, and full layout — every field
   stays editable, including sectors/pages/applications and the
   encrypted citizen record. A template's company can't be changed after
   creation (the field is shown but disabled while editing).

### 6.4 Registering and encoding cards

There are three ways to get a card into the system:

**A. Manual/scanned registration** — **Cards → Register card**: if an
encoder is online, use the **Scan from encoder** picker at the top of the
form — select it, click **Scan**, tap the card, and its UID fills in
automatically (no typing, no risk of a transposed digit). If no encoder is
online, or you're registering from a UID printed on the card or read with
another app, just type it into the **UID (hex)** field directly. Either way,
pick the card type and optional template/label/notes.

**B. Live, at an encoder** — **Live Encode** page:
1. Plug in the encoder and start its local agent (see
   [Setting up a physical encoder](#8-setting-up-a-physical-encoder)).
2. On the Live Encode page, select that encoder from the dropdown — its
   location (if set) shows next to its name, and its live status
   (Online/Offline/Busy) shows immediately below. If the encoder is tied to
   an access zone (see [6.8](#68-access-zones)), an "Installed in: &lt;zone&gt;"
   line appears too — purely informational context about where that reader
   physically sits.
3. Tap a card on the reader. If it's unknown, a quick "register it" panel
   appears — pick the card type, an optional **template**, and an optional
   label, then register. Picking a template here means the next step (the
   guided **Card data** form) is ready immediately, with no separate trip
   to the Cards page needed.
4. If it's already known, its status/holder shows immediately with a link
   to its detail page, along with its assigned **template** name (if any)
   and any **access zones** it currently has access to. If the card has no
   template yet, the **Card data** panel offers a template picker with an
   **Assign** button right there — pick one, assign it, and the plain-text
   form appears in place without leaving the page.
5. If the tapped card is restricted to a different encoder (see
   [6.7](#67-restricting-a-card-to-specific-encoders)), the warning names
   which encoder(s) it's actually allowed on, so you know where to take it
   instead of guessing.
6. The **Card data** panel (see [6.5](#65-storing-structured-data-on-a-card-businessuniversity-ids-and-random-per-card-keys))
   is the main way most people write to a card — plain fields, no hex or
   block numbers. Raw block/hex/DESFire commands (write a MIFARE Classic
   block with a given key, partition a DESFire card into
   applications/files, etc.) are still there for advanced cases, tucked
   under an **Advanced: raw commands** section that starts collapsed.
   Every command and its result appears in the live event log at the
   bottom, and is written to the audit trail.

**C. Bulk import** — see [6.9](#69-bulk-actions-and-csv-importexport).

### 6.5 Storing structured data on a card (business/university IDs) and random per-card keys

Beyond just an access token, a MIFARE Classic card can hold a small amount of
readable data directly on it — enough for a business ID or university ID
badge to carry a name, employee/student number, or department without a
network lookup. Two pieces work together for this:

**1. Label the blocks on a template.** On a MIFARE Classic template
([6.3](#63-card-templates)), each sector's block list takes a `purpose`
string — e.g. sector 1, block 4 = "Full name," block 5 = "Employee ID." This
is just a label; it doesn't reserve anything on the card by itself.

**2. Fill them in from Live Encode.** Any card that uses that template shows
a **Card data** panel right next to the encoder status once it's on the
reader, with one plain-text field per labeled block — no hex, no block
numbers to remember. A card with no template yet (or a template with no
labeled blocks) shows a template picker in the same spot instead — assign
one without leaving the page and the fields appear immediately:

- **Read from card** pulls the current value of every labeled block and
  decodes it back to text.
- **Write to card** hex-encodes whatever you typed (padded/truncated to the
  block's 16 bytes) and writes each field to its block in one action.

Text longer than 16 bytes is silently truncated to fit — keep fields short
(a name, an ID number, a two-letter department code), and use a
[card holder](#62-card-holders) record instead for anything that needs more
room or needs to be searchable.

**Deleting card data.** `SUPER_ADMIN`/`COMPANY_ADMIN`/`MANAGER` users see a
**Delete card data** button next to Read/Write, which overwrites every
labeled block with blanks after a confirmation prompt — for wiping a card
before reissuing or retiring it. It isn't visible to `OPERATOR`/`VIEWER`
roles, and the server enforces the same restriction independently (it isn't
just a hidden button — the underlying write is tagged as a deletion and
rejected server-side for any role below `MANAGER`), so a lower-privileged
user can't bypass it by calling the API directly. The [Encrypted citizen
data](#65-storing-structured-data-on-a-card-businessuniversity-ids-and-random-per-card-keys)
panel below has the same protected **Delete citizen data** button, which
writes a freshly re-encrypted *blank* record rather than raw zeros — the
card still reads back as a valid (just empty) record afterward instead of
"could not decrypt."

**Random per-card keys.** By default, new cards use whatever Key A/B the
template specifies (often the MIFARE factory default,
`FFFFFFFFFFFF`, until you change it) — fine for testing, but every card
sharing one key means a single leaked card exposes all of them. From a
card's detail page, `SUPER_ADMIN`/`COMPANY_ADMIN`/`MANAGER` users get a
**Sector keys** panel:

- **Generate random keys** replaces this card's stored keys with a fresh
  random Key A/B per sector the template defines, encrypted at rest exactly
  like any other stored key ([11](#11-security-notes)). Live Encode and the
  Card data panel automatically pick up the new keys for that card — nothing
  else to configure.
- **View keys** re-displays the currently stored keys for that card at any
  time — useful if you need to key them into another system or verify what
  was generated.

Regenerating invalidates the previous keys immediately — expect this to be a
deliberate, occasional action (e.g. re-keying a batch before issuing them),
not something run on every read.

**Encrypted citizen data (national ID, sensitive PII).** The plain labeled
blocks above are readable by anyone who knows the sector key — fine for a
badge name, not appropriate for a national ID number or date of birth. For
that, a template can define an **encrypted citizen record** instead: a list
of field names (e.g. `fullName`, `nationalId`, `dob`) plus an ordered list of
blocks (any sector, mix freely) that together hold one AES-256-GCM encrypted
blob. Configure it in the same template modal as the plain blocks, in its own
"Encrypted citizen record" section — **Load National ID preset** /
**Load Patient ID preset** fill in both the field list and a working set of
blocks in one click (an **Auto-fill blocks** button does the same for a
custom field list), so setting one up doesn't require hand-computing MIFARE
sector/block numbers. The suggested blocks stay fully editable and are
capped at the same 16-block maximum the server enforces — none of this
changes what's actually written to the card or how it's encrypted, it just
picks a starting layout for you.

The important difference from the plain blocks: **the encryption key never
reaches the browser.** Where the plain Card data panel hex-encodes text
locally and only needs the MIFARE sector key (which Live Encode already
has to see to authenticate a read/write), the encrypted flow works like
this instead —

1. You type the field values into the **Encrypted citizen data** panel and
   click **Encrypt & write**. A live "X / Y bytes used" line under the
   fields tracks capacity as you type, so an oversized record is obvious
   before you try to write it, not after.
2. The browser sends the plain values to the server, which combines them,
   encrypts the result with this card's own random data key (generated
   alongside its sector keys — [above](#65-storing-structured-data-on-a-card-businessuniversity-ids-and-random-per-card-keys)),
   and returns only opaque ciphertext bytes, split into the configured
   blocks.
3. The browser writes those bytes to the card — it never sees the
   plaintext-to-ciphertext mapping or the key that produced it.
4. **Read from card** works in reverse: the browser reads the raw
   (encrypted) bytes off the card and sends them to the server, which
   decrypts and returns the field values for display.

A card that's never had its keys generated has no data key yet, so writing
citizen data to it would fail — the **Encrypted citizen data** panel checks
for this and shows a **Generate keys** button right there instead of a
failed write, calling the same key generation as the Sector keys panel
above (still random, still server-side, still per card).

Because a tampered card fails to decrypt outright (AES-GCM detects it) rather
than returning corrupted-looking data, this also gives you tamper-evidence
for free — a cloned or edited block reads back as "could not decrypt," not
as garbled text.

**Capacity is real and small.** Each block is 16 bytes, and roughly 16 of
those bytes across the whole record are spent on encryption overhead
regardless of how many blocks you use — so budget usable space as
`blocks × 16 − 16` bytes for all fields *combined*, as compact JSON (the
template editor shows this estimate live as you add blocks). Three blocks
(48 bytes) leaves about 32 bytes total; six blocks (96 bytes) leaves about
80. This is the actual capacity of a physical MIFARE Classic card, not a
software limit — keep field values short (initials, codes, compact date
formats) and lean on a [card holder](#62-card-holders) record for anything
that needs to hold more or be searched on. Avoid picking a sector's trailer
block (block 3 of every 4-block sector) — writing there corrupts that
sector's own keys.

Both the plain and encrypted panels can be configured on the same template
and appear together in Live Encode — use plain blocks for anything that's
fine to be readable (a badge label) and the encrypted record for anything
that shouldn't be (an ID number).

### 6.6 Card lifecycle (block, unblock, lost, retire)

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

**Editing and deleting cards.** From a card's detail page, the **Edit**
button opens a form for its label, template, status, and notes — use it to
fix a typo'd label, reassign it to a different template of the same card
type, or correct a status that's out of sync (prefer the lifecycle buttons
above for block/unblock/lost/retire, since those log the right audit
action; the edit form's status field is an escape hatch for the rest).
Operators and above can edit; **Delete** (also on the detail page, and as a
trash icon on each row of the Cards list) permanently removes a card and
its history, and needs Manager role or above — a stricter bar than editing,
both enforced server-side, not just hidden in the UI.

### 6.7 Restricting a card to specific encoders

By default, **any card can be used with any encoder in your company** — no
setup needed. If you need tighter control (e.g. a grand-master key that
should only ever be written at the security office, never at a guest-facing
kiosk), you can opt a specific card into a restriction:

1. Open the card's detail page.
2. Under **Allowed encoders**, optionally set an **expiry date/time** — e.g.
   a hotel guest's checkout time — then pick an encoder from the dropdown
   and click **Add**. The card is now restricted — it can only be used with
   the encoder(s) you've explicitly allowed, and only until the expiry you
   set (leave the date/time blank for access that never expires).
3. Add more encoders the same way, or remove one by clicking the **×** on
   its badge. Removing the *last* allocation makes the card unrestricted
   again.
4. To extend or shorten access (e.g. a guest extending their stay), just
   add the same encoder again with a new expiry — it updates the existing
   allocation rather than creating a duplicate.
5. This is enforced **server-side**, not just hidden in the UI: if someone
   tries to run a command against a restricted card from a non-allowed
   encoder (via Live Encode or directly over the websocket API), the
   command is rejected with `"This card is not allocated to this encoder"`.
   Once an allocation's expiry passes, commands against that encoder are
   rejected too, with `"This card's access to this encoder has expired"` —
   an expired allocation does **not** fall back to unrestricted access, even
   if it was the card's only allocation. The Live Encode page also
   proactively warns and disables the send button when the currently
   selected encoder isn't on a detected card's current (non-expired)
   allowlist.

This is opt-in per card — you never have to configure it, and a company with
zero allocations behaves exactly as if the feature didn't exist.

### 6.8 Access zones

Access zones are a lightweight way to model "what does this card open,"
layered on top of the inventory system (this platform manages the *cards*,
not physical door hardware itself):

1. **Zones → New zone** — e.g. "Pool Deck", "Server Room", "3rd Floor". Use
   the pencil icon on an existing zone to rename it or edit its description
   afterward (its company can't be changed once created).
2. Click **Manage access** on a zone to open a combined panel for both:
   - **Cards with access** — grant by typing a card's UID, or revoke with
     the **×** on any granted card's row. A card's detail page also lists
     every zone it currently has access to.
   - **Encoders tied to this zone** — pick an encoder from the dropdown and
     click **Tie** to record which physical reader(s) are installed in that
     zone (e.g. "the Server Room door reader"), or untie with the **×**.
     This is informational context only — it does **not** restrict which
     cards that encoder will accept; use [Restricting a card to specific
     encoders](#67-restricting-a-card-to-specific-encoders) on a card's
     detail page for actual access control. Both grant/revoke actions are
     enforced server-side (an encoder can only be tied to a zone in its own
     company), not just hidden in the UI.
   - **Recent access activity** — a live-ish (polled every 5s) log of which
     card was used at which of the zone's encoders and when, like a hotel
     door lock's access log: "Guest — Door Reader 204 — Jul 18, 22:43." It
     reuses [Attendance](#615-attendance-check-in--check-out)'s own records
     for this zone (`CHECK_IN` shows as **Opened**, `CHECK_OUT` as
     **Closed**) rather than a separate log, so tapping a card at an encoder
     tied to this zone — e.g. via the [Attendance](#615-attendance-check-in--check-out)
     page — is what populates it.
3. Each zone card on the list shows a running count of cards and encoders.

### 6.9 Bulk actions and CSV import/export

From the **Cards** page:

- **Export CSV** — exports the currently filtered list (respects your
  status/type/search filters) as a CSV download.
- **Import CSV** — upload a CSV with `uid, cardType, label` columns
  (header row required) to bulk-register up to 500 cards at once. You'll
  see a preview before committing, and a per-row result (created / skipped
  as duplicate / error) afterward.
- **Select rows** (checkboxes) to block/unblock several cards at once, or
  export just the selection.

### 6.10 Notifications

Company admins and managers automatically get in-app notifications
(bell icon, top right) — delivered live over websocket and persisted for
later — when:

- A card is blocked or reported lost
- A card is expiring within 7 days, or auto-expired
- An encoder goes offline

Click a notification to jump straight to the relevant card/encoder; mark
individual ones read or **mark all as read**.

### 6.11 Dashboard and audit logs

- **Dashboard** — at-a-glance counts of cards by status/type, encoders by
  status, total holders, and recent activity. Companies with the Visitors
  or Maintenance module enabled also see a live count of active visitor
  passes and open maintenance tickets.
- **Logs** — the full, filterable audit trail (by card, encoder, user,
  operation type, date range), exportable to CSV. Every register, assign,
  block, encode command, and more is recorded here with who did it and
  when — this is your compliance/audit record.

### 6.12 Your profile and active sessions

From **Profile**:

- Update your name or change your password.
- **Sessions** — see every device currently signed in as you (best-effort
  browser/OS and IP), and revoke any of them remotely (e.g. a lost laptop).
- Forgot your password? Use **Forgot password?** on the login screen —
  a reset link is emailed (or logged to the server console if SMTP isn't
  configured, for local dev) and expires after 1 hour. Resetting revokes
  every other active session as a precaution.

### 6.13 Company settings

`COMPANY_ADMIN`s can update their company's name, contact details, address,
and logo from **Company Settings**, which also shows their company's
industry and enabled modules (read-only — see
[4.4](#44-industries-and-modules)). `SUPER_ADMIN`s manage every company from
the **Companies** page, including deactivating one without deleting its
data, and changing its industry/modules via the gear icon on each company's
card.

### 6.14 MIFARE DESFire partitioning (applications & files)

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

### 6.15 Attendance (check-in / check-out)

The **Attendance** page turns a card tap into a check-in/check-out record —
useful for lecture attendance, shift clock-in/out, or event entry, without
building anything on top of the raw card. It doesn't require any special
card template or on-card storage; it works with any card that's assigned to
a [card holder](#62-card-holders).

1. Pick the **Encoder** the tap will come from, and optionally a **Zone /
   session** — leave it as "General" for company-wide attendance, or pick an
   [access zone](#68-access-zones) to scope attendance to one room/class.
   Zone and general attendance track independently: a student's lecture-hall
   check-in state doesn't affect their library check-in state.
2. By default, as cards are tapped on the selected encoder, each tap
   **alternates** check-in and check-out for that holder automatically — no
   separate "start session" step, and a missed tap just leaves the next one
   correctly reversed. A schedule's **Mode** (see below) can instead cap this
   at one check-in, one check-out, or one full in/out cycle per card. The
   live feed shows each tap as it happens; results are also written to the
   **Records** table below — including each holder's **ID number** (their
   [card holder](#62-card-holders) employee/student ID, if one's on file) —
   with full filtering by **Schedule** (which saved schedule, e.g. "CS101
   Lecture" vs "MATH201 Lecture", was open when the tap happened —
   snapshotted at tap time, so it stays correct even if you later rename or
   delete that schedule), zone, check-in/out type, and a **From/To** date
   range — plus CSV export that respects every one of those filters and
   includes the ID number column too, so you can pull just one class's or
   one date range's attendance history instead of everything at once.
3. A card that's blocked, lost, retired, or not yet assigned to a holder is
   rejected with a clear reason in the feed rather than silently recording
   junk — you'll want cards properly registered and assigned before using
   this page.
4. Recording attendance is available to any `OPERATOR`+ role (front-desk or
   gate staff); anyone authenticated in the company can view and export the
   records.

Attendance records are separate from the [audit log](#611-dashboard-and-audit-logs) —
the audit log tracks system operations (registrations, blocks, encodes);
attendance tracks physical presence over time and is the right place to
pull a term's/shift's attendance history from.

**Saved schedules (like a university course catalog).** An encoder can host
any number of independent recurring schedules — the way one lecture hall's
door reader serves CS101 on Mon/Wed/Fri mornings and MATH201 on Tue/Thu
afternoons, each tracked, edited, and started/stopped separately. This is
the **Saved schedules** table below the tap panel:

1. Click **New schedule** to open the editor. Enter a **Label** — required,
   since it's the only thing that tells two schedules apart in the table
   (e.g. "CS101 Lecture" vs "Front Desk Shift"): use the subject, class,
   department, or shift the schedule represents. An optional **Description**
   holds extra context (room number, term, anything that doesn't belong in
   the label itself). Pick the **Encoder** it applies to, optionally a
   **Zone**, a **Mode** (see below), then the **days of the week** and a
   **start/end time** (e.g. Mon/Wed/Fri, 09:00–10:00), and click **Create
   schedule**.
2. Once saved, that encoder only accepts attendance taps while **at least
   one** of its schedules says it's open — a course meeting right now keeps
   the door working even if a different course sharing the same reader is
   between sessions. Each row shows its own **Open**/**Closed** badge with a
   live countdown to its next boundary (time until close while open, time
   until the next open while closed). A tap while every schedule on that
   encoder is closed is rejected with a clear reason, same as a
   blocked/expired card.
3. Each row has its own **Start now** / **Stop now**, which override just
   that schedule immediately regardless of what time it is — useful for an
   unscheduled makeup session or to cut one course's attendance off early
   without touching any other schedule on the same encoder. The override
   holds until you click **Resume schedule**, which clears it and goes back
   to following that schedule's saved days/times.
4. The pencil and trash icons **edit** or **delete** a schedule in place.
   Editing is a partial update — you only need to touch the fields you're
   changing, and it never affects any other schedule.
5. An encoder with **no saved schedules at all is unrestricted** — attendance
   works at any time, exactly like before this feature existed. Schedules
   are entirely opt-in, per encoder, and there's no limit on how many one
   encoder can have.
6. Each schedule's **Mode** controls what a repeat tap from the same card is
   allowed to do, on top of the open/closed check above:
   - **Free (check in/out at will)** — the default, and the original
     behavior: taps alternate check-in/check-out with no limit.
   - **Check-in only, once** — a card can only ever record a single
     check-in here; a repeat tap is rejected with "This card has already
     checked in." Useful for a one-way entry gate or a single-scan event.
   - **Check-out only, once** — the mirror of the above, for a single-scan
     exit point.
   - **Check in & out, once each** — a card gets exactly one check-in then
     one check-out; a third tap is rejected with "This card has already
     checked in and out." Useful when you want to guarantee one clean
     round-trip per card (e.g. a borrow/return desk) without allowing
     unlimited back-and-forth.

   The mode only applies while that schedule is the one open on the
   encoder — a general tap with no schedule open always behaves as Free.

Whether an encoder is currently open is always computed live — the OR of
every one of its schedules' own live states at the moment of the tap (or
page render) — there's no background job flipping a stored flag, so a
manual Start/Stop click and the countdowns are both accurate to the second.

### 6.16 Visitors

The **Visitors** page is a shortcut for the common "temporary badge" case —
someone who needs card access but isn't going to be a full
[card holder](#62-card-holders) record: a day guest, a contractor, a hotel
guest who hasn't checked in through the front desk system, a campus
visitor. There's no separate visitor data model — it's the same
[Card](#2-core-concepts) you'd register anywhere else, just issued with an
expiry set in the same step:

1. Enter the card's **UID** by hand, or **scan it from an online encoder** —
   pick the encoder from the dropdown, click **Scan**, and tap the card;
   the UID field fills in automatically (the same pattern used on the
   [Cards](#63-registering-a-card) register form). If that UID already
   belongs to an existing card, an inline warning appears right away — and
   if it's already assigned to a real card holder, the warning names them
   — with **Issue pass** disabled until you change the UID. This is
   enforced server-side too (not just this warning): registering a
   duplicate UID always fails, and a card already assigned to a holder
   can't have an expiry set on it, so an employee's real badge can never
   get silently turned into a visitor pass.
2. Pick a **card type**, and optionally a visitor name/purpose as the
   label.
3. Pick how long the pass should last — **1 hour / 4 hours / 1 day / 1
   week**, or a specific date/time. This sets the card's `expiresAt`
   directly (the same field used by
   [card lifecycle expiry](#66-card-lifecycle-block-unblock-lost-retire)
   generally) — once it passes, the card stops working automatically; you
   don't have to remember to revoke it.
4. The **Active & recent passes** list shows every card with an expiry set,
   with a live-ticking countdown to expiry, an **Edit** button to change an
   existing pass's duration without re-issuing it (pick a new preset or a
   specific date/time — it replaces the current expiry), and an **End now**
   button for ending a pass early (equivalent to blocking the card).
5. Need the pass to only work at one specific encoder (e.g. a hotel room
   door)? Open the card from this list and add an
   [encoder restriction](#67-restricting-a-card-to-specific-encoders) —
   the two features compose: a card can have both a restricted encoder set
   *and* an overall expiry.

### 6.17 Maintenance

The **Maintenance** page tracks service/repair tickets against a card —
mainly useful for [Inventory](#75-inventory--asset-tracking), where the
card represents a physical asset rather than an access credential, but
usable for any tagged equipment.

1. **Open a ticket**: search for the item's card by UID or label, describe
   the issue, and submit. New tickets start as **Open**.
2. Move a ticket to **In progress** once someone's working on it, then
   **Resolve** it when done — resolving stamps the ticket with a resolved
   timestamp. A resolved ticket can be **Reopened** if the issue recurs.
3. Filter the ticket list by status to see everything currently open/in
   progress, or the full resolved history for an item.

Maintenance tickets are independent of the card's own `status` (ACTIVE,
BLOCKED, etc.) — opening a ticket doesn't change the card's status, so an
item mid-repair can still be tracked/checked-out-blocked separately via the
normal [card lifecycle](#66-card-lifecycle-block-unblock-lost-retire)
actions if you want to prevent it being used while out of service.

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
   over. On the card's detail page, restrict it to the guest's room-door
   encoder with an expiry set to the checkout date/time
   ([6.7](#67-restricting-a-card-to-specific-encoders)) — the key
   automatically stops working the moment checkout passes, even if the
   guest never returns it.
6. At check-out: **Block** the card (or **Retire** if it won't be reused).
   Guest extending their stay? Re-add the same encoder allocation with a
   later expiry instead.
7. Lost a key mid-stay? **Mark lost**, then register/write a replacement.
8. For a walk-in day guest who doesn't need the full room-key flow (pool
   access, spa visitor, etc.), use **Visitors** ([6.16](#616-visitors)) to
   issue a pass with a duration preset instead of setting up a holder and
   template.

### 7.2 Business / office

1. Register your company, then invite an IT admin (`MANAGER`) and security
   desk staff (`OPERATOR`) from **Users**.
2. Create card holders for every employee (name, department, employee ID).
3. Define a "Employee Badge" template with your access-control sector
   layout — label a couple of blocks "Full name" and "Employee ID" if you
   want the badge itself to carry that data (see
   [6.5](#65-storing-structured-data-on-a-card-businessuniversity-ids-and-random-per-card-keys)),
   not just the door-access grant.
4. Set up **Access zones** per restricted area ("Server Room", "Executive
   Floor") and grant access per badge as needed.
5. Register each employee's badge, assign it to their holder record, and
   use **Generate random keys** on the card so it doesn't share a key with
   every other badge you issue.
6. Offboarding: **Unassign** the holder and **Retire** the badge.
7. For a sensitive area's master override card, use
   [6.7](#67-restricting-a-card-to-specific-encoders) to lock it to only the
   security-desk encoder.
8. Visitors and contractors without a full holder record: issue a
   time-boxed badge from **Visitors** ([6.16](#616-visitors)).
9. Office equipment (projectors, laptops, tools) can be tagged with its own
   card too — track service history with **Maintenance**
   ([6.17](#617-maintenance)) the same way [Inventory](#75-inventory--asset-tracking)
   does.

### 7.3 University

1. Register your university (or per-department company if you want fully
   separate inventories).
2. Create templates for "Student ID (MIFARE DESFire EV2)" and
   "Visitor Tag (NTAG213)" — or a MIFARE Classic "Student ID" template if you
   don't need DESFire's application partitioning, labeling blocks for name
   and student number so they're readable straight off the card
   ([6.5](#65-storing-structured-data-on-a-card-businessuniversity-ids-and-random-per-card-keys)).
3. Register encoders at the registrar's office and library front desk.
4. Bulk-import a semester's new students via CSV (UID pre-printed by your
   card vendor, or scan-and-register one by one at orientation).
5. Assign each card to a student card-holder record (name, student ID,
   department).
6. Use **Access zones** for dorms, labs, and libraries.
7. Lost card reported: **Mark lost**, issue a replacement, keep the old
   UID's history intact in the audit log for that student.
8. Lecture attendance: on the [**Attendance**](#615-attendance-check-in--check-out)
   page, select the lecture hall's encoder and its zone, then have students
   tap in as they arrive — no separate roll call needed, and each session's
   record set is independent of the last, so a student forgetting to "check
   out" doesn't affect the next lecture's attendance.

### 7.4 National ID / government ID

1. Register your agency as a company, picking **e-Government — National ID**
   as the industry ([4.4](#44-industries-and-modules)) — this is what turns
   on the National ID / citizen data module, which stays hidden for every
   other industry. Invite verifying officers as `MANAGER` (can view/generate
   keys) and enrollment clerks as `OPERATOR` (can encode/read citizen data,
   cannot see raw key material).
2. Create a MIFARE Classic template with an **encrypted citizen record**
   ([6.5](#65-storing-structured-data-on-a-card-businessuniversity-ids-and-random-per-card-keys)).
   Click **Load National ID preset** in the citizen record editor to fill in
   both the standard field set — full name, National Identity Number (NIN),
   date of birth, state of origin, licensed-to-vote, licensed-to-drive, and
   government-worker-ID flags — and a starting block layout sized to fit it,
   in one click; adjust field names/order and the suggested blocks as your
   scheme needs (which sectors are actually free depends on your card stock
   and lock hardware — re-run **Auto-fill blocks** after editing the field
   list). Keep values short regardless: initials over full middle names,
   compact date formats (`YYMMDD`), short codes over free text — the 16-block
   maximum leaves real but limited room once compact JSON overhead is
   accounted for, and the citizen data panel shows a live byte count as you
   fill in values so you'll see it coming rather than finding out on write.
   **The preset deliberately doesn't include fingerprint data** — this
   platform talks to RFID/NFC PC/SC encoders, not fingerprint scanners, so
   there's no hardware path to capture or verify a print. If your scheme
   needs biometric verification, that requires separate fingerprint
   hardware and its own integration; don't fake it with a placeholder
   field.
3. At enrollment: register the citizen's card (picking this template inline
   registers it template-and-all), then open the **Encrypted citizen data**
   panel in Live Encode. A card that's never had its keys generated shows a
   **Generate keys** button right there (a lost card then only ever exposes
   its own single record, not every citizen's) — generate them, then write
   their details.
4. At a checkpoint: tap the card, **Read from card** — the panel decrypts
   and shows the fields; nothing is exposed if the card is cloned or read by
   a different tool, since it holds only ciphertext.
5. Still create a [card holder](#62-card-holders) record with the same
   details for search, reporting, and audit purposes — the encrypted
   on-card record is for offline/no-network verification, not a replacement
   for the database.
6. Lost or compromised card: **Mark lost**, issue a replacement with freshly
   generated keys — the old card's data key stays behind on the retired
   card record and is never reused.

### 7.5 Inventory / asset tracking

There's no separate "item" concept in this platform — Inventory reuses the
same Cards/Card Holders/Attendance/Access Zones model everything else uses,
just mapped onto physical items instead of people:

1. Register your company, picking **Inventory / Asset tracking** as the
   industry ([4.4](#44-industries-and-modules)).
2. A **card** is the tag attached to an item — register one per asset
   (label it with the item name, e.g. "Projector #4" or "Drill — Bay 3").
3. A **card holder** is whoever's currently responsible for the item — a
   person, or a department/team if you don't need to track named
   individuals. [Assign](#66-card-lifecycle-block-unblock-lost-retire) an
   item's card to a holder when it's checked out to them; unassign it when
   it's returned to general stock.
4. An **access zone** works well as a storage location ("Warehouse A",
   "Tool Crib", "Server Room Rack 3") — grant a card access to the zone it's
   currently stored in/expected to be in.
5. **Attendance**'s check-in/check-out pairing doubles as a borrow/return
   log: tap an item's card out when it leaves, tap it again when it comes
   back — [6.15](#615-attendance-check-in--check-out) gives you a
   chronological record of who had what and when, without building a
   separate checkout system.
6. Lost or damaged item: **Mark lost** or **Retire** the card, same as any
   other lifecycle event.
7. Use a [card template](#63-card-templates) if you want to write
   structured data onto the tag itself (asset ID, category, purchase date)
   for fast offline scanning — otherwise the card's label and holder
   assignment alone are enough for most inventories.
8. Item needs service or repair? Open a ticket for it from **Maintenance**
   ([6.17](#617-maintenance)) instead of just leaving a note somewhere —
   it's tracked against the item's card with its own open/in-progress/
   resolved status.

### 7.6 e-Healthcare

1. Register your clinic/hospital as a company, picking **e-Healthcare** as
   the industry ([4.4](#44-industries-and-modules)) — this turns on the
   National ID / citizen data module, used here for patient identification.
2. Create a MIFARE Classic template with an **encrypted citizen record**
   ([6.5](#65-storing-structured-data-on-a-card-businessuniversity-ids-and-random-per-card-keys)).
   Click **Load Patient ID preset** in the citizen record editor to fill in
   a starting field set — full name, patient ID, date of birth, blood type,
   known allergies, and emergency contact.
   **This is an identity/lookup card, not a medical chart.** Keep it to
   fields useful for fast identification and emergency response; the
   patient's actual clinical record (diagnoses, treatment history,
   prescriptions) belongs in a real EHR system, not encoded onto a physical
   card that can be lost, cloned, or stolen. As with the National ID
   preset, fingerprint data is deliberately excluded — this platform talks
   to RFID/NFC encoders, not fingerprint scanners.
3. At enrollment: register the patient's card, **Generate random keys** on
   it, then use the **Encrypted citizen data** panel in Live Encode to
   write their details.
4. At the point of care: tap the card, **Read from card** to pull up
   identification fast — useful when the patient can't provide details
   themselves (unconscious, language barrier) — then look up their full
   chart in your actual clinical system using the patient ID.
5. Still create a [card holder](#62-card-holders) record for search and
   reporting, same as any other card.
6. Lost card: **Mark lost**, issue a replacement with freshly generated
   keys.

## 8. Setting up a physical encoder

The cloud dashboard never talks to hardware directly — a small local agent
process bridges a physical reader to your dashboard. A browser can't reach
USB/serial hardware directly (that's a browser security restriction, not a
limitation of this platform), so *something* has to run on the machine with
the reader plugged in — but you don't need this platform's source code,
a database, or a development setup to do it.

1. From **Encoders**, click **Register encoder**, fill in name/type/
   connection/location, then save.
2. A **"Set up the local agent"** panel appears. Confirm the **Agent server
   URL** (pre-filled with this page's address — only change it if the
   reader's machine reaches your server through a different URL), then click
   **Download agent for &lt;name&gt;**. You get a small `.zip` with the
   server URL and a one-time **agent key** already filled in — no manual
   copy/paste, and it's never shown again after you close this panel (you
   can always download a fresh one later via **Rotate key**, which
   invalidates the old one).
3. Copy that `.zip` to the machine physically connected to the reader,
   unzip it, and run:
   ```bash
   npm install     # pulls in just the ~3 packages the agent needs — not this
                    # platform's full source/build tooling. nfc-pcsc (the PC/SC
                    # driver) is optional; on Linux it needs PC/SC Lite
                    # (`libpcsclite-dev`) — Windows/macOS use the built-in
                    # Smart Card service automatically.
   npm start
   ```
   Leave it running for as long as this machine should be able to encode
   cards (set it up as a startup item/service if it should always be on).
4. Once connected, the encoder's status flips to **Online** across every
   connected dashboard in real time, and it becomes selectable on
   **Live Encode**.
5. If the agent key leaks, is lost, or you're setting up a replacement PC,
   use **Rotate key** to invalidate the old one and download a fresh
   package. Deleting the encoder retires it entirely.

Prefer running from source instead of downloading a package (e.g. you're
actively developing against this platform)? Every "Set up the local agent"
panel has an **Advanced: run it from source instead** section with the
manual `AGENT_SERVER_URL=... AGENT_KEY=... npm run agent` command run from
`server/` in a full clone of this repo — functionally identical, just more
setup.

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
  docker compose up -d --build
```

The `server` container runs `prisma migrate deploy` automatically on boot
before starting the API. For a real production deployment beyond this
compose file, put the API behind TLS, point `DATABASE_URL` at a managed
Postgres instance, set a real `JWT_ACCESS_SECRET`/`ENCRYPTION_KEY` (never the
defaults from `.env.example`), and configure SMTP so password reset emails
actually send.

If you ever need to change `JWT_ACCESS_SECRET` on a database that's already
in use, also truncate the `jwks` table (`psql "$DATABASE_URL" -c 'TRUNCATE
"jwks";'`) — otherwise better-auth can't decrypt the signing key it already
generated under the old secret, and every `GET /api/auth/token` call starts
failing with a 500 until it's cleared. This doesn't affect existing sessions
or passwords, just in-flight JWTs (users simply mint a new one).

## 11. Security notes

- Sector/page keys are encrypted at rest (AES-256-GCM); only `MANAGER`+
  roles can request the decrypted keys, and only via an authenticated,
  company-scoped request.
- Auth is handled by [better-auth](https://better-auth.com): passwords are
  hashed with scrypt, sessions are managed and revocable server-side (see
  [6.12](#612-your-profile-and-active-sessions)), and every app API call /
  the dashboard websocket authenticates with a separate short-lived (15 min)
  JWT minted from that session and verified statelessly via JWKS (no DB
  round-trip per request).
- Every tenant-scoped endpoint enforces company isolation in middleware,
  independent of what a client sends — a `MANAGER` at one company literally
  cannot address another company's card even by guessing its ID.
- Card-encoder allocation restrictions (6.7) are enforced in the same
  server-side layer that handles live encode commands, not just in the UI.
- A card's own `expiresAt` (used by Visitors, 6.16) is checked live in that
  same server-side layer and in the attendance service, not just via the
  once-a-day background job that flags/retires expired cards for
  reporting — a hotel-guest or contractor pass genuinely stops working the
  moment it lapses, not up to 24 hours later.
- Encrypted citizen records (6.5) use a per-card AES-256-GCM key that never
  leaves the server — the browser only ever handles opaque ciphertext bytes,
  unlike MIFARE sector keys (needed client-side to authenticate a
  read/write) or Card data panel text (encoded locally, in the clear).
  `OPERATOR`+ can encode/decode through this controlled channel; only
  `MANAGER`+ can view the raw key material itself.
- Self-service company registration is rate-limited to reduce abuse, and
  slug/email uniqueness is enforced at the database level.
- DESFire's destructive commands (create/delete application, delete file,
  format card) are role-gated to `MANAGER`+ server-side, on top of the
  existing company-scoping check — a `VIEWER`/`OPERATOR` cannot wipe a card
  or delete another partition even by calling the websocket API directly.
  See [6.14](#614-mifare-desfire-partitioning-applications--files) for the
  DESFire integration's specific cryptographic scope and limits.

## 12. Troubleshooting

| Symptom | Likely cause / fix |
|---|---|
| "Encoder is offline" when sending a command | The local agent for that encoder isn't running or lost connection — restart `npm run agent` on the machine with the reader plugged in. |
| "This card is not allocated to this encoder" | The card has an active encoder restriction (6.7) that doesn't include the encoder you're using — either add that encoder to its allowlist, or use an allowed one. |
| "This card's access to this encoder has expired" | The card's allocation to that encoder (6.7) had an expiry — e.g. a hotel guest's checkout time — and it has passed. Re-add the encoder with a new expiry to restore access. |
| Can't create a second company with the name/slug you want | Slugs are unique platform-wide — pick a different slug (the company name itself can repeat). |
| Password reset email never arrives | `SMTP_HOST` isn't configured — check the server console log instead; the reset link is printed there in that case. |
| `groupadd: Permission denied` during local dev setup | You're running as a non-root user on your own machine, which is the normal/expected case — this is handled automatically; if you still see it, make sure you're on the latest version of this repo. |
| Local dev database seems stuck/stale after a reboot | The auto-provisioned local Postgres restarts itself automatically on the next `npm run dev`/`npm test`; if something still seems off, delete `server/.local-db/` to force a clean re-provision (you'll lose local dev data, not anything real). |
| `GET /api/auth/token` returns `500 Failed to decrypt private key...` | `JWT_ACCESS_SECRET` was changed without clearing the `jwks` table on the same database — see [§10 Deployment](#10-deployment). Truncate the `jwks` table and it'll regenerate under the new secret on the next request. |

## 13. API quick reference

All endpoints are under `/api`, JSON in/out. Auth is powered by
[better-auth](https://better-auth.com) and is two-step: sign in (or sign up)
to get a session token, then mint a short-lived JWT from that session
(`GET /auth/token`) — the JWT is what every non-auth endpoint below expects
as `Authorization: Bearer <jwt>`. A handful of account-management endpoints
(session listing/revocation, sign-out, change-password, update-user)
authenticate with the session token directly instead — see
[api-requests.http](api-requests.http) for a runnable example of both. Every
list/detail endpoint is implicitly scoped to the caller's own company unless
they're `SUPER_ADMIN`.

| Area | Endpoints |
|---|---|
| Auth (better-auth) | `POST /auth/sign-in/email`, `POST /auth/sign-up/email`, `POST /auth/sign-out`, `GET /auth/token` (mint a JWT), `GET /auth/jwks`, `POST /auth/request-password-reset`, `POST /auth/reset-password`, `GET /auth/list-sessions`, `POST /auth/revoke-session`, `POST /auth/change-password`, `POST /auth/update-user` |
| Auth (this app) | `POST /auth/register-company` (atomic company + first admin user), `GET /auth/me` (profile, joins the company record) |
| Companies | `GET/POST /companies`, `GET/PATCH/DELETE /companies/:id` |
| Users | `GET/POST /users`, `GET/PATCH/DELETE /users/:id` |
| Card holders | `GET/POST /holders`, `GET/PATCH/DELETE /holders/:id` |
| Card templates | `GET/POST /templates`, `GET/PATCH/DELETE /templates/:id` |
| Encoders | `GET/POST /encoders`, `GET/PATCH/DELETE /encoders/:id`, `POST /encoders/:id/rotate-key` |
| Cards | `GET/POST /cards`, `GET/PATCH/DELETE /cards/:id`, `GET /cards/:id/keys`, `POST /cards/:id/keys/generate`, `POST /cards/:id/citizen-data/prepare-write`, `POST /cards/:id/citizen-data/decode-read`, `POST /cards/:id/assign`, `POST /cards/:id/unassign`, `POST /cards/:id/block`, `POST /cards/:id/unblock`, `POST /cards/:id/lost`, `POST /cards/:id/retire`, `POST /cards/:id/encoders/grant`, `POST /cards/:id/encoders/revoke`, `GET /cards/export`, `POST /cards/bulk-import` |
| Access zones | `GET/POST /zones`, `PATCH/DELETE /zones/:id`, `POST /zones/:id/grant`, `POST /zones/:id/revoke` |
| Attendance | `GET /attendance`, `GET /attendance/export`, `POST /attendance` |
| Maintenance | `GET /maintenance`, `POST /maintenance`, `PATCH /maintenance/:id` |
| Notifications | `GET /notifications`, `POST /notifications/:id/read`, `POST /notifications/read-all` |
| Dashboard | `GET /dashboard/stats` |
| Audit logs | `GET /logs`, `GET /logs/export` |
| Live encode (websocket, `/dashboard` namespace) | `encoder:command` (emit — includes MIFARE Classic/NTAG commands plus `LIST_APPLICATIONS`/`SELECT_APPLICATION`/`AUTH_APPLICATION`/`READ_FILE`/`WRITE_FILE`/`CREATE_APPLICATION`/`CREATE_FILE`/`DELETE_FILE`/`DELETE_APPLICATION`/`FORMAT_PICC` for DESFire — see [6.14](#614-mifare-desfire-partitioning-applications--files)), `encoder:status` / `card:detected` / `encoder:commandResult` (listen) |
| Hardware agent (websocket, `/agent` namespace) | authenticates with an encoder's `agentKey`; emits `heartbeat`, `card:detected`, `command:result`; listens for `command` |

For a runnable, pre-chained example of the REST calls (login → register a
company/card → block it → check the resulting notification), open
[`api-requests.http`](api-requests.http) at the repo root with VS Code's
REST Client extension.
