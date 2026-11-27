-- 0021_avisos_de_venda.sql: a opção dos avisos de venda no ranking aberto e na /minha (RIFA-094; docs/decisions.md
-- D42). Aplica-se depois de 0020. Aditiva: uma coluna nova em campanhas, 1 (ligada) em todas as campanhas que já
-- existem; nenhum dado muda. Documentação: docs/modelo-de-dados.md (seção 3). Gravação e leitura:
-- src/worker/db/campanha.ts (`publico.avisos_de_venda` do contrato).
--
-- * 1 (o padrão): GET /api/publico/vendas-recentes devolve as vendas pagas dos últimos 3 minutos, e o ranking aberto
--   e a /minha mostram "A célula X vendeu N bilhetes!".
-- * 0: a rota responde a lista vazia e as telas não mostram nada.
ALTER TABLE campanhas ADD COLUMN publico_avisos_de_venda INTEGER NOT NULL DEFAULT 1
  CHECK (publico_avisos_de_venda IN (0, 1));
