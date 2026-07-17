import type { CardStatus } from "@prisma/client";

// Card statuses that aren't a terminal/deactivated state — a card can still
// be tapped/encoded (subject to its own expiresAt and any encoder
// allocation). Notably includes UNASSIGNED so a Visitors quick-issue pass
// (see VisitorsPage), which never progresses past that status, is still
// counted as "in use" by the expiring-cards job and dashboard stats.
export const NON_TERMINAL_CARD_STATUSES: CardStatus[] = ["UNASSIGNED", "ACTIVE", "ASSIGNED"];
