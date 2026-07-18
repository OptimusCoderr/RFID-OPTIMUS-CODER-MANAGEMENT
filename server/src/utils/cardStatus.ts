import type { CardStatus } from "@prisma/client";

// Card statuses that aren't a terminal/deactivated state — a card can still
// be tapped/encoded (subject to its own expiresAt and any encoder
// allocation). Notably includes UNASSIGNED so a Visitors quick-issue pass
// (see VisitorsPage), which never progresses past that status, is still
// counted as "in use" by the expiring-cards job and dashboard stats.
export const NON_TERMINAL_CARD_STATUSES: CardStatus[] = ["UNASSIGNED", "ACTIVE", "ASSIGNED"];

// The complement of the above: a card in one of these statuses is locked out
// of active use entirely — blocks assign/unassign (cardController.ts),
// attendance (attendanceService.ts), and every non-read encoder command
// (websocket/index.ts). A single shared Set so all three enforcement points
// can never drift out of sync with each other.
export const LIFECYCLE_LOCKED_STATUSES: ReadonlySet<CardStatus> = new Set(["BLOCKED", "LOST", "RETIRED", "EXPIRED"]);
