# RFID/NFC Management System — local agent

This is the small local process that bridges a physical USB/serial card
reader (ACR122U, ACR1252U, PN532, OMNIKEY, etc) to your RFID/NFC Management
System dashboard. It's the only thing that needs to run on the machine
physically connected to the reader — the dashboard itself can be hosted
anywhere.

If you downloaded this from the dashboard's **Encoders → Download agent**
button, `.env` is already filled in for you and you can skip straight to
step 2 below.

## Setup

1. Make sure [Node.js](https://nodejs.org) 18+ is installed, then in this
   folder run:
   ```bash
   npm install
   ```
   This pulls in only the ~3 packages the agent actually needs — you do
   *not* need the platform's full source code, database, or build tooling
   for this step.

   `nfc-pcsc` (the PC/SC hardware driver) needs a system smart-card service
   to build against:
   - **Windows / macOS**: nothing extra — the built-in Smart Card service is
     used automatically.
   - **Linux**: install PC/SC Lite first, e.g. `sudo apt install libpcsclite-dev pcscd`
     on Debian/Ubuntu.

   If that package can't build on your machine, `npm install` still
   succeeds (it's an optional dependency) — the agent will run and connect,
   but hardware commands will fail with a clear "PC/SC not available"
   error until you fix the driver install and re-run `npm install`.

2. If `.env` wasn't already filled in for you, copy `.env.example` to
   `.env` and fill in `AGENT_SERVER_URL` and `AGENT_KEY` (from the
   dashboard's Encoders page).

3. Run it:
   ```bash
   npm start
   ```
   Leave it running in the background (or set it up as a service/startup
   item) for as long as this machine should be able to encode cards. The
   encoder's status flips to **Online** in the dashboard as soon as it
   connects, and back to **Offline** if this process stops.

## Updating

This package is a self-contained snapshot built from the platform's
source. If the platform is upgraded, download a fresh copy from the
dashboard (Encoders → your encoder → Download agent) rather than trying to
patch this one in place.
