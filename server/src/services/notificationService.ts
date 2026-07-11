import { NotificationType } from "@prisma/client";
import { prisma } from "../lib/prisma";
import { getIO } from "../websocket";

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

  await prisma.notification.createMany({
    data: recipients.map((r) => ({
      companyId,
      userId: r.id,
      type: input.type,
      title: input.title,
      message: input.message,
      link: input.link,
    })),
  });

  const notifications = await prisma.notification.findMany({
    where: { companyId, userId: { in: recipients.map((r) => r.id) }, title: input.title, message: input.message },
    orderBy: { createdAt: "desc" },
    take: recipients.length,
  });

  for (const n of notifications) pushToUser(n.userId, n);
  return notifications;
}
