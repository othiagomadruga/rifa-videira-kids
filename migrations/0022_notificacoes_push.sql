-- 0022_notificacoes_push.sql: as notificações de venda no celular e no computador (Web Push; RIFA-095,
-- docs/decisions.md D43). Aplica-se depois de 0020 (e da 0021, quando ela existir). Aditiva: uma tabela nova, vazia, e
-- uma coluna nova em campanhas, 1 (ligada) em todas as que já existem; nenhum dado muda. Documentação:
-- docs/modelo-de-dados.md (seção 3 e "push_inscricoes"). Gravação e leitura: src/worker/db/push-inscricoes.ts e
-- src/worker/db/campanha.ts (`notificacoes.vendas` do contrato).
--
-- push_inscricoes: um aparelho (navegador) que pediu os avisos de venda no ranking aberto ou na /minha. O endpoint é o
-- endereço do serviço de push do navegador (FCM, Mozilla, Apple ou Microsoft: a API só aceita esses, contra SSRF) e
-- nunca vai para log, resposta ou trilha. p256dh e auth são as chaves públicas do aparelho para a criptografia do
-- conteúdo (RFC 8291), em base64url. Nada da pessoa: nenhum nome, telefone, e-mail ou usuário.
-- * ultimo_envio_em: o último envio aceito pelo serviço (NULL = nunca). A ordem do envio é por ela (os que esperam há
--   mais tempo primeiro), para o teto de envios por venda ir revezando quando houver mais inscrições que ele.
-- * falhas: as falhas seguidas (o serviço recusou, demorou ou não respondeu); um envio aceito zera. Com 5, a inscrição
--   é apagada; com 404 ou 410 (a inscrição acabou no navegador), na hora.
CREATE TABLE push_inscricoes (
  id INTEGER PRIMARY KEY,
  endpoint TEXT NOT NULL UNIQUE
    CHECK (length(endpoint) BETWEEN 9 AND 2048 AND substr(endpoint, 1, 8) = 'https://'),
  p256dh TEXT NOT NULL CHECK (length(p256dh) = 87 AND p256dh NOT GLOB '*[^A-Za-z0-9_-]*'),
  auth TEXT NOT NULL CHECK (length(auth) = 22 AND auth NOT GLOB '*[^A-Za-z0-9_-]*'),
  origem TEXT NOT NULL CHECK (origem IN ('publico', 'minha')),
  criado_em TEXT NOT NULL CHECK (strftime('%Y-%m-%dT%H:%M:%fZ', criado_em) IS criado_em),
  ultimo_envio_em TEXT
    CHECK (ultimo_envio_em IS NULL OR strftime('%Y-%m-%dT%H:%M:%fZ', ultimo_envio_em) IS ultimo_envio_em),
  falhas INTEGER NOT NULL DEFAULT 0 CHECK (typeof(falhas) = 'integer' AND falhas >= 0)
);

-- A ordem do envio (NULL primeiro, depois o envio mais antigo; o id desempata), lida pelo índice, sem ordenar.
CREATE INDEX push_inscricoes_por_envio ON push_inscricoes (ultimo_envio_em, id);

-- "Enviar notificações de venda" na tela Campanha (`notificacoes.vendas`): 1 = envia (o padrão); 0 = o botão some e
-- nada é enviado (as inscrições ficam guardadas para quando a opção voltar).
ALTER TABLE campanhas ADD COLUMN notificacoes_vendas INTEGER NOT NULL DEFAULT 1
  CHECK (notificacoes_vendas IN (0, 1));
