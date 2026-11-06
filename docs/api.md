# API v1: contrato

O contrato executável está em `src/shared/contracts/`:

| Arquivo | Conteúdo |
|---|---|
| `api.ts` | schemas de cada rota e o catálogo `ROTAS` (método, caminho, grupo, situação, schemas) |
| `dominio.ts` | entidades e configuração |
| `rifei.ts` | payload do webhook e redação |
| `erros.ts` | formato de erro e códigos |

Este documento explica o contrato. Se ele divergir dos schemas, valem os schemas, e a divergência é um bug que o SM corrige. Só o SM altera o contrato depois que ele estiver na `main`.

- **Detalhadas** (Sprints 1–2): fechadas. Front e back implementam em paralelo.
- **RASCUNHO** (Sprints 3–4): forma provável, que pode mudar quando forem implementadas.

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
- Listas vêm em `{ "itens": [...] }`. Não há paginação na v1: o volume é pequeno (36 células).
- Parâmetros de caminho e de consulta chegam como texto e o schema converte. Ex.: `:id` = `"12"` vira `12`; `?vinculado=false` vira `false`.

## Autorização por grupo

| Grupo | Rotas | Mecanismo | Falhas |
|---|---|---|---|
| `rifei_bearer` | `/api/webhooks/*` | `Authorization: Bearer <RIFEI_WEBHOOK_TOKEN>`, comparado em tempo constante (D6) | `401 nao_autenticado`; segredo não configurado: `503 nao_configurado` |
| `coordenacao` | `/api/admin/*`, `/api/painel/*` | equipe da campanha; o mecanismo será definido na RIFA-007 | `401 nao_autenticado`, `403 proibido` |
| `aberto` | `/api/health`, `/api/publico/*` | nenhum | **`/api/publico/*` nunca devolve valores financeiros** |

Os schemas de `/api/publico/*` são **estritos**: um campo a mais, como `total_centavos`, invalida a resposta. Um teste confere que nenhum campo de valor (centavos, total, bilhetes, realizado…) existe nas respostas abertas.

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
| `json_invalido` | 400 | corpo não é JSON |
| `payload_invalido` | 400 | webhook sem o essencial: `event`, `id`, `slug`, `numbers_count` ou `total` |
| `csv_invalido` | 400 | CSV sem cabeçalho, sem coluna obrigatória ou acima do limite (`detalhes`: `detalhesCsvInvalidoSchema`) |
| `referencia_invalida` | 400 | `rede_id`, `discipulador_id` ou `celula_id` inexistente no corpo |
| `nao_autenticado` | 401 | sem credencial ou credencial inválida |
| `proibido` | 403 | autenticado, sem permissão |
| `nao_encontrado` | 404 | recurso do caminho não existe (ou campanha ainda não configurada) |
| `nome_duplicado` | 409 | nome de rede, discipulador ou célula já usado |
| `em_uso` | 409 | exclusão de rede com discipuladores, de discipulador com células ou de célula com afiliados |
| `erro_interno` | 500 | falha inesperada (ex.: banco) |
| `nao_configurado` | 503 | segredo do webhook ausente |
| `banco_indisponivel` | 503 | health sem banco |

O mapa código → HTTP fica em `STATUS_HTTP_DO_ERRO`. Para montar o corpo, use `criarErroApi()`; para converter um erro do zod em `detalhes`, use `detalhesDeValidacao()`.

> **Pendente na implementação:** no esqueleto (RIFA-001), o 404 de rota inexistente, o 500 do `onError` e o 503 do health ainda respondem `{ "ok": false, "erro": "..." }` (o health também manda `"db": "erro"`). Pelo contrato, os três passam ao formato único, com os códigos `nao_encontrado`, `erro_interno` e `banco_indisponivel`. O ajuste fica para a tarefa da API, junto com os testes do Worker que conferem esses corpos.

---

## Rotas detalhadas (Sprints 1–2)

### `GET /api/health` (aberto)

- **200**: `{ "ok": true, "db": "ok", "latenciaMs": 3 }` (`respostaHealthSchema`). É o formato que o esqueleto (RIFA-001) já serve e o site já lê; por isso `latenciaMs` fica em camelCase.
- **503** `banco_indisponivel`: o banco não respondeu.
- Não revela configuração, como a existência do segredo do webhook.

### `POST /api/webhooks/rifei` (`rifei_bearer`)

- Recebe o payload oficial da Rifei e o analisa com `analisarPayloadRifei` (RIFA-002b). Só recusa (400) quando falta o que torna o pedido gravável: `event` reconhecido, `id`, `slug`, `numbers_count` e `total`. O resto é tolerado: ausente ou com tipo errado vira null, e a diferença fica em `webhook_eventos.avisos`. Motivo: a Rifei não reenvia, e um 400 é venda perdida.
- O passo a passo completo está em [integracao-rifei.md](integracao-rifei.md#5-processamento-de-cada-entrega).
- O corpo é validado **dentro do handler**, e não por middleware, porque o erro precisa ser gravado antes da resposta 400.

| Status | Corpo | Gravado em `webhook_eventos`? |
|---|---|---|
| **200** | `{ "resultado": "processado" \| "duplicado" \| "ignorado_outra_campanha" \| "ignorado_transicao", "evento_id": 123 }` | sim, depois de gravar (D9) |
| **400** `json_invalido` / `payload_invalido` | erro; `detalhes` = `{ "evento_id": 124, "problemas": [...] }` | sim, como `erro_validacao` (sem dado pessoal) |
| **401** `nao_autenticado` | erro | não |
| **503** `nao_configurado` | erro | não |
| **500** `erro_interno` | erro | não (falhou ao gravar) |

- `ignorado_outra_campanha`: o `slug` é diferente do `slug_rifei` da campanha ativa, ou não há campanha ativa (D5).
- `ignorado_transicao`: o evento não é permitido no estado atual, como um `expired_order` depois de `approved` (D4).
- No `json_invalido`, `problemas` = `[{ "caminho": [], "codigo": "json_invalido", "mensagem": "O corpo não é um JSON válido" }]`. A mensagem é fixa: a do `JSON.parse` traz um trecho do corpo (dado pessoal, D1) e nunca é gravada, devolvida nem logada.

### `GET /api/admin/campanha` e `PUT /api/admin/campanha` (`coordenacao`)

Configuração da campanha ativa: tudo que é regra de campanha vive aqui, e não no código.

- **GET**: **200** `Campanha` (`campanhaSchema`). **404** `nao_encontrado` enquanto nada foi configurado.
- **PUT**: o corpo é `campanhaEntradaSchema`. Cria a campanha ativa ou substitui a configuração dela, e os períodos são substituídos inteiros. **200** `Campanha`; **400** `requisicao_invalida`.

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

- Os nomes são únicos dentro de cada recurso, sem diferenciar maiúsculas (inclusive acentuadas) e ignorando espaços nas pontas.
- `DELETE` não apaga em cascata:
  - rede com discipuladores: `409 em_uso`;
  - discipulador com células: `409 em_uso`;
  - célula com afiliado vinculado: `409 em_uso` (desvincule antes).

### `POST /api/admin/hierarquia/importar` (`coordenacao`)

Importa a hierarquia (redes, discipuladores e células) de um CSV, como a planilha que a igreja vai entregar.

- **Corpo** (`corpoImportarHierarquiaSchema`): `{ "csv": "<conteúdo do arquivo>", "simular": false }`. Com `simular: true`, só valida e conta.
- **Arquivo**:
  - UTF-8 (BOM aceito);
  - primeira linha = cabeçalho;
  - separador `,` ou `;` (detectado no cabeçalho; o Excel em português usa `;`);
  - aspas como no RFC 4180;
  - linhas vazias são ignoradas;
  - no máximo 2000 linhas de dados.
- **Colunas** (`COLUNAS_CSV_HIERARQUIA`). Os nomes do cabeçalho são comparados sem diferenciar maiúsculas; colunas desconhecidas são ignoradas.

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

- Cada linha é validada por `linhaCsvHierarquiaSchema`, que tira os espaços das pontas.
- As entidades são encontradas pelo **nome** (mesma comparação do CRUD):
  - se não existe, é criada;
  - se existe e mudou, é atualizada (um discipulador pode mudar de rede e uma célula, de discipulador);
  - se existe e não mudou, fica "inalterada".
- Coluna opcional **ausente do cabeçalho** mantém o valor atual. Coluna **presente e vazia** apaga o valor (null).
- O arquivo precisa ser coerente. A mesma rede com divisões diferentes, o mesmo discipulador em redes diferentes ou uma célula repetida com dados diferentes é erro na linha que contradiz a anterior. Uma linha idêntica repetida conta uma vez.
- **Atômico**: se qualquer linha tem erro, nada é gravado. O que não está no arquivo não é apagado.
- **400** `csv_invalido`, com `detalhes` no formato `detalhesCsvInvalidoSchema`:
  - `{ "motivo": "sem_cabecalho" }`: arquivo vazio ou sem cabeçalho;
  - `{ "motivo": "colunas_faltando", "colunas": ["qtd_pessoas"] }`: falta coluna obrigatória;
  - `{ "motivo": "linhas_demais", "limite": 2000, "total_linhas": 2500 }`: mais de 2000 linhas de dados.

**200** (`respostaImportarHierarquiaSchema`) para o CSV acima, num banco vazio:

```json
{
  "aplicado": true,
  "simulado": false,
  "total_linhas": 3,
  "criados": { "redes": 2, "discipuladores": 2, "celulas": 3 },
  "atualizados": { "redes": 0, "discipuladores": 0, "celulas": 0 },
  "inalterados": { "redes": 0, "discipuladores": 0, "celulas": 0 },
  "erros": []
}
```

- `aplicado` só é `true` quando não há erro e `simular` é `false`. Sem aplicar, as contagens mostram o que teria acontecido com as linhas válidas.
- Uma entidade que aparece em várias linhas conta uma vez.
- Se a linha 4 tivesse `qtd_pessoas` = `12,5`, a resposta seria `aplicado: false`, com `erros: [{ "linha": 4, "coluna": "qtd_pessoas", "mensagem": "Use um número inteiro" }]` e as contagens só das linhas 2 e 3. `linha` conta o cabeçalho como linha 1.

### `GET /api/admin/afiliados` (`coordenacao`)

- **Consulta**:
  - `?vinculado=true`: só os ligados a uma célula;
  - `?vinculado=false`: a fila de órfãos;
  - sem o parâmetro: todos.
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
- **400** `referencia_invalida`: a célula não existe.
- Efeito: `vinculado_em` = agora (ou null ao desvincular). Todas as vendas do afiliado passam para a célula **na hora** (D7).

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

- `vinculada`: a célula tem ao menos um afiliado.
- `primeira_venda_em`: o primeiro pedido aprovado de qualquer afiliado da célula.
- `lider_telefone` serve para a coordenação cobrar quem falta.

---

## Rotas RASCUNHO (Sprints 3–4)

As regras de cálculo estão em [modelo-de-dados.md, seção 7](modelo-de-dados.md#7-como-ritmo-metas-e-ranking-serão-calculados-sprints-34). Os schemas abaixo já estão em `api.ts`, marcados como `situacao: 'rascunho'`.

### RASCUNHO `GET /api/painel/resumo` (`coordenacao`)

- **Consulta**:
  - `escopo` = `campanha` (padrão), `divisao`, `rede`, `discipulador` ou `celula`;
  - `id` é obrigatório nos escopos rede, discipulador e célula;
  - `divisao` é obrigatória no escopo divisao;
  - `data` (`YYYY-MM-DD`; padrão: hoje no fuso da campanha).
- **200** (`respostaPainelResumoSchema`):
  - `escopo`;
  - `referencia`: data, fase `antes`/`durante`/`encerrada`, dia da campanha, total de dias e período atual;
  - `unidade`;
  - `dia`, `periodo` e `campanha`, cada um com `meta`, `esperado`, `realizado`, `diferenca`, `percentual_meta_bp` e `percentual_ritmo_bp`; `dia` traz também `meta_ajustada`, e `campanha` traz `projecao_final`;
  - `vendas` (totais aprovados);
  - `vendas_sem_celula` (só no escopo campanha).

### RASCUNHO `GET /api/painel/ranking` (`coordenacao`, com valores)

- **Consulta**:
  - `nivel` = `celula` (padrão), `discipulador`, `rede` ou `divisao` (adultos × jovens);
  - `divisao` (filtro);
  - `periodo` = `atual` (padrão) ou `campanha`;
  - `data`.
- **200** (`respostaRankingSchema`):
  - `janela` (`tipo`, `ordem`, `nome`, `data_inicio`, `data_fim`), `criterio` e `unidade`;
  - `itens[]` com `posicao`, `id` (null no nível divisão), `nome`, `divisao`, `meta`, `realizado`, `percentual_meta_bp` e `vendas`.
- Empates dividem a posição.

### RASCUNHO `GET /api/publico/ranking` (aberto, **sem nenhum valor em R$**)

- **Consulta**: `nivel`, `divisao` e `periodo`, como no painel, sem `data`.
- **200** (`respostaRankingPublicoSchema`, estrito): `{ nivel, divisao, janela, itens: [{ posicao, nome, divisao, percentual_meta_bp? }], atualizado_em }`.
  - Itens com `posicao` até `publico.limite_ranking` (padrão 3). Quem empata na última posição entra, então pode haver mais itens que o limite (ex.: 1, 2, 3, 3).
  - `percentual_meta_bp` só aparece se `publico.mostra_percentual_meta = true`.
  - Nunca aparecem centavos, bilhetes, meta ou realizado.

### RASCUNHO `GET /api/publico/bumbo` (aberto)

- **Consulta**: `data` (padrão hoje).
- **200** (`respostaBumboSchema`, estrito): `{ "data": "2026-12-08", "texto": "...", "gerado_em": "..." }`.
- `texto` é a mensagem pronta para o grupo de WhatsApp: dia da campanha, ritmo contra a curva, as 3 primeiras posições e uma chamada final. **Nunca contém valores em R$.** O modelo do texto será fechado na Sprint 4.

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
