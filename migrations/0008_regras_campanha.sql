-- 0008_regras_campanha.sql: regras do admin na campanha (RIFA-028, 029 e 032; docs/decisions.md D20). Aplica-se
-- depois de 0007. Aditiva para os dados: nenhuma linha muda; os pedidos de antes continuam contando como hoje e a
-- campanha fica com os padrões. Documentação: docs/modelo-de-dados.md (seções 3, 4 e 9). Consultas: src/worker/db/
-- (painel.ts, lista-pedidos.ts, pedidos-suspeitos.ts, mapa-ddd.ts, reconciliacao.ts e a view, lida em adesao.ts).
--
-- * campanhas: as chaves `pedidos.desconsiderar` (padrão desligada), `acesso.discipuladores` e `acesso.redes`
--   (padrão ligadas) e os quatro modelos das mensagens do WhatsApp (NULL = o padrão do contrato, MENSAGENS_PADRAO,
--   que a API devolve no lugar). O banco só confere o tamanho dos modelos; os marcadores, o contrato.
-- * pedidos: a desconsideração do admin (RIFA-028). As três colunas andam juntas: NULL nas três = o pedido conta.
--   Quem desconsiderou fica na trilha (auditoria), não aqui. O webhook nunca escreve nelas (db/pedidos.ts).
-- * Todo lugar que soma pedidos repete `desconsiderado_em IS NULL` (D20, OBRIGATÓRIO 4): o SQLite só usa um índice
--   parcial com a condição repetida na consulta. Sem o filtro, o painel cai no índice da 0007 com B-tree temporária.

ALTER TABLE campanhas ADD COLUMN pedidos_desconsiderar INTEGER NOT NULL DEFAULT 0
  CHECK (pedidos_desconsiderar IN (0, 1));
ALTER TABLE campanhas ADD COLUMN acesso_discipuladores INTEGER NOT NULL DEFAULT 1
  CHECK (acesso_discipuladores IN (0, 1));
ALTER TABLE campanhas ADD COLUMN acesso_redes INTEGER NOT NULL DEFAULT 1
  CHECK (acesso_redes IN (0, 1));
ALTER TABLE campanhas ADD COLUMN mensagem_link_coordenacao TEXT
  CHECK (mensagem_link_coordenacao IS NULL OR length(mensagem_link_coordenacao) BETWEEN 1 AND 1000);
ALTER TABLE campanhas ADD COLUMN mensagem_link_lider TEXT
  CHECK (mensagem_link_lider IS NULL OR length(mensagem_link_lider) BETWEEN 1 AND 1000);
ALTER TABLE campanhas ADD COLUMN mensagem_link_discipulador TEXT
  CHECK (mensagem_link_discipulador IS NULL OR length(mensagem_link_discipulador) BETWEEN 1 AND 1000);
ALTER TABLE campanhas ADD COLUMN mensagem_link_rede TEXT
  CHECK (mensagem_link_rede IS NULL OR length(mensagem_link_rede) BETWEEN 1 AND 1000);

ALTER TABLE pedidos ADD COLUMN desconsiderado_em TEXT
  CHECK (desconsiderado_em IS NULL OR strftime('%Y-%m-%dT%H:%M:%fZ', desconsiderado_em) IS desconsiderado_em);
ALTER TABLE pedidos ADD COLUMN desconsiderado_motivo TEXT
  CHECK ((desconsiderado_motivo IS NULL) = (desconsiderado_em IS NULL)
    AND (desconsiderado_motivo IS NULL OR desconsiderado_motivo IN ('teste', 'fraude', 'estorno', 'outro')));
ALTER TABLE pedidos ADD COLUMN desconsiderado_observacao TEXT
  CHECK (desconsiderado_observacao IS NULL
    OR (desconsiderado_em IS NOT NULL AND length(desconsiderado_observacao) BETWEEN 1 AND 140));

-- O índice da 0003, recriado com o mesmo nome e a condição nova: o desconsiderado sai dele. A coluna
-- desconsiderado_em no fim (sempre NULL aqui) mantém o índice de cobertura: o SQLite deduz `status` do
-- `status = 'approved'` do WHERE do índice, mas não deduz do `IS NULL`; sem ela, cada pedido volta à tabela.
DROP INDEX pedidos_aprovados_por_afiliado_dia;
CREATE INDEX pedidos_aprovados_por_afiliado_dia ON pedidos (
  campanha_id,
  affiliate_id,
  date(aprovado_em, '-180 minutes'),
  aprovado_em,
  qtd_bilhetes,
  total_centavos,
  desconsiderado_em
) WHERE status = 'approved' AND desconsiderado_em IS NULL;

-- A lista de pedidos com desconsiderado=true lê só os desconsiderados, na ordem da lista (db/lista-pedidos.ts).
CREATE INDEX pedidos_desconsiderados_por_registro ON pedidos (campanha_id, registrado_em, id)
  WHERE desconsiderado_em IS NOT NULL;

-- A view da 0001, recriada com a condição nova (as mesmas colunas e junções).
DROP VIEW vendas_aprovadas;
CREATE VIEW vendas_aprovadas AS
SELECT
  p.id               AS pedido_id,
  p.campanha_id      AS campanha_id,
  p.affiliate_id     AS affiliate_id,
  p.qtd_bilhetes     AS qtd_bilhetes,
  p.total_centavos   AS total_centavos,
  p.aprovado_em      AS aprovado_em,
  p.ddd              AS ddd,
  p.pais             AS pais,
  a.celula_id        AS celula_id,
  c.discipulador_id  AS discipulador_id,
  d.rede_id          AS rede_id,
  r.divisao          AS divisao
FROM pedidos AS p
LEFT JOIN afiliados AS a ON a.affiliate_id = p.affiliate_id
LEFT JOIN celulas AS c ON c.id = a.celula_id
LEFT JOIN discipuladores AS d ON d.id = c.discipulador_id
LEFT JOIN redes AS r ON r.id = d.rede_id
WHERE p.status = 'approved' AND p.desconsiderado_em IS NULL;
