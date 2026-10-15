import "server-only";
import { PrismaMariaDb } from "@prisma/adapter-mariadb";
import { PrismaClient } from "@prisma/client";
import { requireEnvironment } from "@/lib/config";

const globalForPrisma = globalThis as unknown as { prisma?: PrismaClient };

export function getDb() {
  if (!globalForPrisma.prisma) {
    const adapter = new PrismaMariaDb(requireEnvironment("DATABASE_URL"));
    globalForPrisma.prisma = new PrismaClient({ adapter });
  }
  return globalForPrisma.prisma;
}
