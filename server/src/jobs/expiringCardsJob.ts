import { prisma } from "../lib/prisma";
import { notifyCompanyAdmins } from "../services/notificationService";

const WARNING_WINDOW_DAYS = 7;
const DAY_MS = 24 * 60 * 60 * 1000;

// Flags cards expiring within the warning window (once per 24h per card) and
// auto-retires anything already past its expiry date.
export async function checkExpiringCards() {
  const now = new Date();
  const horizon = new Date(now.getTime() + WARNING_WINDOW_DAYS * DAY_MS);
  const dedupeSince = new Date(now.getTime() - DAY_MS);

  const expiringCards = await prisma.card.findMany({
    where: { expiresAt: { gte: now, lte: horizon }, status: { in: ["ACTIVE", "ASSIGNED"] } },
    select: { id: true, uid: true, label: true, companyId: true, expiresAt: true },
  });

  let expiringNotified = 0;
  for (const card of expiringCards) {
    const link = `/cards/${card.id}`;
    const alreadyNotified = await prisma.notification.findFirst({
      where: { type: "CARD_EXPIRING", link, createdAt: { gte: dedupeSince } },
    });
    if (alreadyNotified) continue;

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
    where: { expiresAt: { lt: now }, status: { in: ["ACTIVE", "ASSIGNED"] } },
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
