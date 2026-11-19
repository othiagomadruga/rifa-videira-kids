-- 0013_login_celulas_senha.sql: a chave do login das células com a senha padrão (RIFA-064; docs/decisions.md D29).
-- Aplica-se depois de 0011 (e da 0012 da RIFA-061, de que não depende: as duas só acrescentam uma coluna em
-- campanhas). Aditiva: uma coluna nova em campanhas, 1 (ligada, o padrão do contrato) em todas as campanhas que já
-- existem; nenhum dado muda. Documentação: docs/acesso.md (seção 10) e docs/modelo-de-dados.md (seção 3). Gravação e
-- leitura: src/worker/db/campanha.ts (`acesso.celulas_senha` do contrato); o login, src/worker/db/login-celula.ts.
--
-- * 1 (o padrão): cada célula entra em POST /api/sessao/senha com o nome dela e a senha "@" + nome normalizado +
--   "1234" (src/shared/contracts/login-celula.ts). A senha não é gravada em lugar nenhum: é derivada do nome na hora.
-- * 0: o login por senha é recusado (401, como a senha errada) e as sessões abertas por senha deixam de valer (a
--   consulta da sessão lê a chave na hora). O link pessoal do líder não muda.
-- * A sessão aberta pela senha não tem link: `sessoes.link_id` NULL (a 0002 já aceitava; a API, até aqui, sempre
--   gravava o link). Nenhuma coluna nova em sessoes: link_id NULL = sessão aberta pela senha.
ALTER TABLE campanhas ADD COLUMN acesso_celulas_senha INTEGER NOT NULL DEFAULT 1
  CHECK (acesso_celulas_senha IN (0, 1));
