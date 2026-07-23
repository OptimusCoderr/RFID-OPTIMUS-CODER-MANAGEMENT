# Selling this: production readiness, certification, and safety

You asked for "a rigid hardware system so I can sell it to people" plus a
battery. Both are addressed here and in the updated schematic/BOM/firmware —
but the single most important thing in this document is the one thing I
can't design or code my way around, so it goes first, not buried at the
bottom.

## The part I can't do for you

**I am not an accredited test lab, and nothing in this repository
constitutes regulatory certification, a safety approval, or legal
compliance.** Selling a WiFi-connected, battery-powered electronic device
to other people is regulated in essentially every market, and the
requirements below are real legal/safety gates — not paperwork you can
skip because the design is sound, and not something a design review here
substitutes for:

- **FCC (United States)** — Part 15 covers both the intentional radiator
  (the WiFi/BT radio) and unintentional radiators (everything else on the
  board that generates RF noise as a side effect — the ESP32's own clock,
  the W5500, switching regulators). The ESP32-WROOM-32E module itself
  carries its own FCC modular certification from Espressif (the
  "grantee") — genuinely useful, since it means you're not certifying the
  *radio* from scratch — **but only if you follow the module's exact
  certification conditions**: the specific antenna it was certified with,
  required PCB keep-out zones around it, and no modifications to its RF
  section. The *finished product* (this board, in its enclosure, with its
  own power supply and other components) still needs its own Part 15B
  unintentional-radiator testing at an accredited lab before you can
  legally sell it in the US. Check the module's actual FCC grant (search
  the FCC ID printed on the module, or in Espressif's documentation) for
  the exact conditions before assuming you're covered.
- **CE marking (EU)** — the Radio Equipment Directive (RED, 2014/53/EU)
  covers the RF side, with the same "module has its own certification, but
  the finished product needs its own assessment" caveat as FCC. RoHS
  compliance (restricted materials) applies to anything with a CE mark.
- **UKCA (UK)** — broadly parallel to CE post-Brexit; check current
  requirements if the UK is a target market.
- **Battery-specific**: **UN38.3** (transport testing — required to ship
  lithium cells at all, especially internationally or by air, whether
  loose or installed in a product) and **IEC 62133-2** (battery pack
  safety certification, increasingly required by retailers/marketplaces
  and some jurisdictions independent of whether it's legally mandated
  where you are). If you ship units with BATT1 already populated, both of
  these become real requirements, not nice-to-haves.
- **UL 294** (or equivalent regional safety listing) — this is
  specifically the standard for **access control system units**, which is
  exactly what this device is. Not universally legally mandated, but very
  commonly *expected* by commercial security integrators, insurers, and
  some jurisdictions' electrical/fire codes — particularly relevant here
  because this board switches a relay that a customer will wire into a
  door lock or strike, which can have life-safety implications (egress
  requirements) that are installation-specific and outside what any board
  design can guarantee on its own.

None of this is optional if "sell it to people" means what it normally
means. Budget real time (often weeks) and real money (often several
thousand dollars per certification path) for accredited lab testing
before a legal sale in any of these markets. Many labs offer a cheaper
"pre-compliance scan" before the formal (expensive) test — worth doing
first, since it catches problems while they're still cheap to fix.

**Also get a lawyer to review your actual sales terms, warranty language,
and liability disclaimers** — especially given the access-control angle
(a failure here can mean someone gets locked in or out of a building) —
and **get product liability insurance** before shipping units to other
people. Both are standard, expected costs of selling physical hardware;
neither is something this document or a design review substitutes for.

## What "rigid" means in this revision, concretely

A prototype you build for yourself can skip all of this. A board that
gets wired up by someone who isn't you, in an install you'll never see,
can't:

- **Reverse-polarity protection** (Q5, P-channel MOSFET) on the 12–24V DC
  input — a wiring mistake during install doesn't fry the board.
- **Resettable fuse** (F1) on the same input — a downstream short doesn't
  require a truck roll to fix, and doesn't start a fire either.
- **TVS diodes** (D5, D6) on both power inputs — absorb ESD/surge events
  from the field instead of passing them through to the rest of the board.
- **Dedicated Li-ion protection IC + MOSFET pair** (U7/Q4) on the battery,
  regardless of whether the 18650 you source already has its own
  protection — this board never assumes the end user (or you, sourcing
  cells later) got that detail right.
- See `schematic/pinout.md`'s "Input protection" and "Battery power
  system" sections, and `schematic/BOM.md`, for the full parts list.

What it does *not* mean: manufacturable Gerbers (see `README.md` — this
is still a hand-authored reference diagram, not a KiCad export), a
finished enclosure, or anything above the "accredited lab" line.

## Battery system

Added per your request — see `schematic/pinout.md`'s "Battery power
system" section for the full circuit description. Summary:

- **Single 18650 Li-ion cell, in a holder** — not a soldered-in pouch
  cell. This is deliberate for a sold product: end users (or you, later)
  need to be able to replace a degraded cell without opening the board up
  with a soldering iron next to a lithium cell. It also keeps the battery
  itself out of the BOM (see below) — you (or a distributor) source and
  ship cells separately, which matters for the UN38.3/IEC 62133 point above.
- **MCP73871** handles charging + power-path management as one IC: the
  board runs from whichever of {DC/USB-C input, battery} is actually
  present, switching automatically, while charging the battery whenever
  the input is present — no firmware involvement needed for any of that.
- **MT3608 boost converter** brings the battery's 3.0–4.2V back up to a
  clean 5V (needed because the existing 3.3V LDO needs more headroom on
  its input than a battery alone provides), merging into the existing 5V
  rail alongside the USB-C/DC-buck sources via one more diode.
- **MAX17048 fuel gauge** reports state-of-charge over I2C — see
  `firmware/src/BatteryMonitor.h`/`.cpp`, wired into `main.cpp` to show a
  solid amber LED (`Status::LOW_BATTERY`) below 15% charge (`Battery::LOW_PERCENT`
  in `Config.h`).
- Populating the battery subsystem is **optional per-unit** — a board
  built without BATT1/U6–U9 (a mains-only or PoE-only deployment) simply
  won't have anything answer on the fuel gauge's I2C bus, and
  `BatteryMonitor::begin()` reports that rather than blocking the rest of
  the firmware. Same board design either way; populate the battery parts
  or don't, per SKU.

**Runtime**: not measured (no physical unit exists yet to measure it on —
see `README.md`'s standing "not built or run against real hardware"
disclosure). A rough, honest estimate: a 3000mAh 18650 against this
board's likely average draw (ESP32 WiFi idle-to-burst + PN532 polling +
occasional relay pulses, Ethernet unused on battery) is probably in the
single-digit-hours-to-about-a-day range depending on tap frequency and
WiFi signal quality, not weeks — this is a battery for **bridging power
interruptions and portability during install/testing**, not a
primarily-battery-powered access point. If you need multi-day-plus
runtime, that's a different design point (larger cell capacity, deep
sleep between polls, WiFi duty-cycling) worth scoping separately rather
than assumed here.

## Enclosure and mechanical (assumptions stated — correct me if wrong)

No enclosure design exists yet (out of scope for a schematic either way —
see `README.md`). Assumptions baked into the guidance below; revisit if
they don't match your actual deployment:

- **Indoor use assumed.** IP54 (dust + splash resistant) is a reasonable
  target for a wall-mounted indoor access-control reader. If this needs
  to survive outdoor exposure, that's a materially different (and bigger)
  enclosure job — sealed/gasketed cable glands instead of an open USB-C
  port, a higher IP65+/IK-rated enclosure, and likely relocating or
  potting the DC input connector. Flag this now if it's actually needed,
  since it changes J1/J2's mechanical design, not just the box around them.
- **Non-metal enclosure, front face at minimum.** The PN532's antenna
  needs a low-attenuation path to a tapped card — aluminum (or any
  conductive) enclosure over the antenna area will significantly reduce
  read range or block reads outright. Polycarbonate/ABS is the standard
  choice for NFC-reader enclosures for exactly this reason.
- **Flame-retardant material (UL94 V-0) recommended** given there's a
  lithium cell inside — a reasonable baseline expectation for anything
  with a battery, independent of formal certification status.
- **Tamper-resistant fasteners** (e.g. Torx security bits) pair naturally
  with the existing SW2 tamper switch for anti-theft/anti-tamper
  deployments — the switch alone doesn't stop someone with a standard
  screwdriver from getting inside undetected until they actually lift the
  lid.
- **Strain relief** at every fixed cable entry (DC input, relay/lock
  wiring) — a pulled cable shouldn't be able to yank a connector off the
  board.

## Manufacturing / going from one board to a production run

- **Board revision + serial number**: add a silkscreen revision marker and
  a serial number field (hand-written, a sticker, or a small QR code pad)
  before running more than a handful of units — you will want to know
  which batch/BOM revision a specific returned/failed unit came from.
- **Test points**: bring the 3.3V, 5V, and battery rails out to accessible
  pads (even just exposed vias) so a simple go/no-go continuity-and-voltage
  jig can check every unit before it ships, without needing a full
  bring-up per board.
- **Get quotes early**: send the BOM to a PCB assembly house (JLCPCB,
  PCBWay, and many others all do turnkey fab+assembly) before finalizing
  a production run — they'll flag part availability/lead-time/MOQ issues
  and any footprint problems during their own DFM review, which is a much
  cheaper time to catch them than after boards are populated.
- **Burn-in before shipping**: power every unit on for 24–48 hours before
  boxing it — standard practice for catching infant-mortality component
  failures (a marginal solder joint, a bad IC) before a customer finds
  them instead of you.
- **Conformal coating** is worth considering if units will see humidity
  near entryways (condensation, cleaning products) — an optional
  post-assembly step most assembly houses can quote.

## Pre-ship QA

`TESTING.md`'s 23-point bring-up checklist is written for validating the
*design* once. For a *production run*, every individual unit should pass
at least an abbreviated pass of it before it ships — power-on, one NFC tap
test, network-connect test, relay-click test — cheap insurance against
shipping a unit with an assembly defect the full bring-up would have
caught. Treat `TESTING.md` as the source for what "abbreviated" should
still cover, not a one-time exercise.
