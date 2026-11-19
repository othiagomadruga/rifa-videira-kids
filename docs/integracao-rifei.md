# Integração com a Rifei

A Rifei faz a venda, o pagamento e o sorteio. Este sistema recebe cada pedido por **webhook**, guarda o pedido **sem dados pessoais do comprador** e descobre de qual célula ele veio pelo `affiliate_id` (cada líder de célula é afiliado da campanha na Rifei).

- Contrato executável: `src/shared/contracts/rifei.ts` (payload, redação, conversões) e `src/shared/contracts/dominio.ts` (máquina de estados).
- Rota: `POST /api/webhooks/rifei` (detalhes em [api.md](api.md)). Tabelas: `pedidos`, `afiliados` e `webhook_eventos` (detalhes em [modelo-de-dados.md](modelo-de-dados.md)).
- Fonte oficial, lida em 06/11/2026: [Referência do webhook](https://rifei.com.br/ajuda/webhook/referencia-do-webhook) e [Como adicionar um webhook](https://rifei.com.br/ajuda/webhook/como-adicionar-webhook).
- Passo a passo na Rifei e na Efí para o PO (campanha, slug, afiliados, Efí, estorno), conferido em 11/11/2026: [seção 12](#12-rifei-e-efí-passo-a-passo-para-o-po).

Neste documento, **CONFIRMADO** quer dizer que está na documentação oficial e **SUPOSIÇÃO** quer dizer que ainda precisa ser conferido na compra de teste (lista na seção 9).

## Decisões da integração (D1 a D9)

| | Decisão | Onde está no contrato |
|---|---|---|
| D1 | Redação na entrada: do `buyer` só se guardam DDD e código do país, derivados do telefone. Nunca se guardam nome, e-mail, documento, nascimento, endereço, telefone completo, `observation`, `fbp` e `fbc`. O payload guardado é o redigido. | `redigirPayloadRifei`, `payloadRifeiRedigidoSchema` (estrito), `derivarTelefone`; nenhuma coluna pessoal na SQL |
| D2 | Dinheiro em centavos inteiros, por aritmética decimal exata (não por float): fração de centavo é arredondada meio para cima, com aviso (RIFA-002b) | `reaisParaCentavos`, `textoDecimalParaCentavos`; colunas `*_centavos` |
| D3 | O pedido é identificado pelo `id` da Rifei. Toda entrega é registrada com o payload redigido, e o processamento é idempotente. | `pedidos.id` (PK), `webhook_eventos`, resultado `duplicado` |
| D4 | Estados: `in_process` → `approved` \| `expired`; `expired` → `approved`; `approved` é terminal. Fora de ordem cria o pedido direto no estado certo. Só `approved` é venda. | `decidirTransicaoPedido`, `TRANSICOES_PERMITIDAS`; CHECK de `status` |
| D5 | `slug` diferente do configurado: evento registrado como ignorado, resposta 200 | `campanhas.slug_rifei`; resultado `ignorado_outra_campanha` |
| D6 | `Authorization: Bearer` comparado em tempo constante com o token gerado pela tela da coordenação (RIFA-039, `docs/decisions.md` D21; no banco, só o SHA-256) ou, só sem ele, com o segredo `RIFEI_WEBHOOK_TOKEN`. Inválido ou ausente: 401. Nenhum dos dois: 503. | `ROTAS_TOKEN_WEBHOOK`, `credencialVigenteDoWebhook` e `SEGREDO_WEBHOOK_RIFEI`; grupo `rifei_bearer`; códigos `nao_autenticado` e `nao_configurado` |
| D7 | `affiliate_id` → afiliado → célula. Afiliado desconhecido entra como não vinculado (fila de órfãos); venda sem afiliado fica em "sem afiliado". A célula é resolvida por JOIN na leitura. | tabela `afiliados` (`celula_id` NULL), view `vendas_aprovadas` |
| D8 | Fuso da campanha `America/Belem` para dia e semana | `campanhas.fuso_horario` (padrão), `FUSO_PADRAO`; instantes guardados em UTC |
| D9 | 200 depois de gravar; payload sem o essencial (`event`, `id`, `slug`, `numbers_count`, `total`): 400, registrado com erro; o resto é tolerado com avisos (RIFA-002b); falha de banco: 500 | `analisarPayloadRifei`; resultado `erro_validacao`; `webhook_eventos.avisos`; códigos `json_invalido`, `payload_invalido` e `erro_interno` |

## 1. Configurar o webhook na Rifei

O webhook é da **conta**, não da campanha. Por isso ele recebe pedidos de todas as campanhas da conta, e o sistema filtra pelo `slug` da campanha configurada (D5).

1. Gerar o token pela tela da coordenação (só admin; RIFA-039, `docs/decisions.md` D21): **Acessos → Webhook da Rifei → Gerar token do webhook** (`POST /api/admin/webhook/token`). São 32 bytes aleatórios em hex (64 caracteres, só letras e números), mostrados **uma vez**, com **Copiar**; no banco fica só o SHA-256. Gerar de novo invalida o anterior na hora.
2. Alternativa, sem a tela: gerar um token forte (`openssl rand -hex 32`) e guardá-lo como segredo do Worker, sem versionar: `wrangler secret put RIFEI_WEBHOOK_TOKEN` (lançamento, seção 3.2). **O token da tela tem prioridade**: com ele, o segredo não vale. Para desenvolvimento local, o segredo vai no `.dev.vars`, que está no `.gitignore`.
3. Na Rifei: menu do usuário → **Integrações** → seção **Outro** → **Adicionar** (webhook).
   - **URL**: `https://<domínio do Worker>/api/webhooks/rifei`. Com barra no fim também funciona (`CAMINHOS_WEBHOOK_RIFEI`). A URL precisa aceitar POST com corpo JSON.
   - **Token**: o do passo 1 (ou o da alternativa do passo 2). A Rifei manda `Authorization: Bearer <token>`.
   - **Eventos**: marcar os três de pedido, "Novo pedido", "Pedido aprovado" (o "Pedido pago" do artigo) e "Pedido expirado"; "Prêmio instantâneo" fica desmarcado (seção 12.4).
   - Ao tocar em **Adicionar**, a Rifei manda um teste (`{"event":"test"}`) e só aceita a URL com resposta 2xx; o sistema responde 200 `{"resultado":"teste"}` sem gravar nada (RIFA-060; seção 5, passo 3).
4. No sistema, configurar a campanha (`PUT /api/admin/campanha`) com `slug_rifei` igual ao slug da campanha na Rifei, que é o identificador que aparece no link da campanha (seção 12.1).
5. Conferir com um pedido de teste: a entrega aparece em `webhook_eventos` com `resultado = 'processado'`.

Para trocar o token, faça a mudança nos dois lados em sequência: primeiro no sistema (gerar de novo na tela, com confirmação, ou o segredo do Worker na alternativa), depois na Rifei. Entre um passo e outro, as entregas recebem 401 e não são gravadas; a conferência pelo CSV (seção 10) recupera o que se perder.

## 2. Autenticação (D6)

- O Worker lê a linha do token gerado pela tela (1 linha do D1 por requisição, sem cache; D21) e decide a credencial que vale: **o token da tela, se existe**; senão, o segredo `RIFEI_WEBHOOK_TOKEN`.
- Compara o header `Authorization: Bearer <token>` com ela usando **comparação em tempo constante**: o SHA-256 do Bearer contra o hash gravado, ou o Bearer contra o segredo.
- Se o header estiver ausente ou errado, a resposta é **401** `nao_autenticado` e nada é gravado. Com o token da tela, o segredo do Worker também leva 401.
- Se não houver nenhum dos dois (nem token da tela nem segredo), a resposta é **503** `nao_configurado` e nada é gravado. É uma falha fechada: sem credencial, o Worker nunca aceita entregas.
- A Rifei não documenta assinatura HMAC. O token estático é a única proteção, por isso ele deve ser forte e trafegar só por HTTPS.

## 3. Payload

Corpo JSON, como a Rifei documenta. Os nomes dos campos ficam como a Rifei manda.

**A Rifei não reenvia avisos: um 400 é uma venda perdida.** Por isso o webhook só recusa quando falta o que torna o pedido gravável (coluna "Essencial"). Todo o resto é tolerado: se vier ausente ou com tipo errado, vira `null` e a diferença é registrada como **aviso**.

| Campo | Tipo (doc) | Essencial? | Se vier ausente ou com tipo errado | O que o sistema faz |
|---|---|---|---|---|
| `event` | string | **sim**: `new_order`, `paid_order` ou `expired_order` | 400 | define a transição (D4) |
| `id` | string | **sim**: texto de 1 a 128 caracteres; inteiro seguro (`12345`) vira texto, com aviso | 400 | chave do pedido (D3) |
| `slug` | string | **sim**: texto de 1 a 200 caracteres; espaços nas pontas são removidos, com aviso | 400 | filtro da campanha (D5) |
| `numbers_count` | integer | **sim**: inteiro de 0 a 1.000.000; texto de inteiro (`"12"`, `"12.0"`) é convertido, com aviso | 400 | `pedidos.qtd_bilhetes` (metas em bilhetes) |
| `total` | number (reais) | **sim**: de 0 a R$ 10.000.000,00; texto decimal com ponto (`"19.90"`) é convertido de forma exata, com aviso; vírgula decimal não | 400 | `total_centavos`: é o valor arrecadado |
| `affiliate_id` | null/integer | não: inteiro > 0, ou texto só com dígitos (`"1042"`, com aviso) | null + aviso: a venda vai para "sem afiliado" e aparece na conferência | liga a venda à célula (D7) |
| `created_at` | ISO 8601 | não | null + aviso; `pedidos.criado_em` fica NULL | `criado_em` (em UTC) |
| `approved_at` | null/ISO 8601 | não | null (+ aviso se o tipo for errado); pedido aprovado usa o instante do recebimento | `aprovado_em` (em UTC) |
| `expires_at` | ISO 8601 | não | null + aviso | `expira_em` (em UTC) |
| `expired_at` | null/ISO 8601 | não; falta no exemplo oficial | null (+ aviso se o tipo for errado) | `expirado_em` (em UTC) |
| `is_rifinha` | boolean | não | null + aviso | `pedidos.rifinha` |
| `status` | string (`in_process`, `approved`) | não; qualquer texto de 1 a 100 caracteres | null + aviso | `status_rifei` (informativo) |
| `status_detail` | string | não; até 100 caracteres | null + aviso | `status_detail_rifei` (informativo) |
| `payment_method` | string | não; até 100 caracteres | null + aviso | `metodo_pagamento` |
| `subtotal` | number (reais) | não; texto numérico é convertido, com aviso | null + aviso | `subtotal_centavos` (D2) |
| `promotion_discount`, `coupon_discount` | null/number | não | null (+ aviso se o tipo for errado) | `desconto_*_centavos` |
| `coupon_id` | null/integer | não | null (+ aviso se o tipo for errado) | `cupom_id` |
| `numbers`, `lucky_numbers` | null/int[] | não; até 10.000 números guardados | null (+ aviso se o tipo for errado ou passar do limite) | `pedidos.numeros` (reconciliação); `lucky_numbers` só no payload redigido |
| `upsells` | string[] | não; até 50 itens de até 200 caracteres | null + aviso | só no payload redigido |
| `utm.source/campaign/medium/content/term` | null/string | não; até 500 caracteres; `utm` inteiro ausente ou null também é aceito (SUPOSIÇÃO) | null (+ aviso se o tipo for errado) | `utm_*` |
| `buyer` inteiro (`name`, `phone`, `email`, `document`, `date_of_birth`, `address`) | objeto | não; qualquer tipo, inclusive `address` em texto | null (+ aviso) | **descartado** (D1); só `buyer.phone` é lido, para derivar `ddd` e `pais` |
| `observation`, `fbp`, `fbc` | null/string | não; `fbp` e `fbc` faltam no exemplo oficial | null (+ aviso se o tipo for errado) | **descartados** (D1) |

O exemplo oficial está, idêntico, em [`test/fixtures/rifei/paid_order.oficial.json`](../test/fixtures/rifei/paid_order.oficial.json).

### Validação e avisos (`analisarPayloadRifei`)

O contrato tem dois schemas para o mesmo payload, e `analisarPayloadRifei(corpo)` aplica os dois:

- **`payloadRifeiSchema` (tolerante)** decide. Recusa só os essenciais da tabela; o resto vira `null` com `.catch(null)`.
- **`payloadRifeiDocSchema` (fiel à documentação)** não decide nada: cada diferença em relação à doc vira um aviso (caminho, código e mensagem do zod, **nunca o valor recebido**).

O resultado é `{ aceito: true, payload, avisos }` ou `{ aceito: false, problemas }`:

- Campo que a doc marca como `null/...` e vem ausente não gera aviso: é o caso de `expired_at`, `fbp` e `fbc` no exemplo oficial. Campo obrigatório na doc que vem ausente gera aviso.
- Conversões feitas (`id: 12345`, `slug` com espaços, `numbers_count: "12"`, `total: "19.90"`, `affiliate_id: "1042"`) também geram aviso, porque fogem da doc.
- Valores acima dos limites da tabela são tratados como inválidos: recusa (400, com mensagem clara) nos essenciais, null com aviso nos informativos. Assim nada estoura uma restrição do banco (500).
- Fração de centavo (`total: 1.005`) é arredondada meio para cima (101 centavos) e gera o aviso `fracao_de_centavo`.
- Campos desconhecidos são **tolerados e descartados**, sem aviso: a Rifei pode acrescentar campos sem quebrar a integração.
- O telefone não tem o formato validado: um telefone fora do E.164 só deixa `ddd` e `pais` nulos.
- Nem os problemas nem os avisos carregam dado pessoal; há teste para isso com as fixtures malformada e de tipos estranhos.
- **Avisos e problemas são agrupados e limitados** (`resumirDetalhes`): o caminho perde os índices (`["numbers", "*"]`) e cada item traz `ocorrencias`. São no máximo 50 itens mais um item final `itens_omitidos` com o total omitido. Assim 10.000 bilhetes inválidos viram um aviso só, e o registro do evento nunca passa do limite de 2 MB por linha do D1.
- Os avisos vão para `webhook_eventos.avisos` via `avisosParaGravar`: lista vazia vira NULL (a coluna nunca guarda `[]`). Servem para a conferência: dá para listar as entregas aceitas com avisos e conferir a venda.

## 4. Redação na entrada (D1)

O payload bruto **só existe na memória da requisição**. O que se grava, e também o que o processamento lê, é o payload redigido (`payloadRifeiRedigidoSchema`, montado por `redigirPayloadRifei`).

- A redação usa **lista de permissão**: é montada campo a campo, e o que não está nela é descartado, inclusive campos novos que a Rifei venha a mandar.
- O `buyer` inteiro sai e entra `comprador: { ddd, pais }`, derivados de `buyer.phone` por `derivarTelefone`:
  - `pais` é o código de discagem do país (DDI) em dígitos, ex. `"55"`. É calculado pela tabela E.164 de códigos com 1 e 2 dígitos; os demais têm 3.
  - `ddd` só existe para `+55` com 10 ou 11 dígitos nacionais e DDD sem zero. Ex.: `+5591988887777` dá `{ ddd: "91", pais: "55" }`; `+351910000002` dá `{ ddd: null, pais: "351" }`; um telefone sem `+`, ou que não seja texto, dá tudo `null`.
- Saem também `observation`, `fbp` e `fbc`.
- O schema redigido é **estrito**: qualquer campo a mais (ex.: `buyer`) faz a validação falhar. Os testes conferem o tipo (`expectTypeOf`) e o valor: nenhum texto pessoal de nenhuma fixture sobra no JSON redigido.

## 5. Processamento de cada entrega

A ordem importa:

1. Nenhuma credencial (nem o token gerado pela tela nem o segredo `RIFEI_WEBHOOK_TOKEN`): **503** `nao_configurado` e nada é gravado (D6, D21). A leitura do token da tela é a única ida ao banco antes da autenticação (1 linha).
2. `Authorization` ausente ou inválido: **401** `nao_autenticado` e nada é gravado (D6).
   - Depois da autenticação: corpo acima de 1 MiB (`LIMITE_CORPO_WEBHOOK_BYTES`) grava um evento `erro_validacao` sem payload, com o problema `corpo_muito_grande`, e responde **413** `corpo_muito_grande`. Um pedido real ocupa poucos KB.
3. Corpo que não é JSON: grava um evento `erro_validacao` e responde **400** `json_invalido` (D9). A mensagem do problema é fixa: a do `JSON.parse` traz um trecho do corpo e nunca é gravada, devolvida nem logada (D1).
   - Depois do JSON, o teste da Rifei (RIFA-060): um objeto com `event` exatamente `"test"` (o que a Rifei manda ao "Adicionar" o webhook, sem pedido) responde **200** `{ "resultado": "teste" }` e nada é gravado. Só chega aqui com o Bearer certo e dentro do limite de tamanho; qualquer outro `event` desconhecido segue para o passo 4 (400 `payload_invalido`).
4. `analisarPayloadRifei` recusa (falta um essencial): grava um evento `erro_validacao` com `identificarPayloadInvalido` (só os textos de `event`, `id` e `slug`) e os `problemas`, e responde **400** `payload_invalido` (D9).
5. Redige o payload aceito (D1). Os `avisos` acompanham o evento até a gravação.
6. Sem campanha ativa, ou `slug` diferente de `campanhas.slug_rifei`: grava um evento `ignorado_outra_campanha` (com o payload redigido e os avisos) e responde **200** (D5). Sem campanha ativa, o evento também cai aqui (SUPOSIÇÃO): o payload redigido fica guardado e pode ser reprocessado depois que a campanha for configurada.
7. Decide a transição com `decidirTransicaoPedido(status atual, event)` (D3, D4; tabela abaixo).
8. Se `affiliate_id` não é nulo e ainda não existe: cria o afiliado **não vinculado**, com `celula_id` nulo e `origem = 'webhook'`. É a fila de órfãos (D7).
9. Grava o pedido:
   - **Pedido novo** (`processado`): todos os campos vêm deste evento (centavos exatos, instantes em UTC, `ddd`/`pais`, `utm`); os informativos podem ser NULL. `created_at` nulo deixa `criado_em` NULL.
   - **Pedido existente**: o `status` segue a máquina de estados (tabela abaixo). Os campos informativos (`affiliate_id`, `criado_em`, `expirado_em`, `utm_*`, `cupom_id` e descontos, `subtotal_centavos`, `status_rifei`, `status_detail_rifei`, `metodo_pagamento`) só são sobrescritos por valor **não nulo**, com `COALESCE(excluded.x, pedidos.x)` no UPSERT. Assim um campo que chegou null por tolerância (inválido, com aviso) nunca apaga um valor bom já gravado.
   - **Afiliado tardio**: se o pedido está sem afiliado e **qualquer** evento dele traz `affiliate_id` válido, o afiliado é preenchido. Isso vale inclusive para os eventos `duplicado` e `ignorado_transicao`; o resto do pedido não muda.
   - Pedido `approved` com `approved_at` nulo: `aprovado_em` recebe o instante do recebimento.
10. Grava o evento em `webhook_eventos` (resultado, status anterior e resultante, payload redigido e `avisosParaGravar(avisos)`) e responde **200** `{ "resultado", "evento_id" }`.
11. Qualquer falha de banco nos passos 3 a 10: **500** `erro_interno` (D9). Se a Rifei não reenviar, a conferência pelo CSV (seção 10) recupera a venda que não ficou no sistema; se o pedido já estava gravado (ex.: o `paid_order` falhou depois do `new_order`), ela o mostra como `pagamento_nao_registrado` e o admin o marca como pago (seção 10, Recuperar; RIFA-056).

**Concorrência.** Os passos 8 a 10 vão num único `db.batch` (uma transação no D1). A transição é gravada com um UPSERT condicional, por exemplo para `paid_order`: `ON CONFLICT (id) DO UPDATE ... WHERE pedidos.status IN ('in_process', 'expired')`. Com duas entregas simultâneas do mesmo pedido, o status lido no passo 7 pode estar velho. Por isso o **resultado gravado no evento vem do `meta.changes` do UPSERT**, e não da leitura:

- `changes = 1`: o pedido foi criado ou mudou, e o resultado é `processado`;
- `changes = 0`: nada mudou. O status atual é lido de novo e classificado pela tabela: `duplicado` se já está no estado do evento, `ignorado_transicao` se não.

O preenchimento do afiliado tardio é um UPDATE à parte (`... SET affiliate_id = ? WHERE id = ? AND affiliate_id IS NULL`), no mesmo batch, e não entra nessa conta: um evento `duplicado` que só preencheu o afiliado continua `duplicado`.

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

- Reais viram centavos com `reaisParaCentavos(valor)`, por aritmética decimal exata, e não por float. Ela usa os dígitos do número como vieram no JSON (`String(1.005)` é `"1.005"`); texto (`"19.90"`) é lido direto da string por `textoDecimalParaCentavos`.
  - Fração de centavo é arredondada **meio para cima** e gera aviso: `1.005` → `101`, `2.675` → `268`, `1.004` → `100`. Em float, `Math.round(1.005 * 100)` daria `100` sem aviso nenhum.
  - Outros exemplos: `1.25` → `125`; `0.1 + 0.2` → `30`.
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
| `paid_order.tipos_estranhos.json` | tipos errados em todos os campos informativos e no `buyer`; `numbers_count`, `total` e `affiliate_id` em texto | **aceito**, com os essenciais convertidos, o resto null e um aviso por campo |
| `malformado.json` | evento desconhecido, sem `id`, `slug` vazio, `numbers_count` negativo e `total` com vírgula | recusado (400), com os problemas só nesses cinco campos e sem vazar dado pessoal |

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
| Teste ao "Adicionar" o webhook: POST com o Bearer e `{"event":"test"}`, aceito só com resposta 2xx | CONFIRMADO em 17/11/2026 (seção 9, item 12; RIFA-060) |
| Retry, reenvio, ordem de entrega e assinatura HMAC | NÃO DOCUMENTADO; o sistema assume duplicatas, ordem trocada e perda |
| `new_order` já com `status: approved` (venda lançada pelo admin) | NÃO DOCUMENTADO; hoje o estado vem só do `event` |
| Marcar pago à mão no painel dispara `paid_order` | SUPOSIÇÃO (o exemplo oficial tem `status_detail: changed_by_admin`); a compra de teste no Pix manual confirma (seção 9, item 5) |
| Colunas do CSV "Exportar Pedidos" | PARCIAL: a janela mostra "Bilhetes", "Quantidade de bilhetes", "Nome", "Email" e "Telefone" (há mais abaixo); separador vírgula; opção "Um bilhete por linha" (seção 12.5); a conferência detecta pelo nome e a coordenação confirma (seção 10) |
| `slug` é o fim do link da campanha (`rifei.com.br/<slug>`) | CONFIRMADO em parte: o exemplo oficial do webhook traz `demonstracao`, e a campanha de demonstração da Rifei está em `rifei.com.br/demonstracao` (seção 12.1) |
| Afiliado: área por organizador, entrada por e-mail, cadastro por convite | CONFIRMADO nas páginas públicas da conta de demonstração; as telas do organizador e o link de afiliado NÃO DOCUMENTADOS (seção 12.3) |
| Estorno ou remoção de pedido na Rifei | NÃO DOCUMENTADO; não existe evento de webhook para isso (seção 12.6) |

## 9. O que confirmar com uma campanha de teste

O lançamento não pergunta ao suporte da Rifei (decisão do PO, 15/11/2026): o que as fontes não dizem se descobre no painel e na compra de teste do roteiro ([lançamento, seção 4](lancamento.md#4-compra-de-teste-de-ponta-a-ponta)), feita na própria campanha, antes da largada, com uma segunda conta como afiliada e 1 bilhete. Os itens marcados **(lançamento)** respondem às perguntas 1, 2, 3, 8 e 9 da 12.7 e são os que a largada precisa; os outros se anotam quando aparecerem, sem segurar nada.

**No painel, ao criar a campanha (lançamento; pergunta 1 da 12.7):** onde ligar os afiliados na campanha e gerar o convite; se é um convite por afiliado (pedindo o e-mail de cada um?) ou um para todos; e se o cadastro "só por convite" é escolha do organizador (seção 12.3). Sem isso não há conta afiliada de teste nem convite para os líderes (lançamento, 1.3 e 5.1).

Na compra de teste:

1. **Link de afiliado (lançamento; pergunta 2 da 12.7)** (como o líder vira afiliado: seção 12.3): onde o afiliado acha o link (a conta de teste entra pela "Área de afiliados"), o formato do link e se o id do afiliado aparece nele (compare com o "Afiliado <código>" que aparece em Adesão → Sem célula). NÃO DOCUMENTADO pela Rifei. O formato confirmado vira o modelo do link de vendas (seção 12.3, D24; lançamento, 3.6 e 4.1, passo 3).
2. **affiliate_id de cada líder (lançamento; pergunta 3 da 12.7)**: o código que chega no webhook é o que aparece em Sem célula. Confira se é o mesmo número do link (item 1) e se o painel mostra esse número na lista de afiliados (NÃO DOCUMENTADO; seção 12.3). Sem isso, o vínculo da reunião de cadastro dos líderes depende de uma compra iniciada por líder (lançamento, seção 5.2), que já é o plano.
3. Se `affiliate_id` chega mesmo como inteiro (a doc diz integer) e se é `null` quando não há afiliado.
4. `status` e `status_detail` reais em `new_order` e `expired_order`, se `expired_at` vem preenchido e se `fbp`/`fbc` aparecem.
5. Se `new_order` pode chegar já `approved` e se marcar pago à mão no painel dispara `paid_order`. **(lançamento, no Pix manual; pergunta 9 da 12.7)** Na compra de teste com o Pix manual (lançamento, 1.6 e 4.1, passo 4): marque o pedido como pago no painel e veja se chega "Pedido pago" em Pedidos → Entregas do webhook, com a célula do afiliado. Se não chegar, o pedido fica `in_process` (ou `expired`) e não conta até a conferência pelo CSV: ela o mostra como `pagamento_nao_registrado`, e o admin o marca como pago (seção 10, Recuperar; RIFA-056). No Pix manual sem esse aviso, as vendas passam a contar a cada conferência do admin (lançamento, 1.6).
6. Se o pedido pode ser pago depois de expirar com o gateway escolhido (Efí), gerando `paid_order` depois de `expired_order`.
7. Formato real de `buyer.phone` (sempre E.164?) e de `utm` sem parâmetros (null? ausente? strings vazias?).
8. Retry: se a Rifei reenvia depois de um 500 ou de um timeout, quantas vezes e em que ordem. Dá para testar respondendo 500 de propósito num ambiente de teste.
9. **CSV "Exportar Pedidos"** (lançamento, 4.1, passo 7): quais colunas existem (id do pedido? afiliado? status? valor? data de pagamento?), o formato dos valores (`R$ 20,00`?), o encoding e o separador, e o efeito da opção "Um bilhete por linha". A conferência (seção 10) já detecta as colunas pelo nome e a coordenação confirma o mapeamento; o export real fecha os nomes e os formatos e deve virar um CSV de teste, com os dados pessoais trocados por fictícios.
10. Se o slug muda quando a campanha é renomeada (o filtro D5 depende dele).
11. O tempo de reserva até expirar (`expires_at − created_at`), que define o volume de `expired_order` (lançamento, 4.1, passo 5).
12. ~~Se a Rifei manda um teste ao adicionar o webhook~~: **confirmado em 17/11/2026.** Ao tocar em "Adicionar", a Rifei manda um POST com o Bearer e o corpo `{"event":"test"}` (sem id, slug nem total) e só aceita a URL com resposta 2xx; antes da RIFA-060 o sistema respondia 400 e a Rifei mostrava "A URL informada não retornou uma resposta válida!". Agora o Worker responde 200 `{"resultado":"teste"}` sem gravar nada (só com o token certo).
13. Onde a Efí é adicionada (na conta ou em cada campanha) e o nome do campo da chave Pix na janela "Adicionar Efí" (seção 12.2, passo E).
14. **A indicação do afiliado fica guardada? (lançamento; pergunta 8 da 12.7)** Se o comprador abre o link do afiliado e só compra depois, voltando pela página da campanha sem o link, a compra continua com o afiliado? Teste (lançamento, 4.1, passo 6): no mesmo celular em que abriu o link de afiliado, abra o link comum da campanha e inicie uma compra sem pagar; em Pedidos, a coluna Célula mostra a célula do teste (guardou) ou "Sem afiliado" (não guardou). Outro dia ou outro aparelho ficam sem resposta, e não precisam: o líder orienta a comprar pelo link dele (guia do líder, seção 1). Pagar depois um pedido que já tem o afiliado não o tira do pedido no sistema: um evento sem `affiliate_id` não apaga o que já está gravado (seção 5, passo 9).
15. **O extrato do Bradesco Net Empresa (lançamento, no Pix manual; RIFA-059)** (lançamento, 4.1, passo 4): com o acesso de consulta, onde se salva o extrato e se há o PDF e o OFX (o PDF é lido direto desde a RIFA-068: confira se ele tem texto, se a data vem em toda linha e se o débito tem sinal); no PDF, no OFX (ou no texto copiado da tela), como fica a linha do Pix recebido: o `MEMO` e o `NAME` (ou a descrição), se aparece o identificador da transação (o número do pedido, que a Rifei põe no QR do Pix manual) e se o `DTPOSTED` traz a hora. Na **Conferência → Extrato do banco (Pix manual)**, o pedido de teste vem como **Certo** (o extrato traz o número) ou **Provável** (só o valor e a hora). Anote também o jeito do número do pedido da Rifei (quantos caracteres e se é só de algarismos): só de algarismos e com menos de 8, ele nunca dá **Certo** (D26), e o SM reavalia o mínimo. Mande ao SM só a forma da linha, com o nome trocado por um fictício.

Os payloads reais capturados devem virar fixtures novas, com os dados pessoais trocados por fictícios antes do commit.

## 10. Conferência pelo CSV (Exportar Pedidos, RIFA-012)

Não há retry documentado, então o webhook não pode ser a única fonte. A conferência compara o CSV que a Rifei exporta com os pedidos gravados, recupera as vendas que se perderam e (só o admin) marca como pagos os pedidos cujo pagamento não chegou, para o ranking nunca mentir. Rotas, corpo compacto, schemas e exemplos: [api.md](api.md#conferência-pelo-csv-da-rifei-sprint-4-rifa-012). Tela: `/coordenacao/conferencia`.

### Como a coordenação usa

1. Na Rifei: pedidos da campanha → ⋮ → **Exportar Pedidos**. Incluir o código do pedido, o status, a quantidade de bilhetes, o valor, o afiliado e a data do pagamento, e deixar "Um bilhete por linha" desmarcado (marcado também funciona, desde que venha o código).
2. Na tela, escolher o arquivo como a Rifei baixou (sem abrir e salvar no Excel). O **navegador** lê o arquivo, detecta as colunas pelo nome e mostra o mapeamento: a coordenação troca o que estiver errado e confere de novo.
3. Ler o resumo e as diferenças por tipo, cada uma com a explicação. As **vendas perdidas** (pagas na Rifei e ausentes no sistema) recuperáveis vêm marcadas; "Recuperar" mostra a prévia do que vai entrar e só grava na confirmação. As recuperadas passam a contar no painel, nos rankings e no bumbo.
4. **Pagamento não registrado** (pagos na Rifei, pendentes ou expirados no sistema: o "Pedido novo" chegou e o "Pedido pago" não; RIFA-056), só o admin: os que dá para marcar vêm marcados; "Registrar pagamento" mostra a prévia e só grava na confirmação. O pedido passa a pago com a data do arquivo e passa a contar; quantidade, valor e afiliado ficam os do sistema. A coordenação vê o grupo, sem a seleção.
5. "Recuperações feitas" mostra quem gravou, quando, quantas e o tipo (vendas perdidas, pagamentos registrados ou os dois).

### Onde o arquivo é lido (ciclo 2)

O CSV é lido **no navegador** (`src/shared/conferencia/`: o mesmo código roda nos testes do Worker). Ler o arquivo no Worker custava de 50 a 375 ms de CPU (95% em datas, com um `Intl.DateTimeFormat` por célula). Agora a tela manda à API um corpo compacto: uma lista por campo mapeado, já normalizada (códigos, status, quantidade, a contagem dos números, centavos, afiliado, dia e instante no fuso da campanha, que a tela pede em `GET /api/admin/campanha`), com as linhas iguais juntadas (`vezes`). O Worker confere o corpo com um laço simples, o banco devolve só os pedidos com os códigos do arquivo e os totais já somados, e a análise é um passeio pelos pedidos. Com 7 mil pedidos, a revisão mediu 18 a 22 ms de CPU na 1ª requisição do isolate e 9 a 10 ms nas seguintes (de 15 a 75 ms no teto de 1 MiB): acima dos 10 ms do plano gratuito da Cloudflare, por isso a conferência **exige o Workers Paid** (D19; detalhes em api.md).

O corpo vai até 1 MiB (uns 15 mil pedidos com códigos curtos; 7 mil dão ~430 KB). Acima disso, a tela pede um período menor. O navegador para de ler o arquivo logo depois de 50.000 linhas (não lê milhões de linhas só para recusar).

### Privacidade (D1)

- O texto do arquivo fica só na memória da tela (nunca no `localStorage`) e **não sai do navegador**: para a API vão só as colunas mapeadas que não são de dado pessoal.
- As colunas de dado pessoal, reconhecidas pelo nome (nome, e-mail, telefone, celular, WhatsApp, contato, CPF, documento, nascimento, endereço, CEP, cidade, estado, observação, comprador, cliente, participante, pagador...; o telefone, o e-mail ou o CPF do afiliado; "Número" sozinho num arquivo com endereço), não podem ser mapeadas. A API confere de novo pelo nome e recusa um corpo com uma delas mapeada (400 `coluna_pessoal`). O DDD não é derivado.
- Os números dos bilhetes também não saem do navegador (vai só a contagem): o pedido recuperado fica com `numeros` nulo.
- As respostas só trazem códigos validados, status normalizados, quantidades, centavos, dias e ids de afiliado. O usuário do afiliado que não bate com um rótulo cadastrado é só contado, nunca devolvido.
- O log de erro da rota leva só o nome do erro (e a mensagem, quando é do D1).
- Do arquivo, a auditoria guarda o SHA-256 do texto (calculado no navegador) e os nomes das colunas usadas.
- Os testes varrem os corpos enviados, as respostas, o banco e o log atrás dos dados pessoais fictícios dos CSVs de teste.

### Formatos aceitos

- Arquivo: UTF-8 (com ou sem BOM) ou Windows-1252 (a tela relê), separador `,` ou `;`, aspas do RFC 4180, linhas em branco ignoradas. Até 5 MB, 50.000 linhas e 200 colunas.
- Valores: "R$ 1.234,56", "1.234,56", "20,00", "20.00" e "20"; quantidades inteiras; números dos bilhetes separados por vírgula, ponto e vírgula, barra ou espaço; datas "23/11/2026", "23/11/26 às 14h05" e "2026-11-23 14:35" (hora local do fuso da campanha, inclusive com horário de verão) ou ISO com fuso.
- Fórmula de planilha (=, +, @ ou - seguido de letra) nunca vira valor: a célula fica ilegível e o aviso `formula_ignorada` conta. O código do pedido só aceita letras, números e `. _ : / # -`, começando por letra ou número.
- Sem o código: comparação pelos totais (por afiliado e por dia), sem recuperar; sem o código e sem a quantidade, a quantidade de pedidos não é comparada (uma linha pode ser um bilhete; aviso `sem_contagem_de_pedidos`). Sem o status: tudo conta como pago (com aviso). Sem quantidade, valor ou data: o campo não é comparado; quantidade e valor são obrigatórios para recuperar. Pedido pago com a quantidade vazia ou ilegível não vira 0 bilhete, nem com o valor vazio, ilegível ou ambíguo R$ 0: fica de fora da soma e é contado à parte (`sem_quantidade` e `sem_valor`; na tela, "21 bilhetes (+1 sem quantidade) · R$ 120,00 (+1 sem valor)"), e no agregado a linha não confere nos bilhetes ou no valor.

### Um bilhete por linha: o valor de cada pedido

Com o código, as linhas de cada pedido se juntam (quantidades iguais contam uma vez, com pelo menos uma por linha). O valor:

- valores diferentes nas linhas: somam (são de cada linha);
- só uma linha com o valor (as outras só com o bilhete): é o valor do pedido;
- o **mesmo valor em todas as linhas**: pode ser o de um bilhete ou o do pedido inteiro repetido. Primeiro vale a **convenção do arquivo**, tirada dos pedidos dele que já estão pagos no sistema: se a maioria (e pelo menos 2) tem o total igual a valor × linhas, cada linha é um bilhete; se tem o total igual ao valor, cada linha repete o pedido (avisos `valor_por_bilhete` e `valor_do_pedido_repetido`). Sem convenção, um valor até o preço do bilhete e no máximo 50% abaixo dele (`TOLERANCIA_DESCONTO_BP`, a mesma folga da plausibilidade do webhook) é o de um bilhete: 3 linhas de R$ 20,00 dão R$ 60,00; a promoção R$ 18 × 2 dá R$ 36,00. Outro valor é **ambíguo**: o valor do pedido não é comparado e ele não pode ser recuperado (aviso `valor_ambiguo`; conferir na Rifei).

### Trava do código que não bate

Se a coluna escolhida como código do pedido não é o código da Rifei (por exemplo, o número do bilhete), todas as vendas pareceriam perdidas e o "Recuperar" gravaria lixo. Com pelo menos 5 pedidos pagos no arquivo e menos da metade deles no sistema, a análise responde `codigo.confere: false`, mostra o aviso "a coluna escolhida como código do pedido não parece ser o código da Rifei", não marca nada para recuperar e o "Recuperar" responde 400 até a coluna ser trocada. Conta como pago o código com alguma linha paga, mesmo com as linhas inconsistentes (com a coluna errada, o mesmo "código" junta linhas de pedidos diferentes). Exceção: se o sistema tem pelo menos 5 pagos no período do arquivo e a maioria deles aparece no arquivo, a coluna é a certa (foi o webhook que parou) e a recuperação segue. Por isso o aviso também diz: se a coluna está certa e o webhook parou, exporte um período que inclua dias com vendas já no sistema.

### Recuperar

- A venda perdida entra como pedido novo; um pedido que já existe nunca é sobrescrito. A exceção é o pagamento não registrado (abaixo).
- O "Recuperar" recebe o mesmo corpo da análise (não relê o arquivo) e aplica as mesmas regras com o banco de agora.
- Atômico (um `db.batch`) e idempotente (`ON CONFLICT DO NOTHING`): repetir não grava de novo nem cria outra auditoria.
- **Pagamento não registrado (RIFA-056; decisions.md, adendo da D19), só o admin.** O pedido do webhook pendente ou expirado (da campanha ativa e sem desconsideração) que o arquivo diz que está pago vira `approved`, com a data do pagamento do arquivo (a mesma regra do `aprovado_em` abaixo), e passa a contar como se o "Pedido pago" tivesse chegado. Quantidade, valor, afiliado, `origem` (continua `webhook`) e o resto do pedido não mudam, e nada é apagado.
  - Só se o arquivo confirmar o pedido gravado. Impedem as mesmas observações da venda perdida (sem quantidade, sem valor, valor ambíguo, data no futuro, código que não confere) e três do pagamento: `quantidade_diferente`, `valor_diferente` e `afiliado_diferente` (o afiliado sem a coluna ou não reconhecido não compara; vazio no arquivo, com um afiliado gravado, é diferente). A tela diz qual e não deixa marcar: confira na Rifei.
  - O desconsiderado (D20) nunca volta sozinho: fica no grupo à parte e o "Recuperar" responde `ja_existe`. Para a coordenação, o pendente também fica `ja_existe` (como antes).
  - A gravação confere de novo, no mesmo lote, que o pedido ainda é o da prévia (pendente ou expirado, sem desconsideração, a mesma quantidade, o mesmo valor e o mesmo afiliado). Repetir não muda nada. Se o `paid_order` chega antes, o "Recuperar" não muda o pedido (`ja_existe`); se chega depois, dá `duplicado`. Nos dois casos o pedido conta uma vez.
  - `pedidos.pagamento_recuperacao_id` → `recuperacoes` (migração 0011): a mesma auditoria da venda perdida, e o histórico lista esses pedidos em `pagamentos_registrados`. A trilha diz quantos pedidos pendentes ou expirados (e bilhetes) foram marcados como pagos.
- A mesma plausibilidade do webhook (RIFA-042, D11): o recuperado com mais de 200 bilhetes, ou com o valor fora de bilhetes × preço do bilhete (acima, ou mais de 50% abaixo), continua contando e entra nos pedidos suspeitos, na mesma gravação.
- `pedidos.origem = 'conferencia'` e `pedidos.recuperacao_id` → `recuperacoes` (quem, quando, quantos, o SHA-256 e as colunas usadas). A mesma gravação deixa uma linha na trilha de auditoria da coordenação (`conferencia.recuperar`, alvo `campanha:<id>`, com o id da recuperação e as contagens). Um `paid_order` que chegue depois para o mesmo pedido dá `duplicado`.
- Instante gravado em `aprovado_em`: o do arquivo; com só o dia, o meio-dia (ou agora, se for hoje); sem data, o instante da recuperação.

### O que ainda é suposição

As colunas reais do export (seção 9, item 9). A detecção é por palavras do nome e a tela deixa a coordenação confirmar. Com um export real, conferir os nomes das colunas, o formato do valor e da data, o que "Um bilhete por linha" faz com o valor (a convenção acima cobre os dois jeitos quando há pedidos do arquivo no sistema) e se o afiliado vem como número ou como usuário. "E-mail do afiliado" é dado pessoal e não pode ser mapeado: o afiliado precisa vir como número ou usuário.

### Como testar

- Automático: `src/shared/conferencia/*.test.ts` (detecção das colunas, valores, datas, limites, CSV malicioso e o corpo sem dado pessoal), `src/shared/contracts/conferencia.test.ts` (o validador do corpo), `src/worker/lib/conferencia-analise.test.ts` (um bilhete por linha, regra do valor, trava do código, modo agregado e plano do "Recuperar"), `src/worker/routes/reconciliacao.test.ts` (as rotas com corpos montados de CSVs fictícios em várias formas, a varredura de privacidade e o painel depois de recuperar), `src/worker/routes/reconciliacao-pagamento.test.ts` (o pagamento não registrado marcado como pago: pendente e expirado, o que impede, o desconsiderado, a idempotência, a corrida com o webhook, as contas e o ranking, a trilha, o histórico e só o admin), `src/worker/routes/reconciliacao-desempenho.test.ts` (CPU com 1, 3 e 7 mil pedidos) e `src/web/pages/conferencia/` (a tela, inclusive que o corpo enviado não tem dado pessoal; o "Registrar pagamento" em `PagamentoNaoRegistrado.test.tsx`).
- À mão: `npm run build && npm run preview`, uma campanha ativa, um acesso local (`npm run acesso:criar -- --nome "..." --papel coordenacao`, ou `--papel admin` para o "Registrar pagamento") e um CSV fictício em `/coordenacao/conferencia`.

## 11. Como testar localmente

Simula a Rifei contra o `npm run dev`, com as fixtures de `test/fixtures/rifei/`. Não precisa de conta Cloudflare.

1. **Segredo local**: `cp .dev.vars.example .dev.vars` e troque o valor de `RIFEI_WEBHOOK_TOKEN` (ex.: `openssl rand -hex 32`). O `.dev.vars` está no `.gitignore` e é lido como o dotenv lê: aspas e comentário no fim valem (`RIFEI_WEBHOOK_TOKEN="abc" # local` dá `abc`). Depois de mudar o `.dev.vars`, reinicie o `npm run dev`.
2. **Suba o sistema**: `npm run dev` (aplica as migrações no D1 local e serve em http://localhost:5173).
3. **Campanha ativa** com o slug das fixtures (`videira-kids-teste`). Enquanto o `PUT /api/admin/campanha` não existe, grave direto no D1 local, em outro terminal:
   ```sh
   npx wrangler d1 execute DB --local --command "INSERT INTO campanhas (nome, slug_rifei, data_inicio, preco_bilhete_centavos, meta_unidade, meta_regra, meta_valor, ranking_criterio) VALUES ('Rifa Videira Kids (teste local)', 'videira-kids-teste', '2026-11-23', 2000, 'bilhetes', 'por_pessoa', 10, 'percentual_meta')"
   ```
   Sem campanha ativa, todo evento volta `ignorado_outra_campanha` (D5).
4. **Envie as fixtures**:
   ```sh
   npm run webhook:simular -- test/fixtures/rifei/new_order.afiliado.json
   # ou, sem o atalho do npm:
   node scripts/simular-webhook.mjs test/fixtures/rifei/new_order.afiliado.json [url]
   ```
   O `scripts/simular-webhook.mjs` lê o `RIFEI_WEBHOOK_TOKEN` do `.dev.vars` (com `scripts/dev-vars.mjs`), manda o arquivo como está (até um JSON inválido) para a URL (padrão `http://localhost:5173/api/webhooks/rifei`; com barra no fim também vale) com `Authorization: Bearer <token>` e imprime o status e o corpo da resposta. O token nunca é impresso. Sai com código 1 se a resposta não for 2xx e 2 se faltar o arquivo ou o token.
5. **Confira o que foi gravado**:
   ```sh
   npx wrangler d1 execute DB --local --command "SELECT id, evento, pedido_id, resultado, status_anterior, status_resultante, json_array_length(avisos) AS avisos FROM webhook_eventos ORDER BY id"
   npx wrangler d1 execute DB --local --command "SELECT id, status, affiliate_id, total_centavos, ddd, pais, aprovado_em, expirado_em FROM pedidos"
   npx wrangler d1 execute DB --local --command "SELECT affiliate_id, celula_id, origem FROM afiliados"
   ```

Roteiro, na ordem, com a campanha do passo 3 (conferido em 06/11/2026):

| Fixture | Resposta | No banco |
|---|---|---|
| `new_order.afiliado.json` | 200 `processado` | pedido `PEDTESTE0001` `in_process`; afiliado 1042 na fila de órfãos |
| `new_order.afiliado.json` (de novo) | 200 `duplicado` | nada muda; a entrega fica registrada |
| `paid_order.afiliado.json` | 200 `processado` | `approved`, `aprovado_em` em UTC |
| `expired_order.json` | 200 `processado` | `PEDTESTE0002` `expired`; DDD nulo e país `351`; cupom de 400 centavos |
| `paid_order.apos_expirado.json` | 200 `processado` | `expired` → `approved` |
| `expired_order.json` (de novo) | 200 `ignorado_transicao` | continua `approved` |
| `new_order.minimo.json` | 200 `processado` | pedido sem afiliado |
| `paid_order.outra_campanha.json` | 200 `ignorado_outra_campanha` | só o evento, com o payload redigido |
| `paid_order.tipos_estranhos.json` | 200 `processado` | `PEDTESTE0004` `approved` com os essenciais convertidos e os informativos NULL; o evento guarda 27 avisos (RIFA-002b) |
| `malformado.json` | 400 `payload_invalido` | evento `erro_validacao` com os problemas só nos 5 essenciais, sem dado pessoal |

Outros casos:

- Token errado: `curl -i -X POST http://localhost:5173/api/webhooks/rifei -H "Authorization: Bearer errado" -d '{}'` responde 401 `nao_autenticado` e não grava nada.
- Sem segredo (`RIFEI_WEBHOOK_TOKEN=` vazio no `.dev.vars` e o `npm run dev` reiniciado) e sem token gerado pela tela: 503 `nao_configurado`.
- Token gerado pela tela no D1 local (RIFA-039, D21): ele passa a valer e o do `.dev.vars` (o do simulador) leva 401. Para voltar ao do `.dev.vars`: `npx wrangler d1 execute DB --local --command "DELETE FROM token_webhook"`.
- Corpo que não é JSON (ex.: um arquivo truncado): 400 `json_invalido`, registrado como `erro_validacao` sem nenhum trecho do corpo.
- Corpo acima de 1 MiB (ex.: `head -c 1100000 /dev/zero | tr '\0' x > /tmp/grande.json` e o simulador com esse arquivo): 413 `corpo_muito_grande`, registrado como `erro_validacao` sem payload. Sem o token certo, o mesmo corpo dá 401 e nada é gravado.
- Para recomeçar do zero: `npx wrangler d1 execute DB --local --command "DELETE FROM webhook_eventos; DELETE FROM pedidos; DELETE FROM afiliados"`.

## 12. Rifei e Efí: passo a passo para o PO

Roteiro para o PO configurar a Rifei e a Efí de uma vez, quase tudo pelo celular. A exceção é ligar a Efí (12.2, passos B, C e E): faça num computador, no navegador, com a Efí e o painel da Rifei ([app.rifei.com.br](https://app.rifei.com.br)) abertos em abas. Assim o certificado baixado em B vai direto para a Rifei em E, sem passar por WhatsApp ou e-mail.

- Tudo foi conferido nas fontes oficiais em **11/11/2026**, e cada passo traz o link. Os nomes entre aspas são os da fonte.
- **NÃO DOCUMENTADO** quer dizer que a fonte oficial não diz. Descubra na tela, ao configurar, ou na compra de teste (seção 9). O lançamento não espera o suporte da Rifei: as perguntas da 12.7 são opcionais.
- Nenhuma credencial (Client Secret, certificado, token do webhook, senha) vai para este repositório, o DevMission, o WhatsApp ou o e-mail.

Ordem sugerida: abrir a conta Efí (12.2 A, porque a análise pode demorar) → campanha (12.1) e, no mesmo painel, ligar os afiliados e gerar o convite da conta afiliada de teste (12.3) → webhook (12.4, com o token gerado pela tela) → ligar a Efí (12.2 B a E) ou, se a análise não terminou, o Pix manual (12.2, alternativa) → compra de teste (lançamento, seção 4) → convites dos líderes. O plano do dia, com quem faz cada passo e quanto tempo leva, está no topo do [lancamento.md](lancamento.md#plano-de-1-dia).

### 12.1 Criar a campanha na Rifei e achar o slug

1. Em [rifei.com.br](https://rifei.com.br), toque em "Criar minha campanha" (abre `app.rifei.com.br/sign-up`). Há também o app Rifei para Android e iOS. ([página inicial](https://rifei.com.br))
2. Preencha os dados da campanha: "título, bilhetes, valor etc." ([página inicial](https://rifei.com.br)). As telas do formulário: NÃO DOCUMENTADO.
   - Só maiores de 18 anos criam campanha (item 5.2 dos [Termos de uso](https://rifei.com.br/ajuda/outros/termos-de-uso)).
   - O telefone de contato informado na criação é o canal de suporte aos compradores (item 5.12 dos Termos).
3. **Publique.** "Pague a taxa de liberação para poder vender a sua campanha" ([página inicial](https://rifei.com.br)). A taxa é por campanha ([Preços](https://rifei.com.br/precos)):
   - Econômico, R$ 97,00: até R$ 5,00 por bilhete e até 1.000 bilhetes;
   - Padrão, R$ 199,90: valor por bilhete sem limite e até 100.000 bilhetes;
   - Premium, R$ 697,00: até 1.000.000 de bilhetes;
   - Pro, R$ 1.997,00: até 10.000.000 de bilhetes.

   Todos os planos têm afiliados ilimitados e integrações. No app de iOS os valores podem variar. O plano depende do preço e da quantidade de bilhetes, que o PO decide.
4. **Slug.** É o fim do link público da campanha, depois da última barra: `rifei.com.br/<slug>`.
   - Exemplo oficial: a campanha de demonstração da Rifei está em [rifei.com.br/demonstracao](https://rifei.com.br/demonstracao), e o exemplo oficial do webhook traz `"slug": "demonstracao"` ([Referência do webhook](https://rifei.com.br/ajuda/webhook/referencia-do-webhook)). A segunda demonstração está em `rifei.com.br/demonstracao-2`.
   - Copie o slug do link, sem barra, e cole em **Slug da campanha na Rifei** no sistema (lançamento, seção 3.3).
   - A Rifei não diz com essas palavras que o slug é o fim do link. A compra de teste confirma: o slug chega no webhook, e com slug errado o evento fica `ignorado_outra_campanha`.
5. Depois de criada, a campanha deixa editar o título, o valor do bilhete, as promoções, os cupons e a data de encerramento, antes do fim (item 5.4 dos [Termos de uso](https://rifei.com.br/ajuda/outros/termos-de-uso)). Se o slug muda quando o título muda: NÃO DOCUMENTADO (seção 9, item 10). Depois de configurar o sistema, não troque o título sem conferir o link.

### 12.2 Ligar a Efí à Rifei (recebimento do Pix)

**Alternativa: Pix manual.** A Rifei também aceita o Pix manual: o comprador paga direto na chave Pix cadastrada nas formas de pagamento, manda o comprovante no WhatsApp e o organizador confere no extrato e marca o pedido como pago no painel ([Como saber se um PIX manual foi pago](https://rifei.com.br/ajuda/pagamentos/como-saber-se-um-pix-manual-foi-pago), conferido em 13/11/2026). A célula continua vindo do afiliado do pedido, nas duas formas. Diferenças: com a Efí o pedido vira pago sozinho e a venda aparece no sistema em segundos; no Pix manual cada venda espera alguém conferir o extrato e marcar no painel (o artigo avisa que comprovante pode ser adulterado), e se a marcação manual dispara o webhook se confirma na compra de teste (seção 9, item 5). Se não disparar, o pedido fica pendente no sistema até a conferência pelo CSV: ela o mostra em "Pagamento não registrado", e o admin o marca como pago (seção 10, Recuperar). Para centenas de vendas, a Efí seria o caminho mais leve. Decisão do PO (16/11/2026): sem a Efí, o Pix manual é o caminho do lançamento ([lancamento.md, 1.6](lancamento.md#16-pix-manual-o-caminho-do-lançamento)), e o sistema faz o cruzamento do extrato do banco com os pedidos na **Conferência → Extrato do banco (Pix manual)** (RIFA-059; decisions.md, D26): o extrato (OFX, CSV ou o texto copiado da tela do banco) é lido no navegador, e a tela lista os pedidos para marcar como pagos na Rifei. A marcação continua manual.

O artigo oficial da Rifei é [Como adicionar o Efí](https://rifei.com.br/ajuda/pagamentos/como-adicionar-o-efi-bank). Ele pede uma conta Efí Pro ou Empresas, uma aplicação com permissões do Pix, um certificado e uma chave Pix. Abaixo, na ordem: A (conta), B (certificado), C (aplicação), D (chave Pix) e E (colar na Rifei). A Efí diz que a API Pix precisa de um certificado ativo, por isso aqui o certificado vem antes da aplicação ([Como criar uma nova aplicação](https://sejaefi.com.br/central-de-ajuda/api/como-criar-uma-nova-aplicacao-para-usar-a-api-pix)).

**Que conta Efí serve.** A Rifei pede **Efí Pro ou Efí Empresas** ([Como adicionar o Efí](https://rifei.com.br/ajuda/pagamentos/como-adicionar-o-efi-bank)). A conta pessoal "Efí Para você" não basta.

- **Efí Pro:** conta de pessoa física (CPF), para quem vende sem CNPJ ([Efí Pro é PF ou PJ?](https://sejaefi.com.br/central-de-ajuda/efi-bank/efi-pro-e-uma-conta-digital-pf-ou-pj)).
- **Efí Empresas:** conta de pessoa jurídica (CNPJ) ([Como abrir uma conta para empresas?](https://sejaefi.com.br/central-de-ajuda/efi-bank/como-abrir-uma-conta-para-empresas)).
  - O CNPJ precisa estar ativo e regular, e a conta é aberta em nome do sócio administrador, presidente ou síndico ligado ao CNPJ.
  - Para uma organização religiosa, a Efí pede o estatuto social, a ata de constituição e a ata de eleição ou de nomeação da diretoria atual ([Documentos para o cadastro](https://sejaefi.com.br/central-de-ajuda/dados-cadastrais/documentos-para-realizar-cadastro-na-efi-)).
  - O "Comprovante de Inscrição e de Situação Cadastral" da Receita não é aceito.
- **Titular:** os Termos de uso da Rifei (item 6.1) dizem que a integração serve para o usuário receber "em contas de sua titularidade" ([Termos de uso](https://rifei.com.br/ajuda/outros/termos-de-uso)). O caminho seguro é o titular da conta Efí ser o mesmo da conta Rifei. Quem será o titular é decisão do PO (lançamento, seção 1.5).

**A. Abrir a conta (app Efí, no celular).** Fontes: [conta para empresas](https://sejaefi.com.br/central-de-ajuda/efi-bank/como-abrir-uma-conta-para-empresas) e [conta para empreendedores sem CNPJ](https://sejaefi.com.br/central-de-ajuda/efi-bank/como-abrir-uma-conta-para-empreendedores-sem-cnpj).

1. Baixe o app Efí (Android ou iOS) e toque em "Abra a sua conta".
2. Escolha "Para gerir meu negócio", informe o CNPJ (Efí Empresas) ou o CPF (Efí Pro) e toque em "Continuar".
3. Preencha os dados e aceite os termos. Informe o e-mail e o celular, para receber um código de validação. Depois, a renda (na conta de empresa, também o patrimônio e o faturamento), a nacionalidade, o tipo de negócio e o endereço.
4. Tire a selfie e a foto do documento de identidade, frente e verso, legível. Valem, entre outros: RG emitido há até 20 anos, CNH emitida há menos de 10 anos e passaporte brasileiro ([Documentos para o cadastro](https://sejaefi.com.br/central-de-ajuda/dados-cadastrais/documentos-para-realizar-cadastro-na-efi-)).
   - Documento apoiado numa superfície reta, sem cortar nada. Selfie num lugar claro, sem óculos escuros nem boné ([Como enviar documentos e selfie](https://sejaefi.com.br/central-de-ajuda/efi-bank/como-enviar-seus-documentos-e-fazer-a-selfie-na-abertura-de-conta)).
5. Defina a senha. Na conta de empresa, se a Efí pedir, envie os documentos da empresa, em PDF ou foto.
6. **Prazo:** a Efí não publica quanto tempo leva a análise da conta. Ela avisa por e-mail quando termina ([Como abrir conta no Efí Bank?](https://sejaefi.com.br/central-de-ajuda/efi-bank/como-abrir-conta-na-efi-bank)). Se precisar falar com a Efí por ticket, o setor de Análise responde em até 5 dias úteis ([Prazo de resposta dos tickets](https://sejaefi.com.br/central-de-ajuda/outros/prazo-de-resposta-dos-tickets)). **Faça este passo primeiro.**

Já tem "Efí Para você" (CPF)?

- Para Efí Pro: no menu, "Efí para negócios" → "Continuar com o upgrade da conta". É grátis e não passa por análise ([Quando é possível o upgrade](https://sejaefi.com.br/central-de-ajuda/efi-bank/em-qual-situacao-e-possivel-fazer-o-upgrade-da-sua-conta-efi)).
- Para Efí Empresas não há upgrade: é uma conta nova. Toque no seu nome → "Gerenciar todas as contas" → "Abrir uma nova conta" → "Para gerir meu negócio" → CNPJ ([Sou Efí Para você. Como mudar para Efí Empresas?](https://sejaefi.com.br/central-de-ajuda/efi-bank/sou-efi-para-voce-como-mudar-para-efi-empresas)).

**B. Gerar o certificado (plataforma web da Efí, no navegador).** Entre pelo botão "Acessar minha conta" em [sejaefi.com.br](https://sejaefi.com.br). Fontes: [Como gerar o certificado para usar a API Pix?](https://sejaefi.com.br/central-de-ajuda/api/como-gerar-o-certificado-para-usar-a-api-pix) e [Credenciais, certificado e autorização](https://dev.efipay.com.br/docs/api-pix/credenciais).

1. Clique em "API" e, no menu lateral, em "Meus certificados". Escolha **Produção**.
2. Clique em "Criar novo certificado", dê um nome, clique em "Criar certificado" e valide a operação.
3. Clique em **"Baixar certificado"** na hora: é a **única chance** de baixar. A tela avisa: "Não é possível realizar este download em outro momento" (imagem do artigo da Rifei). Se perder o arquivo (`.p12`), crie outro: a Efí permite até 5 certificados por ambiente; apague os inativos se precisar.
   - A mesma tela pede para "monitorar a data de expiração". A validade do certificado: NÃO DOCUMENTADO nas fontes lidas. Confira na Efí que ela passa do fim da campanha.

**C. Criar a aplicação e copiar as chaves (plataforma web).** Fontes: [Como adicionar o Efí](https://rifei.com.br/ajuda/pagamentos/como-adicionar-o-efi-bank), [Como criar uma nova aplicação](https://sejaefi.com.br/central-de-ajuda/api/como-criar-uma-nova-aplicacao-para-usar-a-api-pix) e [Como obter as chaves Client Id e Client Secret](https://sejaefi.com.br/central-de-ajuda/api/como-obter-chaves-client-id-e-client-secret-na-api).

1. Clique em "API" → "Aplicações" → "Criar aplicação". O nome é livre, só para identificar.
2. Nas permissões, abra "API Pix" e marque estes 13 itens (a imagem do artigo da Rifei mostra todos marcados em Produção e em Homologação):
   - Alterar cobranças e Consultar cobranças;
   - Alterar Pix, Consultar Pix e Enviar Pix;
   - Alterar Webhooks e Consultar Webhooks;
   - Alterar Payloads e Consultar Payloads;
   - Alterar Configurações da API e Consultar Configurações da API;
   - Alterar cobranças com vencimento e Consultar cobranças com vencimento.

   Na mesma imagem ficam desmarcados os de chaves aleatórias, saldo e relatórios.
3. Clique em "Criar aplicação" e valide a operação.
4. Abra a aplicação e, na aba **Produção**, copie a "Chave Client ID" e a "Chave Client Secret", uma de cada vez, e **cole direto na Rifei** (passo E). Não salve em arquivo, nota ou print, e não mande por mensagem.

**D. Criar a chave Pix.** Fonte: [Como cadastrar minhas chaves do Pix?](https://sejaefi.com.br/central-de-ajuda/pix/como-cadastrar-chaves-pix)

1. No app ou na web: "Menu" → "Pix" → "Minhas chaves" → "Cadastrar chave".
2. A Rifei sugere a chave **aleatória**, "para ser mais simples". Copie a chave gerada.
3. A conta de negócios nova pode já ter uma chave aleatória criada pela Efí para o Bolix. A Efí recomenda não apagar essa chave ([Por que tem uma chave aleatória cadastrada](https://sejaefi.com.br/central-de-ajuda/pix/por-que-tem-uma-chave-aleatoria-cadastrada-na-conta)).

**E. Colar na Rifei.** Fonte: [Como adicionar o Efí](https://rifei.com.br/ajuda/pagamentos/como-adicionar-o-efi-bank).

1. No painel da Rifei, adicione a Efí como forma de pagamento. Onde fica: NÃO DOCUMENTADO. A Rifei só diz que as formas de pagamento são adicionadas no painel administrativo ([dúvidas frequentes](https://rifei.com.br/#faq)). As imagens do artigo mostram a janela "Adicionar Efí".
2. Preencha, com as chaves de **Produção** copiadas em C:
   - "Chave Client ID": a Client ID;
   - "Chave Secret": a Client Secret;
   - "Certificado": o arquivo baixado em B ("Arraste a chave aqui ou clique para procurar", `.p12` de até 8 KB);
   - a chave Pix de D. O nome deste campo: NÃO DOCUMENTADO.

   Toque em "Adicionar".
3. O artigo termina com "a sua campanha já estará configurada para receber pagamentos no seu Efí". A prova é a compra de teste (lançamento, seção 4).

**Custos e cuidados**

- **Tarifa:** a página de tarifas da Efí mostra **1,19% por Pix recebido pela API** (QR Code dinâmico). Os 30 Pix grátis por mês do app não valem para chave usada pela API ([Tarifas](https://sejaefi.com.br/tarifas)). A tarifa pode variar por data de contratação ou negociação. A da sua conta fica em "Configurações da conta" (⚙) → "Tarifas e prazos" ([Prazos da conta](https://sejaefi.com.br/central-de-ajuda/tarifas-e-prazos/quais-os-prazos-da-minha-conta-gerencianet)).
- O Pix cai na conta Efí em até 10 segundos, também no fim de semana ([Prazos da conta](https://sejaefi.com.br/central-de-ajuda/tarifas-e-prazos/quais-os-prazos-da-minha-conta-gerencianet)).
- **Credenciais:** a Client Secret e o certificado dão acesso à conta pela API. A Efí pede que as chaves não sejam compartilhadas, e os Termos da Rifei (item 6.3) deixam a guarda com o usuário.
  - Não mande por WhatsApp nem por e-mail, e não guarde no projeto.
  - Depois de enviar à Rifei, apague o certificado baixado ou guarde só num lugar seu (ex.: gerenciador de senhas).
- **"Enviar Pix":** a Rifei pede essa permissão, que a tela da Efí (na imagem do artigo da Rifei) descreve como "Permite envio de Pix". A fonte não diz para que a Rifei a usa. Uma conta Efí só para a rifa limita o risco. A pergunta fica na 12.7 (opcional).

### 12.3 Afiliados: programa da campanha e líderes

O que as fontes oficiais dizem:

- A Rifei tem afiliados: "Adicione afiliados para ajudar a vender a sua campanha" ([página inicial](https://rifei.com.br)) e "Adicione pessoas para compartilhar a sua campanha" ([app na App Store](https://apps.apple.com/br/app/rifei/id6705135780)). Os afiliados são ilimitados em todos os planos ([Preços](https://rifei.com.br/precos)).
- A Central de Ajuda **não tem artigo sobre afiliados**. A lista inteira de artigos foi conferida em 11/11/2026 ([rifei.com.br/ajuda](https://rifei.com.br/ajuda)).
- O perfil público do organizador tem uma **Área de afiliados**. Na conta de demonstração da própria Rifei: [rifei.com.br/u/rifei](https://rifei.com.br/u/rifei) → menu → "Área de afiliados" ([rifei.com.br/u/rifei/afiliados/login](https://rifei.com.br/u/rifei/afiliados/login)).
  - A tela "Entrar" pede o **e-mail** e tem o link "Registre-se".
  - O menu da página da campanha também tem "Área de afiliados" ([campanha de demonstração](https://rifei.com.br/demonstracao)).
- Na conta de demonstração, o cadastro de afiliado é **só por convite**. A página "Registre-se" diz: "Cadastro disponível somente por convite. Para se tornar um afiliado, é necessário receber um link de convite. Entre em contato com o organizador para solicitar acesso." ([rifei.com.br/u/rifei/afiliados/registrar](https://rifei.com.br/u/rifei/afiliados/registrar))
- **Não confunda com o "Indique e Ganhe".** É o programa de indicação da própria Rifei: quem indica compras na Rifei recebe comissão da Rifei ([Termos do Indique e Ganhe](https://rifei.com.br/ajuda/outros/termos-e-condicoes-do-programa-indique-e-ganhe)). Ele também fala em "afiliado" e "link de afiliado", mas não é o afiliado da campanha.

Passo a passo possível hoje:

1. **[PO, no painel da Rifei]** Ligue os afiliados na campanha e gere o **link de convite** de cada líder. Onde: NÃO DOCUMENTADO. Descubra no painel ao criar a campanha (procure "Afiliados") e gere primeiro o convite da conta afiliada de teste (lançamento, 4.1).
2. **[Líder]** Abre o convite, cria a conta de afiliado e entra pela "Área de afiliados" (menu da página da campanha) com o e-mail.
3. **[Líder]** Pega o **link de afiliado** dele para divulgar. Onde fica e qual o formato: NÃO DOCUMENTADO; a compra de teste mostra (seção 9, item 1).
4. **[Líder]** Compartilha o link (WhatsApp, redes sociais). A venda feita por esse link chega ao sistema com o `affiliate_id` dele.
5. **[Coordenação]** Vincula o código à célula na tela de Adesão (lançamento, seção 5).

Ainda NÃO DOCUMENTADO, para descobrir no painel ou na compra de teste (seção 9: o parágrafo do painel e os itens 1 e 2):

- se os afiliados precisam ser ligados em cada campanha;
- onde o organizador gera o convite, e se o cadastro "só por convite" é uma escolha dele;
- o formato do link de afiliado e se o id aparece nele;
- onde o organizador vê o identificador de cada afiliado e se é o mesmo `affiliate_id` do webhook.

**Onde o formato confirmado entra (RIFA-046, [decisions.md D24](decisions.md#d24-link-de-vendas-e-qr-code-de-cada-célula-rifa-046-contrato-2026-11-12)).** O sistema monta o link de vendas de cada célula (e o QR code dele, na `/minha` do líder e na Adesão) a partir de um **modelo** que só o admin grava, com `{slug}` (o slug da campanha) e `{afiliado}` (o `affiliate_id`). Ele fica vazio até o formato ser confirmado. Com a compra de teste (lançamento, 4.1, passos 1 a 3):

- se o link de afiliado leva o mesmo número do `affiliate_id` do webhook, o admin escreve o modelo trocando o slug por `{slug}` e o número por `{afiliado}` (ex.: `https://rifei.com.br/videira-kids?ref=1042` vira `https://rifei.com.br/{slug}?ref={afiliado}`) e confere com a compra de teste pelo QR de uma célula: a venda tem de cair nela;
- se o link fica noutro endereço que não `https://rifei.com.br/` (ex.: `app.rifei.com.br`), ou não leva o `affiliate_id` (ex.: um código próprio de cada afiliado), passe ao SM: o endereço entra em `HOSTS_LINK_VENDAS` (`src/shared/contracts/link-vendas.ts`), ou o desenho muda para a opção (b) da D24 (o link de cada afiliado colado na Adesão).

### 12.4 Webhook: caminho conferido

O caminho do roteiro confere com [Como adicionar um webhook](https://rifei.com.br/ajuda/webhook/como-adicionar-webhook):

1. Ícone do usuário, no canto superior direito → "Integrações".
2. Role até a seção "Outro" e toque em "Adicionar" no webhook.
3. Preencha "URL", "Token" e "Eventos": "Novo pedido", "Pedido pago" e "Pedido expirado".
   - A Rifei chama o token de opcional (ele vai como `Authorization: Bearer`), mas **para o sistema ele é obrigatório**: sem ele, toda entrega recebe 401 e se perde (seção 2).
4. Toque em "Adicionar".

Os valores do sistema estão na seção 1 e no lançamento, seção 3.2. Duas observações:

- O artigo [Integrar o Rifei com n8n](https://rifei.com.br/ajuda/webhook/como-integrar-com-n8n) descreve o mesmo caminho como "Integrações → Webhook" e chama os eventos de "novo pedido, pedido aprovado e pedido expirado". É o mesmo formulário com outra redação: marque os três.
- Ao tocar em "Adicionar", a Rifei manda um teste (`{"event":"test"}`, com o Bearer) e só aceita a URL se a resposta for 2xx; o sistema responde 200 `{"resultado":"teste"}` sem gravar nada (RIFA-060, seção 9, item 12). Se aparecer "A URL informada não retornou uma resposta válida!", confira a URL e o token (com o token errado o sistema responde 401).
- O formulário (visto em 17/11/2026) chama os eventos de "Novo pedido", "Pedido aprovado", "Pedido expirado" e "Prêmio instantâneo". Marque os três primeiros e deixe **"Prêmio instantâneo" desmarcado** (não use "Selecionar todos"): o sistema não usa esse evento e o registraria como erro em Entregas do webhook. O artigo oficial mudou de endereço: [Como adicionar um webhook](https://rifei.com.br/ajuda/integracoes/como-adicionar-webhook) (atualizado em novembro de 2026).

### 12.5 Exportar pedidos: caminho conferido

O caminho do roteiro confere com [Como exportar lista de participantes](https://rifei.com.br/ajuda/campanha/exportar-lista-de-participantes): página de pedidos da campanha no painel → três pontinhos no canto superior direito → "Exportar Pedidos". As imagens do artigo mostram:

- no menu dos três pontinhos: "Exportar pedidos", "Exportar participantes", "Buscar por ID", "Histórico de pedidos", "Pesquisar bilhete próximo" e "Alterar visualização";
- na janela "Exportar pedidos": "O que deseja exportar?" (Bilhetes, Quantidade de bilhetes, Nome, Email, Telefone e outras mais abaixo, com "Selecionar tudo"), "Formato do arquivo" ("Valores separados por vírgula (.csv)"), a opção "Um bilhete por linha" e o botão "Exportar".

As demais colunas ainda faltam (seção 9, item 9).

### 12.6 Estorno de um pedido

**Na Rifei.** A Central de Ajuda não tem artigo sobre estorno, reembolso ou cancelamento de pedido. Os [Termos de uso](https://rifei.com.br/ajuda/outros/termos-de-uso) dizem:

- a Rifei não tem obrigação de fazer reembolso, e "os Organizadores são os únicos responsáveis pela entrega dos itens e pela oferta de reembolsos" (itens 7.4 e 7.5);
- **pedido "pago" reservado há 7 dias ou mais fica bloqueado e não pode ser removido** (item 5.7);
- depois do sorteio, ou com todos os bilhetes vendidos, não dá mais para editar nem remover pedidos (item 5.9).

Como remover ou alterar um pedido no painel: NÃO DOCUMENTADO.

**Na Efí (devolver o dinheiro).** Fonte: [Como fazer a devolução de um Pix recebido?](https://sejaefi.com.br/central-de-ajuda/pix/devolver-pix-recebido)

- No app: "Menu" → "Extrato" → toque na transação → "Devolver valor" → informe o valor → "Continuar" → "Autorizar devolução" → confirme com a Assinatura Eletrônica.
- Na web: "Menu" → "Extrato" → três pontinhos da transação → "Detalhar" → "Devolver valor recebido via Pix" → informe o valor → "Autorizar devolução" → confirme com o Autenticador Efí e a Assinatura Eletrônica.

**No sistema.** A Rifei só avisa pedido novo, pago e expirado ([Referência do webhook](https://rifei.com.br/ajuda/webhook/referencia-do-webhook)). Estorno ou remoção na Rifei não chega ao sistema: use a ação **Desconsiderar** do sistema, na tela Pedidos (RIFA-028; lançamento, 4.4).

Ordem: devolva na Efí → remova ou ajuste o pedido na Rifei, se der (**antes de 7 dias** da reserva) → desconsidere o pedido no sistema.

### 12.7 Perguntas para o suporte da Rifei (referência opcional)

**Não usada no lançamento** (decisão do PO, 15/11/2026): o que ela perguntava é confirmado no painel e na compra de teste (seção 9): as perguntas 1, 2, 3, 8 e 9 estão lá, com o passo concreto de cada uma. As perguntas ficam aqui para quando houver tempo ou uma dúvida que o painel e o teste não resolvam (as 4, 5, 6 e 7). O suporte da Rifei atende pelo WhatsApp, de segunda a sábado, das 9h às 21h (horário de Brasília) ([Preços](https://rifei.com.br/precos) e [rifei.com.br/ajuda](https://rifei.com.br/ajuda), onde o link fica no topo).

1. Onde, no painel, eu ligo os afiliados numa campanha e gero o link de convite de cada afiliado?
2. Onde o afiliado acha o link dele para divulgar? Qual o formato desse link?
3. Onde eu vejo o número de identificação de cada afiliado, o mesmo que vai no campo `affiliate_id` do webhook?
4. Onde eu adiciono a Efí: na conta ou em cada campanha? Para que a Rifei usa a permissão "Enviar Pix" da Efí?
5. Como cancelar ou estornar um pedido pago? Isso dispara algum evento do webhook?
6. Se eu mudar o título da campanha, o link (slug) muda?
7. Quanto tempo um pedido fica reservado até expirar? A Rifei reenvia o webhook se o nosso servidor responder com erro? Ela manda um teste quando o webhook é adicionado?
8. Se o comprador abre o link do afiliado e só paga depois (outro dia, outro aparelho, ou voltando pela página da campanha sem o link), a compra continua com o afiliado? Por quanto tempo a Rifei guarda essa indicação?
9. Quando eu marco um pedido como pago à mão (Pix manual), a Rifei manda o evento `paid_order` no webhook, com o afiliado do pedido?

Se perguntar, passe as respostas ao SM, para a seção 9 e o DevMission.

## 13. API interna do painel da Rifei (RIFA-070, D29)

A Rifei não tem API pública, mas o painel (`app.rifei.com.br`) é um site que chama `https://api.rifei.com.br/` com o
token do login. O sistema usa as mesmas chamadas, pelo admin, para marcar pagos os pedidos da Conferência do extrato,
sincronizar os afiliados e gerar os convites (D29; rotas em [api.md](api.md#api-interna-da-rifei-rifa-070-docsdecisionsmd-d29)).

### 13.1 O que foi mapeado (código do painel, 17/11/2026)

| Uso | Chamada do painel |
|---|---|
| Login (com captcha) | `POST auth/login { email, password, recaptcha_token \| turnstile_token }` → `token.token` |
| Campanha pelo slug | `GET raffles/<slug>` → `id`, `version`, `time_to_expire_orders` |
| Aprovar (só aprova) | `PUT raffles/orders/many { orders: [id] }` |
| Alternar aprovar/desaprovar (não usado) | `PUT raffles/<raffleId>/orders/<id>` sem corpo |
| Conferir um pedido | `GET raffles/<raffleId>/orders/<id>` |
| Restaurar expirado | `PUT [v2/]raffles/expired-orders/<id>/restore` |
| Afiliados da conta | `GET my-affiliates` → `affiliate_id`, `code`, `affiliate.{name,email}` |
| Convite de afiliado | `POST affiliates { commission_type, commission_value, products_type, products }` → `{ link }` |

Cabeçalhos: `Authorization: Bearer <token>`, `x-rate-limit: true`. O link de vendas do afiliado é
`https://rifei.com.br/<slug>?ref=<code>` (a página da campanha lê o `ref`). A campanha do Projeto Kids expira a reserva
em 24 h (`time_to_expire_orders: 1440`): o extrato do dia anterior pode achar pedidos já expirados, que a marcação
restaura. Para reduzir isso, o PO pode subir o prazo da reserva no painel da Rifei.

### 13.2 Configurar o token (admin, uma vez)

1. Num navegador, numa **janela anônima**, entre em `app.rifei.com.br` com a conta da campanha (o captcha é feito à
   mão).
2. Abra as ferramentas do navegador (F12) → Console e rode
   `copy(decodeURIComponent(document.cookie.match(/auth_token=([^;]+)/)[1]))`: o token vai para a área de
   transferência. Não cole em chat, e-mail ou WhatsApp.
3. No terminal do projeto: `npx wrangler secret put RIFEI_API_TOKEN` e cole o token.
4. **Feche a janela anônima sem clicar em "Sair"**: o "Sair" da Rifei (`auth/logout`) invalida o token. Se um dia a tela
   disser que a Rifei recusou o token, repita os passos.

### 13.3 Como usar

- **Conferência → Extrato do banco:** em "Para marcar como pago na Rifei", o admin clica em **Marcar N pedidos como
  pago na Rifei**, confere os números e confirma. A tela mostra quantos foram marcados e, dos outros, o motivo. Depois,
  **Buscar os pedidos de novo** confere se o webhook chegou. O **Copiar os números** continua ao lado (caminho manual).
- **Adesão → Afiliados na Rifei:** **Ler os afiliados da Rifei** mostra quem já é afiliado; **Sincronizar** grava os
  códigos e liga à célula quem tem o e-mail do líder; **Gerar os convites** cria um convite por célula sem afiliado, com
  Copiar e Enviar no WhatsApp. Depois que o líder cria a conta, Sincronizar de novo. Por fim, o modelo do link de vendas
  (D24) passa a ser `https://rifei.com.br/{slug}?ref={codigo}`.

### 13.4 O que confirmar na compra de teste (SUPOSIÇÕES)

1. O `id` do pedido no webhook é o mesmo que `raffles/orders/many` aceita (o painel usa o `id` da lista de pedidos).
2. Marcar pela API dispara o "Pedido pago" no webhook (o exemplo oficial traz `status_detail: changed_by_admin`).
3. O pedido expirado continua com o mesmo `id` em "Pedidos expirados" e a restauração o devolve aos reservados.
4. O `ref` do link de vendas é o `code` do afiliado (ex.: `?ref=thiago`) e a venda chega com o `affiliate_id` dele.
5. O convite gerado pela API aparece no painel e cria o afiliado com o e-mail que o líder digitar.

