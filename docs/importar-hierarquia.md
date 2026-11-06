# Como preencher e importar a planilha das células

Para quem prepara a lista das células na igreja e para a coordenação da campanha, que importa o arquivo no sistema.
A importação cadastra de uma vez as redes, os discipuladores e as células, com o número de pessoas (a base da meta) e os dados do líder.

## Resumo

1. Baixe o modelo [`docs/modelos/hierarquia-modelo.csv`](modelos/hierarquia-modelo.csv).
2. Abra no Google Planilhas ou no Excel, apague as 2 linhas de exemplo e preencha **uma linha por célula**.
3. Exporte em **CSV UTF-8** (passo a passo abaixo).
4. Importe o arquivo na área da coordenação: primeiro **simulando** (confere tudo e não grava nada), depois de verdade.

## A planilha: uma linha por célula

Cada linha descreve uma célula e repete o discipulador e a rede dela. É assim que o sistema monta a hierarquia (rede → discipulador → célula).

| Coluna | Obrigatória | O que preencher | Exemplo |
|---|---|---|---|
| `rede` | sim | nome da rede (até 120 caracteres) | Rede Jovem Norte |
| `divisao` | sim | `jovens` ou `adultos` (maiúsculas também valem) | jovens |
| `rede_responsavel` | não | pastor ou obreiro da rede; basta preencher em uma das linhas da rede | Pastor Fulano |
| `discipulador` | sim | nome do discipulador (até 120 caracteres) | Discipulador Beltrano |
| `celula` | sim | nome da célula (até 120 caracteres); cada célula aparece em uma linha só | Célula Esperança |
| `qtd_pessoas` | sim | número inteiro de 1 a 1000, sem ponto, vírgula ou texto: é a base da meta da célula | 12 |
| `lider_nome` | sim | nome do líder (até 120 caracteres) | Ciclana de Tal |
| `lider_email` | não | e-mail do líder | lider@example.com |
| `lider_telefone` | não | telefone do líder, com DDD (texto livre, até 40 caracteres) | (91) 90000-0001 |

Regras do arquivo:

- **A primeira linha é o cabeçalho**, com os nomes das colunas acima. A ordem das colunas não importa; maiúsculas e acentos no cabeçalho também não (`Divisão` vale como `divisao`). Colunas a mais, como "observações", são ignoradas.
- **Nomes são comparados sem diferenciar maiúsculas e sem os espaços das pontas**: "Rede Jovem" e "REDE JOVEM " são a mesma rede. Acentos contam: "Célula Ágape" e "Celula Agape" são células diferentes. A grafia que vale é a da primeira linha em que o nome aparece.
- **O arquivo precisa ser coerente**:
  - a mesma rede sempre com a mesma divisão (e, quando preenchido, com o mesmo responsável);
  - o mesmo discipulador sempre na mesma rede. Se forem duas pessoas com o mesmo nome, diferencie (ex.: "João Silva" e "João Souza");
  - cada célula em uma linha só.
- Linhas em branco são ignoradas.
- No máximo **2000 linhas** de dados e 1 MB por arquivo.

## Preencher e exportar

### Google Planilhas

1. Crie uma planilha em branco e use **Arquivo > Importar > Fazer upload**, escolhendo o modelo. Em "Tipo de separador", deixe "Detectar automaticamente" (se as colunas não se separarem, escolha "Personalizado" e digite `;`).
2. Apague as 2 linhas de exemplo e preencha uma linha por célula.
3. Exporte em **Arquivo > Fazer download > Valores separados por vírgula (.csv)**. O arquivo sai em UTF-8, como o sistema espera.

### Excel

1. Abra o modelo com dois cliques. Ele vem com `;` e marca de UTF-8 (BOM) para o Excel em português separar as colunas e mostrar os acentos certos.
2. Apague as 2 linhas de exemplo e preencha uma linha por célula.
3. Salve em **Arquivo > Salvar como**, tipo **"CSV UTF-8 (Delimitado por vírgulas)"**.
   Não use o tipo "CSV (separado por vírgulas)": ele grava em outra codificação, os acentos se perdem e o sistema recusa o arquivo com a mensagem "O arquivo não está em UTF-8".

### Cuidados com números e telefones

- `qtd_pessoas` é só o número: `12`. Não use `12,5`, `1.000` ou `12 pessoas`.
- O Excel pode transformar telefones digitados só com números em notação científica (`9,19E+10`). Digite com parênteses e hífen (`(91) 90000-0001`) ou formate a coluna como Texto antes de digitar.

## Importar

Envie o arquivo pela importação da hierarquia, na área da coordenação.

- **Simule primeiro.** A simulação valida o arquivo inteiro e mostra quantas redes, discipuladores e células seriam criados, atualizados ou ficariam iguais, com os erros de cada linha. Nada é gravado.
- Sem erros, importe de verdade: o resultado é o mesmo da simulação, agora gravado.
- Para quem integra pela API: `POST /api/admin/hierarquia/importar` com `{ "csv": "<conteúdo do arquivo>", "simular": true }`. O formato da resposta está em [api.md](api.md#post-apiadminhierarquiaimportar-coordenacao).

### O que a importação faz

- **Cria** o que ainda não existe e **atualiza** o que mudou: o número de pessoas, os dados do líder, uma célula que mudou de discipulador, um discipulador que mudou de rede, a divisão de uma rede.
- **Nunca apaga.** O que não está no arquivo continua no sistema como está. Para excluir, use as telas de cadastro.
- **Coluna opcional fora do cabeçalho mantém o valor atual.** Ex.: um arquivo sem a coluna `lider_email` não mexe nos e-mails já cadastrados. **Coluna presente e vazia apaga o valor.**
- **Tudo ou nada.** Se qualquer linha tiver erro, nada é gravado. Corrija a planilha e importe de novo.
- Importar de novo o mesmo arquivo não muda nada (tudo aparece como "inalterado"). Por isso dá para corrigir e reenviar a planilha inteira quantas vezes for preciso.

## Erros e como corrigir

Os erros de linha trazem o número da linha na planilha (o cabeçalho é a linha 1), a coluna e a mensagem.

| Mensagem | O que fazer |
|---|---|
| Preencha esta coluna | a coluna é obrigatória e está vazia nessa linha |
| Use um número inteiro | `qtd_pessoas` com vírgula, ponto ou texto: deixe só o número |
| Use um número a partir de 1 / até 1000 | `qtd_pessoas` fora do intervalo de 1 a 1000 |
| Use "jovens" ou "adultos" | `divisao` com outro valor |
| E-mail inválido | confira o `lider_email` ou deixe a célula vazia |
| Use no máximo 120 (ou 40) caracteres | encurte o texto |
| A rede "X" já aparece na linha N com a divisão "jovens" | a mesma rede está com divisões diferentes: escolha uma |
| A rede "X" já aparece na linha N com o responsável "Y" | a mesma rede está com responsáveis diferentes: deixe um só (ou preencha só uma linha) |
| O discipulador "X" já aparece na linha N na rede "Y" | o discipulador está em duas redes; se forem pessoas diferentes, diferencie os nomes |
| A célula "X" já aparece na linha N | linha repetida, ou duas células com o mesmo nome: apague a repetida ou diferencie os nomes |

Alguns problemas impedem a leitura do arquivo inteiro (resposta `csv_invalido`, sem relatório por linha):

| Mensagem | O que fazer |
|---|---|
| O arquivo está vazio: a primeira linha precisa ser o cabeçalho... | confira se o arquivo certo foi enviado e se a primeira linha tem os nomes das colunas |
| Faltam colunas obrigatórias no cabeçalho (linha 1): ... | corrija os nomes das colunas citadas (use o modelo) |
| A coluna "X" aparece mais de uma vez no cabeçalho | apague a coluna repetida |
| O arquivo não está em UTF-8 ... | exporte de novo como "CSV UTF-8" (Excel) ou pelo Google Planilhas |
| As aspas abertas na linha N não foram fechadas | confira a linha N: um campo começa com aspas e não termina |
| O arquivo tem N linhas de dados; o limite é 2000 | divida em mais de um arquivo |

## Sobre o modelo

[`docs/modelos/hierarquia-modelo.csv`](modelos/hierarquia-modelo.csv) tem o cabeçalho com as colunas do contrato e 2 linhas de exemplo fictícias, uma de cada divisão (a segunda mostra as colunas opcionais vazias). Ele é salvo em UTF-8 com BOM, separado por `;` e com fim de linha CRLF, que é como o Excel em português abre e grava sem estragar os acentos. Um teste automatizado garante que o modelo importa sem erro.

Se as linhas de exemplo forem importadas por engano, exclua-as pelas telas de cadastro, porque a importação nunca apaga nada.
