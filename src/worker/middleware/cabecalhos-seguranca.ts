/**
 * Cabeçalhos de segurança em todas as respostas da API (RIFA-007b). O site recebe os mesmos pelo
 * `public/_headers`, que o Vite copia para dist/client e o Workers Static Assets aplica (só nos arquivos
 * do site, nunca nas respostas do Worker). Um teste confere que as duas listas são iguais.
 *
 * - Referrer-Policy: no-referrer: nenhuma requisição leva a URL da página (o link /acesso/<token> não vaza).
 * - X-Content-Type-Options: nosniff: o navegador respeita o Content-Type (JSON não vira script).
 * - X-Frame-Options: DENY e Content-Security-Policy: frame-ancestors 'none': ninguém põe as páginas num
 *   iframe (clickjacking).
 *
 * Montagem: primeiro middleware do app, para valer também nos 401, 403, 404 e 500.
 */
import { createMiddleware } from "hono/factory";

export const CABECALHOS_SEGURANCA = {
  "Referrer-Policy": "no-referrer",
  "X-Content-Type-Options": "nosniff",
  "X-Frame-Options": "DENY",
  "Content-Security-Policy": "frame-ancestors 'none'",
} as const;

export const cabecalhosSeguranca = createMiddleware(async (c, next) => {
  await next();
  for (const [nome, valor] of Object.entries(CABECALHOS_SEGURANCA))
    c.header(nome, valor);
});
