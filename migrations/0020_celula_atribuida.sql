-- 0020_celula_atribuida.sql: a célula atribuída à mão pelo admin a um pedido sem célula pelo afiliado (RIFA-088;
-- docs/decisions.md D41). Aplica-se depois de 0019. Documentação: docs/modelo-de-dados.md (seções 4 e 9).
-- Pedido do PO (23/11): um comprador da célula Bunker comprou pelo link geral (sem afiliado), e a venda não contava
-- para nenhuma célula. A célula de uma venda vinha só do afiliado (pedidos.affiliate_id → afiliados.celula_id, D7).
--
-- Aditiva para os dados: três colunas novas em pedidos, NULL em todos os pedidos que já existem (nenhum atribuído),
-- e nenhuma conta muda até o admin atribuir um pedido na tela Pedidos.
--
-- * Célula EFETIVA da venda = a do afiliado do pedido (afiliados.celula_id), se houver; senão, a atribuída
--   (pedidos.celula_atribuida_id); senão, sem célula. A atribuição só é aceita quando o pedido não tem célula pelo
--   afiliado (a API confere); se o afiliado ganhar célula depois, a dele vence (a atribuída fica gravada, mas não conta).
-- * As três colunas andam juntas (nulas juntas ou preenchidas juntas). `celula_atribuida_por` é o id do admin
--   (usuarios.id), sem chave estrangeira: quem fez também fica na trilha (`pedido.atribuir_celula`).
-- * A célula atribuída é RESTRICT, como afiliados.celula_id: a célula com venda atribuída não é apagada (409 em_uso).
-- * O webhook nunca escreve nestas colunas (o UPSERT de db/pedidos.ts não as lista), como as da desconsideração (0008).
--
-- O índice de cobertura do painel (0003, recriado na 0008) é recriado com `celula_atribuida_id` logo depois de
-- `affiliate_id`: a leitura do painel agrupa por afiliado, célula atribuída e dia na ordem do índice (sem B-tree
-- temporária, 1 linha lida por pedido) e resolve a célula efetiva só nas linhas agrupadas (db/painel.ts). A view
-- vendas_aprovadas (lida pela adesão, db/adesao.ts) é recriada com a célula efetiva.

ALTER TABLE pedidos ADD COLUMN celula_atribuida_id INTEGER REFERENCES celulas (id) ON DELETE RESTRICT
  CHECK (celula_atribuida_id IS NULL OR typeof(celula_atribuida_id) = 'integer');
ALTER TABLE pedidos ADD COLUMN celula_atribuida_em TEXT
  CHECK ((celula_atribuida_em IS NULL) = (celula_atribuida_id IS NULL)
    AND (celula_atribuida_em IS NULL
      OR strftime('%Y-%m-%dT%H:%M:%fZ', celula_atribuida_em) IS celula_atribuida_em));
ALTER TABLE pedidos ADD COLUMN celula_atribuida_por INTEGER
  CHECK ((celula_atribuida_por IS NULL) = (celula_atribuida_id IS NULL)
    AND (celula_atribuida_por IS NULL OR typeof(celula_atribuida_por) = 'integer'));

-- Os pedidos atribuídos de cada célula (o filtro por célula da lista de pedidos e o RESTRICT ao apagar a célula).
-- Parcial: quase todos os pedidos ficam sem atribuição.
CREATE INDEX pedidos_por_celula_atribuida ON pedidos (celula_atribuida_id)
  WHERE celula_atribuida_id IS NOT NULL;

-- O índice da 0008, recriado com o mesmo nome, a mesma condição e celula_atribuida_id depois de affiliate_id.
DROP INDEX pedidos_aprovados_por_afiliado_dia;
CREATE INDEX pedidos_aprovados_por_afiliado_dia ON pedidos (
  campanha_id,
  affiliate_id,
  celula_atribuida_id,
  date(aprovado_em, '-180 minutes'),
  aprovado_em,
  qtd_bilhetes,
  total_centavos,
  desconsiderado_em
) WHERE status = 'approved' AND desconsiderado_em IS NULL;

-- A view da 0008, recriada com a célula efetiva (as mesmas colunas, a mesma condição).
DROP VIEW vendas_aprovadas;
CREATE VIEW vendas_aprovadas AS
SELECT
  p.id                                         AS pedido_id,
  p.campanha_id                                AS campanha_id,
  p.affiliate_id                               AS affiliate_id,
  p.qtd_bilhetes                               AS qtd_bilhetes,
  p.total_centavos                             AS total_centavos,
  p.aprovado_em                                AS aprovado_em,
  p.ddd                                        AS ddd,
  p.pais                                       AS pais,
  coalesce(a.celula_id, p.celula_atribuida_id) AS celula_id,
  c.discipulador_id                            AS discipulador_id,
  d.rede_id                                    AS rede_id,
  r.divisao                                    AS divisao
FROM pedidos AS p
LEFT JOIN afiliados AS a ON a.affiliate_id = p.affiliate_id
LEFT JOIN celulas AS c ON c.id = coalesce(a.celula_id, p.celula_atribuida_id)
LEFT JOIN discipuladores AS d ON d.id = c.discipulador_id
LEFT JOIN redes AS r ON r.id = d.rede_id
WHERE p.status = 'approved' AND p.desconsiderado_em IS NULL;
