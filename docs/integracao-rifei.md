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
| D2 | Dinheiro em centavos inteiros, por aritmética decimal exata (não por float): fração de centavo é arredondada meio para cima, com aviso (RIFA-002b) | `reaisParaCentavos`, `textoDecimalParaCentavos`; colunas `*_centavos` |
| D3 | O pedido é identificado pelo `id` da Rifei. Toda entrega é registrada com o payload redigido, e o processamento é idempotente. | `pedidos.id` (PK), `webhook_eventos`, resultado `duplicado` |
| D4 | Estados: `in_process` → `approved` \| `expired`; `expired` → `approved`; `approved` é terminal. Fora de ordem cria o pedido direto no estado certo. Só `approved` é venda. | `decidirTransicaoPedido`, `TRANSICOES_PERMITIDAS`; CHECK de `status` |
| D5 | `slug` diferente do configurado: evento registrado como ignorado, resposta 200 | `campanhas.slug_rifei`; resultado `ignorado_outra_campanha` |
| D6 | `Authorization: Bearer` comparado em tempo constante com `RIFEI_WEBHOOK_TOKEN`. Inválido ou ausente: 401. Segredo não configurado: 503. | `SEGREDO_WEBHOOK_RIFEI`; grupo `rifei_bearer`; códigos `nao_autenticado` e `nao_configurado` |
| D7 | `affiliate_id` → afiliado → célula. Afiliado desconhecido entra como não vinculado (fila de órfãos); venda sem afiliado fica em "sem afiliado". A célula é resolvida por JOIN na leitura. | tabela `afiliados` (`celula_id` NULL), view `vendas_aprovadas` |
| D8 | Fuso da campanha `America/Belem` para dia e semana | `campanhas.fuso_horario` (padrão), `FUSO_PADRAO`; instantes guardados em UTC |
| D9 | 200 depois de gravar; payload sem o essencial (`event`, `id`, `slug`, `numbers_count`, `total`): 400, registrado com erro; o resto é tolerado com avisos (RIFA-002b); falha de banco: 500 | `analisarPayloadRifei`; resultado `erro_validacao`; `webhook_eventos.avisos`; códigos `json_invalido`, `payload_invalido` e `erro_interno` |

## 1. Configurar o webhook na Rifei

O webhook é da **conta**, não da campanha. Por isso ele recebe pedidos de todas as campanhas da conta, e o sistema filtra pelo `slug` da campanha configurada (D5).

1. Gerar um token forte, só para isso. Exemplo: `openssl rand -base64 32`.
2. Guardar o token como segredo do Worker, sem versionar: `wrangler secret put RIFEI_WEBHOOK_TOKEN`. Para desenvolvimento local, ele vai no `.dev.vars`, que está no `.gitignore`.
3. Na Rifei: menu do usuário → **Integrações** → seção **Outro** → **Adicionar** (webhook).
   - **URL**: `https://<domínio do Worker>/api/webhooks/rifei`. Com barra no fim também funciona (`CAMINHOS_WEBHOOK_RIFEI`). A URL precisa aceitar POST com corpo JSON.
   - **Token**: o mesmo do passo 1. A Rifei manda `Authorization: Bearer <token>`.
   - **Eventos**: marcar os três, "Novo pedido", "Pedido pago" e "Pedido expirado".
4. No sistema, configurar a campanha (`PUT /api/admin/campanha`) com `slug_rifei` igual ao slug da campanha na Rifei, que é o identificador que aparece no link da campanha.
5. Conferir com um pedido de teste: a entrega aparece em `webhook_eventos` com `resultado = 'processado'`.

Para trocar o token, faça a mudança nos dois lados em sequência: primeiro o segredo do Worker, depois a Rifei. Entre um passo e outro, as entregas recebem 401 e não são gravadas; a conferência pelo CSV (seção 10) recupera o que se perder.

## 2. Autenticação (D6)

- O Worker compara o header `Authorization: Bearer <token>` com o segredo `RIFEI_WEBHOOK_TOKEN` usando **comparação em tempo constante**.
- Se o header estiver ausente ou errado, a resposta é **401** `nao_autenticado` e nada é gravado.
- Se o segredo não estiver configurado no Worker, a resposta é **503** `nao_configurado` e nada é gravado. É uma falha fechada: sem segredo, o Worker nunca aceita entregas.
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

1. Segredo `RIFEI_WEBHOOK_TOKEN` ausente: **503** `nao_configurado` e nada é gravado (D6).
2. `Authorization` ausente ou inválido: **401** `nao_autenticado` e nada é gravado (D6).
   - Depois da autenticação: corpo acima de 1 MiB (`LIMITE_CORPO_WEBHOOK_BYTES`) grava um evento `erro_validacao` sem payload, com o problema `corpo_muito_grande`, e responde **413** `corpo_muito_grande`. Um pedido real ocupa poucos KB.
3. Corpo que não é JSON: grava um evento `erro_validacao` e responde **400** `json_invalido` (D9). A mensagem do problema é fixa: a do `JSON.parse` traz um trecho do corpo e nunca é gravada, devolvida nem logada (D1).
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
11. Qualquer falha de banco nos passos 3 a 10: **500** `erro_interno` (D9). Se a Rifei não reenviar, a conferência pelo CSV (seção 10) recupera.

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
| Retry, reenvio, ordem de entrega e assinatura HMAC | NÃO DOCUMENTADO; o sistema assume duplicatas, ordem trocada e perda |
| `new_order` já com `status: approved` (venda lançada pelo admin) | NÃO DOCUMENTADO; hoje o estado vem só do `event` |
| Marcar pago à mão no painel dispara `paid_order` | SUPOSIÇÃO (o exemplo oficial tem `status_detail: changed_by_admin`) |
| Colunas do CSV "Exportar Pedidos" | PARCIAL: só "Bilhetes", "Quantidade de bilhetes", "Nome", "Email" e "Telefone" vistos no print; separador vírgula. A conferência detecta pelo nome e a coordenação confirma (seção 10) |

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
9. **CSV "Exportar Pedidos"**: quais colunas existem (id do pedido? afiliado? status? valor? data de pagamento?), o formato dos valores (`R$ 20,00`?), o encoding e o separador, e o efeito da opção "Um bilhete por linha". A conferência (seção 10) já detecta as colunas pelo nome e a coordenação confirma o mapeamento; o export real fecha os nomes e os formatos e deve virar um CSV de teste, com os dados pessoais trocados por fictícios.
10. Se o slug muda quando a campanha é renomeada (o filtro D5 depende dele).
11. O tempo de reserva até expirar (`expires_at − created_at`), que define o volume de `expired_order`.

Os payloads reais capturados devem virar fixtures novas, com os dados pessoais trocados por fictícios antes do commit.

## 10. Conferência pelo CSV (Exportar Pedidos, RIFA-012)

Não há retry documentado, então o webhook não pode ser a única fonte. A conferência compara o CSV que a Rifei exporta com os pedidos gravados e recupera as vendas que se perderam, para o ranking nunca mentir. Rotas, schemas e exemplos: [api.md](api.md#conferência-pelo-csv-da-rifei-sprint-4-rifa-012). Tela: `/coordenacao/conferencia`.

### Como a coordenação usa

1. Na Rifei: pedidos da campanha → ⋮ → **Exportar Pedidos**. Incluir o código do pedido, o status, a quantidade de bilhetes, o valor, o afiliado e a data do pagamento, e deixar "Um bilhete por linha" desmarcado (marcado também funciona, desde que venha o código).
2. Na tela, escolher o arquivo como a Rifei baixou (sem abrir e salvar no Excel). O sistema detecta as colunas pelo nome e mostra o mapeamento: a coordenação troca o que estiver errado e confere de novo.
3. Ler o resumo e as diferenças por tipo, cada uma com a explicação. As **vendas perdidas** (pagas na Rifei e ausentes no sistema) recuperáveis vêm marcadas; "Recuperar" mostra a prévia do que vai entrar e só grava na confirmação. As recuperadas passam a contar no painel, nos rankings e no bumbo. "Recuperações feitas" mostra quem recuperou, quando e quantas.

### Privacidade (D1)

- O arquivo vai inteiro para a API e é lido só na memória da requisição: não é armazenado nem vai para o log. No navegador, fica só na memória da tela (nunca no `localStorage`).
- As colunas de dado pessoal, reconhecidas pelo nome (nome, e-mail, telefone, celular, WhatsApp, CPF, documento, nascimento, endereço, CEP, cidade, estado, observação, comprador, cliente...; "Número" sozinho num arquivo com endereço), nunca são lidas e não podem ser mapeadas. O DDD não é derivado: a conferência não precisa dele, e o pedido recuperado fica com `ddd` e `pais` nulos.
- As respostas só trazem códigos validados, status normalizados, quantidades, centavos, dias, ids de afiliado e nomes de coluna. Um texto que não se encaixa (afiliado que não é número nem rótulo cadastrado, status desconhecido) é só contado, nunca devolvido. Uma primeira linha com cara de dados (números, datas, valores, telefones, e-mails) é recusada como "sem cabeçalho", para não voltar como nome de coluna.
- O log de erro da rota leva só o nome do erro (e a mensagem, quando é do D1).
- Do arquivo, a auditoria guarda o SHA-256 (identifica o arquivo sem guardar o conteúdo) e os nomes das colunas usadas.
- Os testes varrem respostas, banco e log atrás dos dados pessoais fictícios dos CSVs de teste.

### Formatos aceitos

- Arquivo: UTF-8 (com ou sem BOM) ou Windows-1252 (a tela relê), separador `,` ou `;`, aspas do RFC 4180, linhas em branco ignoradas. Até 5 MB, 50.000 linhas e 200 colunas.
- Valores: "R$ 1.234,56", "1.234,56", "20,00", "20.00" e "20"; quantidades inteiras; números dos bilhetes separados por vírgula, ponto e vírgula, barra ou espaço; datas "23/11/2026", "23/11/26 às 14h05" e "2026-11-23 14:35" (hora de Belém) ou ISO com fuso.
- Fórmula de planilha (=, +, @ ou - seguido de letra) nunca vira valor: a célula fica ilegível e o aviso `formula_ignorada` conta. O código do pedido só aceita letras, números e `. _ : / # -`, começando por letra ou número.
- Sem o código: comparação pelos totais (por afiliado e por dia), sem recuperar. Sem o status: tudo conta como pago (com aviso). Sem quantidade, valor ou data: o campo não é comparado; quantidade e valor são obrigatórios para recuperar.
- "Um bilhete por linha" com o código: as linhas de cada pedido se juntam (valor e quantidade iguais em todas as linhas contam uma vez; diferentes, somam). Sem o código, só os bilhetes podem ser comparados.

### Recuperar

- Só a venda perdida: um pedido que já existe nunca é mudado. O pendente que está pago na Rifei (`pagamento_nao_registrado`) aparece na conferência, mas corrigi-lo fica fora desta versão.
- Atômico (um `db.batch`) e idempotente (`ON CONFLICT DO NOTHING`): repetir não grava de novo nem cria outra auditoria.
- `pedidos.origem = 'conferencia'` e `pedidos.recuperacao_id` → `recuperacoes` (quem, quando, quantos, o SHA-256 e as colunas usadas). Um `paid_order` que chegue depois para o mesmo pedido dá `duplicado`.
- Instante gravado em `aprovado_em`: o do arquivo; com só o dia, o meio-dia (ou agora, se for hoje); sem data, o instante da recuperação.

### Desempenho (atenção ao plano Free)

Ler o CSV é trabalho de CPU no Worker. Medido no Node com o mesmo leitor (`lerCsv`): de 15 a 75 ms para 5.000 pedidos (~0,7 MB) e de 110 a 270 ms para 25.000 linhas (~3,4 MB). No plano Workers Free (10 ms de CPU por requisição), um arquivo grande pode ser cortado pela Cloudflare (erro 1102); no Paid sobra folga. Exportar só as colunas necessárias (sem nome, e-mail e telefone) deixa o arquivo menor.

### O que ainda é suposição

As colunas reais do export (seção 9, item 9). A detecção é por palavras do nome e a tela deixa a coordenação confirmar. Com um export real, conferir os nomes das colunas, o formato do valor e da data, o que "Um bilhete por linha" faz com o valor (repete o valor do pedido em cada linha ou traz o valor do bilhete?) e se o afiliado vem como número ou como usuário.

### Como testar

- Automático: `src/worker/lib/conferencia-arquivo.test.ts` (detecção das colunas, valores, limites e CSV malicioso), `src/worker/lib/conferencia-analise.test.ts` (um bilhete por linha, modo agregado e plano do "Recuperar"), `src/worker/routes/reconciliacao.test.ts` (as rotas com CSVs fictícios em várias formas, a varredura de privacidade e o painel depois de recuperar) e `src/web/pages/conferencia/` (a tela).
- À mão: `npm run build && npm run preview`, uma campanha ativa, um acesso local (`npm run acesso:criar -- --nome "..." --papel coordenacao`) e um CSV fictício em `/coordenacao/conferencia`.

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
- Sem segredo (`RIFEI_WEBHOOK_TOKEN=` vazio no `.dev.vars` e o `npm run dev` reiniciado): 503 `nao_configurado`.
- Corpo que não é JSON (ex.: um arquivo truncado): 400 `json_invalido`, registrado como `erro_validacao` sem nenhum trecho do corpo.
- Corpo acima de 1 MiB (ex.: `head -c 1100000 /dev/zero | tr '\0' x > /tmp/grande.json` e o simulador com esse arquivo): 413 `corpo_muito_grande`, registrado como `erro_validacao` sem payload. Sem o token certo, o mesmo corpo dá 401 e nada é gravado.
- Para recomeçar do zero: `npx wrangler d1 execute DB --local --command "DELETE FROM webhook_eventos; DELETE FROM pedidos; DELETE FROM afiliados"`.
