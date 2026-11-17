-- 0013_codigo_afiliado_rifei.sql: o código do afiliado na Rifei (RIFA-070, D29). Aplica-se depois de 0012.
-- Documentação: docs/decisions.md (D29), docs/integracao-rifei.md (seção 13) e docs/modelo-de-dados.md.
--
-- * O link de vendas da Rifei é `https://rifei.com.br/<slug>?ref=<código>`: a página da campanha lê o `ref`, e o código
--   (ex.: "thiago") é o do afiliado na Rifei, diferente do `affiliate_id` que chega no webhook. A sincronização com a
--   API da Rifei (POST /api/admin/rifei/afiliados/sincronizar) grava o código aqui, e o modelo do link de vendas
--   ganha o marcador {codigo}.
-- * Aditiva: nasce NULL em todos os afiliados (o código só existe depois da sincronização). O banco só confere o
--   tamanho; o formato fica no contrato.
ALTER TABLE afiliados ADD COLUMN codigo_rifei TEXT
  CHECK (codigo_rifei IS NULL OR length(codigo_rifei) BETWEEN 1 AND 120);
