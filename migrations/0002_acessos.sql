-- 0002_acessos.sql: acesso da equipe da campanha por link pessoal (RIFA-007). Aplica-se depois de 0001.
-- Documentação: docs/acesso.md. Schemas espelho: src/shared/contracts/acesso.ts.
--
-- * Cada pessoa da equipe é um usuário com papel 'admin' (também gerencia os acessos) ou 'coordenacao'.
-- * O link pessoal leva um token de 32 bytes aleatórios (base64url). O cookie "sessao" leva um id do mesmo
--   formato. Só o SHA-256 (hex minúsculo) de cada um é gravado e a busca é sempre pelo hash: nenhuma
--   coluna guarda token ou id de sessão em texto. O CHECK de formato recusa qualquer valor que não seja hash.
-- * Instantes em UTC no formato de 0001 (2026-12-01T12:20:31.512Z), checados com strftime().
-- * Usuários não são apagados, só desativados. Links e sessões caem junto se um usuário for apagado.

CREATE TABLE usuarios (
  id         INTEGER PRIMARY KEY,
  nome       TEXT    NOT NULL CHECK (length(trim(nome)) BETWEEN 1 AND 120),
  email      TEXT    CHECK (email IS NULL OR (length(email) <= 254 AND email LIKE '%_@_%')),
  papel      TEXT    NOT NULL CHECK (papel IN ('admin', 'coordenacao')),
  -- 0 = desativado: os links param de funcionar e as sessões são apagadas.
  ativo      INTEGER NOT NULL DEFAULT 1 CHECK (ativo IN (0, 1)),
  criado_em  TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
             CHECK (strftime('%Y-%m-%dT%H:%M:%fZ', criado_em) IS criado_em)
);

-- Link pessoal <origem>/acesso/<token>: reutilizável até expirar ou ser revogado.
CREATE TABLE links_acesso (
  id             INTEGER PRIMARY KEY,
  usuario_id     INTEGER NOT NULL REFERENCES usuarios (id) ON DELETE CASCADE,
  -- SHA-256 do token. O token só existe na resposta que cria o link.
  token_hash     TEXT    NOT NULL UNIQUE
                 CHECK (length(token_hash) = 64 AND token_hash NOT GLOB '*[^0-9a-f]*'),
  criado_em      TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
                 CHECK (strftime('%Y-%m-%dT%H:%M:%fZ', criado_em) IS criado_em),
  expira_em      TEXT    NOT NULL CHECK (strftime('%Y-%m-%dT%H:%M:%fZ', expira_em) IS expira_em),
  revogado_em    TEXT    CHECK (revogado_em IS NULL OR strftime('%Y-%m-%dT%H:%M:%fZ', revogado_em) IS revogado_em),
  -- Última vez que o link abriu uma sessão.
  ultimo_uso_em  TEXT    CHECK (ultimo_uso_em IS NULL OR strftime('%Y-%m-%dT%H:%M:%fZ', ultimo_uso_em) IS ultimo_uso_em)
);

CREATE INDEX links_acesso_por_usuario ON links_acesso (usuario_id);

CREATE TABLE sessoes (
  -- SHA-256 do id da sessão (o valor do cookie).
  id_hash        TEXT    PRIMARY KEY
                 CHECK (length(id_hash) = 64 AND id_hash NOT GLOB '*[^0-9a-f]*'),
  usuario_id     INTEGER NOT NULL REFERENCES usuarios (id) ON DELETE CASCADE,
  -- Link que abriu a sessão: revogar o link derruba as sessões abertas por ele.
  link_id        INTEGER REFERENCES links_acesso (id) ON DELETE CASCADE,
  criado_em      TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
                 CHECK (strftime('%Y-%m-%dT%H:%M:%fZ', criado_em) IS criado_em),
  expira_em      TEXT    NOT NULL CHECK (strftime('%Y-%m-%dT%H:%M:%fZ', expira_em) IS expira_em),
  ultimo_uso_em  TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
                 CHECK (strftime('%Y-%m-%dT%H:%M:%fZ', ultimo_uso_em) IS ultimo_uso_em)
);

CREATE INDEX sessoes_por_usuario ON sessoes (usuario_id);
CREATE INDEX sessoes_por_link ON sessoes (link_id);
-- Limpeza das sessões vencidas (feita a cada login).
CREATE INDEX sessoes_por_expiracao ON sessoes (expira_em);
