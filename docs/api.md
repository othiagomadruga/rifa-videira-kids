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

Este documento explica o contrato. Se ele divergir dos schemas, valem os schemas, e a divergência é um bug que o SM corrige. Só o SM altera o contrato depois que ele estiver na `main`.

- **Detalhadas** (Sprints 1–3): fechadas. Front e back implementam em paralelo.
- **RASCUNHO** (Sprint 4): forma provável, que pode mudar quando forem implementadas.

## Convenções

- Base `/api`. Corpos em JSON UTF-8 (`Content-Type: application/json`). Respostas 204 vêm sem corpo.
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
| `rifei_bearer` | `/api/webhooks/*` | `Authorization: Bearer <RIFEI_WEBHOOK_TOKEN>`, comparado em tempo constante (D6). Não usa a sessão: o cookie não abre o webhook | `401 nao_autenticado`; segredo não configurado: `503 nao_configurado` |
| `coordenacao` | `/api/admin/*`, `/api/painel/*` e `GET /api/sessao` | sessão em cookie (`__Host-sessao`) aberta pelo link pessoal de cada pessoa da equipe ([acesso.md](acesso.md)), com as rotas `/api/sessao` (abaixo) | `401 nao_autenticado`: sem sessão válida; `403 proibido`: papel sem permissão ou escrita de outra origem |
| `hierarquia` | `/api/minha/*` (RIFA-014, D12) | a mesma sessão, aberta pelo link pessoal de um `lider`, `discipulador` ou `rede`; o alvo (célula, discipulador ou rede) vem **só da sessão** | `401 nao_autenticado`: sem sessão; `403 proibido`: sessão da coordenação. **Nunca devolve dinheiro** |
| `aberto` | `/api/health`, `/api/publico/*`, `POST /api/sessao` e `POST /api/sessao/sair` | nenhum (os dois POSTs, só da mesma origem) | **`/api/publico/*` nunca devolve valores em unidades: R$ ou bilhetes** |

Os schemas de `/api/publico/*` são **estritos** em todos os níveis: um campo a mais, como `total_centavos`, invalida a resposta. Os testes conferem que nenhum campo de valor (centavos, total, bilhetes, realizado…) existe nas respostas abertas e que todos os campos delas estão numa lista fechada.

**Coordenação** (RIFA-007; contrato em `acesso.ts`, detalhes em [acesso.md](acesso.md)):

- Cada pessoa recebe um link `<site>/acesso/<token>`. O site pede confirmação e faz `POST /api/sessao { "token" }`: **200** `{ "usuario": { "id", "nome", "papel" } }` com `Set-Cookie: __Host-sessao=...; HttpOnly; Secure; SameSite=Lax; Path=/`; nos papéis da hierarquia (RIFA-014), o usuário vem também com `"alvo": { "tipo", "id", "nome", "divisao" }`, lido da hierarquia na hora. Link inválido, expirado ou revogado: 401. A sessão vale até o menor entre 45 dias e o fim do link.
- `GET /api/sessao` diz quem está conectado (401 sem sessão). `POST /api/sessao/sair` encerra a sessão (204). O site não lê o cookie (HttpOnly).
- Papéis: `admin` faz tudo, inclusive usuários e links (`/api/admin/usuarios`, `/api/admin/links`, em `ROTAS_ACESSO`), os acessos da hierarquia (`/api/admin/acessos-hierarquia`, em `ROTAS_ACESSO_HIERARQUIA`) e a trilha de auditoria (`GET /api/admin/auditoria`, com `papeis: ["admin"]` em `ROTAS`); `coordenacao` faz o resto de `/api/admin/*` e `/api/painel/*` (nas rotas só de admin: 403). `lider`, `discipulador` e `rede` (RIFA-014) entram só em `/api/minha/*` e levam 403 em toda rota de `/api/admin/*` e `/api/painel/*`.
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
| `json_invalido` | 400 | corpo não é JSON (em `PUT /api/admin/campanha` e `PUT /api/admin/afiliados/:affiliateId`, também sem `Content-Type` JSON) |
| `payload_invalido` | 400 | webhook sem o essencial: `event`, `id`, `slug`, `numbers_count` ou `total` (ausente, inválido ou acima do limite) |
| `csv_invalido` | 400 | arquivo da importação que não dá para ler: vazio ou sem cabeçalho, sem coluna obrigatória, com coluna repetida, aspas abertas, fora de UTF-8, ou acima do limite de linhas ou de tamanho (`detalhes`: `detalhesCsvInvalidoSchema`, com o `motivo`) |
| `referencia_invalida` | 400 | `rede_id`, `discipulador_id` ou `celula_id` inexistente no corpo |
| `nao_autenticado` | 401 | sem credencial ou credencial inválida |
| `proibido` | 403 | autenticado, sem permissão; ou escrita de outra origem (CSRF) |
| `nao_encontrado` | 404 | recurso do caminho não existe (ou campanha ainda não configurada) |
| `nome_duplicado` | 409 | nome de rede, discipulador ou célula já usado; `slug_rifei` de outra campanha (`PUT /api/admin/campanha`) |
| `em_uso` | 409 | exclusão de rede com discipuladores, de discipulador com células ou de célula com afiliados; desativar o próprio acesso ou o último admin; revogar o último link válido de admin |
| `corpo_muito_grande` | 413 | corpo acima do limite (abaixo): do webhook (1 MiB, `LIMITE_CORPO_WEBHOOK_BYTES`), do `POST /api/sessao` (4 KiB) ou das escritas da coordenação (1 MiB) |
| `muitas_requisicoes` | 429 | passou do limite de requisições por IP (abaixo), com `Retry-After` em segundos |
| `erro_interno` | 500 | falha inesperada (ex.: banco) |
| `nao_configurado` | 503 | segredo do webhook ausente |
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
| `/api/admin/reconciliacao/*` (RIFA-012) | o da própria rota | o da própria rota (o teto geral não lê o corpo dela) |
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
- Não revela configuração, como a existência do segredo do webhook.

### `POST /api/webhooks/rifei` (`rifei_bearer`)

- Recebe o payload oficial da Rifei e o analisa com `analisarPayloadRifei` (RIFA-002b). Só recusa (400) quando falta o que torna o pedido gravável: `event` reconhecido, `id`, `slug`, `numbers_count` e `total`. O resto é tolerado: ausente ou com tipo errado vira null, e a diferença fica em `webhook_eventos.avisos`. Motivo: a Rifei não reenvia, e um 400 é venda perdida.
- O passo a passo completo está em [integracao-rifei.md](integracao-rifei.md#5-processamento-de-cada-entrega).
- O corpo é validado **dentro do handler**, com `analisarPayloadRifei`, e não por middleware: o erro precisa ser gravado antes da resposta 400, e os avisos precisam chegar ao evento.
- Caminho com ou sem barra no fim (`CAMINHOS_WEBHOOK_RIFEI`).
- **Limite de tamanho do corpo: 1 MiB** (`LIMITE_CORPO_WEBHOOK_BYTES`), conferido **depois** da autenticação. Acima disso, a resposta é **413** `corpo_muito_grande`, e o evento é gravado como `erro_validacao`, sem payload.
- `problemas` (no 400 e no 413) e `avisos` (no evento aceito) vêm agrupados por caminho sem índice, cada item com `ocorrencias`, no máximo 50 itens mais um item final `itens_omitidos` (`detalheResumidoSchema`).
- **Plausibilidade** (RIFA-013b): o evento que **aprova** um pedido com mais de `TETO_BILHETES_POR_PEDIDO` (200) bilhetes, ou com `total` acima de bilhetes × `preco_bilhete_centavos` da campanha ou abaixo disso além de `TOLERANCIA_DESCONTO_BP` (50% de desconto), **grava o pedido normalmente e ele conta nas vendas**. Os motivos (`MOTIVOS_PEDIDO_SUSPEITO`, um item por motivo, sem o valor recebido) vão para os `avisos` do evento e o pedido entra na lista de revisão `GET /api/admin/pedidos/suspeitos`. A resposta do webhook não muda (200 `processado`).

| Status | Corpo | Gravado em `webhook_eventos`? |
|---|---|---|
| **200** | `{ "resultado": "processado" \| "duplicado" \| "ignorado_outra_campanha" \| "ignorado_transicao", "evento_id": 123 }` | sim, depois de gravar (D9) |
| **400** `json_invalido` / `payload_invalido` | erro; `detalhes` = `{ "evento_id": 124, "problemas": [...] }` | sim, como `erro_validacao` (sem dado pessoal) |
| **413** `corpo_muito_grande` | erro; `detalhes` = `{ "evento_id": 125, "problemas": [...] }` | sim, como `erro_validacao`, sem payload |
| **401** `nao_autenticado` | erro | não |
| **503** `nao_configurado` | erro | não |
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
  "publico": { "mostra_percentual_meta": false, "limite_ranking": 3 }
}
```

- `fuso_horario` (padrão `America/Belem`) e `publico` (padrão `{ false, 3 }`) são opcionais.
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

`soma_percentuais_bp` diferente de 10000 é o sinal para a interface avisar.

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
  - célula com afiliado vinculado: `409 em_uso` (desvincule antes).
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

Lista de revisão dos pedidos aprovados que o webhook marcou como implausíveis (ver "Plausibilidade" no webhook). **Eles continuam contando** nas vendas, no painel e nos rankings: a lista é para a coordenação conferir na Rifei (ou pela conferência por CSV). Tirar um pedido das vendas é decisão do PO.

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

- `esperado_centavos` = bilhetes × preço do bilhete **no momento da marcação**; `celula_id`/`celula_nome` são da célula do afiliado agora (D7: é para ela que o pedido conta), null sem afiliado ou sem vínculo.
- `motivos[].codigo` ∈ `MOTIVOS_PEDIDO_SUSPEITO`: `quantidade_acima_do_teto` (mais de 200 bilhetes), `total_acima_do_esperado` (total maior que bilhetes × preço), `total_abaixo_do_esperado` (mais de 50% abaixo).
- **Sem nenhum dado do comprador**: nada de nome, e-mail, documento, telefone, DDD, país, UTM ou números dos bilhetes.
- Só o evento que aprova é avaliado (aprovado é final, D4): a reentrega (`duplicado`) não marca de novo. Guardado em `pedidos_suspeitos` (migração `0005_auditoria.sql`).

### `GET /api/admin/auditoria` (**só admin**; Sprint 4, RIFA-013b)

Trilha de quem mudou o quê. Cada linha é gravada no **mesmo lote** (transação do D1) da ação: se a ação é recusada ou falha, não fica registro.

| Ação (`acao`) | Rota | Alvo (`alvo`) | Resumo |
|---|---|---|---|
| `campanha.salvar` | `PUT /api/admin/campanha` | `campanha:<id>` | criada (com o slug e o preço) ou os campos alterados; `slug_rifei` e `preco_bilhete_centavos` com o antes e o depois |
| `afiliado.salvar` | `PUT /api/admin/afiliados/:affiliateId` | `afiliado:<affiliate_id>` | célula antes → depois (pelos ids); o rótulo só como "alterado"/"apagado" |
| `hierarquia.importar` | `POST /api/admin/hierarquia/importar` aplicada | `hierarquia` | linhas e contagens de criados e atualizados (a simulação não registra) |
| `hierarquia.criar` | `POST /api/admin/redes`, `/discipuladores` ou `/celulas` (RIFA-018) | `rede:<id>`, `discipulador:<id>` ou `celula:<id>` | o nome do item e a configuração: `Célula "Célula Ágape" criada (discipulador_id 3, qtd_pessoas 12)` |
| `hierarquia.atualizar` | `PUT` do mesmo recurso (RIFA-018) | idem | só o que mudou, com o antes e o depois (`nome`, `divisao`, `rede_id`, `discipulador_id`, `qtd_pessoas`: a meta e o ranking mudam junto); os dados do líder e o responsável da rede só pelo nome do campo, como `informado`, `alterado` ou `apagado`: `Célula "Célula Ágape" alterada: qtd_pessoas (12 → 15), lider_telefone (apagado)`. O PUT igual ao gravado não registra |
| `hierarquia.remover` | `DELETE` do mesmo recurso (RIFA-018) | idem | o nome do item, a configuração e o acesso da hierarquia que caiu junto (D12), pelo id do usuário: `Célula "Célula Ágape" removida (discipulador_id 3, qtd_pessoas 12); acesso do líder removido junto, usuário 15 (com os links e as sessões)` |
| `usuario.criar` | `POST /api/admin/usuarios` | `usuario:<id>` | o papel (sem nome nem e-mail) |
| `usuario.ativar` / `usuario.desativar` | `PATCH /api/admin/usuarios/:id` que muda o estado (reativar quem está ativo ou desativar quem está desativado não registra) | `usuario:<id>` | reativado / desativado |
| `link.criar` | `POST /api/admin/usuarios/:id/links` | `link:<id>` | o usuário do link |
| `link.revogar` | `DELETE /api/admin/links/:id` | `link:<id>` | o usuário do link |

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
  - `divisao` = `jovens` ou `adultos` (filtro: rankings separados);
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

Faltam 13 dias. Bora manter o ritmo: compartilhe hoje o link da sua célula com quem é de fora da igreja!
```

- Partes: venda de ontem (% da meta do dia), acumulado contra a curva e projeção, top 3 do período por divisão (como no ranking público: só quem vendeu, nunca mais posições que `publico.limite_ranking`), as 3 células que mais subiram ontem (em % da própria meta) e a chamada final. Antes do início, no 1º dia, no último dia e depois do fim, o texto muda (contagem regressiva, largada, último dia e resultado final).
- Cada divisão lista no máximo 5 células (`NOMES_POR_DIVISAO_NO_BUMBO`); as demais empatadas viram a linha "e mais N empatadas no Pº lugar".
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
- `equipe`: do discipulador, as células dele por nome; da rede, os discipuladores dela por nome (inclusive os sem
  células), cada um seguido das células dele por nome (ordem de português: "Célula 2" antes de "Célula 10").
  `posicao_divisao` é a posição no ranking do nível do item, na divisão e na janela pedidas.
- **Sem dinheiro em nenhum nível** (schemas estritos e regras cruzadas): com meta em centavos, as quantidades da
  meta saem null; no critério arrecadação, nenhuma distância. A distância até os vizinhos (`diferenca`) sai null
  até o PO decidir (D12). A rota confere a resposta no schema estrito antes de sair: um campo a mais vira 500.
- Alvo sem células (R8): `ranking.geral` e `ranking.divisao` null; na equipe, `posicao_divisao` null.
- `periodo` escolhe a janela do ranking (padrão: o período atual); fora de `atual` e `campanha`, 400.
- Sem campanha ativa: 404 `nao_encontrado`, como o painel.
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
schema (ids repetidos, vazios, mais de 200, papel da coordenação, campo a mais): 400.

## Pedidos e entregas do webhook (Sprint 5, RIFA-025; docs/decisions.md D16)

Só leitura, na área da coordenação (admin e coordenacao). Nenhum dado pessoal: do comprador, só o DDD.

### `GET /api/admin/pedidos` (`coordenacao`)

Pedidos da campanha ativa, do registrado mais novo para o mais antigo. Consulta: `limite` (1 a 200, padrão 50),
`antes_de` (cursor opaco, o `proximo` da página anterior; inválido dá 400), `status`, `celula_id` ou
`sem_celula=true` (não os dois) e `id` (busca exata). Cada item traz status, bilhetes, total em centavos,
afiliado, a célula resolvida na leitura (D7, `celula_id` e `celula_nome`), DDD, os instantes e `suspeito`.
`totais` traz pedidos, bilhetes e centavos por status com os mesmos filtros, menos a paginação e o filtro de
status, só na primeira página (null quando a consulta traz `antes_de`). Sem campanha ativa: lista vazia e totais
zerados.

### `GET /api/admin/webhook/entregas` (`coordenacao`)

Cada entrega autenticada do webhook, da mais nova para a mais antiga: quando chegou, evento, pedido, slug,
resultado e transição de status. Do erro (só em `erro_validacao`) saem o código da recusa (`json_invalido`,
`payload_invalido` ou `corpo_muito_grande`) e os problemas; dos avisos, a lista. Problemas e avisos saem reduzidos
a campo (caminho do schema), código e ocorrências: a mensagem gravada não sai. Consulta: `limite`, `antes_de`
(id), `resultado` e `pedido_id`.

### `GET /api/admin/webhook/estado` (`coordenacao`)

`situacao` (na ordem de prioridade: `erros_recentes`, `sem_entregas_recentes`, `nunca_recebeu` ou `ok`; regra na
D16), a última entrega, a última entrega da campanha, a última aprovação e a contagem das últimas 24 h por
resultado.

## Rotas RASCUNHO (Sprint 4)

Forma provável, que pode mudar quando for implementada. O schema já está em `api.ts`, marcado como `situacao: 'rascunho'`.

### RASCUNHO `POST /api/admin/reconciliacao` (`coordenacao`)

- **Corpo**: `{ "csv": "<Exportar Pedidos da Rifei>" }`.
- **200** (`respostaReconciliacaoSchema`): `{ linhas_lidas, pedidos_no_csv, pedidos_no_sistema, divergencias: [{ tipo, pedido_id, sistema, csv }] }`.
  - `tipo` ∈ `ausente_no_sistema`, `ausente_no_csv`, `status_divergente`, `valor_divergente` ou `afiliado_divergente`.
  - Cada lado traz `status`, `total_centavos`, `qtd_bilhetes` e `affiliate_id`.
- O CSV tem dados pessoais: é lido só em memória e nada dele é gravado ou devolvido além disso (D1).
- O formato das colunas depende de um export real (pendência em [integracao-rifei.md](integracao-rifei.md#9-o-que-confirmar-com-uma-campanha-de-teste)).

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
