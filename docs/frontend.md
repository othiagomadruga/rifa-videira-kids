# Front-end (site React)

Convenções do site em `src/web/`. Stack e comandos: seção "Stack e comandos" do `CLAUDE.md`. Decisões técnicas: `docs/decisions.md`.

Princípios: celular primeiro, sem rolagem horizontal em 390 px; CSS puro com variáveis (sem biblioteca de UI ou de CSS, sem fonte externa, sem CDN); acessibilidade AA; **o público nunca vê valores em R$**.

## Estrutura de pastas

```
src/web/
  main.tsx              entrada: createBrowserRouter(rotas) + <App>
  App.tsx               <RouterProvider>; o roteador vem de fora (navegador ou memória nos testes)
  rotas.tsx             tabela de rotas do site
  styles.css            CSS global: importa tema/tokens.css e tema/base.css
  tema/                 tokens.css (variáveis), base.css (reset, foco, utilitários), marca.ts (nomes)
  lib/                  api.ts (cliente da API) e formatadores.ts (pt-BR)
  components/ui/        componentes base; importe de "components/ui" (index.ts)
  components/EmConstrucao.tsx   aviso das telas que ainda são só a casca
  pages/<tela>/         uma pasta por tela: componente, CSS, chamadas à API e testes da tela
  test/                 setup.ts e renderizar.tsx (ajudantes de teste)
```

## Rotas

| Caminho | Tela (h1) | Pasta em `pages/` | Tarefa | Quem usa |
| --- | --- | --- | --- | --- |
| `/` | Ranking da campanha | `ranking-publico` | RIFA-010/011 | público (WhatsApp), **sem R$** |
| `/telao` | Telão | `telao` | RIFA-011 | telão do culto, **sem R$**, sem navegação |
| `/entrar` | Entrar | `entrar` | RIFA-007 | coordenação |
| `/coordenacao` | Visão geral | `visao-geral` | RIFA-009 | coordenação |
| `/coordenacao/campanha` | Campanha | `campanha` | RIFA-004 | coordenação |
| `/coordenacao/hierarquia` | Hierarquia | `hierarquia` | RIFA-005 | coordenação |
| `/coordenacao/adesao` | Adesão | `adesao` | RIFA-006 | coordenação |
| `/coordenacao/pedidos` | Pedidos | `pedidos` | RIFA-003 | coordenação |
| `/coordenacao/rankings` | Rankings | `rankings` | RIFA-010 | coordenação |
| `/coordenacao/bumbo` | Bumbo | `bumbo` | RIFA-011 | coordenação |
| `/coordenacao/conferencia` | Conferência | `conferencia` | RIFA-012 | coordenação |
| `/status` | Status do sistema | `status` | RIFA-001 | técnico (saúde da API) |
| qualquer outra | Página não encontrada | `nao-encontrada` | | todos |

- As telas da coordenação ficam no layout com menu (`pages/coordenacao/`). A lista `TELAS_COORDENACAO` em `pages/coordenacao/telas.ts` gera as rotas filhas **e** o menu.
- `/`, `/entrar`, `/status` e a 404 usam o layout aberto (`PublicShell`: marca + conteúdo, sem navegação). `/telao` não usa layout.
- Uma tela que quebra ao renderizar mostra `pages/erro/ErroRota.tsx` (na coordenação, dentro do layout, sem perder o menu).
- O Worker devolve o `index.html` para qualquer caminho fora de `/api/*` (modo SPA); quem decide a tela é o React.

## Como construir uma tela

1. Trabalhe só na pasta da tela (`pages/<tela>/`). A casca já existe e já está ligada à rota e ao menu.
2. No componente `<Tela>Page.tsx`, comece por `<PageHeader titulo="..." />` (vira o `<h1>` e o título da aba) e troque o `<EmConstrucao>` pelo conteúdo.
3. Chamadas à API ficam na própria pasta (ex.: `pages/pedidos/pedidos-api.ts`), usando `api` de `lib/api.ts`. Tipos de requisição e resposta vêm do contrato em `src/shared/contracts`.
4. CSS da tela em `pages/<tela>/<tela>.css`, importado pelo componente. Classes com o prefixo da tela (`.pedidos-filtros`), valores sempre das variáveis do tema. Os componentes base usam o prefixo `ui-`.
5. Mostre os três estados: `<Loading />` enquanto carrega, `<ErrorState mensagem={mensagemDoErro(erro)} aoTentarDeNovo={...} />` na falha e `<EmptyState />` sem dados. Exemplo pronto: `pages/status/StatusPage.tsx`.
6. Cancele a requisição ao sair da tela e ignore o resultado cancelado:

   ```tsx
   useEffect(() => {
     const controle = new AbortController();
     api.get<Resumo>("/api/...", { signal: controle.signal }).then(
       (dados) => setEstado({ tipo: "ok", dados }),
       (erro) => {
         if (!controle.signal.aborted) setEstado({ tipo: "erro", erro });
       },
     );
     return () => controle.abort();
   }, []);
   ```

7. Testes ao lado do código (`<Tela>Page.test.tsx`), renderizando pela rota de verdade (veja "Testes").
8. Arquivos compartilhados (`rotas.tsx`, `pages/coordenacao/telas.ts`, `components/ui/`, `tema/`, `lib/`) só mudam quando a tarefa pedir; diga no relatório o que mudou. Tela nova da coordenação: uma entrada em `telas.ts` (rota e menu juntos) e o caso em `rotas.test.tsx`.

## Componentes base (`components/ui`)

| Componente | Para quê | Props principais |
| --- | --- | --- |
| `AppShell` | Layout da coordenação: barra lateral a partir de 64rem, botão "Menu" no celular (fecha com o próprio botão, Esc, que devolve o foco ao botão, toque fora ou foco saindo do menu; escolher uma tela fecha e leva o foco ao `<main>`), `aria-current="page"` no link atual, link "Pular para o conteúdo" | `area`, `itens` (`{ para, rotulo, exato? }`), `children` |
| `PublicShell` | Layout das telas abertas: marca e conteúdo, sem navegação | `children` |
| `PageHeader` | Cabeçalho da tela: `<h1>` e título da aba ("Pedidos · Rifa Videira Kids") | `titulo`, `descricao?`, `acoes?` |
| `Card` | Cartão de conteúdo | `titulo?` (`<h2>`), `acoes?`, `children` |
| `Button` | Botão (`type="button"` por padrão) | `variante`: `primario` \| `secundario` \| `discreto` \| `perigo`; `tamanho`: `normal` \| `pequeno`; `larguraTotal`; props de `<button>` |
| `classesBotao()` | Cara de botão para links | `<Link className={classesBotao({ variante: "secundario" })}>` |
| `Input`, `Select`, `Textarea` | Campos com rótulo, dica e erro (liga `label`, `aria-describedby` e `aria-invalid`) | `rotulo`, `dica?`, `erro?` e as props nativas; as opções do `Select` vão como filhas |
| `DataTable` | Tabela no computador (a partir de 48rem) e cartões empilhados no celular, com o mesmo HTML | `colunas` (`{ chave, titulo, celula, alinhamento?: "fim", principal? }`), `linhas`, `chaveDaLinha`, `legenda`, `mostrarLegenda?`, `vazio?` |
| `Stat` | Indicador: rótulo, valor e variação | `rotulo`, `valor` (já formatado), `variacao?` (`{ texto, sentido: "subiu" \| "caiu" \| "estavel", tom? }`) |
| `ProgressBar` | Percentual da meta, acessível (`role="progressbar"`, `aria-valuenow` de 0 a 100) | `rotulo`, `valor`, `meta` (mesma unidade), `textoValor?` |
| `Badge` | Status | `tom`: `neutro` \| `info` \| `sucesso` \| `alerta` \| `perigo`; o texto precisa fazer sentido sem a cor |
| `EmptyState` | Nada para mostrar | `titulo`, `descricao?`, `acao?` |
| `ErrorState` | Falha (`role="alert"`) | `titulo?`, `mensagem?`, `aoTentarDeNovo?` (mostra "Tentar de novo") |
| `Loading` | Carregando (`role="status"`) | `texto?` |
| `Marca` | Símbolo e nome (provisórios) | `complemento?` |

Notas:

- `DataTable`: marque a coluna que identifica a linha com `principal` (vira o título do cartão no celular) e use `alinhamento: "fim"` em números e valores. Tabela larga demais rola só dentro dela, nunca a página.
- `ProgressBar` trunca o percentual (99,99% aparece "99%", nunca "100%" antes da hora). Acima da meta, a barra fica cheia, o texto mostra o percentual real ("120%") e a cor muda. O leitor de tela recebe só o percentual, nunca o valor bruto. Nas telas públicas, passe pontos-base: `valor={pontosBase} meta={10000}`.
- Layout: `.pilha` empilha com espaço (`--pilha-espaco` muda o espaço); `.grade` monta uma grade que se ajusta à largura (`--grade-min`, padrão 14rem); `.visualmente-oculto` esconde texto que é só para leitores de tela.

## Cliente da API (`lib/api.ts`)

- `api.get(caminho, opcoes?)`, `api.post(caminho, corpo?, opcoes?)`, `api.put`, `api.patch`, `api.delete`; por baixo, `requisitarJson(caminho, { metodo, corpo, tempoLimiteMs, signal })`.
- Só mesma origem: o caminho começa com `/` (ex.: `/api/pedidos`). URL de outro host, `//host` ou caminho relativo lança `TypeError` sem fazer a chamada. Cookies da mesma origem vão junto (`credentials: "same-origin"`).
- Envia e recebe JSON. Resposta sem corpo (204) devolve `undefined`. O tipo `T` de `api.get<T>` não é validado em tempo de execução.
- Tempo limite padrão de 10 s (`TEMPO_LIMITE_PADRAO_MS`), mudável por chamada com `tempoLimiteMs`. `signal` cancela a chamada (ex.: ao sair da tela).
- Toda falha vira `ErroApi` com `codigo`, `mensagem` (igual a `message`), `status` (HTTP, ou `null` sem resposta) e `detalhes`:
  - resposta de erro no formato da API, `{ "erro": { "codigo", "mensagem", "detalhes"? } }`: o código e a mensagem da API;
  - erro HTTP fora desse formato: `ERRO_HTTP` ("A API respondeu com falha (HTTP 503).");
  - sem resposta: `SEM_CONEXAO`, `TEMPO_ESGOTADO` ou `CANCELADA`;
  - sucesso com corpo que não é JSON: `RESPOSTA_INVALIDA`.
- `mensagemDoErro(erro)` devolve o texto para o usuário (a mensagem do `ErroApi`, ou um texto genérico para outros erros, sem detalhes internos).

## Formatadores (`lib/formatadores.ts`)

| Função | Entrada | Saída |
| --- | --- | --- |
| `formatarMoeda(centavos)` | centavos inteiros (senão `RangeError`) | `123456` → `"R$ 1.234,56"` (**só na coordenação**) |
| `formatarNumero(valor, { casasDecimais? })` | número | `1234567` → `"1.234.567"`; `(1234.5, { casasDecimais: 2 })` → `"1.234,50"` |
| `formatarPercentual(pontosBase, { casasDecimais?, sinal? })` | pontos-base (1% = 100) | `3500` → `"35%"`; `(1250, { casasDecimais: 1 })` → `"12,5%"`; `(1200, { sinal: true })` → `"+12%"` |
| `formatarData(valor)` | data | `"23/11/2026"` |
| `formatarHora(valor)` | data | `"19:30"` |
| `formatarDataHora(valor)` | data | `"23/11/2026 19:30"` |

- Datas e horas saem sempre no fuso de Belém (`America/Belem`, UTC-3, sem horário de verão), qualquer que seja o fuso do aparelho. Entradas aceitas (`paraData`): `Date`, milissegundos, texto ISO com fuso (`"2026-11-23T22:30:00Z"`); texto de data e hora sem fuso (`"2026-11-23 22:30:00"`) é lido como UTC, o padrão do D1; só a data (`"2026-11-23"`) é o dia do calendário, sem trocar de dia. Data inválida lança `RangeError`.
- `formatarPercentual` trunca (`9999` → `"99%"`), como a `ProgressBar`.
- O Intl põe um espaço não separável (U+00A0) entre "R$" e o número, para não quebrar a linha ali. Nas buscas do Testing Library (`getByText("R$ 1.234,56")`) ele casa com espaço comum; em comparação direta de texto, use `"R$ 1.234,56"`.

## Tema e marca (`tema/`)

- `tokens.css` define as variáveis: cores (`--cor-fundo`, `--cor-superficie`, `--cor-texto`, `--cor-texto-suave`, `--cor-primaria`, `--cor-foco`, estados `--cor-sucesso`/`-suave` etc.), espaçamento (`--espaco-1` a `--espaco-8`, escala de 4 px), raios (`--raio-1` a `--raio-3`, `--raio-pilula`), tipografia (`--fonte-base`, `--texto-xs` a `--texto-4xl`, `--peso-*`), sombras (`--sombra-1` a `--sombra-3`), foco (`--foco-anel`) e medidas (`--largura-conteudo`, `--margem-pagina`, `--alvo-toque`). CSS de tela não usa cor nem tamanho fora delas.
- Fonte do sistema (`system-ui` e equivalentes). Foco visível em tudo (`:focus-visible`). Com `prefers-reduced-motion`, animações e transições param.
- Contraste conferido: texto com pelo menos 4,5:1 e bordas e foco com 3:1 no tema claro (AA); texto com 7:1 ou mais no telão (AAA). Ao mudar uma cor, confira de novo.
- Pontos de quebra (media queries não aceitam variáveis): `48rem` (tabela em vez de cartões) e `64rem` (menu lateral).
- Telão: `data-tema="telao"` no elemento raiz redefine as variáveis (fundo escuro, alto contraste, sem sombras) e cria `--telao-texto-base` (cerca de 46 px em 1920×1080, acompanha largura e altura). Tamanhos do telão em `em` a partir dele, para caber sem rolagem.
- Marca provisória: até chegarem os arquivos oficiais, a marca é neutra. Para trocá-la: cores em `tokens.css` (`--cor-primaria` e família), símbolo em `components/ui/Marca.tsx` (vira a imagem do logotipo), nomes em `tema/marca.ts` e `theme-color` no `index.html`.

## Regras

1. **O público nunca recebe R$.** `/` e `/telao` (e qualquer tela futura aberta ao público) mostram só posições, top 3 e percentuais, nunca valores em dinheiro. Nessas pastas o código não tem `formatarMoeda`, "R$", `currency`, `BRL` nem campos `_centavos`: o `rotas.test.tsx` confere a tela renderizada e o código. Esse teste lê só os arquivos dessas pastas (não segue os imports): tela pública nova entra no `import.meta.glob` dele, e componente usado por tela pública também não formata dinheiro. Esconder no front não basta, porque o que chega ao navegador é público: a tela pública só chama rotas da API que não devolvem valores.
2. Dinheiro em centavos inteiros, percentuais em pontos-base e datas no fuso de Belém, sempre pelos formatadores.
3. Sem bibliotecas de UI ou de CSS, sem fonte externa, sem CDN.
4. Acessibilidade: um `<h1>` por tela (o do `PageHeader`); campo sempre com rótulo; status nunca só pela cor; alvos de toque com 44 px ou mais (`--alvo-toque`); foco visível.
5. Sem rolagem horizontal em 390 px. O telão não rola em 1920×1080.

## Testes

- `npx vitest run --project web` roda só os testes do site (jsdom + Testing Library).
- `renderizarRota("/coordenacao/pedidos")` (em `test/renderizar.tsx`) renderiza o site inteiro com as rotas reais e um roteador em memória, e devolve também o `roteador` (para conferir `roteador.state.location.pathname`).
- Para a API, troque o `fetch`: `vi.stubGlobal("fetch", vi.fn(async () => respostaJson({ ... }, 200)))` e, no `afterEach`, `vi.unstubAllGlobals()`.
- O `@testing-library/user-event` não está instalado: use `fireEvent`.
- Nada de `.only` nem `.skip` no que vai para a `main`.
