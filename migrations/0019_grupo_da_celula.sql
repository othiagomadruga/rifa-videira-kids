-- 0019_grupo_da_celula.sql: o grupo próprio da célula, que vale no lugar do grupo do discipulador no ranking por grupo
-- da coordenação (RIFA-085; docs/decisions.md D39, adendo).
-- Pedido do PO (23/11): algumas células de um discipulador do grupo Jovens são de Adolescentes. Então a célula pode ter
-- um grupo próprio. Grupo efetivo da célula = o próprio, se houver; senão, o do discipulador; senão, sem grupo.
-- Aditiva: uma coluna nova em celulas, NULL em todas as que já existem (NULL = herda o grupo do discipulador, como era
-- até a 0018): nada muda no ranking por grupo até a coordenação escolher o grupo de uma célula na tela Hierarquia.
--
-- * No ranking por grupo, nível célula, vale o grupo efetivo; no nível discipulador, só o grupo do discipulador.
-- * Apagar um grupo (só pelo banco) deixa as células dele com o grupo do discipulador (ON DELETE SET NULL), sem apagar
--   nenhuma célula.
-- * A importação da planilha não mexe nesta coluna (nem no INSERT nem no UPDATE).
ALTER TABLE celulas ADD COLUMN grupo_id INTEGER REFERENCES grupos (id) ON DELETE SET NULL;

CREATE INDEX celulas_por_grupo ON celulas (grupo_id);
