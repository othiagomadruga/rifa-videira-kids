-- 0018_grupos.sql: o grupo do discipulador, para o ranking por grupo da coordenação (RIFA-084; docs/decisions.md D39).
-- Pedido do PO (23/11): "separar adultos da manhã, adultos da noite, jovens e adolescentes". O grupo é do
-- discipulador e as células dele herdam o grupo. NÃO é a `divisao` da rede (jovens|adultos, D27): é outro recorte, só
-- do ranking por grupo (tela Rankings da coordenação). Aditiva: uma tabela nova, semeada com os 4 grupos, e uma coluna
-- nova em discipuladores, NULL em todos os que já existem (sem grupo: ficam fora do ranking por grupo e continuam no
-- ranking de todas). Quem escolhe o grupo de cada discipulador é a coordenação, na tela Hierarquia.
--
-- * Sem CRUD dos grupos por enquanto: os 4 vêm daqui. `ordem` é a ordem dos blocos na tela (menor primeiro).
-- * Apagar um grupo (só pelo banco) deixa os discipuladores dele sem grupo (ON DELETE SET NULL), sem apagar ninguém.
CREATE TABLE grupos (
  id             INTEGER PRIMARY KEY,
  nome           TEXT    NOT NULL UNIQUE COLLATE NOCASE CHECK (length(trim(nome)) BETWEEN 1 AND 60),
  ordem          INTEGER NOT NULL DEFAULT 0,
  criado_em      TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  atualizado_em  TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

INSERT INTO grupos (id, nome, ordem) VALUES
  (1, 'Adultos da manhã', 1),
  (2, 'Adultos da noite', 2),
  (3, 'Jovens', 3),
  (4, 'Adolescentes', 4);

ALTER TABLE discipuladores ADD COLUMN grupo_id INTEGER REFERENCES grupos (id) ON DELETE SET NULL;

CREATE INDEX discipuladores_por_grupo ON discipuladores (grupo_id);
