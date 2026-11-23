/**
 * A célula EFETIVA de uma venda (RIFA-088, docs/decisions.md D41; migração 0020), num lugar só: os trechos de SQL que
 * toda consulta que liga venda a célula usa, em vez de repetir a regra.
 *
 * Célula efetiva = a do afiliado do pedido (`afiliados.celula_id`, resolvida na leitura, D7), se houver; senão, a
 * atribuída à mão pelo admin (`pedidos.celula_atribuida_id`); senão, sem célula. A do afiliado sempre vence: se o
 * afiliado ganhar célula depois da atribuição, a atribuída continua gravada, mas não conta.
 *
 * Quem usa (cada uma com o plano dela, travado por teste): o painel e tudo o que sai dele (db/painel.ts: rankings,
 * resumo, metas, /minha, telão, bumbo, relatórios, arrecadado), a lista de pedidos e os filtros por célula
 * (db/lista-pedidos.ts), a leitura do item na desconsideração e na atribuição (db/regras-campanha.ts,
 * db/celula-atribuida.ts), os suspeitos, os bilhetes, a planilha de compradores, os maiores compradores e o mapa por
 * DDD com divisão. A adesão lê a view `vendas_aprovadas`, recriada na 0020 com a mesma regra.
 *
 * Os trechos recebem o apelido do pedido e do afiliado (`p` e `a` por padrão). O afiliado entra por LEFT JOIN
 * (`juntarAfiliado`): pedido sem afiliado também tem célula efetiva, se foi atribuído.
 */

/** LEFT JOIN do afiliado do pedido. */
export const juntarAfiliado = (p = "p", a = "a") =>
  `LEFT JOIN afiliados AS ${a} ON ${a}.affiliate_id = ${p}.affiliate_id`;

/** A célula efetiva (id ou NULL). */
export const celulaEfetiva = (p = "p", a = "a") =>
  `coalesce(${a}.celula_id, ${p}.celula_atribuida_id)`;

/** De onde vem a célula efetiva: 'afiliado', 'manual' ou NULL (sem célula). */
export const origemDaCelula = (p = "p", a = "a") =>
  `CASE WHEN ${a}.celula_id IS NOT NULL THEN 'afiliado' WHEN ${p}.celula_atribuida_id IS NOT NULL THEN 'manual' END`;

/** LEFT JOIN da célula efetiva (apelido `c`). */
export const juntarCelulaEfetiva = (p = "p", a = "a", c = "c") =>
  `LEFT JOIN celulas AS ${c} ON ${c}.id = ${celulaEfetiva(p, a)}`;

/**
 * O pedido não tem célula PELO AFILIADO (sem afiliado, ou afiliado não vinculado), sem o JOIN: o afiliado sem célula
 * por uma subconsulta. É a condição para aceitar a atribuição e a do filtro "sem célula" (com `celula_atribuida_id IS
 * NULL`). Na lista de pedidos, o OR vira um MULTI-INDEX OR sobre o índice por afiliado (db/lista-pedidos.ts).
 */
export const semCelulaDoAfiliado = (p = "p") =>
  `(${p}.affiliate_id IS NULL OR ${p}.affiliate_id IN (
      SELECT affiliate_id FROM afiliados WHERE celula_id IS NULL))`;
