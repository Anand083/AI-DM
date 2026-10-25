/**
 * Makes an existing user a super admin.
 *
 *   pnpm admin:create --email you@example.com
 *
 * The person must have signed up and confirmed their email first. Use --remove to take the
 * role away again.
 */
import "../src/server/load-env";
import { PrismaClient } from "@prisma/client";

export function parseArgs(argv: string[]): { email: string | null; remove: boolean } {
  const index = argv.indexOf("--email");
  const email = index >= 0 ? (argv[index + 1] ?? "").trim().toLowerCase() : "";
  return { email: email || null, remove: argv.includes("--remove") };
}

async function main() {
  const { email, remove } = parseArgs(process.argv.slice(2));
  if (!email) {
    console.error("Usage: pnpm admin:create --email you@example.com [--remove]");
    process.exit(1);
  }
  const prisma = new PrismaClient();
  try {
    const user = await prisma.user.findUnique({ where: { email } });
    if (!user) {
      console.error(`No user with the email ${email}. Sign up first, then run this again.`);
      process.exit(1);
    }
    if (!user.emailVerified) {
      console.error(`${email} has not confirmed their email yet. Confirm it first.`);
      process.exit(1);
    }
    await prisma.user.update({ where: { id: user.id }, data: { isSuperAdmin: !remove } });
    console.log(remove ? `${email} is no longer a super admin.` : `${email} is now a super admin.`);
  } finally {
    await prisma.$disconnect();
  }
}

if (process.argv[1]?.endsWith("admin-create.ts")) void main();
