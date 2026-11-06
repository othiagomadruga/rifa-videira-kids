# Integração com a Rifei

A Rifei faz a venda, o pagamento e o sorteio. Este sistema recebe cada pedido por **webhook**, guarda o pedido **sem dados pessoais do comprador** e descobre de qual célula ele veio pelo `affiliate_id` (cada líder de célula é afiliado da campanha na Rifei).

- Contrato executável: `src/shared/contracts/rifei.ts` (payload, redação, conversões) e `src/shared/contracts/dominio.ts` (máquina de estados).
- Rota: `POST /api/webhooks/rifei` (detalhes em [api.md](api.md)). Tabelas: `pedidos`, `afiliados` e `webhook_eventos` (detalhes em [modelo-de-dados.md](modelo-de-dados.md)).
- Fonte oficial, lida em 06/11/2026: [Referência do webhook](https://rifei.com.br/ajuda/webhook/referencia-do-webhook) e [Como adicionar um webhook](https://rifei.com.br/ajuda/webhook/como-adicionar-webhook).

Neste documento, **CONFIRMADO** quer dizer que está na documentação oficial e **SUPOSIÇÃO** quer dizer que ainda precisa ser conferido com uma campanha de teste (lista no fim).

## Decisões da integração (D1 a D9)

| | Decisão | Onde está no contrato |
|---|---|---|
| D1 | Redação na entrada: do `buyer` só se guardam DDD e código do país, derivados do telefone. Nunca se guardam nome, e-mail, documento, nascimento, endereço, telefone completo, `observation`, `fbp` e `fbc`. O payload guardado é o redigido. | `redigirPayloadRifei`, `payloadRifeiRedigidoSchema` (estrito), `derivarTelefone`; nenhuma coluna pessoal na SQL |
| D2 | Dinheiro em centavos inteiros: `Math.round(valor * 100)` | `reaisParaCentavos`; colunas `*_centavos` |
| D3 | O pedido é identificado pelo `id` da Rifei. Toda entrega é registrada com o payload redigido, e o processamento é idempotente. | `pedidos.id` (PK), `webhook_eventos`, resultado `duplicado` |
| D4 | Estados: `in_process` → `approved` \| `expired`; `expired` → `approved`; `approved` é terminal. Fora de ordem cria o pedido direto no estado certo. Só `approved` é venda. | `decidirTransicaoPedido`, `TRANSICOES_PERMITIDAS`; CHECK de `status` |
| D5 | `slug` diferente do configurado: evento registrado como ignorado, resposta 200 | `campanhas.slug_rifei`; resultado `ignorado_outra_campanha` |
| D6 | `Authorization: Bearer` comparado em tempo constante com `RIFEI_WEBHOOK_TOKEN`. Inválido ou ausente: 401. Segredo não configurado: 503. | `SEGREDO_WEBHOOK_RIFEI`; grupo `rifei_bearer`; códigos `nao_autenticado` e `nao_configurado` |
| D7 | `affiliate_id` → afiliado → célula. Afiliado desconhecido entra como não vinculado (fila de órfãos); venda sem afiliado fica em "sem afiliado". A célula é resolvida por JOIN na leitura. | tabela `afiliados` (`celula_id` NULL), view `vendas_aprovadas` |
| D8 | Fuso da campanha `America/Belem` para dia e semana | `campanhas.fuso_horario` (padrão), `FUSO_PADRAO`; instantes guardados em UTC |
| D9 | 200 depois de gravar; payload malformado: 400, registrado com erro; falha de banco: 500 | resultado `erro_validacao`; códigos `json_invalido`, `payload_invalido` e `erro_interno` |

## 1. Configurar o webhook na Rifei

O webhook é da **conta**, não da campanha. Por isso ele recebe pedidos de todas as campanhas da conta, e o sistema filtra pelo `slug` da campanha configurada (D5).

1. Gerar um token forte, só para isso. Exemplo: `openssl rand -base64 32`.
2. Guardar o token como segredo do Worker, sem versionar: `wrangler secret put RIFEI_WEBHOOK_TOKEN`. Para desenvolvimento local, ele vai no `.dev.vars`, que está no `.gitignore`.
3. Na Rifei: menu do usuário → **Integrações** → seção **Outro** → **Adicionar** (webhook).
   - **URL**: `https://<domínio do Worker>/api/webhooks/rifei`. A URL precisa aceitar POST com corpo JSON.
   - **Token**: o mesmo do passo 1. A Rifei manda `Authorization: Bearer <token>`.
   - **Eventos**: marcar os três, "Novo pedido", "Pedido pago" e "Pedido expirado".
4. No sistema, configurar a campanha (`PUT /api/admin/campanha`) com `slug_rifei` igual ao slug da campanha na Rifei, que é o identificador que aparece no link da campanha.
5. Conferir com um pedido de teste: a entrega aparece em `webhook_eventos` com `resultado = 'processado'`.

Para trocar o token, faça a mudança nos dois lados em sequência: primeiro o segredo do Worker, depois a Rifei. Entre um passo e outro, as entregas recebem 401 e não são gravadas; a reconciliação por CSV recupera o que se perder.

## 2. Autenticação (D6)

- O Worker compara o header `Authorization: Bearer <token>` com o segredo `RIFEI_WEBHOOK_TOKEN` usando **comparação em tempo constante**.
- Se o header estiver ausente ou errado, a resposta é **401** `nao_autenticado` e nada é gravado.
- Se o segredo não estiver configurado no Worker, a resposta é **503** `nao_configurado` e nada é gravado. É uma falha fechada: sem segredo, o Worker nunca aceita entregas.
- A Rifei não documenta assinatura HMAC. O token estático é a única proteção, por isso ele deve ser forte e trafegar só por HTTPS.

## 3. Payload

Corpo JSON, como a Rifei documenta. Os nomes dos campos ficam como a Rifei manda.

| Campo | Tipo (doc) | No schema | O que o sistema faz |
|---|---|---|---|
| `event` | string | `new_order`, `paid_order` ou `expired_order` (outro valor: 400) | define a transição (D4) |
| `id` | string | 1 a 128 caracteres | chave do pedido (D3) |
| `slug` | string | 1 a 200 caracteres | filtro da campanha (D5) |
| `is_rifinha` | boolean | obrigatório | `pedidos.rifinha` |
| `buyer.name` | string | obrigatório | **descartado** (D1) |
| `buyer.phone` | string E.164 | obrigatório; formato não validado | vira só `ddd` e `pais` (D1) |
| `buyer.email` | null/string | null ou ausente | **descartado** |
| `buyer.document` | null/string | null ou ausente | **descartado** |
| `buyer.date_of_birth` | null/string | null ou ausente | **descartado** |
| `buyer.address` | null/objeto | null ou ausente; 8 subcampos texto/null | **descartado** |
| `numbers` | null/int[] | inteiros ≥ 0 | `pedidos.numeros` (para a reconciliação) |
| `numbers_count` | integer | inteiro ≥ 0 | `pedidos.qtd_bilhetes` |
| `lucky_numbers` | null/int[] | inteiros ≥ 0 | só no payload redigido |
| `subtotal` | number (reais) | ≥ 0 | `subtotal_centavos` (D2) |
| `total` | number (reais) | ≥ 0 | `total_centavos`: é o valor arrecadado |
| `promotion_discount` | null/number | ≥ 0 | `desconto_promocao_centavos` |
| `coupon_discount` | null/number | ≥ 0 | `desconto_cupom_centavos` |
| `payment_method` | string | texto | `metodo_pagamento` |
| `status` | string (`in_process`, `approved`) | qualquer texto não vazio | `status_rifei` (informativo) |
| `status_detail` | string | texto | `status_detail_rifei` (informativo) |
| `coupon_id` | null/integer | inteiro | `cupom_id` |
| `affiliate_id` | null/integer | inteiro ≥ 0 | liga a venda à célula (D7) |
| `created_at`, `expires_at` | ISO 8601 | com fuso, ex. `-03:00` | `criado_em`, `expira_em` (em UTC) |
| `approved_at` | null/ISO 8601 | null ou ausente | `aprovado_em` (em UTC) |
| `expired_at` | null/ISO 8601 | null ou **ausente** (falta no exemplo oficial) | `expirado_em` (em UTC) |
| `upsells` | string[] | obrigatório | só no payload redigido |
| `observation` | null/string | null ou ausente | **descartado** |
| `fbp`, `fbc` | null/string | null ou **ausentes** (faltam no exemplo oficial) | **descartados** |
| `utm.source/campaign/medium/content/term` | null/string | null ou ausentes; `utm` inteiro ausente ou null também é aceito (SUPOSIÇÃO) | `utm_*` |

O exemplo oficial está, idêntico, em [`test/fixtures/rifei/paid_order.oficial.json`](../test/fixtures/rifei/paid_order.oficial.json).

### Regras de validação (`payloadRifeiSchema`)

- Tipos conforme a documentação. Valores em reais com vírgula (`"2,50"`), datas fora do ISO 8601 ou `affiliate_id` em texto são rejeitados.
- Todo campo que a documentação marca como `null/...` aceita `null` **e também a ausência**, que vira `null`. É o caso de `expired_at`, `fbp` e `fbc`, que faltam no exemplo oficial.
- Campos desconhecidos são **tolerados e descartados**: a Rifei pode acrescentar campos sem quebrar a integração.
- `status` aceita qualquer texto, porque o valor num `expired_order` não é documentado. O estado do pedido vem do `event`, não do `status`.
- O telefone não tem o formato validado: um telefone fora do E.164 só deixa `ddd` e `pais` nulos, sem rejeitar o pedido.
- Os erros de validação (zod 4) trazem caminho, código e mensagem, mas **nunca o valor recebido**. Por isso podem ser gravados e devolvidos sem vazar dado pessoal (há teste para isso).

## 4. Redação na entrada (D1)

O payload bruto **só existe na memória da requisição**. O que se grava, e também o que o processamento lê, é o payload redigido (`payloadRifeiRedigidoSchema`, montado por `redigirPayloadRifei`).

- A redação usa **lista de permissão**: é montada campo a campo, e o que não está nela é descartado, inclusive campos novos que a Rifei venha a mandar.
- O `buyer` inteiro sai e entra `comprador: { ddd, pais }`, derivados de `buyer.phone` por `derivarTelefone`:
  - `pais` é o código de discagem do país (DDI) em dígitos, ex. `"55"`. É calculado pela tabela E.164 de códigos com 1 e 2 dígitos; os demais têm 3.
  - `ddd` só existe para `+55` com 10 ou 11 dígitos nacionais e DDD sem zero. Ex.: `+5591988887777` dá `{ ddd: "91", pais: "55" }`; `+351910000002` dá `{ ddd: null, pais: "351" }`; um telefone sem `+` dá tudo `null`.
- Saem também `observation`, `fbp` e `fbc`.
- O schema redigido é **estrito**: qualquer campo a mais (ex.: `buyer`) faz a validação falhar. Os testes conferem o tipo (`expectTypeOf`) e o valor: nenhum texto pessoal de nenhuma fixture sobra no JSON redigido.

## 5. Processamento de cada entrega

A ordem importa:

1. Segredo `RIFEI_WEBHOOK_TOKEN` ausente: **503** `nao_configurado` e nada é gravado (D6).
2. `Authorization` ausente ou inválido: **401** `nao_autenticado` e nada é gravado (D6).
3. Corpo que não é JSON: grava um evento `erro_validacao` e responde **400** `json_invalido` (D9). A mensagem do problema é fixa: a do `JSON.parse` traz um trecho do corpo e nunca é gravada, devolvida nem logada (D1).
4. `payloadRifeiSchema` falha: grava um evento `erro_validacao` com `identificarPayloadInvalido` (só os textos de `event`, `id` e `slug`) e os problemas sem valores, e responde **400** `payload_invalido` (D9).
5. Redige o payload (D1).
6. Sem campanha ativa, ou `slug` diferente de `campanhas.slug_rifei`: grava um evento `ignorado_outra_campanha` (com o payload redigido) e responde **200** (D5). Sem campanha ativa, o evento também cai aqui (SUPOSIÇÃO): o payload redigido fica guardado e pode ser reprocessado depois que a campanha for configurada.
7. Decide a transição com `decidirTransicaoPedido(status atual, event)` (D3, D4; tabela abaixo).
8. Se `affiliate_id` não é nulo e ainda não existe: cria o afiliado **não vinculado**, com `celula_id` nulo e `origem = 'webhook'`. É a fila de órfãos (D7).
9. Se o resultado é `processado`: cria ou atualiza o pedido com os dados **deste** evento (valores em centavos, instantes em UTC, `ddd`/`pais`, `utm`). Se o pedido fica `approved` e `approved_at` vem nulo, `aprovado_em` recebe o instante do recebimento.
10. Grava o evento em `webhook_eventos` (resultado, status anterior e resultante, payload redigido) e responde **200** `{ "resultado", "evento_id" }`.
11. Qualquer falha de banco nos passos 3 a 10: **500** `erro_interno` (D9). Se a Rifei não reenviar, a reconciliação por CSV recupera.

Os passos 8 a 10 vão num único `db.batch` (uma transação no D1). A transição deve ser gravada com um UPSERT condicional, para continuar correta com entregas simultâneas do mesmo pedido. Exemplo para `paid_order`: `ON CONFLICT (id) DO UPDATE ... WHERE pedidos.status IN ('in_process', 'expired')`.

### Máquina de estados (D4) e idempotência (D3)

| Estado atual \ evento | `new_order` | `paid_order` | `expired_order` |
|---|---|---|---|
| (não existe) | processado → `in_process` | processado → `approved` | processado → `expired` |
| `in_process` | duplicado | processado → `approved` | processado → `expired` |
| `expired` | ignorado_transicao | processado → `approved` (pago depois de expirar) | duplicado |
| `approved` (terminal) | ignorado_transicao | duplicado | ignorado_transicao |

- **Só `approved` conta como venda.**
- Eventos fora de ordem (pago antes do novo) criam o pedido direto no estado certo.
- Reentregar o mesmo evento dá `duplicado` e não muda nada. Toda entrega autenticada vira uma linha em `webhook_eventos`, inclusive as duplicadas.
- A tabela está em `TRANSICOES_PERMITIDAS` e `STATUS_ALVO_POR_EVENTO` (`dominio.ts`) e é testada caso a caso.

### Atribuição à célula (D7)

- `affiliate_id` → `afiliados.celula_id`. Se `celula_id` é nulo, o afiliado está **não vinculado**.
- Venda sem `affiliate_id` fica em "sem afiliado": conta no total da campanha, mas não entra em nenhuma célula.
- A célula de um pedido **não é gravada no pedido**: é resolvida por JOIN na leitura (view `vendas_aprovadas`). Vincular um afiliado (`PUT /api/admin/afiliados/:affiliateId`) reatribui na hora todas as vendas dele, sem migração de dados.
- A coordenação pode cadastrar o afiliado antes da primeira venda (origem `manual`), por exemplo na reunião de cadastro dos líderes.

## 6. Valores (D2) e fuso (D8)

- Reais viram centavos com `reaisParaCentavos(valor) = Math.round(valor * 100)`. Ex.: `1.25` → `125`; `0.1 + 0.2` → `30`.
- O valor arrecadado é `total`, que já desconta promoção e cupom.
- Os instantes da Rifei (ex.: `2024-08-23T12:09:29.243-03:00`) são gravados em UTC (`2024-08-23T15:09:29.243Z`), com `new Date(x).toISOString()`.
- O dia e o período da campanha são calculados no fuso da campanha (`campanhas.fuso_horario`, padrão `America/Belem`, UTC−3 fixo). Ex.: o dia local `2026-12-01` vai de `2026-12-01T03:00:00.000Z` a `2026-12-02T03:00:00.000Z` (exclusivo).

## 7. Fixtures (`test/fixtures/rifei/`)

Todas são fictícias. A única exceção é a oficial, que é o exemplo da própria documentação. O slug da campanha "configurada" nos testes é `videira-kids-teste`.

| Arquivo | Cenário | Esperado |
|---|---|---|
| `paid_order.oficial.json` | exemplo oficial, idêntico ao da doc; sem `expired_at`, `fbp` e `fbc` | válido; slug `demonstracao` = outra campanha |
| `new_order.afiliado.json` | pedido novo do afiliado 1042, DDD 91, com `fbp` | válido; `in_process` |
| `paid_order.afiliado.json` | o mesmo pedido pago, com `fbp` e `fbc` | válido; `approved`; reentrega = `duplicado` |
| `expired_order.json` | pedido do afiliado 1043 (telefone de Portugal, cupom) que expirou | válido; `expired`. **SUPOSIÇÃO**: `status` e `status_detail` = `"expired"` |
| `paid_order.apos_expirado.json` | o mesmo pedido pago depois de expirar | válido; `expired` → `approved` |
| `paid_order.outra_campanha.json` | slug `outra-campanha-da-conta`, endereço completo | válido; `ignorado_outra_campanha` |
| `new_order.minimo.json` | todos os campos `null/...` ausentes, inclusive `utm` | válido; ausentes viram null |
| `malformado.json` | evento desconhecido, sem `id`, valores em texto, data fora do ISO, `affiliate_id` em texto | rejeitado (400) e sem vazar dado pessoal no erro |

Os valores de `status_detail` em `new_order` (`"pending"`) e em `expired_order` (`"expired"`) também são SUPOSIÇÃO.

## 8. Confirmado × suposição

| Item | Situação |
|---|---|
| Campos, tipos e exemplo do payload | CONFIRMADO (doc oficial) |
| Webhook por conta, com token Bearer opcional e 3 eventos | CONFIRMADO |
| `affiliate_id` no payload liga a venda ao afiliado | CONFIRMADO no schema da doc; o valor real ainda não foi visto |
| `expired_at`, `fbp` e `fbc` podem faltar | CONFIRMADO pelo exemplo oficial |
| `status` num `expired_order` (a doc lista só `in_process` e `approved`) | SUPOSIÇÃO; o sistema não depende disso |
| `status_detail` em `new_order` e `expired_order` | SUPOSIÇÃO |
| `utm` inteiro ausente ou null | SUPOSIÇÃO (tolerado) |
| Retry, reenvio, ordem de entrega e assinatura HMAC | NÃO DOCUMENTADO; o sistema assume duplicatas, ordem trocada e perda |
| `new_order` já com `status: approved` (venda lançada pelo admin) | NÃO DOCUMENTADO; hoje o estado vem só do `event` |
| Marcar pago à mão no painel dispara `paid_order` | SUPOSIÇÃO (o exemplo oficial tem `status_detail: changed_by_admin`) |
| Colunas do CSV "Exportar Pedidos" | PARCIAL: só "Bilhetes" e "Nome" confirmados; separador vírgula |

## 9. O que confirmar com uma campanha de teste

Antes do primeiro dia de vendas, com uma campanha de teste, uma segunda conta como afiliada e compras de valor mínimo:

1. **Link de afiliado**: o formato do link e se o id do afiliado aparece nele.
2. **affiliate_id de cada líder**: onde ver no painel da Rifei (página de afiliados?) e se é o mesmo número que chega no webhook. Sem isso, o vínculo da reunião de cadastro dos líderes depende de uma venda de teste por líder.
3. Se `affiliate_id` chega mesmo como inteiro (a doc diz integer) e se é `null` quando não há afiliado.
4. `status` e `status_detail` reais em `new_order` e `expired_order`, se `expired_at` vem preenchido e se `fbp`/`fbc` aparecem.
5. Se `new_order` pode chegar já `approved` e se marcar pago à mão no painel dispara `paid_order`.
6. Se o pedido pode ser pago depois de expirar com o gateway escolhido (Efí), gerando `paid_order` depois de `expired_order`.
7. Formato real de `buyer.phone` (sempre E.164?) e de `utm` sem parâmetros (null? ausente? strings vazias?).
8. Retry: se a Rifei reenvia depois de um 500 ou de um timeout, quantas vezes e em que ordem. Dá para testar respondendo 500 de propósito num ambiente de teste.
9. **CSV "Exportar Pedidos"**: quais colunas existem (id do pedido? afiliado? status? valor? data de pagamento?), o formato dos valores (`R$ 20,00`?), o encoding e o separador, e o efeito da opção "Um bilhete por linha". Isso fecha o formato da reconciliação (`POST /api/admin/reconciliacao`, ainda rascunho).
10. Se o slug muda quando a campanha é renomeada (o filtro D5 depende dele).
11. O tempo de reserva até expirar (`expires_at − created_at`), que define o volume de `expired_order`.

Os payloads reais capturados devem virar fixtures novas, com os dados pessoais trocados por fictícios antes do commit.

## 10. Reconciliação por CSV (rascunho, Sprints 3–4)

Não há retry documentado, então o webhook não pode ser a única fonte. A coordenação exporta o CSV na Rifei (página de pedidos da campanha → ⋮ → **Exportar Pedidos**) e envia em `POST /api/admin/reconciliacao`. O sistema compara com `pedidos` e devolve as divergências: ausente no sistema, ausente no CSV, status, valor e afiliado.

O CSV traz nome, e-mail e telefone dos compradores. Ele é lido **só em memória**: nada dele é gravado, e a resposta não devolve nenhum dado pessoal (D1). O formato final depende do item 9 acima.
