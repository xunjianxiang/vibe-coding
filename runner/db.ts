import { PrismaMariaDb } from "@prisma/adapter-mariadb";
import { PrismaClient } from "@prisma/client";
import { requireEnvironment } from "@/lib/config";

export function createRunnerDb() {
  return new PrismaClient({ adapter: new PrismaMariaDb(requireEnvironment("DATABASE_URL")) });
}
