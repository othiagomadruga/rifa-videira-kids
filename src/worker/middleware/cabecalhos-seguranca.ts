/**
 * Cabeçalhos de segurança em todas as respostas da API (RIFA-007b). O site recebe os mesmos pelo
 * `public/_headers`, que o Vite copia para dist/client e o Workers Static Assets aplica (só nos arquivos
 * do site, nunca nas respostas do Worker). Um teste confere que as duas listas são iguais.
 *
 * - Referrer-Policy: no-referrer: nenhuma requisição leva a URL da página (o link /acesso/<token> não vaza).
 * - X-Content-Type-Options: nosniff: o navegador respeita o Content-Type (JSON não vira script).
 * - X-Frame-Options: DENY e Content-Security-Policy: frame-ancestors 'none': ninguém põe as páginas num
 *   iframe (clickjacking).
 * - Content-Security-Policy (RIFA-013): script, estilo, fonte e fetch só da própria origem, sem inline e
 *   sem eval (`default-src 'self'`), o que barra script injetado mesmo se um XSS aparecer; imagens também
 *   em `data:` (a seta do <select> no CSS); sem plugins, sem <base> e formulários só para a origem.
 *   O build do Vite não tem script nem estilo inline, e o React aplica `style={...}` pelo CSSOM, que a
 *   CSP não barra. No `npm run dev` o `_headers` não vale para o HTML (o preâmbulo inline do React Refresh
 *   segue funcionando). Conferido com `npm run preview` no Chrome em todas as telas (docs/acesso.md).
 *
 * Montagem: primeiro middleware do app, para valer também nos 401, 403, 404 e 500.
 */
import { createMiddleware } from "hono/factory";

export const CABECALHOS_SEGURANCA = {
  "Referrer-Policy": "no-referrer",
  "X-Content-Type-Options": "nosniff",
  "X-Frame-Options": "DENY",
  "Content-Security-Policy":
    "default-src 'self'; img-src 'self' data:; object-src 'none'; base-uri 'none'; form-action 'self'; frame-ancestors 'none'",
} as const;

/**
 * A CSP da prévia do e-mail diário (RIFA-086, D40; GET /api/admin/relatorio-diario/previa, só admin): o HTML do e-mail
 * só tem estilos inline (`style="..."`), que a CSP de sempre barra. Esta é MAIS fechada em todo o resto (nada de
 * script, fetch, fonte nem formulário; imagem só `data:`) e libera só o estilo inline. É a única CSP que uma rota
 * pode pôr: qualquer outra é trocada pela de CABECALHOS_SEGURANCA.
 */
export const CSP_PREVIA_EMAIL =
  "default-src 'none'; style-src 'unsafe-inline'; img-src data:; base-uri 'none'; form-action 'none'; frame-ancestors 'none'";

export const cabecalhosSeguranca = createMiddleware(async (c, next) => {
  await next();
  const cspDaRota = c.res.headers.get("Content-Security-Policy");
  for (const [nome, valor] of Object.entries(CABECALHOS_SEGURANCA))
    c.header(
      nome,
      nome === "Content-Security-Policy" && cspDaRota === CSP_PREVIA_EMAIL
        ? CSP_PREVIA_EMAIL
        : valor,
    );
});
