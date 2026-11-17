-- 0012_ranking_por_divisao.sql: a opção de separar ou não o ranking por divisão (RIFA-061; docs/decisions.md D27).
-- Aplica-se depois de 0011. Aditiva: uma coluna nova em campanhas, 1 (separa, o comportamento de sempre) em todas as
-- campanhas que já existem; nenhum dado muda. Documentação: docs/modelo-de-dados.md (seção 3). Gravação e leitura:
-- src/worker/db/campanha.ts (`ranking.por_divisao` do contrato).
--
-- * 1 (o padrão): Jovens e Adultos disputam cada um o seu ranking, como até aqui.
-- * 0: um ranking só, de todas as células, no ranking aberto e no telão, nos rankings da coordenação, na /minha, no
--   bumbo e no relatório. A divisão continua na hierarquia (redes.divisao): só o ranking deixa de separar.
ALTER TABLE campanhas ADD COLUMN ranking_por_divisao INTEGER NOT NULL DEFAULT 1
  CHECK (ranking_por_divisao IN (0, 1));
