import { defineConfig } from "drizzle-kit";

export default defineConfig({
  out: "./drizzle-baseline",
  schema: "./drizzle/schema.ts",
  dialect: "mysql",
  dbCredentials: {
    url: process.env.DATABASE_URL!,
  },
});
