-- 0014_codigo_afiliado_rifei.sql: o código do afiliado na Rifei (RIFA-070, D32). Aplica-se depois da 0013 (RIFA-064) ou, sem ela, da 0012.
-- Documentação: docs/decisions.md (D32), docs/integracao-rifei.md (seção 13) e docs/modelo-de-dados.md.
--
-- * O link de vendas da Rifei é `https://rifei.com.br/<slug>?ref=<código>`: a página da campanha lê o `ref`, e o código
--   (ex.: "thiago") é o do afiliado na Rifei, diferente do `affiliate_id` que chega no webhook. A sincronização com a
--   API da Rifei (POST /api/admin/rifei/afiliados/sincronizar) grava o código aqui, e o modelo do link de vendas
--   ganha o marcador {codigo}.
-- * Aditiva: nasce NULL em todos os afiliados (o código só existe depois da sincronização). O banco só confere o
--   tamanho; o formato fica no contrato.
ALTER TABLE afiliados ADD COLUMN codigo_rifei TEXT
  CHECK (codigo_rifei IS NULL OR length(codigo_rifei) BETWEEN 1 AND 120);

-- A conexão com a Rifei pela tela (RIFA-070, D32): o token do login na Rifei que o admin cola em Acessos → Conexão
-- com a Rifei, para marcar os pedidos pagos sem terminal.
-- * No máximo uma linha: colar de novo troca o token (UPSERT); apagar remove a linha (vale o segredo
--   RIFEI_API_TOKEN, se existir).
-- * O token NUNCA fica em claro: `token_cifrado` é "v1:<iv>:<cifra>" (AES-GCM, base64) com a chave do segredo do
--   Worker RIFEI_CHAVE_CIFRA (lib/cifra-rifei.ts). `final_token` são os 4 últimos caracteres, que a tela mostra.
-- * `expira_em`: a validade que o próprio token traz (o `exp` do JWT), se trouxer.
-- * `testado_em`: a última chamada à Rifei que deu certo com ele; `recusado_em`: a primeira recusa (401/403) depois
--   disso (a tela pede um token novo). Quem colou e quem apagou ficam na trilha (rifei.conectar, rifei.desconectar).
CREATE TABLE rifei_conexao (
  id             INTEGER PRIMARY KEY CHECK (id = 1),
  token_cifrado  TEXT    NOT NULL CHECK (token_cifrado GLOB 'v1:*:*' AND length(token_cifrado) BETWEEN 40 AND 8192),
  final_token    TEXT    NOT NULL CHECK (length(final_token) = 4),
  expira_em      TEXT    CHECK (expira_em IS NULL OR strftime('%Y-%m-%dT%H:%M:%fZ', expira_em) IS expira_em),
  conectado_em   TEXT    NOT NULL CHECK (strftime('%Y-%m-%dT%H:%M:%fZ', conectado_em) IS conectado_em),
  testado_em     TEXT    CHECK (testado_em IS NULL OR strftime('%Y-%m-%dT%H:%M:%fZ', testado_em) IS testado_em),
  recusado_em    TEXT    CHECK (recusado_em IS NULL OR strftime('%Y-%m-%dT%H:%M:%fZ', recusado_em) IS recusado_em)
);
