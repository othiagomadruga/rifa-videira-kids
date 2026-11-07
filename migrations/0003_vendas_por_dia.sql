-- 0003_vendas_por_dia.sql: índice das vendas aprovadas por afiliado e dia local (RIFA-PAINEL). Aplica-se
-- depois de 0002. Aditiva: só cria um índice; nenhuma tabela, coluna ou dado muda.
-- Documentação: docs/modelo-de-dados.md (seção 4). Consulta: src/worker/db/painel.ts.
--
-- O painel, os rankings, o ranking público e o bumbo leem, a cada requisição, as vendas aprovadas da
-- campanha agrupadas por afiliado e dia local, e o D1 cobra por linha lida. Sem este índice, o GROUP BY
-- passa por uma B-tree temporária, que o D1 conta como mais uma linha lida por pedido. Com ele, os pedidos
-- já saem na ordem do GROUP BY (campanha, afiliado, dia): 1 linha lida por pedido.
-- * Parcial (status = 'approved'): só os pedidos que contam como venda (a consulta repete o filtro).
-- * O dia é o de UTC−3 sem horário de verão (America/Belem, o fuso padrão da campanha, D8):
--   date(aprovado_em, '-180 minutes'), EXATAMENTE a expressão da consulta (o SQLite só usa um índice de
--   expressão com a mesma expressão). Com um fuso de outro deslocamento, a consulta continua certa, sem
--   este índice. src/worker/db/painel.test.ts confere que a consulta de Belém usa o índice.
-- * aprovado_em, qtd_bilhetes e total_centavos fazem dele um índice de cobertura: a leitura não volta à
--   tabela (inclusive a de uma venda por vez, a dos fusos com horário de verão).
CREATE INDEX pedidos_aprovados_por_afiliado_dia ON pedidos (
  campanha_id,
  affiliate_id,
  date(aprovado_em, '-180 minutes'),
  aprovado_em,
  qtd_bilhetes,
  total_centavos
) WHERE status = 'approved';
