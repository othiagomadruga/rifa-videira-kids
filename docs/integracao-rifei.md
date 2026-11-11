# Integração com a Rifei

A Rifei faz a venda, o pagamento e o sorteio. Este sistema recebe cada pedido por **webhook**, guarda o pedido **sem dados pessoais do comprador** e descobre de qual célula ele veio pelo `affiliate_id` (cada líder de célula é afiliado da campanha na Rifei).

- Contrato executável: `src/shared/contracts/rifei.ts` (payload, redação, conversões) e `src/shared/contracts/dominio.ts` (máquina de estados).
- Rota: `POST /api/webhooks/rifei` (detalhes em [api.md](api.md)). Tabelas: `pedidos`, `afiliados` e `webhook_eventos` (detalhes em [modelo-de-dados.md](modelo-de-dados.md)).
- Fonte oficial, lida em 06/11/2026: [Referência do webhook](https://rifei.com.br/ajuda/webhook/referencia-do-webhook) e [Como adicionar um webhook](https://rifei.com.br/ajuda/webhook/como-adicionar-webhook).
- Passo a passo na Rifei e na Efí para o PO (campanha, slug, afiliados, Efí, estorno), conferido em 11/11/2026: [seção 12](#12-rifei-e-efí-passo-a-passo-para-o-po).

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
4. No sistema, configurar a campanha (`PUT /api/admin/campanha`) com `slug_rifei` igual ao slug da campanha na Rifei, que é o identificador que aparece no link da campanha (seção 12.1).
5. Conferir com um pedido de teste: a entrega aparece em `webhook_eventos` com `resultado = 'processado'`.

Para trocar o token, faça a mudança nos dois lados em sequência: primeiro o segredo do Worker, depois a Rifei. Entre um passo e outro, as entregas recebem 401 e não são gravadas; a reconciliação por CSV recupera o que se perder.

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
11. Qualquer falha de banco nos passos 3 a 10: **500** `erro_interno` (D9). Se a Rifei não reenviar, a reconciliação por CSV recupera.

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
| Colunas do CSV "Exportar Pedidos" | PARCIAL: a janela mostra "Bilhetes", "Quantidade de bilhetes", "Nome", "Email" e "Telefone" (há mais abaixo); separador vírgula; opção "Um bilhete por linha" (seção 12.5) |
| `slug` é o fim do link da campanha (`rifei.com.br/<slug>`) | CONFIRMADO em parte: o exemplo oficial do webhook traz `demonstracao`, e a campanha de demonstração da Rifei está em `rifei.com.br/demonstracao` (seção 12.1) |
| Afiliado: área por organizador, entrada por e-mail, cadastro por convite | CONFIRMADO nas páginas públicas da conta de demonstração; as telas do organizador e o link de afiliado NÃO DOCUMENTADOS (seção 12.3) |
| Estorno ou remoção de pedido na Rifei | NÃO DOCUMENTADO; não existe evento de webhook para isso (seção 12.6) |

## 9. O que confirmar com uma campanha de teste

Antes do primeiro dia de vendas, com uma campanha de teste, uma segunda conta como afiliada e compras de valor mínimo:

1. **Link de afiliado** (como o líder vira afiliado: seção 12.3): o formato do link e se o id do afiliado aparece nele. NÃO DOCUMENTADO pela Rifei.
2. **affiliate_id de cada líder**: onde o organizador vê esse número no painel (NÃO DOCUMENTADO; seção 12.3) e se é o mesmo que chega no webhook. Sem isso, o vínculo da reunião de cadastro dos líderes depende de uma compra iniciada por líder (lançamento, seção 5.2).
3. Se `affiliate_id` chega mesmo como inteiro (a doc diz integer) e se é `null` quando não há afiliado.
4. `status` e `status_detail` reais em `new_order` e `expired_order`, se `expired_at` vem preenchido e se `fbp`/`fbc` aparecem.
5. Se `new_order` pode chegar já `approved` e se marcar pago à mão no painel dispara `paid_order`.
6. Se o pedido pode ser pago depois de expirar com o gateway escolhido (Efí), gerando `paid_order` depois de `expired_order`.
7. Formato real de `buyer.phone` (sempre E.164?) e de `utm` sem parâmetros (null? ausente? strings vazias?).
8. Retry: se a Rifei reenvia depois de um 500 ou de um timeout, quantas vezes e em que ordem. Dá para testar respondendo 500 de propósito num ambiente de teste.
9. **CSV "Exportar Pedidos"**: quais colunas existem (id do pedido? afiliado? status? valor? data de pagamento?), o formato dos valores (`R$ 20,00`?), o encoding e o separador, e o efeito da opção "Um bilhete por linha". Isso fecha o formato da reconciliação (`POST /api/admin/reconciliacao`, ainda rascunho).
10. Se o slug muda quando a campanha é renomeada (o filtro D5 depende dele).
11. O tempo de reserva até expirar (`expires_at − created_at`), que define o volume de `expired_order`.
12. Se a Rifei manda um teste ao adicionar o webhook (o artigo do n8n fala em "teste de webhook") e o que ele contém. Se a Rifei recusar o webhook por causa da resposta do sistema, anote a mensagem e passe ao SM.
13. Onde a Efí é adicionada (na conta ou em cada campanha) e os nomes dos campos do certificado e da chave Pix na janela "Adicionar Efí" (seção 12.2, passo E).

Os payloads reais capturados devem virar fixtures novas, com os dados pessoais trocados por fictícios antes do commit.

## 10. Reconciliação por CSV (rascunho, Sprints 3–4)

Não há retry documentado, então o webhook não pode ser a única fonte. A coordenação exporta o CSV na Rifei (página de pedidos da campanha → ⋮ → **Exportar Pedidos**) e envia em `POST /api/admin/reconciliacao`. O sistema compara com `pedidos` e devolve as divergências: ausente no sistema, ausente no CSV, status, valor e afiliado.

O CSV traz nome, e-mail e telefone dos compradores. Ele é lido **só em memória**: nada dele é gravado, e a resposta não devolve nenhum dado pessoal (D1). O formato final depende do item 9 acima.

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

## 12. Rifei e Efí: passo a passo para o PO

Roteiro para o PO configurar a Rifei e a Efí de uma vez, quase tudo pelo celular. Só o certificado e a aplicação da Efí (12.2, passos B e C) pedem a plataforma web, no navegador.

- Tudo foi conferido nas fontes oficiais em **11/11/2026**, e cada passo traz o link. Os nomes entre aspas são os da fonte.
- **NÃO DOCUMENTADO** quer dizer que a fonte oficial não diz. Confira na tela ou pergunte ao suporte da Rifei (12.7).
- Nenhuma credencial (Client Secret, certificado, token do webhook, senha) vai para este repositório, o DevMission ou o WhatsApp de grupo.

Ordem sugerida: abrir a conta Efí (12.2 A, porque a análise pode demorar) → campanha (12.1) → ligar a Efí (12.2 B a E) → webhook (12.4, depois do segredo do Worker) → afiliados (12.3) → compra de teste (lançamento, seção 4).

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

O artigo oficial da Rifei é [Como adicionar o Efí](https://rifei.com.br/ajuda/pagamentos/como-adicionar-o-efi-bank). Ele pede uma conta Efí Pro ou Empresas, uma aplicação com permissões do Pix, um certificado e uma chave Pix. Abaixo, na ordem: A (conta), B (certificado), C (aplicação), D (chave Pix) e E (colar na Rifei). A Efí diz que a API Pix precisa de um certificado ativo, por isso aqui o certificado vem antes da aplicação ([Como criar uma nova aplicação](https://sejaefi.com.br/central-de-ajuda/api/como-criar-uma-nova-aplicacao-para-usar-a-api-pix)).

**Que conta Efí serve.** A Rifei pede Efí Pro ou Efí Empresas ([Como adicionar o Efí](https://rifei.com.br/ajuda/pagamentos/como-adicionar-o-efi-bank)). A conta pessoal "Efí Para você" não basta.

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
3. Clique em **"Baixar certificado"** na hora: é a **única chance** de baixar. Se perder o arquivo, crie outro (a Efí limita a 5 certificados ao mesmo tempo; apague os inativos se precisar).

**C. Criar a aplicação e copiar as chaves (plataforma web).** Fontes: [Como adicionar o Efí](https://rifei.com.br/ajuda/pagamentos/como-adicionar-o-efi-bank), [Como criar uma nova aplicação](https://sejaefi.com.br/central-de-ajuda/api/como-criar-uma-nova-aplicacao-para-usar-a-api-pix) e [Como obter as chaves Client Id e Client Secret](https://sejaefi.com.br/central-de-ajuda/api/como-obter-chaves-client-id-e-client-secret-na-api).

1. Clique em "API" → "Aplicações" → "Criar aplicação". O nome é livre, só para identificar.
2. Nas permissões, abra "API Pix" e marque: Alterar cobranças, Consultar cobranças, Alterar Pix, Consultar Pix, Enviar Pix, Alterar Webhooks, Consultar Webhooks, Alterar Payloads, Consultar Payloads, Alterar Configurações da API, Consultar Configurações da API, Alterar cobranças com vencimento e Consultar cobranças com vencimento. A imagem do artigo da Rifei mostra esses itens marcados em Produção e em Homologação.
3. Clique em "Criar aplicação" e valide a operação.
4. Abra a aplicação e, na aba **Produção**, copie a "Chave Client ID" e a "Chave Client Secret".

**D. Criar a chave Pix.** Fonte: [Como cadastrar minhas chaves do Pix?](https://sejaefi.com.br/central-de-ajuda/pix/como-cadastrar-chaves-pix)

1. No app ou na web: "Menu" → "Pix" → "Minhas chaves" → "Cadastrar chave".
2. A Rifei sugere a chave **aleatória**, "para ser mais simples". Copie a chave gerada.
3. A conta de negócios nova pode já ter uma chave aleatória criada pela Efí para o Bolix. A Efí recomenda não apagar essa chave ([Por que tem uma chave aleatória cadastrada](https://sejaefi.com.br/central-de-ajuda/pix/por-que-tem-uma-chave-aleatoria-cadastrada-na-conta)).

**E. Colar na Rifei.** Fonte: [Como adicionar o Efí](https://rifei.com.br/ajuda/pagamentos/como-adicionar-o-efi-bank).

1. No painel da Rifei, adicione a Efí como forma de pagamento. Onde fica: NÃO DOCUMENTADO. A Rifei só diz que as formas de pagamento são adicionadas no painel administrativo ([dúvidas frequentes](https://rifei.com.br/#faq)). A imagem do artigo mostra a janela "Adicionar Efí", com os campos "Chave Client ID" e "Chave Secret".
2. Cole a Client ID e a Client Secret de Produção, envie o certificado baixado em B e informe a chave Pix de D. Os nomes dos campos do certificado e da chave: NÃO DOCUMENTADO.
3. O artigo termina com "a sua campanha já estará configurada para receber pagamentos no seu Efí". A prova é a compra de teste (lançamento, seção 4).

**Custos e cuidados**

- **Tarifa:** a página de tarifas da Efí mostra **1,19% por Pix recebido pela API** (QR Code dinâmico). Os 30 Pix grátis por mês do app não valem para chave usada pela API ([Tarifas](https://sejaefi.com.br/tarifas)). A tarifa pode variar por data de contratação ou negociação. A da sua conta fica em "Configurações da conta" (⚙) → "Tarifas e prazos" ([Prazos da conta](https://sejaefi.com.br/central-de-ajuda/tarifas-e-prazos/quais-os-prazos-da-minha-conta-gerencianet)).
- O Pix cai na conta Efí em até 10 segundos, também no fim de semana ([Prazos da conta](https://sejaefi.com.br/central-de-ajuda/tarifas-e-prazos/quais-os-prazos-da-minha-conta-gerencianet)).
- **Credenciais:** a Client Secret e o certificado dão acesso à conta pela API. A Efí pede que as chaves não sejam compartilhadas, e os Termos da Rifei (item 6.3) deixam a guarda com o usuário.
  - Não mande por WhatsApp nem por e-mail, e não guarde no projeto.
  - Depois de enviar à Rifei, apague o certificado baixado ou guarde só num lugar seu (ex.: gerenciador de senhas).
- **"Enviar Pix":** a Rifei pede essa permissão, que a tela da Efí (na imagem do artigo da Rifei) descreve como "Permite envio de Pix". A fonte não diz para que a Rifei a usa. Uma conta Efí só para a rifa limita o risco. Pergunte ao suporte (12.7).

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

1. **[PO, no painel da Rifei]** Ligue os afiliados na campanha e gere o **link de convite** de cada líder. Onde: NÃO DOCUMENTADO. Pergunte ao suporte (12.7) ou procure "Afiliados" no painel.
2. **[Líder]** Abre o convite, cria a conta de afiliado e entra pela "Área de afiliados" (menu da página da campanha) com o e-mail.
3. **[Líder]** Pega o **link de afiliado** dele para divulgar. Onde fica e qual o formato: NÃO DOCUMENTADO.
4. **[Líder]** Compartilha o link (WhatsApp, redes sociais). A venda feita por esse link chega ao sistema com o `affiliate_id` dele.
5. **[Coordenação]** Vincula o código à célula na tela de Adesão (lançamento, seção 5).

Ainda NÃO DOCUMENTADO, para conferir com o suporte ou com a campanha de teste (seção 9, itens 1 e 2):

- se os afiliados precisam ser ligados em cada campanha;
- onde o organizador gera o convite, e se o cadastro "só por convite" é uma escolha dele;
- o formato do link de afiliado e se o id aparece nele;
- onde o organizador vê o identificador de cada afiliado e se é o mesmo `affiliate_id` do webhook.

### 12.4 Webhook: caminho conferido

O caminho do roteiro confere com [Como adicionar um webhook](https://rifei.com.br/ajuda/webhook/como-adicionar-webhook):

1. Ícone do usuário, no canto superior direito → "Integrações".
2. Role até a seção "Outro" e toque em "Adicionar" no webhook.
3. Preencha "URL", "Token" (opcional; vai como `Authorization: Bearer`) e "Eventos": "Novo pedido", "Pedido pago" e "Pedido expirado".
4. Toque em "Adicionar".

Os valores do sistema estão na seção 1 e no lançamento, seção 3.2. Duas observações:

- O artigo [Integrar o Rifei com n8n](https://rifei.com.br/ajuda/webhook/como-integrar-com-n8n) descreve o mesmo caminho como "Integrações → Webhook" e chama os eventos de "novo pedido, pedido aprovado e pedido expirado". É o mesmo formulário com outra redação: marque os três.
- O mesmo artigo fala em "teste de webhook" e pede que o destino responda com JSON. Se a Rifei manda um teste ao adicionar, e com que conteúdo: NÃO DOCUMENTADO (seção 9, item 12).

### 12.5 Exportar pedidos: caminho conferido

O caminho do roteiro confere com [Como exportar lista de participantes](https://rifei.com.br/ajuda/campanha/exportar-lista-de-participantes): página de pedidos da campanha no painel → três pontinhos no canto superior direito → "Exportar Pedidos". As imagens do artigo mostram:

- no menu dos três pontinhos: "Exportar pedidos", "Exportar participantes", "Buscar por ID", "Histórico de pedidos", "Pesquisar bilhete próximo" e "Alterar visualização";
- na janela "Exportar pedidos": "O que deseja exportar?" (Bilhetes, Quantidade de bilhetes, Nome, Email, Telefone e outras mais abaixo, com "Selecionar tudo"), "Formato do arquivo" ("Valores separados por vírgula (.csv)"), a opção "Um bilhete por linha" e o botão "Exportar".

As demais colunas ainda faltam (seção 9, item 9).

### 12.6 Estorno de um pedido

**Na Rifei.** A Central de Ajuda não tem artigo sobre estorno, reembolso ou cancelamento de pedido. Os [Termos de uso](https://rifei.com.br/ajuda/outros/termos-de-uso) dizem:

- a Rifei não tem obrigação de fazer reembolso, e "os Organizadores são os únicos responsáveis pela entrega dos itens e pela oferta de reembolsos" (itens 7.4 e 7.5);
- pedido "pago" reservado há 7 dias ou mais fica bloqueado e não pode ser removido (item 5.7);
- depois do sorteio, ou com todos os bilhetes vendidos, não dá mais para editar nem remover pedidos (item 5.9).

Como remover ou alterar um pedido no painel: NÃO DOCUMENTADO.

**Na Efí (devolver o dinheiro).** Fonte: [Como fazer a devolução de um Pix recebido?](https://sejaefi.com.br/central-de-ajuda/pix/devolver-pix-recebido)

- No app: "Menu" → "Extrato" → toque na transação → "Devolver valor" → informe o valor → "Continuar" → "Autorizar devolução" → confirme com a Assinatura Eletrônica.
- Na web: "Menu" → "Extrato" → três pontinhos da transação → "Detalhar" → "Devolver valor recebido via Pix" → informe o valor → "Autorizar devolução" → confirme com o Autenticador Efí e a Assinatura Eletrônica.

**No sistema.** A Rifei só avisa pedido novo, pago e expirado ([Referência do webhook](https://rifei.com.br/ajuda/webhook/referencia-do-webhook)). Estorno ou remoção na Rifei não chega ao sistema: use a ação "desconsiderar pedido" do sistema, quando ela estiver no ar.

Ordem: devolva na Efí → remova ou ajuste o pedido na Rifei, se der (antes de 7 dias) → desconsidere o pedido no sistema.

### 12.7 Perguntas prontas para o suporte da Rifei

O suporte da Rifei atende pelo WhatsApp, de segunda a sábado ([Preços](https://rifei.com.br/precos); o link fica no topo de [rifei.com.br/ajuda](https://rifei.com.br/ajuda)). Mande de uma vez:

1. Onde, no painel, eu ligo os afiliados numa campanha e gero o link de convite de cada afiliado?
2. Onde o afiliado acha o link dele para divulgar? Qual o formato desse link?
3. Onde eu vejo o número de identificação de cada afiliado, o mesmo que vai no campo `affiliate_id` do webhook?
4. Onde eu adiciono a Efí: na conta ou em cada campanha? Para que a Rifei usa a permissão "Enviar Pix" da Efí?
5. Como cancelar ou estornar um pedido pago? Isso dispara algum evento do webhook?
6. Se eu mudar o título da campanha, o link (slug) muda?
7. Quanto tempo um pedido fica reservado até expirar? A Rifei reenvia o webhook se o nosso servidor responder com erro? Ela manda um teste quando o webhook é adicionado?

Passe as respostas ao SM, para a seção 9 e o DevMission.
