-- Migração 0000: setup inicial do banco (D1).
-- Cria a tabela _meta, de metadados do sistema (pares chave/valor).
-- O GET /api/health lê esta tabela para provar que o D1 responde e que as
-- migrações foram aplicadas.
CREATE TABLE IF NOT EXISTS _meta (
  chave TEXT PRIMARY KEY,
  valor TEXT
);
