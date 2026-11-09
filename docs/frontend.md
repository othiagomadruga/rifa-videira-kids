# Front-end (site React)

Convenções do site em `src/web/`. Stack e comandos: seção "Stack e comandos" do `CLAUDE.md`. Decisões técnicas: `docs/decisions.md`.

Princípios: celular primeiro, sem rolagem horizontal em 390 px (360 px na visão individual); CSS puro com variáveis (sem biblioteca de UI ou de CSS, sem fonte externa, sem CDN); acessibilidade AA; **o público e a hierarquia (líder, discipulador e rede) nunca veem valores em R$**.

## Estrutura de pastas

```
src/web/
  main.tsx              entrada: createBrowserRouter(rotas) + <App>
  App.tsx               <RouterProvider>; o roteador vem de fora (navegador ou memória nos testes)
  rotas.tsx             tabela de rotas do site
  styles.css            CSS global: importa tema/tokens.css e tema/base.css
  tema/                 tokens.css (variáveis), base.css (reset, foco, utilitários), marca.ts (nomes)
  lib/                  api.ts (cliente da API), sessao.tsx (sessão, áreas por papel e guarda) e formatadores.ts (pt-BR)
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
| `/acesso/<token>` | Entrar no sistema da Rifa Videira Kids | `acesso` | RIFA-007/014 | coordenação, líderes, discipuladores e redes (link pessoal do WhatsApp) |
| `/entrar` | Entrar | `entrar` | RIFA-007 | todos com link (sem sessão) |
| `/minha` | o nome do alvo (ex.: Célula Ágape) | `minha` | RIFA-014 | líder, discipulador e rede, **sem R$**, sem menu |
| `/coordenacao` | Visão geral | `visao-geral` | RIFA-009 | coordenação |
| `/coordenacao/campanha` | Campanha | `campanha` | RIFA-004 | coordenação |
| `/coordenacao/hierarquia` | Hierarquia | `hierarquia` | RIFA-005 | coordenação |
| `/coordenacao/adesao` | Adesão | `adesao` | RIFA-006 | coordenação |
| `/coordenacao/pedidos` | Pedidos | `pedidos` | RIFA-003 | coordenação |
| `/coordenacao/rankings` | Rankings | `rankings` | RIFA-010 | coordenação |
| `/coordenacao/bumbo` | Bumbo | `bumbo` | RIFA-011 | coordenação |
| `/coordenacao/conferencia` | Conferência | `conferencia` | RIFA-012 | coordenação |
| `/coordenacao/acessos` | Acessos | `acessos` | RIFA-007/014 | só admin |
| `/status` | Status do sistema | `status` | RIFA-001 | técnico (saúde da API) |
| qualquer outra | Página não encontrada | `nao-encontrada` | | todos |

- As telas da coordenação ficam no layout com menu (`pages/coordenacao/`), **só com sessão de admin ou coordenação** (veja "Sessão e acesso"). A lista `TELAS_COORDENACAO` em `pages/coordenacao/telas.ts` gera as rotas filhas **e** o menu; `papeis: ["admin"]` numa tela tira o link do menu dos outros papéis e mostra "sem permissão" na rota (`pages/coordenacao/ExigirPapel.tsx`).
- `/minha` fica na moldura própria (`pages/minha/MinhaLayout.tsx`: marca com o papel e "Sair", sem menu), **só com sessão de líder, discipulador ou rede**.
- `/`, `/acesso`, `/entrar`, `/status` e a 404 usam o layout aberto (`PublicShell`: marca + conteúdo, sem navegação). `/telao` não usa layout.
- Uma tela que quebra ao renderizar mostra `pages/erro/ErroRota.tsx` (na coordenação e em `/minha`, dentro da moldura, sem perder o menu ou o "Sair").
- O Worker devolve o `index.html` para qualquer caminho fora de `/api/*` (modo SPA); quem decide a tela é o React.

## Como construir uma tela

1. Trabalhe só na pasta da tela (`pages/<tela>/`). A casca já existe e já está ligada à rota e ao menu.
2. No componente `<Tela>Page.tsx`, comece por `<PageHeader titulo="..." />` (vira o `<h1>` e o título da aba) e troque o `<EmConstrucao>` pelo conteúdo.
3. Chamadas à API ficam na própria pasta (ex.: `pages/pedidos/pedidos-api.ts`), usando `api` de `lib/api.ts`. Tipos de requisição e resposta vêm do contrato em `src/shared/contracts`.
   - Painel, rankings, telão e bumbo: regras e tipos (`MetaDoDia`, `PontoCurva`, `ItemRankingPublico`, `hojeNoFuso`…) vêm de `src/shared/contracts/calculos` (sem zod), nunca do index `src/shared/contracts`.
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

## Sessão e acesso (RIFA-007; papéis da hierarquia na RIFA-014)

A API está em `docs/acesso.md` e, para a hierarquia, em `docs/api.md` ("Visão individual e acessos da hierarquia") e na D12 de `docs/decisions.md`. No site:

- **Sessão** (`lib/sessao.tsx`): o `ProvedorSessao` fica na raiz das rotas. O cookie é HttpOnly: o site pergunta a `GET /api/sessao` quem está conectado, e só quando precisa (as guardas e `/entrar`); as telas abertas não fazem chamada por ela. `useSessao()` dá `estado` (`desconhecida`, `verificando`, `conectada` com o `usuario`, `desconectada` com o `motivo`: `sem_sessao`, `expirou` ou `saiu`, e `erro`), `verificar()`, `entrar(token)` e `sair()`. Atrás de uma guarda, `useUsuarioConectado()` devolve `{ id, nome, papel, alvo? }` (`alvo`: a célula, o discipulador ou a rede, só nos papéis da hierarquia); `ROTULO_PAPEL` dá o nome do papel.
- **Áreas por papel** (`lib/sessao.tsx`): admin e coordenação usam `/coordenacao`; líder, discipulador e rede usam só `/minha` (`areaDoPapel`, `inicioDoPapel`; `PAPEIS_DA_HIERARQUIA` é a cópia de `PAPEIS_HIERARQUIA`, conferida por `pages/minha/minha-contrato.test.ts`). Endereço da outra área leva à área do papel, com `replace` (a API recusa do mesmo jeito, com 403).
- **Guarda** (`useGuardaDaArea(area)`, usada por `pages/coordenacao/CoordenacaoLayout.tsx` e `pages/minha/MinhaLayout.tsx`): toda rota da área confere a sessão; enquanto isso, só o carregando ("Conferindo o seu acesso…", `role="status"`). Sem sessão, vai para `/entrar` (com `replace`) e guarda a tela pedida; um 401 de qualquer rota durante o uso (gancho do `lib/api.ts`) faz o mesmo, com o aviso "Sua sessão terminou". Sessão de um papel da outra área: vai para o início da área dele, sem montar a tela (nada é pedido à API da outra área). Falha sem resposta mostra o erro com "Tentar de novo". Os 401 das próprias rotas da sessão não contam (o do `POST /api/sessao` é link inválido e não derruba a sessão aberta).
- **Voltar depois de entrar**: a tela pedida fica no `localStorage` (só o caminho, só caminhos `/coordenacao...` e `/minha...`, por uma hora, apagada ao usar e ao sair), porque o link do WhatsApp costuma abrir outra aba. `/acesso` usa esse destino depois do login e `/entrar` usa o `state.de` quando já há sessão, mas **só se o destino for da área do papel** de quem entrou (`destinoDoPapel`); senão, o início da área dele.
- **`/acesso/<token>`** (`pages/acesso`): o token fica só na memória da tela. Ao abrir, a entrada do histórico vira `/acesso` (`navigate` com `replace`, que no navegador é `history.replaceState` sem o token) antes de a página aparecer; o token não vai para título, `state` do histórico, log nem outra chamada. Nada é pedido à API ao abrir (o preview do WhatsApp abre a URL): só o toque em "Entrar" faz `POST /api/sessao`. Depois de entrar, cada papel vai para a sua área. 401: "Este link não vale mais: peça um link novo à coordenação". Token fora do formato: "Este link está incompleto", sem chamar a API. `/acesso` sem token (recarregou) vai para `/entrar`.
- **`/entrar`** (`pages/entrar`): explica que o acesso é pelo link pessoal, sem senha, que chega pelo WhatsApp. Com sessão, vai para a área do papel (ou para o `state.de`, se for da área). Depois de "Sair", mostra "Você saiu do sistema neste aparelho".
- **Menu e conta**: o `AppShell` recebe `conta` (nome, papel e "Sair": `POST /api/sessao/sair` → `/entrar`). O item "Acessos" só aparece para o admin (`papeis` em `telas.ts`). Em `/minha`, o "Sair" fica na barra do topo, ao lado da marca com o papel.
- **`/coordenacao/acessos`** (`pages/acessos`, só admin), em duas abas (`Abas`; a segunda só carrega, num pacote à parte e com o próprio CSS, `acessos-hierarquia.css`, quando é aberta):
  - **Coordenação**: um cartão por pessoa (nome, papel, ativo, links válidos com "Revogar", aparelhos conectados), "Nova pessoa", "Gerar link novo", "Desativar acesso"/"Reativar acesso" (o próprio cartão não tem "Desativar acesso": a API recusaria com 409). O link com o token só existe na resposta que o cria: a tela o mostra uma vez, num `Dialogo` com o alerta "Este link só aparece agora", "Copiar link" (área de transferência; sem ela, seleciona o link no campo) e "Enviar pelo WhatsApp" (`https://wa.me/?text=` com uma mensagem curta e o link), e o esquece ao fechar. Os 409 `em_uso` aparecem em português, conforme o caso (a si mesmo, o último admin ativo, o último link válido de admin).
  - **Líderes, discipuladores e redes** (`AcessosHierarquia.tsx`, RIFA-014): escolha do papel (`Select`) e a tabela de todos os alvos do papel (`GET /api/admin/acessos-hierarquia?papel=`): alvo, pessoa da hierarquia (com o aviso quando o último link foi para outra pessoa), telefone (só líder), situação (sem link; link válido com o último uso; só revogados ou vencidos; desativado), com os aparelhos conectados. Cada célula da tabela põe o conteúdo num bloco só (`.acessos-celula`): no celular, ela vira "rótulo: valor". "Gerar links para quem ainda não tem" manda num lote só os alvos sem link válido (os desativados ficam de fora: a API recusaria o lote com 409); por linha, "Novo link", "Trocar acesso" (`revogar_anteriores`, com confirmação `alertdialog` que avisa que o aparelho antigo sai), "Revogar link" e "Desativar"/"Reativar" (as rotas da coordenação). Os links gerados aparecem uma vez, num `Dialogo` (`DialogosHierarquia.tsx`) com o aviso, "Copiar mensagem" e "Abrir no WhatsApp" (`https://wa.me/<telefone>?text=`, com o telefone do líder normalizado por `telefoneParaWhatsApp`; sem telefone ou fora do formato, só copiar; sem a área de transferência, a mensagem aparece selecionada no campo). A mensagem sai de `mensagemHierarquia` (`textos.ts`): cumprimenta a pessoa, diz para que é o link e avisa que é pessoal. Os botões ocupados ou sem nada a fazer usam `aria-disabled` (continuam focáveis: o foco volta para eles ao fechar o diálogo).
  - Valores do contrato (caminhos, papéis, limites, formato do token) são cópias, conferidas por `pages/acessos/acessos-contrato.test.ts`.

## Visão individual (`/minha`, RIFA-014)

Para líder, discipulador e rede (o alvo vem só da sessão: a tela não manda id de nada). `GET /api/minha/visao` (`pages/minha/minha-api.ts`), com `periodo=atual` (o ranking da semana) antes e durante a campanha e `periodo=campanha` depois do fim (o resultado final, como o ranking público).

- **Celular primeiro, legível ao sol**: 360 px sem rolagem lateral (`minha-css.test.ts` confere que o CSS não tem largura fixa e o contraste dos pares de texto e fundo; a medida na tela de verdade é das capturas). O % da meta da campanha em destaque, bem grande, com a situação contra a curva (em dia ou abaixo), a projeção e a meta de **hoje** ("Faltam 7 bilhetes hoje"); o período atual; a curva em % da meta (`GraficoLinhas`, pontos-base); o ranking (posição na divisão e no geral, com o **nome e a posição** do vizinho de cima e do de baixo, nunca a distância: D12) e os primeiros da divisão com "Você" (`aria-current`); a equipe do discipulador (as células dele) e da rede (agrupada por discipulador), numa `DataTable`, com o aviso de quem ainda não aderiu (célula sem afiliado vinculado). O líder sem afiliado vinculado vê o aviso para falar com a coordenação.
- **Nunca dinheiro**: com a meta em centavos, as quantidades da meta chegam null e a tela mostra só percentuais (`emBilhetes` em `textos.ts` nunca mostra uma quantidade da meta fora de bilhetes); os bilhetes vendidos (campo `bilhetes`, que não é dinheiro) aparecem com qualquer unidade. `guarda-minha.test.ts` confere o código da pasta (sem formatar dinheiro, sem ler a distância até os vizinhos, só rotas `/api/minha/...`, contrato só por tipos ou por `calculos`) e `MinhaPage.test.tsx` varre o DOM sem "R$" em todos os cenários.
- **Frases no lugar da posição**: antes da 1ª venda do alvo, uma frase de incentivo; alvo sem células (posições null), a explicação de que ainda não há células no ranking; antes do início, a contagem regressiva no destaque.
- **Estados**: carregando, erro (com "Tentar de novo"), sem campanha (404). Atualiza sozinha a cada 60 s com a aba visível (`useVisaoIndividual.ts`, como o ranking público); uma falha mantém os números e avisa numa região viva fixa.
- **Pacote à parte**: `MinhaPage.tsx` carrega `VisaoIndividual.tsx` com `lazy` (como a configuração da Campanha); enquanto ele chega, o cabeçalho (`Cabecalho.tsx`, da sessão) e o carregando. O CSS segue a mesma divisão: `minha-moldura.css` (moldura e cabeçalho) vai no pacote inicial; `minha.css` (o resto da tela) vem só com a `VisaoIndividual` (`minha-css.test.ts` confere quem importa cada um).

## Componentes base (`components/ui`)

| Componente | Para quê | Props principais |
| --- | --- | --- |
| `AppShell` | Layout da coordenação: barra lateral a partir de 64rem, botão "Menu" no celular (fecha com o próprio botão, Esc, que devolve o foco ao botão, toque fora ou foco saindo do menu; escolher uma tela fecha e leva o foco ao `<main>`), `aria-current="page"` no link atual, link "Pular para o conteúdo". O botão "Menu" controla o painel: a navegação e, no fim, a conta (nome, papel e "Sair"; no computador, no pé da barra lateral) | `area`, `itens` (`{ para, rotulo, exato? }`), `conta?` (`{ nome, detalhe?, aoSair, saindo?, erro? }`), `children` |
| `PublicShell` | Layout das telas abertas: marca e conteúdo, sem navegação | `children` |
| `PageHeader` | Cabeçalho da tela: `<h1>` e título da aba ("Pedidos · Rifa Videira Kids") | `titulo`, `descricao?`, `acoes?` |
| `Card` | Cartão de conteúdo | `titulo?` (`<h2>`), `acoes?`, `children` |
| `Button` | Botão (`type="button"` por padrão) | `variante`: `primario` \| `secundario` \| `discreto` \| `perigo`; `tamanho`: `normal` \| `pequeno`; `larguraTotal`; props de `<button>` |
| `classesBotao()` | Cara de botão para links | `<Link className={classesBotao({ variante: "secundario" })}>` |
| `Input`, `Select`, `Textarea` | Campos com rótulo, dica e erro (liga `label`, `aria-describedby` e `aria-invalid`) | `rotulo`, `dica?`, `erro?` e as props nativas; as opções do `Select` vão como filhas |
| `SeletorArquivo` | Escolha de arquivo com a cara dos campos: o `<input type="file">` fica escondido só visualmente (o teclado e o leitor de tela usam ele) e o botão é um `<label>` dele; mostra o nome escolhido e limpa o campo a cada escolha (escolher o mesmo arquivo corrigido avisa de novo) | `rotulo`, `arquivo` (controlado), `aoEscolher(arquivo)`, `aceitar?`, `dica?`, `erro?`, `desabilitado?`, `textoBotao?`, `textoSemArquivo?` |
| `DataTable` | Tabela no computador (a partir de 48rem) e cartões empilhados no celular, com o mesmo HTML | `colunas` (`{ chave, titulo, celula, alinhamento?: "fim", principal? }`), `linhas`, `chaveDaLinha`, `legenda`, `mostrarLegenda?`, `vazio?` |
| `Dialogo` | Diálogo modal acessível, num portal no `<body>`: `aria-modal`, nome (título `<h2>`) e descrição; o foco entra ao abrir, fica preso (Tab e Shift+Tab dão a volta), Esc e o × pedem para fechar e o foco volta para quem abriu; o resto da página fica `inert` e sem rolagem. Clicar fora não fecha | `aberto`, `titulo`, `descricao?`, `aoFechar`, `children`, `rodape?`, `aoEnviar?` (corpo e rodapé num `<form noValidate>`), `papel?: "dialog" \| "alertdialog"`, `focoInicial?`, `focoAoFechar?` (refs) |
| `Abas` | Abas no padrão WAI-ARIA (tablist/tab/tabpanel): só a aba atual entra no Tab, setas (dão a volta), Home e End trocam e levam o foco; os painéis ficam montados (`hidden`), então nada se perde ao trocar | `rotulo` (nome da lista), `abas` (`{ id, rotulo, conteudo }`), `abaAtiva`, `aoMudar(id)` (controlada), `id?`; `idDaAba(id, aba)` dá o id do botão de uma aba |
| `Stat` | Indicador: rótulo, valor e variação | `rotulo`, `valor` (já formatado), `variacao?` (`{ texto, sentido: "subiu" \| "caiu" \| "estavel", tom? }`) |
| `IndicadorSituacao` | Situação de um indicador (em dia, abaixo, sem meta...): ícone, título e detalhe; o texto faz sentido sem a cor. Não é região viva (numa tela que se atualiza sozinha, seria ruído) | `tom`: `sucesso` \| `alerta` \| `perigo` \| `neutro`; `titulo`, `children?` (o detalhe, ex.: "6 bilhetes acima do esperado"), `icone?` (padrão ✓, !, ! e –) |
| `GraficoLinhas` | Gráfico de linhas acessível (SVG): título e descrição no SVG, legenda sempre visível, rótulo direto só no fim das linhas, mira com dica no ponteiro, no toque e no teclado (o SVG recebe foco; setas, Home e End percorrem os pontos e o leitor de tela ouve os valores; Esc fecha) e "Ver os dados em tabela" com todos os valores. Desenha na largura real do espaço (o texto não encolhe no celular) | `titulo`, `descricao` (a conclusão, não a lista de valores), `rotulosX` (curtos, no eixo), `rotulosPonto?` (dica e tabela), `tituloColunaX`, `series` (`{ rotulo, valores: (number \| null)[], estilo: "destaque" \| "referencia", rotuloFinal? }`), `extras?` (colunas só da dica e da tabela), `formatarValor`, `formatarEixo?`, `indiceAtual?` e `rotuloAtual?` (ex.: hoje) |
| `ProgressBar` | Percentual da meta, acessível (`role="progressbar"`, `aria-valuenow` de 0 a 100) | `rotulo`, `valor`, `meta` (mesma unidade), `textoValor?` |
| `Badge` | Status | `tom`: `neutro` \| `info` \| `sucesso` \| `alerta` \| `perigo`; o texto precisa fazer sentido sem a cor |
| `Aviso` | Mensagem na própria tela (não flutua nem some sozinha): resultado de uma ação, aviso ou erro | `tom`: `info` \| `sucesso` \| `alerta` \| `perigo`; `titulo?`, `children?`, `acao?`, `aoFechar?` (botão "Fechar aviso"), `anuncio?`: `alerta` (role="alert"; padrão em alerta e perigo) \| `status` (padrão em info e sucesso) \| `nenhum` |
| `EmptyState` | Nada para mostrar | `titulo`, `descricao?`, `acao?` |
| `ErrorState` | Falha (`role="alert"`) | `titulo?`, `mensagem?`, `aoTentarDeNovo?` (mostra "Tentar de novo") |
| `Loading` | Carregando (`role="status"`) | `texto?` |
| `Marca` | Símbolo e nome (provisórios) | `complemento?` |

Notas:

- `DataTable`: marque a coluna que identifica a linha com `principal` (vira o título do cartão no celular) e use `alinhamento: "fim"` em números e valores. Tabela larga demais rola só dentro dela, nunca a página. Defeito conhecido: com `mostrarLegenda`, no celular (cartões) a legenda fica espremida, uma palavra por linha; até a correção, ponha o título visível fora da tabela e deixe a `legenda` só para o leitor de tela (como no relatório da importação, em `pages/hierarquia`).
- `ProgressBar` trunca o percentual (99,99% aparece "99%", nunca "100%" antes da hora). Acima da meta, a barra fica cheia, o texto mostra o percentual real ("120%") e a cor muda. O leitor de tela recebe só o percentual, nunca o valor bruto. Nas telas públicas, passe pontos-base: `valor={pontosBase} meta={10000}`.
- Layout: `.pilha` empilha com espaço (`--pilha-espaco` muda o espaço); `.grade` monta uma grade que se ajusta à largura (`--grade-min`, padrão 14rem); `.visualmente-oculto` esconde texto que é só para leitores de tela. Dentro de uma caixa com rolagem própria (`overflow: auto`), dê `position: relative` à caixa: o `.visualmente-oculto` é absoluto e, sem isso, escapa do recorte e estica a página (rolagem horizontal).
- `GraficoLinhas`: até 4 séries, com valores inteiros (as marcas do eixo Y vão de 0 a um valor redondo, com passo 1, 2 ou 5 × 10ⁿ). `destaque` é a série principal (linha cheia, área suave e marcador no último ponto, desenhada por cima); `referencia` é a base de comparação (tracejada e cinza: a diferença não depende só da cor). `null` interrompe a linha (ex.: os dias que ainda não chegaram) e vira "sem dado" na tabela. Um rótulo direto que encostaria noutro sai (fica o do destaque; o valor segue na dica e na tabela). A dica fica ao lado da mira, sem cobri-la (mais estreita no celular); no toque, fica até o próximo toque ou até o foco sair. Cores: papéis em `GraficoLinhas.css` ligados aos tokens (`--grafico-destaque` = `--cor-info`, `--grafico-referencia` = `--cor-borda-forte`, grade `--cor-borda`, textos `--cor-texto-suave` e `--cor-texto`), e o `GraficoLinhas.test.tsx` confere o contraste nos temas claro e telão lendo o `tokens.css` (marcas 3:1, textos 4,5:1): mudou uma cor do tema, o teste diz se o gráfico continua legível.
- `Dialogo`: renderize o formulário só quando abrir (`{editando && <MeuDialogo />}`, com `aberto` fixo) para o estado começar do zero a cada abertura. `aoFechar` é um pedido: quem usa pode ignorar (ex.: enquanto salva). Numa confirmação destrutiva use `papel="alertdialog"` e ponha "Cancelar" antes do botão de perigo: sem nada focável no corpo, o foco inicial vai para o primeiro botão do rodapé. Se o botão que abriu vai sumir (ex.: excluiu a linha), aponte `focoAoFechar` para outro elemento antes de fechar. No teste, foque o botão antes do `fireEvent.click` (o jsdom não foca no clique) para conferir a volta do foco.
- `Aviso`: um `role="status"` que já entra na tela com o texto pode não ser lido. Para anunciar com certeza o resultado de uma ação, deixe uma região viva fixa na tela (ex.: `<p className="visualmente-oculto" role="status">{mensagem}</p>`) e use `anuncio="nenhum"` no `Aviso` visível.
- Botão com o nome do item só para leitor de tela: `Editar <span className="visualmente-oculto">{nome}</span>`, com o espaço **fora** do `<span>` (dentro dele, o espaço some no cálculo do nome acessível, ao menos no Testing Library, e o nome vira "EditarCélula").

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
- Gancho de 401: `aoReceber401(ouvinte)` chama `ouvinte(caminho)` a cada resposta 401, logo antes de a chamada falhar, e devolve a função que desliga. Quem usa é a sessão (`lib/sessao.tsx`): as telas não tratam o 401, a guarda leva para `/entrar`.

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
2. **Líder, discipulador e rede nunca recebem R$** (D12): a visão individual (`/minha`) mostra percentuais, posições, nomes e bilhetes do próprio alvo e da equipe dele; dos pares, só nome e posição. O código de `pages/minha` não formata nem lê dinheiro (`guarda-minha.test.ts`) e a tela renderizada é varrida em todos os cenários (`MinhaPage.test.tsx`).
3. Dinheiro em centavos inteiros, percentuais em pontos-base e datas no fuso de Belém, sempre pelos formatadores.
4. Sem bibliotecas de UI ou de CSS, sem fonte externa, sem CDN.
5. Acessibilidade: um `<h1>` por tela (o do `PageHeader`); campo sempre com rótulo; status nunca só pela cor; alvos de toque com 44 px ou mais (`--alvo-toque`); foco visível.
6. Sem rolagem horizontal em 390 px (360 px na visão individual). O telão não rola em 1920×1080.

## Testes

- `npx vitest run --project web` roda só os testes do site (jsdom + Testing Library).
- `renderizarRota("/coordenacao/pedidos")` (em `test/renderizar.tsx`) renderiza o site inteiro com as rotas reais e um roteador em memória, e devolve também o `roteador` (para conferir `roteador.state.location.pathname`).
- A sessão já vem conhecida nos testes, sem `GET /api/sessao`: `USUARIO_DE_TESTE` (papel coordenacao). `renderizarRota(caminho, { usuario: ADMIN_DE_TESTE })` entra como admin; `{ usuario: null }` faz o site perguntar à API, como no navegador (o `fetch` simulado responde `GET /api/sessao`).
- Visão individual: `pages/minha/teste-apoio.ts` tem as sessões `LIDER`, `DISCIPULADOR` e `REDE` (com o alvo), `visaoDe(cenario)` (a resposta de `GET /api/minha/visao` por papel, fase, unidade da meta, sem vendas, sem células...; toda resposta passa pelo `respostaVisaoIndividualSchema`), `todosOsCenarios()` e `criarApiFalsa(visao, sessao)`. Os acessos da hierarquia ficam na API falsa de `pages/acessos/teste-apoio.ts` (`alvosExemplo()`).
- Telas carregadas com `lazy` (`/minha`, a aba da hierarquia em Acessos, a configuração da Campanha) aparecem depois de um instante: espere com `findBy...` (o primeiro teste de um arquivo é o que carrega o pacote; a ordem dos testes não pode importar).
- Para a API, troque o `fetch`: `vi.stubGlobal("fetch", vi.fn(async () => respostaJson({ ... }, 200)))` e, no `afterEach`, `vi.unstubAllGlobals()`.
- O `@testing-library/user-event` não está instalado: use `fireEvent`.
- Nada de `.only` nem `.skip` no que vai para a `main`.
