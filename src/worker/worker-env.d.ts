// Tipos dos bindings do Worker. Espelham o wrangler.jsonc: ao criar um binding
// (D1, KV, secret...) lá, declare-o aqui também.
declare namespace Cloudflare {
  interface Env {
    DB: D1Database;
    // Segredo do webhook da Rifei (D6): .dev.vars no dev, `wrangler secret put` em
    // produção, binding de teste no vitest.config.ts. Ausente ou vazio: o webhook responde 503.
    RIFEI_WEBHOOK_TOKEN?: string;
    // Token do login na Rifei para a API interna do painel (RIFA-070, D32): alternativa ao token colado na tela
    // (Acessos → Conexão com a Rifei), que tem prioridade. `wrangler secret put RIFEI_API_TOKEN`; .dev.vars no dev.
    RIFEI_API_TOKEN?: string;
    // Chave que cifra no D1 o token colado na tela (RIFA-070, D32; lib/cifra-rifei.ts): ao menos 32 caracteres
    // (`openssl rand -base64 32`), `wrangler secret put RIFEI_CHAVE_CIFRA`. Sem ela, a tela não guarda o token.
    RIFEI_CHAVE_CIFRA?: string;
    // Rate Limiting do Workers (RIFA-013b, `ratelimits` no wrangler.jsonc; lib/limite-requisicoes.ts).
    // Opcionais: sem o binding, o limite cai para a memória do isolate.
    LIMITE_PUBLICO?: RateLimit;
    LIMITE_LOGIN?: RateLimit;
  }

  // Tipa o `exports` de "cloudflare:workers" (usado nos testes do Worker).
  interface GlobalProps {
    mainModule: typeof import("./index");
  }
}
