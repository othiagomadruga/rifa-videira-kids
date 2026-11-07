-- 0004_conferencia.sql: conferência pelo CSV "Exportar Pedidos" da Rifei e a recuperação de venda perdida
-- (RIFA-012). Aplica-se depois de 0003. Aditiva: uma tabela nova e duas colunas novas em pedidos, com
-- padrão; nenhum dado existente muda (os pedidos já gravados ficam com origem 'webhook').
-- Documentação: docs/integracao-rifei.md (seção 10) e docs/api.md. Gravação: src/worker/db/reconciliacao.ts.
--
-- * O CSV traz nome, e-mail e telefone dos compradores. Ele é lido no navegador e não vai para a API
--   (D13): nenhuma coluna aqui guarda conteúdo do arquivo além do que o pedido recuperado precisa
--   (código, quantidade, valor, afiliado e instante; os números dos bilhetes ficam no navegador e o
--   pedido recuperado tem `numeros` nulo). Do arquivo em si ficam só o SHA-256, que identifica o
--   arquivo usado sem guardar o conteúdo, e os nomes das colunas usadas (D1).
-- * Instantes em UTC no formato de 0001 (2026-12-01T12:20:31.512Z), checados com strftime().

-- Auditoria de cada "Recuperar" que gravou algo: quem, quando, quantos e de qual arquivo. Uma linha só
-- existe com pelo menos um pedido gravado (a gravação apaga a linha no mesmo lote se nada entrou).
CREATE TABLE recuperacoes (
  id                   INTEGER PRIMARY KEY,
  campanha_id          INTEGER NOT NULL REFERENCES campanhas (id) ON DELETE RESTRICT,
  -- Quem pediu (usuários nunca são apagados, só desativados: 0002).
  usuario_id           INTEGER NOT NULL REFERENCES usuarios (id) ON DELETE RESTRICT,
  executado_em         TEXT    NOT NULL CHECK (strftime('%Y-%m-%dT%H:%M:%fZ', executado_em) IS executado_em),
  -- Pedidos que a coordenação selecionou e os que de fato entraram (os que já existiam ficam de fora).
  pedidos_solicitados  INTEGER NOT NULL CHECK (typeof(pedidos_solicitados) = 'integer' AND pedidos_solicitados >= 1),
  pedidos_recuperados  INTEGER NOT NULL DEFAULT 0 CHECK (typeof(pedidos_recuperados) = 'integer' AND pedidos_recuperados >= 0),
  bilhetes             INTEGER NOT NULL DEFAULT 0 CHECK (typeof(bilhetes) = 'integer' AND bilhetes >= 0),
  total_centavos       INTEGER NOT NULL DEFAULT 0 CHECK (typeof(total_centavos) = 'integer' AND total_centavos >= 0),
  -- Linhas de dados do arquivo e o SHA-256 (hex minúsculo) do texto: identificam o arquivo, sem o conteúdo.
  linhas_arquivo       INTEGER NOT NULL CHECK (typeof(linhas_arquivo) = 'integer' AND linhas_arquivo >= 0),
  arquivo_sha256       TEXT    NOT NULL CHECK (length(arquivo_sha256) = 64 AND arquivo_sha256 NOT GLOB '*[^0-9a-f]*'),
  -- JSON: o nome da coluna do arquivo usada em cada campo ({"pedido_id": "Pedido", "valor": null, ...}).
  mapeamento           TEXT    NOT NULL CHECK (json_valid(mapeamento) AND json_type(mapeamento) = 'object')
);

CREATE INDEX recuperacoes_por_campanha ON recuperacoes (campanha_id, executado_em);

-- Como o pedido entrou: pelo webhook (todos os anteriores) ou recuperado na conferência, com a
-- recuperação que o gravou. Um não existe sem o outro.
ALTER TABLE pedidos ADD COLUMN origem TEXT NOT NULL DEFAULT 'webhook'
  CHECK (origem IN ('webhook', 'conferencia'));
ALTER TABLE pedidos ADD COLUMN recuperacao_id INTEGER REFERENCES recuperacoes (id) ON DELETE RESTRICT
  CHECK ((origem = 'conferencia') = (recuperacao_id IS NOT NULL));

CREATE INDEX pedidos_por_recuperacao ON pedidos (recuperacao_id) WHERE recuperacao_id IS NOT NULL;
