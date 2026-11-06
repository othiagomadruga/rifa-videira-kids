# Modelo de dados (Cloudflare D1)

- Migration: [`migrations/0001_init.sql`](../migrations/0001_init.sql), aplicada depois de `0000_setup.sql` (tabela `_meta`, RIFA-001).
- Tipos e schemas espelho: `src/shared/contracts/dominio.ts`.
- Integração com a Rifei, com as decisões D1 a D9: [integracao-rifei.md](integracao-rifei.md).

## 1. Visão geral

```mermaid
erDiagram
  campanhas ||--|{ campanha_periodos : "tem (em ordem)"
  campanhas ||--o{ pedidos : "recebe"
  redes ||--o{ discipuladores : "tem"
  discipuladores ||--o{ celulas : "acompanha"
  celulas |o--o{ afiliados : "vinculados (celula_id nulo = órfão)"
  afiliados |o--o{ pedidos : "vendeu (affiliate_id nulo = sem afiliado)"
  webhook_eventos }o..o| pedidos : "pedido_id (sem FK)"
```

- **Hierarquia da igreja**: rede (divisão `jovens` ou `adultos`) → discipulador → célula (com `qtd_pessoas` e os dados do líder).
- **Rifei**: cada pedido chega pelo webhook e vira uma linha em `pedidos`, com o estado atual. Toda entrega também vira uma linha em `webhook_eventos`.
- **Ponte entre os dois lados**: `afiliados` liga o `affiliate_id` da Rifei a uma célula. A célula de uma venda é resolvida na **leitura** (view `vendas_aprovadas`), nunca gravada no pedido (D7).
- **Configuração**: `campanhas` e `campanha_periodos` guardam as regras da campanha (datas, preço, períodos e percentuais, regra de meta, critério do ranking, visão pública). Nada disso fica no código.

## 2. Convenções

- Nomes em português, snake_case. Os ids são `INTEGER PRIMARY KEY`, com duas exceções que vêm da Rifei: `pedidos.id` (texto) e `afiliados.affiliate_id` (inteiro).
- **Dinheiro em centavos** (`INTEGER`), conforme D2. **Percentuais em pontos-base** (3500 = 35%).
- **Instantes em UTC**, texto ISO 8601 com milissegundos e `Z` (`2026-12-01T12:20:31.512Z`). Com um formato único, a ordem alfabética é a cronológica, e o filtro por intervalo usa índice. O padrão das colunas `criado_em` e `atualizado_em` é `strftime('%Y-%m-%dT%H:%M:%fZ', 'now')`.
- **Datas locais** da campanha em `YYYY-MM-DD`, no fuso da campanha (D8).
- Os formatos de data e instante são checados com `date()` e `strftime()` (`CHECK (strftime('%Y-%m-%dT%H:%M:%fZ', x) IS x)`), e não com `GLOB`: o D1 recusa padrões GLOB/LIKE longos ("LIKE or GLOB pattern too complex"). A checagem também recusa datas impossíveis, como 30/02.
- O D1 sempre aplica chaves estrangeiras. Todas as exclusões são `RESTRICT`, e a API responde `409 em_uso`. A exceção é `campanha_periodos`, que cai junto com a campanha (`CASCADE`).
- **D1/LGPD**: nenhuma coluna guarda nome, e-mail, documento, data de nascimento, endereço ou telefone completo do comprador. Os dados do **líder** de célula (nome, e-mail, telefone) são da equipe da igreja e fazem parte do cadastro da hierarquia.

## 3. Tabelas

### `campanhas`

Configuração da campanha. A API v1 trabalha sempre com a campanha **ativa**, e o índice parcial `campanhas_uma_ativa` garante no máximo uma.

| Coluna | Tipo | Regra |
|---|---|---|
| `id` | INTEGER PK | |
| `nome` | TEXT | 1–120 caracteres |
| `slug_rifei` | TEXT UNIQUE | slug da campanha na Rifei: só eventos com esse slug são processados (D5) |
| `ativa` | INTEGER 0/1 | padrão 1 |
| `fuso_horario` | TEXT | IANA; padrão `America/Belem` (D8) |
| `data_inicio` | TEXT | data local, primeiro dia de vendas |
| `preco_bilhete_centavos` | INTEGER > 0 | |
| `meta_unidade` | TEXT | `bilhetes` ou `centavos` |
| `meta_regra` | TEXT | `por_pessoa`, `total_proporcional` ou `fixa_por_celula` (seção 7.2) |
| `meta_valor` | INTEGER > 0 | na unidade da meta; o significado depende da regra |
| `ranking_criterio` | TEXT | `percentual_meta`, `bilhetes` ou `arrecadacao` |
| `publico_mostra_percentual_meta` | INTEGER 0/1 | padrão 0: o público vê só posições |
| `publico_limite_ranking` | INTEGER 1–100 ou NULL | padrão 3 (top 3); NULL mostra todas as posições |
| `criado_em`, `atualizado_em` | TEXT | instantes UTC |

O fim da campanha não é guardado: é `data_inicio + soma dos dias dos períodos − 1`.

### `campanha_periodos`

Períodos **consecutivos** a partir de `campanhas.data_inicio`, na `ordem` (ex.: 3 "semanas" de 10, 7 e 7 dias). Como cada período tem só a duração, não existe buraco nem sobreposição entre eles.

| Coluna | Tipo | Regra |
|---|---|---|
| `campanha_id` | INTEGER FK → campanhas (CASCADE) | PK (campanha_id, ordem) |
| `ordem` | INTEGER ≥ 1 | 1, 2, 3… |
| `nome` | TEXT | ex.: "Semana 1" |
| `dias` | INTEGER 1–366 | |
| `percentual_bp` | INTEGER 0–10000 | **a soma não precisa dar 10000**: o cálculo normaliza (seção 7.3) |

### `redes`, `discipuladores`, `celulas`

| Tabela | Colunas principais | Regras |
|---|---|---|
| `redes` | `nome`, `divisao`, `responsavel_nome` (pastor ou obreiro da rede, opcional) | `divisao` ∈ {`jovens`, `adultos`}; `nome` único |
| `discipuladores` | `rede_id` → redes, `nome` | `nome` único; índice por `rede_id` |
| `celulas` | `discipulador_id` → discipuladores, `nome`, `qtd_pessoas`, `lider_nome`, `lider_email`, `lider_telefone` | `nome` único; `qtd_pessoas` 1–1000 (é a base da meta); e-mail e telefone opcionais; índice por `discipulador_id` |

Os nomes são únicos com `COLLATE NOCASE`, que só ignora maiúsculas ASCII. A API compara nomes ignorando também maiúsculas acentuadas e espaços extras. Os nomes servem de chave na importação por CSV.

### `afiliados` (D7)

| Coluna | Tipo | Regra |
|---|---|---|
| `affiliate_id` | INTEGER PK | id do afiliado na Rifei |
| `celula_id` | INTEGER FK → celulas, NULL | NULL = **não vinculado** (fila de órfãos) |
| `rotulo` | TEXT NULL | nota da coordenação (ex.: usuário do líder na Rifei) |
| `origem` | TEXT | `webhook` (apareceu numa venda) ou `manual` (pré-cadastro) |
| `criado_em`, `atualizado_em` | TEXT | |
| `vinculado_em` | TEXT NULL | preenchido **se e somente se** `celula_id` não é NULL (CHECK) |

Uma célula pode ter mais de um afiliado, por exemplo se o líder tiver duas contas. As vendas de todos eles somam na célula.

### `pedidos`

Estado **atual** de cada pedido da Rifei. **Só `status = 'approved'` conta como venda.**

| Coluna | Tipo | Origem no payload |
|---|---|---|
| `id` | TEXT PK (1–128) | `id` |
| `campanha_id` | INTEGER FK → campanhas | campanha ativa cujo `slug_rifei` = `slug` |
| `affiliate_id` | INTEGER FK → afiliados, NULL | `affiliate_id` (NULL = sem afiliado) |
| `status` | TEXT | `in_process`, `approved` ou `expired` (máquina D4) |
| `status_rifei`, `status_detail_rifei` | TEXT | `status`, `status_detail` do último evento processado |
| `qtd_bilhetes` | INTEGER ≥ 0 | `numbers_count` |
| `numeros` | TEXT (JSON) NULL | `numbers`, usado na reconciliação |
| `subtotal_centavos`, `total_centavos` | INTEGER ≥ 0 | `subtotal`, `total` (D2); `total` é o arrecadado |
| `desconto_promocao_centavos`, `desconto_cupom_centavos` | INTEGER NULL | `promotion_discount`, `coupon_discount` |
| `cupom_id` | INTEGER NULL | `coupon_id` |
| `metodo_pagamento` | TEXT | `payment_method` |
| `rifinha` | INTEGER 0/1 | `is_rifinha` |
| `ddd` | TEXT NULL | derivado de `buyer.phone`; só para o Brasil (CHECK `ddd IS NULL OR pais = '55'`) |
| `pais` | TEXT NULL | código de discagem do país, derivado de `buyer.phone` (`55` = Brasil) |
| `utm_source` … `utm_term` | TEXT NULL | `utm.*` |
| `criado_em`, `expira_em` | TEXT (UTC) | `created_at`, `expires_at` |
| `aprovado_em` | TEXT (UTC) NULL | `approved_at`; obrigatório quando `approved` (CHECK). Se a Rifei mandar null, vale o instante do recebimento |
| `expirado_em` | TEXT (UTC) NULL | `expired_at` |
| `registrado_em`, `atualizado_em` | TEXT (UTC) | nossos: primeira gravação e última alteração |

### `webhook_eventos` (D3)

Uma linha por entrega **autenticada**, inclusive duplicadas e inválidas. Entregas com 401 ou 503 não são gravadas.

| Coluna | Tipo | Regra |
|---|---|---|
| `id` | INTEGER PK | devolvido como `evento_id` |
| `recebido_em` | TEXT (UTC) | |
| `evento`, `pedido_id`, `slug` | TEXT NULL | como vieram; em `erro_validacao`, só se forem texto |
| `resultado` | TEXT | `processado`, `duplicado`, `ignorado_outra_campanha`, `ignorado_transicao` ou `erro_validacao` |
| `status_anterior` | TEXT NULL | estado do pedido antes do evento (NULL se não existia) |
| `status_resultante` | TEXT NULL | preenchido em `processado`, `duplicado` e `ignorado_transicao` |
| `payload_redigido` | TEXT (JSON) NULL | `payloadRifeiRedigidoSchema`; NULL só em `erro_validacao` |
| `erro` | TEXT (JSON) NULL | lista de problemas (caminho, código, mensagem, sem valores); preenchido **se e somente se** `erro_validacao` |

`pedido_id` não tem FK, porque eventos ignorados ou inválidos não geram pedido. Como o payload redigido fica guardado, dá para **reprocessar** eventos depois (por exemplo, os `ignorado_outra_campanha` recebidos antes de a campanha ser configurada).

### View `vendas_aprovadas`

Pedidos `approved` com a hierarquia resolvida por `LEFT JOIN`: afiliado → célula → discipulador → rede. As colunas são `pedido_id`, `campanha_id`, `affiliate_id`, `qtd_bilhetes`, `total_centavos`, `aprovado_em`, `ddd`, `pais`, `celula_id`, `discipulador_id`, `rede_id` e `divisao`.

- `celula_id` NULL = venda **sem célula** (sem afiliado ou afiliado não vinculado). Ela entra no total da campanha, mas não entra em nenhum ranking.
- Vincular um afiliado muda o resultado da view na hora, sem alterar `pedidos` (D7).

## 4. Índices e consultas típicas

| Índice | Serve para |
|---|---|
| `pedidos_por_status_aprovacao (status, aprovado_em)` | ritmo e ranking por janela de tempo: `status = 'approved' AND aprovado_em >= ? AND aprovado_em < ?` (validado com `EXPLAIN QUERY PLAN`, também através da view) |
| `pedidos_por_afiliado_status (affiliate_id, status)` | totais por afiliado (`GET /api/admin/afiliados`), "sem afiliado" (`affiliate_id IS NULL`) e a FK de `afiliados` |
| `afiliados_por_celula`, `celulas_por_discipulador`, `discipuladores_por_rede` | subir e descer a hierarquia, e as FKs |
| `webhook_eventos_por_pedido`, `webhook_eventos_por_resultado (resultado, recebido_em)` | auditoria de um pedido; listar erros e ignorados recentes |
| `campanhas_uma_ativa` (parcial, único) | garantir uma única campanha ativa |

Exemplo, ranking de células no período, com `[início, fim)` já convertido para UTC:

```sql
SELECT celula_id, count(*) AS pedidos, sum(qtd_bilhetes) AS bilhetes, sum(total_centavos) AS total_centavos
FROM vendas_aprovadas
WHERE aprovado_em >= ?1 AND aprovado_em < ?2 AND celula_id IS NOT NULL
GROUP BY celula_id;
```

## 5. Ciclo do pedido (D3, D4)

| Estado atual \ evento | `new_order` | `paid_order` | `expired_order` |
|---|---|---|---|
| (não existe) | processado → `in_process` | processado → `approved` | processado → `expired` |
| `in_process` | duplicado | processado → `approved` | processado → `expired` |
| `expired` | ignorado_transicao | processado → `approved` | duplicado |
| `approved` | ignorado_transicao | duplicado | ignorado_transicao |

- Em `processado`, o pedido recebe os dados **do evento processado** (valores, instantes, afiliado, DDD, utm). `registrado_em` não muda.
- A gravação é idempotente: reentregar não duplica nada. Para continuar correta com entregas simultâneas, a transição usa UPSERT condicional (`ON CONFLICT (id) DO UPDATE ... WHERE pedidos.status IN (...)`), dentro de um `db.batch` junto com o afiliado e o evento.
- Fonte executável: `decidirTransicaoPedido` em `dominio.ts`.

## 6. Atribuição (D7)

1. Um `affiliate_id` desconhecido no webhook cria o afiliado com `celula_id = NULL` e `origem = 'webhook'`. É a fila de órfãos, listada em `GET /api/admin/afiliados?vinculado=false`.
2. A coordenação vincula com `PUT /api/admin/afiliados/:affiliateId { "celula_id": 7 }`, ou pré-cadastra o afiliado antes da primeira venda.
3. As vendas passam para a célula imediatamente, porque a view resolve a célula na leitura.
4. Venda sem `affiliate_id` fica em "sem afiliado".

## 7. Como ritmo, metas e ranking serão calculados (Sprints 3–4)

Esta seção é a base das rotas rascunho `GET /api/painel/resumo` e `GET /api/painel/ranking`. O cálculo será implementado depois; aqui ficam as regras e as fórmulas.

### 7.1 Tempo

- **Dia local** `D`: o intervalo `[D 00:00, D+1 00:00)` no fuso da campanha, convertido para UTC. Em `America/Belem` (UTC−3 fixo): `[D 03:00Z, D+1 03:00Z)`.
- **Dia da campanha** `d = D − data_inicio + 1`. Antes do dia 1, a campanha está na fase `antes`; depois do último dia, `encerrada`.
- **Período `k`**: o que contém `D`. Ele começa em `data_inicio + soma dos dias dos períodos anteriores` e dura `dias_k`. A posição de `D` dentro dele é `t = D − início_k + 1`.

### 7.2 Meta da célula e das instâncias acima

`M_c` é a meta da célula `c`, na unidade `meta_unidade` (bilhetes ou centavos):

| `meta_regra` | `M_c` |
|---|---|
| `por_pessoa` | `meta_valor × qtd_pessoas_c` |
| `total_proporcional` | `meta_valor × qtd_pessoas_c / Σ qtd_pessoas (todas as células)` |
| `fixa_por_celula` | `meta_valor` |

- Discipulador, rede, divisão e campanha têm como meta a **soma** das metas das células abaixo deles.
- **Realizado** é a soma de `qtd_bilhetes` (unidade `bilhetes`) ou de `total_centavos` (unidade `centavos`) das vendas aprovadas na janela.
- Na campanha, o realizado inclui as vendas sem célula, porque o total arrecadado é tudo. Nas demais instâncias, só as vendas atribuídas.
- Metas e esperados não são arredondados no cálculo; o arredondamento é só na exibição.

### 7.3 Normalização dos percentuais

Os percentuais configurados **nunca são alterados**. O cálculo usa o peso normalizado:

```
w_k = percentual_bp_k / Σ_j percentual_bp_j
```

Exemplo da ata: 3500, 2500 e 4500 somam 10500 (105%). Os pesos ficam `w = 0,3333; 0,2381; 0,4286`, que somam 1. Se a soma for 10000, `w_k = percentual_bp_k / 10000`. A API devolve `soma_percentuais_bp` em `GET /api/admin/campanha` para a interface avisar quando a soma for diferente de 10000. Pelo menos um percentual precisa ser maior que zero.

### 7.4 Ritmo

Para uma instância com meta `M`:

| Grandeza | Fórmula |
|---|---|
| Meta do período `k` | `M_k = M × w_k` |
| Meta do dia (linear dentro do período) | `m_k = M_k / dias_k` |
| Fração esperada até o fim do dia `D` | `F(D) = Σ_{i<k} w_i + w_k × t / dias_k` |
| Esperado acumulado na campanha | `E(D) = M × F(D)` |
| Esperado no período até `D` | `M_k × t / dias_k` |
| Ritmo (`percentual_ritmo_bp`) | `realizado / esperado`, na mesma janela |
| Meta ajustada do dia | `max(0, M_k − realizado no período até ontem) / (dias_k − t + 1)`: o que faltou é redistribuído pelos dias restantes do período (RF04) |
| Projeção do fim da campanha | `realizado acumulado / F(D)` (null se `F(D) = 0`) |

A curva dentro do dia (RF09) fica para depois. No MVP, a meta do dia é linear dentro do período, e o esperado considera o dia de hoje inteiro.

Exemplo: 36 células com 450 pessoas, regra `por_pessoa`, 10 bilhetes por pessoa (`M = 4500`), períodos de 10, 7 e 7 dias com 35/25/45.

- Pesos: 0,3333, 0,2381 e 0,4286. Metas dos períodos: 1500, 1071,4 e 1928,6. Metas diárias: 150, 153,1 e 275,5.
- No dia 8 (período 1, `t = 8`): `F = 0,3333 × 8/10 = 0,2667` e `E = 1200`. Com 1100 bilhetes vendidos, o ritmo é 91,67% e a projeção é `1100 / 0,2667 = 4125`.
- Uma célula de 12 pessoas tem meta 120: 40 no período 1, ou 4 por dia.

### 7.5 Ranking

- **Níveis**: `celula`, `discipulador`, `rede` e `divisao` (adultos × jovens). O filtro `divisao` gera os rankings separados.
- **Janela**: `atual` = do início do período que contém a data até a data; `campanha` = do primeiro dia até a data.
- **Critério** (`ranking_criterio`):
  - `percentual_meta` = realizado / meta da instância na janela (`M × w_k` no período, `M` na campanha). Comparar com a meta cheia ou com o esperado até hoje dá a mesma ordem, porque a fração do tempo é igual para todos.
  - `bilhetes` = soma de `qtd_bilhetes`.
  - `arrecadacao` = soma de `total_centavos`.
- **Empates** dividem a posição (1, 2, 2, 4). Dentro do empate, a ordem é por nome. Uma instância sem meta (sem células) vai para o fim.
- **Vendas sem célula** não entram em nenhum ranking. O painel mostra essas vendas à parte (`vendas_sem_celula`).
- **Visão pública** (`/api/publico/ranking`): mesma ordem, só posição, nome e divisão, limitada a `publico_limite_ranking` posições (padrão 3; quem empata na última posição entra). O `% da meta` só aparece se `publico_mostra_percentual_meta = 1`. **Nunca há valores em R$.**

## 8. O que não é guardado (D1)

- Do comprador: nome, e-mail, documento (CPF), data de nascimento, endereço, telefone completo, `observation`, `fbp` e `fbc`. Ficam só `ddd` e `pais`.
- O payload bruto do webhook nunca é gravado, só o redigido.
- O CSV da reconciliação, que traz dados pessoais, é processado em memória e descartado.
