-- 0016_bilhetes_campanha.sql: os números da rifa na campanha (RIFA-075; docs/decisions.md D35). Aplica-se depois de
-- 0015. Aditiva: duas colunas novas em campanhas, com o padrão em todas as que já existem; nenhum dado muda.
-- Gravação e leitura: src/worker/db/campanha.ts (grupo `bilhetes` do contrato). A tela Bilhetes desenha a grade com
-- elas (src/worker/db/bilhetes.ts).
--
-- * bilhetes_quantidade: quantos números a rifa tem, como na Rifei (a "projeto-kids-1" tem 7005).
-- * bilhetes_numero_inicial: 0 ou 1, como a Rifei numera; NULL = automático (0 se algum pedido trouxe o número 0).
ALTER TABLE campanhas ADD COLUMN bilhetes_quantidade INTEGER NOT NULL DEFAULT 7005
  CHECK (typeof(bilhetes_quantidade) = 'integer' AND bilhetes_quantidade BETWEEN 1 AND 1000000);
ALTER TABLE campanhas ADD COLUMN bilhetes_numero_inicial INTEGER
  CHECK (bilhetes_numero_inicial IS NULL OR bilhetes_numero_inicial IN (0, 1));
