# Regras de cálculo: metas, curva, ritmo, projeção, ranking e bumbo

Contrato das regras que o painel, os rankings, a visão pública e o bumbo usam (RIFA-008). O código é um só e é puro: `src/shared/contracts/calculos.ts`, testado em `calculos.test.ts` (cada exemplo numérico deste documento está lá). As rotas estão em [api.md](api.md): o Worker lê o banco e chama as funções `montar*`, sem refazer conta nenhuma.

Este documento **substituiu o conteúdo de cálculo da seção 7 de [modelo-de-dados.md](modelo-de-dados.md)**, que agora só resume e aponta para cá; o que mudou em relação àquela versão está na seção 4.

**Como ler as fontes.** `[hh:mm:ss]` é o horário da "Reunião Projeto Kids" (27/08/2026, Sinapse). "DevMission, decisão N" é a decisão N do retrato do projeto (espaço Videira, seção "decisoes"); "missão N" é uma das 16 missões antigas. "Regra-base" é a regra que veio no planejamento da Sprint 3. O que é escolha nossa está marcado como **SUPOSIÇÃO Sn** e listado na seção 3 para o PO validar.

**Exemplo que atravessa o documento** (fictício, o mesmo dos testes): campanha de 21 dias a partir de 23/11/2026 em `America/Belem`, 3 semanas de 7 dias com 35/25/45 (soma 105%), meta de 10 bilhetes por pessoa. A Célula Ágape tem 12 pessoas.

| Dia | 1 | 7 | 8 | 14 | 15 | 21 |
|---|---|---|---|---|---|---|
| Data | 23/11 | 29/11 | 30/11 | 06/12 | 07/12 | 13/12 |
| Período | Semana 1 (1º dia) | Semana 1 (último) | Semana 2 (1º) | Semana 2 (último) | Semana 3 (1º) | Semana 3 (último) |

---

## 1. Convenções

- **Unidade.** Meta, esperado, realizado, diferença, meta do dia e projeção estão na unidade da meta da campanha (`meta.unidade`): `bilhetes` (soma de `qtd_bilhetes`) ou `centavos` (soma de `total_centavos`, o arrecadado). Só pedidos `approved` contam (D4).
- **Exatidão (R11).** Metas, curva e esperados são frações exatas (inteiros grandes) do começo ao fim; só o número que sai na resposta é arredondado. Não há float acumulado.
- **Arredondamento (R11).**
  - Alvos (meta, meta do período, esperado, meta do dia): **para cima**, em unidades inteiras. "Para estar em dia precisa vender pelo menos X."
  - Percentuais (`*_bp`, pontos-base: 10000 = 100%): **para baixo** (truncados), em pontos-base inteiros. Passam de 10000 quando a meta é superada.
  - Projeção (unidades): para baixo.
  - Consequência, testada: para um realizado inteiro, "realizado ≥ alvo arredondado" vale exatamente quando "percentual ≥ 100%", e nada aparece como 100% antes de a meta ser batida (a mesma regra do `formatarPercentual` do site).
- **Dias.** "Dia N" é o dia da campanha (1 = primeiro dia de vendas). "Dias fechados" são os dias da campanha que já terminaram antes da data de referência. O dia de hoje conta no realizado, mas **não** entra no esperado (R4).
- **Data de referência.** Hoje no fuso da campanha, ou a `data` consultada (no máximo hoje). Com uma data passada, o retrato é o do fim daquele dia: vendas de dias posteriores ficam de fora.
- **"Hoje no fuso" é uma função só:** `hojeNoFuso(campanha.fuso_horario, agora)` (de `calendario.ts`, exportada também por `calculos.ts`). `diaLocalDoInstante` é a mesma regra para um instante qualquer (aceita o texto ISO do banco) e delega para ela. Rotas e telas usam `hojeNoFuso`.
- **De onde importar.** O Worker importa do index do contrato. O site importa as regras e os tipos destas telas de `src/shared/contracts/calculos` (módulo sem zod; valores só de `calendario.ts`, o que um teste confere), nunca do index.

---

## 2. Regras

### R1. Meta da célula e dos agregados

**Regra**
- Meta da célula conforme `meta.regra`, na unidade `meta.unidade`:

  | Regra | Meta da célula `c` |
  |---|---|
  | `por_pessoa` | `valor × qtd_pessoas_c` |
  | `total_proporcional` | `valor × qtd_pessoas_c ÷ soma das pessoas de TODAS as células` |
  | `fixa_por_celula` | `valor` |

- Discipulador, rede, divisão e campanha: **soma exata** das metas das células abaixo.
- Célula com 0 pessoas fica sem meta nas duas regras por pessoa; na fixa, recebe o valor fixo (SUPOSIÇÃO S6). Sem nenhuma pessoa cadastrada, a regra proporcional deixa todas sem meta (não divide por zero).
- Na `total_proporcional`, a meta de cada célula é uma fração exata; para mostrar, cada uma é arredondada para cima. Células do mesmo tamanho têm sempre a mesma meta, e a meta da campanha é exatamente o total configurado; a soma das metas **mostradas** das células pode passar dele em alguns bilhetes (SUPOSIÇÃO S5).

**Fonte**
- Meta proporcional ao número de pessoas, e não igual para todas: [00:33:50]–[00:34:14] (o Fábio disse "talvez a gente vá", decisão D4 da reunião). DevMission, decisão 5.
- Meta do discipulador e do pastor de rede = soma das células abaixo: [00:42:13]–[00:42:19] (RF04).
- Meta fixa por célula: modelo de Santo André, 125 bilhetes por célula × 80 células [00:14:24]–[00:15:14].
- Regra e valor são configuração, não código: DevMission, decisão 8.

**Exemplo**
- `por_pessoa`, 10 por pessoa: Ágape (12) = 120; Betel (6) = 60; o discipulador das duas = 180; a campanha com 60 pessoas = 600.
- `total_proporcional`, 1000 bilhetes para células de 12, 7, 12 e 20 pessoas (51): 235,29 → 236; 137,25 → 138; 236; 392,16 → 393. A campanha soma exatamente 1000.

**Funções:** `metasDasCelulas`, `somarMetas`, `metaArredondada`.

### R2. Curva e esperado acumulado

**Regra**
- Os períodos são consecutivos a partir de `data_inicio`, na ordem, cada um com `dias` e `percentual_bp` (`calendario.ts`).
- Peso do período = percentual ÷ soma dos percentuais. Se a soma não é 100% (35/25/45 = 105%), a conta normaliza sozinha; o percentual configurado nunca é alterado e a tela avisa (`soma_percentuais_bp`).
- **Fração esperada ao fim do dia D**, linear dentro do período:
  `F(D) = (soma dos percentuais dos períodos já encerrados + percentual do período atual × dias decorridos no período ÷ dias do período) ÷ soma dos percentuais`, com F(0) = 0 (antes do 1º dia) e F(último dia) = 100%.
- **Esperado acumulado** de uma instância com meta M ao fim do dia D: `M × F(D)`, para cima.
- Nunca é a meta dividida pelos dias: a curva segue os percentuais dos períodos.
- O ritmo dentro do dia (curva por hora, RF09) fica fora: o dia é a menor unidade.

**Fonte**
- 3 "semanas" de 10, 7 e 7 dias com 35/25/45 (somam 105%; o Rodrigo ficou de confirmar): [00:15:35]–[00:15:44], [00:16:05]–[00:17:18], [00:33:42]–[00:33:44]. A meta diária saía dessa proporção: [00:18:14]–[00:18:20].
- DevMission, decisão 6: o ritmo é medido contra a curva semanal, nunca contra a meta dividida por dias; a soma 105% é normalizada com aviso.
- RF09 (curva dentro do dia) é desejável e depende de histórico: [00:18:59]–[00:19:37].

**Exemplo** (Ágape, meta 120)

| Fim do dia | 1 | 7 | 8 | 14 | 20 | 21 |
|---|---|---|---|---|---|---|
| F(D) | 1/21 = 4,76% | 1/3 = 33,33% | 54/147 = 36,73% | 4/7 = 57,14% | 46/49 = 93,88% | 100% |
| Esperado | 5,71 → **6** | **40** | 44,08 → **45** | 68,57 → **69** | 112,65 → **113** | **120** |

- No modelo de Santo André (10/7/7, 24 dias), o fim do dia 10 espera 33,3% da meta; pela meta ÷ dias seriam 41,7%.
- Com 35/25/40 (soma 100%), o fim da Semana 1 espera exatamente 35% (42 de 120).

**Funções:** `curvaEsperada`, `esperadoAteODia`, `percentualEsperadoBp`.

### R3. Meta do dia

**Regra**
- `meta do dia D = esperado ao fim de D − realizado até o fim de D−1`, nunca negativa.
- O que faltou ontem entra na meta de hoje. O que sobrou a reduz, no mínimo até zero (SUPOSIÇÃO S2).
- A conta é sobre o acumulado da campanha inteira: a falta da Semana 1 entra na meta do 1º dia da Semana 2 (SUPOSIÇÃO S3).
- `meta_base` é só a parte da curva no dia (`esperado(D) − esperado(D−1)`), para a tela mostrar "120 + 30 que faltaram".
- Só existe durante a campanha. No último dia, a meta do dia é tudo o que falta.

**Fonte**
- "No dia seguinte, recalcula a meta somando o que faltou": [00:19:42] (fluxo F3, passo 3; RF04 "se o dia anterior ficou abaixo, a meta de hoje é recalculada").
- Regra-base da Sprint 3 ("esperado ao fim de hoje − realizado até ontem, nunca negativa").

**Exemplo** (Ágape, dia 8: esperado ao fim do dia 8 = 45; parte da curva = 45 − 40 = 5)

| Realizado até o fim do dia 7 | 42 | 40 | 30 | 50 |
|---|---|---|---|---|
| Meta do dia 8 | 3 | 5 | 15 | 0 |

**Função:** `metaDoDia`.

### R4. Situação (em dia, abaixo) e ritmo

**Regra**
- **Esperado de uma janela** = esperado até o fim de **ontem** (dias fechados), dentro da janela.
- **Em dia** quando o realizado até agora (inclusive o de hoje) ≥ esperado (SUPOSIÇÃO S1); senão **abaixo**. `diferenca = realizado − esperado` ("estamos 30 abaixo"). Com meta zero na janela (célula sem pessoas, S6, ou período a 0%), **sem meta**.
- Quem estava abaixo ontem fica em dia assim que vende hoje o que faltou; a meta do dia (R3) segue à parte e diz quanto falta para fechar hoje no ritmo.
- **Ritmo** (`ritmo_bp`) = realizado até ontem ÷ esperado até ontem (só dias fechados, para a venda parcial de hoje não inflar; SUPOSIÇÃO S20). Null enquanto o esperado é zero (1º dia da janela).
- Janelas: a campanha inteira e o período atual. No período, meta = M × peso do período e esperado = parte do período já fechada.

**Fonte**
- Comparar o resultado com a curva ao longo do dia e avisar o grupo ("estamos 30 abaixo"): [00:19:29]–[00:19:37] (F3, passo 2).
- Quem está acima ou abaixo da meta; ritmo do dia, da semana e do projeto: RF05, [00:28:35]–[00:28:45], [00:39:04].
- Critério de aceite da missão 6 (DevMission): "no dia 8 de 21, uma célula com 35% da meta aparece em dia".

**Exemplo: o critério "dia 8 de 21"**
- Ágape vendeu 6 por dia nos dias 1 a 7 (42 = 35% da meta 120). No dia 8, o esperado até ontem é 120 × 1/3 = 40: **em dia**, diferença +2, ritmo 105%.
- Com 39 até ontem: abaixo (−1). Se a regra comparasse com o fim de hoje (45), a célula de 35% estaria abaixo, contra o critério.
- Sem normalização (35/25/40), o esperado é exatamente 42: 42 está em dia e 41 não.

**Função:** `situacaoDoRitmo` (dentro dos montadores, por janela).

### R5. Projeção

**Regra**
- Projeção do fim da campanha = realizado até ontem ÷ F(dias fechados), na unidade da meta (para baixo). Em % da meta, é o próprio ritmo: "no ritmo atual, chega a 87% da meta".
- Antes do início e no 1º dia: **null** (não há dia fechado com esperado). Depois do fim: o resultado final (F = 100%).
- A venda parcial de hoje não entra (SUPOSIÇÃO S4).

**Fonte**
- O painel mostra a projeção: RF05, [00:39:04]; o gestor acompanha "ritmo do dia, da semana e do projeto, além dos rankings e da projeção" (F3, passo 1).
- Regra-base da Sprint 3 ("com a razão realizado ÷ esperado até agora, projete o fim").

**Exemplo** (Ágape, meta 120)

| Dias fechados | Vendido até ontem | Projeção | % da meta |
|---|---|---|---|
| 0 (dia 1) | 0 | null | null |
| 7 (dia 8) | 42 | 126 | 105% |
| 7 (dia 8) | 35 | 105 | 87,5% |
| 21 (encerrada) | 90 | 90 | 75% |

**Função:** `projecaoDoFim`.

### R6. Dia local e janela da campanha

**Regra**
- O dia de uma venda é o dia de `aprovado_em` no fuso da campanha (`America/Belem`: UTC−3 fixo, sem horário de verão).
- Uma venda **conta** se o dia local está entre o primeiro e o último dia da campanha: em UTC, `[início do 1º dia às 00:00 local, fim do último dia)`.
- Venda aprovada antes do início (ex.: compra de teste na reunião de cadastro dos líderes) ou depois do fim **não entra** em meta, realizado, ranking nem bumbo. A coordenação vê esse número à parte em `vendas_fora_da_janela` do painel da campanha (SUPOSIÇÃO S8).
- Venda sem célula (sem afiliado, afiliado não vinculado ou célula que não existe mais) conta no total da campanha e aparece em `vendas_sem_celula`; não entra em divisão, rede, discipulador nem ranking (SUPOSIÇÃO S7).

**Fonte**
- Fuso da campanha para dia e semana: decisão D8 de [integracao-rifei.md](integracao-rifei.md); "dia local" em [modelo-de-dados.md](modelo-de-dados.md), seção 7.1.
- Cadastro ao vivo dos líderes numa reunião antes do lançamento: [00:31:34]–[00:32:02]; compra de teste de valor mínimo para conferir o webhook: missão 13 (DevMission).
- Só conta venda paga: RF03 e D4.
- Regra-base da Sprint 3 (janela local; venda antes do início ignorada).

**Exemplo** (início em 23/11/2026, fim em 13/12/2026)

| `aprovado_em` (UTC) | Hora em Belém | Conta? |
|---|---|---|
| 2026-11-20T15:00:00.000Z | 20/11 12:00 (reunião de cadastro) | não (antes do início) |
| 2026-11-23T02:59:59.999Z | 22/11 23:59:59 | não |
| 2026-11-23T03:00:00.000Z | 23/11 00:00 | sim (dia 1) |
| 2026-12-14T02:59:59.999Z | 13/12 23:59:59 | sim (dia 21) |
| 2026-12-14T03:00:00.000Z | 14/12 00:00 | não (depois do fim) |

Janela UTC: `2026-11-23T03:00:00.000Z` (inclusive) a `2026-12-14T03:00:00.000Z` (exclusive). A data de referência também vira às 03:00Z: às 02:59Z de 30/11 ainda é o dia 7.

**Funções:** `hojeNoFuso` (hoje), `diaLocalDoInstante` (um instante qualquer; delega para `hojeNoFuso`), `intervaloUtcDoDia`, `janelaUtcDaCampanha`, `vendaContaNaCampanha`, `agruparVendasPorDia`.

### R7. Fase, dia N de total e período atual

**Regra**
- **antes** (data < 1º dia): `dias_para_inicio` (véspera = 1), `dias_restantes` = duração, sem dia nem período.
- **durante**: `dia_campanha` N de `duracao_dias`; `dias_restantes` conta hoje (no último dia = 1); `periodo` com ordem, nome, datas, `dia_no_periodo` e `dias_restantes` do período (contando hoje).
- **encerrada** (data > último dia): `dias_restantes` = 0, sem dia nem período.

**Fonte**
- Calendário da campanha: `calendario.ts` (datas dos períodos e data final); [modelo-de-dados.md](modelo-de-dados.md), seção 7.1. Marcos M4 (1º dia de vendas) e M6 (fim) do requisito.

**Exemplo:** 30/11 → durante, dia 8 de 21, 14 dias restantes, Semana 2 (dia 1 de 7, 7 restantes). 20/11 → antes, faltam 3 dias. 14/12 → encerrada.

**Função:** `referenciaDaCampanha`.

### R8. Ranking

**Regra**
- **Níveis:** célula, discipulador e rede. Filtro opcional de divisão (jovens ou adultos): são rankings separados (SUPOSIÇÃO S15). Com `ranking.por_divisao` desligado na campanha (RIFA-061, D27), o filtro é ignorado e o ranking é um só, de todas as células (`rankingPorDivisao` em `calculos.ts`).
- **Janela:** `atual` = período que contém a data (antes do início, o 1º; depois do fim, o último: SUPOSIÇÃO S18); `campanha` = do 1º dia até a data. Na consulta, a janela é o enum `JanelaRanking` (`atual` | `campanha`); na resposta, o objeto `janela` (tipo, ordem, nome e datas), com o tipo nomeado `JanelaRankingResposta`.
- **Critério** (`ranking.criterio`, configurado):
  - `percentual_meta`: realizado na janela ÷ meta da instância na janela (na semana, M × peso da semana), em pontos-base truncados. Dividir pelo esperado daria a mesma ordem, porque a fração do tempo é igual para todos.
  - `bilhetes`: bilhetes vendidos na janela.
  - `arrecadacao`: centavos arrecadados na janela.
- **Empates** dividem a posição: 1º, 1º, 3º. Empate = mesmo valor do critério (no % da meta, o mesmo número de pontos-base). Dentro do empate, a lista segue o nome (português, sem diferenciar acentos e maiúsculas; "Célula 2" antes de "Célula 10") (SUPOSIÇÃO S10).
- Sem meta na janela, no critério % da meta: vai para o fim, empatado com os outros sem meta. Nos outros critérios, entra normalmente.
- **Vizinhos:** cada item traz `acima` (o último da posição anterior) e `abaixo` (o primeiro da posição seguinte), com a posição e a distância no critério (pontos-base, bilhetes ou centavos). Empatados não são vizinhos entre si (SUPOSIÇÃO S19). É a base da visão individual (RF08).
- Cada item traz também meta, esperado, realizado, diferença e situação na janela (R4): é a lista de "quem está acima ou abaixo da meta".
- Instâncias sem nenhuma célula (ex.: discipulador recém-criado) não aparecem.

**Fonte**
- Rankings por célula, discipulador e rede; ranking da semana; cada um vê a própria posição e quem está logo acima e logo abaixo; adultos e jovens separados para a premiação: RF06, [00:24:17]–[00:24:23], [00:28:45]–[00:29:02], [00:22:05]–[00:22:41].
- DevMission, decisão 7: o ranking classifica por % da meta, não por bilhetes absolutos; a escolha oficial está pendente (pendência 9), por isso o critério é configuração.

**Exemplo** (janela campanha; metas: Ágape 120, Betel 60, Canaã 120, Dorcas 200, Éfeso 100)

| Célula | Bilhetes | Arrecadação | % da meta | Posição por % | por bilhetes | por arrecadação |
|---|---|---|---|---|---|---|
| Betel | 45 | R$ 900,00 | 75% | 1º | 4º | 4º |
| Ágape | 60 | R$ 1.080,00 | 50% | 2º | 2º | 3º |
| Canaã | 60 | R$ 1.200,00 | 50% | 2º | 2º | 2º |
| Dorcas | 70 | R$ 1.400,00 | 35% | 4º | 1º | 1º |
| Éfeso | 0 | R$ 0,00 | 0% | 5º | 5º | 5º |

No critério % da meta, Ágape tem `acima` = Betel (1º, 2500 pontos-base) e `abaixo` = Dorcas (4º, 1500).

**Funções:** `classificarRanking` (posições e vizinhos de qualquer lista) e `montarRankingPainel`.

### R9. Visão pública

**Regra**
- **Nunca valores em unidades, R$ ou bilhetes**, com qualquer configuração: `/api/publico/*` não devolve R$, centavos, quantidade de bilhetes, meta, esperado, realizado, diferença nem projeção em unidades, nem nos campos nem no texto do bumbo. Os percentuais (da meta, da curva e da projeção) podem aparecer. Os schemas são estritos, um teste varre os campos contra uma lista fechada e outro varre o texto do bumbo.
- **Exceção (RIFA-094, D42): os avisos de venda** (`GET /api/publico/vendas-recentes`) trazem a quantidade de bilhetes **de cada venda** dos últimos 10 minutos (eram 3 até a RIFA-096), com o nome da célula (pedido do PO: "célula X vendeu 3"). Nunca totais, R$, comprador, número de bilhete ou id; a opção `publico.avisos_de_venda` desliga. Lista fechada própria nos testes.
- Ranking público: mesma ordem e mesmas posições da coordenação, só com posição, nome, divisão e, **se** `publico.mostra_percentual_meta`, o % da meta.
- Aparecem só as instâncias que já venderam na janela (SUPOSIÇÃO S9), com posição até `publico.limite_ranking` (padrão 3; null = todas). Quem empata na última posição entra (1, 2, 3, 3).
- Sempre na data de hoje (sem `data`). Antes da primeira venda, a lista é vazia; `referencia` permite à tela contar os dias.

**Fonte**
- O que vai para o grupo mostra só o 1º, o 2º e o 3º lugares e esconde os valores financeiros, a pedido do pastor, para não desanimar quem está atrás: RF07, [00:40:16]–[00:41:33]; risco R7.
- DevMission, decisão 7: o ranking público não mostra valores, e a permissão é do servidor, não da tela.
- Configuração `publico` em `dominio.ts` (`PUBLICO_PADRAO`: sem %, top 3).
- Bilhetes também ficam de fora das rotas abertas: ajuste da Sprint 3 (RIFA-008b).

**Exemplo:** Betel 75%, Ágape 50%, Canaã 40%, Dorcas 40%, Éfeso sem venda → público: 1º Betel, 2º Ágape, 3º Canaã, 3º Dorcas (Éfeso não aparece).

**Função:** `montarRankingPublico`.

### R10. Bumbo do dia

**Regra**
- Texto pronto para colar no grupo de WhatsApp dos líderes, gerado para o dia `data` (padrão hoje) e **sempre sobre o dia anterior, já fechado**: as vendas de hoje não mudam o texto.
- Partes (SUPOSIÇÕES S11 a S13):
  1. Cabeçalho: nome da campanha e "Dia N de total".
  2. **Venda de ontem**: % da meta do dia de ontem (R3). Se a meta de ontem já estava coberta, diz isso.
  3. **Acumulado contra a curva**: % da meta da campanha e o % que a curva esperava até ontem; depois, em dia ou abaixo da curva e a projeção ("no ritmo atual, chegamos a X% da meta").
  4. **Posições**: top 3 das células no período que contém ontem, por divisão (jovens e adultos separados; com `ranking.por_divisao` desligado, D27, um ranking só, de todas, sem o título da divisão), pelo critério configurado, como no ranking público (só quem vendeu; nunca mais posições que `publico.limite_ranking`: SUPOSIÇÃO S21). No período que acabou ontem, "resultado final". Cada divisão lista no máximo 5 células (`NOMES_POR_DIVISAO_NO_BUMBO`); as demais empatadas viram "e mais N empatadas no Pº lugar", para o texto caber sempre nos 4000 caracteres (SUPOSIÇÃO S22; o pior caso, 72 células empatadas com nomes de 120 caracteres, dá 2436).
  5. **As 3 células que mais subiram ontem**: maior avanço ontem em % da própria meta (justo entre células de tamanhos diferentes); empate pelo nome.
  6. **Chamada final**: dias que faltam e o convite a compartilhar o seu link de afiliado (o link da Rifei do líder, como o site diz em tudo) com quem é de fora da igreja. Antes do início, "Confira se o seu link de afiliado está pronto para compartilhar!".
- Nunca R$, centavos nem quantidade de bilhetes (R9), com qualquer configuração. `montarBumbo` ainda aceita `OpcoesBumbo` como 4º argumento, por compatibilidade, e o ignora: `mostrar_bilhetes` fica para um bumbo interno da coordenação (pendência na seção 6). % por célula (no ranking e no "quem mais subiu") só se `publico.mostra_percentual_meta`; os % da campanha aparecem sempre.
- Fases: antes do início, contagem regressiva; no 1º dia, a largada; no último dia, "hoje é o último dia"; depois do fim, o resultado final e o ranking final da campanha (no dia seguinte ao fim, também a venda do último dia).
- Percentuais em números inteiros truncados ("33%"); datas em "dd/mm"; *negrito* e _itálico_ do WhatsApp.

**Fonte**
- DevMission, decisão 9: o sistema monta a mensagem com a venda de ontem, o acumulado contra a curva, as 3 células que mais subiram e uma chamada final; o coordenador encaminha (sem integração com o WhatsApp).
- Quem "toca o bumbo" alimenta o grupo dos líderes: [00:18:35]–[00:18:47], [00:22:09]–[00:22:20]; copia a visão sem valores, só com os 3 primeiros, e anuncia quem passou quem e quem lidera: [00:22:28]–[00:22:34], [00:40:58]–[00:41:27] (F3, passo 4).
- Rankings separados de jovens e adultos: [00:28:45]–[00:29:02]. Vender para fora da igreja: [00:24:33]–[00:25:05].
- Regra-base da Sprint 3 (texto sem R$, em % e posições); sem bilhetes em nenhuma configuração: ajuste da RIFA-008b.

**Exemplo** (dia 9 do cenário dos testes, sobre o dia 8: meta da campanha 600, meta do dia 8 = 221 − 159 = 62, vendidos 21)

```text
*Rifa Videira Kids · Dia 9 de 21*

*Ontem (dia 8):* vendemos 33% da meta do dia.
*Acumulado:* 30% da meta. Pela curva, o esperado até ontem era 36%.
Estamos abaixo da curva: no ritmo atual, chegamos a 81% da meta.

*Ranking · Semana 2 (até ontem)*
_Jovens_
1º Célula Betel
2º Célula Ágape
_Adultos_
1º Célula Dorcas

*Quem mais subiu ontem:* Célula Betel, Célula Ágape e Célula Dorcas.

Faltam 13 dias e dá para virar o jogo: compartilhe hoje o seu link de afiliado com quem é de fora da igreja!
```

**Função:** `montarBumbo(entrada, { data }, agora)` (um 4º argumento `OpcoesBumbo` é aceito e ignorado).

### R11. Arredondamento e exatidão

Resumo da seção 1, com a fonte:
- Dinheiro em centavos inteiros e percentuais em pontos-base inteiros: convenções do contrato (`dominio.ts`, D2).
- Metas e esperados exatos no cálculo, arredondados só na exibição: a antiga seção 7.2 de [modelo-de-dados.md](modelo-de-dados.md).
- Percentual truncado, para nunca mostrar 100% antes da hora: `formatarPercentual` do site ([frontend.md](frontend.md)).
- Regra-base da Sprint 3 ("nada de float acumulado sem controle").

---

## 3. Suposições para o PO

Decisões nossas, simples e reversíveis, que o PO precisa confirmar ou trocar:

1. **S1. "Em dia" compara com o esperado até o fim de ontem.** O dia de hoje tem a meta do dia à parte. É o que faz valer o critério "dia 8 de 21 → em dia"; comparar com o fim de hoje deixaria todos "abaixo" de manhã.
2. **S2. A sobra também conta:** quem vendeu acima ontem tem a meta de hoje reduzida (nunca abaixo de zero).
3. **S3. A falta acumula na campanha inteira:** não zera na virada da semana. O ritmo e o ranking "da semana" usam só a meta da semana.
4. **S4. A projeção usa só os dias fechados** (a venda parcial de hoje não entra). Não aparece antes do início nem no 1º dia; depois do fim, é o resultado.
5. **S5. Meta proporcional mostrada para cima:** cada célula arredonda para cima, e a soma das metas mostradas pode passar do total por alguns bilhetes (a da campanha é exata).
6. **S6. Célula com 0 pessoas** fica sem meta nas regras por pessoa e recebe a meta cheia na regra fixa; no ranking por %, quem não tem meta vai para o fim.
7. **S7. Vendas sem célula** contam no total da campanha, mas em nenhuma divisão, rede ou ranking.
8. **S8. Vendas fora da janela** (antes do 1º dia ou depois do último) não contam em nada e aparecem só no painel da campanha, em `vendas_fora_da_janela`.
9. **S9. O público vê só quem já vendeu:** antes da primeira venda, o ranking público fica vazio; células zeradas nunca aparecem.
10. **S10. Empate** = mesmo valor do critério (no % da meta, até a 2ª casa decimal); a ordem dentro do empate é alfabética.
11. **S11. Bumbo sobre ontem:** venda de ontem em % da meta do dia; acumulado em % da meta, com o esperado da curva e a projeção; posições do período que contém ontem, por divisão; na campanha encerrada, ranking final da campanha.
12. **S12. "As 3 que mais subiram"** = maior avanço ontem em % da própria meta, e não posições ganhas no ranking (que não existem no 1º dia e mudam de janela na virada da semana).
13. **S13. % por célula no bumbo** só quando `publico.mostra_percentual_meta` está ligado; os % da campanha aparecem sempre.
14. **S14. Bilhetes no bumbo:** nunca no bumbo público (regra R9, ajustada na RIFA-008b). A opção `mostrar_bilhetes` fica para um bumbo interno da coordenação, que ainda não existe (pendência na seção 6).
15. **S15. Ranking só de célula, discipulador e rede;** a comparação jovens × adultos fica no painel (escopo divisão), não num ranking de dois itens.
16. **S16. Redação do bumbo** (frases, chamada, negrito do WhatsApp, sem emojis) é proposta e pode ser ajustada sem mexer nas regras.
17. **S17. Data passada no painel e no ranking** mostra o retrato do fim daquele dia; data futura é recusada (400).
18. **S18. Janela "atual" fora da campanha:** antes do início, é o 1º período (todos zerados, empatados); depois do fim, o último período.
19. **S19. Empatados não são vizinhos:** `acima` é o último da posição anterior e `abaixo` o primeiro da posição seguinte; quem divide a posição não aparece como vizinho do outro.
20. **S20. `ritmo_bp` usa só os dias fechados** (realizado até ontem ÷ esperado até ontem), como a projeção (S4): a venda parcial de hoje não o infla.
21. **S21. O limite público também corta o bumbo:** o bumbo mostra no máximo 3 posições por divisão, e menos se `publico.limite_ranking` for menor.
22. **S22. Empates longos no bumbo:** cada divisão lista no máximo 5 células; as demais empatadas viram "e mais N empatadas no Pº lugar", para o texto sempre caber nos 4000 caracteres.

Perguntas que continuam abertas no requisito e afetam estes números: P3 (meta, preço e a divisão por semana, já que 35/25/45 somam 105%) e P4 (critério oficial da premiação: % da meta ou absoluto, por célula ou por rede).

---

## 4. O que mudou em relação à antiga seção 7 de modelo-de-dados.md

| Ponto | Seção 7 (antes) | Agora |
|---|---|---|
| Esperado do ritmo e da situação | até o fim de hoje ("considera o dia de hoje inteiro") | até o fim de ontem (R4, S1) |
| Meta do dia | "meta ajustada" = o que falta da meta do período ÷ dias restantes do período | esperado ao fim de hoje − realizado até ontem, sobre a campanha (R3, S3) |
| Projeção | realizado acumulado ÷ F(hoje) | realizado até ontem ÷ F(ontem) (R5, S4) |
| Nível `divisao` no ranking | existia | saiu (S15); a divisão é filtro |
| Ranking público | top N de todos | top N de quem já vendeu (S9) |
| Vendas fora da janela | não tratadas | excluídas e mostradas à parte (R6, S8) |

---

## 5. Como o Worker alimenta as funções

> Atualização (RIFA-PAINEL-api): a consulta real não usa mais a view `vendas_aprovadas`; agrega `pedidos` por
> afiliado × dia local com o índice da migração 0003 e resolve a célula depois (src/worker/db/painel.ts, docs/decisions.md D10).
> O resultado é o mesmo descrito abaixo.

1. Campanha ativa (`buscarCampanhaAtiva`): sem ela, as quatro rotas respondem 404 `nao_encontrado`.
2. **Todas** as células com a hierarquia (id, nome, `qtd_pessoas`, discipulador, rede, divisão). Um `Celula` do contrato serve. Mesmo num escopo menor, passe todas: a regra `total_proporcional` reparte o total entre todas.
3. Vendas aprovadas agrupadas por célula e dia local (`VendasDoDia`: `celula_id`, `dia`, `pedidos`, `bilhetes`, `centavos`), de qualquer data: as funções separam o que está fora da janela.
   - No banco, para `America/Belem` (UTC−3 fixo), o dia local é `date(aprovado_em, '-3 hours')`, o mesmo que `diaLocalDoInstante`:
     `SELECT celula_id, date(aprovado_em, '-3 hours') AS dia, count(*) AS pedidos, sum(qtd_bilhetes) AS bilhetes, sum(total_centavos) AS centavos FROM vendas_aprovadas WHERE campanha_id = ?1 GROUP BY celula_id, dia`.
     São no máximo (células + 1) × dias linhas, o que cabe folgado no limite de CPU do Worker.
   - Para um fuso com horário de verão, leia as linhas e agrupe no Worker com `agruparVendasPorDia`.
   - Para filtrar por instante (ex.: contar só a janela), use `janelaUtcDaCampanha`.
4. Para conferir a `data` consultada (no máximo hoje), use `hojeNoFuso(campanha.fuso_horario, agora)` e `diasEntre`.
5. Chame `montarResumoPainel`, `montarRankingPainel`, `montarRankingPublico` ou `montarBumbo(entrada, { data }, agora)` com `agora = new Date()`. A resposta já é a do schema da rota.

Tipos nomeados para as telas, em `calculos.ts`: `MetaDoDia`, `PontoCurva`, `RitmoCampanha`, `VendasForaDaJanela`, `PeriodoDaReferencia`, `ItemRankingPublico`, `VizinhoRanking`, `VinculoRanking` e `JanelaRankingResposta`, além dos tipos das respostas reexportados de `api.ts` (`RespostaPainelResumo`, `RespostaRanking`, `ItemRanking`, `ReferenciaCampanha`, `Ritmo` e outros).

---

## 6. Pendências

- **Bumbo interno da coordenação, com quantidade de bilhetes.** O bumbo das rotas abertas nunca mostra bilhetes (R9). Um texto interno, para a coordenação, pode mostrar: precisa de uma rota da coordenação e de um campo na configuração da campanha. Até lá, `OpcoesBumbo.mostrar_bilhetes` e `BUMBO_PADRAO` ficam no contrato sem efeito.
