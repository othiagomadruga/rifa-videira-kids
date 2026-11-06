// Tipos dos bindings do Worker. Espelham o wrangler.jsonc: ao criar um binding
// (D1, KV, secret...) lá, declare-o aqui também.
declare namespace Cloudflare {
  interface Env {
    DB: D1Database;
    // Segredo do webhook da Rifei (D6): .dev.vars no dev, `wrangler secret put` em
    // produção, binding de teste no vitest.config.ts. Ausente ou vazio: o webhook responde 503.
    RIFEI_WEBHOOK_TOKEN?: string;
  }

  // Tipa o `exports` de "cloudflare:workers" (usado nos testes do Worker).
  interface GlobalProps {
    mainModule: typeof import("./index");
  }
}
