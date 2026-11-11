-- 0007_indices_pedidos_entregas.sql: índices da lista de pedidos e das entregas do webhook (RIFA-025, D16).
-- Aplica-se depois de 0006 e não depende da 0004 (RIFA-012). Aditiva: só cria dois índices; nenhuma tabela,
-- coluna ou dado muda. Documentação: docs/modelo-de-dados.md (seção 4) e docs/api.md (GET /api/admin/pedidos e
-- GET /api/admin/webhook/entregas). Consultas: src/worker/db/lista-pedidos.ts e src/worker/db/entregas-webhook.ts.
--
-- O D1 cobra por linha lida (D10). Medido na revisão do contrato com 7 mil pedidos e 20 mil entregas:
-- * pedidos_por_campanha_registro: a lista de pedidos da campanha, do registrado mais novo para o mais antigo,
--   com o cursor (registrado_em, id), sai na ordem do índice e para no limite. Sem ele, cada página lia a tabela
--   inteira e ordenava numa B-tree temporária (~26 mil linhas lidas na 1ª página; com ele, ~133).
-- * webhook_eventos_por_resultado_id: as entregas de um resultado, da mais nova para a mais antiga (pelo id), sem
--   ordenar (a de erro_validacao lia ~800 linhas; a de processado com cursor, ~21 mil; com ele, ~51).
--
-- ATENÇÃO: o índice de pedidos atrai o planejador para consultas em que ele piora a leitura (totais, filtro por
-- célula, última entrega). As consultas desviam dele de propósito (`+campanha_id`, `afiliados CROSS JOIN pedidos`,
-- `MAX(recebido_em)`), e os testes travam os planos com EXPLAIN QUERY PLAN e as linhas lidas
-- (src/worker/db/pedidos-webhook-desempenho.test.ts).
CREATE INDEX pedidos_por_campanha_registro ON pedidos (campanha_id, registrado_em, id);

CREATE INDEX webhook_eventos_por_resultado_id ON webhook_eventos (resultado, id);
