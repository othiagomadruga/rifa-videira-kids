# Decisões técnicas

Registro curto das decisões técnicas (a mais nova no fim). Cada item diz o que foi decidido e por quê.

## D1. Um Worker serve a API e o site (RIFA-001, 2026-11-06)

- API em Hono no Cloudflare Worker, em `/api/*`. Site React servido pelo mesmo Worker via Workers Static Assets,
  com `not_found_handling: "single-page-application"` e `run_worker_first: ["/api/*"]` no `wrangler.jsonc`.
- Por quê: um deploy só e a mesma origem para site e API (sem CORS). Rotas do site ficam com o React.

## D2. `@cloudflare/vite-plugin` no desenvolvimento (RIFA-001)

- `npm run dev` é o `vite` com o plugin da Cloudflare: o Worker roda no workerd junto do site (HMR), com o D1
  local em `.wrangler/state`. O plugin funcionou sem problemas, então não precisamos de alternativa.
- O `predev` aplica as migrações no D1 local. Em terminal interativo o wrangler pede confirmação quando há migração
  nova (Enter confirma); fora dele (CI, agentes) confirma sozinho.

## D3. Testes do Worker com `@cloudflare/vitest-plugin` (RIFA-001)

- O `@cloudflare/vitest-pool-workers` foi renomeado para `@cloudflare/vitest-plugin` (o npm marca o antigo como
  deprecated e sem atualizações). A última versão do antigo (0.23.0) só aceita vitest 4.1, traz um workerd de
  agosto/2026 e, junto com o vite 8, faz o `npm install` do npm 10 (o do Node 22) quebrar
  (`Cannot read properties of null (reading 'edgesOut')`, bug do npm com dependências peer opcionais).
- Usamos o sucessor, `@cloudflare/vitest-plugin` 1.4.12 (aceita vitest ^4.1 ou ^5), com vitest 5.1. É o mesmo pool
  rodando os testes dentro do workerd.
- O D1 dos testes fica em memória. `src/worker/test/apply-migrations.ts` aplica `migrations/` antes de cada arquivo
  de teste (`applyD1Migrations` só aplica o que falta).
- Nos testes, use `import { env, exports } from "cloudflare:workers"`. O `env` e o `SELF` de `cloudflare:test`
  estão deprecated.

## D4. Toolchain da Cloudflare com versões fixas (RIFA-001)

- `wrangler` 4.156.1, `@cloudflare/vite-plugin` 1.67.0 e `@cloudflare/vitest-plugin` 1.4.12 ficam sem `^` porque os
  três usam o mesmo `miniflare`/`workerd` (1.20261101.1). Assim dev, testes e deploy rodam no mesmo runtime e o
  `node_modules` tem um workerd só. Atualize os três juntos.
- `compatibility_date` é 2026-11-01, a mais nova que esse workerd suporta. Só avance junto com o toolchain.

## D5. TypeScript 6.0 e tipos dos bindings (RIFA-001)

- O typescript-eslint 8 exige TypeScript < 6.1, então o TypeScript fica em ~6.0.3 (não 7) até isso mudar.
- Um tsconfig por ambiente (`tsconfig.worker.json`, `tsconfig.web.json`, `tsconfig.node.json`), porque Worker e
  navegador têm globais diferentes. `npm run typecheck` roda `tsc -b` na solução (`tsconfig.json`).
- Os tipos dos bindings ficam escritos à mão em `src/worker/worker-env.d.ts` (com `@cloudflare/workers-types`), não
  gerados pelo `wrangler types`: o arquivo é pequeno, passa por revisão e não muda conforme o `.dev.vars` de cada
  máquina. Ao criar um binding no `wrangler.jsonc`, declare-o lá também.

## D6. Testes do site e do fallback de SPA (RIFA-001)

- Site testado com Vitest + jsdom + Testing Library. O jsdom 31 exige Node >= 22.22.2, daí o `engines` do
  `package.json`.
- O fallback de SPA e o desvio de `/api/*` para o Worker são feitos pelos Static Assets (Cloudflare e Miniflare), não
  pelo nosso código, e o pool de testes chama o Worker direto, sem passar pelo roteador de assets. Por isso
  `src/web/spa-config.test.ts` valida o `wrangler.jsonc` lido pelo próprio wrangler. O comportamento real foi
  conferido com `npm run dev` e com o build em `npm run preview`.

## D7. Lint e formatação (RIFA-001)

- ESLint em flat config: `@eslint/js` + `typescript-eslint` (recommended) + `eslint-plugin-react-hooks` (recommended,
  já com as regras do React Compiler). Sem regras que dependem de type-check, por simplicidade e velocidade.
- Prettier com as opções padrão. Markdown fica fora (`.prettierignore`). `npm run lint` roda ESLint e
  `prettier --check`; `npm run format` corrige a formatação.

## D8. Acesso da equipe por link pessoal, sem senha (RIFA-007, 2026-11-06)

- Cada pessoa da coordenação recebe no WhatsApp um link `/acesso/<token>` (256 bits aleatórios; no banco, só o
  SHA-256). A página pede confirmação e só o `POST /api/sessao` abre a sessão, então o preview do WhatsApp não entra.
- A sessão fica no cookie `__Host-sessao` (HttpOnly, Secure, SameSite=Lax, sem Domain) e vale até o menor entre
  45 dias e o fim do link. Links e pessoas podem ser revogados. Escritas só da mesma origem (CSRF).
- Por quê: a equipe é pequena e entra pelo celular; sem senha não há o que esquecer nem e-mail para configurar, e o
  admin controla quem entra. O primeiro admin sai do `npm run acesso:criar`. Detalhes em `docs/acesso.md`.

## D9. Ordem de montagem das rotas e teste de proteção (INT-1, 2026-11-06)

- `src/worker/index.ts` monta, nesta ordem: cabeçalhos de segurança (`*`), health, `/api/sessao`, `exigirSessao` em
  `/api/admin/*` e `/api/painel/*`, usuários e links (só admin), webhook (só o Bearer) e hierarquia; `notFound` e
  `onError` por último.
- Por quê: no Hono, um middleware registrado depois de uma rota não a protege. Com o middleware no prefixo, toda rota
  montada depois dele sob `/api/admin` ou `/api/painel` nasce protegida, e caminho sem rota também dá 401 (não 404).
- `src/worker/protecao.test.ts` prova isso no app real (`exports.default.fetch`): as rotas do grupo `coordenacao` do
  contrato e as registradas no app (`app.routes`) sob os prefixos dão 401 sem cookie e 403 para a coordenação nas só
  de admin; escrita de outra origem dá 403; e uma rota fora dos prefixos só fica sem sessão se o contrato a declarar
  aberta. Rota nova entra nesse teste sozinha.

## D10. Leitura enxuta do D1 e cache das rotas públicas (RIFA-PAINEL-api, 2026-11-07)

- O link público (ranking e bumbo) circula em grupos de WhatsApp e é atualizado a cada 60 s em cada celular aberto.
  Lendo pela view `vendas_aprovadas` (LEFT JOIN com a hierarquia), cada requisição lia ~6 linhas do D1 por pedido
  (~42 mil com 7 mil pedidos): o plano Free do D1 (5 milhões de linhas lidas por dia) estouraria em horas.
- O Worker agrega `pedidos` por afiliado × dia local direto da tabela e resolve a célula sobre as linhas já
  agrupadas, com o índice parcial de cobertura da migração `0003_vendas_por_dia.sql`: ~1,3 linha por pedido.
- As rotas `/api/publico/*` têm cache de 30 s no servidor (`src/worker/lib/cache-publico.ts`): só respostas 200,
  chave = caminho + consulta validada e ordenada, sem cookies nem cabeçalhos. A Cache API da Cloudflare não vale
  em `*.workers.dev`, então há também um nível na memória do isolate; com domínio próprio o cache passa a ser
  compartilhado por data center. As rotas da coordenação nunca passam pelo cache (`no-store`).
- Risco que continua: no fim da campanha a cota Free ainda pode ser atingida (e o Workers Free tem 100 mil
  requisições/dia). Saídas: plano Workers Paid, TTL público maior ou tabela agregada mantida pelo webhook.

## D11. Reforços da auditoria de segurança (RIFA-013b, 2026-11-07)

Itens da auditoria da RIFA-013 que não dependem do PO. Os que dependem (uso único do link, quem troca o slug,
prazo de guarda dos dados, Workers Paid) continuam como perguntas.

- **Sem preview URLs** (`"preview_urls": false` no `wrangler.jsonc`). Com elas, cada versão publicada fica no ar
  em `<versão>-rifa-videira-kids.<subdomínio>.workers.dev` com o D1 e os segredos de produção, inclusive versões
  com defeito já corrigido. O time não usa previews; o site continua no `workers.dev`.
- **CI**: o `CLOUDFLARE_API_TOKEN` só existe no ambiente do passo "Publicar" (antes, no job `deploy` inteiro, à
  vista do checkout, do setup-node e dos scripts de instalação do `npm ci`). O passo que confere se o segredo
  existe recebe só `true`/`false`. As actions vão fixadas pelo SHA do commit, com a tag no comentário
  (`actions/checkout` v7.0.1 e `actions/setup-node` v7.1.0): uma tag pode ser movida, o SHA não. Para atualizar,
  troque os dois juntos (`git ls-remote --tags https://github.com/actions/<action>`).
  - **RIFA-019 (2026-11-10):** o build (Vite e os plugins) também deixou de receber o token: no job `deploy`
    ele roda no passo "Construir o site e o Worker (sem o token)", e o "Publicar" roda só `npm run deploy:publicar`
    (`wrangler deploy --dry-run`, migrations no D1 remoto e `wrangler deploy`). O `wrangler deploy` segue o
    `.wrangler/deploy/config.json` que o `@cloudflare/vite-plugin` gera no build e publica o `dist/` como está
    (`no_bundle`); sem o build, ele recusa (o `assets` do `wrangler.jsonc` não tem `directory`, ou o redirect
    aponta para um `dist/` que não existe) e não empacota nada por conta própria. O `--dry-run` na frente faz essa
    recusa acontecer ANTES das migrations: falha em ~2 s, sem rede, e o D1 remoto fica intocado (provado na
    RIFA-019 com uma cópia do script em `--local`, sem token e com o proxy apontado para lugar nenhum: sem o build,
    o D1 de rascunho nem foi criado; com o build, a cadeia chegou às migrations e ao deploy). `npm run deploy`
    continua igual para quem publicar da própria máquina (`npm run build && npm run deploy:publicar`). Os dois
    `actions/checkout` usam `persist-credentials: false`: nenhum passo usa git depois, e o `GITHUB_TOKEN` não fica
    no `.git/config` ao alcance do `npm ci`, do build e do wrangler. Tudo conferido no texto do ci.yml e do
    package.json em `src/worker/config-publicacao.test.ts` (o projeto não tem parser de YAML; o leitor por linhas
    do teste foi conferido contra o PyYAML e recusa âncoras, aliases e fluxo).
  - **Risco que continua (revisão da RIFA-019):** o token sai do ambiente do npm ci e do build, mas o job é o
    mesmo: o que esses passos deixam no disco ou no `$GITHUB_ENV`/`$GITHUB_PATH` roda no "Publicar" com o
    token. Exemplos conferidos na revisão: um `.npmrc` com `node-options=--require=<arquivo>` (o `npm run` passa
    ao wrangler) e um `build.command` no `dist/rifa_videira_kids/wrangler.json` gerado (o `wrangler deploy` o
    executa); também um `node_modules/wrangler` alterado. Isolar de fato pede um job de publicação separado, que
    receba só o `dist/` como artefato e confira a configuração gerada. (A ordem "migrations antes de o deploy
    recusar a falta do build", apontada nesta revisão, foi resolvida com o `wrangler deploy --dry-run` na frente.)
- **Limite do corpo antes de ler** (`src/worker/middleware/limite-corpo.ts`, com o leitor do webhook): 4 KiB no
  `POST /api/sessao` e 1 MiB nos POST/PUT/PATCH da coordenação, depois do login (sem sessão, o corpo nem é lido);
  acima, 413 `corpo_muito_grande`. As importações de CSV têm o teto delas na própria rota: a da hierarquia
  (3 × o limite de caracteres + 1 MB, respondendo como arquivo grande) e a conferência da RIFA-012, sob
  `/api/admin/reconciliacao/*`, que lê o corpo bruto com o teto dela.
- **Sessão parada há mais de 7 dias** deixa de valer, mesmo dentro dos 45 dias (`ultimo_uso_em`, já gravado no
  máximo uma vez por minuto). O link pessoal continua abrindo uma sessão nova; a administração não conta a sessão
  parada como ativa, e cada login a apaga.
- **Limite de requisições por IP** com o binding de Rate Limiting do Workers (`ratelimits` no `wrangler.jsonc`;
  funciona no workerd local e nos testes): 10 por minuto no `POST /api/sessao` (toda tentativa; 60 desde a D12) e 60 por minuto
  nas idas ao banco das rotas abertas (`/api/publico/*` e `/api/health`). A resposta que sai do cache de 30 s não conta: muita gente atrás do mesmo
  IP (o Wi-Fi da igreja, a operadora do celular) abre o ranking sem esbarrar no limite. Chave: o
  `CF-Connecting-IP` (IPv6 pelo /64); sem ele (só nos testes), sem limite. Acima: 429 `muitas_requisicoes` com
  `Retry-After`. O binding conta por data center e é "permissivo": serve contra abuso, não como conta exata. Sem
  o binding, cai para uma janela na memória do isolate (vale só dentro dele). O limite não protege a cota diária
  de requisições do Workers (o 429 também é uma invocação): para isso, só o plano pago.
- **Plausibilidade no webhook, sem perder venda**: o evento que aprova um pedido com mais de 200 bilhetes, ou com
  total acima de bilhetes × preço do bilhete da campanha ou abaixo da metade disso, grava o pedido e ele CONTA,
  mas os motivos vão para `webhook_eventos.avisos` (formato `DetalheResumido`) e o pedido entra em
  `pedidos_suspeitos` (migração 0005), listado em `GET /api/admin/pedidos/suspeitos`. Tirar um pedido das
  vendas é decisão do PO.
- **Trilha de auditoria** (tabela `auditoria`, migração 0005): quem (o usuário da sessão), quando, a ação, o alvo
  e um resumo sem dados pessoais, gravados no MESMO `db.batch` da ação (ação recusada não registra nada): PUT da
  campanha (com o slug e o preço antes e depois), vínculos de afiliado, importação da hierarquia aplicada e as
  ações do admin sobre usuários e links. Leitura: `GET /api/admin/auditoria`, só admin, com cursor. Quem pode
  fazer o quê não mudou.
- **CRUD da hierarquia na trilha** (RIFA-018, 2026-11-10; antes ficava de fora): POST, PUT e DELETE de redes,
  discipuladores e células gravam `hierarquia.criar`, `hierarquia.atualizar` e `hierarquia.remover` (alvo
  `<rede|discipulador|celula>:<id>`) no mesmo lote. O resumo leva o nome do item, ids e `qtd_pessoas` (que mexe na
  meta e no ranking) com o antes e o depois; dos dados do líder e do responsável da rede, só o nome do campo
  (`lider_telefone (apagado)`). A remoção diz o acesso da hierarquia que caiu junto em cascata (D12), pelo id do
  usuário. O PUT e o DELETE leem a linha e gravam só se ela continua como lida (o registro vai ANTES da gravação,
  com a mesma condição); se outra gravação a mudou no meio, refazem (até 3 vezes; depois, 409 `em_uso`). Assim o
  "antes" do resumo e o acesso removido são sempre os de fato, sem transação interativa (o D1 não tem). Por quê:
  a campanha (PUT) lê o "antes" fora do lote e aceita a corrida; aqui o resumo da remoção é o único registro de
  que um usuário foi apagado, então ele não pode ficar sem o acesso que caiu.
- **Ação sem mudança não registra** (RIFA-018): o PUT da hierarquia igual ao gravado, reativar quem está ativo,
  desativar quem está desativado e revogar link já revogado. Nos acessos, o registro passou para antes do UPDATE,
  com a condição do próprio UPDATE (que agora exige o estado diferente): a mesma conta decide a gravação e o
  registro, inclusive a recusa do último admin e do último link válido de admin dentro do lote. As respostas não
  mudaram (200 e 204). O PUT da campanha e o do afiliado continuam registrando o salvamento igual.

## D12. Visão individual por hierarquia: papéis presos a um alvo, sem dinheiro (RIFA-014, 2026-11-07)

A reunião pediu (RF08) que o líder, o discipulador e quem responde pela rede vejam o próprio desempenho, a posição
e o ranking da semana; "o líder não vê a rede"; o discipulador se compara aos outros discipuladores e vê o que está
abaixo dele. Em SA o login era só pelo e-mail, sem senha.

- **Entrada pelo mesmo link pessoal da D8**, não por e-mail: o sistema não envia e-mail, o link vai pelo WhatsApp e
  já tem expiração, revogação, sessão ociosa, limite por IP e trilha de auditoria. Continua sem senha.
- **Papéis novos `lider`, `discipulador` e `rede`**, cada usuário preso a UM alvo (a célula, o discipulador ou a
  rede) por colunas próprias em `usuarios`. O banco garante o alvo certo para o papel, nenhum alvo nos papéis da
  coordenação e no máximo um usuário por alvo. Apagar o alvo apaga o usuário dele (e, em cascata, links e
  sessões). Esses papéis só entram em `/api/minha/*` (grupo `hierarquia`); em `/api/admin/*` e `/api/painel/*`
  levam 403. **O alvo vem só da sessão**: nenhuma rota de `/api/minha` aceita id, então um líder não tem como pedir
  a célula de outro.
- **Sem dinheiro, nunca**: nenhuma resposta de `/api/minha` traz centavos, R$ ou arrecadação, com qualquer
  configuração; o schema (estrito, com regras cruzadas) recusa quantidade na unidade da meta quando ela é em
  centavos e distância no critério arrecadação. Números (meta, realizado, falta, bilhetes) só do próprio alvo e da
  equipe dele (quem está abaixo); dos pares, só nome e posição. A distância até o vizinho de cima e o de baixo
  (`diferenca`) sai null até o PO decidir: somada ao próprio número, ela revela o número do vizinho. Alvo sem
  células (ex.: discipulador recém-criado) fica fora do ranking (R8): posições null.
- **Links em lote pela administração** (`/api/admin/acessos-hierarquia`, só admin): lista todos os alvos de um
  papel, com ou sem acesso, e gera um link novo por alvo de uma vez, com o nome e o telefone do líder para o
  WhatsApp. Cada URL aparece só nessa resposta. `revogar_anteriores` troca o acesso quando o líder muda.
- **Migração sem recriar `usuarios`** (provada no D1 local na revisão do contrato): recriar a tabela (o jeito de
  mudar o CHECK do papel) faria o DROP apagar em cascata os links e as sessões, e esbarraria no RESTRICT da
  `auditoria` (`PRAGMA defer_foreign_keys` não segura ações de cascata). Ordem: primeiro as colunas de alvo
  (`celula_id`, `discipulador_id`, `rede_id`, ADD COLUMN com REFERENCES ... ON DELETE CASCADE, sem CHECK); depois
  uma coluna de papel nova cujo CHECK tem os 5 papéis E a coerência papel ↔ alvo; UPDATE copiando; DROP COLUMN do
  papel antigo; RENAME COLUMN; gatilhos que recusam papel NULL; índices únicos parciais por alvo. Com a coerência
  no CHECK do próprio papel, uma troca futura de papel repete a técnica: o DROP COLUMN é barrado quando outra
  coluna ou um gatilho cita a que sai, então os dois gatilhos do papel saem antes do DROP e voltam depois (provado
  no D1 local). Antes da primeira publicação com a 0006, anotar o bookmark do Time Travel do D1.
- **Cuidado com ids**: `usuarios.id` não é AUTOINCREMENT, então o id de um usuário apagado em cascata (com o alvo)
  pode voltar num usuário novo, e a trilha `usuario:<id>` passaria a apontar para outra pessoa. Desde a RIFA-018
  (D11), a remoção do alvo fica na trilha (`hierarquia.remover`) com o nome do alvo e o id do usuário do acesso que
  caiu junto: é ela que diz até quando (e de qual alvo) aquele id era, e as linhas `usuario:<id>` mais novas que
  ela são de outra pessoa.
- **Limite de login por IP sobe de 10 para 60 por minuto**: na reunião dos líderes, dezenas de pessoas abrem o link
  ao mesmo tempo atrás do mesmo IP. O token tem 256 bits, então o limite nunca foi o que impede adivinhar link:
  ele só protege CPU e banco.

## D14. Visão individual: base em cache e montador enxuto (RIFA-014-api, 2026-11-09)

(A D13 é da RIFA-012, a conferência por CSV, que entra na `main` pela branch dela.) Decisões técnicas da
implementação da D12 (o contrato não mudou; só `percentualBp` passou a ser exportada de
`calculos.ts`, sem mudar o comportamento, para a curva usar a mesma conta do percentual da meta).

- **Leitura**: a do painel (D10), com três comandos a mais no mesmo lote (os discipuladores, as redes e, por célula,
  o líder e os afiliados vinculados): por requisição, a sessão, a campanha e um lote, ~1,3 linha lida no D1 por
  pedido. Os dados de base ficam até 30 s na memória do isolate (`src/worker/db/visao-individual.ts`), nunca a
  resposta, que é por pessoa. Por quê: a tela se atualiza a cada 60 s em cada celular aberto, e sem o cache cada
  atualização leria todos os pedidos da campanha (a cota diária do D1 Free, D10). O alvo vem da sessão, lido na
  hora; a base guardada só serve se tiver o alvo NA MESMA DIVISÃO (a célula pela divisão dela; o discipulador e a
  rede, pela da rede). Senão (alvo criado depois dela, rede que trocou de divisão, célula ou discipulador que foi
  para outra divisão), ela é lida de novo: misturar a divisão nova da sessão com os rankings da antiga dava 500
  por até 30 s (RIFA-014-api-b). Para as outras pessoas, cujo alvo não mudou, a hierarquia pode aparecer até 30 s
  atrasada.
- **CPU**: o Worker Free tem 10 ms por requisição, e cada montador de `calculos.ts` percorre todas as linhas de venda
  que recebe (~1,5 µs por linha no workerd); a visão chama vários (o resumo do alvo e de cada item da equipe, e de 2
  a 4 rankings). O montador da visão (`src/worker/lib/visao-individual.ts`) passa a cada um só o que pesa no
  resultado, sem mudar a resposta: no resumo, as células do escopo e uma que representa as outras pela soma das
  pessoas (a meta proporcional depende delas só por isso); nos rankings, por célula, as vendas dos dias fechados da
  janela somadas numa linha e as de hoje, e no de uma divisão só as células dela. `lib/visao-individual.test.ts`
  confere, campo a campo, que tudo bate com os montadores chamados com todas as células e vendas.
- **CPU medida** pelo revisor no app completo (workerd, 36 células, 12 discipuladores, 4 redes e ~7 mil pedidos): a
  1ª visão de um isolate frio leva de 24 a 28 ms; depois, sem o cache da base, a mediana é de 3 a 5 ms no líder, de
  4 a 7 ms no discipulador e de 8 a 9 ms na rede, com o pior caso de 13 a 18 ms. Ou seja, os 10 ms do plano Free
  NÃO valem no 1º pedido de cada isolate nem na visão da rede sob carga. Se o Free recusar pedidos por CPU (erro
  1102), as saídas são o Workers Paid ou guardar também os rankings junto com a base, por 30 s.
- **Trava de desempenho determinística**: o relógio do workerd é de parede (mede também a disputa pelos núcleos),
  então o teste não trava a CPU pelo tempo. Trava o TRABALHO por visão (`routes/minha-desempenho.test.ts`, cenário
  de 36 células): as chamadas aos montadores e as linhas de venda e as células passadas a eles, com teto de 2 vezes
  o medido (passar do dobro falha, em qualquer máquina; uma piora de 3 vezes, com folga), além das idas e das linhas lidas no D1, exatas.
  A contagem usa os montadores injetáveis da visão (`MONTADORES_DA_VISAO`, como os de `routes/publico.ts`): o
  `vi.mock` de módulo não roda no workerd (o mocker do Vitest chama `AsyncLocalStorage.disable()`, que ele não
  implementa). O teste do painel e das rotas abertas (`routes/painel-desempenho.test.ts`, com ~7 mil e 259 mil
  pedidos) trocou o teto de 50 ms de relógio, que derrubava a suíte com a máquina cheia, pela mesma trava: uma
  chamada ao montador por requisição, com 927 linhas de venda e 36 células nos dois volumes (o banco agrega por
  célula e dia), teto de 2 vezes, e os montadores injetáveis de `criarPainel` (`MONTADORES_DO_PAINEL`) e de
  `criarPublico`. Desfazer a agregação da leitura (um pedido por linha) mantém as respostas certas, mas leva 6.939
  e 259.227 linhas ao montador, e a trava falha. As travas exatas do D1 (2 idas e no máximo 1,5 linha lida por
  pedido) continuam, e a CPU fica só no log.
- **Lote de links**: poucas instruções sobre listas JSON (`json_each`), como a importação da hierarquia, por causa do
  limite de consultas por invocação do D1 (até 6 instruções para 200 alvos). Se outra gravação muda os alvos entre a
  conferência e o lote (o alvo some, ganha um usuário ou é desativado), uma restrição do banco desfaz o lote inteiro
  e a conferência é refeita uma vez.
- **Ordem de nomes** na lista dos acessos e na equipe: a de português (`Intl.Collator("pt-BR")`, como o ranking), e
  não a do `COLLATE NOCASE` do SQLite, que só ignora maiúsculas ASCII e poria "Célula Ágape" depois de "Célula
  Betel".

## D15. Identidade da Videira e movimento sem biblioteca (RIFA-020, 2026-11-09)

O PO pediu o design do site com as cores e o logo da Videira, o logo do Kids discreto e "efeito de motion".

- **Cores do logo, contraste conferido por teste.** A paleta sai do PNG do PO (marinho, verde-água, azul e roxo;
  o amarelo do logo do Kids só como comemoração). O `tema/tokens.test.ts` lê o `tokens.css` e confere cada par de
  texto e fundo (AA no site, AAA no telão), o degradê forte ponto a ponto e o centro dos brilhos do fundo ambiente.
  O tema continua um bloco `:root` e um `[data-tema="telao"]`, com hex de 6 dígitos nos papéis (`--cor-*`), porque
  os testes de outras telas (gráfico, visão individual) leem os mesmos valores.
- **Logo sem redesenhar.** O PNG da Videira tem fundo branco opaco: o branco saiu pixel a pixel, com o alfa da borda
  calculado pela cor cheia vizinha (o miolo fica opaco; sem halo em fundo escuro). WebP (6 KB) com PNG de reserva num
  `<picture>`, com `width` e `height` (nada pula ao carregar). Em fundo escuro (telão), o logo vai num selo claro em
  vez de ser recolorido. Faltam do PO: SVG oficial, versão negativa e resolução maior (o PNG tem 308×120).
- **Movimento sem dependência** (as regras do `docs/frontend.md` proíbem biblioteca de UI e CDN): CSS (keyframes e
  transições) e a Web Animations API. Toda animação de CSS fica em `@media (prefers-reduced-motion: no-preference)`
  e todo `element.animate` passa por `lib/movimento.ts`, que não anima com `reduce` nem sem `matchMedia` (o jsdom:
  os testes que já existiam continuam vendo tudo pronto, sem mudar uma linha). Um teste varre todo o CSS do site.
- **Count-up sem layout shift**: o texto final fica no lugar, transparente (reserva o espaço e é o que o leitor de
  tela lê) e o número que conta passa por cima, `aria-hidden`. Parado, é só o texto, sem elemento a mais.
- **FLIP pelo layout, não pelo retângulo na tela**: a posição de cada item vem de `offsetTop`/`offsetLeft` (ignoram o
  transform de uma animação em curso), relativa à lista; um `ResizeObserver` mede de novo quando a tela muda de
  tamanho, para uma rotação de celular não virar "movimento" na próxima atualização. Os itens ganham chave pelo nome
  (`chavesPorNome`), então o count-up de cada célula parte do % dela, e não do item que estava naquela linha.
- **Pulso da meta batida pela Web Animations API, não por CSS** (revisão): o React move o `<li>` com `insertBefore`
  quando a ordem muda, e uma animação de CSS recomeça no nó movido, então uma célula só ultrapassada pulsava de
  novo. O `usePulsoDaMeta` dispara só quando a meta passa a estar batida (ou o item já aparece batido).
- **Sem View Transitions**: o `viewTransition` do React Router 8.5 está marcado como obsoleto em favor do
  `<ViewTransition>` do React 19.3, que animaria toda atualização feita em `startTransition`. A entrada das telas por
  CSS dá a transição entre rotas sem esse risco; pode voltar numa tarefa própria, se o PO quiser o cross-fade.
- **Telão: movimento só quando os dados mudam.** Atualização igual não mexe em nada; a exceção é o fundo ambiente,
  muito lento (60 e 75 s). O topo reserva o lugar da fase e da linha "Atualizado às" desde o carregando: o layout
  shift do telão em 1920×1080 caiu de 0,35 para 0,003.

## D16. Pedidos, entregas do webhook e alerta de webhook parado (RIFA-025, 2026-11-10)

O roteiro de lançamento (docs/lancamento.md) mostrou que a coordenação não tinha como ver os pedidos nem as
entregas do webhook (só por SQL no D1) e que ninguém ficava sabendo se o webhook parasse.

- **Só leitura, sem dado pessoal**: `GET /api/admin/pedidos` (pedidos da campanha ativa, com a célula resolvida
  pelo afiliado na leitura, D7, totais por status e cursor opaco), `GET /api/admin/webhook/entregas` (cada
  entrega autenticada, com resultado, transição de status e só os CÓDIGOS de erro e de aviso) e
  `GET /api/admin/webhook/estado`. O banco não guarda dado pessoal (D1); do comprador sai só o DDD.
- **Alerta de webhook parado** (`situacao` do estado, na ordem de prioridade): `erros_recentes` com algum
  `erro_validacao` nas últimas 24 h com slug ausente ou igual ao da campanha; `sem_entregas_recentes` quando a data
  local está na campanha, a hora local está entre 8h e 22h e passaram mais de `HORAS_SEM_ENTREGA_ALERTA` (4) horas
  desde o mais recente entre a última entrega da campanha e as 8h de hoje (sem falso alarme toda manhã; cobre o
  "nunca recebeu" depois do início); `nunca_recebeu` fora disso; `ok`. "Entrega da campanha" = slug da campanha
  ativa e resultado processado, duplicado ou ignorado_transicao. Entrega recusada por token (401/503) não é
  gravada: token errado aparece como `nunca_recebeu` antes do início, à noite e nas primeiras 4 h do dia, e como
  `sem_entregas_recentes` durante o dia da campanha; nos dois casos o site manda conferir URL, token e slug na Rifei.
  A janela é `HORA_INICIO_ALERTA ≤ hora local < HORA_FIM_ALERTA`; o slug do erro é comparado com `trim`. Limitação
  aceita: um webhook que pare depois das 18h só acende o alerta no dia seguinte às 12h (é o preço de não ter falso
  alarme toda manhã). Com
  `ignorado_outra_campanha` nas 24 h e nada da campanha, o site sugere conferir o slug. SUPOSIÇÃO do SM: 4 h de dia
  sem venda numa campanha de 36 células merece olhar; constantes no contrato.
- **Erro e avisos das entregas** saem reduzidos a campo (caminho do schema, nunca texto da entrada), código
  (vocabulário fixo do zod ou da D11) e ocorrências; a mensagem gravada não sai. O código da recusa é
  json_invalido ou corpo_muito_grande quando a rota gravou esse único problema, senão payload_invalido.
- **Obrigatório na implementação** (medido na revisão do contrato, com 7 mil pedidos e 20 mil entregas):
  migração 0007 com `pedidos (campanha_id, registrado_em, id)` e `webhook_eventos (resultado, id)`; travas com
  `EXPLAIN QUERY PLAN` e `rows_read` como em `painel.test.ts`, porque o índice novo desvia o planejador (totais com
  `+campanha_id`, totais e lista por célula com `afiliados CROSS JOIN pedidos`, última entrega por `MAX(recebido_em)`,
  contagem de 24 h com `resultado IN (...)`). Totais só na primeira página. O campo `origem` (webhook ou
  conferência) entra junto com a RIFA-012, por quem chegar por último na main.
- Fica para decisão do PO: gravar o instante do último 401 do webhook (seria uma escrita sem autenticação).

## D17. Mapa de vendas por DDD (RIFA-015, 2026-11-11)

A reunião lembrou que, em SA, "um mapa mostrava as vendas por DDD" e foi um "detalhezinho que deu muita diferença"
(RF10). O banco já guarda o DDD e o país do comprador (D1), sem nenhum outro dado dele.

- **Só para a coordenação, com valores**: `GET /api/painel/mapa-ddd`. Conta só pedidos aprovados dentro da janela
  (a campanha até hoje, ou o período atual) e, com `divisao`, só os das células da divisão (as vendas sem célula
  ficam de fora). Agrupa por DDD no D1 e converte DDD em UF no Worker, pela tabela fixa da Anatel
  (`src/shared/contracts/ddd.ts`, 67 DDDs, 27 UFs). Telefone de outro país (`pais` gravado e diferente de 55) vai
  para `exterior`; sem país (`pais` null: sem telefone ou fora do E.164), Brasil sem DDD ou DDD fora da tabela, para
  `sem_ddd`. A parte de cada recorte é a dos bilhetes, em pontos-base truncados. A janela é a do painel (R6): sem
  divisão, `total` bate com as vendas da campanha no painel (inclusive as sem célula).
- **Mapa no site** sem dependência nova e sem arquivo de terceiros: um mapa em grade (cartograma), um quadrado
  por UF na posição aproximada, com a cor pela parte das vendas, mais a lista por DDD. Nada de SVG de mapa baixado
  da internet.
- **Versão pública ou no telão** fica para o PO decidir (pergunta aberta). Se vier, mostra só presença e parte
  relativa, nunca quantidade nem R$, como o resto do que é aberto.
- Custo (medido na revisão do contrato, 7 mil pedidos): com os índices atuais, a leitura agrupada por afiliado,
  país e DDD vai pelo índice `(status, aprovado_em)` e volta à tabela para ler ddd e pais: ~2 linhas lidas por
  pedido aprovado da janela (~11 mil na campanha inteira, ~4 mil numa semana). Um índice parcial de cobertura
  `(campanha_id, affiliate_id, pais, ddd, aprovado_em, qtd_bilhetes, total_centavos) WHERE status = 'approved'`
  baixaria para 1 por pedido aprovado da campanha (~5,6 mil), sem mudar o plano das vendas por dia do painel
  (conferido), ao custo de mais um índice a gravar e a travar nos testes de plano. Rota só da coordenação, sem
  cache e sem atualização automática: ficam os índices atuais; o índice é a saída se o uso crescer.
