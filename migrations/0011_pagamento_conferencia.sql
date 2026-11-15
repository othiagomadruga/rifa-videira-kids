-- 0011_pagamento_conferencia.sql: o "Recuperar" da conferência pelo CSV marca como pago o pedido do pagamento não
-- registrado (RIFA-056). Aplica-se depois de 0010. Aditiva: uma coluna nova em pedidos, NULL em todos os pedidos que
-- já existem, e um índice parcial; nenhum dado muda. Documentação: docs/decisions.md (D19, adendo da RIFA-056) e
-- docs/integracao-rifei.md (seção 10). Gravação: src/worker/db/reconciliacao.ts.
--
-- * O pedido que chegou pelo webhook como novo (in_process) ou expirou, e que o CSV da Rifei diz que está pago, vira
--   'approved' com a data do pagamento do arquivo (o que o "Pedido pago" faria). Quantidade, valor e afiliado não
--   mudam (o arquivo precisa confirmá-los), nem `origem`: o pedido continua sendo do webhook.
-- * A coluna liga o pedido à recuperação que registrou o pagamento (quem, quando, de qual arquivo), como
--   `recuperacao_id` liga a venda perdida que a recuperação gravou. São colunas diferentes porque a 0004 prende
--   `recuperacao_id` a `origem = 'conferencia'` (CHECK), e o SQLite não troca o CHECK de uma coluna sem recriar a
--   tabela.
-- * Só num pedido do webhook já pago: o "Recuperar" só marca o que fica 'approved', e 'approved' é terminal (D4).
ALTER TABLE pedidos ADD COLUMN pagamento_recuperacao_id INTEGER REFERENCES recuperacoes (id) ON DELETE RESTRICT
  CHECK (pagamento_recuperacao_id IS NULL OR (origem = 'webhook' AND status = 'approved'));

-- Para a lista das recuperações (os pagamentos registrados de cada uma) e as contagens da gravação.
CREATE INDEX pedidos_por_pagamento_recuperado ON pedidos (pagamento_recuperacao_id)
  WHERE pagamento_recuperacao_id IS NOT NULL;
