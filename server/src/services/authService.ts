import { prisma } from "../lib/prisma.js";
import { auth } from "../auth/index.js";
import { ApiError } from "../utils/ApiError.js";

interface RegisterCompanyInput {
  companyName: string;
  slug: string;
  contactEmail?: string;
  fullName: string;
  email: string;
  password: string;
}

// Self-service sign-up: a new business (hotel, university, etc) registers
// itself and its first user, who becomes COMPANY_ADMIN of a brand-new
// company. No SUPER_ADMIN involvement needed.
//
// better-auth's signUpEmail doesn't run inside an arbitrary caller-supplied
// Prisma transaction, so this can't be a single atomic transaction the way
// it was against our own hand-rolled auth. Instead: create the company
// first, then create the user with that companyId — if user creation
// fails, delete the just-created company as a compensating action so a
// failed sign-up never leaves an orphaned, admin-less company behind.
export async function registerCompany(input: RegisterCompanyInput) {
  const company = await prisma.company.create({
    data: {
      name: input.companyName,
      slug: input.slug,
      contactEmail: input.contactEmail,
    },
  });

  try {
    const result = await auth.api.signUpEmail({
      body: {
        name: input.fullName,
        email: input.email,
        password: input.password,
        role: "COMPANY_ADMIN",
        companyId: company.id,
      },
    });
    return result;
  } catch (err) {
    await prisma.company.delete({ where: { id: company.id } }).catch(() => undefined);
    if (err instanceof Error) throw ApiError.badRequest(err.message);
    throw err;
  }
}
