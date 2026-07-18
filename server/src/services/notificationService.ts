import { NotificationType } from "@prisma/client";
import { prisma } from "../lib/prisma.js";
import { getIO } from "../websocket/index.js";

interface NotifyInput {
  type: NotificationType;
  title: string;
  message: string;
  link?: string;
}

function pushToUser(userId: string, notification: unknown) {
  try {
    getIO().of("/dashboard").to(`user:${userId}`).emit("notification:new", notification);
  } catch {
    // websocket server not up yet (e.g. during a one-off script) — safe to skip
  }
}

// Creates one notification per COMPANY_ADMIN/MANAGER in the company and pushes it live.
export async function notifyCompanyAdmins(companyId: string, input: NotifyInput) {
  const recipients = await prisma.user.findMany({
    where: { companyId, isActive: true, role: { in: ["COMPANY_ADMIN", "MANAGER"] } },
    select: { id: true },
  });

  if (recipients.length === 0) return [];

  // createManyAndReturn gives back exactly the rows this call just inserted
  // (matched by id, not by content) — the previous approach re-fetched "the
  // newest N notifications matching this title/message" afterward, which
  // could pick up another concurrent call's rows instead of this one's when
  // two calls share identical title/message (e.g. a flapping encoder
  // repeatedly going offline/online in quick succession).
  const notifications = await prisma.notification.createManyAndReturn({
    data: recipients.map((r) => ({
      companyId,
      userId: r.id,
      type: input.type,
      title: input.title,
      message: input.message,
      link: input.link,
    })),
  });

  for (const n of notifications) pushToUser(n.userId, n);
  return notifications;
}

// Same as notifyCompanyAdmins, but for several distinct notifications going
// to the same company's admins/managers in one call (e.g. the daily
// expiring-cards job, which otherwise re-fetches the same recipient list
// and round-trips the DB separately for every single card). Fetches
// recipients once and inserts every row in a single createManyAndReturn.
export async function notifyCompanyAdminsBatch(companyId: string, inputs: NotifyInput[]) {
  if (inputs.length === 0) return [];

  const recipients = await prisma.user.findMany({
    where: { companyId, isActive: true, role: { in: ["COMPANY_ADMIN", "MANAGER"] } },
    select: { id: true },
  });
  if (recipients.length === 0) return [];

  const notifications = await prisma.notification.createManyAndReturn({
    data: recipients.flatMap((r) =>
      inputs.map((input) => ({
        companyId,
        userId: r.id,
        type: input.type,
        title: input.title,
        message: input.message,
        link: input.link,
      }))
    ),
  });

  for (const n of notifications) pushToUser(n.userId, n);
  return notifications;
}
