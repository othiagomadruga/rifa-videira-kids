-- 0006_acesso_hierarquia.sql: papéis da hierarquia (RIFA-014, D12). Aplica-se depois de 0005 e não depende
-- da 0004 (RIFA-012). Documentação: docs/acesso.md (seção 9) e docs/modelo-de-dados.md. Contrato:
-- src/shared/contracts/acesso.ts (PAPEIS, TIPO_ALVO_DO_PAPEL).
--
-- * Papéis novos: lider (a célula), discipulador e rede. Cada usuário desses papéis fica preso a UM alvo por
--   uma coluna própria (celula_id, discipulador_id ou rede_id); os papéis da coordenação não têm alvo. O CHECK
--   do papel garante o alvo certo para o papel, e os índices únicos parciais, no máximo um usuário por alvo.
-- * Apagar o alvo apaga o usuário dele (ON DELETE CASCADE) e, em cascata, os links e as sessões (0002).
-- * NÃO recria a tabela `usuarios` (o jeito de trocar um CHECK no SQLite): o DROP da tabela antiga apagaria em
--   cascata os links e as sessões e esbarraria no RESTRICT de auditoria.usuario_id (0005); o
--   PRAGMA defer_foreign_keys não segura ações de cascata. A troca é feita coluna a coluna, NESTA ordem:
--   1. as colunas do alvo, sem CHECK (um CHECK que cite outra coluna barra o DROP COLUMN dela no futuro);
--   2. uma coluna de papel nova, com os 5 papéis e a coerência papel ↔ alvo no CHECK dela;
--   3. o papel copiado; 4. a coluna antiga apagada; 5. a nova renomeada para `papel`;
--   6. os gatilhos que recusam papel NULL (o ADD COLUMN não aceita NOT NULL sem um valor padrão), criados
--      DEPOIS do DROP e do RENAME: um gatilho que cita a coluna barra o DROP COLUMN;
--   7. os índices únicos parciais (um usuário por alvo), que também servem à cascata.
--   Uma troca futura de papel repete a técnica: os dois gatilhos saem antes do DROP e voltam depois.
-- * Os ids de usuarios não são AUTOINCREMENT: o id de um usuário apagado com o alvo pode voltar num usuário
--   novo (a trilha `usuario:<id>` passaria a apontar para outra pessoa). Ver D12.

-- 1. O alvo do usuário.
ALTER TABLE usuarios ADD COLUMN celula_id INTEGER REFERENCES celulas (id) ON DELETE CASCADE;
ALTER TABLE usuarios ADD COLUMN discipulador_id INTEGER REFERENCES discipuladores (id) ON DELETE CASCADE;
ALTER TABLE usuarios ADD COLUMN rede_id INTEGER REFERENCES redes (id) ON DELETE CASCADE;

-- 2. O papel novo. Nas linhas que já existem ele começa NULL, e o CHECK com NULL não reprova.
ALTER TABLE usuarios ADD COLUMN papel_novo TEXT CHECK (
  papel_novo IN ('admin', 'coordenacao', 'lider', 'discipulador', 'rede')
  AND (papel_novo = 'lider') = (celula_id IS NOT NULL)
  AND (papel_novo = 'discipulador') = (discipulador_id IS NOT NULL)
  AND (papel_novo = 'rede') = (rede_id IS NOT NULL)
);

-- 3 a 5. Copia, apaga o antigo (com o CHECK dele) e renomeia: o CHECK da coluna nova passa a citar `papel`.
UPDATE usuarios SET papel_novo = papel;
ALTER TABLE usuarios DROP COLUMN papel;
ALTER TABLE usuarios RENAME COLUMN papel_novo TO papel;

-- 6. Papel obrigatório (no lugar do NOT NULL), com a mesma mensagem do NOT NULL do SQLite.
CREATE TRIGGER usuarios_papel_obrigatorio_ao_inserir
BEFORE INSERT ON usuarios
FOR EACH ROW WHEN NEW.papel IS NULL
BEGIN
  SELECT RAISE(ABORT, 'NOT NULL constraint failed: usuarios.papel');
END;

CREATE TRIGGER usuarios_papel_obrigatorio_ao_atualizar
BEFORE UPDATE ON usuarios
FOR EACH ROW WHEN NEW.papel IS NULL
BEGIN
  SELECT RAISE(ABORT, 'NOT NULL constraint failed: usuarios.papel');
END;

-- 7. No máximo um usuário por alvo (ativo ou não: reativar ou gerar um link novo reaproveita o mesmo).
CREATE UNIQUE INDEX usuarios_um_por_celula ON usuarios (celula_id) WHERE celula_id IS NOT NULL;
CREATE UNIQUE INDEX usuarios_um_por_discipulador ON usuarios (discipulador_id) WHERE discipulador_id IS NOT NULL;
CREATE UNIQUE INDEX usuarios_um_por_rede ON usuarios (rede_id) WHERE rede_id IS NOT NULL;
