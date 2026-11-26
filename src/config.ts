// Reads the app's settings from environment variables (loaded from .env by Docker Compose)
// and checks them. If anything is wrong, the app stops with a clear message.
// Secret values are never printed.
import { z } from "zod";

const settingsSchema = z.object({
  ONCADE_API_KEY: z
    .string({ error: "is missing" })
    .min(1, "is empty")
    .startsWith("oncade_platform_test_", "must start with oncade_platform_test_ (test keys only)"),
  ONCADE_BUSINESS_ID: z.string({ error: "is missing" }).min(1, "is empty"),
  ONCADE_WEBHOOK_SECRET: z.string({ error: "is missing" }).min(1, "is empty"),
  PORT: z.coerce.number().int().positive().default(3000),
  DATABASE_PATH: z.string().min(1).default("/data/app.db"),
});

export type Config = z.infer<typeof settingsSchema>;

function loadConfig(): Config {
  const result = settingsSchema.safeParse(process.env);

  if (!result.success) {
    const problems = result.error.issues
      .map((issue) => `  - ${issue.path.join(".")} ${issue.message}`)
      .join("\n");
    console.error(
      `\nSettings problem in .env:\n${problems}\n\n` +
        `Fix .env, then reload it with: docker compose up -d app\n`,
    );
    process.exit(1);
  }

  return result.data;
}

export const config = loadConfig();
