// Tipos dos bindings do Worker. Espelham o wrangler.jsonc: ao criar um binding
// (D1, KV, secret...) lá, declare-o aqui também.
declare namespace Cloudflare {
  interface Env {
    DB: D1Database;
  }

  // Tipa o `exports` de "cloudflare:workers" (usado nos testes do Worker).
  interface GlobalProps {
    mainModule: typeof import("./index");
  }
}
