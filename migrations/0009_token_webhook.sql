-- 0009_token_webhook.sql: token do webhook da Rifei gerado pela tela da coordenação (RIFA-039). Aplica-se depois
-- de 0008. Documentação: docs/decisions.md (D21) e docs/api.md (GET e POST /api/admin/webhook/token).
--
-- * No máximo uma linha: gerar de novo substitui o token (UPSERT), e o anterior para de valer na hora.
-- * Só o SHA-256 (hex minúsculo) do token, como os links de acesso (0002). O token tem 32 bytes em hex: o MESMO
--   formato do hash, então este CHECK não distingue um do outro (os testes de varredura, sim).
-- * Sem linha, vale o segredo do Worker RIFEI_WEBHOOK_TOKEN (como antes); com linha, só ela.
-- * Quem gerou fica na trilha (auditoria, ação webhook.gerar_token), não aqui.
CREATE TABLE token_webhook (
  id          INTEGER PRIMARY KEY CHECK (id = 1),
  token_hash  TEXT    NOT NULL CHECK (length(token_hash) = 64 AND token_hash NOT GLOB '*[^0-9a-f]*'),
  gerado_em   TEXT    NOT NULL CHECK (strftime('%Y-%m-%dT%H:%M:%fZ', gerado_em) IS gerado_em)
);
