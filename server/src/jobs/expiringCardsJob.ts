import { prisma } from "../lib/prisma.js";
import { notifyCompanyAdmins } from "../services/notificationService.js";
import { NON_TERMINAL_CARD_STATUSES } from "../utils/cardStatus.js";

const WARNING_WINDOW_DAYS = 7;
const DAY_MS = 24 * 60 * 60 * 1000;

// Live enforcement of a card's expiry doesn't depend on this job (see the
// direct expiresAt checks in websocket/index.ts and attendanceService.ts)
// — this job only handles the once-a-day notification/status-cleanup side,
// which is too coarse-grained to be the actual access-control mechanism.

// Flags cards expiring within the warning window (once per 24h per card) and
// auto-retires anything already past its expiry date.
export async function checkExpiringCards() {
  const now = new Date();
  const horizon = new Date(now.getTime() + WARNING_WINDOW_DAYS * DAY_MS);
  const dedupeSince = new Date(now.getTime() - DAY_MS);

  const expiringCards = await prisma.card.findMany({
    where: { expiresAt: { gte: now, lte: horizon }, status: { in: NON_TERMINAL_CARD_STATUSES } },
    select: { id: true, uid: true, label: true, companyId: true, expiresAt: true },
  });

  // One batched lookup instead of one per card — this list grows with
  // every short-lived Visitors pass approaching its expiry, so an N+1 here
  // would scale with visitor traffic, not just the (much smaller) set of
  // long-lived assigned cards this job originally had to deal with.
  const alreadyNotifiedLinks = new Set(
    (
      await prisma.notification.findMany({
        where: {
          type: "CARD_EXPIRING",
          link: { in: expiringCards.map((c) => `/cards/${c.id}`) },
          createdAt: { gte: dedupeSince },
        },
        select: { link: true },
      })
    ).map((n) => n.link)
  );

  let expiringNotified = 0;
  for (const card of expiringCards) {
    const link = `/cards/${card.id}`;
    if (alreadyNotifiedLinks.has(link)) continue;

    const daysLeft = Math.max(1, Math.ceil((card.expiresAt!.getTime() - now.getTime()) / DAY_MS));
    await notifyCompanyAdmins(card.companyId, {
      type: "CARD_EXPIRING",
      title: "Card expiring soon",
      message: `${card.label ?? card.uid} expires in ${daysLeft} day${daysLeft === 1 ? "" : "s"}.`,
      link,
    });
    expiringNotified += 1;
  }

  const justExpired = await prisma.card.findMany({
    where: { expiresAt: { lt: now }, status: { in: NON_TERMINAL_CARD_STATUSES } },
    select: { id: true, uid: true, label: true, companyId: true },
  });

  for (const card of justExpired) {
    await prisma.card.update({ where: { id: card.id }, data: { status: "EXPIRED" } });
    await notifyCompanyAdmins(card.companyId, {
      type: "CARD_EXPIRED",
      title: "Card expired",
      message: `${card.label ?? card.uid} has expired and was automatically deactivated.`,
      link: `/cards/${card.id}`,
    });
  }

  return { expiringNotified, expired: justExpired.length };
}
