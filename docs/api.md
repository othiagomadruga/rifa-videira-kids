# API v1: contrato

O contrato executável está em `src/shared/contracts/`:

| Arquivo | Conteúdo |
|---|---|
| `api.ts` | schemas de cada rota e o catálogo `ROTAS` (método, caminho, grupo, situação, schemas) |
| `dominio.ts` | entidades e configuração |
| `rifei.ts` | payload do webhook e redação |
| `erros.ts` | formato de erro e códigos |
| `acesso.ts` | acesso da equipe: papéis, sessão, usuários e links, e o catálogo `ROTAS_ACESSO` ([acesso.md](acesso.md)) |
| `calendario.ts` | calendário da campanha: datas dos períodos, data final, fase e normalização dos percentuais |
| `calculos.ts` | regras de cálculo (metas, curva, ritmo, projeção, ranking, bumbo) e as funções que montam as respostas do painel e das rotas abertas ([regras-de-calculo.md](regras-de-calculo.md)) |
| `regras.ts` | regras do admin (Sprint 6, D20), sem zod: motivos da desconsideração, padrões das chaves, a chave de acesso de cada papel e os modelos das mensagens do WhatsApp com `preencherMensagem` |
| `token-webhook.ts` | token do webhook gerado pela tela (RIFA-039, D21), sem zod: formato do token, as credenciais e as regras `credencialVigenteDoWebhook` e `ultimoUsoDoWebhook` (os schemas e `ROTAS_TOKEN_WEBHOOK` ficam em `api.ts`) |
| `relatorio.ts` | relatório da campanha para baixar (RIFA-038, D23), sem zod: os tipos, as colunas de cada um, o formato dos números, a proteção contra fórmula, o arquivo CSV, o nome e os cabeçalhos (a consulta e `ROTAS_RELATORIO` ficam em `api.ts`) |
| `link-vendas.ts` | link de vendas de cada célula e o QR code dele (RIFA-046, D24), sem zod: o modelo do link de afiliado da Rifei (`{slug}` e `{afiliado}`), `problemasDoModeloLinkVendas`, `montarLinkDeVendas`, a conferência do endereço (`eLinkDeVendas`, só `https://rifei.com.br/`) e o nome do arquivo do QR (os schemas e `ROTAS_LINK_VENDAS` ficam em `api.ts`) |

Este documento explica o contrato. Se ele divergir dos schemas, valem os schemas, e a divergência é um bug que o SM corrige. Só o SM altera o contrato depois que ele estiver na `main`.

- **Detalhadas** (Sprints 1–4): fechadas. Front e back implementam em paralelo.
- **RASCUNHO**: forma provável, que pode mudar quando for implementada. Hoje não há nenhuma: a conferência (Sprint 4) foi detalhada na RIFA-012.

## Convenções

- Base `/api`. Corpos em JSON UTF-8 (`Content-Type: application/json`). Respostas 204 vêm sem corpo. A exceção é o 200 do relatório para baixar (`GET /api/painel/relatorio`, D23), um CSV (`tipoConteudo` no catálogo); os erros dele são JSON, como todos.
- Campos em português, snake_case. O payload da Rifei mantém os nomes originais dela.
- **Dinheiro em centavos inteiros** (`*_centavos`), nunca reais com casas decimais (D2).
- **Percentuais em pontos-base inteiros** (`*_bp`: 3500 = 35%).
- **Instantes em UTC**, ISO 8601 com milissegundos e `Z` (`2026-12-01T12:20:31.512Z`).
- **Datas locais** em `YYYY-MM-DD`, no fuso da campanha (padrão `America/Belem`, D8).
- Ids:
  - inteiros positivos para as entidades nossas;
  - `affiliate_id` é o inteiro da Rifei;
  - o id do pedido é o texto da Rifei.
- Listas vêm em `{ "itens": [...] }`. Não há paginação na v1: o volume é pequeno (36 células). A exceção é a trilha de auditoria (`GET /api/admin/auditoria`), que cresce a cada ação e vem por páginas, com cursor.
- Parâmetros de caminho e de consulta chegam como texto e o schema converte. Ex.: `:id` = `"12"` vira `12`; `?vinculado=false` vira `false`.

## Autorização por grupo

| Grupo | Rotas | Mecanismo | Falhas |
|---|---|---|---|
| `rifei_bearer` | `/api/webhooks/*` | `Authorization: Bearer <token>`, comparado em tempo constante (D6) com o token gerado pela tela da coordenação (RIFA-039, D21; no banco, só o SHA-256) ou, **só sem ele**, com o segredo do Worker `RIFEI_WEBHOOK_TOKEN`. Não usa a sessão: o cookie não abre o webhook | `401 nao_autenticado`; nenhum dos dois configurado: `503 nao_configurado` |
| `coordenacao` | `/api/admin/*`, `/api/painel/*` e `GET /api/sessao` | sessão em cookie (`__Host-sessao`) aberta pelo link pessoal de cada pessoa da equipe ([acesso.md](acesso.md)), com as rotas `/api/sessao` (abaixo) | `401 nao_autenticado`: sem sessão válida; `403 proibido`: papel sem permissão ou escrita de outra origem |
| `hierarquia` | `/api/minha/*` (RIFA-014, D12) | a mesma sessão, aberta pelo link pessoal de um `lider`, `discipulador` ou `rede`; o alvo (célula, discipulador ou rede) vem **só da sessão** | `401 nao_autenticado`: sem sessão; `403 proibido`: sessão da coordenação. **Nunca devolve dinheiro** |
| `aberto` | `/api/health`, `/api/publico/*`, `POST /api/sessao` e `POST /api/sessao/sair` | nenhum (os dois POSTs, só da mesma origem) | **`/api/publico/*` nunca devolve valores em unidades: R$ ou bilhetes** |

Os schemas de `/api/publico/*` são **estritos** em todos os níveis: um campo a mais, como `total_centavos`, invalida a resposta. Os testes conferem que nenhum campo de valor (centavos, total, bilhetes, realizado…) existe nas respostas abertas e que todos os campos delas estão numa lista fechada.

**Coordenação** (RIFA-007; contrato em `acesso.ts`, detalhes em [acesso.md](acesso.md)):

- Cada pessoa recebe um link `<site>/acesso/<token>`. O site pede confirmação e faz `POST /api/sessao { "token" }`: **200** `{ "usuario": { "id", "nome", "papel" } }` com `Set-Cookie: __Host-sessao=...; HttpOnly; Secure; SameSite=Lax; Path=/`; nos papéis da hierarquia (RIFA-014), o usuário vem também com `"alvo": { "tipo", "id", "nome", "divisao" }`, lido da hierarquia na hora. Link inválido, expirado ou revogado: 401. Link válido de `discipulador` ou `rede` com o acesso do papel desligado na campanha (`acesso.discipuladores` ou `acesso.redes`, D20): 403 `acesso_desligado`, sem criar a sessão. A sessão vale até o menor entre 45 dias e o fim do link.
- `GET /api/sessao` diz quem está conectado (401 sem sessão). `POST /api/sessao/sair` encerra a sessão (204). O site não lê o cookie (HttpOnly).
- Papéis: `admin` faz tudo, inclusive usuários e links (`/api/admin/usuarios`, `/api/admin/links`, em `ROTAS_ACESSO`), os acessos da hierarquia (`/api/admin/acessos-hierarquia`, em `ROTAS_ACESSO_HIERARQUIA`), a trilha de auditoria (`GET /api/admin/auditoria`, com `papeis: ["admin"]` em `ROTAS`), as ações das regras da campanha (desconsiderar e reconsiderar pedido e remover afiliado, em `ROTAS_REGRAS_CAMPANHA`, D20) e o token do webhook da Rifei (`/api/admin/webhook/token`, em `ROTAS_TOKEN_WEBHOOK`, D21) e o modelo do link de vendas (`PUT /api/admin/links-vendas/modelo`, em `ROTAS_LINK_VENDAS`, D24); `coordenacao` faz o resto de `/api/admin/*` e `/api/painel/*` (nas rotas só de admin: 403). `lider`, `discipulador` e `rede` (RIFA-014) entram só em `/api/minha/*` (a visão e, na RIFA-046, os links de vendas das células deles) e levam 403 em toda rota de `/api/admin/*` e `/api/painel/*`.
- **Todo caminho** sob `/api/admin/*` e `/api/painel/*` exige sessão, exista a rota ou não: sem sessão, 401, nunca 404. `src/worker/protecao.test.ts` confere no app real.
- **CSRF**: POST, PUT, PATCH e DELETE em `/api/sessao*`, `/api/admin/*` e `/api/painel/*` só com `Origin` igual à do site (ou `Sec-Fetch-Site: same-origin`); senão 403, antes de olhar a sessão. Fora do navegador, mande `-H "Origin: <site>"`.
- As respostas autenticadas saem com `Cache-Control: no-store`. Toda resposta da API leva `Referrer-Policy: no-referrer`, `X-Content-Type-Options: nosniff`, `X-Frame-Options: DENY` e a `Content-Security-Policy` do site (`default-src 'self'`, sem inline nem `eval`, `frame-ancestors 'none'`; valor exato em [acesso.md](acesso.md#4-segurança)).

## Erros

Toda resposta que não é 2xx tem este corpo:

```json
{ "erro": { "codigo": "nome_duplicado", "mensagem": "Já existe uma rede com esse nome", "detalhes": null } }
```

- `detalhes` é opcional. Nos erros de validação, é uma lista de `{ "caminho": ["periodos", 0, "dias"], "codigo": "too_small", "mensagem": "..." }`, sem o valor recebido.
- O cliente deve tratar `codigo` como texto aberto, porque códigos novos podem aparecer.

| Código | HTTP | Quando |
|---|---|---|
| `requisicao_invalida` | 400 | corpo, consulta ou parâmetros fora do schema (`detalhes` = problemas) |
| `json_invalido` | 400 | corpo não é JSON (em `PUT /api/admin/campanha`, `PUT /api/admin/afiliados/:affiliateId` e na conferência, também sem `Content-Type` JSON) |
| `payload_invalido` | 400 | webhook sem o essencial: `event`, `id`, `slug`, `numbers_count` ou `total` (ausente, inválido ou acima do limite) |
| `csv_invalido` | 400 | arquivo da importação da hierarquia que não dá para ler: vazio ou sem cabeçalho, sem coluna obrigatória, com coluna repetida, aspas abertas, fora de UTF-8, ou acima do limite de linhas ou de tamanho (`detalhes`: `detalhesCsvInvalidoSchema`, com o `motivo`). A conferência (RIFA-012) lê o CSV no navegador: os mesmos problemas aparecem na tela, sem chamar a API |
| `referencia_invalida` | 400 | `rede_id`, `discipulador_id` ou `celula_id` inexistente no corpo |
| `nao_autenticado` | 401 | sem credencial ou credencial inválida |
| `proibido` | 403 | autenticado, sem permissão (inclusive a coordenação que muda `pedidos`, `acesso` ou `mensagens` no `PUT /api/admin/campanha`, RIFA-042); ou escrita de outra origem (CSRF) |
| `nao_encontrado` | 404 | recurso do caminho não existe (ou campanha ainda não configurada) |
| `nome_duplicado` | 409 | nome de rede, discipulador ou célula já usado; `slug_rifei` de outra campanha (`PUT /api/admin/campanha`) |
| `em_uso` | 409 | exclusão de rede com discipuladores, de discipulador com células ou de célula com afiliados; desativar o próprio acesso ou o último admin; revogar o último link válido de admin; gerar o token do webhook com uma credencial vigente sem `substituir: true` (D21; `detalhes` = `{ "vigente": "tela" \| "segredo" }`, `detalhesTokenWebhookEmUsoSchema`) |
| `acao_desligada` | 409 | a chave da campanha que libera a ação está desligada (D20): desconsiderar ou reconsiderar pedido com `pedidos.desconsiderar` desligada; gerar link de discipulador ou rede com o acesso do papel desligado. `detalhes` = `{ "chave": "pedidos.desconsiderar" \| "acesso.discipuladores" \| "acesso.redes" }` (`detalhesAcaoDesligadaSchema`) |
| `acesso_desligado` | 403 | discipulador ou rede com o acesso do papel desligado na campanha (D20): no `POST /api/sessao` (link válido) e em todo `/api/minha/*`. `detalhes` = `{ "papel": "discipulador" \| "rede" }` (`detalhesAcessoDesligadoSchema`) |
| `afiliado_com_pedidos` | 409 | remover afiliado que tem pedido que conta (D20). `detalhes` = `{ "pedidos_que_contam": 3, "pedidos": ["PED1", "PED2", "PED3"] }` (até 20 ids; `detalhesAfiliadoComPedidosSchema`) |
| `corpo_muito_grande` | 413 | corpo acima do limite (abaixo): do webhook (1 MiB, `LIMITE_CORPO_WEBHOOK_BYTES`), do `POST /api/sessao` (4 KiB), das escritas da coordenação (1 MiB) ou da conferência (1 MiB, `LIMITE_CORPO_CONFERENCIA_BYTES`) |
| `muitas_requisicoes` | 429 | passou do limite de requisições por IP (abaixo), com `Retry-After` em segundos |
| `erro_interno` | 500 | falha inesperada (ex.: banco) |
| `nao_configurado` | 503 | webhook sem credencial: nem token gerado pela tela nem o segredo `RIFEI_WEBHOOK_TOKEN` (D21) |
| `banco_indisponivel` | 503 | health sem banco |

O mapa código → HTTP fica em `STATUS_HTTP_DO_ERRO`. Para montar o corpo, use `criarErroApi()`; para converter um erro do zod em `detalhes`, use `detalhesDeValidacao()`.

No Worker, `responderErro()` (`src/worker/lib/respostas-erro.ts`) monta o corpo com o status de `STATUS_HTTP_DO_ERRO`. Todas as partes montadas respondem assim: health (503), webhook, sessão, usuários e links, hierarquia, campanha, afiliados e adesão, o 404 de rota inexistente (`nao_encontrado`), o 500 do `onError` (`erro_interno`) e o 429 do limite de requisições (`muitas_requisicoes`, em `responderLimiteExcedido()` de `src/worker/lib/limite-requisicoes.ts`, que também põe `Retry-After` e `no-store`).

### Limites de tamanho e de requisições (RIFA-013b; docs/decisions.md D11)

**Tamanho do corpo**, conferido ANTES de ler ou validar o JSON (`src/worker/middleware/limite-corpo.ts`): `Content-Length` acima do limite é recusado sem ler nada; sem ele (envio em partes), a leitura para logo depois do limite.

| Rota | Limite | Acima do limite |
|---|---|---|
| `POST /api/sessao` | 4 KiB | 413 `corpo_muito_grande` (depois da checagem de origem) |
| POST, PUT e PATCH em `/api/admin/*` e `/api/painel/*` | 1 MiB | 413 `corpo_muito_grande`, só **depois** do login (sem sessão: 401, e o corpo nem é lido) |
| `POST /api/admin/hierarquia/importar` | 3 × `LIMITE_CARACTERES_CSV_HIERARQUIA` + 1 MB | 400 `csv_invalido` com `motivo: "arquivo_grande"`, como o `csv` acima do limite de caracteres |
| `/api/admin/reconciliacao/*` (RIFA-012) | 1 MiB (`LIMITE_CORPO_CONFERENCIA_BYTES`), conferido na própria rota: o teto geral não lê o corpo dela, para ele ser lido uma vez só (e de uma vez, com o `Content-Length`) | 413 `corpo_muito_grande` |
| `POST /api/webhooks/rifei` | 1 MiB, depois do Bearer | 413, com o evento `erro_validacao` |

**Requisições por IP** (`src/worker/lib/limite-requisicoes.ts`, binding de Rate Limiting do Workers no `wrangler.jsonc`), contadas pelo `CF-Connecting-IP` (IPv6 pelo prefixo /64), em janelas de 1 minuto:

| Rota | Limite | O que conta |
|---|---|---|
| `POST /api/sessao` | 60 por minuto (desde a D12; eram 10) | toda tentativa que passa da checagem de origem |
| `/api/publico/*` e `GET /api/health` | 60 por minuto, somados | só as que vão ao banco: no público, a resposta do cache de 30 s **não conta** (muita gente atrás do mesmo IP, como o Wi-Fi da igreja, não esbarra no limite); o health lê o banco toda vez |

Acima do limite: **429** `muitas_requisicoes`, `Retry-After: 60` e `Cache-Control: no-store`, sem ler o banco. O contador é por data center da Cloudflare e aproximado ("permissivo"). Sem o binding, vale uma janela na memória de cada isolate.

---

## Rotas detalhadas (Sprints 1–2)

### `GET /api/health` (aberto)

- **200**: `{ "ok": true, "db": "ok", "latenciaMs": 3 }` (`respostaHealthSchema`). É o formato que o esqueleto (RIFA-001) já serve e o site já lê; por isso `latenciaMs` fica em camelCase.
- **503** `banco_indisponivel`: o banco não respondeu.
- Não revela configuração, como a existência do segredo ou do token do webhook.

### `POST /api/webhooks/rifei` (`rifei_bearer`)

- Recebe o payload oficial da Rifei e o analisa com `analisarPayloadRifei` (RIFA-002b). Só recusa (400) quando falta o que torna o pedido gravável: `event` reconhecido, `id`, `slug`, `numbers_count` e `total`. O resto é tolerado: ausente ou com tipo errado vira null, e a diferença fica em `webhook_eventos.avisos`. Motivo: a Rifei não reenvia, e um 400 é venda perdida.
- O passo a passo completo está em [integracao-rifei.md](integracao-rifei.md#5-processamento-de-cada-entrega).
- **Autenticação** (D21): antes de tudo, lê a linha do token da tela (1 linha do D1 por requisição, autenticada ou não; sem cache). Com o token da tela, só ele vale; sem ele, o segredo `RIFEI_WEBHOOK_TOKEN`; sem nenhum dos dois, 503. O Bearer é comparado em tempo constante (o SHA-256 dele contra o hash gravado, ou contra o segredo como antes).
- O corpo é validado **dentro do handler**, com `analisarPayloadRifei`, e não por middleware: o erro precisa ser gravado antes da resposta 400, e os avisos precisam chegar ao evento.
- Caminho com ou sem barra no fim (`CAMINHOS_WEBHOOK_RIFEI`).
- **Limite de tamanho do corpo: 1 MiB** (`LIMITE_CORPO_WEBHOOK_BYTES`), conferido **depois** da autenticação. Acima disso, a resposta é **413** `corpo_muito_grande`, e o evento é gravado como `erro_validacao`, sem payload.
- `problemas` (no 400 e no 413) e `avisos` (no evento aceito) vêm agrupados por caminho sem índice, cada item com `ocorrencias`, no máximo 50 itens mais um item final `itens_omitidos` (`detalheResumidoSchema`).
- **Plausibilidade** (RIFA-013b): o evento que **aprova** um pedido com mais de `TETO_BILHETES_POR_PEDIDO` (200) bilhetes, ou com `total` acima de bilhetes × `preco_bilhete_centavos` da campanha ou abaixo disso além de `TOLERANCIA_DESCONTO_BP` (50% de desconto), **grava o pedido normalmente e ele conta nas vendas**. Os motivos (`MOTIVOS_PEDIDO_SUSPEITO`, um item por motivo, sem o valor recebido) vão para os `avisos` do evento e o pedido entra na lista de revisão `GET /api/admin/pedidos/suspeitos`. A resposta do webhook não muda (200 `processado`). O "Recuperar" da conferência usa a mesma regra (RIFA-042).

| Status | Corpo | Gravado em `webhook_eventos`? |
|---|---|---|
| **200** | `{ "resultado": "processado" \| "duplicado" \| "ignorado_outra_campanha" \| "ignorado_transicao", "evento_id": 123 }` | sim, depois de gravar (D9) |
| **200** (teste da Rifei, RIFA-060) | `{ "resultado": "teste" }` (`respostaTesteWebhookRifeiSchema`): o corpo é um objeto com `event` exatamente `"test"`, que a Rifei manda ao "Adicionar" o webhook; vem depois da autenticação, do limite de tamanho e do JSON, e antes da validação | não |
| **400** `json_invalido` / `payload_invalido` | erro; `detalhes` = `{ "evento_id": 124, "problemas": [...] }` | sim, como `erro_validacao` (sem dado pessoal) |
| **413** `corpo_muito_grande` | erro; `detalhes` = `{ "evento_id": 125, "problemas": [...] }` | sim, como `erro_validacao`, sem payload |
| **401** `nao_autenticado` | erro | não |
| **503** `nao_configurado` (nem token da tela nem segredo do Worker, D21) | erro | não |
| **500** `erro_interno` | erro | não (falhou ao gravar) |

- `ignorado_outra_campanha`: o `slug` é diferente do `slug_rifei` da campanha ativa, ou não há campanha ativa (D5).
- `ignorado_transicao`: o evento não é permitido no estado atual, como um `expired_order` depois de `approved` (D4).
- No `json_invalido`, `problemas` = `[{ "caminho": [], "codigo": "json_invalido", "mensagem": "O corpo não é um JSON válido", "ocorrencias": 1 }]`. A mensagem é fixa: a do `JSON.parse` traz um trecho do corpo (dado pessoal, D1) e nunca é gravada, devolvida nem logada.

### `GET /api/admin/campanha` e `PUT /api/admin/campanha` (`coordenacao`)

Configuração da campanha ativa: tudo que é regra de campanha vive aqui, e não no código.

- **GET**: **200** `Campanha` (`campanhaSchema`). **404** `nao_encontrado` enquanto nenhuma campanha foi ativada.
- **PUT**: o corpo é `campanhaEntradaSchema`, em JSON.
  - **O primeiro PUT cria a campanha já ativa**: o contrato não tem rascunho nem passo separado de ativação. A partir dele, o webhook passa a contar as vendas da Rifei com esse `slug_rifei` (D5). Preço e meta podem entrar provisórios e ser corrigidos depois.
  - Os PUTs seguintes substituem a configuração da mesma campanha (mesmo `id`: os pedidos já gravados continuam ligados a ela), e os períodos são substituídos inteiros. Campanha e períodos vão numa transação: se algo falha, nada muda. Nunca há duas campanhas ativas.
  - **200** `Campanha`, como ficou gravada.
  - **400** `json_invalido`: o corpo não é JSON, ou veio sem `Content-Type: application/json` (ou `application/<tipo>+json`), mesmo que o texto seja JSON.
  - **400** `requisicao_invalida`: fora do schema (`detalhes` = problemas).
  - **403** `proibido` (RIFA-042, [adendo da D20](decisions.md#d20-regras-do-admin-na-campanha-desconsiderar-pedido-acesso-da-hierarquia-remover-afiliado-e-mensagens-rifa-028-029-031-e-032-contrato-2026-11-11)): quem não é `admin` (a coordenação) mandou `pedidos`, `acesso` ou `mensagens` diferente do gravado (sem campanha, dos padrões), e nada é gravado. Só `codigo` e `mensagem` (sem `detalhes`); a mensagem diz quais grupos mudavam: "Só o admin muda os grupos pedidos, acesso e mensagens da campanha (este salvamento mudava: acesso). Nada foi salvo: mande esses grupos como estão gravados, ou sem eles." Vem depois do 400 e antes do 409.
  - **409** `nome_duplicado`: o `slug_rifei` já é de outra campanha (inativa) do sistema, e nada é gravado. `detalhes` = `[{ "caminho": ["slug_rifei"], "codigo": "slug_duplicado", "mensagem": "Este slug já pertence a outra campanha (inativa) do sistema" }]`.

Corpo do PUT:

```json
{
  "nome": "Rifa Videira Kids",
  "slug_rifei": "videira-kids",
  "fuso_horario": "America/Belem",
  "data_inicio": "2026-11-23",
  "preco_bilhete_centavos": 2000,
  "meta": { "unidade": "bilhetes", "regra": "por_pessoa", "valor": 10 },
  "periodos": [
    { "nome": "Semana 1", "dias": 10, "percentual_bp": 3500 },
    { "nome": "Semana 2", "dias": 7, "percentual_bp": 2500 },
    { "nome": "Semana 3", "dias": 7, "percentual_bp": 4500 }
  ],
  "ranking": { "criterio": "percentual_meta" },
  "publico": { "mostra_percentual_meta": false, "limite_ranking": 3 },
  "pedidos": { "desconsiderar": false },
  "acesso": { "discipuladores": true, "redes": true },
  "mensagens": {
    "link_coordenacao": "{saudacao} Este é o seu link pessoal para entrar no sistema da Rifa Videira Kids. Ele é só seu, não repasse:\n{link}",
    "link_lider": "{saudacao} Este é o seu link pessoal para acompanhar a sua célula ({alvo}) na campanha ...\n{link}",
    "link_discipulador": "...",
    "link_rede": "..."
  }
}
```

(As mensagens estão encurtadas; os padrões completos são `MENSAGENS_PADRAO`, em `regras.ts`.)

- `fuso_horario` (padrão `America/Belem`) e `publico` (padrão `{ false, 3 }`) são opcionais.
- `ranking.por_divisao` (RIFA-061, [D27](decisions.md#d27-ranking-único-separar-ou-não-o-ranking-por-divisão-rifa-061-contrato-2026-11-17)): separa o ranking por divisão (`true`, o padrão) ou não (`false`: um ranking só, de todas as células). No PUT é opcional e, ausente, **mantém o gravado** (no primeiro PUT, o padrão), como os grupos do admin; na resposta, sempre presente. É do grupo `ranking`: a coordenação também muda, como o critério.
- **Regras do admin** (Sprint 6, [D20](decisions.md#d20-regras-do-admin-na-campanha-desconsiderar-pedido-acesso-da-hierarquia-remover-afiliado-e-mensagens-rifa-028-029-031-e-032-contrato-2026-11-11)): `pedidos`, `acesso` e `mensagens` são opcionais e, diferente de `publico`, **o grupo ausente mantém o que está gravado** (no primeiro PUT, o padrão); o grupo presente vem inteiro e substitui o gravado.
  - **Só o `admin` muda os três** (RIFA-042). A coordenação pode mandá-los ausentes ou iguais ao gravado (passa, e a gravação vai sem eles: o PUT dela nunca escreve essas colunas nem desfaz o que um admin gravar no meio); diferente do gravado, 403 `proibido`. O resto da campanha a coordenação continua mudando.
  - `pedidos.desconsiderar` (padrão `false`): libera desconsiderar e reconsiderar pedido ([abaixo](#regras-da-campanha-sprint-6-docsdecisionsmd-d20)). Desligar não devolve às contas o que já foi desconsiderado.
  - `acesso.discipuladores` e `acesso.redes` (padrão `true`): desligado, quem tem o papel não entra nem usa `/api/minha/*` (403 `acesso_desligado`) e não se gera link do papel (409 `acao_desligada`); nada é revogado, e tudo volta a valer quando a chave volta. O líder não tem chave.
  - `mensagens`: o modelo da mensagem do WhatsApp de cada link pessoal (tela Acessos), até 1.000 caracteres, com os marcadores `{nome}` (primeiro nome), `{saudacao}` ("Olá, Maria!" ou, sem nome, "Olá!"), `{alvo}` (nome da célula, do discipulador ou da rede; não existe em `link_coordenacao`) e `{link}` (obrigatório). Marcador desconhecido ou a falta do `{link}`: 400 com a mensagem em português. Também 400 (RIFA-042): o `{link}` fora do começo e sem espaço, tabulação ou quebra de linha antes (ex.: `https://outro.site/?u={link}`, `x{link}`: o link pessoal viraria parte de outro endereço, e a prévia do WhatsApp levaria o token a esse site) e outro endereço no modelo (`://`, `www.` ou um domínio com barra, como `site.com/`). As regras e as mensagens estão em `problemasDoModelo` (`regras.ts`). O padrão (`MENSAGENS_PADRAO`) é o texto de hoje; o site preenche com `preencherMensagem` (`regras.ts`). O bumbo não entra (é montado pela API, sem texto livre no que é público).
- `meta.regra`:
  - `por_pessoa`: `valor` × pessoas da célula;
  - `total_proporcional`: `valor` é o total da campanha, dividido pelas células na proporção das pessoas;
  - `fixa_por_celula`: `valor` igual para todas as células.
- `meta.unidade`: `bilhetes` ou `centavos`.
- `ranking.criterio`: `percentual_meta`, `bilhetes` ou `arrecadacao`.
- Os períodos são consecutivos a partir de `data_inicio`. Cada `percentual_bp` vai de 0 a 10000, a soma pode ser diferente de 10000 (o cálculo normaliza) e pelo menos um percentual precisa ser maior que zero.

A resposta acrescenta os campos calculados:

```json
{
  "id": 1, "nome": "Rifa Videira Kids", "slug_rifei": "videira-kids", "fuso_horario": "America/Belem",
  "data_inicio": "2026-11-23", "data_fim": "2026-12-16", "preco_bilhete_centavos": 2000,
  "meta": { "unidade": "bilhetes", "regra": "por_pessoa", "valor": 10 },
  "periodos": [
    { "ordem": 1, "nome": "Semana 1", "dias": 10, "percentual_bp": 3500, "data_inicio": "2026-11-23", "data_fim": "2026-12-02" },
    { "ordem": 2, "nome": "Semana 2", "dias": 7, "percentual_bp": 2500, "data_inicio": "2026-12-03", "data_fim": "2026-12-09" },
    { "ordem": 3, "nome": "Semana 3", "dias": 7, "percentual_bp": 4500, "data_inicio": "2026-12-10", "data_fim": "2026-12-16" }
  ],
  "soma_percentuais_bp": 10500,
  "ranking": { "criterio": "percentual_meta" },
  "publico": { "mostra_percentual_meta": false, "limite_ranking": 3 },
  "criado_em": "2026-11-06T18:00:00.000Z", "atualizado_em": "2026-11-06T18:00:00.000Z"
}
```

`soma_percentuais_bp` diferente de 10000 é o sinal para a interface avisar. A resposta traz sempre `pedidos`, `acesso` e `mensagens` (sem nada gravado, os padrões). Nela, as mensagens conferem só o tamanho (`mensagensGravadasSchema`): os marcadores são conferidos na entrada, e um modelo gravado fora das regras não derruba o painel nem as rotas abertas, que leem a campanha.

### CRUD `/api/admin/redes`, `/api/admin/discipuladores`, `/api/admin/celulas` (`coordenacao`)

O mesmo padrão vale para os três recursos (`:id` inteiro):

| Rota | Entrada | Sucesso | Erros |
|---|---|---|---|
| `GET /api/admin/<recurso>` | consulta (abaixo) | 200 `{ "itens": [...] }` | 400 |
| `GET /api/admin/<recurso>/:id` | | 200 item | 404 |
| `POST /api/admin/<recurso>` | corpo de entrada | **201** item criado | 400, 400 `referencia_invalida`, 409 `nome_duplicado` |
| `PUT /api/admin/<recurso>/:id` | corpo de entrada (substitui tudo) | 200 item | 400, 404, 409 |
| `DELETE /api/admin/<recurso>/:id` | | **204** | 404, 409 `em_uso` |

| Recurso | Entrada (`*EntradaSchema`) | Saída (`*Schema`) | Consulta da lista |
|---|---|---|---|
| redes | `{ nome, divisao: "jovens"\|"adultos", responsavel_nome? }` | + `id`, `criado_em`, `atualizado_em` | — |
| discipuladores | `{ rede_id, nome }` | + `rede_nome`, `divisao` | `?rede_id=` |
| celulas | `{ discipulador_id, nome, qtd_pessoas (1–1000), lider_nome, lider_email?, lider_telefone? }` | + `discipulador_nome`, `rede_id`, `rede_nome`, `divisao` | `?discipulador_id=&rede_id=&divisao=` |

- Os nomes são únicos dentro de cada recurso, sem diferenciar maiúsculas (inclusive acentuadas) e com os espaços normalizados (`normalizarEspacos`): os das pontas não contam e os em sequência, inclusive tab e espaço não separável, valem um só (`Rede  Jovem` = `Rede Jovem`). Os textos são gravados assim, com um espaço só: `nome`, `responsavel_nome`, `lider_nome` e `lider_telefone`.
- No `400 requisicao_invalida`, a `mensagem` de cada item de `detalhes` é em português ("Campo obrigatório", "Use no máximo 120 caracteres", "Use um número inteiro", "E-mail inválido"...); `caminho` e `codigo` continuam os do zod.
- `DELETE` não apaga em cascata:
  - rede com discipuladores: `409 em_uso`;
  - discipulador com células: `409 em_uso`;
  - célula com afiliado vinculado: `409 em_uso` (passe os afiliados para outra célula antes, com o [PUT do afiliado](#put-apiadminafiliadosaffiliateid-coordenacao), que leva as vendas junto; desvincular as tiraria de qualquer célula).
- **Trilha de auditoria** (RIFA-018): cada POST, PUT e DELETE que muda algo grava uma linha (`hierarquia.criar`, `hierarquia.atualizar`, `hierarquia.remover`; [GET /api/admin/auditoria](#get-apiadminauditoria-só-admin-sprint-4-rifa-013b)) no mesmo `db.batch` da gravação: recusado (400, 404, 409) ou sem mudança, nada fica. O PUT e o DELETE gravam só se a linha (e, no DELETE, o acesso do alvo) ainda é a que foi lida; se outra gravação a mudou no meio, leem de novo e refazem, até 3 vezes, e depois respondem `409 em_uso` ("A célula mudou enquanto isso..."), sem gravar nada.

### `POST /api/admin/hierarquia/importar` (`coordenacao`)

Importa a hierarquia (redes, discipuladores e células) de um CSV, como a planilha que a igreja vai entregar.

- **Corpo** (`corpoImportarHierarquiaSchema`): `{ "csv": "<conteúdo do arquivo>", "simular": false }`. Com `simular: true`, só valida e conta.
- **Arquivo**:
  - UTF-8 (BOM aceito);
  - primeira linha = cabeçalho;
  - separador `,` ou `;` (detectado no cabeçalho; o Excel em português usa `;`);
  - aspas como no RFC 4180;
  - linhas vazias são ignoradas;
  - no máximo 2000 linhas de dados e 1.000.000 de caracteres (`LIMITE_CARACTERES_CSV_HIERARQUIA`, cerca de 1 MB).
- **Colunas** (`COLUNAS_CSV_HIERARQUIA`). Os nomes do cabeçalho são comparados sem diferenciar maiúsculas nem acentos; colunas desconhecidas são ignoradas e listadas em `avisos` (`coluna_ignorada`, sugerindo a coluna do contrato mais parecida, quando houver).

| Coluna | Obrigatória | Conteúdo |
|---|---|---|
| `rede` | sim | nome da rede |
| `divisao` | sim | `jovens` ou `adultos` (maiúsculas aceitas) |
| `rede_responsavel` | não | pastor ou obreiro da rede |
| `discipulador` | sim | nome do discipulador |
| `celula` | sim | nome da célula |
| `qtd_pessoas` | sim | inteiro de 1 a 1000 |
| `lider_nome` | sim | nome do líder |
| `lider_email` | não | e-mail do líder |
| `lider_telefone` | não | telefone do líder (texto livre) |

```csv
rede,divisao,rede_responsavel,discipulador,celula,qtd_pessoas,lider_nome,lider_email,lider_telefone
Rede Jovem Ficticia,jovens,Obreiro Ficticio,Discipulador Ficticio A,Célula Ficticia 01,12,Lider Ficticio 01,lider01@example.com,(91) 90000-0001
Rede Jovem Ficticia,jovens,Obreiro Ficticio,Discipulador Ficticio A,Célula Ficticia 02,9,Lider Ficticio 02,,
Rede Adulta Ficticia,adultos,,Discipulador Ficticio B,Célula Ficticia 03,15,Lider Ficticio 03,lider03@example.com,
```

**Regras**

- Cada linha é validada por `linhaCsvHierarquiaSchema`, que normaliza os espaços de cada célula (`normalizarEspacos`). As mensagens dos erros de linha são em português.
- As entidades são encontradas pelo **nome** (mesma comparação do CRUD):
  - se não existe, é criada;
  - se existe e mudou, é atualizada (um discipulador pode mudar de rede e uma célula, de discipulador);
  - se existe e não mudou, fica "inalterada".
- Coluna opcional **ausente do cabeçalho** mantém o valor atual. Coluna **presente e vazia** apaga o valor (null).
- O arquivo precisa ser coerente. A mesma rede com divisões diferentes (ou com responsáveis diferentes, quando preenchidos), o mesmo discipulador em redes diferentes ou uma célula repetida com dados diferentes é erro na linha que contradiz a anterior. Na célula repetida com dados diferentes, `coluna` é `null` e a mensagem cita as colunas que diferem. Uma linha repetida idêntica (sem diferenciar maiúsculas e com espaços normalizados) conta uma vez e gera o aviso `linha_repetida`.
- **Atômico**: se qualquer linha tem erro, nada é gravado. O que não está no arquivo não é apagado. A gravação é um lote só (transação do D1): se outra alteração gravar ao mesmo tempo um nome que a importação ia criar, o lote inteiro é desfeito e a resposta é **409** `nome_duplicado` (nada gravado; importe de novo).
- **400** `csv_invalido`, com `detalhes` no formato `detalhesCsvInvalidoSchema`:
  - `{ "motivo": "sem_cabecalho" }`: arquivo vazio ou sem cabeçalho;
  - `{ "motivo": "colunas_faltando", "colunas": ["qtd_pessoas"] }`: falta coluna obrigatória;
  - `{ "motivo": "linhas_demais", "limite": 2000, "total_linhas": 2500 }`: mais de 2000 linhas de dados;
  - `{ "motivo": "arquivo_grande", "limite_caracteres": 1000000 }`: `csv` acima do limite ("O arquivo passa de 1 MB: divida a planilha..."); `csv` vazio é `sem_cabecalho`;
  - `{ "motivo": "coluna_repetida", "coluna": "rede" }`: coluna do contrato duas vezes no cabeçalho;
  - `{ "motivo": "aspas_abertas", "linha": 7 }`: aspas abertas que não fecham;
  - `{ "motivo": "codificacao_invalida", "linha": 2 }`: arquivo fora de UTF-8 (ex.: salvo como "CSV" no Excel, e não "CSV UTF-8").

  A `mensagem` é em português e diz o que fazer; é ela que a tela mostra. Em `colunas_faltando`, ela sugere o nome certo quando o cabeçalho tem uma coluna parecida (ex.: `"Quantidade de pessoas" (use "qtd_pessoas")`).

**200** (`respostaImportarHierarquiaSchema`) para o CSV acima, num banco vazio:

```json
{
  "aplicado": true,
  "simulado": false,
  "total_linhas": 3,
  "criados": { "redes": 2, "discipuladores": 2, "celulas": 3 },
  "atualizados": { "redes": 0, "discipuladores": 0, "celulas": 0 },
  "inalterados": { "redes": 0, "discipuladores": 0, "celulas": 0 },
  "erros": [],
  "avisos": []
}
```

- `aplicado` só é `true` quando não há erro e `simular` é `false`. Sem aplicar, as contagens mostram o que teria acontecido com as linhas válidas.
- Uma entidade que aparece em várias linhas conta uma vez.
- `avisos` (`avisoImportacaoSchema`, lista possivelmente vazia) não impedem a importação. Tipos: `coluna_ignorada` (linha do cabeçalho) e `linha_repetida` (a linha ignorada). Ex.: `{ "tipo": "coluna_ignorada", "linha": 1, "mensagem": "Coluna \"Telefone do líder\" ignorada: não é uma coluna do modelo. Você quis dizer \"lider_telefone\"?" }` e `{ "tipo": "linha_repetida", "linha": 5, "mensagem": "Linha igual à linha 3: foi ignorada (a célula conta uma vez)" }`. As mensagens não trazem dados pessoais, só números de linha e nomes de coluna.
- Se a linha 4 tivesse `qtd_pessoas` = `12,5`, a resposta seria `aplicado: false`, com `erros: [{ "linha": 4, "coluna": "qtd_pessoas", "mensagem": "Use um número inteiro" }]` e as contagens só das linhas 2 e 3. `linha` conta o cabeçalho como linha 1.

### `GET /api/admin/afiliados` (`coordenacao`)

- **Consulta**:
  - `?vinculado=true`: só os ligados a uma célula;
  - `?vinculado=false`: a fila de órfãos;
  - sem o parâmetro: todos.
- **Ordem**: os não vinculados primeiro; em cada grupo, o mais recente no topo (`criado_em` decrescente; no empate, o `affiliate_id` maior).
- **200** (`respostaListaAfiliadosSchema`):

```json
{
  "itens": [
    {
      "affiliate_id": 1043, "celula_id": null, "celula_nome": null, "rotulo": null, "origem": "webhook",
      "criado_em": "2026-12-01T13:00:00.512Z", "vinculado_em": null, "atualizado_em": "2026-12-01T13:00:00.512Z",
      "vendas": { "pedidos_aprovados": 1, "bilhetes": 2, "total_centavos": 3600 },
      "primeira_venda_em": "2026-12-01T13:41:09.877Z", "ultima_venda_em": "2026-12-01T13:41:09.877Z"
    }
  ],
  "sem_afiliado": { "pedidos_aprovados": 4, "bilhetes": 9, "total_centavos": 18000 }
}
```

`vendas`, `primeira_venda_em` e `ultima_venda_em` consideram só pedidos `approved`. `sem_afiliado` soma as vendas aprovadas que chegaram sem `affiliate_id`.

### `PUT /api/admin/afiliados/:affiliateId` (`coordenacao`)

Vincula ou desvincula uma célula. Se o afiliado ainda não existe, ele é **criado** (pré-cadastro, `origem: "manual"`), por exemplo na reunião de cadastro dos líderes, antes da primeira venda.

- **Corpo** (`corpoSalvarAfiliadoSchema`): `{ "celula_id": 7, "rotulo": "usuário Rifei do líder" }`.
  - `celula_id: null` desvincula.
  - Sem `rotulo`, o rótulo atual é mantido; `rotulo: null` apaga.
- **200**: o afiliado no mesmo formato de um item da lista.
- **400** `referencia_invalida`: a célula não existe; nada é gravado (nem o pré-cadastro). `detalhes` aponta o campo, como na validação: `[{ "caminho": ["celula_id"], "codigo": "referencia_invalida", "mensagem": "A célula 999 não existe" }]`.
- **400** `json_invalido`: corpo malformado, vazio ou sem `Content-Type: application/json`. **400** `requisicao_invalida`: `:affiliateId` não é inteiro positivo ou o corpo está fora do schema.
- Efeito (num comando só, atômico): `vinculado_em` = agora ao vincular ou trocar de célula; null ao desvincular; **mantido** se a célula é a mesma de antes (ex.: só o `rotulo` mudou). `origem` e `criado_em` nunca mudam. Todas as vendas do afiliado passam para a célula **na hora** (D7): a view `vendas_aprovadas` resolve a célula na leitura, sem alterar os pedidos.

### `GET /api/admin/adesao` (`coordenacao`)

Painel de "quem falta": uma linha por célula.

```json
{
  "resumo": { "celulas": 36, "vinculadas": 30, "com_venda": 21, "afiliados_nao_vinculados": 2 },
  "itens": [
    {
      "celula_id": 3, "celula_nome": "Célula Ficticia 03", "qtd_pessoas": 15,
      "lider_nome": "Lider Ficticio 03", "lider_telefone": null,
      "discipulador_id": 2, "discipulador_nome": "Discipulador Ficticio B",
      "rede_id": 2, "rede_nome": "Rede Adulta Ficticia", "divisao": "adultos",
      "afiliados": [], "vinculada": false, "primeira_venda_em": null, "pedidos_aprovados": 0
    }
  ]
}
```

- `itens` em ordem do nome da célula em português (sem diferenciar acentos e maiúsculas; "Célula 2" antes de "Célula 10").
- `vinculada`: a célula tem ao menos um afiliado.
- `primeira_venda_em`: o primeiro pedido aprovado de qualquer afiliado da célula.
- `lider_telefone` serve para a coordenação cobrar quem falta.

### `GET /api/admin/pedidos/suspeitos` (`coordenacao`; Sprint 4, RIFA-013b)

Lista de revisão dos pedidos aprovados que o webhook marcou como implausíveis (ver "Plausibilidade" no webhook) e, desde a RIFA-042, dos recuperados pela conferência com a mesma regra (ver o "Recuperar"). **Eles continuam contando** nas vendas, no painel e nos rankings: a lista é para a coordenação conferir na Rifei (ou pela conferência por CSV). Tirar um pedido das vendas é decisão do PO.

- **200** (`respostaPedidosSuspeitosSchema`): os da campanha ativa, o mais recente primeiro, no máximo `LIMITE_PEDIDOS_SUSPEITOS` (500); `total` conta todos.

```json
{
  "itens": [
    {
      "pedido_id": "PEDTESTE0001", "affiliate_id": 1042, "celula_id": 7, "celula_nome": "Célula Ficticia 07",
      "qtd_bilhetes": 300, "total_centavos": 6000, "esperado_centavos": 600000,
      "motivos": [
        { "caminho": ["numbers_count"], "codigo": "quantidade_acima_do_teto", "mensagem": "Mais de 200 bilhetes num pedido só: confira na Rifei (o pedido continua contando)", "ocorrencias": 1 },
        { "caminho": ["total"], "codigo": "total_abaixo_do_esperado", "mensagem": "Total abaixo de bilhetes × preço do bilhete da campanha com mais de 50% de desconto: confira na Rifei (o pedido continua contando)", "ocorrencias": 1 }
      ],
      "aprovado_em": "2026-12-01T12:20:31.512Z", "marcado_em": "2026-12-01T12:20:32.004Z"
    }
  ],
  "total": 1
}
```

- `desconsiderado` (D20): null enquanto o pedido conta; `{ "motivo", "observacao", "em" }` quando o admin já o desconsiderou (a revisão terminou). Ele continua na lista e no `total`.
- `esperado_centavos` = bilhetes × preço do bilhete **no momento da marcação**; `celula_id`/`celula_nome` são da célula do afiliado agora (D7: é para ela que o pedido conta), null sem afiliado ou sem vínculo.
- `motivos[].codigo` ∈ `MOTIVOS_PEDIDO_SUSPEITO`: `quantidade_acima_do_teto` (mais de 200 bilhetes), `total_acima_do_esperado` (total maior que bilhetes × preço), `total_abaixo_do_esperado` (mais de 50% abaixo).
- **Sem nenhum dado do comprador**: nada de nome, e-mail, documento, telefone, DDD, país, UTM ou números dos bilhetes.
- Só o evento que aprova é avaliado (aprovado é final, D4): a reentrega (`duplicado`) não marca de novo. Guardado em `pedidos_suspeitos` (migração `0005_auditoria.sql`).
- O pedido recuperado pela conferência (RIFA-042) é avaliado com a mesma regra quando entra: `marcado_em` é o instante da recuperação, e `aprovado_em`, o que o "Recuperar" gravou.

### `GET /api/admin/auditoria` (**só admin**; Sprint 4, RIFA-013b)

Trilha de quem mudou o quê. Cada linha é gravada no **mesmo lote** (transação do D1) da ação: se a ação é recusada ou falha, não fica registro.

| Ação (`acao`) | Rota | Alvo (`alvo`) | Resumo |
|---|---|---|---|
| `campanha.salvar` | `PUT /api/admin/campanha` | `campanha:<id>` | criada (com o slug, o preço, as três chaves das regras com o valor gravado e o nome das mensagens diferentes do padrão, RIFA-043: `Campanha criada: slug_rifei "…", preco_bilhete_centavos 2000, pedidos.desconsiderar: desligado, acesso.discipuladores: ligado, acesso.redes: desligado, mensagens.link_lider`) ou os campos alterados; `slug_rifei` e `preco_bilhete_centavos` com o antes e o depois; as chaves que mudaram com o antes e o depois e o nome das mensagens alteradas (D20) |
| `afiliado.salvar` | `PUT /api/admin/afiliados/:affiliateId` | `afiliado:<affiliate_id>` | célula antes → depois (pelos ids); o rótulo só como "alterado"/"apagado" |
| `hierarquia.importar` | `POST /api/admin/hierarquia/importar` aplicada | `hierarquia` | linhas e contagens de criados e atualizados (a simulação não registra) |
| `hierarquia.criar` | `POST /api/admin/redes`, `/discipuladores` ou `/celulas` (RIFA-018) | `rede:<id>`, `discipulador:<id>` ou `celula:<id>` | o nome do item e a configuração: `Célula "Célula Ágape" criada (discipulador_id 3, qtd_pessoas 12)` |
| `hierarquia.atualizar` | `PUT` do mesmo recurso (RIFA-018) | idem | só o que mudou, com o antes e o depois (`nome`, `divisao`, `rede_id`, `discipulador_id`, `qtd_pessoas`: a meta e o ranking mudam junto); os dados do líder e o responsável da rede só pelo nome do campo, como `informado`, `alterado` ou `apagado`: `Célula "Célula Ágape" alterada: qtd_pessoas (12 → 15), lider_telefone (apagado)`. O PUT igual ao gravado não registra |
| `hierarquia.remover` | `DELETE` do mesmo recurso (RIFA-018) | idem | o nome do item, a configuração e o acesso da hierarquia que caiu junto (D12), pelo id do usuário: `Célula "Célula Ágape" removida (discipulador_id 3, qtd_pessoas 12); acesso do líder removido junto, usuário 15 (com os links e as sessões)` |
| `usuario.criar` | `POST /api/admin/usuarios` | `usuario:<id>` | o papel (sem nome nem e-mail) |
| `usuario.ativar` / `usuario.desativar` | `PATCH /api/admin/usuarios/:id` que muda o estado (reativar quem está ativo ou desativar quem está desativado não registra) | `usuario:<id>` | reativado / desativado |
| `link.criar` | `POST /api/admin/usuarios/:id/links` | `link:<id>` | o usuário do link |
| `link.revogar` | `DELETE /api/admin/links/:id` | `link:<id>` | o usuário do link |
| `conferencia.recuperar` | `POST /api/admin/reconciliacao/recuperar` que grava algum pedido (RIFA-012, D19) | `campanha:<id>` | o id da recuperação e quantos pedidos e bilhetes entraram e, com pagamentos registrados (RIFA-056), quantos pedidos pendentes ou expirados e bilhetes foram marcados como pagos (os códigos estão em `GET /api/admin/reconciliacao/recuperacoes`); a prévia, a recuperação recusada e a em que nada entrou não registram |
| `pedido.desconsiderar` | `POST /api/admin/pedidos/desconsiderar` (D20) | `pedido:<id>` (só `pedido` se não couber em 64 caracteres: `alvoDoPedidoNaAuditoria`) | o id do pedido em JSON, o status, os bilhetes, a célula (pelo id) e o motivo; da observação, só "observação informada" |
| `pedido.reconsiderar` | `POST /api/admin/pedidos/reconsiderar` (D20) | idem | o id, o motivo que tinha e quando fora desconsiderado |
| `afiliado.remover` | `DELETE /api/admin/afiliados/:affiliateId` (D20) | `afiliado:<affiliate_id>` | a célula que ele tinha (pelo id) e quantos pedidos desconsiderados ficaram sem afiliado (os ids, se couberem) |
| `webhook.gerar_token` | `POST /api/admin/webhook/token` (D21) | `webhook` | o que deixou de valer: nada, o segredo do Worker ou o token anterior (com o `gerado_em` dele); **nunca o token nem o hash**. O 409 não registra |

- **Consulta** (`consultaAuditoriaSchema`): `limite` (1 a 200, padrão 50) e `antes_de` (cursor: o `proximo` da página anterior).
- **200** (`respostaAuditoriaSchema`): do mais novo para o mais antigo.

```json
{
  "itens": [
    {
      "id": 42, "em": "2026-11-25T15:00:00.000Z", "usuario_id": 3, "usuario_nome": "Coordenadora Ficticia",
      "acao": "campanha.salvar", "alvo": "campanha:1",
      "resumo": "Alterado: slug_rifei (\"videira-kids\" → \"videira-kids-2\"), periodos"
    }
  ],
  "proximo": 42
}
```

- `proximo`: passe em `antes_de` para a página seguinte; `null` = não há mais.
- O `resumo` **nunca tem dados pessoais**: só ids e configuração (nomes de pessoas, e-mails, telefones e o rótulo livre do afiliado ficam de fora). O nome da rede, do discipulador e da célula entra (é o nome do item, não de uma pessoa da equipe). `usuario_nome` vem da tabela de usuários (o admin já vê os nomes na administração dos acessos).
- **O que não muda nada não registra** (RIFA-018): o PUT da hierarquia igual ao gravado, reativar quem está ativo, desativar quem está desativado e revogar um link já revogado (`DELETE /api/admin/links/:id` de novo: 204, a data continua a da primeira revogação). O PUT da campanha e o do afiliado registram também o salvamento igual ("Configuração salva sem mudanças", "Célula <id> mantida").
- **Ids que voltam** (D12): `usuarios.id` e os ids de redes, discipuladores e células não são AUTOINCREMENT, então o id de um item apagado pode voltar num item novo (o de maior id, apagado, é o que volta). Por isso o resumo da hierarquia sempre leva o nome do item, e a remoção diz o usuário do acesso que caiu junto e de qual alvo ele era: as linhas mais antigas com `usuario:<id>` (ou `celula:<id>`) falam do dono anterior do id, e a linha `hierarquia.remover` marca até quando.
- **Erros**: 400 `requisicao_invalida` (consulta fora do schema), 401, 403 (`coordenacao`).

---

## Painel, rankings e visão pública (Sprint 3, RIFA-008)

Regras, fontes, exemplos e suposições: [regras-de-calculo.md](regras-de-calculo.md), que substitui a seção 7 de [modelo-de-dados.md](modelo-de-dados.md). Os schemas estão em `api.ts` e as respostas saem prontas das funções de `calculos.ts`:

| Rota | Função |
|---|---|
| `GET /api/painel/resumo` | `montarResumoPainel(entrada, { escopo, data }, agora)` |
| `GET /api/painel/ranking` | `montarRankingPainel(entrada, consulta, agora)` |
| `GET /api/publico/ranking` | `montarRankingPublico(entrada, consulta, agora)` |
| `GET /api/publico/bumbo` | `montarBumbo(entrada, { data }, agora)` (um 4º argumento `OpcoesBumbo`, como `BUMBO_PADRAO`, é aceito e ignorado) |

Tipos nomeados para as telas (em `calculos.ts`): `MetaDoDia`, `PontoCurva`, `RitmoCampanha`, `VendasForaDaJanela`, `PeriodoDaReferencia`, `ItemRankingPublico`, `VizinhoRanking`, `VinculoRanking` e `JanelaRankingResposta`; `calculos.ts` também reexporta os tipos das respostas (`RespostaPainelResumo`, `RespostaRanking`, `ItemRanking`, `ReferenciaCampanha`…). Atenção: `JanelaRanking` é o valor pedido na consulta (`atual` | `campanha`); o objeto `janela` da resposta é `JanelaRankingResposta`. O site importa tudo isso de `src/shared/contracts/calculos` (sem zod), nunca do index.

**O que a rota faz** (passo a passo em [regras-de-calculo.md, seção 5](regras-de-calculo.md#5-como-o-worker-alimenta-as-funções)):

1. Valida a consulta com o schema (`400 requisicao_invalida` fora dele).
2. Lê a campanha ativa: sem campanha, `404 nao_encontrado`.
3. Se veio `data` depois de hoje no fuso da campanha, `400 requisicao_invalida` com `detalhes` = `[{ "caminho": ["data"], "codigo": "data_futura", "mensagem": "A data não pode ser depois de hoje" }]`. "Hoje" é sempre `hojeNoFuso(campanha.fuso_horario, agora)`, a função única (`diaLocalDoInstante` delega para ela); compare com `diasEntre`. No bumbo, antes disso, o `data` precisa estar na janela da campanha (`fora_da_campanha`, abaixo).
4. Lê **todas** as células com a hierarquia e as vendas aprovadas agrupadas por célula e dia local (`EntradaCalculo`), de qualquer data.
5. Chama a função com `agora = new Date()` e devolve o resultado como está.

**Convenções destas quatro rotas**

- `meta`, `esperado`, `realizado`, `diferenca`, `projecao` e as metas do dia estão na unidade da meta (`unidade`: `bilhetes` ou `centavos`). Alvos vêm arredondados para cima; percentuais `*_bp` vêm truncados e passam de 10000 acima da meta.
- **Esperado** é sempre até o fim de **ontem**: o dia de hoje entra no realizado e tem a meta do dia à parte (`hoje`).
- `referencia` traz a fase (`antes`, `durante`, `encerrada`), o dia N de `duracao_dias`, os dias restantes (contando hoje) e o período atual. Não tem valores, por isso também vai para as rotas abertas.
- Os schemas das quatro respostas são **estritos**: um campo a mais invalida a resposta.

Exemplos abaixo: a campanha do PUT (10/7/7 dias com 35/25/45, 10 bilhetes por pessoa) com as três células fictícias da importação (12, 9 e 15 pessoas: meta 360), consultada em 04/12/2026 às 15:30 de Belém (dia 12 de 24, 2º dia da Semana 2).

### `GET /api/painel/resumo` (`coordenacao`)

- **Consulta** (`consultaPainelResumoSchema`):
  - `escopo` = `campanha` (padrão), `divisao`, `rede`, `discipulador` ou `celula`;
  - `id`: obrigatório nos escopos rede, discipulador e célula;
  - `divisao`: obrigatória no escopo divisão;
  - `data` (`YYYY-MM-DD`, no máximo hoje): padrão hoje no fuso da campanha. Com data passada, o retrato é o do fim daquele dia.
- A rota resolve o escopo antes de chamar a função: confere se o `id` existe (`404 nao_encontrado`, senão) e passa `{ tipo, id, divisao, nome }`. Na campanha, `nome` é o da campanha e `divisao` é null; na divisão, `nome` é `NOMES_DIVISAO[divisao]`; nos outros, o nome da entidade e a divisão da rede dela.
- **200** (`respostaPainelResumoSchema`):

```json
{
  "escopo": { "tipo": "campanha", "id": null, "divisao": null, "nome": "Rifa Videira Kids" },
  "referencia": {
    "data": "2026-12-04", "fase": "durante", "data_inicio": "2026-11-23", "data_fim": "2026-12-16",
    "duracao_dias": 24, "dia_campanha": 12, "dias_restantes": 13, "dias_para_inicio": null,
    "periodo": {
      "ordem": 2, "nome": "Semana 2", "data_inicio": "2026-12-03", "data_fim": "2026-12-09",
      "dias": 7, "dia_no_periodo": 2, "dias_restantes": 6
    }
  },
  "unidade": "bilhetes",
  "hoje": { "data": "2026-12-04", "meta": 11, "meta_base": 12, "realizado": 5, "falta": 6, "percentual_meta_bp": 4545, "batida": false },
  "periodo": {
    "meta": 86, "esperado": 13, "realizado": 14, "realizado_ate_ontem": 9, "diferenca": 1, "situacao": "em_dia",
    "percentual_meta_bp": 1633, "percentual_esperado_bp": 1428, "ritmo_bp": 7350
  },
  "campanha": {
    "meta": 360, "esperado": 133, "realizado": 139, "realizado_ate_ontem": 134, "diferenca": 6, "situacao": "em_dia",
    "percentual_meta_bp": 3861, "percentual_esperado_bp": 3673, "ritmo_bp": 10132,
    "projecao": 364, "projecao_percentual_meta_bp": 10132
  },
  "curva": [
    { "dia": 11, "data": "2026-12-03", "esperado": 133, "realizado": 134, "realizado_no_dia": 9 },
    { "dia": 12, "data": "2026-12-04", "esperado": 145, "realizado": 139, "realizado_no_dia": 5 },
    { "dia": 13, "data": "2026-12-05", "esperado": 157, "realizado": null, "realizado_no_dia": null }
  ],
  "vendas": { "pedidos_aprovados": 54, "bilhetes": 139, "total_centavos": 278000 },
  "vendas_sem_celula": { "pedidos_aprovados": 1, "bilhetes": 3, "total_centavos": 6000 },
  "vendas_fora_da_janela": {
    "antes_do_inicio": { "pedidos_aprovados": 1, "bilhetes": 1, "total_centavos": 2000 },
    "depois_do_fim": { "pedidos_aprovados": 0, "bilhetes": 0, "total_centavos": 0 }
  },
  "atualizado_em": "2026-12-04T18:30:00.000Z"
}
```

(A `curva` tem um ponto por dia da campanha, 24 aqui; o exemplo mostra os dias 11 a 13.)

| Campo | Conteúdo |
|---|---|
| `hoje` | Só durante a campanha. `meta` = esperado até o fim de hoje − realizado até ontem, nunca negativa (aqui, 12 da curva − 1 que sobrou); `meta_base` = só a parte da curva; `falta`, `percentual_meta_bp` (null com meta zero) e `batida` |
| `periodo` | Período atual, só durante a campanha: meta do período, esperado até ontem dentro dele, realizado e situação. Aqui a semana fechou ontem abaixo (9 de 13, ritmo 73,5%), e as 5 vendas de hoje já a deixaram em dia |
| `campanha` | Do 1º dia até agora. `situacao`: `em_dia` (realizado ≥ esperado), `abaixo` ou `sem_meta`; `ritmo_bp` = realizado até ontem ÷ esperado; `projecao` = onde termina no ritmo dos dias fechados (null antes do início e no 1º dia; depois do fim, o resultado) |
| `curva` | Para o gráfico: esperado e realizado acumulados ao fim de cada dia; `realizado` null nos dias depois da data de referência |
| `vendas` | Vendas aprovadas do escopo dentro da janela da campanha, até a data de referência. Na campanha, inclui as sem célula |
| `vendas_sem_celula` | Só no escopo campanha (null nos outros): sem afiliado ou com afiliado não vinculado; já estão em `vendas` |
| `vendas_fora_da_janela` | Só no escopo campanha: aprovadas antes do 1º dia (ex.: compra de teste na reunião de cadastro) ou depois do último. Não contam em nada |

- **Erros**: 400 `requisicao_invalida` (consulta fora do schema ou `data` futura), 401 `nao_autenticado`, 404 `nao_encontrado` (sem campanha ativa ou `id` inexistente).

### `GET /api/painel/ranking` (`coordenacao`, com valores)

- **Consulta** (`consultaRankingSchema`):
  - `nivel` = `celula` (padrão), `discipulador` ou `rede`;
  - `divisao` = `jovens` ou `adultos` (filtro: rankings separados). **Ignorada** quando a campanha não separa o ranking por divisão (`ranking.por_divisao: false`, D27): a resposta é o ranking de todas as células, com `divisao: null` e `por_divisao: false`;
  - `periodo` = `atual` (padrão: o período que contém a data; antes do início, o 1º; depois do fim, o último) ou `campanha` (do 1º dia até a data);
  - `data` (no máximo hoje): padrão hoje. Serve, por exemplo, para ver a Semana 2 fechada (`periodo=atual&data=<último dia dela>`).
- **200** (`respostaRankingSchema`): todas as instâncias do nível (e da divisão), inclusive as que não venderam, na ordem do ranking.

```json
{
  "nivel": "celula", "divisao": null,
  "janela": { "tipo": "atual", "ordem": 2, "nome": "Semana 2", "data_inicio": "2026-12-03", "data_fim": "2026-12-09" },
  "criterio": "percentual_meta", "unidade": "bilhetes",
  "referencia": { "data": "2026-12-04", "fase": "durante", "...": "igual ao do resumo" },
  "itens": [
    {
      "posicao": 1, "id": 1, "nome": "Célula Ficticia 01", "divisao": "jovens",
      "discipulador": { "id": 1, "nome": "Discipulador Ficticio A" }, "rede": { "id": 1, "nome": "Rede Jovem Ficticia" },
      "meta": 29, "esperado": 5, "realizado": 7, "diferenca": 2, "situacao": "em_dia", "percentual_meta_bp": 2450,
      "vendas": { "pedidos_aprovados": 3, "bilhetes": 7, "total_centavos": 14000 },
      "acima": null,
      "abaixo": { "id": 3, "nome": "Célula Ficticia 03", "posicao": 2, "diferenca": 1050 }
    },
    {
      "posicao": 2, "id": 3, "nome": "Célula Ficticia 03", "divisao": "adultos",
      "discipulador": { "id": 2, "nome": "Discipulador Ficticio B" }, "rede": { "id": 2, "nome": "Rede Adulta Ficticia" },
      "meta": 36, "esperado": 6, "realizado": 5, "diferenca": -1, "situacao": "abaixo", "percentual_meta_bp": 1400,
      "vendas": { "pedidos_aprovados": 2, "bilhetes": 5, "total_centavos": 10000 },
      "acima": { "id": 1, "nome": "Célula Ficticia 01", "posicao": 1, "diferenca": 1050 },
      "abaixo": { "id": 2, "nome": "Célula Ficticia 02", "posicao": 3, "diferenca": 467 }
    },
    {
      "posicao": 3, "id": 2, "nome": "Célula Ficticia 02", "divisao": "jovens",
      "discipulador": { "id": 1, "nome": "Discipulador Ficticio A" }, "rede": { "id": 1, "nome": "Rede Jovem Ficticia" },
      "meta": 22, "esperado": 4, "realizado": 2, "diferenca": -2, "situacao": "abaixo", "percentual_meta_bp": 933,
      "vendas": { "pedidos_aprovados": 1, "bilhetes": 2, "total_centavos": 4000 },
      "acima": { "id": 3, "nome": "Célula Ficticia 03", "posicao": 2, "diferenca": 467 },
      "abaixo": null
    }
  ],
  "atualizado_em": "2026-12-04T18:30:00.000Z"
}
```

(No exemplo, `referencia` foi encurtada; a resposta traz o objeto inteiro, igual ao do resumo.)

- **Ordem** pelo critério configurado (`ranking.criterio`): `percentual_meta` (realizado na janela ÷ meta na janela), `bilhetes` ou `arrecadacao`. Empates dividem a posição (1, 1, 3) e seguem o nome. No critério % da meta, quem está sem meta vai para o fim.
- `meta`, `esperado`, `realizado`, `diferenca`, `situacao` e `percentual_meta_bp` são da janela; `vendas` são os totais aprovados na janela.
- `discipulador` só no nível célula; `rede` nos níveis célula e discipulador.
- `por_divisao` (D27): **só aparece**, com `false`, quando a campanha não separa o ranking por divisão; ausente, a resposta é a de sempre.
- `acima` e `abaixo`: o vizinho na posição anterior e na seguinte (empatados não são vizinhos), com a distância no critério (pontos-base, bilhetes ou centavos; null se um dos dois está sem meta).
- **Erros**: 400 `requisicao_invalida`, 401 `nao_autenticado`, 404 `nao_encontrado` (sem campanha ativa).

### `GET /api/publico/ranking` (aberto, **sem nenhum valor em R$**)

> Cache: respostas 200 desta rota ficam 30 s em cache no servidor e saem com `Cache-Control: public, max-age=30`
> (erros saem com `no-store`). Ver docs/decisions.md D10.

- **Consulta** (`consultaRankingPublicoSchema`): `nivel`, `divisao` e `periodo`, como no painel, **sem** `data` (é sempre hoje; um `data` na URL é ignorado).
- **200** (`respostaRankingPublicoSchema`):

```json
{
  "nivel": "celula", "divisao": null,
  "janela": { "tipo": "atual", "ordem": 2, "nome": "Semana 2", "data_inicio": "2026-12-03", "data_fim": "2026-12-09" },
  "criterio": "percentual_meta",
  "referencia": {
    "data": "2026-12-04", "fase": "durante", "data_inicio": "2026-11-23", "data_fim": "2026-12-16",
    "duracao_dias": 24, "dia_campanha": 12, "dias_restantes": 13, "dias_para_inicio": null,
    "periodo": {
      "ordem": 2, "nome": "Semana 2", "data_inicio": "2026-12-03", "data_fim": "2026-12-09",
      "dias": 7, "dia_no_periodo": 2, "dias_restantes": 6
    }
  },
  "itens": [
    { "posicao": 1, "nome": "Célula Ficticia 01", "divisao": "jovens" },
    { "posicao": 2, "nome": "Célula Ficticia 03", "divisao": "adultos" },
    { "posicao": 3, "nome": "Célula Ficticia 02", "divisao": "jovens" }
  ],
  "atualizado_em": "2026-12-04T18:30:00.000Z"
}
```

- Mesma ordem e mesmas posições do ranking da coordenação, mas só com quem **já vendeu** na janela e com `posicao` até `publico.limite_ranking` (padrão 3; null = todas). Quem empata na última posição entra (1, 2, 3, 3). Antes da primeira venda, `itens` vem vazio.
- `percentual_meta_bp` só aparece se `publico.mostra_percentual_meta = true`.
- `por_divisao: false` (D27) só aparece quando a campanha não separa o ranking por divisão: a `divisao` da consulta é ignorada e vem o ranking de todas as células (`divisao: null`). O site pede as duas divisões na 1ª consulta e já recebe a lista única.
- Nunca valores em unidades, R$ ou bilhetes, com qualquer configuração: não aparecem centavos, bilhetes, meta, esperado, realizado, diferença ou projeção. O teste de `api.test.ts` confere que os campos das rotas abertas estão numa lista fechada.
- **Erros**: 400 `requisicao_invalida`, 404 `nao_encontrado` (sem campanha ativa).

### `GET /api/publico/bumbo` (aberto)

> Cache: respostas 200 desta rota ficam 30 s em cache no servidor e saem com `Cache-Control: public, max-age=30`
> (erros saem com `no-store`). Ver docs/decisions.md D10.

- **Consulta** (`consultaBumboSchema`): `data` (dia da mensagem); padrão hoje. A mensagem fala sempre do dia anterior, já fechado.
  - **Sem `data`**, é a mensagem de hoje, em qualquer fase: antes do início, a contagem regressiva; depois do fim, o resultado final.
  - **Com `data`**, só na **janela da campanha**: do 1º dia ao dia seguinte ao último (`DIAS_DO_BUMBO_DEPOIS_DO_FIM` = 1; no dia seguinte ao fim, a mensagem ainda traz a venda do último dia, e dali em diante o texto não muda mais), e no máximo hoje. Fora da janela, `400 requisicao_invalida` com a mensagem da janela e `detalhes` = `[{ "caminho": ["data"], "codigo": "fora_da_campanha", "mensagem": "A data precisa estar entre 23/11/2026 e 17/12/2026 (do 1º dia da campanha ao dia seguinte ao último)" }]` (datas do exemplo). Na janela, mas depois de hoje: `data_futura`.
  - A janela é conferida com a campanha ativa **antes** de ler as vendas (um comando pequeno a mais, só nas consultas com `data` que não estão no cache) e o 400 não entra no cache: só as datas com mensagem (algumas dezenas) viram chaves do cache, e uma data qualquer não lê os pedidos nem tira do cache as respostas guardadas.
- **200** (`respostaBumboSchema`): `{ "data", "referencia", "texto", "gerado_em" }`, com `referencia` do dia da mensagem (o mesmo objeto das outras rotas). Para o exemplo, `texto` é:

```text
*Rifa Videira Kids · Dia 12 de 24*

*Ontem (dia 11):* vendemos 112% da meta do dia.
*Acumulado:* 37% da meta. Pela curva, o esperado até ontem era 36%.
Estamos em dia: no ritmo atual, chegamos a 101% da meta.

*Ranking · Semana 2 (até ontem)*
_Jovens_
1º Célula Ficticia 01
_Adultos_
1º Célula Ficticia 03

*Quem mais subiu ontem:* Célula Ficticia 01 e Célula Ficticia 03.

Faltam 13 dias. Bora manter o ritmo: compartilhe hoje o seu link de afiliado com quem é de fora da igreja!
```

- Partes: venda de ontem (% da meta do dia), acumulado contra a curva e projeção, top 3 do período por divisão (como no ranking público: só quem vendeu, nunca mais posições que `publico.limite_ranking`), as 3 células que mais subiram ontem (em % da própria meta) e a chamada final. Antes do início, no 1º dia, no último dia e depois do fim, o texto muda (contagem regressiva, largada, último dia e resultado final).
- Cada divisão lista no máximo 5 células (`NOMES_POR_DIVISAO_NO_BUMBO`); as demais empatadas viram a linha "e mais N empatadas no Pº lugar".
- Sem ranking por divisão (`ranking.por_divisao: false`, D27), um ranking só, de todas as células, sem `_Jovens_`/`_Adultos_` (como já era quando só uma divisão tem células).
- **Nunca contém R$, centavos nem quantidade de bilhetes**, com qualquer configuração (R9). Os % (da meta, da curva e da projeção) aparecem; % por célula só se `publico.mostra_percentual_meta`. Um bumbo interno da coordenação, com bilhetes, é pendência ([regras-de-calculo.md, seção 6](regras-de-calculo.md#6-pendências)).
- Sempre cabe em 4000 caracteres (o pior caso, com 72 células empatadas e nomes de 120 caracteres, dá 2436), com o *negrito* e o _itálico_ do WhatsApp.
- **Erros**: 400 `requisicao_invalida` (`data` fora do formato, fora da janela da campanha ou futura), 404 `nao_encontrado` (sem campanha ativa).

---

## Visão individual e acessos da hierarquia (Sprint 5, RIFA-014; docs/decisions.md D12)

Contrato: `respostaVisaoIndividualSchema` e `ROTAS.visaoIndividual` em `api.ts`; papéis, `alvo` da sessão e
`ROTAS_ACESSO_HIERARQUIA` em `acesso.ts`.

### `GET /api/minha/visao?periodo=atual|campanha` (`hierarquia`)

- Papéis `lider`, `discipulador` e `rede`. Sem sessão: 401 em todo caminho de `/api/minha/*`, exista a rota ou
  não. Sessão da coordenação: 403. Não aceita id de nada: o alvo é o da sessão (`usuarios.celula_id`,
  `discipulador_id` ou `rede_id`); id na consulta, nos cabeçalhos ou no corpo é ignorado (a consulta só tem
  `periodo`; um POST não chega a rota nenhuma, 404).
- Devolve o alvo, quem entrou, a referência da campanha, os números do alvo (hoje, período e campanha, mais os
  bilhetes vendidos), a curva em pontos-base da meta, a posição no ranking do nível (geral e na divisão, com o
  nome e a posição do vizinho de cima e do de baixo), os primeiros da divisão (como o ranking público) e, para
  discipulador e rede, os números da `equipe` (quem está abaixo). O líder recebe `afiliados_vinculados` da célula.
- Os números são os do painel da coordenação para o mesmo escopo (`montarResumoPainel` e `montarRankingPainel`,
  com as metas sobre todas as células); a curva usa a meta exata, então o ponto de hoje é o
  `percentual_meta_bp` da campanha. Com meta em centavos, os bilhetes de hoje saem somados das vendas do dia.
- Sem ranking por divisão (`ranking.por_divisao: false`, D27), `ranking.por_divisao` vem `false`, `ranking.divisao`
  igual a `ranking.geral` (o schema confere), os primeiros são os do ranking de todos e a `posicao_divisao` da equipe é
  a posição entre todos. Com a opção ligada, o campo não aparece.
- `equipe`: do discipulador, as células dele por nome; da rede, os discipuladores dela por nome (inclusive os sem
  células), cada um seguido das células dele por nome (ordem de português: "Célula 2" antes de "Célula 10").
  `posicao_divisao` é a posição no ranking do nível do item, na divisão e na janela pedidas.
- **Sem dinheiro em nenhum nível** (schemas estritos e regras cruzadas): com meta em centavos, as quantidades da
  meta saem null; no critério arrecadação, nenhuma distância. A distância até os vizinhos (`diferenca`) sai null
  até o PO decidir (D12). A rota confere a resposta no schema estrito antes de sair: um campo a mais vira 500.
- Alvo sem células (R8): `ranking.geral` e `ranking.divisao` null; na equipe, `posicao_divisao` null.
- `periodo` escolhe a janela do ranking (padrão: o período atual); fora de `atual` e `campanha`, 400.
- Sem campanha ativa: 404 `nao_encontrado`, como o painel.
- Acesso do papel desligado na campanha (`acesso.discipuladores` ou `acesso.redes`, D20): 403 `acesso_desligado`
  com `{ "papel" }` em todo `/api/minha/*`, exista a rota ou não, para o discipulador ou a rede (o líder não tem
  chave). A sessão não é apagada: volta a valer quando a chave volta. A chave é lida na hora (sem o cache da base).
- Cache: a resposta é por pessoa e sai com `Cache-Control: no-store`, nunca guardada. Os dados de base (a
  campanha, as células, as vendas por dia, os discipuladores, as redes e os afiliados por célula) ficam até 30 s
  na memória do isolate, como as rotas abertas (D10). O alvo de quem pede vem da sessão, lido na hora: se a base
  guardada não tem esse alvo, ou o tem noutra divisão (uma célula criada depois dela; a rede que trocou de divisão;
  a célula ou o discipulador que foi para outra divisão), ela é lida de novo. Para as outras pessoas, cujo alvo não
  mudou, a hierarquia (quem está em qual equipe, nomes, rankings) pode aparecer até 30 s atrasada. Por requisição:
  a sessão e, sem a base guardada, a campanha e um lote no D1 (o orçamento do painel, ~1,3 linha lida por pedido).

### `GET /api/admin/acessos-hierarquia?papel=lider|discipulador|rede` (**só admin**)

Todos os alvos do papel, com ou sem acesso: o alvo, quem deve receber o link (`pessoa_nome`, da hierarquia), o
telefone do líder (só células) e o usuário do alvo (nome, ativo, sessões e links, sem token), ou null. Ordem: pelo
caminho na hierarquia (nome da rede, do discipulador e da célula, em ordem de português; empate, pelo id). Papel
fora dos três da hierarquia: 400.

### `POST /api/admin/acessos-hierarquia/links` (**só admin**)

`{ "papel", "ids": [...], "revogar_anteriores"?: false }` → **201** `{ "itens": [...] }`, um link NOVO por alvo,
na ordem de `ids`, com a URL (a única vez em que ela aparece). Cria o usuário do alvo quando falta e atualiza o
nome dele para o `pessoa_nome` atual (sem ele, o nome do alvo). `revogar_anteriores: true` revoga os links válidos
anteriores e encerra as sessões abertas por eles no mesmo lote. Tudo ou nada: 404 `nao_encontrado` se algum id não
é alvo do papel, 409 `em_uso` se algum alvo tem usuário desativado (`detalhes`: `detalhesIdsRecusadosSchema`,
`{ "ids": [...] }`, em ordem crescente; o 404 é conferido antes do 409). Uma linha na trilha de auditoria por
chamada (ação `acessos_hierarquia.gerar_links`, alvo `papel:<papel>`, resumo sem nomes, como "Links novos para 2
células (1 acesso criado); links anteriores revogados e as sessões deles encerradas. Ids: 3, 5"). Corpo fora do
schema (ids repetidos, vazios, mais de 200, papel da coordenação, campo a mais): 400. Papel `discipulador` ou `rede`
com o acesso desligado na campanha (D20): 409 `acao_desligada` com `{ "chave": "acesso.discipuladores" }` (ou
`acesso.redes`), antes de conferir os ids; o mesmo vale para o link avulso (`POST /api/admin/usuarios/:id/links`)
de um usuário desses papéis.

## Mapa de vendas por DDD (Sprint 5, RIFA-015; docs/decisions.md D17)

### `GET /api/painel/mapa-ddd?periodo=campanha|atual&divisao=jovens|adultos` (`coordenacao`)

Pedidos aprovados da janela (padrão: a campanha até hoje), agrupados por UF e por DDD (tabela fixa em
`src/shared/contracts/ddd.ts`), mais `exterior` (`pais` gravado e diferente de 55), `sem_ddd` (`pais` null, Brasil
sem DDD ou DDD fora da tabela) e `total` (= ufs + exterior + sem_ddd). Cada recorte traz `pedidos_aprovados`, `bilhetes`,
`total_centavos` e a parte dos bilhetes em pontos-base truncados (a soma pode ficar abaixo de 10000). A venda conta pela regra do
painel (R6 de [regras-de-calculo.md](regras-de-calculo.md)): campanha ativa, dia local de `aprovado_em` dentro da
janela (`janela`, a mesma dos rankings). Com `divisao`, só as vendas das células da divisão (as sem célula ficam de
fora, como no painel). Só a coordenação; a versão aberta depende do PO.

- **Janela**: do primeiro dia dela até hoje, no fuso da campanha (como o realizado do painel e dos rankings, os
  dias depois de hoje não entram); antes do primeiro dia, nada conta. Sem venda no recorte: `ufs` e `ddds` vazios
  e os recortes zerados, com parte 0.
- **Custo no D1** (D10, D17; `src/worker/db/mapa-ddd-desempenho.test.ts`, com 7 mil pedidos): duas idas (a
  campanha ativa e a consulta agregada), pelo índice `(status, aprovado_em)` só na janela, com o plano travado.
  ~2 linhas lidas por pedido aprovado da janela (10.925 na campanha inteira, 3.939 numa semana); com divisão, ~1,5
  (8.172 com jovens na campanha inteira, 2.796 com adultos numa semana).
- **Erros**: 400 `requisicao_invalida`, 401 `nao_autenticado`, 403 `proibido` (papéis da hierarquia), 404
  `nao_encontrado` (sem campanha ativa).

## Relatório da campanha para baixar (RIFA-038; docs/decisions.md D23)

### `GET /api/painel/relatorio?tipo=totais|celulas|discipuladores|redes|periodos|dias|ddd` (`coordenacao`)

Uma planilha por tipo, para guardar, prestar contas e mostrar o resultado, a qualquer momento e no fim da campanha.
Admin e coordenação (sem `papeis`; a hierarquia leva 403 pelo prefixo). No catálogo `ROTAS_RELATORIO` de `api.ts` (à
parte de `ROTAS` até a API montá-la, como `ROTAS_REGRAS_CAMPANHA`; já conferido pelo `src/worker/protecao.test.ts`).

- **Consulta** (`consultaRelatorioSchema`): `tipo` **obrigatório**, um de `TIPOS_RELATORIO`. Sem `data`: é sempre o
  retrato de agora (hoje no fuso da campanha); depois do fim, o resultado final.
- **200**: o CSV (`respostaRelatorioCsvSchema`: texto que começa pelo BOM), com os cabeçalhos de
  `cabecalhosDoRelatorio(tipo, data)`:

```http
Content-Type: text/csv; charset=utf-8
Content-Disposition: attachment; filename="rifa-videira-kids-celulas-2026-12-04.csv"
Cache-Control: no-store
```

- **Formato** (`relatorio.ts`): UTF-8 com BOM, `;` entre as colunas, CRLF no fim de cada linha (também da última), a
  primeira linha é o cabeçalho (`cabecalhoDoRelatorio(tipo, unidade)`); aspas só com `;`, aspas, quebra de linha ou
  espaço nas pontas. Quantidades só com dígitos (`1234`); R$ com vírgula e 2 casas, sem "R$" e sem milhar
  (`2780,00`); percentuais com 2 casas, sem "%" (`38,61`; sem meta, vazio); datas `AAAA-MM-DD`. Texto que começa
  como fórmula (`=`, `+`, `-`, `@`, tabulação…) ganha um apóstrofo na frente (`'=1+1`). Abre com dois cliques no
  Excel em português; no Google Planilhas, por Arquivo → Importar.
- **Tipos e colunas** (`COLUNAS_RELATORIO`, na ordem; a meta sai como "Meta (bilhetes)" ou "Meta (R$)", conforme a
  unidade da meta da campanha):

| `tipo` | Linhas | Colunas |
|---|---|---|
| `totais` | uma | Campanha; Data de referência; Situação da campanha; Início; Fim; Meta; Pedidos aprovados; Bilhetes; Arrecadação (R$); % da meta; Pedidos sem célula; Bilhetes sem célula; Arrecadação sem célula (R$); Pedidos fora das datas da campanha; Bilhetes fora das datas da campanha; Arrecadação fora das datas da campanha (R$); Pedidos desconsiderados; Critério do ranking |
| `celulas` | uma por célula, por divisão (jovens, depois adultos) e na ordem do ranking da divisão | Divisão; Rede; Discipulador; Célula; Líder; Meta; Pedidos aprovados; Bilhetes; Arrecadação (R$); % da meta; Posição na divisão |
| `discipuladores` | uma por discipulador com célula, como acima | Divisão; Rede; Discipulador; Meta; Pedidos aprovados; Bilhetes; Arrecadação (R$); % da meta; Posição na divisão |
| `redes` | uma por rede com célula, como acima | Divisão; Rede; Meta; Pedidos aprovados; Bilhetes; Arrecadação (R$); % da meta; Posição na divisão |
| `periodos` | uma por período já começado | Período; Início; Fim; Pedidos aprovados; Bilhetes; Arrecadação (R$) |
| `dias` | uma por dia, do 1º até hoje (ou o último) | Data; Dia da campanha; Período; Pedidos aprovados; Bilhetes; Arrecadação (R$) |
| `ddd` | uma por DDD com venda, mais "Exterior" e "Sem DDD" | UF; DDD; Pedidos aprovados; Bilhetes; Arrecadação (R$); % dos bilhetes |

- Mesmas regras e mesmos números do painel, dos rankings e do mapa (as mesmas leituras e os mesmos montadores; a
  fonte de cada coluna está na D23): só pedidos aprovados que contam, na janela da campanha até hoje (R6); os
  **desconsiderados** (D20) não contam em nada, e só o número deles aparece nos totais. A posição é a do ranking da
  divisão na campanha inteira, pelo critério configurado (empates dividem a posição). As contas fecham: períodos =
  dias = totais; células + sem célula = totais; DDD (com Exterior e Sem DDD) = totais.
- **Nada pessoal**: do comprador, só o DDD agregado; do líder, só o nome (nunca telefone nem e-mail); nenhum id de
  pedido, de afiliado ou de usuário.
- **Custo no D1** (D10, D23): duas idas por download (a campanha e um lote), sem cache. Os tipos do painel leem ~1,3
  linha por pedido aprovado (~9 mil com 7 mil pedidos), mais ~36 em `celulas` (os líderes) e ~1 por desconsiderado
  em `totais`; o `ddd` lê ~2 por pedido aprovado (~11 mil), como o mapa.
- **Erros** (JSON, com `no-store`): 400 `requisicao_invalida` (`tipo` ausente ou fora da lista), 401
  `nao_autenticado`, 403 `proibido` (papéis da hierarquia), 404 `nao_encontrado` (sem campanha ativa).

## Pedidos e entregas do webhook (Sprint 5, RIFA-025; docs/decisions.md D16)

Só leitura, na área da coordenação (admin e coordenacao). Nenhum dado pessoal: do comprador, só o DDD.

### `GET /api/admin/pedidos` (`coordenacao`)

Pedidos da campanha ativa, do registrado mais novo para o mais antigo. Consulta: `limite` (1 a 200, padrão 50),
`antes_de` (cursor opaco, o `proximo` da página anterior; inválido dá 400), `status`, `celula_id` ou
`sem_celula=true` (não os dois) e `id` (busca exata). Cada item traz status, bilhetes, total em centavos,
afiliado, a célula resolvida na leitura (D7, `celula_id` e `celula_nome`), DDD, os instantes, `suspeito`,
`desconsiderado` (D20) e `origem` (`webhook` ou `conferencia`: recuperado na conferência pelo CSV, D19). `totais` traz pedidos, bilhetes e centavos por status com os mesmos filtros, menos a
paginação e os filtros de status e de desconsiderado, só na primeira página (null quando a consulta traz
`antes_de`). Sem campanha ativa: lista vazia e totais zerados.

- **Desconsiderados** (D20): `desconsiderado` é null quando o pedido conta e `{ "motivo", "observacao", "em" }`
  quando o admin o tirou das contas (motivo `teste`, `fraude`, `estorno` ou `outro`; quem fez fica só na trilha).
  O filtro `desconsiderado=true` traz só eles e `desconsiderado=false`, só os que contam; outro valor dá 400. Os
  `totais` por status contam só os que contam: um aprovado desconsiderado aparece na lista, mas não nos totais.

- **Ordem e cursor**: `registrado_em` decrescente e, no empate, `id` decrescente (comparação binária). O cursor é
  o base64url (sem `=`) do JSON `[registrado_em, id]` do último item; a página seguinte começa logo depois dele,
  sem repetir nem pular pedidos, mesmo que um pedido novo chegue ou um pedido mude de status entre as páginas
  (`registrado_em` não muda). Cursor que a API não emitiu (texto qualquer, JSON fora da forma, instante sem
  milissegundos, id vazio ou com mais de 128 caracteres, forma não canônica): 400 `requisicao_invalida`,
  "Consulta inválida", com o detalhe `{ caminho: ["antes_de"], codigo: "cursor_invalido" }`.
- **Sem célula**: sem afiliado ou com afiliado ainda não vinculado. **`id`**: exato (maiúsculas contam), sem os
  espaços das pontas; só acha pedido da campanha ativa e respeita os outros filtros.
- **Custo no D1** (D10, D16; `src/worker/db/pedidos-webhook-desempenho.test.ts`, com 7 mil pedidos): a página
  lê ~135 linhas (~142 com o cursor); os totais sem filtro, ~1 por pedido (~7 mil), e por isso saem só na
  primeira página. Com célula, ~3 linhas por pedido da célula; sem célula, ~2,5 por pedido sem célula.

### `GET /api/admin/webhook/entregas` (`coordenacao`)

Cada entrega autenticada do webhook, da mais nova para a mais antiga: quando chegou, evento, pedido, slug,
resultado e transição de status. Do erro (só em `erro_validacao`) saem o código da recusa (`json_invalido`,
`payload_invalido` ou `corpo_muito_grande`) e os problemas; dos avisos, a lista. Problemas e avisos saem reduzidos
a campo (caminho do schema), código e ocorrências: a mensagem gravada não sai. Consulta: `limite`, `antes_de`
(id), `resultado` e `pedido_id`.

- **Ordem e cursor**: `id` decrescente; `proximo` é o id do último item (null quando não há mais). `pedido_id`:
  exato, sem os espaços das pontas.
- **Código da recusa**: `json_invalido` ou `corpo_muito_grande` quando o erro gravado é esse único problema, de
  caminho vazio (é como o webhook grava as duas recusas do corpo); senão `payload_invalido`.
- **Redução**: `campo` = as partes do caminho juntadas com `.`, com `*` nas posições de lista
  (`numbers.*`, `buyer.email`; vazio quando o problema é do corpo inteiro). Uma parte que não tenha a forma de
  um nome de campo vira `?`, e um código fora da forma do vocabulário (minúsculas, dígitos e `_`) vira
  `codigo_desconhecido`: nada do que veio na entrega pode sair por ali. Itens com o mesmo campo e código somam
  as `ocorrencias`. Erro gravado sem nenhum item aproveitável: um problema com o próprio código da recusa.
- **Custo no D1**: ~51 linhas por página, com ou sem `resultado` e cursor (índice da migração 0007).

### `GET /api/admin/webhook/estado` (`coordenacao`)

`situacao` (na ordem de prioridade: `erros_recentes`, `sem_entregas_recentes`, `nunca_recebeu` ou `ok`; regra na
D16), a última entrega, a última entrega da campanha, a última aprovação e a contagem das últimas 24 h por
resultado.

- **Limites exatos**: as últimas 24 h vão de `agora − 24 h` (inclusive) até agora. A janela do alerta é
  `HORA_INICIO_ALERTA ≤ hora local < HORA_FIM_ALERTA` no fuso da campanha, nos dias de `data_inicio` a `data_fim`
  (inclusive), e acende quando `agora − max(última entrega da campanha, hoje às HORA_INICIO_ALERTA)` passa de
  `HORAS_SEM_ENTREGA_ALERTA` horas (às 12:00:00.000 em ponto do 1º dia sem nada, ainda não; 1 ms depois, sim).
- **Slug do erro**: comparado sem os espaços das pontas que o `trim()` do JavaScript tira (os mesmos do slug
  aceito pelo webhook, inclusive tabulação, quebra de linha e espaço não separável). Slug só de espaços conta
  como ausente. Sem campanha ativa, só o erro sem slug acende `erros_recentes`.
- `ultima_entrega_em` e `ultima_processada_em` são o maior `recebido_em`; `ultimo_aprovado_em`, o maior
  `aprovado_em` dos pedidos aprovados da campanha ativa; `verificado_em`, o instante da consulta.
- **Custo no D1**: duas idas (a campanha ativa e um lote), ~940 linhas lidas com ~1 mil entregas nas últimas
  24 h (a contagem por resultado é quase tudo), também com o slug da campanha trocado depois de entregas
  processadas (a última entrega da campanha sai do índice parcial da migração 0007).

## Regras da campanha (Sprint 6; docs/decisions.md D20)

Rotas **só de admin**, no catálogo `ROTAS_REGRAS_CAMPANHA` de `api.ts` (à parte de `ROTAS` até a API montá-las:
o teste de proteção exige o 403 da coordenação, que uma rota ainda não montada não dá). As chaves ficam na
campanha (`pedidos`, `acesso` e `mensagens`, no [PUT da campanha](#get-apiadmincampanha-e-put-apiadmincampanha-coordenacao)).

### `POST /api/admin/pedidos/desconsiderar` e `POST /api/admin/pedidos/reconsiderar` (**só admin**; RIFA-028)

Tira um pedido de TODAS as contas (metas, ritmo, rankings, painel, `/minha`, mapa, bumbo, telão, público, adesão e
totais do afiliado) por teste, fraude ou estorno, ou o devolve a elas. A Rifei não manda estorno nem cancelamento
(só `new_order`, `paid_order` e `expired_order`), por isso o caminho é manual.

- **Corpo** (`corpoDesconsiderarPedidoSchema`): `{ "pedido_id": "PEDTESTE0001", "motivo": "teste", "observacao": "compra de teste na reunião" }`.
  - `pedido_id`: o id da Rifei, sem os espaços das pontas (vai no corpo, não na URL).
  - `motivo`: `teste`, `fraude`, `estorno` ou `outro`.
  - `observacao` (opcional): até 140 caracteres, sem os espaços das pontas; vazia ou ausente = null. Sem dado
    pessoal: um "@" ou 8 dígitos seguidos (telefone, CPF) dão 400.
  - Reconsiderar (`corpoReconsiderarPedidoSchema`): `{ "pedido_id": "PEDTESTE0001" }`.
- **200**: o pedido como um item de `GET /api/admin/pedidos` (`itemPedidoSchema`), com `desconsiderado` preenchido
  (ou null, depois de reconsiderar).
- Qualquer status da campanha ativa: um pedido de teste ainda não pago também sai, e o pagamento que chegar depois
  não o devolve às contas (o webhook nunca mexe na desconsideração). Ele continua na lista de pedidos, com o selo,
  na de suspeitos e na trilha.
- **Repetir não muda nada**: desconsiderar o que já está desconsiderado e reconsiderar o que conta devolvem 200 com
  o pedido como está (o motivo e a data da primeira vez), sem linha na trilha. Para trocar o motivo, reconsidere e
  desconsidere de novo.
- **Erros**: primeiro o login, antes de ler o corpo (401 sem sessão; 403 `proibido` da coordenação); depois, nesta
  ordem: 400 `requisicao_invalida` (corpo); 404 `nao_encontrado` sem campanha ativa; 409 `acao_desligada` com
  `{ "chave": "pedidos.desconsiderar" }` quando a chave está desligada (desligar a chave não devolve às contas o que
  já foi desconsiderado: só bloqueia as duas ações); 404 `nao_encontrado` quando o pedido não é da campanha ativa.
- Trilha: `pedido.desconsiderar` e `pedido.reconsiderar`, no mesmo lote da gravação. A mudança aparece nas rotas
  abertas e na visão individual em até 30 s (os caches da D10 e da D14), como uma venda nova.

### `DELETE /api/admin/afiliados/:affiliateId` (**só admin**; RIFA-031)

Remove um afiliado de teste, vinculado ou não. **204**.

- Só se nenhum pedido dele conta, de qualquer status e de qualquer campanha: todos desconsiderados (ou nenhum
  pedido). Senão, 409 `afiliado_com_pedidos` com `{ "pedidos_que_contam": 3, "pedidos": ["PED3", "PED2", "PED1"] }`
  (os ids dos mais recentes, até 20, na ordem da lista de pedidos, para achar na lista e desconsiderar). Um pedido
  que conta noutra campanha não se desconsidera daqui: esse afiliado não é de teste e fica. A `mensagem` separa os
  dois casos (RIFA-040): com todos os que contam na campanha ativa, "O afiliado tem 3 pedidos que contam:
  desconsidere os pedidos (teste) na tela Pedidos antes de remover"; com algum fora dela (de outra campanha, ou sem
  campanha ativa), "O afiliado tem 3 pedidos que contam, 1 fora da campanha ativa: pedido fora da campanha ativa não
  se desconsidera daqui, então este afiliado não é de teste e não pode ser removido". Os `detalhes` não separam (o
  site mostra a lista e explica os dois casos).
- Os pedidos desconsiderados dele ficam sem afiliado (a chave estrangeira não deixa apagar um afiliado com pedido),
  no mesmo lote; a trilha (`afiliado.remover`) guarda o affiliate_id, a célula e quantos eram.
- Se a Rifei mandar depois um pedido com esse `affiliate_id`, ele volta como não vinculado (D7). Não depende de
  chave na campanha.
- **Erros**: primeiro o login (401; 403 da coordenação, só no DELETE: o `PUT` do mesmo caminho continua da
  coordenação); depois 400 (`:affiliateId` não é inteiro positivo), 404 `nao_encontrado` (o afiliado não existe) e
  409 `afiliado_com_pedidos`.

---

## Token do webhook da Rifei (RIFA-039; docs/decisions.md D21)

Rotas **só de admin**, no catálogo `ROTAS_TOKEN_WEBHOOK` de `api.ts` (à parte de `ROTAS` até a API montá-las, como
`ROTAS_REGRAS_CAMPANHA`). O admin gera o token no site e cola direto na Rifei (menu do usuário → Integrações → Outro
→ Adicionar), sem Node nem wrangler. O "só admin" vale só para estas duas: as entregas e o estado do webhook
(`/api/admin/webhook/entregas` e `/estado`) continuam da coordenação.

**Qual credencial vale** (`credencialVigenteDoWebhook`): **o token da tela tem prioridade**. Com ele, só ele vale e o
segredo do Worker `RIFEI_WEBHOOK_TOKEN` é ignorado; sem ele, vale o segredo (como antes); sem nenhum dos dois, o
webhook responde 503 `nao_configurado`. Gerar de novo substitui o anterior, que para de valer na requisição seguinte
em todos os servidores (o webhook não guarda o token em cache).

### `GET /api/admin/webhook/token` (**só admin**)

**200** (`estadoTokenWebhookSchema`, estrito; **nunca traz o token nem o hash**):

```json
{
  "vigente": "tela", "gerado_em": "2026-11-12T10:00:00.000Z", "ultimo_uso_em": "2026-11-12T10:05:00.000Z",
  "segredo_configurado": false, "url": "https://rifa-videira-kids.madruga.workers.dev/api/webhooks/rifei"
}
```

- `vigente`: `tela`, `segredo` ou null (nenhuma credencial: o webhook responde 503). O schema confere a coerência:
  `tela` se e somente se há `gerado_em`; `segredo` só com `segredo_configurado`.
- `gerado_em`: quando o token da tela foi gerado (null sem ele).
- `ultimo_uso_em` (`ultimoUsoDoWebhook`): a última entrega autenticada (`webhook_eventos`, qualquer resultado,
  inclusive as recusadas pelo corpo; 401, 503 e 500 não são gravados). Com o token da tela, só a recebida em ou
  depois de `gerado_em`: null quer dizer que a Rifei ainda não mandou nada com o token novo (foi colado? houve
  pedido?). Com o segredo, a última entrega. Calculado na leitura: o webhook não escreve nada a mais.
- `segredo_configurado`: o segredo `RIFEI_WEBHOOK_TOKEN` existe no Worker (não vazio). Com o token da tela, ele não
  vale; a tela pode dizer isso.
- `url`: para colar no campo "URL" do webhook na Rifei, com a origem da requisição (como as URLs dos links de acesso).
- **Custo no D1**: a linha do token (1) e a última entrega (~8 linhas, `ULTIMA_ENTREGA` de `db/estado-webhook.ts`).
- **Erros**: 401, 403 (`coordenacao` e os papéis da hierarquia).

### `POST /api/admin/webhook/token` (**só admin**)

- **Corpo** (`corpoGerarTokenWebhookSchema`): `{}` ou `{ "substituir": true }` (padrão false; outro campo dá 400).
- **201** (`respostaGerarTokenWebhookSchema`): a **única** vez em que o token aparece.

```json
{
  "token": "<64 caracteres hex>",
  "estado": { "vigente": "tela", "gerado_em": "2026-11-12T10:00:00.000Z", "ultimo_uso_em": null,
              "segredo_configurado": false, "url": "https://rifa-videira-kids.madruga.workers.dev/api/webhooks/rifei" }
}
```

- O token tem 32 bytes aleatórios em hex minúsculo (`FORMATO_TOKEN_WEBHOOK`, 64 caracteres, só letras e números). No
  banco fica só o SHA-256 (`token_webhook`, migração 0009). O site mostra uma vez, com "Copiar", e não guarda.
- **Com credencial vigente** (o token da tela ou o segredo do Worker) e sem `substituir: true`: **409 `em_uso`** com
  `{ "vigente": "tela" | "segredo" }` (`detalhesTokenWebhookEmUsoSchema`), e nada muda. A tela pede a confirmação:
  o anterior para de valer na hora, e as entregas recebem 401 (e se perdem) até o token novo ser colado na Rifei.
  Também é a resposta quando outra aba gerou um token no meio. Sem credencial vigente, `substituir` não importa.
- **Erros**: primeiro o login (401 sem sessão; 403 da coordenação, da hierarquia e de outra origem); depois 400
  `json_invalido` (corpo que não é JSON) ou `requisicao_invalida` (corpo fora do formato) e 409 `em_uso`.
- Trilha: `webhook.gerar_token`, no mesmo lote da gravação, sem o token nem o hash.

---

## Link de vendas e QR code de cada célula (RIFA-046; docs/decisions.md D24)

A venda só conta para uma célula quando é feita na Rifei pelo **link de afiliado** do líder (o pedido chega com o
`affiliate_id`, ligado à célula na Adesão; D7 da integração). Pix mandado direto para uma chave, fora da Rifei, não
entra no sistema. Estas rotas dão a cada célula esse link pronto e a tela gera o QR code dele no navegador.

O formato do link de afiliado da Rifei NÃO está documentado ([integracao-rifei.md, 12.3](integracao-rifei.md#123-afiliados-programa-da-campanha-e-líderes)):
o link sai de um **modelo** que só o admin grava, vazio até o PO confirmar o formato, com os marcadores `{slug}` (o
`slug_rifei` da campanha ativa, codificado) e `{afiliado}` (o `affiliate_id`, obrigatório). Ex. (o formato real ainda
é desconhecido): `https://rifei.com.br/{slug}?afiliado={afiliado}` → `https://rifei.com.br/videira-kids?afiliado=1042`.

Rotas no catálogo `ROTAS_LINK_VENDAS` de `api.ts` (à parte de `ROTAS` até a API montá-las, como
`ROTAS_REGRAS_CAMPANHA`). Sem campanha ativa: 404 `nao_encontrado` nas três. Sem cache: mudar o modelo ou vincular um
afiliado vale na hora. Custo no D1: um lote com a campanha, as células do escopo e os afiliados delas (nenhum pedido).

**O modelo** (`problemasDoModeloLinkVendas`, `link-vendas.ts`; mensagens em português, que a tela mostra e o 400 traz):

- começa exatamente por `https://rifei.com.br/` (`HOSTS_LINK_VENDAS`): sem `www.`, subdomínio, porta, usuário ou
  maiúsculas, e os marcadores só depois da barra, então nenhum valor muda o site de destino;
- depois do endereço, nenhum outro: nada de `//`, `\` ou `www.` (ex.: `https://rifei.com.br//golpe.example/...` ou
  `?volta=https://...`);
- sem espaço, tabulação, quebra de linha ou caractere invisível; só `{slug}` e `{afiliado}`, com o `{afiliado}`
  obrigatório; nenhuma chave solta; até 300 caracteres.

**O link** (`montarLinkDeVendas`): o modelo preenchido numa passada só, na forma canônica (`URL.href`) e conferido de
novo (`eLinkDeVendas`: `https:`, `rifei.com.br`, sem usuário, senha nem porta). Os schemas das respostas recusam
qualquer `url` fora disso.

### `GET /api/minha/links-vendas` (`hierarquia`)

Papéis `lider`, `discipulador` e `rede`. O alvo vem **só da sessão** (a rota não aceita id; um id na consulta é
ignorado). **200** (`respostaMeusLinksVendasSchema`, estrito):

```json
{
  "alvo": { "tipo": "celula", "id": 3, "nome": "Célula Ficticia 03", "divisao": "jovens" },
  "configurado": true,
  "itens": [
    {
      "celula_id": 3, "celula_nome": "Célula Ficticia 03", "lider_nome": "Lider Ficticio 03",
      "discipulador_id": 2, "discipulador_nome": "Discipulador Ficticio B",
      "rede_id": 1, "rede_nome": "Rede Jovem Ficticia", "divisao": "jovens",
      "links": [{ "affiliate_id": 1042, "url": "https://rifei.com.br/videira-kids?afiliado=1042" }]
    }
  ]
}
```

- Escopo (o da visão individual, D12; o schema confere): o líder recebe a célula dele (sempre uma); o discipulador, as
  células dele; a rede, as células dos discipuladores dela. Ordem: rede, discipulador e célula, em ordem de português.
- `configurado`: o modelo da campanha serve para montar os links. False (vazio ou gravado com problema): nenhuma
  célula tem link, e a tela diz que a coordenação ainda não liberou o link.
- `links`: um por afiliado vinculado à célula, do vínculo mais recente para o mais antigo; todos contam para a célula,
  e a tela destaca o primeiro. Vazia: a célula ainda não tem afiliado vinculado.
- Nada de dinheiro, número de venda, telefone, e-mail ou o `rotulo` do afiliado; nem o modelo.
- **Erros**: 401; 403 `proibido` (coordenação); 403 `acesso_desligado` (discipulador ou rede com o acesso do papel
  desligado na campanha, D20); 404 (sem campanha ativa).

### `GET /api/admin/links-vendas` (`coordenacao`)

Admin e coordenação, para a tela Adesão. **200** (`respostaLinksVendasSchema`, estrito): `{ "modelo", "configurado",
"itens" }`, com `modelo` como está gravado (ou null) e **todas** as células, no mesmo formato da `/minha` (a sem
afiliado, com `links` vazia), na mesma ordem. **Erros**: 401; 403 (hierarquia); 404.

### `PUT /api/admin/links-vendas/modelo` (**só admin**)

- **Corpo** (`corpoSalvarModeloLinkVendasSchema`): `{ "modelo": "https://rifei.com.br/{slug}?afiliado={afiliado}" }`, ou
  `{ "modelo": null }` para apagar (vazio também apaga). `modelo` é obrigatório; outro campo dá 400.
- **200**: a lista do GET, já montada com o modelo novo.
- **Erros**: primeiro o login (401 sem sessão; 403 da coordenação, da hierarquia e de outra origem, antes de ler o
  corpo); depois 400 `json_invalido` (corpo que não é JSON, ou sem `Content-Type: application/json`) ou
  `requisicao_invalida` (fora do schema; os problemas do modelo vêm nos `detalhes`, em português, ex.: "O link de vendas
  começa com https://rifei.com.br/, o endereço da Rifei."); 404 sem campanha ativa.
- Guardado em `campanhas.link_vendas_modelo` (migração 0010); o `PUT /api/admin/campanha` não mexe nele. Trilha:
  `campanha.salvar`, alvo `campanha:<id>`, com o antes e o depois do modelo; o mesmo modelo de novo responde 200 e não
  registra.

**O QR code** é gerado no navegador, sem rede, a partir do `url`: correção M (`NIVEL_CORRECAO_QR_LINK_VENDAS`), margem
de 4 módulos (`MARGEM_QR_LINK_VENDAS_MODULOS`), preto no branco; a imagem para baixar se chama
`nomeDoArquivoQrLinkVendas(celula_nome)` (ex.: `link-de-vendas-celula-agape.png`).

---

## API interna da Rifei (RIFA-070; docs/decisions.md D28)

Rotas **só de admin** (o "só admin" vai no handler, antes do corpo: a coordenação leva 403). Todas chamam a Rifei pela
API interna do painel (`https://api.rifei.com.br/`) com o segredo do Worker `RIFEI_API_TOKEN`. Catálogo:
`ROTAS_RIFEI_API` (`src/shared/contracts/api.ts`); regras, limites e textos em `src/shared/contracts/rifei-api.ts`.

Erros comuns: 401 sem sessão; 403 da coordenação, da hierarquia ou de outra origem; 503 `nao_configurado` sem o segredo
(nada é chamado na Rifei); 502 `rifei_falhou` com `detalhes: { motivo }` (`token_invalido`, `campanha_nao_encontrada`,
`indisponivel`, `resposta_inesperada`). O token nunca aparece em resposta, trilha ou log.

### `POST /api/admin/rifei/marcar-pagos` (**só admin**)

Corpo: `{ "pedidos": ["<id>", ...] }` (1 a 100, sem repetidos). 404 sem campanha ativa. 200:

```json
{
  "itens": [
    { "pedido_id": "PEDIDO1", "resultado": "marcado", "mensagem": null },
    { "pedido_id": "PEDIDO2", "resultado": "restaurado_e_marcado", "mensagem": null },
    { "pedido_id": "PEDIDO3", "resultado": "ja_pago", "mensagem": null },
    { "pedido_id": "PEDIDO4", "resultado": "recusado_pela_rifei", "mensagem": "Mensagem da Rifei" }
  ],
  "marcados": 2
}
```

Resultados: `marcado`, `restaurado_e_marcado`, `ja_pago`, `desconsiderado`, `fora_do_sistema` (decididos pelo banco,
sem chamar a Rifei nos três últimos), `recusado_pela_rifei` e `falhou`. Nada é gravado no pedido: ele conta quando o
"Pedido pago" chegar pelo webhook. Trilha `rifei.marcar_pagos` (alvo `campanha:<id>`) quando algum pedido foi à Rifei.

### `GET /api/admin/rifei/afiliados` (**só admin**)

200: `{ afiliados, celulas_sem_afiliado, sincronizacao: null }`. Cada afiliado: `affiliate_id`, `codigo` (o `ref` do
link de vendas), `nome` e `email` da conta de afiliado na Rifei, `celula` (o vínculo no sistema) e `sugestao` (a célula
cujo líder tem o mesmo e-mail, só para o não vinculado e só com exatamente uma). Só lê.

### `POST /api/admin/rifei/afiliados/sincronizar` (**só admin**)

Corpo `{}`. Grava o código de cada afiliado (e cria, sem célula, o que o sistema não conhecia) e vincula as sugestões.
Nunca troca um vínculo existente. 200: a mesma resposta do GET, com `sincronizacao: { vinculados, codigos_gravados }`.
Trilha `rifei.sincronizar_afiliados` (alvo `rifei`) quando algo mudou.

### `POST /api/admin/rifei/convites` (**só admin**)

Corpo: `{ "celulas": [3, 4] }` (1 a 50, sem repetidas). 404 `nao_encontrado` se uma célula não existe (nada é chamado
na Rifei). 201: `{ convites: [{ celula_id, celula_nome, lider_nome, lider_telefone, link }], falhas: [{ celula_id,
mensagem }] }`. O link é da Rifei (`https://*.rifei.com.br`), de uso único e válido por 1 dia; nunca é gravado. Trilha
`rifei.gerar_convites` (alvo `rifei`, sem os links) quando algum convite saiu.

## Conferência pelo CSV da Rifei (Sprint 4, RIFA-012)

Rede de segurança para venda perdida: a Rifei não tem API de leitura nem reenvio documentado do webhook. A coordenação exporta os pedidos na Rifei ("Exportar Pedidos", CSV), escolhe o arquivo em `/coordenacao/conferencia`, vê as diferenças e recupera as vendas que faltarem; o admin também marca como pagos os pedidos cujo pagamento não chegou (RIFA-056). Passo a passo, formatos e o que ainda falta confirmar: [integracao-rifei.md, seção 10](integracao-rifei.md#10-conferência-pelo-csv-exportar-pedidos-rifa-012).

**O CSV é lido no navegador** (ciclo 2: ler o arquivo no Worker gastava de 50 a 375 ms de CPU por requisição; D19). A tela lê o arquivo, reconhece as colunas pelo nome, mostra o mapeamento para a coordenação conferir e manda à API só o **corpo compacto**: as colunas mapeadas que não são de dado pessoal, já normalizadas. Leitura e mapeamento: `src/shared/conferencia/` (sem zod; `leitura.ts`, `colunas.ts`, `valores.ts`, `avisos.ts`). Corpo e validador: `src/shared/contracts/conferencia.ts`. Comparação: `src/worker/lib/conferencia-analise.ts`; banco: `src/worker/db/reconciliacao.ts`.

**Privacidade (D1).** Nome, e-mail, telefone e as demais colunas de dado pessoal (reconhecidas pelo nome: nome, e-mail, telefone, contato, CPF, documento, nascimento, endereço, observação, comprador, cliente, participante, pagador...; também o telefone, o e-mail ou o CPF do afiliado) **nem saem do navegador**: não podem ser mapeadas, e a API recusa um corpo com uma coluna de nome pessoal mapeada (400 `coluna_pessoal`). Os números dos bilhetes também ficam no navegador (vai só a contagem). Do arquivo, a auditoria guarda o SHA-256 do texto (calculado no navegador) e os nomes das colunas usadas. As respostas só trazem códigos de pedido validados, status normalizados, quantidades, centavos, dias e ids de afiliado; nada do corpo vai para o log.

**Corpo compacto** (`CorpoConferencia`; validador leve `validarCorpoConferencia`, sem zod item a item). Linhas iguais nas colunas mapeadas viram uma posição só (no "Um bilhete por linha", as linhas de um pedido costumam ser iguais), e `vezes` diz quantas linhas cada posição representa. Cada lista tem uma posição por item de `vezes`; `null` é célula vazia ou ilegível; um campo sem coluna fica fora do corpo e com `colunas[campo]` null.

| Chave | Conteúdo |
|---|---|
| `colunas` | o nome da coluna do arquivo de cada campo (`pedido_id`, `status`, `qtd_bilhetes`, `bilhetes`, `valor`, `afiliado`, `data`), ou null |
| `linhas` | linhas de dados do arquivo (até 50.000, `LIMITE_LINHAS_CSV_RECONCILIACAO`): a soma de `vezes` |
| `arquivo_sha256` | SHA-256 (hex) do texto do arquivo |
| `vezes` | quantas linhas iguais cada posição representa (1 ou mais) |
| `pedido_id` | código do pedido (o `id` do webhook): letras, números e `. _ : / # -`, começando por letra ou número (`FORMATO_ID_PEDIDO_RECONCILIACAO`) |
| `status` | `aprovado`, `pendente`, `expirado`, `cancelado` ou `desconhecido` |
| `qtd_bilhetes` | quantidade da coluna da quantidade |
| `numeros` | quantos números de bilhete a célula da coluna `bilhetes` tem (os números não vão) |
| `valor` | centavos |
| `afiliado` | o `affiliate_id`, o usuário do afiliado na Rifei já normalizado (sem acento, minúsculo, sem `@`; comparado com o `rotulo` cadastrado), `null` (sem afiliado) ou `false` (ilegível) |
| `dia` e `instante` | o dia do pagamento ("YYYY-MM-DD") no fuso da campanha e, quando o arquivo tem a hora, o instante (ms, UTC). A tela pede o fuso em `GET /api/admin/campanha` |

Teto: o corpo vai até **1 MiB** (`LIMITE_CORPO_CONFERENCIA_BYTES`), uns 15 mil pedidos com códigos curtos (7 mil pedidos dão ~430 KB). A tela confere antes de mandar e pede um período menor; acima disso, 413 `corpo_muito_grande` sem ler o resto (com o `Content-Length`, decidido pelo cabeçalho; sem ele, a leitura para logo depois do teto). O teto geral das escritas (`middleware/limite-corpo.ts`) deixa estas rotas de fora para o corpo ser lido uma vez só.

### `POST /api/admin/reconciliacao/analisar` (`coordenacao`)

- **Corpo**: o corpo compacto (`corpoAnalisarReconciliacaoSchema`).
- **200** (`respostaAnaliseReconciliacaoSchema`, estrito): `modo` = `por_pedido` (com a coluna `pedido_id`) ou `agregado`. Os dois trazem `arquivo` (`linhas`, `linhas_ignoradas`, `um_bilhete_por_linha`, `data_inicio`, `data_fim`), `avisos` da comparação (`[{ codigo, mensagem, quantidade }]`, sem valores do arquivo; os da leitura, como colunas pessoais ou células ilegíveis, a tela monta e junta) e `conferido_em`.
- **Por pedido.** As posições com o mesmo código são o mesmo pedido: status, afiliado ou dia diferentes deixam o pedido fora da comparação (aviso `pedido_inconsistente`); quantidades iguais em todas as linhas contam uma vez (pelo menos uma por linha), diferentes somam. **Valor de um pedido em várias linhas**: valores diferentes somam; com o **mesmo valor `v` em todas as linhas**, vale a convenção dos pedidos do arquivo que já estão pagos no sistema (se a maioria, e pelo menos 2, tem o total `v × linhas`, cada linha é um bilhete; se tem `v`, cada linha repete o pedido: avisos `valor_por_bilhete` e `valor_do_pedido_repetido`); sem convenção, `v` até o preço do bilhete e no máximo 50% abaixo dele (`TOLERANCIA_DESCONTO_BP`) é o valor de um bilhete (total `v × linhas`); outro `v` é **ambíguo** (`total_centavos` null, observação `valor_ambiguo`, não pode ser recuperado; aviso `valor_ambiguo`). Uma linha só com o valor e as outras sem: é o do pedido.
- **Trava do código** (`codigo: { confere, pagos_no_arquivo, encontrados }`): com pelo menos 5 pedidos pagos no arquivo (`MINIMO_CODIGOS_PARA_CONFERIR`; conta o código com alguma linha paga, mesmo inconsistente) e menos da metade deles no sistema (em qualquer campanha), a coluna escolhida como código provavelmente não é o código da Rifei: `confere: false`, aviso `codigo_nao_confere` (que também diz: se a coluna está certa e o webhook parou, exporte um período que inclua dias com vendas já no sistema) e nenhuma venda perdida é recuperável (observação `codigo_nao_confere`). Exceção: se o sistema tem pelo menos 5 pagos no período do arquivo e a maioria deles está no arquivo, a coluna é a certa (o webhook é que parou).
- A comparação é com os pedidos da campanha ativa:

| `tipo` | Quando | Lados |
|---|---|---|
| `venda_perdida` | pago no arquivo e ausente no sistema: não conta no painel nem no ranking | arquivo; `recuperavel` e `observacoes` (`sem_quantidade`, `sem_valor`, `valor_ambiguo`, `data_no_futuro`, `codigo_nao_confere`) |
| `pagamento_nao_registrado` | pago no arquivo; no sistema `in_process` ou `expired` (o `paid_order` não chegou) | os dois; `recuperavel` e `observacoes` (RIFA-056: as da venda perdida e `quantidade_diferente`, `valor_diferente` e `afiliado_diferente`, quando o arquivo não confirma o pedido gravado; o afiliado sem a coluna ou não reconhecido não compara) |
| `nao_pago_na_rifei` | pago no sistema; no arquivo pendente, expirado ou cancelado | os dois |
| `ausente_no_arquivo` | pago no sistema e ausente no arquivo (arquivo parcial, compra de teste) | sistema; `fora_do_periodo_do_arquivo` quando é de um dia que o arquivo não cobre |
| `valor_diferente`, `quantidade_diferente`, `afiliado_diferente` | pago nos dois lados, com valor, quantidade ou afiliado diferentes (um pedido pode estar em mais de um) | os dois |

  `divergencias` traz os sete tipos, sempre nessa ordem, cada um com `quantidade`, as somas de cada lado (`bilhetes`, `total_centavos`; no lado do arquivo, também `sem_quantidade` e `sem_valor`) e até 500 `itens` (`LIMITE_ITENS_POR_DIVERGENCIA`; `itens_omitidos` conta o resto). O lado do arquivo traz status, quantidade, centavos, a situação do afiliado, o `affiliate_id`, a célula e o dia; o do sistema, também `aprovado_em` e `origem` (`webhook` ou `conferencia`). `resumo`: `pedidos_no_arquivo`, `aprovados_no_arquivo` e `aprovados_no_sistema` (pedidos, bilhetes e centavos), `conferem`, `com_divergencia` e `ausentes_fora_do_periodo` (os pagos do sistema de dias que o arquivo não cobre: listados em `ausente_no_arquivo`, mas à parte, sem somar em `com_divergencia`). Um código que existe no sistema em outra campanha fica de fora (aviso `pedido_de_outra_campanha`).
- **Pedido desconsiderado** (RIFA-028, [D20](decisions.md#d20-regras-do-admin-na-campanha-desconsiderar-pedido-acesso-da-hierarquia-remover-afiliado-e-mensagens-rifa-028-029-031-e-032-contrato-2026-11-11)): o pedido do arquivo que o sistema tem desconsiderado não entra em nenhum dos sete tipos nem é "faltando": vai para `desconsiderados` (`grupoDesconsideradosSchema`: `quantidade`, até 500 `itens` com `pedido_id`, `arquivo`, `sistema` e `desconsiderado`, e `itens_omitidos`). `aprovados_no_sistema` e o lado do sistema no agregado contam só os pedidos que contam, como o painel. O "Recuperar" nunca grava de novo um desconsiderado (`ja_existe`).
- **Quantidade desconhecida não vira 0 bilhete, nem valor desconhecido R$ 0.** Nos totais do arquivo (`aprovados_no_arquivo`, o `total` e as linhas do agregado e a soma do lado do arquivo de cada tipo), `bilhetes` e `total_centavos` somam só o que é legível; `sem_quantidade` conta os pedidos pagos (no agregado, as linhas pagas) sem quantidade (vazia ou ilegível, e sem os números dos bilhetes) e `sem_valor`, os sem valor ou com valor ambíguo. A tela mostra "21 bilhetes (+1 sem quantidade) · R$ 120,00 (+1 sem valor)". Sem a coluna, a soma é `null` (e a contagem é 0). Pedido a pedido, a quantidade que falta não é comparada (nada de `quantidade_diferente`), como o valor; no agregado, uma linha com `sem_quantidade` ou `sem_valor` > 0 não confere nos bilhetes ou no valor: o total do arquivo é desconhecido.
- **Agregado** (sem a coluna do código). Compara os totais pagos (pedidos, bilhetes e centavos) no `total`, `por_afiliado` (os diferentes primeiro: `afiliado`, `sem_afiliado` ou `nao_reconhecido`, com a célula) e `por_dia`. Com datas no arquivo, o sistema conta só os pagos desses dias (`recorte`). O que o arquivo não permite contar sai `null` e fica fora do `confere`: sem a quantidade, a quantidade de pedidos (uma linha pode ser um bilhete; aviso `sem_contagem_de_pedidos`); um bilhete por linha sem o código, os pedidos e o valor. O banco soma (GROUP BY); o dia do sistema é o do deslocamento do fuso no fim do período (exato nos fusos do Brasil).
- **Erros**: 400 `json_invalido` (não é JSON ou veio sem `Content-Type` JSON; mensagem fixa); 400 `requisicao_invalida` (fora do formato: `detalhes` = `[{ "caminho": ["valor", 3], "codigo": "invalid_value", "mensagem": "Use centavos inteiros, até R$ 10.000.000,00" }]`, até 20 e um item final com o resto; coluna de nome pessoal: `[{ "caminho": ["colunas", "afiliado"], "codigo": "coluna_pessoal", "mensagem": "A coluna \"Telefone do afiliado\" tem dados pessoais e não pode ser usada" }]`); 401; 403; 404 `nao_encontrado` (sem campanha ativa); 413 `corpo_muito_grande`.

Exemplo de corpo (o arquivo do cenário dos testes, duas posições):

```json
{
  "colunas": { "pedido_id": "Pedido", "status": "Status", "qtd_bilhetes": "Quantidade de bilhetes", "bilhetes": "Bilhetes", "valor": "Valor", "afiliado": "Afiliado", "data": "Data do pagamento" },
  "linhas": 2,
  "arquivo_sha256": "9f2c…",
  "vezes": [1, 1],
  "pedido_id": ["R-0101", "R-0102"],
  "status": ["aprovado", "aprovado"],
  "qtd_bilhetes": [3, 2],
  "numeros": [3, 2],
  "valor": [6000, 4000],
  "afiliado": [101, "lider.betel"],
  "dia": ["2026-11-27", "2026-11-28"],
  "instante": [1795784400000, null]
}
```

Exemplo resumido de resposta (por pedido; `divergencias` traz os sete tipos, aqui só um):

```json
{
  "modo": "por_pedido",
  "arquivo": { "linhas": 17, "linhas_ignoradas": 2, "um_bilhete_por_linha": false, "data_inicio": "2026-11-24", "data_fim": "2026-12-05" },
  "avisos": [
    { "codigo": "status_desconhecido", "mensagem": "1 pedido com um status que o sistema não reconhece (nem pago, nem pendente, expirado ou cancelado): não conta como venda paga.", "quantidade": 1 }
  ],
  "conferido_em": "2026-12-01T15:00:00.000Z",
  "codigo": { "confere": true, "pagos_no_arquivo": 11, "encontrados": 6 },
  "resumo": {
    "pedidos_no_arquivo": 15,
    "aprovados_no_arquivo": { "pedidos_aprovados": 10, "bilhetes": 22, "sem_quantidade": 0, "total_centavos": 41000, "sem_valor": 1 },
    "aprovados_no_sistema": { "pedidos_aprovados": 7, "bilhetes": 15, "total_centavos": 30000 },
    "conferem": 1,
    "com_divergencia": 11,
    "ausentes_fora_do_periodo": 1
  },
  "divergencias": [
    {
      "tipo": "venda_perdida", "quantidade": 5,
      "arquivo": { "bilhetes": 9, "sem_quantidade": 0, "total_centavos": 16000, "sem_valor": 1 }, "sistema": { "bilhetes": 0, "total_centavos": 0 },
      "itens": [
        {
          "pedido_id": "R-0101",
          "arquivo": {
            "status": "aprovado", "qtd_bilhetes": 3, "total_centavos": 6000, "afiliado": "reconhecido",
            "affiliate_id": 101, "celula": { "id": 1, "nome": "Célula Ágape" }, "data": "2026-11-27"
          },
          "sistema": null, "recuperavel": true, "observacoes": []
        }
      ],
      "itens_omitidos": 0
    }
  ]
}
```

### `POST /api/admin/reconciliacao/recuperar` (`coordenacao`)

Grava como **aprovadas** as vendas perdidas escolhidas, com os dados do arquivo, e (só o admin, RIFA-056) marca como pagos os pagamentos não registrados escolhidos.

- **Corpo** (`corpoRecuperarReconciliacaoSchema`): o mesmo corpo compacto da análise (com a coluna `pedido_id`; 400 sem ela), mais `"pedidos": ["R-0101"]` (de 1 a 500, `LIMITE_PEDIDOS_RECUPERAR`) e `"simular": false`. `simular: true` é a prévia: nada é gravado. Não relê nenhum arquivo: aplica as mesmas regras da análise ao mesmo corpo, com o banco de agora.
- Com a trava do código (`codigo.confere: false`), 400 `requisicao_invalida` com o detalhe `{ "caminho": ["colunas", "pedido_id"], "codigo": "codigo_nao_confere" }`, e nada é gravado.
- Para cada código (sem repetir, na ordem pedida), entra só o pedido que está no arquivo, pago, sem linhas inconsistentes, com quantidade (pelo menos 1) e valor decidido, sem data no futuro, e que **não existe** no sistema (em nenhuma campanha). O resto vai para `nao_recuperados`, com o `motivo`: `ja_existe`, `nao_esta_no_arquivo`, `nao_aprovado_no_arquivo`, `inconsistente_no_arquivo`, `sem_quantidade`, `sem_valor`, `valor_ambiguo`, `data_no_futuro` ou, no pagamento não registrado, `quantidade_diferente`, `valor_diferente` ou `afiliado_diferente`.
- **Pagamento não registrado** (RIFA-056; [D19, adendo](decisions.md#adendo-rifa-056-2026-11-15-o-recuperar-do-admin-corrige-o-pagamento-não-registrado)), **só com a sessão do admin**: o pedido que já existe, da campanha ativa, pendente ou expirado e sem desconsideração, com as mesmas regras de quantidade, valor e data, e com a quantidade, o valor e o afiliado do arquivo iguais aos gravados, vira `approved` com o `aprovado_em` do arquivo (a mesma regra abaixo) e `pagamento_recuperacao_id` = a auditoria (migração 0011). Nada mais muda (`origem` continua `webhook`). Em `recuperados`, `tipo: "pagamento_nao_registrado"`, com a quantidade, o valor, o `affiliate_id` e a célula gravados. A gravação confere de novo, no mesmo lote, que o pedido ainda está assim; se não está (o `paid_order` chegou, foi desconsiderado, mudou), vai para `nao_recuperados` como `ja_existe`. Com a sessão da coordenação, o pendente é `ja_existe`, como antes. Um `paid_order` que chegue depois dá `duplicado`.
- O pedido entra com `status = 'approved'`, `origem = 'conferencia'`, o `recuperacao_id` da auditoria, a quantidade, os centavos, o afiliado e `aprovado_em`: o instante do arquivo (`origem_data: "arquivo"`); o meio-dia do dia quando o arquivo só tem o dia, ou agora, se for hoje (`dia_do_arquivo`); ou o instante da recuperação, sem data (`recuperacao`). `numeros`, DDD, país e `criado_em` ficam nulos (os números e o telefone não saem do navegador). Um `affiliate_id` desconhecido entra na fila de órfãos (origem `webhook`, como os do webhook); um afiliado não reconhecido grava a venda sem afiliado.
- O pedido recuperado conta no painel, nos rankings e no bumbo como qualquer venda aprovada. Um `paid_order` que chegue depois dá `duplicado` e não muda nada.
- **Plausibilidade** (RIFA-042, a mesma do webhook, D11): o pedido que entra com mais de 200 bilhetes, ou com o total acima de bilhetes × `preco_bilhete_centavos` da campanha ou abaixo disso além de 50%, continua contando e entra na lista de revisão `GET /api/admin/pedidos/suspeitos`, com os mesmos `motivos`. Só o que de fato entrou nesta gravação; a prévia não marca nada. A resposta e a trilha não mudam.
- **Atômico e idempotente**: um único `db.batch` (auditoria, afiliados novos, pedidos com `INSERT ... ON CONFLICT (id) DO NOTHING`, os pagamentos registrados com o `UPDATE` condicional, a marcação dos fora do padrão em `pedidos_suspeitos`, as contagens tiradas do que entrou e a linha da trilha de auditoria da coordenação, ação `conferencia.recuperar`, com a parte dos pagamentos registrados quando houver). Um pedido que já existe, inclusive um que o webhook gravou depois da prévia, nunca é sobrescrito; repetir não duplica nada nem cria outra auditoria.
- **200** (`respostaRecuperarReconciliacaoSchema`): `{ simulado, aplicado, recuperacao_id, recuperados: [{ pedido_id, tipo, qtd_bilhetes, total_centavos, afiliado, affiliate_id, celula, aprovado_em, origem_data }], nao_recuperados: [{ pedido_id, motivo }], totais: { pedidos_aprovados, bilhetes, total_centavos }, avisos }`. `tipo` (RIFA-056, `TIPOS_RECUPERACAO`): `venda_perdida` (entrou) ou `pagamento_nao_registrado` (virou pago). `aplicado` = gravou pelo menos um pedido; `recuperacao_id` = a linha da auditoria (null na simulação ou se nada entrou).
- **Erros**: os mesmos da análise, mais o da trava.

### `GET /api/admin/reconciliacao/recuperacoes` (`coordenacao`)

Auditoria das recuperações da **campanha ativa** (sem campanha ativa, a lista vem vazia), da mais recente para a mais antiga, em páginas como a auditoria.

- **Consulta** (`consultaListaRecuperacoesSchema`): `limite` (1 a 200, padrão 50) e `antes_de` (cursor: o `proximo` da página anterior); fora disso, 400 `requisicao_invalida`.
- **200** (`respostaListaRecuperacoesSchema`): `{ "itens": [{ id, executado_em, usuario: { id, nome }, pedidos_solicitados, pedidos_recuperados, bilhetes, total_centavos, linhas_arquivo, arquivo_sha256, colunas: { "pedido_id": "Pedido", ... }, pedidos: ["R-0005", "R-0101"], pagamentos_registrados: ["R-0005"] }], "proximo": 12 }` (`proximo` null = não há mais). `pedidos` traz todos os gravados; `pagamentos_registrados` (RIFA-056), os que eram pagamentos não registrados (os outros entraram como vendas perdidas); as contagens somam os dois. A tela mostra 50, a coluna **Tipo** e o botão "Carregar mais".

Só existe linha quando a recuperação gravou algo. Dados: tabela `recuperacoes` e as colunas `pedidos.origem` e `pedidos.recuperacao_id` (migração `0004_conferencia.sql`, aditiva) e `pedidos.pagamento_recuperacao_id` (migração `0011_pagamento_conferencia.sql`, aditiva, RIFA-056).

**CPU no Worker** (medida na revisão no workerd, com o app completo e o login): com 7 mil pedidos, 18 a 22 ms na 1ª requisição do isolate e 9 a 10 ms nas seguintes; no teto aceito (1 MiB), de 15 a 75 ms (eram 295–375 ms com o CSV lido no Worker). Passa dos 10 ms de CPU por requisição do plano gratuito da Cloudflare: a conferência **exige o Workers Paid** (decisão do PO; D19 e [lancamento.md](lancamento.md), 1.1 a). O banco devolve os pedidos com os códigos do arquivo num texto JSON único por lote (tuplas curtas) e os ausentes e totais já somados. `src/worker/routes/reconciliacao-desempenho.test.ts` mede só as rotas (sem o login; tempo da requisição menos a espera do D1) e aceita até 30 ms: não é o limite do plano, é a trava contra regressão grosseira (ler o CSV no Worker voltaria às centenas de ms).

---

## Uso dos schemas

No Worker, com `@hono/zod-validator` (verificado com hono 4.13.16, @hono/zod-validator 0.9.1 e zod 4.6.7):

```ts
import { zValidator } from "@hono/zod-validator";
import { ROTAS, criarErroApi, detalhesDeValidacao } from "../shared/contracts";

app.put(
  ROTAS.salvarCampanha.caminho,
  zValidator("json", ROTAS.salvarCampanha.corpo, (resultado, c) =>
    resultado.success
      ? undefined
      : c.json(
          criarErroApi(
            "requisicao_invalida",
            "Dados inválidos",
            detalhesDeValidacao(resultado.error),
          ),
          400,
        ),
  ),
  (c) => {
    const campanha = c.req.valid("json"); // tipada; fuso_horario e publico já com os padrões
    // ...
  },
);
```

JSON malformado ou corpo vazio não chegam ao hook: o validador do Hono lança `HTTPException` 400 (texto puro "Malformed JSON in request body"). O `app.onError` precisa responder a essa exceção com `400 json_invalido` no formato único, e não com `500 erro_interno`.

No front, use os mesmos caminhos (`ROTAS.listarRedes.caminho`) e os tipos (`Campanha`, `Celula`, `AfiliadoResumo`…). Para validar respostas em desenvolvimento, use `ROTAS.<rota>.sucesso.corpo.parse(json)`.
