-- 0010_link_vendas.sql: modelo do link de vendas de cada célula (RIFA-046). Aplica-se depois de 0009. Documentação:
-- docs/decisions.md (D24) e docs/api.md (GET /api/minha/links-vendas, GET /api/admin/links-vendas e
-- PUT /api/admin/links-vendas/modelo).
--
-- * O link de afiliado da Rifei de cada líder sai deste modelo, com {slug} e {afiliado} (o affiliate_id do webhook).
--   NULL = o PO ainda não confirmou o formato com a Rifei.
-- * O banco só confere o tamanho (como as mensagens da 0008): o endereço (https://rifei.com.br/) e os marcadores
--   ficam no contrato (problemasDoModeloLinkVendas), que muda sem migração; o SQLite não troca o CHECK de uma
--   coluna sem recriar a tabela.
-- * Só o admin muda (PUT /api/admin/links-vendas/modelo); o PUT da campanha nunca escreve aqui. Quem mudou fica na
--   trilha (campanha.salvar).
ALTER TABLE campanhas ADD COLUMN link_vendas_modelo TEXT
  CHECK (link_vendas_modelo IS NULL OR length(link_vendas_modelo) BETWEEN 1 AND 300);
