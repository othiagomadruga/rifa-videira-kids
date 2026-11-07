-- 0005_auditoria.sql: trilha de auditoria da coordenação e pedidos marcados para revisão (RIFA-013b).
-- Aplica-se depois de 0003 e não depende da 0004 (RIFA-012). Aditiva: duas tabelas novas; nenhuma tabela,
-- coluna ou dado existente muda. Documentação: docs/api.md (GET /api/admin/auditoria e
-- GET /api/admin/pedidos/suspeitos) e docs/decisions.md (D11). Gravação: src/worker/db/auditoria.ts e
-- src/worker/db/pedidos-suspeitos.ts.
--
-- * Instantes em UTC no formato de 0001 (2026-12-01T12:20:31.512Z), checados com strftime().
-- * Nenhuma coluna guarda dado pessoal (D1): de quem fez, só o id do usuário; do pedido, só valores.

-- Uma linha por ação da coordenação que muda a campanha, os vínculos, a hierarquia (importação aplicada)
-- ou os acessos. Gravada no MESMO db.batch da ação: se a ação não acontece (ou falha), a linha não existe.
CREATE TABLE auditoria (
  id          INTEGER PRIMARY KEY,
  -- Quem fez: o usuário da sessão. Usuários não são apagados, só desativados (0002).
  usuario_id  INTEGER NOT NULL REFERENCES usuarios (id) ON DELETE RESTRICT,
  em          TEXT    NOT NULL CHECK (strftime('%Y-%m-%dT%H:%M:%fZ', em) IS em),
  -- "<recurso>.<verbo>" (ex.: campanha.salvar, link.revogar); a lista fica no contrato (ACOES_AUDITORIA)
  -- e pode crescer sem migração.
  acao        TEXT    NOT NULL CHECK (length(acao) BETWEEN 3 AND 64 AND acao NOT GLOB '*[^a-z_.]*'),
  -- "<tipo>:<id>" ou só "<tipo>" (ex.: afiliado:1042, hierarquia).
  alvo        TEXT    NOT NULL CHECK (length(alvo) BETWEEN 1 AND 64),
  -- O que mudou, em texto curto e SEM dados pessoais (ids e configuração, nunca nomes ou contatos).
  resumo      TEXT    NOT NULL CHECK (length(resumo) BETWEEN 1 AND 1000)
);

CREATE INDEX auditoria_por_usuario ON auditoria (usuario_id);

-- Pedido aprovado que o webhook achou implausível: bilhetes acima do teto por pedido ou total fora de
-- bilhetes × preço do bilhete da campanha (além da tolerância de desconto). O pedido CONTINUA contando
-- nas vendas; esta linha só o põe na lista de revisão. O mesmo motivo vai para webhook_eventos.avisos.
CREATE TABLE pedidos_suspeitos (
  pedido_id          TEXT    PRIMARY KEY NOT NULL REFERENCES pedidos (id) ON DELETE CASCADE,
  -- Do evento que aprovou o pedido.
  qtd_bilhetes       INTEGER NOT NULL CHECK (typeof(qtd_bilhetes) = 'integer' AND qtd_bilhetes >= 0),
  total_centavos     INTEGER NOT NULL CHECK (typeof(total_centavos) = 'integer' AND total_centavos >= 0),
  -- qtd_bilhetes × preço do bilhete da campanha no momento da marcação.
  esperado_centavos  INTEGER NOT NULL CHECK (typeof(esperado_centavos) = 'integer' AND esperado_centavos >= 0),
  -- JSON: lista NÃO vazia de motivos (caminho, código, mensagem, ocorrências; nunca o valor recebido).
  motivos            TEXT    NOT NULL CHECK (CASE WHEN json_valid(motivos)
                       THEN json_type(motivos) = 'array' AND json_array_length(motivos) > 0 ELSE 0 END),
  marcado_em         TEXT    NOT NULL CHECK (strftime('%Y-%m-%dT%H:%M:%fZ', marcado_em) IS marcado_em)
);

-- A lista sai do mais recente para o mais antigo.
CREATE INDEX pedidos_suspeitos_por_marcacao ON pedidos_suspeitos (marcado_em);
