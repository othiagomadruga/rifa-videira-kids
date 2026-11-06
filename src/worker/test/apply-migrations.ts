// Setup dos testes do Worker: aplica as migrações (pasta migrations/) no D1 local
// dos testes. As migrações chegam pelo binding TEST_MIGRATIONS (vitest.config.ts).
import { applyD1Migrations, type D1Migration } from "cloudflare:test";
import { env } from "cloudflare:workers";

const { DB, TEST_MIGRATIONS } = env as Cloudflare.Env & {
  TEST_MIGRATIONS: D1Migration[];
};

await applyD1Migrations(DB, TEST_MIGRATIONS);
