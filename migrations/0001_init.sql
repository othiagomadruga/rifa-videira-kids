-- 0001_init.sql: schema inicial da Rifa Videira Kids (RIFA-002). Aplica-se depois de 0000_setup.sql.
-- Documentação: docs/modelo-de-dados.md. Tipos e schemas espelho: src/shared/contracts/dominio.ts.
--
-- Convenções
-- * Nomes em português, snake_case. Ids inteiros (INTEGER PRIMARY KEY), exceto pedidos.id e
--   afiliados.affiliate_id, que são os ids da Rifei.
-- * Dinheiro em centavos (INTEGER, D2). Percentuais em pontos-base (3500 = 35%). Dinheiro,
--   contadores e ids da Rifei têm CHECK typeof(x) = 'integer': a afinidade INTEGER do SQLite
--   aceitaria 60.5 ou 'abc' sem reclamar.
-- * Instantes em UTC, texto ISO 8601 com milissegundos e "Z" (2026-12-01T12:20:31.512Z): a ordem
--   alfabética é a cronológica. Datas locais da campanha em "YYYY-MM-DD" (fuso da campanha, D8).
--   Os formatos são checados com strftime()/date() ("x IS strftime(..., x)"), e não com GLOB: o D1
--   recusa padrões GLOB/LIKE longos ("LIKE or GLOB pattern too complex").
-- * O D1 sempre aplica chaves estrangeiras. Exclusões são RESTRICT: a API responde 409 em_uso.
-- * D1 (LGPD): nenhuma coluna guarda nome, e-mail, documento, nascimento, endereço ou telefone completo
--   do comprador. Do telefone ficam só ddd e pais (código de discagem do país).

-- Campanha: toda regra de campanha é configuração. A API v1 trabalha com a campanha ativa (no máximo uma).
CREATE TABLE campanhas (
  id                              INTEGER PRIMARY KEY,
  nome                            TEXT    NOT NULL CHECK (length(trim(nome)) BETWEEN 1 AND 120),
  -- D5: só eventos com este slug são processados.
  slug_rifei                      TEXT    NOT NULL UNIQUE CHECK (length(trim(slug_rifei)) BETWEEN 1 AND 200),
  ativa                           INTEGER NOT NULL DEFAULT 1 CHECK (ativa IN (0, 1)),
  fuso_horario                    TEXT    NOT NULL DEFAULT 'America/Belem',
  -- Primeiro dia de vendas (data local). O fim sai da soma dos dias dos períodos.
  data_inicio                     TEXT    NOT NULL CHECK (date(data_inicio) IS data_inicio),
  preco_bilhete_centavos          INTEGER NOT NULL CHECK (typeof(preco_bilhete_centavos) = 'integer' AND preco_bilhete_centavos > 0),
  meta_unidade                    TEXT    NOT NULL CHECK (meta_unidade IN ('bilhetes', 'centavos')),
  meta_regra                      TEXT    NOT NULL CHECK (meta_regra IN ('por_pessoa', 'total_proporcional', 'fixa_por_celula')),
  -- Na unidade da meta; o significado depende da regra (por pessoa, total da campanha ou por célula).
  meta_valor                      INTEGER NOT NULL CHECK (typeof(meta_valor) = 'integer' AND meta_valor > 0),
  ranking_criterio                TEXT    NOT NULL CHECK (ranking_criterio IN ('percentual_meta', 'bilhetes', 'arrecadacao')),
  -- Visão pública: nunca mostra R$. Estes campos só ligam o % da meta e limitam as posições (null = todas).
  publico_mostra_percentual_meta  INTEGER NOT NULL DEFAULT 0 CHECK (publico_mostra_percentual_meta IN (0, 1)),
  publico_limite_ranking          INTEGER DEFAULT 3 CHECK (publico_limite_ranking IS NULL OR (typeof(publico_limite_ranking) = 'integer' AND publico_limite_ranking BETWEEN 1 AND 100)),
  criado_em                       TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  atualizado_em                   TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

CREATE UNIQUE INDEX campanhas_uma_ativa ON campanhas (ativa) WHERE ativa = 1;

-- Períodos consecutivos a partir de campanhas.data_inicio, na ordem. Os percentuais não precisam
-- somar 10000: o cálculo normaliza (peso = percentual_bp / soma).
CREATE TABLE campanha_periodos (
  campanha_id    INTEGER NOT NULL REFERENCES campanhas (id) ON DELETE CASCADE,
  ordem          INTEGER NOT NULL CHECK (typeof(ordem) = 'integer' AND ordem >= 1),
  nome           TEXT    NOT NULL CHECK (length(trim(nome)) BETWEEN 1 AND 60),
  dias           INTEGER NOT NULL CHECK (typeof(dias) = 'integer' AND dias BETWEEN 1 AND 366),
  percentual_bp  INTEGER NOT NULL CHECK (typeof(percentual_bp) = 'integer' AND percentual_bp BETWEEN 0 AND 10000),
  PRIMARY KEY (campanha_id, ordem)
);

-- Hierarquia: rede (divisão) → discipulador → célula. Nomes únicos (sem diferenciar maiúsculas ASCII):
-- são a chave da importação por CSV.
CREATE TABLE redes (
  id                INTEGER PRIMARY KEY,
  nome              TEXT    NOT NULL COLLATE NOCASE UNIQUE CHECK (length(trim(nome)) BETWEEN 1 AND 120),
  divisao           TEXT    NOT NULL CHECK (divisao IN ('jovens', 'adultos')),
  -- Pastor ou obreiro da rede.
  responsavel_nome  TEXT    CHECK (responsavel_nome IS NULL OR length(trim(responsavel_nome)) BETWEEN 1 AND 120),
  criado_em         TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  atualizado_em     TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

CREATE TABLE discipuladores (
  id             INTEGER PRIMARY KEY,
  rede_id        INTEGER NOT NULL REFERENCES redes (id) ON DELETE RESTRICT,
  nome           TEXT    NOT NULL COLLATE NOCASE UNIQUE CHECK (length(trim(nome)) BETWEEN 1 AND 120),
  criado_em      TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  atualizado_em  TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

CREATE INDEX discipuladores_por_rede ON discipuladores (rede_id);

-- Dados do líder: são da equipe da igreja (cadastro da hierarquia), não do comprador.
CREATE TABLE celulas (
  id               INTEGER PRIMARY KEY,
  discipulador_id  INTEGER NOT NULL REFERENCES discipuladores (id) ON DELETE RESTRICT,
  nome             TEXT    NOT NULL COLLATE NOCASE UNIQUE CHECK (length(trim(nome)) BETWEEN 1 AND 120),
  -- Base da meta proporcional.
  qtd_pessoas      INTEGER NOT NULL CHECK (typeof(qtd_pessoas) = 'integer' AND qtd_pessoas BETWEEN 1 AND 1000),
  lider_nome       TEXT    NOT NULL CHECK (length(trim(lider_nome)) BETWEEN 1 AND 120),
  lider_email      TEXT    CHECK (lider_email IS NULL OR (length(lider_email) <= 254 AND lider_email LIKE '%_@_%')),
  lider_telefone   TEXT    CHECK (lider_telefone IS NULL OR length(trim(lider_telefone)) BETWEEN 1 AND 40),
  criado_em        TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  atualizado_em    TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

CREATE INDEX celulas_por_discipulador ON celulas (discipulador_id);

-- D7: affiliate_id da Rifei → célula. celula_id NULL = não vinculado (fila de órfãos). Um affiliate_id
-- desconhecido no webhook cria a linha na hora (origem 'webhook'). Vincular reatribui todas as vendas
-- do afiliado na hora: a célula de um pedido é resolvida por JOIN na leitura.
-- affiliate_id é INT (não INTEGER) PRIMARY KEY NOT NULL de propósito: não é alias do rowid, então
-- um INSERT com NULL falha em vez de criar um afiliado fantasma com id automático.
CREATE TABLE afiliados (
  affiliate_id   INT     PRIMARY KEY NOT NULL CHECK (typeof(affiliate_id) = 'integer' AND affiliate_id > 0),
  celula_id      INTEGER REFERENCES celulas (id) ON DELETE RESTRICT,
  -- Nota livre da coordenação (ex.: usuário do líder na Rifei).
  rotulo         TEXT    CHECK (rotulo IS NULL OR length(trim(rotulo)) BETWEEN 1 AND 120),
  origem         TEXT    NOT NULL CHECK (origem IN ('webhook', 'manual')),
  criado_em      TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  vinculado_em   TEXT,
  atualizado_em  TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  CHECK ((celula_id IS NULL) = (vinculado_em IS NULL))
);

CREATE INDEX afiliados_por_celula ON afiliados (celula_id);

-- Estado atual de cada pedido da Rifei (D3, D4). Só status 'approved' conta como venda.
CREATE TABLE pedidos (
  -- id do pedido na Rifei.
  id                          TEXT    PRIMARY KEY CHECK (length(id) BETWEEN 1 AND 128),
  campanha_id                 INTEGER NOT NULL REFERENCES campanhas (id) ON DELETE RESTRICT,
  -- NULL = venda sem afiliado.
  affiliate_id                INTEGER REFERENCES afiliados (affiliate_id) ON DELETE RESTRICT CHECK (affiliate_id IS NULL OR typeof(affiliate_id) = 'integer'),
  status                      TEXT    NOT NULL CHECK (status IN ('in_process', 'approved', 'expired')),
  -- status e status_detail como vieram no último evento processado. Os campos informativos do payload
  -- (status, status_detail, subtotal, método, rifinha, expires_at) são NULL quando a Rifei manda
  -- ausente ou com tipo errado: o webhook aceita e registra um aviso (RIFA-002b).
  status_rifei                TEXT,
  status_detail_rifei         TEXT,
  qtd_bilhetes                INTEGER NOT NULL CHECK (typeof(qtd_bilhetes) = 'integer' AND qtd_bilhetes >= 0),
  -- Números dos bilhetes (array JSON), para a reconciliação.
  numeros                     TEXT    CHECK (numeros IS NULL OR json_valid(numeros)),
  subtotal_centavos           INTEGER CHECK (subtotal_centavos IS NULL OR (typeof(subtotal_centavos) = 'integer' AND subtotal_centavos >= 0)),
  -- Valor arrecadado (depois dos descontos).
  total_centavos              INTEGER NOT NULL CHECK (typeof(total_centavos) = 'integer' AND total_centavos >= 0),
  desconto_promocao_centavos  INTEGER CHECK (desconto_promocao_centavos IS NULL OR (typeof(desconto_promocao_centavos) = 'integer' AND desconto_promocao_centavos >= 0)),
  desconto_cupom_centavos     INTEGER CHECK (desconto_cupom_centavos IS NULL OR (typeof(desconto_cupom_centavos) = 'integer' AND desconto_cupom_centavos >= 0)),
  cupom_id                    INTEGER CHECK (cupom_id IS NULL OR typeof(cupom_id) = 'integer'),
  metodo_pagamento            TEXT,
  rifinha                     INTEGER CHECK (rifinha IS NULL OR rifinha IN (0, 1)),
  -- Derivados de buyer.phone (E.164). DDD só para o Brasil.
  ddd                         TEXT    CHECK (ddd IS NULL OR ddd GLOB '[1-9][1-9]'),
  pais                        TEXT    CHECK (pais IS NULL OR pais GLOB '[1-9]' OR pais GLOB '[1-9][0-9]' OR pais GLOB '[1-9][0-9][0-9]'),
  utm_source                  TEXT,
  utm_campaign                TEXT,
  utm_medium                  TEXT,
  utm_content                 TEXT,
  utm_term                    TEXT,
  -- Instantes da Rifei (created_at, expires_at, approved_at, expired_at) normalizados para UTC.
  -- created_at ausente ou inválido: o webhook grava o instante do recebimento.
  criado_em                   TEXT    NOT NULL CHECK (strftime('%Y-%m-%dT%H:%M:%fZ', criado_em) IS criado_em),
  expira_em                   TEXT    CHECK (expira_em IS NULL OR strftime('%Y-%m-%dT%H:%M:%fZ', expira_em) IS expira_em),
  aprovado_em                 TEXT    CHECK (aprovado_em IS NULL OR strftime('%Y-%m-%dT%H:%M:%fZ', aprovado_em) IS aprovado_em),
  expirado_em                 TEXT    CHECK (expirado_em IS NULL OR strftime('%Y-%m-%dT%H:%M:%fZ', expirado_em) IS expirado_em),
  -- Nossos: primeira gravação e última alteração.
  registrado_em               TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  atualizado_em               TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  CHECK (status <> 'approved' OR aprovado_em IS NOT NULL),
  CHECK (ddd IS NULL OR pais = '55')
);

-- Vendas por afiliado/célula (JOIN com afiliados) e a fila "sem afiliado" (affiliate_id IS NULL).
CREATE INDEX pedidos_por_afiliado_status ON pedidos (affiliate_id, status);
-- Ritmo e ranking por janela de tempo: status = 'approved' AND aprovado_em >= ? AND aprovado_em < ?.
CREATE INDEX pedidos_por_status_aprovacao ON pedidos (status, aprovado_em);

-- D3: uma linha por entrega autenticada do webhook, com o payload REDIGIDO (D1). Entregas sem
-- autenticação (401) ou sem segredo configurado (503) não são gravadas.
CREATE TABLE webhook_eventos (
  id                 INTEGER PRIMARY KEY,
  recebido_em        TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  -- event, id e slug como vieram (em erro_validacao podem faltar ou ser desconhecidos).
  evento             TEXT    CHECK (evento IS NULL OR length(evento) <= 64),
  pedido_id          TEXT    CHECK (pedido_id IS NULL OR length(pedido_id) <= 128),
  slug               TEXT    CHECK (slug IS NULL OR length(slug) <= 200),
  resultado          TEXT    NOT NULL CHECK (resultado IN ('processado', 'duplicado', 'ignorado_outra_campanha', 'ignorado_transicao', 'erro_validacao')),
  status_anterior    TEXT    CHECK (status_anterior IS NULL OR status_anterior IN ('in_process', 'approved', 'expired')),
  status_resultante  TEXT    CHECK (status_resultante IS NULL OR status_resultante IN ('in_process', 'approved', 'expired')),
  -- JSON no formato payloadRifeiRedigidoSchema; NULL só em erro_validacao.
  payload_redigido   TEXT    CHECK (payload_redigido IS NULL OR json_valid(payload_redigido)),
  -- JSON: lista de problemas de validação (caminho, código, mensagem; nunca o valor).
  erro               TEXT    CHECK (erro IS NULL OR json_valid(erro)),
  -- JSON: diferenças do payload aceito em relação à doc (caminho, código, mensagem; nunca o valor).
  -- NULL quando não há nenhuma. Nunca em erro_validacao (lá os problemas vão em erro).
  avisos             TEXT    CHECK (avisos IS NULL OR json_valid(avisos)),
  CHECK ((resultado = 'erro_validacao') = (erro IS NOT NULL)),
  CHECK (resultado = 'erro_validacao' OR payload_redigido IS NOT NULL),
  CHECK (resultado <> 'erro_validacao' OR avisos IS NULL),
  CHECK ((resultado IN ('processado', 'duplicado', 'ignorado_transicao')) = (status_resultante IS NOT NULL))
);

CREATE INDEX webhook_eventos_por_pedido ON webhook_eventos (pedido_id);
CREATE INDEX webhook_eventos_por_resultado ON webhook_eventos (resultado, recebido_em);

-- Vendas aprovadas com a hierarquia resolvida na leitura (D7). celula_id NULL = venda sem célula
-- (sem afiliado ou afiliado não vinculado): entra no total da campanha, mas não nos rankings.
CREATE VIEW vendas_aprovadas AS
SELECT
  p.id               AS pedido_id,
  p.campanha_id      AS campanha_id,
  p.affiliate_id     AS affiliate_id,
  p.qtd_bilhetes     AS qtd_bilhetes,
  p.total_centavos   AS total_centavos,
  p.aprovado_em      AS aprovado_em,
  p.ddd              AS ddd,
  p.pais             AS pais,
  a.celula_id        AS celula_id,
  c.discipulador_id  AS discipulador_id,
  d.rede_id          AS rede_id,
  r.divisao          AS divisao
FROM pedidos AS p
LEFT JOIN afiliados AS a ON a.affiliate_id = p.affiliate_id
LEFT JOIN celulas AS c ON c.id = a.celula_id
LEFT JOIN discipuladores AS d ON d.id = c.discipulador_id
LEFT JOIN redes AS r ON r.id = d.rede_id
WHERE p.status = 'approved';
