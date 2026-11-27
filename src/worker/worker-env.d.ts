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
    // Relatório diário por e-mail (RIFA-086 e RIFA-087, D40; lib/relatorio-diario-envio.ts). Opcionais
    // (docs/lancamento.md 3.8). Binding de envio de e-mail da Cloudflare (`send_email`, nome EMAIL), pelo Email Routing
    // do domínio. Sem ele, o envio só avisa no log e não falha.
    EMAIL?: SendEmail;
    // Destinatários, separados por vírgula: `wrangler secret put RELATORIO_EMAILS`. Nunca no repositório (é público).
    RELATORIO_EMAILS?: string;
    // Notificações de venda (Web Push, RIFA-095, D43; lib/web-push.ts). Opcionais: sem a pública ou sem a privada (ou
    // com uma delas vazia), o recurso fica desligado (GET /api/publico/notificacoes diz `ligadas: false`, a inscrição
    // responde 503 `nao_configurado` e nada é enviado). A pública e o `sub` ficam nos `vars` do wrangler.jsonc (não
    // são segredo); a privada é segredo: `wrangler secret put VAPID_PRIVATE_KEY` (docs/lancamento.md 3.9). Nunca no
    // repositório.
    VAPID_PUBLIC_KEY?: string;
    VAPID_PRIVATE_KEY?: string;
    VAPID_SUBJECT?: string;
  }

  // Tipa o `exports` de "cloudflare:workers" (usado nos testes do Worker).
  interface GlobalProps {
    mainModule: typeof import("./index");
  }
}
