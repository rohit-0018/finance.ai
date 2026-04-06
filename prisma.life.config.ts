// Prisma config for the Life app — points at a SEPARATE Supabase database.
// Use via: `prisma <cmd> --config prisma.life.config.ts` or the npm `life:db:*` scripts.
import "dotenv/config";
import { defineConfig } from "prisma/config";

export default defineConfig({
  schema: "prisma/life/schema.prisma",
  migrations: {
    path: "prisma/life/migrations",
  },
  datasource: {
    url: process.env["LIFE_DATABASE_URL"],
  },
});
