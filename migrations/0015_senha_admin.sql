-- 0015_senha_admin.sql: usuário e senha de login do admin (RIFA-073; docs/decisions.md D33). Aplica-se depois da 0013
-- (RIFA-064) e não depende da 0014 (RIFA-070). Aditiva: uma tabela nova; nenhuma tabela, coluna ou dado existente muda.
-- Documentação: docs/acesso.md (seção 11). Gravação e leitura: src/worker/db/senha-admin.ts; o hash,
-- src/worker/lib/senha.ts.
--
-- * Uma linha por admin que definiu a senha (na tela "Minha senha"). Só o papel admin tem: a rota é só de admin e o
--   login confere `usuarios.papel = 'admin'` e `ativo = 1` na hora (um papel novo ou um usuário desativado não entra).
-- * A senha nunca é gravada: só o PBKDF2-SHA256 dela (32 bytes em hex), com sal aleatório de 16 bytes por senha (hex)
--   e o número de iterações (100.000 hoje, o máximo do Workers; guardado para poder subir sem invalidar as senhas).
-- * `usuario` é o nome de login, já normalizado pela API (minúsculas, FORMATO_USUARIO_ADMIN) e único entre os admins.
-- * Força bruta: o limite por IP do login (LIMITE_LOGIN, 60 por minuto) e, por conta, 5 erros seguidos bloqueiam o login
--   dela por 15 minutos (`falhas`, `bloqueada_ate`); o link pessoal do admin continua entrando.
-- * A sessão aberta pela senha não tem link (`sessoes.link_id` NULL, como a da célula na 0013): a consulta da sessão
--   (src/worker/db/acessos.ts) só a aceita no admin que ainda tem a linha aqui. Remover a senha encerra essas sessões.
CREATE TABLE senhas_admin (
  usuario_id     INTEGER PRIMARY KEY REFERENCES usuarios (id) ON DELETE CASCADE,
  usuario        TEXT    NOT NULL UNIQUE
                 CHECK (length(usuario) BETWEEN 3 AND 40 AND usuario NOT GLOB '*[^a-z0-9._-]*'
                        AND substr(usuario, 1, 1) NOT IN ('.', '_', '-')),
  sal            TEXT    NOT NULL CHECK (length(sal) = 32 AND sal NOT GLOB '*[^0-9a-f]*'),
  hash           TEXT    NOT NULL CHECK (length(hash) = 64 AND hash NOT GLOB '*[^0-9a-f]*'),
  iteracoes      INTEGER NOT NULL CHECK (iteracoes >= 100000),
  -- Limite por conta (além do por IP): erros seguidos de senha; no 5º, a conta fica bloqueada até `bloqueada_ate`
  -- (15 minutos) e o login recusa com o MESMO 401, mesmo com a senha certa. O login certo zera; trocar a senha também.
  falhas         INTEGER NOT NULL DEFAULT 0 CHECK (falhas >= 0),
  bloqueada_ate  TEXT    CHECK (bloqueada_ate IS NULL OR strftime('%Y-%m-%dT%H:%M:%fZ', bloqueada_ate) IS bloqueada_ate),
  criada_em      TEXT    NOT NULL CHECK (strftime('%Y-%m-%dT%H:%M:%fZ', criada_em) IS criada_em),
  atualizada_em  TEXT    NOT NULL CHECK (strftime('%Y-%m-%dT%H:%M:%fZ', atualizada_em) IS atualizada_em)
);
