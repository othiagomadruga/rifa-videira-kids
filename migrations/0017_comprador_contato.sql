-- 0017_comprador_contato.sql: o nome e o telefone de quem reserva ou compra, só para o admin (RIFA-076; docs/decisions.md
-- D36, que substitui EM PARTE a regra de privacidade da 0001: "nenhuma coluna guarda nome ... ou telefone completo do
-- comprador"). Aplica-se depois das anteriores (a numeração 0013 a 0016 é de outras tarefas). Aditiva: duas colunas
-- novas em pedidos, NULL nos pedidos que já existem (um evento novo da Rifei do mesmo pedido as preenche).
--
-- * Gravadas pelo webhook (db/pedidos.ts) a partir de buyer.name e buyer.phone, em todo evento do pedido que as traz
--   (um valor ausente nunca apaga o gravado). A trilha (webhook_eventos.payload_redigido) continua SEM os dois.
-- * Lidas só nas respostas do admin (GET /api/admin/pedidos e a planilha de compradores); a coordenação, a hierarquia
--   e o público nunca as veem. E-mail, documento, nascimento e endereço continuam fora do banco.
-- * Sem limpeza automática (decisão do PO, 19/11).
ALTER TABLE pedidos ADD COLUMN comprador_nome TEXT
  CHECK (comprador_nome IS NULL OR length(trim(comprador_nome)) BETWEEN 1 AND 120);
-- E.164: "+", o país e o número, de 8 a 16 caracteres, só algarismos depois do "+".
ALTER TABLE pedidos ADD COLUMN comprador_telefone TEXT
  CHECK (comprador_telefone IS NULL OR (
    length(comprador_telefone) BETWEEN 8 AND 16
    AND substr(comprador_telefone, 1, 2) GLOB '+[1-9]'
    AND substr(comprador_telefone, 2) NOT GLOB '*[^0-9]*'
  ));
