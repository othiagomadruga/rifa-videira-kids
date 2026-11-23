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
- **RIFA-043 (2026-11-12, ensaio geral):** no primeiro acesso (lançamento 3.1), o admin gera um link novo, entra por
  ele e revoga o primeiro; a lista vem do mais novo para o mais antigo e, no ensaio, o link errado foi revogado. O
  contrato ganhou `desta_sessao` no link da lista (`linkAcessoSchema`, autorizado pelo SM): true só no link que abriu
  a sessão de quem pede, calculado pela API do `sessoes.link_id` que a 0002 já gravava (sem migração). A tela marca
  "Este aparelho" e, ao revogá-lo, pede a confirmação "Revogar o link deste aparelho?", que avisa que a sessão cai.
  A marca é a da leitura da lista: na revisão, uma aba aberta antes de entrar pelo link novo ainda marcava o antigo, e
  o "Revogar e sair" derrubava a sessão do link novo. Por isso a tela confere `GET /api/sessao` antes de sair (só sai
  com 401) e pede a lista de novo quando a aba volta a ficar visível.

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
  - **Risco que continua (revisão da RIFA-019; resolvido na RIFA-021, D18):** o token sai do ambiente do npm ci e
    do build, mas o job é o mesmo: o que esses passos deixam no disco ou no `$GITHUB_ENV`/`$GITHUB_PATH` roda no
    "Publicar" com o token. Exemplos conferidos na revisão: um `.npmrc` com `node-options=--require=<arquivo>`
    (o `npm run` passa ao wrangler) e um `build.command` no `dist/rifa_videira_kids/wrangler.json` gerado (o `wrangler deploy` o
    executa); também um `node_modules/wrangler` alterado. Isolar de fato pede um job de publicação separado, que
    receba só o `dist/` como artefato e confira a configuração gerada. (A ordem "migrations antes de o deploy
    recusar a falta do build", apontada nesta revisão, foi resolvida com o `wrangler deploy --dry-run` na frente.)
- **Limite do corpo antes de ler** (`src/worker/middleware/limite-corpo.ts`, com o leitor do webhook): 4 KiB no
  `POST /api/sessao` e 1 MiB nos POST/PUT/PATCH da coordenação, depois do login (sem sessão, o corpo nem é lido);
  acima, 413 `corpo_muito_grande`. As importações de CSV têm o teto delas na própria rota: a da hierarquia
  (3 × o limite de caracteres + 1 MB, respondendo como arquivo grande) e a conferência da RIFA-012, sob
  `/api/admin/reconciliacao/*`, que lê o corpo bruto com o teto dela (1 MiB, o corpo compacto: D19).
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
  - **RIFA-042 (2026-11-12):** o "Recuperar" da conferência (D19) passa pela mesma regra: o recuperado fora do
    padrão entra em `pedidos_suspeitos`, com os mesmos motivos, na mesma gravação (adendo da D20).
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
- **Adendo (RIFA-090, 2026-11-23): o discipulador vê o quadro geral.** Pedido do PO: "embaixo da visualização deles
  da rede dele, coloque para eles poderem visualizar todas as redes". A /minha do discipulador ganha, embaixo de tudo, o
  **Ranking geral**: todos os discipuladores (com células) e todas as células da campanha, com posição, nome (e o
  discipulador da célula), **% da meta e bilhetes** da janela ("Esta semana" ou "Campanha toda"), as linhas dele em
  destaque. Muda a regra "dos pares, só nome e posição" **só nesta rota** (`GET /api/minha/todas-as-redes`): a visão
  (`/api/minha/visao`) continua igual, com a distância até o vizinho null. O que continua valendo: **nunca dinheiro**
  (nem com meta em centavos nem no critério arrecadação: só o % e os bilhetes, que são quantidade), **nunca comprador**,
  telefone, senha ou id; o alvo vem só da sessão. A conta é a do ranking da coordenação (`montarRankingPainel` sem
  divisão, a mesma posição e ordem), sem SQL novo, então herda qualquer mudança na atribuição das vendas (ex.: a célula
  efetiva da RIFA-088). Quem vê: o discipulador e a rede (a /minha da rede é a mesma montagem); o líder da célula não
  (403). Os dois rankings ficam 30 s na memória do isolate, por janela (como a base, D14); a resposta, que é por pessoa
  (o `eu`), nunca. Na tela, o título é "Ranking geral" (sem a palavra "rede", D30). O ranking por grupo (D39) continua
  só na coordenação.

## D14. Visão individual: base em cache e montador enxuto (RIFA-014-api, 2026-11-09)

(A D13 ficou sem decisão: a da RIFA-012, a conferência por CSV, entrou na `main` como D19.) Decisões técnicas da
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
  conferência) entra pelo contrato da RIFA-028 (D20), depois da RIFA-012 na main.
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

## D18. Publicação num job separado, só com o build como artefato (RIFA-021, 2026-11-11)

Fecha o risco que ficou na D11 (revisão da RIFA-019): no job `deploy`, o npm ci e o build rodavam no mesmo runner
do passo com o token, e o que deixassem no disco rodava com ele.

- **Dois jobs.** O `ci` (lint, typecheck, test, build) não tem segredo; depois do build roda
  `node scripts/conferir-artefato.mjs` e guarda o `dist/` como artefato `build-producao` (`actions/upload-artifact`
  v7.0.2, com os 2 arquivos ocultos do build, retenção de 1 dia e `overwrite` para o "Re-run all jobs"). O
  `publicar` (só push na `main`, `needs: ci`, concorrência sem cancelar) não roda npm ci com scripts, `npx` nem o
  build e não restaura cache: checkout sem credenciais (wrangler.jsonc, migrations, lockfile, o script), setup-node
  sem cache, `npm ci --ignore-scripts`, download do artefato em `dist/` (`actions/download-artifact` v8.0.2) e a
  mesma conferência, num passo sem o token. Só o "Publicar" recebe o token (`npm run deploy:publicar`: dry-run,
  migrations, deploy); depois, o `/api/health`.
- **Por que conferir o artefato:** o `wrangler deploy` segue o `dist/rifa_videira_kids/wrangler.json` gerado e
  executa um `build.command` que esteja nele, até no `--dry-run` (provado na RIFA-021 com um artefato adulterado).
  A conferência exige que esse arquivo seja o `wrangler.jsonc` do checkout lido pelo wrangler, com só as diferenças
  do plugin (`main: index.js`, `no_bundle`, a regra de módulos ES, source maps, assets em `../client`, migrations
  em `../../migrations`; sem `build`, `define` e `unsafe`). Qualquer outra diferença recusa: binding a mais, outro
  banco, outra conta, rotas, containers. Recusa também `.dev.vars` e `.env` dentro do `dist/` (o plugin os copia
  para o `vite preview`). O `.wrangler/deploy/config.json` não viaja: o script o escreve, com o conteúdo fixo que o
  plugin grava. Se uma subida do wrangler e do plugin mudar o que o build gera, o job `ci` falha na conferência
  ainda na branch: ajuste `configEsperada` junto.
- **O artefato só escreve em `dist/`** (download com `path: dist`; o download-artifact v8 troca `..` nos caminhos
  do zip). Um `.npmrc`, `package.json` ou `.env` (o wrangler carrega o `.env` da pasta onde roda) não chega à raiz.
- **Integridade:** sem `github-token` nem `run-id`, o download só vê os artefatos do mesmo run, e confere o SHA-256
  que o upload registrou (`digest-mismatch: error`, o padrão). É o que o job `ci` do mesmo commit guardou. Isso não
  protege de um job `ci` comprometido (ele constrói o Worker de qualquer jeito); o que a separação garante é que o
  token nunca está no runner do npm ci e do build, e que o artefato não faz o wrangler executar nada nem tocar outro
  recurso da conta.
- **Wrangler sem scripts de instalação:** `npm ci --ignore-scripts` instala as versões e os hashes do lockfile sem
  rodar script nenhum; os binários do esbuild e do workerd vêm dos pacotes de plataforma do lockfile (os scripts
  deles só conferem a instalação). Provado num diretório limpo só com o checkout e o artefato: o
  `wrangler deploy --dry-run` passa e as migrations `--remote` chegam à rede (token fictício, endereço morto). O
  wrangler executa o esbuild ao carregar; o workerd precisa estar instalado, mas não roda em nenhum dos dois (trocado
  por um registrador que nunca foi chamado). Exceção: se a Cloudflare recusar o Worker por tempo de inicialização
  (erro 10021), o wrangler sobe o workerd na máquina para medir a inicialização do `index.js`, dentro do isolamento
  do workerd, que não recebe o ambiente do processo. Instalar só o `wrangler@4.156.1` resolveria as dependências
  dele fora do lockfile: descartado.
- **Sem ambiente do GitHub (revisão da RIFA-021):** o repositório é privado e o plano da conta do PO é
  desconhecido. Pela documentação do GitHub ("Managing environments for deployment" e "Deployments and
  environments"), no plano Free ambientes, segredos de ambiente e regras de branch só existem em repositório
  público; o ambiente precisa existir antes de o workflow usá-lo, e criá-lo em repositório privado pede o Pro. O que
  acontece com um job que declara um ambiente nesse caso não está documentado. Para a primeira publicação não
  depender disso, o job não declara `environment:` e usa o segredo do repositório (que vale para todo job do
  repositório). **Reforço com o GitHub Pro (opcional, depois do lançamento):** com o segredo só num ambiente
  `producao` restrito à `main`, um workflow alterado noutra branch não lê o token. Ordem: o PO cria o ambiente
  (**Settings → Environments → New environment** `producao`; **Deployment branches and tags → Selected branches
  and tags →** `main`; **Environment secrets →** `CLOUDFLARE_API_TOKEN`); o SM põe `environment: producao` no job
  `publicar`, troca a conferência do teste e faz o merge; o PO confere a publicação seguinte e só então apaga o
  segredo do repositório.
- **Sem o segredo**, o primeiro passo avisa ("publicação pulada") e todos os outros pulam: o workflow fica verde.
- Travado em `src/worker/config-publicacao.test.ts` (ordem dos passos, token só no "Publicar" e só com o id da
  conta ao lado, o `publicar` sem npm ci com scripts, `npx`, build ou cache, nenhum passo escrevendo no
  `$GITHUB_ENV`/`$GITHUB_PATH`, sem `defaults`, `shell`, `working-directory` ou `continue-on-error`, o artefato do
  mesmo run em `dist/`, actions por SHA, sem `environment:`) e em `scripts/conferir-artefato.test.mjs` (as
  adulterações recusadas).
- **Adendo de 17/11 (RIFA-072): o CI roda só na `main`.** Em 17/11 o GitHub Actions parou de rodar jobs por cobrança:
  o repositório é privado, a cota do plano é em minutos, e cada push de branch de agente rodava a suíte inteira. Agora
  `on.push` vale só para a `main` (que publica); numa branch, o CI roda pelo Run workflow ou por um pull request. As
  branches passam pelo portão local do SM (testes, lint, typecheck e build) antes do merge, como sempre. Para voltar
  ao CI em toda branch, tire o `branches: [main]` e a linha correspondente do teste. Sem o CI na branch, a
  conferência do artefato também não roda lá (o "ainda na branch" acima): na subida do wrangler e do plugin (D4), o
  portão local roda `node scripts/conferir-artefato.mjs` depois do build. Se a cota acabar de novo, nem o push na
  `main` publica nem a volta pelo celular (D22) roda: o PO ajusta nas Settings da conta no GitHub (não nas do
  repositório) → Billing (pagamento ou limite de gastos do Actions).

## D19. Conferência pelo CSV: o arquivo é lido no navegador (RIFA-012, ciclo 2, 2026-11-07)

- Ler o CSV no Worker gastava de 50 a 375 ms de CPU por requisição (1 a 7 mil pedidos; 95% em datas, com um
  `Intl.DateTimeFormat` por célula), e o plano Workers Free dá 10 ms (erro 1102). Decisão do SM: o navegador lê
  o arquivo, detecta e mapeia as colunas (`src/shared/conferencia/`, sem zod) e manda à API só as colunas
  mapeadas que não são de dado pessoal, já normalizadas, numa lista por campo, com as linhas iguais juntadas
  (`vezes`): o corpo compacto de `src/shared/contracts/conferencia.ts`, conferido por um validador leve (laços
  simples, sem zod item a item). Ganho extra: nome, e-mail e telefone nem saem do navegador.
- O Worker não usa o Intl por linha; o banco devolve só os pedidos com os códigos do arquivo (um texto JSON por
  lote, tuplas curtas) e os ausentes e totais já somados. CPU medida na revisão no workerd, com o app completo e
  o login, com 7 mil pedidos: 18 a 22 ms na 1ª requisição do isolate e 9 a 10 ms nas seguintes; no teto aceito
  (1 MiB), de 15 a 75 ms.
- **A conferência exige o Workers Paid** (decisão do PO, 2026-11-11). Os números acima passam dos 10 ms do plano
  Free; entre o plano pago e levar também a análise ao navegador, o PO escolheu o plano. No Paid, o limite de CPU
  por requisição é de segundos (30 s por padrão na documentação "Workers limits"; confira). Roteiro:
  lancamento.md, 1.1 a. O teste de desempenho
  (`src/worker/routes/reconciliacao-desempenho.test.ts`) mede só as rotas, sem o login, e continua aceitando até
  30 ms: não é o limite do plano, é a trava contra regressão grosseira (ler o CSV no Worker voltaria às centenas de
  ms; com 7 mil pedidos, o teste mede de 8 a 11 ms).
- O corpo vai até 1 MiB (`LIMITE_CORPO_CONFERENCIA_BYTES`, ~15 mil pedidos); a rota lê o corpo uma vez só, de
  uma vez quando há `Content-Length` (o teto geral leria em pedaços de 4 KB: ~2,5 ms a mais para ~430 KB), por
  isso continua fora do teto geral, com o mesmo número.
- Regra do valor de um pedido em várias linhas e trava do código que não bate: integracao-rifei.md, seção 10.
- O "Recuperar" muda os números da campanha, então entra na trilha de auditoria da D11 (decisão do SM): ação
  `conferencia.recuperar`, alvo `campanha:<id>`, no mesmo `db.batch` da gravação e só quando algum pedido entra;
  o resumo traz o id da recuperação e quantos pedidos e bilhetes entraram (nada do arquivo).

### Adendo (RIFA-056, 2026-11-15): o "Recuperar" do admin corrige o "Pagamento não registrado"

O lançamento pode começar com o Pix manual da Rifei (lancamento.md, 1.6): o "Pedido novo" chega pelo webhook e, se
marcar como pago no painel da Rifei não mandar o "Pedido pago" (a compra de teste decide), o pedido ficaria pendente ou
expirado para sempre. O mesmo buraco existe com o webhook fora do ar entre os dois avisos. A conferência só mostrava o
caso. Decisões do SM, reversíveis:

- **O mesmo "Recuperar", com o mesmo cuidado da venda perdida.** O `pagamento_nao_registrado` (pago no arquivo; no
  sistema `in_process` ou `expired`, da campanha ativa e sem desconsideração) passa a `recuperavel` quando não tem
  observação. Impedem as mesmas da venda perdida (`sem_quantidade`, `sem_valor`, `valor_ambiguo`, `data_no_futuro`,
  `codigo_nao_confere`) e três novas, do arquivo que não confirma o pedido gravado: `quantidade_diferente`,
  `valor_diferente` e `afiliado_diferente`, com as comparações dos pagos nos dois lados (o afiliado sem a coluna ou não
  reconhecido não compara; vazio no arquivo é "sem afiliado", diferente de um afiliado gravado). O afiliado tardio
  (gravado sem afiliado e, no arquivo, com um) fica barrado como `afiliado_diferente`: a correção não troca o afiliado.
  O desconsiderado (D20) continua no grupo à parte e nunca volta sozinho (`ja_existe`).
- **O que a correção grava** (o que o "Pedido pago" deixaria nas contas): `status = 'approved'` e `aprovado_em` com a
  data do arquivo, pela regra da venda perdida (a hora do arquivo; só o dia, o meio-dia ou agora, se for hoje; sem
  data, agora), `atualizado_em` e `pagamento_recuperacao_id` (0011). Quantidade, valor, afiliado, `origem` (continua
  `webhook`), `status_rifei` e os demais campos do webhook não mudam; nada é apagado. Conta no painel, nos rankings,
  no bumbo, na `/minha`, na Adesão e no mapa como qualquer aprovado (todos leem `status = 'approved'` e
  `aprovado_em`). A plausibilidade da D11 marca o fora do padrão em `pedidos_suspeitos` no mesmo lote, como o "Pedido
  pago" marcaria.
- **Gravação** (`gravarRecuperacao`, o mesmo `db.batch`): `UPDATE ... FROM json_each(...)` com a guarda "o pedido
  ainda é o que o plano conferiu": a campanha ativa, `status IN ('in_process', 'expired')`, `desconsiderado_em IS
  NULL`, `origem = 'webhook'` e a mesma quantidade, o mesmo valor e o mesmo afiliado (`IS`). **Idempotente**: repetir
  encontra o pedido pago (`ja_existe`, sem outra recuperação nem trilha). **Corrida com o webhook**: o "Pedido pago"
  antes da gravação faz o UPDATE não mudar nada (`ja_existe`); depois dela, dá `duplicado` (approved é terminal, D4) e
  não muda o pedido. Nos dois casos ele conta uma vez; só o `aprovado_em` pode ser outro (o do arquivo ou o
  `approved_at` do evento: vale o que chegou primeiro). `MAX_TENTATIVAS` do webhook não muda: a correção é a mesma
  transição para approved, por outra via.
- **Migração `0011_pagamento_conferencia.sql`** (modelo-de-dados.md, seção 12): `pedidos.pagamento_recuperacao_id` →
  `recuperacoes` (ON DELETE RESTRICT; CHECK: só com `origem = 'webhook'` e `status = 'approved'`) e o índice parcial
  `pedidos_por_pagamento_recuperado`. Uma coluna nova, e não `recuperacao_id`: a 0004 prende `recuperacao_id` a
  `origem = 'conferencia'` (CHECK), e trocar o CHECK exigiria recriar a tabela de pedidos na véspera do lançamento.
  Aditiva: nenhum dado muda.
- **Só o admin** (pedido do SM). A rota é a mesma, `POST /api/admin/reconciliacao/recuperar`, que continua com admin e
  coordenação para a venda perdida (adendo da RIFA-042 na D20). Com a sessão da coordenação, o pendente fica
  `ja_existe`, como antes. A análise é igual para os dois papéis (`recuperavel` diz se o arquivo confirma o pedido); a
  tela da coordenação mostra o grupo sem seleção, com "Só o admin marca estes pedidos como pagos.".
- **Contrato** (commit à parte, `RIFA-056: contrato: ...`): `TIPOS_RECUPERACAO`; as três observações e os três motivos
  novos; `tipo` em cada pedido de `recuperados` (a prévia e a resposta dizem o que cada um vai virar, mesmo que o banco
  tenha mudado desde a análise); `pagamentos_registrados` em cada recuperação do histórico (os de `pedidos` que eram
  pagamentos não registrados). As contagens de `recuperacoes` somam os dois tipos.
- **Trilha**: a mesma ação `conferencia.recuperar`. Só vendas perdidas: o texto de antes. Com pagamentos registrados:
  "...; 2 pedidos pendentes ou expirados (3 bilhetes) marcados como pagos" (só eles: sem a parte das vendas).
- **Site**: o grupo ganha a mesma seleção da venda perdida (para o admin, os que dá para marcar já vêm marcados),
  **Registrar pagamento** (indisponível com `aria-disabled` e a dica), a confirmação com a prévia, o aviso depois de
  gravar, o aviso do topo quando só há pagamentos não registrados e a coluna **Tipo** no histórico.
- Testes: `src/worker/routes/reconciliacao-pagamento.test.ts` (workerd + D1) e
  `src/web/pages/conferencia/PagamentoNaoRegistrado.test.tsx`.

## D20. Regras do admin na campanha: desconsiderar pedido, acesso da hierarquia, remover afiliado e mensagens (RIFA-028, 029, 031 e 032; contrato, 2026-11-11)

O PO pediu: "Todas essas decisões quero configuráveis na conta do
admin, para ativar ou desativar ou aplicar o valor correspondente." Datas, preço, meta, percentuais, critério do
ranking e o que o público vê já estavam na Campanha; faltavam as quatro regras abaixo. Contrato em
`src/shared/contracts/` (`regras.ts`, sem zod; `dominio.ts`; `api.ts`; `acesso.ts`; `erros.ts`), testes em
`regras.test.ts`.

- **Três grupos novos na campanha** (`campanhaSchema` e o corpo do PUT), ao lado de `ranking` e `publico`:
  `pedidos: { desconsiderar }` (padrão desligado, `PEDIDOS_PADRAO`), `acesso: { discipuladores, redes }` (padrão
  ligados, `ACESSO_PADRAO`; o líder não tem chave) e `mensagens: { link_coordenacao, link_lider,
  link_discipulador, link_rede }` (padrão = o texto de hoje, `MENSAGENS_PADRAO`). No PUT, **grupo ausente mantém o
  gravado** (no primeiro PUT, o padrão) e grupo presente substitui o grupo inteiro. É diferente de `publico`
  (ausente = padrão) de propósito: uma aba antiga do site, que não conhece os grupos, não religa um acesso
  desligado nem apaga uma mensagem editada. Na resposta, os grupos têm `.default()`: a API de hoje não os devolve e
  o parse do `montarCampanha` completa com o padrão, que é o que vale enquanto a 0008 não existe. Quem muda as
  chaves é quem muda a Campanha hoje (admin e coordenação): pergunta ao PO. (Respondida no adendo da RIFA-042: só o
  admin.)
- **RIFA-028, desconsiderar pedido.** `POST /api/admin/pedidos/desconsiderar { pedido_id, motivo, observacao? }` e
  `POST /api/admin/pedidos/reconsiderar { pedido_id }`, **só admin**, 200 com o pedido como a lista mostra. O id do
  pedido vai no corpo, não na URL: é o texto da Rifei, de até 128 caracteres, e na URL dependeria da codificação.
  Motivo `teste`, `fraude`, `estorno` ou `outro`; observação de até 140 caracteres, vazia = null, recusada com "@"
  ou 8 dígitos seguidos (trava barata contra o contato do comprador; a tela também avisa). Vale para pedido de
  qualquer status da campanha ativa: um pedido de teste ainda não pago também sai. Repetir não muda nada (200 com o
  pedido como está, sem trilha), como revogar um link já revogado; trocar o motivo é reconsiderar e desconsiderar
  de novo. Ordem dos erros: 400 (corpo), 404 sem campanha ativa, 409 `acao_desligada` com
  `{ "chave": "pedidos.desconsiderar" }`, 404 pedido fora da campanha ativa. **Desligar a chave não devolve às
  contas o que já foi desconsiderado**: só bloqueia desconsiderar e reconsiderar até ligar de novo (pergunta ao
  PO). O pedido sai de TODAS as contas e continua na lista de pedidos com o selo (`desconsiderado: { motivo,
  observacao, em }`; quem fez fica só na trilha, que é só do admin), na lista de suspeitos (com o mesmo campo) e na
  trilha. A lista ganha o filtro `desconsiderado=true|false`, e os totais por status passam a contar só o que conta.
  Webhook que chegar depois não o devolve às contas: o UPSERT do webhook nunca toca nas colunas novas.
- **RIFA-029, acesso de discipuladores e de redes.** Com `acesso.discipuladores` (ou `acesso.redes`) desligado:
  `POST /api/sessao` com link VÁLIDO do papel dá 403 `acesso_desligado` com `{ "papel" }` e não cria a sessão (link
  inválido continua 401); todo `/api/minha/*` com sessão do papel, exista a rota ou não, dá o mesmo 403 (a sessão
  não é apagada); gerar link do papel, em lote (`POST /api/admin/acessos-hierarquia/links`, antes de conferir os
  ids) ou avulso (`POST /api/admin/usuarios/:id/links`), dá 409 `acao_desligada` com a chave. Nada é revogado: os
  links e as sessões voltam a valer quando a chave volta. A lista dos acessos e o PATCH (ativar, desativar)
  continuam. `GET /api/sessao` continua 200: o site descobre pelo 403 da visão e diz que a coordenação desligou
  esse acesso. A chave é lida na hora, nunca do cache de 30 s da visão (D14). Sem campanha ativa, vale o padrão.
- **RIFA-031, remover afiliado de teste.** `DELETE /api/admin/afiliados/:affiliateId`, **só admin**, 204, sem chave
  na campanha. Só sem pedido que conte, de qualquer status e de qualquer campanha (todos desconsiderados, ou
  nenhum): senão 409 `afiliado_com_pedidos` com `{ pedidos_que_contam, pedidos }` (até 20 ids, os mais recentes
  na ordem da lista de pedidos, `registrado_em` e `id` decrescentes, para a busca da lista). Um pedido que conta
  noutra campanha não se desconsidera daqui (só os da ativa): esse afiliado não é de teste e fica. Vinculado ou
  não. A FK `pedidos.affiliate_id` é RESTRICT: os pedidos desconsiderados dele ficam sem afiliado no mesmo lote, e a
  trilha guarda quantos eram (e os ids, se couberem). Se a Rifei mandar depois um evento com esse affiliate_id, ele
  volta como não vinculado (D7, o afiliado tardio); um pedido desconsiderado continua desconsiderado.
- **RIFA-032, mensagens do WhatsApp.** Um modelo por tipo de link (coordenação, líder, discipulador, rede), com os
  marcadores `{nome}` (primeiro nome; vazio só na rede sem responsável), `{saudacao}` ("Olá, Maria!" ou "Olá!"),
  `{alvo}` (nome da célula, do discipulador ou da rede; não existe no da coordenação) e `{link}` (obrigatório), até
  1.000 caracteres. Marcador desconhecido (`{Nome}`, `{nomee}`) ou a falta do `{link}` dá 400 com a mensagem em
  português (`problemasDoModelo`). O site preenche com `preencherMensagem` (o link só existe no navegador, na
  resposta que o cria), numa passada só: um nome com "{link}" não vira o link. Os padrões, preenchidos, dão o texto
  de hoje caractere por caractere (`regras.test.ts`, com os mesmos casos de `src/web/pages/acessos/textos.test.ts`).
  Os marcadores são conferidos só na ENTRADA: na resposta, `mensagensGravadasSchema` confere só o tamanho, porque o
  `montarCampanha` passa a campanha pelo schema em toda leitura (painel, rotas abertas, bumbo, /minha) e um modelo
  gravado fora das regras (SQL à mão, um marcador que deixar de existir) não pode derrubar essas rotas (revisão do
  contrato). **Entram** as quatro mensagens do link pessoal (tela Acessos: "Copiar mensagem" e "Abrir no
  WhatsApp"). **Não entram** o bumbo (montado pela API a cada dia, com os números do dia; um texto livre no que é
  público quebraria a garantia de nunca ter R$ nem quantidade, R9) nem os textos das telas. **"Aguardando
  pagamento"** é só o rótulo do status `in_process` na tela Pedidos (`ROTULO_STATUS` e `ROTULO_STATUS_PLURAL` em
  `src/web/pages/pedidos/textos.ts`: lista, filtro, cartões dos totais e transição das entregas do webhook) e em
  docs/frontend.md; não está na API, no público nem nas mensagens. Trocar é só texto (-web) e os testes da tela
  (PedidosPage, textos e EntregasWebhook); falta o PO dizer o texto novo.
- **Trilha** (0005): ações `pedido.desconsiderar`, `pedido.reconsiderar` e `afiliado.remover`. Alvo `pedido:<id>`
  (`alvoDoPedidoNaAuditoria`; só `pedido` quando não cabe nos 64 caracteres do alvo) e `afiliado:<id>`.
- **Conferência pelo CSV (RIFA-012, D19)**: o pedido do arquivo que o sistema tem desconsiderado aparece como
  desconsiderado, num grupo à parte (`desconsiderados` na análise por pedido), nunca como "faltando" nem como
  divergência; os totais do sistema contam só o que conta. A lista de pedidos ganha também o campo `origem`
  (`webhook` ou `conferencia`), que a D16 deixou para quando a RIFA-012 estivesse na main.
- **Catálogo à parte**, `ROTAS_REGRAS_CAMPANHA` (como `ROTAS_ACESSO_HIERARQUIA` na RIFA-014): o
  `src/worker/protecao.test.ts` percorre `ROTAS` e exige o 403 da coordenação nas rotas só de admin, que uma rota
  ainda não montada não dá (404). Por isso as três rotas não estão em `ROTAS` nesta tarefa.
- **A main continua verde com o contrato**: os campos novos das respostas têm `.default()` (a API de hoje não os
  manda; o parse completa, e a campanha já sai com os padrões, porque o `montarCampanha` passa pelo schema). Nos
  tipos eles são obrigatórios, então as fixtures do site que montam `Campanha`, `ItemPedido` e `PedidoSuspeito`
  ganharam os campos; a Trilha ganhou o rótulo das 3 ações (o `Record<AcaoAuditoria, string>` de
  `src/web/pages/trilha/textos.ts` exige); e os testes do Worker que comparam a resposta inteira (campanha, pedidos
  e suspeitos) esperam os padrões. Nenhum código do Worker mudou.

### OBRIGATÓRIO NA IMPLEMENTAÇÃO

1. **Não existe tabela agregada.** A `0003_vendas_por_dia.sql` é um ÍNDICE parcial de cobertura
   (`pedidos_aprovados_por_afiliado_dia`, `WHERE status = 'approved'`), não uma tabela: não há agregado para
   corrigir nem recalcular. Desconsiderar é um `UPDATE` das três colunas do pedido pela chave primária; o SQLite
   tira a linha do índice parcial e da view na mesma transação. Desfazer é o `UPDATE` de volta para null.
2. **Atomicidade** (um `db.batch`, como a D11): (a) o registro na trilha, ANTES do UPDATE e com a MESMA condição;
   (b) o UPDATE com `WHERE id = ? AND campanha_id = (ativa) AND desconsiderado_em IS NULL` (no reconsiderar, `IS NOT
   NULL`) `AND EXISTS (campanha ativa com pedidos_desconsiderar = 1)`; (c) a leitura do item como a lista o monta.
   A chave é lida DENTRO do lote: um admin que desliga a chave ao mesmo tempo não deixa passar. Sem mudança
   (`changes` 0): uma leitura curta decide entre 200 como está, 404 e 409. Remover afiliado, no mesmo lote: o
   registro (condicionado a nenhum pedido que conte), `UPDATE pedidos SET affiliate_id = NULL WHERE affiliate_id = ?
   AND desconsiderado_em IS NOT NULL AND NOT EXISTS (pedido dele que conta)` e o `DELETE` do afiliado com a mesma
   condição: um pedido novo do webhook no meio desfaz tudo (a FK RESTRICT recusa) ou não entra. A remoção é uma
   mudança de afiliado que a concorrência otimista do webhook não contava (`MAX_TENTATIVAS` em `db/pedidos.ts`: "o
   afiliado tardio, de null para um id, uma vez só"): ela anula o afiliado e um evento depois o preenche de novo.
   Suba `MAX_TENTATIVAS` de 5 para 7 e acerte o comentário (a 7ª sempre grava).
3. **Migração `0008_regras_campanha.sql`** (plano em docs/modelo-de-dados.md, provado no SQLite local) e as
   consultas no **mesmo merge**: o índice da 0003 é recriado com `AND desconsiderado_em IS NULL`, e o SQLite só
   usa índice parcial com a condição repetida na consulta. Sem o filtro, o painel cai no índice da 0007 com B-tree
   temporária (provado), e `src/worker/db/painel.test.ts` falha. O índice recriado leva `desconsiderado_em` como
   última coluna (revisão do contrato): sem ela, mesmo com o filtro, o plano sai `USING INDEX` e não `USING COVERING
   INDEX` (o SQLite deduz `status` do `status = 'approved'` do índice, mas não deduz o `IS NULL`; provado no SQLite
   3.53 e no D1 local), e o `painel.test.ts` também falha.
4. **Todo lugar que soma pedidos exclui o desconsiderado** (`desconsiderado_em IS NULL`):
   - `src/worker/db/painel.ts`: `selecionarVendasPorDia` (as duas formas: o literal de UTC−3, igual ao índice, e a
     com o deslocamento por parâmetro) e `SELECIONAR_VENDAS` (uma a uma, `p.desconsiderado_em`). Alimenta metas,
     ritmo, curva, projeção, vendas, sem célula e fora da janela de `/api/painel/resumo`; os rankings de
     `/api/painel/ranking`; `/api/publico/ranking` e `/api/publico/bumbo` (telão e grupo); e a visão individual
     `/api/minha/visao` (`lerEntradaDoCalculo` em `db/visao-individual.ts`). `calculos.ts` e
     `lib/visao-individual.ts` não mudam: recebem as vendas já filtradas.
   - View `vendas_aprovadas` (recriada na 0008 com `p.desconsiderado_em IS NULL`), lida em `src/worker/db/adesao.ts`:
     `GET /api/admin/afiliados` (vendas, primeira e última venda de cada afiliado e `sem_afiliado`; os totais do
     afiliado), a resposta do `PUT /api/admin/afiliados/:affiliateId` e `GET /api/admin/adesao`
     (`pedidos_aprovados` e `primeira_venda_em` de cada célula: o "Já vendeu"; e o `com_venda` do resumo).
   - `src/worker/db/mapa-ddd.ts`, `comandoMapaDdd` (D17): a coluna está na linha que a consulta já lê.
   - `src/worker/db/lista-pedidos.ts`: os totais por status com `p.desconsiderado_em IS NULL`; o item com as três
     colunas (vira `desconsiderado`); o filtro. Junto, `p.origem` em `COLUNAS_ITEM` (o campo `origem` da RIFA-012,
     D16), conferindo `src/worker/db/pedidos-webhook-desempenho.test.ts`.
   - `src/worker/db/pedidos-suspeitos.ts`: a lista traz a desconsideração (o JOIN com pedidos já existe); não sai
     da lista nem do `total`.
   - Caches: `lib/cache-publico.ts` (30 s) e a base da visão (`db/visao-individual.ts`, 30 s) não são invalidados:
     a mudança aparece em até 30 s, como uma venda nova. O bumbo de uma data passada é recalculado e passa a vir
     sem o pedido.
   - Não excluem, de propósito: o `ultimo_aprovado_em` de `db/estado-webhook.ts` (é a saúde do webhook: a aprovação
     chegou; o plano não muda, pelo índice `pedidos_por_status_aprovacao`), a marcação de suspeito do webhook
     (`db/pedidos.ts` e `lib/plausibilidade.ts`), a convenção do valor da conferência (`convencaoDoArquivo` em
     `lib/conferencia-analise.ts`: compara o valor gravado com o do arquivo, e o do desconsiderado é o certo) e o
     histórico das recuperações (`recuperacoes.pedidos_recuperados`, `bilhetes` e `total_centavos`, gravados na
     hora, e os ids de `GET /api/admin/reconciliacao/recuperacoes`: o que a recuperação gravou).
   - Webhook (`db/pedidos.ts`): o UPSERT não toca nas colunas novas. Teste: `paid_order` de um pedido `in_process`
     desconsiderado o deixa aprovado, desconsiderado e fora de todas as contas.
5. **Orçamento do D1 (D10).** O painel continua com ~1 linha lida por pedido aprovado que conta (o desconsiderado
   sai do índice); a view, o mapa e os totais da lista leem a coluna na linha que já leem (nenhuma linha a mais); a
   página da lista com `desconsiderado=true` usa o índice parcial novo e lê só os desconsiderados (com `false`, o
   da 0007); desconsiderar lê até 10 linhas e reconsiderar, 9 (medido e travado em regras-campanha.test.ts); remover afiliado lê os pedidos dele (índice por
   afiliado). A chave do acesso custa +1 linha (a campanha ativa) em cada `/api/minha/*` e em cada `POST
   /api/sessao` de discipulador e rede: lida na mesma consulta da sessão (subconsulta), sem ida a mais. O índice
   novo pode desviar o planejador (D16): travar os planos e as linhas lidas em `db/painel.test.ts`,
   `routes/painel-desempenho.test.ts`, `db/mapa-ddd-desempenho.test.ts`, `db/pedidos-webhook-desempenho.test.ts` e
   `routes/minha-desempenho.test.ts` (linhas exatas, agora com a da chave), e medir antes e depois as leituras da
   view em `db/adesao.ts` (o índice novo da 0003 também serve a ela). As somas da conferência (`PAGOS_DA_CAMPANHA`
   em `db/reconciliacao.ts`) usam hoje o índice da 0003 de cobertura e só continuam nele com o filtro repetido
   (provado: sem ele, vão para o da 0007, e o agrupamento por afiliado ganha B-tree temporária); nenhum teste trava
   esses planos hoje: a -db trava ao menos o de `SOMAR_PAGOS` e o de `SOMAR_POR_AFILIADO` com `EXPLAIN QUERY PLAN`.
6. **Trilha** (tabela `auditoria`, 0005; D11). `pedido.desconsiderar`: resumo com o id do pedido em JSON (pode ter
   aspas), o status, os bilhetes, a célula (pelo id) e o motivo; da observação, só "observação informada" (texto
   livre, como o rótulo do afiliado). `pedido.reconsiderar`: o id, o motivo que tinha e quando fora desconsiderado.
   `afiliado.remover`: a célula que ele tinha e quantos pedidos desconsiderados ficaram sem afiliado (os ids, se
   couberem nos 1.000 caracteres). No `campanha.salvar`, as chaves com o antes e o depois ("acesso.redes: ligado →
   desligado") e, das mensagens, só o nome do modelo alterado. O que não muda nada não registra (RIFA-018).
   **RIFA-043:** o primeiro salvamento (o que cria e ativa a campanha) diz também como as regras nasceram, no mesmo
   formato sem o antes: as três chaves com o valor gravado (o do corpo ou o padrão) e o nome de cada mensagem
   diferente do padrão (`acesso.redes: desligado`, `mensagens.link_lider`).
7. **Conferência pelo CSV (RIFA-012, D19).** Os pedidos do sistema somados pela conferência (`PAGOS_DA_CAMPANHA` em
   `src/worker/db/reconciliacao.ts`: total do sistema, ausentes do arquivo, somas por afiliado e por dia) excluem o
   desconsiderado, para os totais do sistema baterem com o painel. Na busca dos pedidos do arquivo pelo id, o
   desconsiderado vem com a marca e **aparece como desconsiderado, nunca como "faltando"**: não é `venda_perdida`
   (ele existe), não é `pagamento_nao_registrado`, `nao_pago_na_rifei` (um estorno já desconsiderado está
   resolvido), `ausente_no_arquivo` (uma compra de teste fora do arquivo) nem diferença de valor, quantidade ou
   afiliado: vai para o grupo à parte `desconsiderados` da análise por pedido (`grupoDesconsideradosSchema`, com o
   lado do arquivo, o do sistema e a desconsideração; `.optional()` só até a -api montá-lo, depois sempre
   presente). Os desconsiderados do sistema que não estão no arquivo não aparecem (não contam nem há o que
   conferir). O "Recuperar" nunca o grava de novo nem o reativa (`ja_existe`). Na consulta, o desconsiderado sai
   de `PAGOS_DA_CAMPANHA` e entra na busca pelos ids do arquivo com as três colunas na tupla curta. A trava do
   código (`conferirCodigo`) compara o mesmo conjunto dos dois lados: `CONTAR_PAGOS_NO_PERIODO` (que usa
   `PAGOS_DA_CAMPANHA`) já fica sem o desconsiderado, então o `pagosNoPeriodoNoArquivo` de `decidir`
   (`lib/conferencia-analise.ts`) também pula o desconsiderado.
8. **Proteção** (`src/worker/protecao.test.ts`): `ROTAS_REGRAS_CAMPANHA` entra no teste no mesmo merge que monta as
   rotas (401 sem cookie, 403 da coordenação, passa com admin). Com a chave desligada, o discipulador e a rede levam
   403 `acesso_desligado` em todo `/api/minha/*` (inclusive caminho sem rota) e no `POST /api/sessao`; o líder não
   muda. O teste de admin dos acessos (`routes/admin-usuarios.test.ts`) cobre o 409 do link avulso.
9. **Site.** Campanha: as três chaves e as quatro mensagens, com a pré-visualização preenchida e os problemas do
   modelo antes de salvar. Pedidos: o selo "Desconsiderado (motivo)", as ações (só admin e só com a chave ligada),
   o filtro e a marca "Recuperado na conferência" (`origem`). Acessos: sem gerar nem mandar link do papel desligado
   (o aviso diz que a chave está na Campanha), e as mensagens montadas com `preencherMensagem` e o modelo da
   campanha no lugar de `mensagemWhatsApp` e `mensagemHierarquia` (os testes de hoje de
   `src/web/pages/acessos/textos.test.ts` continuam passando sem mudar); um modelo gravado com problema
   (`problemasDoModelo` não vazio) dá lugar ao padrão do tipo, para nunca mandar mensagem sem o link. Afiliados:
   "Remover" (só admin) com o 409 explicado e os ids. /minha e a página de acesso: a mensagem do 403
   `acesso_desligado`. Trilha: o tipo de alvo `pedido`.

### Adendo (RIFA-042, 2026-11-12): as regras na conta do admin e os modelos sem outro endereço

Reforços da revisão de segurança RIFA-041 (decisões do SM, reversíveis; o PO foi informado). Responde à pergunta
"quem muda as chaves" acima: o PO pediu as regras "na conta do admin".

- **`pedidos`, `acesso` e `mensagens` só do admin.** No `PUT /api/admin/campanha`, quem não é admin (a coordenação)
  e manda algum dos três diferente do gravado (sem campanha, dos padrões) leva **403 `proibido`**, só com `codigo` e
  `mensagem` (a mensagem diz quais grupos mudavam; nenhum detalhe novo no contrato), e nada é gravado (nem o resto
  do corpo, nem a trilha). Ordem: 400 (schema) → 403 → 409 (slug). Ausentes ou iguais ao gravado passam, mas a
  gravação vai **sem** eles (`semGruposDoAdmin` em `db/campanha.ts`): o PUT da coordenação nunca escreve essas
  colunas, então um admin que as muda entre a leitura e o lote não é desfeito (sem transação interativa, que o D1
  não tem). Sem sessão (só no sub-app montado sem o login, nos testes), também não é admin. O resto da campanha
  continua com a coordenação. Site: na Campanha, para a coordenação, os cartões "Pedidos e acessos" e "Mensagens do
  link pessoal" ficam só leitura, com o aviso "Só o admin muda estas regras." (caixas com `aria-disabled`, textos com
  `readOnly`, focáveis e descritos pelo aviso; sem "Voltar ao texto padrão"), e o PUT dela não manda os três (um
  modelo gravado com problema não barra mais o salvamento do resto). O resumo "Regras da campanha" continua para os
  dois papéis. Testes: `routes/regras-campanha.test.ts` (RIFA-042) e `pages/campanha/RegrasDaCampanha.test.tsx`.
- **Modelos das mensagens** (`problemasDoModelo`, `regras.ts`; a API recusa com 400 e a Campanha avisa enquanto a
  pessoa digita): o `{link}` só no começo ou depois de espaço, tabulação ou quebra de linha (colado no texto de
  antes, como em `https://outro.site/?u={link}` ou `x{link}`, o link pessoal vira o fim de outro endereço, e a
  prévia do WhatsApp de quem envia leva o token a esse site; no modelo da coordenação, o link de um admin) e nenhum
  outro endereço no modelo: `://`, `www.` ou um domínio seguido de barra (`site.com/`, `bit.ly/`). É a regra mais
  simples que pega os casos comuns sem acusar os textos padrão; um domínio solto, sem barra nem `www.` (`site.com`),
  passa (não leva o token: o `{link}` continua separado). A Acessos mantém a defesa da RIFA-041 para modelos já
  gravados (`modeloDaMensagem`: o padrão do tipo no lugar do modelo com problema, agora também com outro endereço).
- **Recuperar da conferência com a plausibilidade da D11.** O pedido recuperado com mais de 200 bilhetes, ou com o
  total acima de bilhetes × preço do bilhete da campanha ou abaixo da metade disso, entra em `pedidos_suspeitos` com
  os mesmos motivos do webhook (`avaliarPlausibilidade`, `lib/plausibilidade.ts`), no mesmo `db.batch` da gravação
  (`gravarRecuperacao`, `db/reconciliacao.ts`): só o que entrou neste lote (`recuperacao_id` da recuperação), com
  `marcado_em` = o instante da recuperação. Continua contando, como no webhook. A prévia não marca; a resposta e a
  trilha (`conferencia.recuperar`) não mudam. O Recuperar continua com a coordenação (a venda perdida; marcar como
  pago o pagamento não registrado é só do admin: adendo da RIFA-056 na D19).

## D21. Token do webhook gerado pela tela da coordenação (RIFA-039; contrato, 2026-11-11)

O token do webhook da Rifei era só o segredo do Worker `RIFEI_WEBHOOK_TOKEN` (D6 da integração), gravado com
`npx wrangler secret put` na máquina do PO. O PO não tem Node nem wrangler e quer fazer tudo pelo site, e o token
precisa ir da tela direto para a Rifei (menu do usuário → Integrações → Outro → Adicionar), sem passar por chat,
e-mail ou WhatsApp. Contrato em `src/shared/contracts/token-webhook.ts` (sem zod: formato, credenciais e as regras
puras) e `api.ts` (schemas e o catálogo `ROTAS_TOKEN_WEBHOOK`); testes em `token-webhook.test.ts`.

- **Desenho.** Duas rotas **só de admin**, no catálogo à parte `ROTAS_TOKEN_WEBHOOK` (como `ROTAS_REGRAS_CAMPANHA`,
  D20, até a -api montá-las):
  - `GET /api/admin/webhook/token`: o estado (`estadoTokenWebhookSchema`, estrito): `vigente` (`tela`, `segredo` ou
    null), `gerado_em`, `ultimo_uso_em`, `segredo_configurado` e a `url` para colar na Rifei (origem da requisição
    + `/api/webhooks/rifei`, como as URLs dos links). **Nunca o token nem o hash.**
  - `POST /api/admin/webhook/token { substituir? }`: gera um token novo e responde **201** `{ token, estado }`, a
    única vez em que o token aparece. Com credencial vigente (o token da tela ou o segredo do Worker) e sem
    `substituir: true`: **409 `em_uso`** com `{ "vigente" }` e nada muda; a tela pede a confirmação ("as vendas
    param até o token novo ser colado na Rifei") e repete com `substituir: true`. Uma aba antiga ou um duplo clique
    não derruba o webhook sem confirmação. Nenhum código de erro novo.
- **Token**: 32 bytes de `crypto.getRandomValues` (256 bits) em hex minúsculo, 64 caracteres
  (`FORMATO_TOKEN_WEBHOOK`): só letras e números, como o `openssl rand -hex 32` que o roteiro já usava (nada de `+`,
  `/`, `=`, `-` ou `_` que o formulário da Rifei corte ou que o toque longo do celular pare de selecionar). Por isso
  não é o `gerarSegredo()` dos links (base64url).
- **Banco**: tabela de uma linha `token_webhook` (migração `0009_token_webhook.sql`; plano em
  [modelo-de-dados.md, seção 10](modelo-de-dados.md#10-migração-0009_token_webhooksql-rifa-039-d21)) com o
  **SHA-256 em hex** do token e `gerado_em`. É o padrão dos links e das sessões (D8, acesso.md seção 4). HMAC não:
  com 256 bits aleatórios, o SHA-256 já não deixa quem lê o banco montar o token, e a chave do HMAC seria outro
  segredo do Worker, o `wrangler secret put` que a tarefa quer evitar. Gerar de novo substitui a linha (UPSERT): o
  anterior para de valer na requisição seguinte, em todos os servidores (sem cache, abaixo). Quem gerou fica na
  trilha. Limitação: o token e o hash têm o mesmo formato (64 hex), então o CHECK da coluna não distingue um do
  outro; a varredura das tabelas atrás do token é obrigatória (abaixo).
- **Segurança**:
  - o token só sai na resposta 201 (com `Cache-Control: no-store`, como toda resposta autenticada). Nunca no GET, na
    trilha, no banco (só o hash), em log (`console.*`), em mensagem de erro, na URL ou no `detalhes` de um erro. Se
    a gravação falha, a resposta é 500 e o token é descartado sem ter sido mostrado;
  - o webhook compara **em tempo constante**: o SHA-256 do Bearer contra o hash gravado, com
    `crypto.subtle.timingSafeEqual` sobre resumos de tamanho fixo (como `lib/tempo-constante.ts`). Nunca `===` nem
    `WHERE token_hash = ?`: a leitura é pela chave (`WHERE id = 1`), a mesma para qualquer token, e lê sempre 1 linha;
  - o site mostra o token uma vez, com "Copiar", e não o guarda (nada de localStorage, sessionStorage, URL ou
    histórico); ao sair da tela ou gerar outro, ele some da memória;
  - login, papel e CSRF como toda escrita de `/api/admin/*` (D8, D9).
- **Compatibilidade: o token da tela tem prioridade.** Com token da tela, só ele vale e o `RIFEI_WEBHOOK_TOKEN` é
  ignorado; sem token da tela, vale o segredo (como hoje); sem nenhum dos dois, **503 `nao_configurado`** (antes:
  sem o segredo). Regra executável: `credencialVigenteDoWebhook` (com `segredoDoWorkerConfigurado`: o segredo vazio
  ou só de espaço não conta, como antes). Por quê:
  - uma credencial por vez: "gerar de novo invalida o anterior" vale também para o segredo do Worker, que o PO não
    consegue apagar sem o wrangler. Um segredo que vazou é neutralizado pela tela. "Aceitar qualquer um" deixaria o
    segredo antigo valendo para sempre ao lado do token da tela;
  - o modelo para o PO é simples: vale o último gerado;
  - custo aceito: gerar o PRIMEIRO token na tela, com o segredo configurado, também para as vendas até o token novo
    ser colado na Rifei. Por isso o 409 vale também para `vigente: "segredo"`.
  - Voltar para o segredo do Worker depois de usar a tela: com o segredo já gravado no Worker, o SM apaga a linha
    no D1 remoto (`DELETE FROM token_webhook`), fora da API e sem trilha, e o PO cola o valor do segredo na Rifei
    logo em seguida (entre os dois, 401; sem o segredo gravado, 503). É contingência, não fluxo.
- **Orçamento do D1 (D10)**: o webhook passa a ler **1 linha por requisição** (a de `token_webhook`, pela chave;
  `rows_read` 1 com a tabela vazia ou não, medido no D1 local do workerd), autenticada ou não, e nenhuma escrita a
  mais. Antes: 0 linhas no 401 e no 503. A requisição sem Bearer também lê, porque o 503 depende de haver token na
  tela; uma enxurrada de 401 custa 1 linha cada, limitada pela cota de requisições do Workers (D11).
- **Cache no isolate: considerado e recusado.** A campanha deve ter de 20 a 30 mil entregas (7 mil pedidos × 2 a 4
  eventos), ~1 por minuto em média, contra 5 milhões de linhas lidas por dia no plano Free: o cache economizaria
  quase nada. E traria uma janela (o TTL) em que o token antigo ainda vale nos outros isolates depois de gerar o
  novo, e em que o "último uso" pode mostrar uma entrega do token antigo como se fosse do novo. Sem cache, a
  invalidação é imediata em todo servidor. Se um dia precisar (ex.: enxurrada de 401): TTL de 30 s; o isolate que
  gera zera o próprio cache; a divergência entre o Bearer e o hash em cache força uma releitura (o token novo entra
  na hora); nos outros isolates o anterior vale por até 30 s; e o último uso passa a contar só a partir de
  `gerado_em` + 30 s.
- **Último uso, sem escrita no webhook.** O GET calcula na leitura com a última entrega autenticada
  (`ULTIMA_ENTREGA` de `db/estado-webhook.ts`, ~8 linhas lidas com 3 mil entregas, medido): com o token da tela, a
  última entrega recebida em ou depois de `gerado_em` (antes disso, null: "ainda não usado"); com o segredo, a
  última entrega (`ultimoUsoDoWebhook`). Toda entrega autenticada vira uma linha de `webhook_eventos` (D3), inclusive
  as recusadas pelo corpo (400 e 413); 401, 503 e 500 não. Gravar `ultimo_uso_em` numa coluna custaria uma escrita
  e mais uma linha lida no webhook. Sem cache e com a prioridade da tela, depois de `gerado_em` só o token da tela
  autentica. Fica só a corrida de milissegundos de uma entrega que leu a linha antes da troca e gravou o
  `recebido_em` depois dela.
- **Trilha** (D11): `webhook.gerar_token`, alvo `webhook` (`ALVO_AUDITORIA_TOKEN_WEBHOOK`), no MESMO `db.batch` da
  gravação, com o registro antes e a mesma condição. O resumo diz o que deixou de valer ("não havia credencial", "o
  segredo do Worker deixou de valer" ou "o token anterior, gerado em <instante>, deixou de valer") e nunca traz o
  token nem o hash. O 409 não registra.
- **Primeiro admin** (só docs, lançamento 3.1): o SM cria o primeiro admin pela sessão
  (`npm run acesso:criar -- ... --remote`) e manda o link ao Thiago. Ele abre, gera um link novo para si, abre o
  novo e só então revoga o primeiro, que passou pelo chat. Com o token pela tela, o lançamento não pede Node na
  máquina do PO; o wrangler fica como alternativa.
- **Riscos que continuam**:
  - entre gerar e colar na Rifei, as entregas recebem 401, não são gravadas e se perdem (a conferência pelo CSV
    recupera, lançamento 6.4). A tela avisa antes de confirmar;
  - a resposta 201 se perde (a rede caiu no meio): o token novo já vale e ninguém o viu. A tela mostra "gerado em …,
    ainda não usado"; gere de novo;
  - **rollback do código** para uma versão de antes da RIFA-039: ela só conhece o segredo do Worker. Com só o token
    da tela, o webhook passa a responder 503 (ou 401, com um segredo antigo) até voltar a versão nova (lançamento
    2.4). E ao voltar a versão nova, a linha (que o rollback não apagou) volta a ter prioridade sobre o segredo que
    a Rifei estiver usando: apague a linha antes ou gere de novo e cole na Rifei;
  - **Time Travel do D1** para antes de uma geração: a linha volta ao que era (sem token, ou o anterior), e volta a
    valer o que valia naquele ponto, mesmo que tenha vazado (o token anterior ou o segredo do Worker). Gere de novo e
    cole na Rifei (lançamento 2.4). Para antes da 0009, a tabela some e o webhook responde 500 em toda entrega até as
    migrações rodarem de novo (falha fechada: não cai para o segredo);
  - **quem gera o token o conhece**: um admin mal-intencionado poderia gerar um e mandar entregas falsas com ele até
    a próxima troca. A troca derruba as entregas da Rifei (401) e fica na trilha com quem fez; as entregas falsas
    ficam em `webhook_eventos`. Por isso só admin, e o PO gera e cola ele mesmo;
  - **repetição**: uma entrega repetida da Rifei é idempotente (D3, `duplicado`). O POST da geração só passa com a
    sessão e da mesma origem (D8); repetido com `substituir: true` (duplo clique na confirmação, duas abas já
    confirmadas), gera dois tokens e só o último vale, então a tela manda um POST por vez (item 8);
  - token errado na Rifei continua sem registro (401 não é gravado; D16): o alerta mostra "nenhuma venda". A tela
    do token ajuda: `ultimo_uso_em` null depois de colar e de uma compra quer dizer token errado ou não colado.

### OBRIGATÓRIO NA IMPLEMENTAÇÃO

1. **Migração `0009_token_webhook.sql`** (-db), como no plano de modelo-de-dados.md, seção 10, entrando na `main`
   DEPOIS da `0008_regras_campanha.sql` da RIFA-028 (o número é reservado). Teste em `src/worker/test/migrations.test.ts`:
   a 0009 sobre dados das anteriores; o CHECK de uma linha só (`id = 1`), do hash (64 hex minúsculos) e do instante.
2. **Webhook** (`routes/webhook-rifei.ts`, -api), nesta ordem: (a) ler `SELECT token_hash FROM token_webhook WHERE
   id = 1` (1 linha); se a leitura falhar, 500 pelo `onError`, **nunca** cair para o segredo; (b)
   `credencialVigenteDoWebhook({ tokenDaTela, segredoConfigurado:
   segredoDoWorkerConfigurado(c.env.RIFEI_WEBHOOK_TOKEN) })`; (c) null: 503 `nao_configurado`, nada gravado;
   (d) o Bearer como hoje; (e) `tela`: SHA-256 do Bearer contra o hash em tempo constante (o mais simples:
   `textosIguaisEmTempoConstante(await sha256Hex(bearer), token_hash)`); `segredo`: o
   `textosIguaisEmTempoConstante` de hoje; (f) diferente ou ausente: 401 com `WWW-Authenticate: Bearer`. O resto do
   fluxo não muda. Sem cache (nem réplica de leitura do D1, `withSession`), sem escrita nova e sem o token em log.
3. **Testes do webhook** (-api): com o token da tela, ele passa e o segredo do Worker leva 401; sem o token da tela,
   o segredo passa (os testes de hoje continuam valendo sem mudar: a tabela começa vazia); sem nenhum dos dois, 503;
   o token anterior leva 401 logo depois de gerar outro (sem cache); 1 linha lida a mais por requisição
   (`meta.rows_read`), na autenticada, no 401 e no 503, e nenhuma escrita a mais. O D1 dos testes é um por arquivo:
   o teste que grava o token apaga a linha no fim, para os do segredo no mesmo arquivo.
4. **Rotas** (-api), num sub-app novo ou no `routes/webhook-coordenacao.ts`, sob `/api/admin` (passo 4 do
   `index.ts`). O "só admin" fica no HANDLER das duas rotas (ou num `use` do caminho exato, como
   `routes/auditoria.ts`), nunca num `use` de `/api/admin/webhook/*` (as entregas e o estado continuam da
   coordenação), e vem antes do corpo: a coordenação leva 403, nunca 400 ou 409. `ROTAS_TOKEN_WEBHOOK` entra em
   `ROTAS_DA_COORDENACAO` do `src/worker/protecao.test.ts` no mesmo merge (401 sem cookie, 403 da coordenação e da
   hierarquia, 403 no POST de outra origem); o teste "toda rota registrada sob /api/admin e /api/painel está em
   ROTAS_DA_COORDENACAO" falha até ele entrar.
5. **POST** (-api): ler a linha (1 linha) para decidir o 409 e o `vigente` do detalhe; gerar o token
   (`BYTES_TOKEN_WEBHOOK` em hex) e o `sha256Hex` (`lib/cripto.ts`); um `db.batch` com o registro na trilha e a
   gravação sob a MESMA condição: sem `substituir`, `INSERT ... WHERE NOT EXISTS` na trilha e `INSERT ... ON CONFLICT
   (id) DO NOTHING` no token (`changes` 0: 409, outra aba gerou no meio); com `substituir`, o resumo lê o `gerado_em`
   anterior por subconsulta e o token vai por UPSERT. O segredo do Worker sem `substituir` dá 409 antes do lote.
   Responder 201 com `respostaGerarTokenWebhookSchema`.
6. **GET** (-api): a linha (1) e `ULTIMA_ENTREGA` (~8 linhas), com `ultimoUsoDoWebhook`, e a `url` pela origem da
   requisição com `CAMINHOS_WEBHOOK_RIFEI[0]`. A resposta passa pelo `estadoTokenWebhookSchema` (estrito).
7. **Varredura** (-db/-api), como a de `db/acessos.test.ts`: depois de gerar, nenhuma coluna de nenhuma tabela tem o
   token (o hash sim, só em `token_webhook`); a trilha tem a linha, sem o token e sem o hash; a resposta do GET e a
   da trilha não têm o token.
8. **Site** (-web), só admin: o estado (credencial vigente, desde quando, último uso, a URL com "Copiar") e o botão
   "Gerar token do webhook". Com credencial vigente, a confirmação explica que o anterior para de valer na hora e
   que as vendas param até colar o novo na Rifei (com o segredo do Worker, o mesmo aviso). O token aparece uma vez,
   com "Copiar", ao lado do passo a passo da Rifei (Integrações → Outro → Adicionar; URL, Token e os três eventos);
   não vai para storage, URL nem log, e some ao sair da tela. Um POST por vez: o botão e a confirmação ficam
   desabilitados enquanto a geração está em andamento (com `substituir`, um duplo clique geraria dois tokens e só o
   último vale). 409 `em_uso` (outra aba): recarrega o estado e pede a confirmação. Na Trilha, o rótulo do alvo
   `webhook` (o da ação já está no contrato).
9. **Docs** (feitos neste contrato): lançamento 3.1, 3.2, o resumo do topo e as seções que citavam o segredo;
   integracao-rifei.md; api.md; acesso.md; modelo-de-dados.md. Se o -web der outro nome à tela ("Acessos → Webhook da
   Rifei" é a SUPOSIÇÃO), o SM acerta os docs no mesmo merge.

## D22. Volta do site para a versão anterior pelo celular (RIFA-035, 2026-11-11)

O PO não tem Node nem wrangler e acompanha pelo celular; a volta do código (`npx wrangler rollback`) só dava pelo
terminal, e a publicação só acontecia por push na `main`.

- **Workflow manual** `.github/workflows/voltar-versao.yml` ("Voltar o site para a versão anterior"): só
  `workflow_dispatch`, com `motivo` (obrigatório) e `versao` (opcional; vazio = a anterior à que está no ar). No
  padrão da D18: o job só roda a partir da `main` (`if: github.ref == 'refs/heads/main'`; de outra branch, é pulado),
  `permissions: contents: read`, as mesmas actions fixadas por SHA, checkout sem credenciais, setup-node sem cache,
  `npm ci --ignore-scripts` e o token só no passo da volta (com o id da conta e as entradas `MOTIVO` e `VERSAO`,
  que vão pelo `env` e nunca escritas no script: o texto digitado não vira comando). Sem o segredo, avisa ("volta
  da versão pulada") e fica verde. Depois da volta, confere `/api/health` como o `publicar`. O job usa o mesmo grupo
  de concorrência do `publicar` (`deploy-producao`, sem cancelar no meio): uma volta e uma publicação nunca rodam
  juntas. Roteiro: lancamento.md, 2.4 e 7.2.
- **Por que não o `wrangler rollback`:** no CI (sem terminal) o wrangler 4.156.1 responde "sim" sozinho a toda
  pergunta, com ou sem `--yes` (o `--yes` só aceita os padrões; a pergunta dos segredos não olha para ele), e a de
  "os segredos mudaram desde aquela versão; continuar?" vira um segundo pedido com `?force=true`: volta com os
  segredos de antes, e o webhook pode parar ou voltar ao token antigo (o cuidado da 2.4). Provado na RIFA-035 com o
  wrangler do projeto contra uma API fictícia em 127.0.0.1, e travado em `scripts/voltar-versao.test.mjs` (se uma
  subida do wrangler mudar isso, o teste falha: reveja esta decisão). O workflow roda `node scripts/voltar-versao.mjs`,
  que lista as publicações (`wrangler deployments list --json`), escolhe a anterior pela mesma regra do rollback (a
  versão com 100% da publicação mais recente antes da atual) ou a do id, e roda
  `wrangler versions deploy <id>@100% --message=<motivo> --yes`: a mesma publicação (a versão com todo o tráfego, o
  motivo como mensagem), sem nunca mandar o `?force=true`. Com segredos trocados, a Cloudflare recusa (código
  10220), nada muda no site, e o script termina com erro explicando como rodar de novo com o id de uma versão
  publicada depois da troca do segredo. O `versions deploy` também reaplica as configurações não versionadas do
  `wrangler.jsonc` (`observability`), as mesmas que o `wrangler deploy` aplica.
- **O script** (`scripts/voltar-versao.mjs`) confere as entradas antes de chamar o wrangler (motivo numa linha, até
  120 caracteres, como o rollback pede; versão vazia ou um id de versão), passa o motivo como `--message=<motivo>`
  (um motivo que comece com "-" não vira opção) e escreve no log e no resumo da execução (a página do run, legível
  no celular) a lista das publicações recentes, com data, id, origem e mensagem, sem o e-mail de quem publicou.
  Antes da primeira publicação, ou com uma publicação só, termina com erro: não há versão anterior. Revisão: com
  `versao` vazio e a versão no ar sendo uma volta (ela já tinha 100% numa publicação mais antiga da lista), a regra
  do rollback escolheria a versão que a volta tirou do ar (um toque a mais no celular ou um Re-run poria o defeito
  de novo no ar); aí o script termina com erro sem mudar nada, e pede o id em `versao` para desfazer a volta ou
  voltar mais. Fora desse caso, a escolha é a do rollback. O `wrangler rollback` também força os segredos trocados
  em qualquer terminal sem interação (a sessão do Claude, um script): ali, o SM usa o `wrangler versions deploy`.
- **Publicar de novo sem commit:** o `ci.yml` ganhou `workflow_dispatch` (sem entradas). Na `main`, **Run workflow**
  refaz o build e a publicação, como um push; noutra branch, só o job `ci`. O `publicar` passa a rodar em
  `(push || workflow_dispatch) && main`; o resto da D18 não muda (token só no "Publicar"). Por quê: o "Re-run all
  jobs" continua valendo, mas pede achar a última execução da `main` e escolher o "all" (o "failed" baixaria um
  artefato vencido), e o roteiro mandava um commit vazio quando a publicação ainda saía "pulada". Não abre superfície
  nova: um push em qualquer branch já roda o `ci.yml` daquela branch, com o segredo do repositório ao alcance.
- **Travas** em `src/worker/config-publicacao.test.ts`: os workflows da pasta são só o `ci.yml` e o
  `voltar-versao.yml` (um novo falha até ganhar as travas dele); em todos, actions por SHA, nenhum
  `pull_request_target` nem `workflow_run`, permissão só de leitura no topo, nenhum `${{ }}` dentro de um `run`,
  checkouts sem credenciais, nada no `$GITHUB_ENV`/`$GITHUB_PATH`, sem `defaults`, `shell`, `working-directory`,
  `continue-on-error` ou `environment:`; o token só em dois passos (o "Publicar" e a volta); no `voltar-versao.yml`,
  só o disparo manual com as duas entradas, o job só da `main` e no grupo `deploy-producao`, a ordem dos passos, o
  `npm ci --ignore-scripts`, nada de `npx`, `npm run`, build ou cache, o script no lugar do rollback e o
  `/api/health` no fim; no `ci.yml`, os gatilhos (`push`, `pull_request`, `workflow_dispatch`) e o `if` do
  `publicar`. Cada trava foi provada com uma mutação do YAML (o teste falha) e o leitor por linhas conferido contra
  o PyYAML.
- **Riscos que continuam:** como na D18, o segredo é do repositório: um workflow alterado noutra branch pode lê-lo
  (o `if` da `main` só impede rodar o workflow oficial de outra branch). Com o GitHub Pro e o ambiente `producao` da
  D18, o job `voltar` também recebe `environment: producao` (junto com o `publicar`, trocando as travas). O banco não
  volta: uma versão antiga roda sobre o esquema novo (as migrações são aditivas), e voltar para antes da RIFA-039
  tem o cuidado da D21. Uma volta na fila do grupo `deploy-producao` é substituída por uma publicação que chegue
  depois dela (o GitHub guarda só a última pendente do grupo), e vice-versa: o run aparece como cancelado.
- **Teste de tempo da conferência (item extra):** `src/worker/routes/reconciliacao-desempenho.test.ts` trava o
  Worker em 30 ms (contra a regressão grosseira da D19, ler o CSV no Worker: ~300 ms com 7 mil pedidos), mas o
  relógio do workerd é de parede, e com a máquina carregada a gravação, medida uma vez só, chegou a 53 ms. Agora as
  três rotas (análise, simulação e gravação; a gravação desfaz o que gravou entre as rodadas, fora da medida) têm 1
  rodada de aquecimento e 7 medidas, e a trava vale para a MELHOR delas: a carga só acrescenta tempo, e uma regressão
  de verdade aparece em todas as medidas. A mediana continua no log. Medido na RIFA-035 (7 mil pedidos): sozinho, a
  melhor fica em 8 a 9 ms (mediana de 10 a 12); com duas suítes completas rodando juntas (load ~12 em 4 núcleos), de
  7 a 13 ms (mediana até 17). Só com 12 laços ocupando a CPU por cima disso (load ~19) a melhor passou de 30 ms
  (33 a 37) em parte das rodadas: ali o relógio de parede não separa o Worker da disputa pelos núcleos. Os outros
  `*-desempenho.test.ts` não mudam: o do painel e o da visão individual só registram o tempo no log (as travas
  deles são de trabalho e de linhas lidas), e o do mapa por DDD e o dos pedidos e do webhook medem `rows_read`.

## D23. Relatório da campanha para baixar, em CSV (RIFA-038; contrato, 2026-11-12)

No fim da campanha (e a qualquer momento durante ela), a coordenação quer baixar um relatório para guardar, prestar
contas e mostrar o resultado: por célula, por discipulador e por rede, por período e por dia, os totais da campanha
e, se fosse barato, o mapa por DDD. Contrato em `src/shared/contracts/relatorio.ts` (sem zod: tipos, colunas, formato
dos números, proteção contra fórmula, o arquivo, o nome e os cabeçalhos) e `api.ts` (`consultaRelatorioSchema`,
`respostaRelatorioCsvSchema` e o catálogo `ROTAS_RELATORIO`); testes em `relatorio.test.ts`.

- **Formato: CSV feito para o Excel em português.** UTF-8 **com BOM**, **`;`** entre as colunas, **vírgula** decimal,
  fim de linha **CRLF** (também depois da última linha) e aspas só quando precisa (`;`, aspas, quebra de linha ou
  espaço nas pontas; aspas internas dobradas). Por quê:
  - o Excel em português abre o CSV com dois cliques pelo separador de lista do Windows, que lá é `;` (a vírgula é o
    decimal); sem o BOM, ele lê o arquivo como Windows-1252 e quebra os acentos ("CÃ©lula"). É o formato do modelo
    da planilha da hierarquia (`public/modelos/hierarquia-modelo.csv`), que a coordenação já usou;
  - no Google Planilhas: Arquivo → Importar → Fazer upload, "Tipo de separador" em "Personalizado" com `;` (a tela diz assim; "Detectar automaticamente" também costuma servir); numa planilha com
    a localidade Brasil (o padrão de uma conta em português), `1234,56` vira número. No Excel em inglês: Dados → De
    Texto/CSV, escolhendo `;`;
  - sem a linha `sep=;`: o Google Planilhas a mostraria como dado e, com ela, o Excel deixa de olhar o BOM;
  - XLSX ou ZIP pediriam dependência nova; um arquivo só, com seções, quebraria o filtro e a ordenação da planilha
    (colunas diferentes na mesma folha).
- **Números** (executáveis em `relatorio.ts`): quantidades só com os dígitos, sem separador de milhar (`1234`); R$ em
  reais com vírgula e sempre 2 casas, sem "R$" e sem milhar (`1234,56`; o título da coluna diz "(R$)"), montados
  por texto a partir dos centavos, sem float (D2); percentuais a partir dos pontos-base já truncados (R11), com 2
  casas e sem "%" (`38,61`; acima da meta passa de 100; sem meta, a célula fica vazia); a meta na unidade da
  campanha, com o título "Meta (bilhetes)" ou "Meta (R$)"; datas em `AAAA-MM-DD` (sem ambiguidade de dia e mês em
  nenhum idioma; as planilhas em português as reconhecem como data e mostram 23/11/2026). Sem separador de milhar
  porque `1.234` vira 1,234 numa planilha em inglês, e `1234` é número em qualquer uma. Negativo, fração ou data
  fora do formato é erro de programação (`RangeError`): o relatório não tem número negativo.
- **Uma rota, um arquivo por tipo**: `GET /api/painel/relatorio?tipo=totais|celulas|discipuladores|redes|periodos|dias|ddd`.
  `tipo` é obrigatório (400 sem ele). **Sem `data`**: o relatório é sempre o retrato de agora (hoje no fuso da
  campanha); depois do fim, é o resultado final. Os tipos, as colunas (chaves, títulos e ordem) e os textos fixos
  são constantes exportadas: `TIPOS_RELATORIO`, `COLUNAS_RELATORIO`, `TITULOS_COLUNAS_RELATORIO`,
  `cabecalhoDoRelatorio(tipo, unidade)`, `TEXTO_FASE_RELATORIO`, `TEXTO_CRITERIO_RELATORIO`,
  `LINHA_EXTERIOR_RELATORIO` e `LINHA_SEM_DDD_RELATORIO`.
- **Proteção contra injeção de fórmula.** Os nomes da campanha e da hierarquia são digitados ou importados pela
  coordenação (`nomeSchema` só corta os espaços): uma célula chamada `=HYPERLINK("https://site.example";"clique")`
  seria executada por quem abrisse o arquivo. Toda célula do arquivo passa por `celulaCsv`, dentro de
  `montarCsvRelatorio`: texto que começa com `=`, `+`, `-` ou `@` (ou as formas de largura total ＝ ＋ － ＠), mesmo
  depois de espaços, ou com tabulação ou retorno de carro, ganha um apóstrofo na frente, e a planilha o mostra como
  texto (o apóstrofo pode aparecer na célula: é o preço). É a mesma família de sinais que a conferência trata como
  fórmula ao LER o CSV da Rifei (`pareceFormula`, D19), mais estrita: o `-` seguido de número também conta, porque
  os números do arquivo saem dos formatadores (só dígitos e vírgula) e nunca começam com sinal. Como a proteção vale
  para toda célula, inclusive as numéricas (que ela nunca muda, testado), a rota não tem como esquecê-la. O `|` do
  DDE (`=cmd|' /C calc'!A0`, `@SUM(1+1)*cmd|...`) só é executado numa célula que já começa como fórmula, e essas a
  proteção pega; sozinho ou no meio do texto, nem o Excel nem o Google Planilhas o executam, então ele não muda
  (testado). Um nome que já começa com apóstrofo também não muda.
- **Papéis**: grupo `coordenacao`, **sem `papeis`** (admin e coordenação, como o painel e o mapa), sob `/api/painel`:
  tem R$, então nunca é aberta nem da hierarquia (403 pelo login do prefixo, D12).
- **Cabeçalhos** (`cabecalhosDoRelatorio(tipo, data)`): `Content-Type: text/csv; charset=utf-8`,
  `Content-Disposition: attachment; filename="rifa-videira-kids-<tipo>-<data>.csv"` (data de referência = hoje no
  fuso da campanha; só ASCII, sem `filename*`) e `Cache-Control: no-store`. Os de segurança (com `nosniff`) vêm do
  middleware de sempre. Os erros continuam em JSON, no formato único.
- **Catálogo à parte**, `ROTAS_RELATORIO`, como o `ROTAS_REGRAS_CAMPANHA` (a `main` continua verde sem a rota). Desta
  vez ele já entra no `ROTAS_DA_COORDENACAO` do `src/worker/protecao.test.ts` com o contrato: sem `papeis`, os três
  testes passam antes da montagem (sem cookie, 401 do login do prefixo; com sessão, o 404 do caminho sem rota
  "passa") e passam depois dela. A -api acrescenta a conferência de que a rota está registrada no app.
  `DefinicaoRota.sucesso` ganhou `tipoConteudo` (opcional; ausente = JSON): o corpo 200 é o texto do CSV
  (`respostaRelatorioCsvSchema`, que exige o BOM).

**Colunas e a fonte de cada uma.** Tudo vem das leituras e dos montadores que o painel e o mapa já usam, com o
mesmo `agora` (uma chamada ao relógio). `lido` = `lerEntradaDoCalculo(db, relogio)` (escopo campanha, sem `data`).

| Tipo | Linhas | Colunas, na ordem (fonte) |
|---|---|---|
| `totais` | uma | Do `resumo = montarResumoPainel(lido.entrada, { escopo: lido.escopo }, lido.agora)`: Campanha (`resumo.escopo.nome`), Data de referência (`resumo.referencia.data`), Situação da campanha (`TEXTO_FASE_RELATORIO[resumo.referencia.fase]`), Início e Fim (`resumo.referencia.data_inicio` e `data_fim`), Meta (`resumo.campanha.meta`, na `resumo.unidade`), Pedidos aprovados, Bilhetes e Arrecadação (`resumo.vendas`: na janela até hoje, com as sem célula), % da meta (`resumo.campanha.percentual_meta_bp`), Pedidos, Bilhetes e Arrecadação sem célula (`resumo.vendas_sem_celula`), Pedidos, Bilhetes e Arrecadação fora das datas da campanha (`resumo.vendas_fora_da_janela`: antes do início + depois do fim), Pedidos desconsiderados (a contagem abaixo). Fora do resumo (o `campanha` dele é o ritmo, sem o critério): Critério do ranking (`TEXTO_CRITERIO_RELATORIO[lido.entrada.campanha.ranking.criterio]`) |
| `celulas` | uma por célula | Divisão (`NOMES_DIVISAO[item.divisao]`), Rede (`item.rede.nome`), Discipulador (`item.discipulador.nome`), Célula (`item.nome`), Líder (`lider_nome`, consulta abaixo), Meta (`item.meta`), Pedidos aprovados, Bilhetes e Arrecadação (`item.vendas`), % da meta (`item.percentual_meta_bp`), Posição na divisão (`item.posicao`) |
| `discipuladores` | uma por discipulador com célula | as mesmas, sem Célula e Líder; Rede = `item.rede.nome`, Discipulador = `item.nome` |
| `redes` | uma por rede com célula | as mesmas, sem Discipulador; Rede = `item.nome` |
| `periodos` | uma por período já começado (`data_inicio` ≤ hoje) | Período (nome), Início e Fim (as datas de `calcularCalendario`, mesmo com o período em andamento), Pedidos aprovados, Bilhetes e Arrecadação: soma de `lido.entrada.vendas` (todas as células e as sem célula) de `data_inicio` até `min(data_fim, hoje)` |
| `dias` | uma por dia, do 1º até `min(último dia, hoje)` (hoje, parcial; dia sem venda, zerado) | Data, Dia da campanha (1 = 1º dia), Período (o nome do que contém o dia), Pedidos aprovados, Bilhetes e Arrecadação do dia |
| `ddd` | uma por DDD com venda, na ordem do mapa, mais "Exterior" e "Sem DDD" (DDD vazio; sempre, mesmo zeradas) | UF, DDD, Pedidos aprovados (`pedidos_aprovados`), Bilhetes, Arrecadação (`total_centavos`) e % dos bilhetes (`parte_bilhetes_bp`). De `lerMapaDdd(db, relogio, { periodo: "campanha" })` e `montarMapaDdd` sem divisão: o mesmo que `/api/painel/mapa-ddd?periodo=campanha`. A data do nome do arquivo é o `hojeNoFuso(fuso, agora)` que `lerMapaDdd` já calcula: ela passa a devolvê-lo (`hoje`), sem ida a mais. O cabeçalho do `ddd` não tem meta: `cabecalhoDoRelatorio("ddd", unidade)` sai igual com qualquer unidade |

- Célula, discipulador e rede: para cada divisão em `ORDEM_DIVISOES` (jovens, depois adultos),
  `montarRankingPainel(lido.entrada, { nivel, divisao, periodo: "campanha" }, lido.agora)`, uma linha por item, na
  ordem do ranking. A posição é a do ranking DA DIVISÃO, na janela da campanha inteira (do 1º dia até hoje), pelo
  critério configurado (que está nos totais); empates dividem a posição (1, 1, 3) e, no critério % da meta, quem
  está sem meta vai para o fim (R8). Entram todas as instâncias, inclusive as que não venderam; discipulador ou
  rede sem nenhuma célula não aparece (R8).
- **Pedidos desconsiderados** (só nos totais): `SELECT count(*) FROM pedidos WHERE campanha_id = ? AND
  desconsiderado_em IS NOT NULL`, de qualquer status. Só o número: nem ids, nem motivo, nem quem desconsiderou.
- **Líder** (só em `celulas`): `SELECT id, lider_nome FROM celulas`. Só o nome, como na hierarquia; nunca
  `lider_telefone` nem `lider_email`.
- **As contas fecham** (e a -api testa): a soma dos períodos = a soma dos dias = os totais; a soma das células + as sem
  célula = os totais; a soma das células de um discipulador e de uma rede = a linha dele; a soma do `ddd` (com
  Exterior e Sem DDD) = os totais (pedidos, bilhetes e R$).

**Orçamento do D1 (D10)**, com o volume de `painel-desempenho.test.ts` (6.939 pedidos aprovados, 36 células, 24 dias:
o painel lê 8.876 linhas, 1,28 por pedido aprovado) e o de `mapa-ddd-desempenho.test.ts` (D17):

| Tipo | Leitura | Linhas lidas por download (ordem de grandeza) |
|---|---|---|
| `totais` | `lerEntradaDoCalculo` + a contagem dos desconsiderados, no mesmo lote | ~9 mil (~1,3 por pedido aprovado) + ~1 por desconsiderado (índice parcial `pedidos_desconsiderados_por_registro`, 0008: o plano sai `USING INDEX`, sem COVERING, mas a tabela não é lida) |
| `celulas` | `lerEntradaDoCalculo` + os líderes, no mesmo lote | ~9 mil + ~36 (uma por célula) |
| `discipuladores`, `redes`, `periodos`, `dias` | `lerEntradaDoCalculo` | ~9 mil |
| `ddd` | `lerMapaDdd` (campanha inteira) | ~11 mil (~2 por pedido aprovado; 10.925 medido na D17) |

Duas idas ao D1 por download em todos os tipos (a campanha ativa e um lote), sem N+1, sem cache e sem atualização
automática: só quando alguém aperta o botão. Baixar os 7 tipos custa ~65 mil linhas, ~1,3% dos 5 milhões diários do
plano Free. Nenhum índice novo. CPU: `celulas`, `discipuladores` e `redes` chamam o montador do ranking duas vezes
(uma por divisão; ~2 a 4 ms cada, medido no painel), dentro do plano Paid que a conferência já exige (D19).

**Na tela.** Visão geral (`/coordenacao`), num cartão "Relatório da campanha" no fim da página, para admin e
coordenação: um seletor "O que baixar" com os 7 tipos, na ordem de `TIPOS_RELATORIO` (rótulos sugeridos: "Totais da
campanha", "Por célula", "Por discipulador", "Por rede", "Por período", "Por dia", "Por DDD"), e o botão "Baixar
relatório". Por quê a Visão geral: é a tela de entrada da coordenação e a do resultado da campanha; os Rankings
mostram uma janela (a semana ou a campanha) e um nível por vez, e o relatório não segue esses filtros.

### OBRIGATÓRIO NA IMPLEMENTAÇÃO

1. **Exclusão do desconsiderado (D20).** Os pedidos vêm SÓ das leituras que já excluem o desconsiderado
   (`selecionarVendasPorDia` e `SELECIONAR_VENDAS` de `db/painel.ts`, por `lerEntradaDoCalculo`; `comandoMapaDdd` de
   `db/mapa-ddd.ts`, por `lerMapaDdd`). Nenhuma consulta nova soma pedidos; a única que lê desconsiderados é a
   contagem, e só conta. Teste: um pedido aprovado e desconsiderado, de uma célula e com DDD, não aparece em nenhum
   dos 7 tipos (célula, discipulador, rede, período, dia, DDD e totais) e entra em "Pedidos desconsiderados";
   reconsiderado, volta a todos.
2. **Nada pessoal.** Do comprador, só o DDD agregado (o banco não tem mais nada, D1); da hierarquia, só os nomes
   (`lider_nome`, nunca `lider_telefone` nem `lider_email`; o `SELECT` lê só `id, lider_nome`); nenhum id de pedido,
   `affiliate_id`, nome de usuário ou de quem desconsiderou. Teste de varredura: com telefone e e-mail nos líderes e
   ids de pedido e de afiliado reconhecíveis no banco, nenhum dos 7 arquivos contém nenhum deles.
3. **Proteção de fórmula.** O arquivo sai SÓ de `montarCsvRelatorio(cabecalhoDoRelatorio(tipo, unidade), linhas)` e
   os números SÓ dos formatadores (`formatarInteiroCsv`, `formatarCentavosCsv`, `formatarPercentualBpCsv`,
   `formatarMetaCsv` e `formatarDataCsv`); nada de juntar texto à mão nem de `String(numero)`. Teste: campanha,
   rede, discipulador, célula e líder com nomes `=1+1`, `+Vida`, `-x` e `@x` saem com o apóstrofo, e um nome com `;`
   e aspas sai entre aspas, lido de volta igual por `lerCsv` (`src/shared/csv.ts`).
4. **Orçamento (D10).** Duas idas ao D1 por download em todos os tipos: os comandos a mais (líderes, contagem) vão no
   lote de `lerEntradaDoCalculo` (`comandosExtras`, como a visão individual). Hoje `comandosExtras` não recebe o id
   da campanha: passe-o (`(db, campanhaId) => ...`, mudança pequena) ou use a subconsulta da campanha ativa (índice
   `campanhas_uma_ativa`), o que der o plano certo. Travar, como em `painel-desempenho.test.ts` e
   `mapa-ddd-desempenho.test.ts`, as idas e as linhas lidas (`meta.rows_read`) por tipo, com o volume sintético
   (~1,3 por pedido aprovado nos seis tipos do painel; ~2 no `ddd`), e o plano da contagem com `EXPLAIN QUERY PLAN`
   (`SEARCH pedidos USING INDEX pedidos_desconsiderados_por_registro (campanha_id=?)`) e as linhas lidas dela (N a
   N + 1 para N desconsiderados). Nenhum índice novo e nenhum plano do painel muda. **Correção da -api (revisão):** o
   plano não sai COVERING porque o índice parcial não tem a coluna do próprio filtro (`desconsiderado_em`); na
   execução, o `IS NOT NULL` é dado como satisfeito pelo índice e a busca na tabela nunca acontece (`count(*)` não lê
   coluna), então o D1 conta só as entradas do índice, com o custo de um índice de cobertura.
5. **Proteção** (`src/worker/protecao.test.ts`): `ROTAS_RELATORIO` já está em `ROTAS_DA_COORDENACAO` (este
   contrato). No merge que monta a rota, a -api acrescenta, no primeiro teste da seção a), que `GET
   /api/painel/relatorio` está registrada no app; a hierarquia leva 403 pelo prefixo, como hoje.
6. **Rota** (-api): no sub-app do painel (`routes/painel.ts`, `local(ROTAS_RELATORIO.baixarRelatorio.caminho)`, com
   `validarConsulta`), que já marca `no-store` inclusive nos erros. 200 com o CSV e TODOS os cabeçalhos de
   `cabecalhosDoRelatorio(tipo, referencia.data)` (`c.body(csv, 200, cabecalhos)`); 400 `requisicao_invalida` sem
   `tipo` ou fora da lista; 404 `nao_encontrado` sem campanha ativa (antes de montar qualquer coisa). As linhas
   de cada tipo, pela tabela acima, num módulo puro (`lib/relatorio.ts`) testado sem banco, e as contas que fecham
   (acima) testadas com o cenário do painel (`src/worker/test/painel-apoio.ts`).
7. **Site** (-web): o cartão da Visão geral (acima). O download por `fetch` (mesma origem, com o cookie) → `Blob` →
   link temporário com `download` = o nome do `Content-Disposition` (sem ele, `rifa-videira-kids-<tipo>.csv`) e
   `URL.revokeObjectURL` depois; o `lib/api.ts` ganha uma função para arquivo com o mesmo tratamento de erro e de
   401 do `requisitarJson`. Erros no formato único: 404 "A campanha ainda não foi configurada"; 401 leva à sessão,
   como hoje. Um download por vez (o botão fica desabilitado enquanto baixa). Tipos e nome do arquivo vêm de
   `src/shared/contracts/relatorio` (sem zod), nunca do index; o caminho da rota é uma cópia conferida pelo teste de
   contrato da pasta, como nas outras telas (docs/frontend.md). Conferir no navegador de verdade (`npm run dev`,
   também no celular) que o arquivo baixa com o nome certo e abre no Excel e no Google Planilhas com acentos,
   colunas e números certos. Docs: a Visão geral em `docs/frontend.md`.

**Suposições** (decisões do contrato, simples e reversíveis):

1. CSV `;` com BOM, vírgula decimal e datas `AAAA-MM-DD` (acima); nada de XLSX.
2. Sem `data`: sempre o retrato de agora; um relatório "do fim de um dia passado" fica para quando pedirem (`data`
   opcional, como no painel, é compatível).
3. A posição é a do ranking da divisão na campanha inteira até hoje, pelo critério configurado; não a da semana.
4. "Pedidos desconsiderados" conta os de todos os status da campanha ativa, sem separar por motivo.
5. Colunas além das pedidas: "Pedidos aprovados" em todos os tipos e, nos totais, as vendas sem célula e as fora das
   datas da campanha (as mesmas do painel), para as contas fecharem com a Rifei e entre os arquivos.
6. Períodos e dias só até hoje (o de hoje, parcial); os futuros não aparecem zerados.
7. O mapa por DDD entra (`ddd`): reaproveita a consulta do mapa (D17), ~11 mil linhas por download.
8. Os totais vêm numa linha só, com as colunas como os outros tipos (não numa lista "Item; Valor").
9. O apóstrofo da proteção pode aparecer na célula de um nome que começa com `+`, `-`, `=` ou `@` (ex.: "+Vida").

**Perguntas ao PO** (com a opção que o contrato assumiu, reversível):

1. O CSV abre com dois cliques no Excel em português e pelo menu Importar no Google Planilhas. Serve, ou precisa de
   um arquivo do Excel (.xlsx), que pede uma biblioteca nova? (Assumido: CSV.)
2. A "Posição na divisão" vale a campanha inteira, pelo critério configurado. Querem também a posição da semana?
   (Assumido: só a da campanha.)
3. Os pedidos desconsiderados aparecem só como um número. Querem separados por motivo (teste, fraude, estorno,
   outro)? (Assumido: só o total.)
4. Na planilha por rede, incluir o nome do responsável (pastor)? (Assumido: não, só o que foi pedido.)

## D24. Link de vendas e QR code de cada célula (RIFA-046; contrato, 2026-11-12)

O PO perguntou: "Nos Pix que a galera for vendendo, como vamos saber de qual célula veio? Dá para gerar um link ou QR
code para cada célula?" Hoje a venda só conta para uma célula se for feita na Rifei pelo **link de afiliado** do líder:
o Pix é pago dentro do checkout da Rifei, que já sabe o afiliado, o pedido chega pelo webhook com o `affiliate_id`, e
a coordenação liga o afiliado à célula na Adesão (D7 da integração). **Pix mandado direto para uma chave, fora da
Rifei, nunca entra no sistema.** Então o "link da célula" é o link de afiliado do líder, e o QR code é dele. Contrato
em `src/shared/contracts/link-vendas.ts` (sem zod: o modelo, a montagem, a conferência do endereço e o nome do arquivo
do QR) e `api.ts` (schemas e o catálogo `ROTAS_LINK_VENDAS`); testes em `link-vendas.test.ts`.

- **O problema**: o formato do link de afiliado da Rifei NÃO está documentado (integracao-rifei.md 12.3, pergunta 2 da
  12.7). Duas saídas, pesadas assim:

  | | (a) modelo único, só do admin | (b) colar o link de cada afiliado |
  |---|---|---|
  | Formato desconhecido | serve se o link levar o `affiliate_id` num lugar fixo; senão, não serve | serve com qualquer formato |
  | Coerência com a atribuição | **por construção**: o link leva o `affiliate_id` que o webhook liga à célula | depende de quem cola: o link de um afiliado colado no outro desvia as vendas sem o sistema perceber |
  | Segurança (D20: link para fora) | um campo, só admin, endereço fixo, um lugar para auditar | um campo por afiliado; a coordenação (ou o líder, uma escrita nova da hierarquia, que hoje só lê) poderia pôr o link de outra campanha da Rifei |
  | Esforço do PO | um campo, uma vez, depois de confirmar com a Rifei | um link por afiliado (36 ou mais), na reunião dos líderes ou depois |
  | Célula com mais de um código | cada código ganha o link dele, sozinho | cada um precisa ser colado; o que faltar fica invisível para o líder |

  **Escolha: (a)**, vazio até o PO confirmar o formato. É reversível: as respostas trazem `url` por afiliado nas duas
  opções. Se a Rifei confirmar que o link de afiliado NÃO leva o `affiliate_id` (ex.: um código aleatório por
  afiliado), a troca para (b) é uma coluna `link_vendas` em `afiliados`, colada pela coordenação na Adesão, com a
  mesma conferência de endereço (`eLinkDeVendas` e, no link colado, as regras do modelo sem os marcadores: nada de
  `//`, `\`, `www.` ou invisível depois do endereço, que o `eLinkDeVendas` sozinho não pega): as rotas e as telas
  continuam iguais, muda só a origem do `url`.
- **O modelo**: um texto com os marcadores `{slug}` (o `slug_rifei` da campanha ativa, com `encodeURIComponent`) e
  `{afiliado}` (o `affiliate_id`, obrigatório), até 300 caracteres. Ex. (o formato real ainda é desconhecido):
  `https://rifei.com.br/{slug}?afiliado={afiliado}`. Regras executáveis (`problemasDoModeloLinkVendas`, as mensagens
  em português que a tela mostra enquanto o admin digita e que o 400 traz):
  - começa EXATAMENTE por `https://rifei.com.br/` (`HOSTS_LINK_VENDAS`; sem `www.`, subdomínio, porta, usuário ou
    maiúsculas): o endereço fica fixo e os marcadores só entram depois da barra, então nenhum valor muda o site de
    destino. `rifei.com.br.golpe.example`, `rifei.com.br@golpe.example` e `http://` são recusados (testado);
  - depois do endereço, nenhum outro (`OUTRO_ENDERECO_NO_LINK`: `//`, `\` ou `www.`, como o adendo da RIFA-042 nas
    mensagens; revisão): `https://rifei.com.br//golpe.example`, `https://rifei.com.br/\golpe.example` (o navegador lê
    `\` como `/`) e `?volta=https://golpe.example` continuam na Rifei, mas só serviriam para um redirecionamento de lá;
  - sem espaço, tabulação, quebra de linha, caractere de controle ou invisível (espaço de largura zero, marcas de
    direção: vêm junto quando se copia um link); só `{slug}` e `{afiliado}`; nenhuma chave solta;
  - preenchido com valores de exemplo, forma um link válido (`eLinkDeVendas`).
- **A montagem** (`montarLinkDeVendas(modelo, { slug, affiliateId })`): preenche numa passada só (um slug com
  "{afiliado}" não é trocado de novo), devolve a forma canônica (`URL.href`) e confere de novo com `eLinkDeVendas`
  (`https:`, endereço de `HOSTS_LINK_VENDAS`, sem usuário, senha nem porta, canônico, até 2.048 caracteres). Null sem
  modelo, com modelo com problema (gravado à mão), slug vazio, "." ou ".." (o URL apagaria o segmento) ou
  `affiliate_id` que não é inteiro positivo; também com um slug que o `encodeURIComponent` recusa (surrogate solto,
  revisão). Null nunca vira erro: a resposta sai com `configurado: false` ou sem o
  link daquele afiliado. Os schemas das respostas também recusam qualquer `url` fora de `eLinkDeVendas`: nenhum outro
  endereço chega aos líderes, aos compradores ou ao QR code.
- **Onde fica e quem muda**: coluna `campanhas.link_vendas_modelo` (migração `0010_link_vendas.sql`, abaixo), numa
  **rota própria só de admin**, `PUT /api/admin/links-vendas/modelo { modelo }` (null ou vazio apaga), e não num grupo
  do `PUT /api/admin/campanha` como as regras da D20. Por quê:
  - o modelo decide para onde vai o dinheiro de todo comprador: a regra "só admin" fica na própria rota (`papeis:
    ["admin"]`), conferida pelo `protecao.test.ts` (403 da coordenação), e não na conferência "diferente do gravado"
    do PUT da campanha (RIFA-042), que precisaria de mais um grupo em `gruposDoAdminAlterados` e `semGruposDoAdmin`;
  - a campanha é lida pelo painel, pelas rotas abertas, pelo bumbo e pela `/minha` (`montarCampanha`): o modelo não
    serve a nenhuma delas, e o `campanhaSchema` e as fixtures não mudam (a `main` continua verde sem tocar no Worker
    nem nas telas). O UPSERT do PUT da campanha nomeia as colunas, então não apaga o modelo (conferido em
    `db/campanha.ts`; a -db trava com teste).
  - Trilha: `campanha.salvar` (sem ação nova), alvo `campanha:<id>`, com o antes e o depois do modelo
    ("Modelo do link de vendas: (vazio) → https://rifei.com.br/{slug}?afiliado={afiliado}"); o mesmo modelo de novo
    não registra (RIFA-018). O modelo não tem dado pessoal nem segredo.
- **As rotas** (catálogo à parte `ROTAS_LINK_VENDAS`, como o `ROTAS_REGRAS_CAMPANHA`: o `protecao.test.ts` exige o 403
  da coordenação na rota só de admin, que uma rota não montada não dá, e confere que `ROTAS` tem só a visão em
  `/api/minha`; a -api põe o catálogo no teste no merge que monta as rotas). Sem campanha ativa, 404 nas três.
  - `GET /api/minha/links-vendas` (líder, discipulador e rede): `{ alvo, configurado, itens }`. O alvo vem só da sessão
    (a rota não aceita id) e o escopo é o da visão individual (D12): o líder, a célula dele (sempre uma); o
    discipulador, as células dele; a rede, as dos discipuladores dela (conferido pelo schema). Com o acesso do papel
    desligado (D20), 403 `acesso_desligado`, como todo `/api/minha/*`.
  - `GET /api/admin/links-vendas` (admin e coordenação): `{ modelo, configurado, itens }`, com TODAS as células
    (inclusive as sem afiliado, com `links` vazia), para a Adesão.
  - `PUT /api/admin/links-vendas/modelo` (só admin): grava e responde 200 com a lista do GET, já montada com o modelo
    novo.
  - Cada célula (`celulaLinksVendasSchema`): ids e nomes da célula, do líder, do discipulador e da rede, a divisão e
    `links: [{ affiliate_id, url }]`. Nunca telefone, e-mail, o `rotulo` do afiliado (nota interna) ou número de
    venda. Ordem das células: pelo caminho na hierarquia, como os acessos (rede, discipulador e célula, em ordem de
    português; empate, pelo id).
  - `configurado` = o modelo gravado serve (`modeloLinkVendasValido`). False (vazio, ou gravado com problema): nenhuma
    célula tem link, e a tela diz que a coordenação ainda não liberou o link.
- **Célula com mais de um código** (o líder tem duas contas, a célula tem dois líderes, um afiliado de teste ficou
  vinculado): todos os links vêm, um por afiliado vinculado, do vínculo mais recente para o mais antigo
  (`vinculado_em` decrescente; empate, `affiliate_id` decrescente). Todos contam para a célula. A tela destaca o
  primeiro ("Seu link de vendas", com o QR) e lista os outros ("Também contam para a sua célula"). Afiliado de teste
  se remove na Adesão (D20, RIFA-031) ou se desvincula.
- **Discipulador e rede veem os links das células deles** (proposta; pergunta ao PO): só ver, copiar, mandar e o QR.
  O link não é número nem dinheiro (D12), é feito para ser divulgado, e o discipulador costuma ajudar o líder a
  vender; dos pares e de fora da equipe, nada. O líder vê só o dele.
- **Coordenação: na Adesão** (não na Hierarquia): é onde o afiliado se liga à célula, e uma célula sem afiliado é ao
  mesmo tempo "quem falta" e "sem link". Lá ficam o modelo (o admin edita; a coordenação vê, com "Só o admin muda o
  modelo"), o link e o QR de cada célula (Copiar, WhatsApp para o telefone do líder, que a Adesão já tem) e "Imprimir os
  QR codes" de todas as células com link.
- **O QR code**, gerado no navegador, sem rede e sem serviço de terceiros (o link não sai para ninguém além da Rifei):
  correção M (`NIVEL_CORRECAO_QR_LINK_VENDAS`), margem de 4 módulos (`MARGEM_QR_LINK_VENDAS_MODULOS`), sempre escuro
  sobre claro (muitos leitores não leem o QR invertido), também no tema escuro. Avaliação, com os pacotes baixados do
  npm em 12/11/2026 (tamanho: o arquivo do pacote minificado com o esbuild do projeto e comprimido com gzip):

  | | `qr` 0.7.2 | `uqr` 0.1.3 | `lean-qr` 2.7.4 | `qrcode` 1.5.4 | gerador próprio |
  |---|---|---|---|---|---|
  | Licença | MIT ou Apache-2.0 | MIT | MIT | MIT | nossa |
  | Dependências | nenhuma | nenhuma | nenhuma | 3 (pngjs, yargs, dijkstrajs) | nenhuma |
  | Tamanho (min + gzip) | ~6,9 KB (~6,6 KB só o `encodeQR` com a saída `raw`, medido na revisão; 5,4 KB pelo README) | ~4,5 KB | ~3,7 KB | maior, feito para Node | ~3 a 4 KB (estimado) |
  | Manutenção | ativa (5 versões em 2026: 0.5.4, 0.5.5, 0.6.0, 0.7.0 e 0.7.2, a última em 28/09/2026; um mantenedor, com proveniência SLSA no npm) | esparsa (0.1.2 em 2023; 0.1.3 em 04/2026) | ativa (2.7.4 em 07/09/2026), um mantenedor | 1.5.4 de 08/2024 | nossa |
  | Uso (downloads na semana) | ~520 mil | ~10 milhões | ~220 mil | ~40 milhões | |
  | Decodificador para os testes | **sim, no mesmo pacote** (`qr/decode.js`) | não | não | não | precisaria de outro |

  **Recomendação: `qr` 0.7.2, com versão fixa** (é 0.x). Zero dependência, licença permissiva, ativo, e o decodificador
  do mesmo pacote deixa o teste provar que o QR desenhado pela tela abre exatamente o link (gerar → rasterizar →
  decodificar), sem dependência a mais. Custo: ~6 a 7 KB comprimidos num pedaço carregado só quando o QR aparece
  (`lazy`), nunca no pacote inicial (hoje ~108 KB comprimidos; o pedaço da visão individual, ~6 KB); nenhum na API. Usar a saída `raw` (a matriz) e desenhar o `<svg>` com elementos do
  React (nada de `dangerouslySetInnerHTML` nem da saída `svg` em texto). Alternativa, se o SM preferir o menor: `uqr`
  (porte do gerador de referência do Nayuki), com o decodificador do `qr` só nos testes. **Gerador próprio** (versões 1
  a 10, modo byte, correção M): ~350 a 450 linhas (Reed-Solomon, tabelas das 10 versões, padrões, máscaras e a
  penalidade, informação de formato e de versão), um lote de agente mais a revisão, e o risco de um erro sutil que
  só aparece em alguns celulares; ainda pediria um decodificador nos testes e um teto de 213 bytes no link (a versão
  10-M). Só se o SM recusar a dependência.
- **Segurança**: o endereço é fixo no modelo e conferido de novo na montagem e na saída da API (acima); só o admin
  muda o modelo (rota com `papeis: ["admin"]`, sessão, CSRF da mesma origem e trilha); a rota da hierarquia não aceita
  id; o link não tem segredo (leva o slug e o `affiliate_id`, que o comprador vê) e as respostas autenticadas saem com
  `no-store`. Na tela: o QR é desenhado com elementos do React (o `url` nunca vira HTML), a imagem para baixar sai de
  um `<canvas>` (`toBlob` → link temporário com `download`, como o relatório da D23) e nunca vira `<img src="blob:">`
  (a CSP só deixa `img-src 'self' data:`); a CSP não muda. O QR impresso leva o link em texto embaixo, para quem
  quiser conferir que é `rifei.com.br`. Risco que continua: um admin pode apontar o modelo para outra campanha da
  Rifei (o endereço fixo não impede); por isso só admin, com trilha, e a tela mostra a prévia do link para abrir e
  conferir antes de salvar.
- **Orçamento do D1 (D10)**: um `db.batch` por requisição com três leituras (a campanha ativa, as células do escopo
  com a hierarquia e os afiliados vinculados delas pelo índice `afiliados_por_celula`), sem pedidos: o líder lê
  poucas linhas; a lista da coordenação, ~1 + 3 por célula + 1 por afiliado (~150 com 36 células). Sem cache: mudar o
  modelo ou vincular um afiliado vale na hora. A tela pede uma vez ao abrir, sem atualizar a cada 60 s.

### OBRIGATÓRIO NA IMPLEMENTAÇÃO

1. **Migração `0010_link_vendas.sql`** (-db): `ALTER TABLE campanhas ADD COLUMN link_vendas_modelo TEXT CHECK
   (link_vendas_modelo IS NULL OR length(link_vendas_modelo) BETWEEN 1 AND 300)`. **Só o tamanho**, como as mensagens
   da 0008: o endereço e os marcadores ficam no contrato, que muda sem migração (o SQLite não troca o CHECK de uma
   coluna sem recriar `campanhas`, que tem chaves estrangeiras de pedidos, períodos e recuperações). O número 0010 fica
   reservado; se outra migração entrar antes, o SM renumera. Teste em `src/worker/test/migrations.test.ts`: a 0010
   sobre dados das anteriores (a coluna nasce NULL) e o CHECK. Plano em modelo-de-dados.md, seção 11.
2. **Leitura** (-db/-api, `db/links-vendas.ts`): um `db.batch` com (a) `SELECT id, slug_rifei, link_vendas_modelo FROM
   campanhas WHERE ativa = 1`; (b) as células do escopo com a célula, o `lider_nome`, o discipulador, a rede e a
   divisão (todas; `c.id = ?` no líder; `c.discipulador_id = ?` no discipulador; `d.rede_id = ?` na rede), nunca
   `lider_telefone` nem `lider_email`; (c) `SELECT affiliate_id, celula_id, vinculado_em FROM afiliados WHERE <as células do escopo> ORDER BY
   celula_id`, sempre pelo índice `afiliados_por_celula` e nunca o `rotulo`: `celula_id = ?1` no líder; `celula_id IN
   (SELECT id FROM celulas WHERE discipulador_id = ?1)` no discipulador; `celula_id IN (SELECT c.id FROM celulas AS c
   JOIN discipuladores AS d ON d.id = c.discipulador_id WHERE d.rede_id = ?1)` na rede; e `celula_id IS NOT NULL` na
   coordenação (o `ORDER BY celula_id` faz o planejador descer pelo índice só pelos vinculados, `celula_id>?`, em vez
   de `SCAN afiliados`). A ordem dos links dentro da célula (`vinculado_em` decrescente; empate, `affiliate_id`
   decrescente) fica na montagem, no Worker (`doVinculoMaisRecente`, sort estável): o `ORDER BY celula_id,
   vinculado_em DESC, affiliate_id DESC` no SQL dá a mesma ordem, mas põe uma B-tree temporária que lê o dobro das
   linhas dos afiliados (84 em vez de 42 na coordenação; conferido na revisão). A montagem num módulo puro
   (`lib/links-vendas.ts`, testado sem banco), com `montarLinkDeVendas` (nunca juntar texto à mão) e a ordem das
   células de `lib/ordem-hierarquia.ts` (extraída de `db/acessos-hierarquia.ts` sem mudar o comportamento;
   `Intl.Collator("pt-BR")`, rede → discipulador → célula, empate pelo id); afiliado cujo
   link sai null fica de fora. Travar as idas ao D1 e as linhas lidas (`meta.rows_read`) no líder, no discipulador, na
   rede e na coordenação, e o plano dos afiliados com `EXPLAIN QUERY PLAN` (`afiliados_por_celula`). Sem cache.
3. **Rotas** (-api): `GET /api/minha/links-vendas` no sub-app de `routes/minha.ts` (já exige os papéis e marca
   `no-store`), com o alvo só da sessão (um `?celula_id=` na URL é ignorado); `GET /api/admin/links-vendas` e `PUT
   /api/admin/links-vendas/modelo` sob `/api/admin` (depois do login, passo 4 do `index.ts`), num sub-app novo ou em
   `routes/afiliados-adesao.ts`. O "só admin" do PUT fica no handler (ou num `use` do caminho EXATO), antes de ler o
   corpo: a coordenação leva 403, nunca 400; nunca num `use` de `/api/admin/links-vendas/*` que pegue o GET. Toda
   resposta passa pelo schema do catálogo antes de sair (estrito: um campo a mais vira 500, como a visão).
4. **PUT** (-api): 400 `json_invalido` (não é JSON, ou sem `Content-Type` JSON, como os outros PUT) ou
   `requisicao_invalida` (com os problemas do modelo nos `detalhes`); 404 sem campanha ativa. Um `db.batch`: o
   registro na trilha ANTES e com a mesma condição do UPDATE (`WHERE ativa = 1 AND link_vendas_modelo IS NOT ?`, que
   compara também o NULL), o `UPDATE campanhas SET link_vendas_modelo = ?, atualizado_em = <agora> WHERE ...` e a
   leitura da lista. Nada mudou: 200 sem trilha.
5. **Testes da -api**: o PUT da campanha (coordenação e admin) não apaga o modelo, e trocar o `slug_rifei` muda os
   links com `{slug}` na hora; a coordenação leva 403 no PUT do modelo e nada muda; o líder vê só a célula dele e o
   discipulador e a rede só as da equipe (também com id na consulta); `configurado: false` sem modelo e com um modelo
   gravado à mão fora das regras (sem 500); a célula com dois afiliados traz os dois, na ordem; nenhuma resposta
   contém o telefone, o e-mail ou o rótulo (varredura, com eles preenchidos no banco).
6. **Proteção** (`src/worker/protecao.test.ts`, no merge que monta as rotas): `ROTAS_LINK_VENDAS.linksVendas` e
   `.salvarModeloLinkVendas` em `ROTAS_DA_COORDENACAO` (401 sem cookie; 403 da coordenação só no PUT; 403 da
   hierarquia; 403 no PUT de outra origem), com as contagens do primeiro teste; `meusLinksVendas` na seção g) (401 sem
   sessão; 403 da coordenação; 200 nos três papéis, pelo schema; 403 `acesso_desligado` no discipulador e na rede com
   a chave desligada).
7. **Dependência** (-web, depois do ok do SM): `qr` com versão fixa (`"qr": "0.7.2"`), no `package.json` e no
   `package-lock.json`; só em pedaços `lazy` (o QR da `/minha` e o da Adesão); conferir no `npm run build` que não
   entrou no pacote inicial. `encodeQR(url, "raw", { ecc: "medium", border: MARGEM_QR_LINK_VENDAS_MODULOS })`: a
   matriz já sai com a margem branca de 4 módulos, e a tela pinta só os módulos escuros sobre o fundo branco. **Nunca
   `border: 0`**: o `qr` 0.7.2 lança `RangeError: invalid border=0` (a norma exige a margem; conferido na revisão).
8. **Componente do QR** (-web, ex.: `src/web/components/qr/`, fora de `components/ui`): `<svg>` com `viewBox`, um
   `<path>` dos módulos, `shape-rendering="crispEdges"`, preto sobre branco fixos (exceção documentada aos tokens do
   tema), `role="img"` e `aria-label` com o nome da célula; nada de `dangerouslySetInnerHTML`. "Baixar imagem": PNG de
   um `<canvas>` (10 px por módulo, fundo branco), nome `nomeDoArquivoQrLinkVendas(celula_nome)`, `URL.revokeObjectURL`
   depois. "Imprimir": `window.print()` com `@media print` que mostra só o QR, o nome da célula e o link em texto
   (QR com 4 cm ou mais). "Copiar link" (sem a área de transferência, seleciona o campo) e "Compartilhar no WhatsApp"
   (`https://wa.me/?text=` com `encodeURIComponent`; na Adesão, `wa.me/<telefone do líder>`).
9. **Teste do QR** (-web): gerar → rasterizar a matriz em pixels (função pura) → `decodeQR` de `qr/decode.js` devolve
   EXATAMENTE o `url`, com um link curto (~45 caracteres), um médio (~150) e um longo (~600) (na revisão, com o
   `qr` 0.7.2, `border: 4` e 4 px por módulo: 47, 150 e 607 caracteres, versões 4, 8 e 19, os três exatos). E no aparelho de
   verdade: a câmera de um Android e de um iPhone lê o QR na tela da `/minha` (360 px), no PNG baixado e numa folha
   impressa, e abre o link certo (anotar no relatório).
10. **`/minha`** (-web): o cartão "Seu link de vendas" (líder) e "Links de vendas das suas células" (discipulador e
    rede, com "Ver QR" num diálogo), pedidos uma vez ao abrir (sem a atualização de 60 s). Estados: carregando; erro com
    "Tentar de novo"; `configurado: false` ("A coordenação ainda não liberou o link de vendas. Enquanto isso, use o
    link da sua Área de afiliados na Rifei."); célula sem afiliado ("Sua célula ainda não tem cadastro de afiliado
    ligado: fale com a coordenação."); um link ou mais (o primeiro em destaque); 403 `acesso_desligado` e 404 como a
    visão. 360 px sem rolagem lateral (o link quebra a linha). O `guarda-minha.test.ts` passa a aceitar
    `src/shared/contracts/link-vendas` (sem zod) e continua sem dinheiro. **Adendo (RIFA-036, ensaio geral 2):** o do
    líder é pedido de novo, sem voltar ao "carregando", quando o `afiliados_vinculados` da visão muda numa atualização
    de 60 s (a coordenação vinculou na reunião): sem isso, o aviso amarelo sumia e o cartão continuava dizendo que a
    célula não tinha afiliado até o líder recarregar. Sem mudança, nenhum pedido a mais (o orçamento continua o mesmo).
11. **Adesão** (-web): a seção "Links de vendas" (acima): o campo do modelo só para o admin, com os problemas ao vivo
    (`problemasDoModeloLinkVendas`), a prévia do link de um afiliado de exemplo para abrir e conferir, e "Salvar"
    (PUT); para a coordenação, só leitura. Caminhos e constantes copiados conferidos pelo teste de contrato da pasta,
    como nas outras telas. Docs: `docs/frontend.md`.
12. **Docs** (-docs): `docs/lancamento.md` (depois de confirmar o formato com a Rifei: o admin preenche o modelo e faz
    a compra de teste pelo QR de uma célula, conferindo que a venda cai nela; na reunião dos líderes, mostrar o link e
    o QR na `/minha`), `docs/guia-lideres.md` e `.html` ("Seu link de vendas") e, com a resposta da Rifei, a seção 12.3
    de integracao-rifei.md.

**Suposições** (decisões do contrato, simples e reversíveis):

1. Opção (a): o modelo com `{slug}` e `{afiliado}` (= o `affiliate_id` do webhook), vazio até o PO confirmar o formato.
2. Só `https://rifei.com.br/` (sem `www.` e sem subdomínio); outro endereço confirmado entra em `HOSTS_LINK_VENDAS`.
3. O modelo numa rota própria só de admin, guardado em `campanhas.link_vendas_modelo`; trilha `campanha.salvar`.
4. Célula com mais de um código: todos os links, o vínculo mais recente primeiro.
5. Discipulador e rede veem os links e os QR das células deles; o líder, só o dele.
6. Na coordenação, a Adesão (não a Hierarquia), com "Imprimir os QR codes".
7. QR com a dependência `qr` 0.7.2 (**precisa do ok do SM**); correção M, margem de 4 módulos, preto no branco.
8. Texto do "Compartilhar no WhatsApp" fixo no site (ex.: "Compre seus bilhetes da rifa do Videira Kids pelo link da
   Célula Ágape: <link>"), não editável como as mensagens da D20.

**Perguntas ao PO** (com a opção que o contrato assumiu, reversível):

1. Qual é o formato do link de afiliado da Rifei, e ele leva o número do afiliado (o mesmo que chega no webhook)?
   Confere-se na compra de teste ([lancamento.md, 4.1](lancamento.md#41-os-passos), passos 1 a 3): o PO decidiu não
   perguntar ao suporte da Rifei (15/11/2026). (Assumido: o modelo fica
   vazio, e o líder vê "ainda não liberado", até a resposta.)
2. O discipulador e o responsável pela rede podem ver os links e os QR das células deles? (Assumido: sim, só ver,
   copiar e mandar.)
3. Quando uma célula tem mais de um cadastro de afiliado, mostramos todos, com o mais recente em destaque? (Assumido:
   sim.)
4. Qual texto vai na mensagem do WhatsApp quando o líder compartilha o link? (Assumido: o da suposição 8.)
5. Venda por fora (dinheiro ou Pix direto para o líder) não entra no sistema. Orientamos o líder a fazer a compra na
   Rifei pelo próprio link, em nome do comprador, para contar para a célula? (Assumido: o guia dos líderes diz só
   que conta o que passa pela Rifei pelo link dele.)

## D25. Acabamento visual: ícones, estados, comemoração e telão (RIFA-048 a 051, 2026-11-13)

O PO pediu o site "mais bonito, moderno e agradável, com efeitos suaves". A D15 continua valendo (paleta do logo,
amarelo do Kids só na comemoração, logo sem redesenho, movimento só com `no-preference`, WAAPI só por
`lib/movimento.ts`, sem View Transitions, telão só se mexe com dado novo). Esta decisão amplia o que a D15 permite,
sem dependência nova. Decidido pelo SM em 13/11; o PO pode vetar ao ver a demonstração.

- **Ícones SVG próprios** (`components/ui/Icone.tsx`): traço em `currentColor`, `aria-hidden`, dados em `icones.ts`;
  nada de biblioteca nem de fonte de ícones; nada de logo de terceiros (o WhatsApp é um balão genérico). Os caracteres
  ✓ ! – viram ícones.
- **Esqueleto** em toda tela que carrega dados de que a pessoa depende (`/minha`, Visão geral, telão), no tamanho do
  que vem: menos espera percebida e CLS ≤ 0,005.
- **Falha de conexão não é erro vermelho**: estado neutro "Sem conexão agora" com "Tentar de novo"; o vermelho fica
  para falha de verdade. As mensagens do cliente da API deixam de falar "API".
- **Comemoração da meta batida** (`useComemoracao`): além do pulso, 10 a 14 partículas no amarelo do Kids e nas cores
  da marca, cada uma com até 450 ms, só `transform` e `opacity`, uma vez: no telão e no ranking, só quando uma célula
  passa a bater a meta numa atualização (abrir a página não solta confete); na `/minha`, uma vez por dia. Com
  `reduce`, nada.
- **Barra de progresso acima da meta** continua no degradê da marca, com o selo amarelo de troféu no fim e um brilho
  único ao terminar de encher (antes: verde liso). O % aparece uma vez onde o número grande já está na tela.
- **Telão escala pela quantidade de itens**: com o limite público de 3, a disputa ocupa pelo menos 60% da altura
  (antes, 38%); o 1º lugar é maior; quem subiu ganha "↑ subiu" até a próxima atualização com mudança (sem
  temporizador).
- **Cabeçalho das telas abertas na faixa do degradê forte**, com o logo no selo claro (como no telão); o Kids continua
  no rodapé.
- **Alvo de toque**: o botão pequeno tem 44 px em tela de toque (`pointer: coarse`) e 36 px no mouse.
- **Peso**: JS inicial ≤ 162 KiB (165 KiB desde a RIFA-053: veja o adendo abaixo) e CSS inicial ≤ 16,5 KiB em gzip
  (eram 158,4 e 13,0 em 13/11), sem dependência nova; medido pela ferramenta de capturas.
- **Fonte de títulos**: Outfit 800, subconjunto latino, um arquivo woff2 de 13,7 KiB (`@fontsource/outfit` 5.2.6,
  conferido pelo hash; licença OFL-1.1 ao lado), `font-display: swap`, preload e reserva com `size-adjust`; só em
  títulos e números de destaque; o texto corrido continua na fonte do sistema. O arquivo fica em
  `src/web/tema/fontes/` (e não em `public/fontes/`, como no plano): o `@font-face` usa `url()` relativa e o preload
  do `index.html` aponta para o arquivo-fonte, e o Vite troca os dois pelo mesmo arquivo com hash e com qualquer
  `base` (a demonstração é servida com `--base ./` sob um subcaminho, onde um caminho absoluto `/fontes/...` quebraria;
  o hash também dá o cache longo).
- **Fora**: `backdrop-filter`, animação infinita nova, carrossel no telão, texto em degradê, tema escuro no site, emoji
  como ícone, biblioteca de ícones, animação ou fonte.

**Adendo (RIFA-053, fechamento da Sprint 9): o que mudou em relação ao plano.**

- **Teto do JS inicial: 165 KiB** (o plano dizia 162). A main com P1, P2, P3a e P3b mediu 162,6 KiB em gzip: a fonte,
  os ícones, a comemoração, os esqueletos e as falhas neutras couberam, mas sem folga para o acabamento. Com a RIFA-053,
  163,1 KiB; o CSS inicial continua até 16,5 KiB (15,3 KiB) e nenhuma dependência nova.
- **O corte das partículas fica na lista**, e não no item, como o plano previa: o item do telão e do ranking é o que o
  FLIP move, e com `overflow: clip` nele o Chrome contava cada troca de lugar como layout shift (0,02 por troca). O
  corte vai num ancestral que não se mexe (a lista; na `/minha`, que não tem FLIP, o cartão). E as partículas saem
  junto com o pulso, quando o % termina de contar (RIFA-053): antes, chegavam ~450 ms antes do 100% e da pílula
  amarela.
- **A reserva do topo da `/minha` é só no CSS**: a linha do papel na marca tem `min-height` e a barra, a altura do alvo
  de toque; nunca um texto falso (um espaço) na marca, que o leitor de tela acharia. O CLS da `/minha` foi de 0,018 a 0.
- **O "Remover" fica na linha do código do afiliado** (Adesão): o plano previa as três ações numa grade de 3 colunas
  iguais, que não cabe no cartão ("Desvincular" pede ~106 px e cada coluna teria ~83 px a 390 e a 1366 px). O código e
  o "Remover", no perigo discreto, numa linha; "Trocar" e "Desvincular" embaixo, em duas colunas.
- **Os filtros de Pedidos recolhidos no celular** são um `<details>` controlado (`useFiltrosRecolhidos`): fechado ao
  abrir abaixo de 48rem, sempre aberto no computador e sem `matchMedia`, e acompanha a largura (girar o aparelho abre
  ou fecha). O `<summary>` conta os filtros escolhidos e, desde a RIFA-053, tem a cara de botão e o chevron `abrir`.

## D26. Conferência do extrato do banco para o Pix manual (RIFA-059, 2026-11-16)

Decisões do PO (16/11): sem a Efí, o Pix manual da Rifei é o caminho principal (lancamento.md, 1.6). O comprador reserva
na Rifei e paga pelo QR ou pelo copia e cola na chave da campanha; alguém confere o extrato e marca o pedido como pago no
painel da Rifei; a Rifei manda o "Pedido pago" no webhook e a venda conta. Banco: Bradesco, conta de pessoa jurídica no
Net Empresa, com um acesso só de consulta. O Open Finance é pago e está fora: o extrato é baixado à mão. O objetivo é
automatizar o cruzamento do extrato com os pedidos; a marcação na Rifei continua manual. Decisão do SM: nada de robô que
entra no banco sozinho (o Net Empresa pede a chave de segurança do app a cada login).

- **O extrato é lido só no navegador.** Seção "Extrato do banco (Pix manual)" da Conferência
  (`src/web/pages/conferencia/extrato/`, num pacote `lazy` à parte, como a conferência pelo CSV), para admin e
  coordenação. O arquivo (ou o texto colado) nunca vai para o servidor e nada é gravado: nem banco, nem localStorage, nem
  log. A tela só LÊ o que já existe: o fuso da campanha (`GET /api/admin/campanha`) e a lista de pedidos
  (`GET /api/admin/pedidos?limite=200`, de todos os status, página a página pelo cursor, do registrado mais novo para o
  mais antigo, até passar do primeiro crédito do extrato menos a maior janela, 72 h; teto de 60 páginas, 12 mil pedidos,
  com aviso). A lista já traz tudo o que o cruzamento usa (número, status, quantidade, valor, célula, `criado_em`,
  `aprovado_em` e a desconsideração): nenhuma rota nova, nenhuma migração, nenhuma mudança no contrato. Nada do sistema
  muda pela seção.
- **Formatos** (o formato do Bradesco não está documentado em fonte pública: o leitor é tolerante):
  - OFX 1.x (SGML, tags de valor sem fechamento, `CHARSET:1252`) e 2.x (XML), lidos por texto (sem parser de XML). De
    cada `<STMTTRN>`: `TRNAMT` (ponto ou vírgula; o sinal decide, não o `TRNTYPE`), `DTPOSTED` (ou `DTUSER`), `MEMO` e
    `NAME` (a descrição) e `FITID` (onde o número do pedido pode aparecer; `CHECKNUM` e `REFNUM` são o documento do
    banco e ficam de fora, para não bater por acaso com um número de pedido). Datas
    `YYYYMMDD[HHMM[SS]][.XXX][offset:TZ]`: com o deslocamento, o instante exato; sem ele, a hora local do fuso da
    campanha (a especificação manda ler como GMT, mas os bancos brasileiros gravam a hora local; GMT trocaria o dia dos
    lançamentos da noite); só o dia ou meia-noite em ponto: só o dia escrito; a mesma hora em todos os lançamentos (o
    banco completou com 12:00, por exemplo): só o dia.
  - Texto colado de qualquer banco (a tabela da tela do banco ou do PDF), linha a linha: data (`16/11/2026`, `16/11/26`,
    `16/11`, `16 nov 2026`, "Hoje"...; a linha só com a data vale para as de baixo), hora se houver, o primeiro valor no
    formato brasileiro (`1.234,56`, `R$`, `+`, `-`, `−`, `C`, `D`), a descrição e as linhas sem valor logo abaixo (o
    "REM: <nome>" do Bradesco). Numa tabela com tabulações e cabeçalho, valem as colunas Crédito, Débito ou Valor. Sem
    sinal, é crédito, a não ser que a descrição diga saída ("ENVIADO", "DES:", "DEBITO", "TARIFA", "PAGTO"...).
  - CSV, se o banco gerar: o mesmo leitor da conferência (`src/shared/csv.ts`), o cabeçalho achado depois das linhas de
    título e um mapeamento simples (data, hora, descrição, valor ou crédito, débito, documento), que a pessoa troca na
    tela (o resultado muda na hora).
  - Só entram os créditos que parecem Pix: a descrição com "PIX" ou "TRANSF" (configurável na tela; vazio, todos os
    créditos). A tela diz quantos ficaram de fora e por quê (débitos, créditos sem as palavras, linhas de saldo,
    linhas sem data ou valor).
- **O nome de quem pagou: exceção à D19.** A D19 nunca lê as colunas de dado pessoal do CSV da Rifei. Aqui a descrição do
  lançamento, que pode trazer o nome de quem pagou ("REM: <nome>"), é lida e mostrada, porque sem o número do pedido no
  extrato é o único jeito de a pessoa desempatar um Pix ambíguo olhando a Rifei. Ela fica só na memória da página (o
  estado da tela), aparece só nas listas do resultado, some ao sair da tela e nunca entra numa chamada, no storage ou no
  log (`ExtratoDoBanco.test.tsx` varre os endereços, os corpos, o `localStorage`, o `sessionStorage` e o `console`;
  `conferencia-contrato.test.ts` barra storage e `console` no código da pasta).
- **Os graus.** "Certo": a descrição, o FITID ou a coluna de identificador do CSV trazem o número de um pedido (o
  artigo da Rifei "Como saber se um PIX manual foi pago": o identificador da transação Pix é o número do pedido; o
  número inteiro, ou um pedaço entre separadores, com pelo menos 4 caracteres, ou 8 se for só de algarismos: o
  documento do banco, a agência, a conta e a data aparecem em todo lançamento e bateriam por acaso com um número curto,
  e o Certo não confere o valor nem a hora; com o número da Rifei curto e só de algarismos, o Pix cai no Provável; com
  outro valor, continua Certo, com o aviso). "Provável": sem o número, só um pedido serve:
  o mesmo valor, reservado antes do Pix (`criado_em`; sem ele, `registrado_em`) e dentro da janela (padrão 24 h, de 1
  a 72 h na tela), com 5 min de folga para o relógio; o pedido já pago só serve se foi pago
  depois do Pix (quem marca na Rifei marca depois de ver o Pix); o desconsiderado (D20) nunca serve. "Ambíguo": mais de
  um pedido serve (os candidatos com número, célula, hora da reserva, quantidade e situação; na tela, os 8 primeiros e
  quantos faltam, e os 100 primeiros Pix ambíguos, para um extrato grande não travar a página); se todos já estão pagos,
  não há o que marcar e o Pix vai para "Já contados" ("um destes"). "Pix sem pedido": nenhum pedido livre serve (com o
  motivo: nenhum com o valor no horário, o que servia ficou com outro Pix, o número é de um pedido que ficou com outro
  Pix ou de um desconsiderado). O pedido casado que já está pago é "já contado"; o pendente ou expirado vai para "Para
  marcar como pago na Rifei", com "Copiar os números dos pedidos" (um por linha).
- **O algoritmo** (`cruzamento.ts`, guloso e estável; um Pix nunca casa com dois pedidos e um pedido nunca casa com dois
  Pix):
  1. a ordem: os Pix do mais antigo ao mais novo (no empate, a ordem no extrato); os pedidos pela reserva (no empate,
     pelo número);
  2. os Certos primeiro: cada Pix, na ordem, fica com o pedido do número que traz; o número de um pedido que já ficou com
     um Pix anterior deixa o Pix sem pedido ("Pix em dobro?");
  3. depois, pelo valor, em voltas até nada mudar: cada Pix ainda sem par, do mais antigo ao mais novo, olha os pedidos
     livres que servem; se só um serve, fica com ele (Provável). Quando dois Pix disputam o mesmo e único pedido, o mais
     antigo fica com ele (o outro diz com quem ele ficou); e um Pix com dois candidatos vira Provável quando o outro
     candidato fica com um Pix que só tinha ele;
  4. o que sobra é Ambíguo (2 ou mais livres) ou sem pedido (nenhum).
  Dois Pix iguais com os mesmos dois pedidos iguais ficam os dois Ambíguos: o algoritmo não chuta o par (pergunta ao
  PO). O resultado não depende da ordem de entrada (`cruzamento.test.ts`).
- **Fora desta versão:** o PDF (pediria o pdf.js, dependência nova de centenas de KB; hoje, abrir o PDF, selecionar a
  tabela e colar o texto; **entrou na RIFA-068**, adendo abaixo), o Open Finance (pago), o robô no internet banking (a chave de segurança a cada login) e
  automatizar o painel da Rifei (sem API para marcar como pago; automatizar a tela de outro sistema é frágil e foge dos
  termos dela).
- **Peso:** o JS inicial sobe 0,1 KiB (o `lazy` e o `Suspense` na `ConferenciaPage`), nenhuma dependência nova; a seção
  vem num pacote à parte de ~13 KiB em gzip, mais o leitor de valores e datas, que agora é dividido com a conferência
  pelo CSV (~5 KiB).

### D26, adendo: o extrato em PDF (RIFA-068, 2026-11-17)

Pedido do PO (17/11): "o pastor sobe o PDF do extrato bancário e o sistema reconhece os bilhetes que foram pagos". O
banco continua o Bradesco Net Empresa (acesso só de consulta) e a marcação na Rifei continua à mão (sem API). A tarefa
só lê o PDF e cai no mesmo cruzamento.

- **Biblioteca: `pdfjs-dist` 6.5.438 (o pdf.js da Mozilla, Apache-2.0), versão fixa no `package.json`, build
  `legacy`.** É o leitor de PDF mantido e testado em escala (o do Firefox): lida com compressão, fontes, objetos em
  fluxo e PDF cifrado, o que um leitor caseiro não cobriria. O build `legacy` roda nos navegadores de alguns anos
  atrás (o build moderno usa `Map.prototype.getOrInsertComputed`, que nem o Node 22 nem os celulares mais velhos
  têm), por ~20 KB a mais em gzip. Alternativas descartadas: o `unpdf` (embrulha o mesmo pdf.js para servidor) e o
  `pdf-parse` (Node). A dependência opcional `@napi-rs/canvas` do pacote só serve ao Node (os testes); no site, nada.
- **Só sob demanda.** `extrato/pdf.ts` (o único que importa o `pdfjs-dist`) chega pelo `import("./pdf")` de
  `leitura.ts`, só quando a pessoa escolhe um PDF (pela extensão, pelo tipo ou pelo `%PDF-` no começo). O JS inicial
  não muda (`pdf-lazy.test.ts` segue os imports estáticos, como o `qr-lazy.test.ts`; o seguidor ficou em
  `src/web/test/pacotes.ts`, dividido pelos dois). Sem internet (ou com o pacote antigo fora do ar depois de uma
  publicação), o `import()` falha e a tela diz "Não foi possível abrir o leitor de PDF".
- **CSP de produção sem mudança** (`default-src 'self'`, sem eval e sem inline). O worker do pdf.js é um arquivo do
  próprio site: `import enderecoDoWorker from "pdfjs-dist/legacy/build/pdf.worker.min.mjs?url"` (o Vite copia o
  arquivo para `assets/` com o hash e devolve a URL) e `GlobalWorkerOptions.workerSrc = enderecoDoWorker`; o
  `new Worker(url, { type: "module" })` da mesma origem passa pelo `default-src 'self'` (sem `worker-src`, vale o
  `script-src`, que cai no `default-src`). A versão 6 não tem mais eval (a opção `isEvalSupported` saiu); o
  equivalente é `useWasm: false` (a CSP não tem `'wasm-unsafe-eval'`). Também `disableWorkerRendering: true` (sem o
  segundo worker, de desenho), `useSystemFonts` e `disableFontFace` (nenhuma fonte baixada nem criada) e nenhuma URL de
  fontes, cMaps ou WebAssembly: o pdf.js não busca nada pela rede. `verbosity: ERRORS` (nada de aviso no console).
  Conferido no Chromium com o build servido pelo `npm run preview` e a CSP do `public/_headers`: nenhuma violação, o
  console limpo e o worker criado de verdade (`assets/pdf.worker.min-<hash>.mjs`, `text/javascript`).
- **As linhas pela posição** (`extrato/pdf-linhas.ts`, puro): de cada página, o texto e a posição de cada pedaço
  (`getTextContent`); o y agrupa a linha (tolerância de 0,4 da altura da letra), o x ordena; pedaços colados viram a
  mesma palavra, um vão até a altura da letra vira espaço, um vão maior separa as colunas. Achado o cabeçalho da
  tabela (a mesma regra do texto colado: Data e Crédito e Débito, ou Valor; agora exportada de `texto-colado.ts`),
  cada linha vira as células dele, separadas por tabulação e com as vazias no lugar (a coluna pela maior sobreposição
  com o título dela; sem nenhuma, a mais próxima): é o que o navegador copia de uma tabela. Assim o débito sem sinal
  da coluna Débito é débito (uma "TRANSF CC PARA CC PJ" de saída não vira Pix) e o saldo nunca é lido como o valor.
  Sem cabeçalho, a linha é o texto com espaços. A página sem cabeçalho usa as colunas da anterior; um vão vertical
  maior que 2,5 alturas da letra (o rodapé) e a troca de página viram uma linha em branco (encerram o lançamento de
  cima). O texto vai para o **mesmo leitor do texto colado**; o resultado diz "Lido do arquivo PDF".
- **A data na coluna Data vale para as linhas de baixo** (mudança no leitor do texto colado, que vale também para a
  tabela colada): no extrato do Bradesco a data pode vir só na primeira linha do dia, que costuma ser o "SALDO
  ANTERIOR", sem crédito nem débito. Antes, essa linha era ignorada e os lançamentos de baixo ficavam sem data. A
  célula precisa ser só a data (um rodapé com "Emitido em 18/11/2026" na mesma coluna não muda o dia).
- **O formato do Bradesco** (fontes públicas: só cópias de extratos de terceiros e importadores de código aberto; o
  Bradesco não publica o modelo): a tabela "Data | Histórico (ou Lançamento) | Docto. (ou Dcto.) | Crédito (R$) |
  Débito (R$) | Saldo (R$)", o "SALDO ANTERIOR" no começo e o Pix em duas linhas: "TRANSFERENCIA PIX", o documento,
  o valor e o saldo; embaixo, "REM: <nome> <dd/mm>" (recebido) ou "DES: <nome> <dd/mm>" (enviado). Os testes usam
  PDFs sintéticos nesse formato, gerados em `extrato/teste-apoio-pdf.ts` (Helvetica, posições de relatório, duas
  páginas com o cabeçalho repetido, título e rodapé), com dados fictícios. NÃO DOCUMENTADO e a conferir no primeiro
  PDF de verdade (sem guardar o arquivo): se o débito vem com sinal, se a data vem em toda linha e se há uma linha de
  total (ela entraria como "crédito sem as palavras do Pix").
- **Falhas claras:** o PDF sem nenhum texto ("Este PDF é uma imagem": escaneado ou fotografado; o outro jeito é o OFX
  ou copiar a tabela da tela do banco), o PDF com senha de abrir ("Este PDF tem senha": a tela não pede a senha), o
  arquivo que não é PDF de verdade, o PDF com texto mas sem lançamentos, mais de 200 páginas e o leitor que não
  carregou. O limite de 5 MB do arquivo vale também para o PDF.
- **Privacidade (D26 inteira):** os bytes vão do arquivo escolhido direto para o worker do próprio site; nada sai do
  navegador, nada é gravado e o documento (com o worker) é destruído no fim da leitura. `ExtratoDoBanco.test.tsx`
  sobe o PDF na varredura de privacidade (chamadas, storage e console) e o `pdf.test.ts` lê os PDFs sintéticos pelo
  pdf.js de verdade (nos testes, o worker roda na mesma linha de execução, pelo `globalThis.pdfjsWorker`).
- **Fora:** o PDF escaneado (pediria OCR), a senha digitada na tela, texto em PDF girado e o extrato com a descrição
  numa linha e o valor na de baixo (um importador de terceiros descreve esse jeito no PDF do Bradesco: "PIX RECEBIDO"
  numa linha e "complemento, documento, valor, saldo" na seguinte); se o PDF de verdade vier assim, os Pix ficariam
  sem a palavra do Pix e cairiam em "créditos sem as palavras do Pix" (tarefa nova).
- **Peso:** o JS inicial não muda (534,78 KiB, 162,95 KiB em gzip, igual ao da `main`); a seção do extrato sobe
  ~0,6 KiB em gzip (13,2 KiB); o leitor de PDF vem num pacote à parte de 490 KiB (148 KiB em gzip) e o worker do
  pdf.js num arquivo de 1,3 MB (386 KiB em gzip), os dois baixados só quando a pessoa escolhe um PDF (e guardados pelo
  cache do navegador). O aviso de pedaço grande do Vite passou de 500 para 600 kB (`vite.config.ts`) por causa do
  pacote do pdf.js.

## D27. Ranking único: separar ou não o ranking por divisão (RIFA-061; contrato, 2026-11-17)

Decisão do PO (17/11): a igreja só tem o nome dos discipuladores e das células (38 células e 8 discipuladores, numa rede
só); não há divisão jovens/adultos, número de pessoas nem líder. "Por enquanto aplique o ranking igual para todos": a meta
igual para todas as células (a regra `fixa_por_celula`, que já existia: nada a fazer no código) e um ranking só. O PO quer
as decisões configuráveis: virou uma opção da Campanha.

- **A opção** (`ranking.por_divisao` no contrato, `dominio.ts`; `RANKING_POR_DIVISAO_PADRAO` em `regras.ts`): ligada (o
  padrão) = Jovens e Adultos disputam cada um o seu ranking, como até aqui; desligada = um ranking só, de todas as
  células, em todo lugar que separava por divisão. Coluna `campanhas.ranking_por_divisao` (migração 0012, `NOT NULL
  DEFAULT 1`, CHECK 0/1: toda campanha que já existia fica separando, como antes). É do grupo `ranking`, como o critério:
  admin e coordenação mudam (não é uma das regras só do admin da D20). No PUT, ausente mantém o gravado (no primeiro PUT,
  o padrão), como os grupos do admin: uma aba antiga do site, que não conhece a opção, não a religa. A trilha diz
  `ranking.por_divisao: ligado → desligado` (e, na criação, só quando nasce desligada).
- **O contrato das respostas** (o desenho mais simples e compatível): as respostas dos rankings (`GET /api/painel/ranking`,
  `GET /api/publico/ranking` e o `ranking` de `GET /api/minha/visao`) ganham a marca `por_divisao: false`, que **só
  aparece com a opção desligada** (`z.literal(false).optional()`). Ligada, nenhuma resposta muda (nem um campo a mais):
  os clientes de antes e as gravações da demonstração continuam valendo. Desligada:
  - os rankings **ignoram a `divisao` da consulta** (`montarRankingPainel` e `montarRankingPublico`, `calculos.ts`) e
    respondem o de todas as células, com `divisao: null`. Ignorar, e não recusar com 400 nem devolver só a divisão, é o
    que deixa a 1ª consulta do ranking aberto e do telão, que pede as duas divisões antes de saber da opção, já receber
    a lista única, sem uma ida a mais; e uma URL antiga dos Rankings com `?divisao=` mostra o ranking de todos;
  - na /minha, a posição "na divisão" sai igual à geral (`divisao` = `geral`, o refine novo do schema confere), os
    primeiros e as posições da equipe são as do ranking de todos (`lib/visao-individual.ts` nem monta o ranking da
    divisão);
  - o site transforma a marca em "uma lista só": no ranking aberto e no telão, uma entrada só, com a divisão null, que
    vira o título neutro **"Células"**. As consultas seguintes pedem uma lista só (sem divisão); se a campanha voltar a
    separar, a resposta sem a marca avisa e o site pede as duas de novo.
- **Onde muda, com a opção desligada:**

  | Tela ou saída | Com a opção desligada |
  | --- | --- |
  | Ranking aberto (`/`) | Uma lista só, "Células", na largura toda (a partir de 48rem); as posições, o "↑ subiu" e a comemoração valem entre todas |
  | Telão | A lista única ocupa a tela: até 5 itens, uma coluna larga com a escala de sempre; de 6 a 10, duas colunas da mesma lista (de cima para baixo, depois a da direita), com a escala pelos itens de cada coluna, pelo menos 4 (com 6, 4 e 2: a escala de até 3 itens cortava o nome na meia tela; revisão); acima de 10, 8 e "e mais N"; em pé, uma coluna só. O esqueleto do carregando continua com as duas colunas |
  | Rankings da coordenação | A lista de todos (era o "Todas" do filtro), sem a divisão na legenda nem no vínculo; o filtro "Divisão" fica no lugar, indisponível (`aria-disabled`, só "Todas as células", com a dica de onde ligar), para nada andar na tela quando a resposta chega |
  | /minha | Uma posição só ("Sua posição", "Entre todas as células"), "Os primeiros" sem a divisão, a coluna e o rótulo "Posição" na equipe, e o cabeçalho "Célula" sem "· Jovens" (depois que a visão chega; antes, como sempre) |
  | Bumbo (texto do WhatsApp) | Um ranking só, sem `_Jovens_`/`_Adultos_` (como já era com uma divisão só); "Ainda sem vendas." sem o nome da divisão |
  | Relatório (CSV) | Células, discipuladores e redes numa lista só, na ordem do ranking de todos, com a coluna "Posição no ranking" no lugar de "Posição na divisão" (`cabecalhoDoRelatorio(tipo, unidade, porDivisao)`); a coluna "Divisão" continua (é o dado da hierarquia, como "Rede") |
  | Campanha | A caixa "Separar o ranking por divisão (jovens e adultos)" no cartão "Ranking e público" e a linha "Ranking por divisão" no resumo "Regras da campanha" |

- **O que não muda:** o recorte por divisão do painel (o escopo `divisao` da Visão geral) e do mapa (é recorte de dados,
  não ranking: com a hierarquia toda numa divisão, a outra fica vazia); a divisão na hierarquia e na planilha (a coluna
  `divisao` continua obrigatória: a planilha da campanha usa `jovens` em todas as células, provisório); as mensagens do
  link pessoal (nunca falaram de divisão); a meta (a regra é a da campanha).
- **Peso** (a ferramenta de capturas, em gzip): o JS inicial sobe 0,4 KiB (379 B: a lista única no ranking aberto e no
  telão, o cabeçalho da /minha) e o CSS inicial 0,1 KiB; nenhuma dependência nova. Com a opção ligada, as capturas das
  telas de ranking ficam iguais às da `main` (só a Campanha muda, com a caixa e a linha do resumo).

## D28. Apresentação simulada em /exemplo do próprio site (RIFA-063, 2026-11-17)

Decisão do PO (17/11): a apresentação da RIFA-062 (o site com a campanha simulada: as células e os discipuladores
reais, vendas fictícias, nada é gravado) fica em https://rifa-videira-kids.madruga.workers.dev/exemplo, aberta a quem
tiver o link, para mostrar ao pastor e à igreja. Os nomes das células e dos discipuladores podem ficar públicos; o da
rede, não: a gravação usa a planilha com a rede chamada "Igreja Videira" e a barra não tem o papel Rede (ficam Público,
Coordenação, Líder e Discipulador). Os líderes aparecem como "Líder da célula X" e não vai nenhum link de acesso, token
ou hash. Quando o site esconder o nível rede com uma rede só (RIFA-065), a apresentação pode ser refeita.

- **Roteador de hash, só no build da apresentação.** O site tira a tela do caminho (`createBrowserRouter`) e o Worker
  serve os assets em modo SPA: `/exemplo/telao` sem arquivo cairia no `index.html` da raiz (o site oficial), e
  recarregar sairia da apresentação. Com `VITE_ROTEADOR=hash` no `vite build`, o `main.tsx` usa o `createHashRouter`
  (`src/web/roteador.ts`): a tela fica no hash (`/exemplo/#/telao`), o servidor só vê `/exemplo/` e serve o
  `/exemplo/index.html`. O build do site não define a variável: o mesmo roteador, as mesmas rotas e os mesmos testes
  (`roteador.test.ts` confere o padrão e que nem a configuração do build, nem o CI, nem os `.env` a definem). Nada muda
  no Worker, no `wrangler.jsonc` nem no contrato. Descartados: o roteador do navegador com `basename` e uma regra para
  `/exemplo/*` no Worker ou no `wrangler.jsonc` (mexe no Worker e na proteção das rotas por causa de uma página de
  apresentação) e o roteador em memória (sem link direto para o telão; recarregar volta ao início).
- **Em `public/exemplo/`, gerado.** O Vite copia `public/` para `dist/client` e a publicação já leva: nada muda no CI
  nem no deploy. Lá ficam o `index.html` (documento completo, com o `noindex` e o título "Apresentação Rifa Videira
  Kids"), `assets/` (o pacote do site construído com `VITE_ROTEADOR=hash` e `--base /exemplo/`) e `demo/` (`dados.js`,
  as respostas gravadas; `demo.js`, a API simulada e a barra "Ver como"; `demo.css`). Nada inline: a CSP do
  `public/_headers` vale também em `/exemplo` (por isso a apresentação não usa `<base>`: a CSP tem `base-uri 'none'`).
  O ESLint e o Prettier ignoram a pasta. Peso: 42 arquivos, ~4,2 MiB no repositório e nos assets (RIFA-070); o maior
  é o `demo/dados.js` (~3 MiB; o limite da Cloudflare é 25 MiB por arquivo). O pacote do site não muda: sem a variável,
  o Vite troca a comparação por `false` e o roteador de hash nem entra nele.
- **Nada vai para a API de verdade.** O `demo.js` roda antes do pacote do site e troca o `window.fetch` de `/api/*`: GET
  devolve a resposta gravada do papel escolhido na barra; escrita não grava nada. A página está na mesma origem do site,
  mas nenhum pedido chega ao Worker (nem com o cookie de quem tem sessão no site); o destino "voltar para" que o site
  guarda no `localStorage` volta, ao sair da apresentação, ao que era antes dela; o papel da barra fica no
  `sessionStorage` da aba (recarregar em `#/coordenacao` ou `#/minha` volta ao papel daquela área); e os links `#<id>`
  de dentro da página ("Pular para o conteúdo") levam ao elemento, sem virar tela no roteador de hash.
- **noindex.** `<meta name="robots" content="noindex">`: a página é pública pelo link, mas tem vendas fictícias e não
  deve aparecer nos buscadores no lugar do site da campanha.
- **Uma fotografia.** A apresentação é o site de quando foi montada (esta: a `main` com a RIFA-061, a RIFA-063 e a
  RIFA-067, e a configuração real da RIFA-070): mudança no
  site não chega a `/exemplo` até ela ser refeita. Refazer: gravar de novo a partir da versão do site que se quer
  mostrar, `VITE_ROTEADOR=hash npx vite build --base /exemplo/` e trocar a pasta `public/exemplo/` inteira (os nomes dos
  arquivos de `assets/` mudam a cada build). Apagar `public/exemplo/` tira a página do ar no próximo push na `main`.
  Pendência (revisão): as ferramentas da gravação (o servidor local com o relógio simulado, o cenário das vendas
  fictícias, a gravação por papel e a montagem do `index.html`) ainda não estão no repositório; até entrarem (por
  exemplo em `scripts/apresentacao/`), refazer não sai só daqui.
- **A configuração real da campanha (RIFA-070, 17/11).** Pedido do PO ("na simulação quero preço de 25 do
  bilhete"): a gravação usa a configuração que está no D1 de produção (lida pelo SM, só leitura): bilhete a R$ 25, meta
  fixa de 185 bilhetes por célula (7.030 nas 38), 3 períodos de 7 dias com 30%, 40% e 30%, início em 23/11, ranking por
  bilhetes e único (sem divisão), o público vê o % da meta e as 10 primeiras, sem desconsiderar pedido, o acesso dos
  discipuladores ligado e o das redes desligado (nenhum link de rede, nem na Trilha). O dia simulado é quinta, 03/12,
  15:00 (Dia 11 de 21, no meio do Período 2, cuja meta é 74 bilhetes por célula): 3.208 bilhetes pagos nas células
  (46% da meta da campanha; R$ 80.200), as 3 primeiras acima de 100% do período e algumas lá embaixo; no telão, mais
  54 bilhetes entram em 9 minutos. Os valores em R$ são sempre a quantidade × R$ 25.
- **Só com o `#`.** O link é `/exemplo` (redireciona para `/exemplo/`) ou `/exemplo/#/<tela>` (ex.: `/exemplo/#/telao`).
  `/exemplo/telao`, sem o `#`, não tem arquivo e cai no fallback de SPA: abre o site oficial, na página "não encontrada".

## D29. Login de cada célula com o nome e a senha padrão (RIFA-064; contrato, 2026-11-17)

Pedido do PO (17/11): "Quero que cada célula tenha login e senha, algo simples: login o nome da célula e a senha com
os nomes das células, exemplo: @celula1234. Senhas padrões: arroba, nome da célula e 1234. O máximo que podem ver é o
ranking e o link para vender para aquela célula, então não tem problema ser uma senha padrão." Contrato em
`src/shared/contracts/` (`login-celula.ts`, sem zod; `acesso.ts`; `regras.ts`; `dominio.ts`; `api.ts`), migração
`0013_login_celulas_senha.sql`, API em `src/worker/routes/acesso.ts` e `src/worker/db/login-celula.ts`.

- **A senha não é segredo, e o desenho parte disso.** Quem conhece a regra e o nome de uma célula (que está no ranking
  aberto) entra como ela. Por isso a senha **não é gravada em lugar nenhum** (nem hash): o Worker a deriva do nome da
  célula a cada tentativa (`senhaPadraoDaCelula`) e compara com a digitada em tempo constante
  (`textosIguaisEmTempoConstante`, a do webhook). Não há tabela de senhas para vazar, nada a "trocar" e nada a cadastrar:
  uma célula nova ou renomeada já tem a senha certa. O que protege é o que a sessão pode ver.
- **Senha padrão:** `"@" + nome normalizado + "1234"`. Normalizado = minúsculas, sem acentos (NFD sem as marcas),
  sem espaços e sem pontuação: sobram só `a-z` e `0-9` ("Geração que Clama" → `@geracaoqueclama1234`, "Kairós1" →
  `@kairos11234`, "Pão Vivo" → `@paovivo1234`). O nome digitado no campo "Célula" passa pela mesma normalização. A
  senha digitada também (`formaDaSenhaDigitada`), com o "@" do começo obrigatório: o teclado do celular que põe
  maiúscula, acento ou espaço não atrapalha, e isso não enfraquece nada (a senha já é previsível).
- **Colisão:** dois nomes que ficam iguais depois da normalização ("Pão Vivo" e "Pao Vivo"; o `UNIQUE COLLATE NOCASE`
  de `celulas.nome` só pega maiúsculas sem acento) tornam o login **ambíguo: recusado para as duas**, com o mesmo 401.
  A coordenação vê o aviso na tela Hierarquia (`problemasDoLoginDasCelulas`), com o que fazer (renomear uma delas). Um
  nome sem letra nem dígito ("!!!") não tem senha (o mesmo aviso). Não há trava no cadastro: a planilha e o CRUD
  continuam aceitando os nomes de hoje; o aviso basta para 36 células.
- **A sessão é a do papel `lider` da célula, a mesma do link (D12).** `POST /api/sessao/senha { celula, senha }` abre
  a sessão com o usuário líder da célula (um por célula, 0006): a /minha da célula (ranking, meta, link e QR de vendas),
  nunca R$, nenhuma rota da coordenação, nenhuma escrita além da própria sessão. O alvo vem só da sessão, como sempre.
  `protecao.test.ts` (seção i) prova o 403 em toda rota de `/api/admin` e `/api/painel` e a /minha só da célula.
- **A célula sem líder de verdade:** se a célula ainda não tem o usuário líder (nenhum link gerado), o login por senha
  o cria, com o `lider_nome` da hierarquia, que é o líder da importação, mesmo provisório (a planilha exige o nome). A
  cada login por senha, o nome do usuário acompanha o `lider_nome` atual, como o lote de links já fazia. Quando a
  coordenação gerar o link do líder, o lote reaproveita o mesmo usuário: link e senha abrem sessões do mesmo usuário.
- **A sessão aberta pela senha não tem link** (`sessoes.link_id` NULL, que a 0002 já aceitava): é assim que a consulta
  da sessão a reconhece. Ela segue as regras de sempre (`__Host-sessao`, 45 dias, parada há 7 dias deixa de valer,
  "Sair", desativar o usuário derruba), sem o encurtamento pelo fim do link. Revogar um link não a derruba (ela não veio
  de link); para tirar o acesso de uma célula, desative o usuário dela (Acessos), o que também barra o link e a senha.
- **Liga/desliga na Campanha (D20):** `acesso.celulas_senha`, "Login das células com senha padrão", **só o admin muda**
  (grupo `acesso`, RIFA-042; a coordenação vê só leitura). Na resposta, sempre presente (`.default()`); na entrada,
  opcional, e ausente mantém o gravado, como o `ranking.por_divisao` da D27 (uma aba antiga do site não liga nem
  desliga). **Padrão: ligado**, como os outros acessos: o PO pediu para esta campanha, e desligado ninguém entraria pela
  senha no dia 23/11 se alguém esquecesse de ligar. A 0013 grava 1 na campanha que já existe. Desligado: o login por
  senha recusa (o mesmo 401) e **as sessões abertas pela senha deixam de valer na hora** (401, o cookie expira), porque
  a chave é lida na mesma consulta da sessão (+1 linha só nessa sessão; com link, o `OR` nem lê a campanha, e as linhas
  travadas da /minha não mudaram). O link pessoal do líder não depende da chave. É diferente do 403 `acesso_desligado`
  dos discipuladores e das redes de propósito: aqui não há o que guardar para quando religar (a senha é a mesma) e a
  recusa não diz nada a quem tenta.
- **Segurança mínima, mesmo com senha previsível:**
  - **limite de tentativas:** o mesmo `LIMITE_LOGIN` do link (60 por minuto por IP), no mesmo contador: 30 pelo link e
    30 pela senha esgotam o IP. Barra a varredura e protege CPU e banco; na reunião dos líderes, 60 por minuto atrás do
    mesmo Wi-Fi bastam;
  - **a resposta não diz se a célula existe:** senha errada, célula que não existe, nome ambíguo ou sem senha, usuário
    desativado e chave desligada dão o **mesmo** 401 `nao_autenticado`, com a mesma mensagem e os mesmos cabeçalhos; a
    comparação em tempo constante acontece também sem célula (contra uma senha que nunca confere). Campo vazio também
    é 401 (só a falta do campo, um não texto ou mais de 200 caracteres dão 400);
  - **CSRF e corpo:** mesma origem (`exigirMesmaOrigem`) e o teto de 4 KiB do `POST /api/sessao`;
  - **trilha:** cada login por senha que abriu sessão vira uma linha `sessao.entrar_com_senha`, do usuário líder da
    célula, alvo `celula:<id>`, no mesmo lote da sessão; o resumo não tem a senha (ela nem chega à camada do banco). A
    tentativa recusada não registra. Um teste varre todas as tabelas e o console atrás da senha digitada e da derivada.
- **Consequência aceita:** a trilha segura (RESTRICT, 0005) o usuário que aparece como autor. Depois de um login por
  senha, a célula não pode ser excluída (a mensagem de hoje já diz "o acesso dela aparece como autor na trilha"). Na
  campanha isso não pesa: célula com afiliado já não se exclui, e a célula de nome repetido, a que mais se excluiria,
  nunca entra pela senha.
- **Site:** `/entrar` ganha o cartão "Entrar com a sua célula" (campos Célula e Senha, com dica; o botão Entrar com
  `aria-disabled` enquanto confere; "Célula ou senha não conferem." no 401; depois, a /minha); o cartão do link continua,
  para todos os papéis. A Campanha ganha a chave e a linha no resumo. A Hierarquia (admin e coordenação, nunca a
  hierarquia) mostra o aviso das células que não entram pela senha e, num `<details>` fechado, a senha de cada célula
  com "Copiar", calculada no navegador pela mesma regra (`login-celula.ts`, sem zod), para repassar ao líder.
- **Alternativas descartadas:** senha guardada por célula (hash), com troca e "esqueci a senha": mais tela e mais
  suporte, sem ganho, porque o PO quer a senha padrão; mudar o `POST /api/sessao` para aceitar `{ token }` ou
  `{ celula, senha }`: uma rota à parte deixa o contrato e os testes do link como estão; coluna nova em `sessoes` para
  marcar a sessão da senha: `link_id` NULL já diz isso, sem migração na tabela que cada requisição lê.

## D30. Rede única: com uma rede só, o site esconde o nível rede (RIFA-065, 2026-11-17)

Pedido do PO (17/11): "Não quero que tenha o nome das redes, apenas dos discipuladores." A planilha da igreja não tem
rede (8 discipuladores e 38 células); a importação usa uma rede só ("Exploradores"), porque o modelo exige rede →
discipulador → célula.

- **A regra, só no site** (sem mudar o contrato nem a API): com uma rede só na hierarquia, o nível rede some de todas as
  telas; com duas ou mais (ou nenhuma), tudo como antes. A rede continua no banco, na API, na planilha (a coluna `rede`
  segue obrigatória: o mesmo nome em todas as linhas) e nos arquivos do relatório.
- **De onde o site sabe** (`src/web/lib/redes.ts`): das listas que as telas já recebem com a hierarquia toda: as redes
  (Hierarquia) e as células (Visão geral, Pedidos e Adesão, contadas pela `rede_id`). Rankings, Campanha e Acessos não
  recebem a hierarquia (o ranking com o filtro de divisão traz só parte das redes): perguntam `GET /api/admin/redes`
  (rota que já existia), uma vez por página aberta e só se o site ainda não souber. O que se sabe fica no módulo, vale
  entre as telas e o menu usa. Sem saber, as abas, colunas e campos ficam como sempre; os textos que só enumeram os
  níveis (dicas do menu e descrições) saem sem a rede até se saber que há mais de uma.
- **Onde muda, com uma rede só:**

  | Tela | Com uma rede só |
  | --- | --- |
  | Hierarquia | Sem o número "Redes", a aba Redes, as colunas Rede (células e discipuladores) e o filtro Rede; no "Editar célula", os discipuladores numa lista só; no "Editar discipulador", sem o campo Rede (o PUT manda a mesma). A aba "Importar planilha" é a exceção: a dica e a explicação da coluna dizem que a rede pode ser uma só, e o resultado só tem a linha "Redes" se a planilha cria ou muda uma rede |
  | Visão geral | O filtro sem o grupo Rede; o aviso das vendas sem célula diz "em nenhuma divisão nem célula"; o relatório sem o tipo "Por rede" |
  | Rankings | Sem a aba Redes (uma URL de antes com `?nivel=rede` mostra as células) e sem a rede no vínculo |
  | Pedidos | O filtro de célula numa lista só, sem o grupo com o nome da rede |
  | Adesão | "Líder: …" sem a rede nos cartões; as dicas das buscas sem citar a rede |
  | Acessos | A aba "Líderes e discipuladores", sem o papel Rede: não se oferece criar acesso de rede |
  | Campanha | Sem a caixa "Acesso das redes", a linha do resumo e a "Mensagem do link da rede" (os valores gravados ficam e vão iguais no PUT); o `{alvo}` sem a rede |
  | Menu e `/entrar` | As dicas da Hierarquia e dos Rankings sem a rede; o `/entrar` (tela aberta, sem a hierarquia) diz "Coordenação, líderes e discipuladores" sempre |

- **O que fica:** o relatório em CSV continua com a coluna "Rede" (é o arquivo de trabalho, montado pela API: tirá-la
  mudaria o contrato do relatório; com uma rede, ela repete o mesmo nome e pode ser apagada no Excel) e a API aceita
  `tipo=redes`; a trilha cita a rede quando ela é criada ou mudada (é o registro do que aconteceu); o líder e o
  discipulador já não viam a rede na `/minha` (o teste confere); a `/minha` do papel rede fica como era (sem o acesso de
  rede oferecido, ninguém novo entra com ele); a apresentação em `/exemplo` (D28) é uma fotografia do site de antes e
  só esconde a rede quando for refeita.
- **Uma rede vazia** (sem células; a importação só cria rede com célula) conta na Hierarquia, nos Rankings, na Campanha e
  nos Acessos (que contam as redes), mas não na Visão geral, nos Pedidos e na Adesão (que contam pelas células).
- **Peso e navegador** (a ferramenta de capturas, com as gravações da demonstração numa rede só e 3 discipuladores): o JS
  inicial sobe 1,1 KiB em gzip e o CSS fica igual; nenhuma dependência nova; nenhum CLS subiu, sem rolagem lateral a 390
  px, sem erro no console e sem "R$" na tela do líder e do discipulador. A varredura das telas (Visão geral, Rankings,
  Hierarquia com os diálogos, Acessos, Adesão, Campanha, Pedidos, `/minha` do líder e do discipulador e `/entrar`, a 390
  e a 1366 px, com as dicas) só achou a rede na dica da aba "Importar planilha", a exceção combinada.
- **Testes:** `lib/redes.test.ts` e `pages/rede-unica.test.tsx` (cada tela com uma rede só: o texto, os atributos, os
  valores dos campos e as dicas, para admin, coordenação, líder e discipulador). As API falsas dos Rankings, da Campanha e
  dos Acessos respondem a lista das redes com duas (a tela como sempre foi) e guardam o pedido à parte.

## D31. Ajuda nos títulos e rótulos: o "?" e o texto de quem nunca viu o sistema (RIFA-066, 2026-11-17)

Pedido do PO na Campanha, em "Períodos": "Período do quê? Quando eu coloco o mouse em cima, deveria explicar para que
serve isso. E essa explicação tem que estar em todo o sistema." A dica dos botões e campos (RIFA-045) não cobria os
títulos de seção, os rótulos, os números nem as colunas, não abria no celular e explicava o mecanismo, não o
propósito. Decidido pelo SM e pelo developer de front em 17/11; o PO pode trocar textos ao ver a demonstração.

- **Onde**: todo título (o da tela, o de cada seção e os subtítulos como "Períodos"), todo campo, os números (`Stat`)
  e as colunas cujo nome não basta. A prova é a varredura `titulosSemAjuda()` nos casos por tela das dicas (todas as
  telas da coordenação, a `/minha` dos três papéis e as telas abertas). Fica de fora o que não é seção: o título de
  um diálogo (já tem descrição), a opção de um rádio e o nome de um item numa lista (`data-sem-ajuda`).
- **Como aparece**: um "?" discreto ao lado do título ou do rótulo, e a explicação com o mouse parado no próprio
  título (o que o PO tentou), no foco do teclado e **no toque do "?"**, que deixa a explicação fixa até outro toque,
  um toque fora ou Esc. É a mesma dica da RIFA-045 (`ComDica`, modo `fixarNoBotao`): uma por vez, Esc fecha só ela,
  sempre dentro da tela, WCAG 1.4.13. O "?" é um botão "Ajuda: <título>", com a explicação no `aria-describedby`;
  o título e o rótulo não mudam de nome. O telão não tem controles: lá, só o mouse no título.
- **Um texto só por campo**: o campo com `ajuda` mostra a explicação no rótulo, no "?" e no próprio campo (é a dica
  dele). As dicas antigas desses campos saíram do `textos.ts`: o texto, reescrito, está na ajuda. Escolhemos a prop
  nos componentes base (e o `ComAjuda` para o resto), e não um `ComDica` em volta do título, porque o título precisa
  de um alvo de toque (o "?") e o nome dele não pode mudar (os testes e os leitores de tela acham a seção pelo nome).
- **O texto**: o que é, para que serve na campanha e, quando há algo a escolher, um exemplo, em 2 ou 3 frases curtas
  (até 260 caracteres, conferido em `pages/ajuda-das-telas.test.ts`). Nas telas da `/minha` e nas abertas, sem R$.
- **Peso**: as telas `lazy` levam os textos no pedaço delas. As que carregam com o site (Visão geral, Hierarquia,
  Adesão, Rankings, Bumbo e Acessos) pedem os textos sob demanda, num pedaço só (`pages/ajuda-das-telas.ts`, um
  `import()` em vez de um por tela), que chega logo depois da tela; as telas abertas, num pedaço delas; o título das
  telas da coordenação usa o texto do link do menu, que já estava no pacote inicial. Com as dicas dos campos
  movidas para a ajuda, o JS inicial sobe 0,7 KiB (163,4 → 164,1 KiB em gzip, contra a `main` de 19/11) e o CSS
  inicial 0,1 KiB; nenhuma dependência nova. Até o pedaço chegar, a ajuda diz "Carregando a explicação…".
- **Fora**: ajuda em cada célula de tabela, em mensagens (avisos, estados vazios) e no nome de itens de lista; um
  "?" no telão.
## D32. API interna da Rifei: marcar pagos, afiliados e convites (RIFA-070, 2026-11-17; renumerada de D29 em 19/11)

Decisão do PO (17/11): no Pix manual (D26), o último passo, marcar como pago no painel da Rifei, deixa de ser à mão; e
os afiliados das células (dezenas) não são mais criados um a um. A D26 deixava isso de fora porque "a Rifei não tem API
para marcar como pago". Ela não tem API **pública**, mas o painel (`app.rifei.com.br`) é um site que fala com
`https://api.rifei.com.br/` com o token do login (`Authorization: Bearer`). As chamadas foram mapeadas no código do
painel em 17/11/2026 (docs/integracao-rifei.md, seção 13) e o sistema faz as mesmas, pelo admin.

- **Onde roda:** no Worker (Cloudflare), nunca no navegador: o token da Rifei fica no segredo `RIFEI_API_TOKEN`
  (`wrangler secret put`), nunca no banco, no site, na trilha ou no log. Nada depende de um computador ligado.
- **Nada roda sozinho:** cada chamada parte de um clique do admin (Conferência do extrato e Adesão). Sem cron, sem
  robô, sem login automático (o login da Rifei tem captcha: o token vem de um login feito à mão; seção 13.2).
- **Marcar como pago** (`POST /api/admin/rifei/marcar-pagos`): o banco decide o que vai à Rifei (só o pendente ou
  expirado da campanha ativa, sem desconsideração; o resto volta como `ja_pago`, `desconsiderado` ou
  `fora_do_sistema`). Na Rifei, um pedido por chamada (até 4 ao mesmo tempo): o PUT em lote do painel
  (`raffles/orders/many`, que só aprova; o PUT de um pedido **alterna** aprovar/desaprovar e não é usado), a conferência
  do status e, se o pedido sumiu dos reservados (expirou: a campanha expira a reserva em 24 h), a restauração
  (`raffles/expired-orders/<id>/restore`) e a aprovação de novo. **O sistema não grava nada no pedido:** ele passa a
  contar quando o "Pedido pago" chega pelo webhook, como antes; se não chegar, a conferência pelo CSV o mostra em
  "Pagamento não registrado" (RIFA-056).
- **Afiliados** (`GET /api/admin/rifei/afiliados` e `POST .../afiliados/sincronizar`): a Rifei não deixa o
  organizador criar a conta do afiliado. A sincronização grava o **código** de cada afiliado (o `ref` do link de vendas:
  `https://rifei.com.br/<slug>?ref=<código>`, migração 0014) e liga à célula o afiliado não vinculado cujo e-mail na
  Rifei é o do líder de **exatamente uma** célula. Nunca troca um vínculo que já existe. O modelo do link de vendas (D24)
  ganha o marcador `{codigo}`.
- **Convites** (`POST /api/admin/rifei/convites`): um convite por célula (comissão 0%, todas as campanhas), de uso único
  e válido por 1 dia (regra da Rifei). O link volta para a tela (Copiar e WhatsApp do líder) e nunca é gravado.
- **Erros:** sem o segredo, 503 `nao_configurado` (a tela manda usar o caminho manual); a Rifei recusou o token, não
  achou a campanha, não respondeu ou respondeu num formato desconhecido: 502 `rifei_falhou` com o `motivo`. Uma falha de
  um pedido só (429/5xx/tempo) fica naquele pedido (`falhou`).
- **Riscos aceitos pelo PO:** a API é interna e pode mudar sem aviso (tudo que vem dela é conferido; formato
  desconhecido vira `resposta_inesperada`, nunca 500); os Termos de uso da Rifei (item 4.4) proíbem engenharia
  reversa: o risco é a conta ser limitada. Por isso o volume é o de um admin clicando, e o caminho manual (Copiar os
  números, painel da Rifei) continua na tela.
- **SUPOSIÇÕES** a confirmar na compra de teste (seção 13.4): o `id` do webhook é o mesmo que a API usa; a aprovação
  pela API dispara o `paid_order`; o pedido expirado mantém o `id` em "Pedidos expirados"; o `ref` aceita o código.
- **Adendo (19/11, revisão da RIFA-070; pedido do PO):**
  - **Token pela tela, não pelo terminal.** Acessos → Conexão com a Rifei: colar, testar, trocar e apagar. O token
    fica no D1 **cifrado** (tabela `rifei_conexao`, migração 0014; AES-GCM com a chave do segredo do Worker
    `RIFEI_CHAVE_CIFRA`, `lib/cifra-rifei.ts`) e nunca volta ao navegador, ao log ou à trilha. O token da tela tem
    prioridade; o segredo `RIFEI_API_TOKEN` vale só sem ele. Sem a chave, nada é guardado (503). Chave trocada ou
    perdida: a tela pede um token novo. Por quê cifrar e não só fazer hash: o sistema precisa do token em claro para
    chamar a Rifei.
  - **Estado da conexão gravado a cada chamada real:** sucesso → `testado_em`; 401/403 → `recusado_em` (a primeira);
    mostrado na tela da Conexão e no topo do Extrato do banco. A validade vem do `exp` do próprio token, se for JWT.
  - **Seleção e marcar à mão:** caixa por pedido em "Para marcar" e busca pelo número do pedido ou de um bilhete
    (`GET /api/admin/rifei/pedido`), que reaproveita o `POST marcar-pagos` (o banco continua decidindo o que vai à
    Rifei). Só admin (`protecao.test.ts`).
## D33. Login do admin com usuário e senha (RIFA-073; contrato, 2026-11-19)

Pedido do PO (19/11): o pastor (admin) entra no painel com usuário e senha, para marcar pagamentos sem depender do link
no celular. Contrato em `src/shared/contracts/` (`senha-admin.ts`, sem zod; `acesso.ts`; `api.ts`), migração
`0015_senha_admin.sql`, API em `src/worker/routes/acesso.ts` (login), `src/worker/routes/senha-admin.ts` e
`src/worker/db/senha-admin.ts`, hash em `src/worker/lib/senha.ts`, script `scripts/definir-senha-admin.mjs`.

- **Só o papel admin.** Coordenação, líder, discipulador e rede continuam como estão (link; a célula, também a senha
  padrão da D29). As rotas da senha (`/api/admin/minha-senha`) são só de admin e só mexem na senha **de quem está
  conectado**; o login confere `papel = 'admin'` e `ativo = 1` na hora.
- **A senha é segredo, ao contrário da D29:** só o PBKDF2-SHA256 é gravado, com sal aleatório de 16 bytes por senha e
  100.000 iterações (o máximo que o Workers aceita no PBKDF2; o número fica na linha, para subir sem invalidar as
  senhas). A senha é normalizada em NFC antes do hash. Senha forte = mínimo de 10 caracteres e diferente do usuário
  (`problemaDaSenhaAdmin`, a mesma regra na tela, na API e no script). Custo: dezenas de ms de CPU por conferência,
  dentro do Workers Paid que a D19 já exige.
- **Tabela própria (`senhas_admin`), não colunas em `usuarios`:** a tabela que cada sessão lê fica como está, e
  remover a senha é apagar uma linha. O usuário de login é único, em minúsculas (`FORMATO_USUARIO_ADMIN`).
- **Login (`POST /api/sessao/admin`)**: a mesma pilha do link e da célula (mesma origem, `LIMITE_LOGIN` por IP, teto de
  4 KiB). O PBKDF2 roda **sempre**, contra um hash fictício quando o usuário não existe, e toda recusa é o **mesmo** 401:
  nem a mensagem nem o tempo dizem se o usuário existe. **Limite por conta**, além do por IP: 5 erros seguidos bloqueiam
  o login da conta por 15 minutos, com o mesmo 401 até para a senha certa (dizer "bloqueada" revelaria a conta); o
  acerto e a troca de senha zeram. O link pessoal do admin continua entrando, então o bloqueio nunca prende ninguém.
- **A sessão é a do link do admin, sem link** (`sessoes.link_id` NULL, como a da célula). A consulta da sessão distingue
  pelo papel: a do admin vale enquanto ele tiver a senha (não depende da chave das células); a do líder, enquanto a
  chave da D29 estiver ligada; a de outro papel, nunca. Trocar a senha encerra as **outras** sessões dele abertas pela
  senha; remover encerra todas elas. A trilha registra `senha_admin.definir`, `.trocar`, `.remover` e cada
  `sessao.entrar_como_admin`, sem a senha nem o usuário de login.
- **Como a senha nasce:** o admin entra pelo link e cria na tela **Minha senha**; ou o SM roda
  `npm run acesso:senha -- --admin <id|nome> --usuario <login> [--remote]`, que lê a senha do **stdin** (nunca de
  argumento, que iria para o histórico do shell), grava só o hash e registra na trilha.
- **Descartado:** senha para a coordenação (o pedido é do admin; mais contas com senha é mais superfície); "esqueci a
  senha" por e-mail (o link pessoal já é a recuperação); bloqueio que responde 429 ou "conta bloqueada" (revelaria quem
  existe).

## D34. O comprovante de Pix em PDF e vários arquivos na conferência do extrato (RIFA-074, 2026-11-19; adendo da D26)

Pedido do PO (19/11): o pastor (admin) sobe o extrato **ou o comprovante** do Pix no painel, um ou vários de uma vez, e
o site lista os pedidos pagos. Na Rifei, o Pix manual usa o número do pedido como identificador do Pix. A tarefa só
lê e cai no mesmo cruzamento da D26; marcar na Rifei é a RIFA-070 (D32).

- **O comprovante** (`extrato/comprovante.ts`, puro): o texto do PDF (as linhas do `pdf-linhas.ts`) é comprovante quando
  fala de Pix, diz "comprovante" (ou tem os blocos de quem pagou e de quem recebeu), tem de 1 a 6 valores, nenhuma
  tabela e nenhuma linha com a data e o valor juntos (a linha de lançamento do extrato). Senão, é extrato, como antes.
  Do comprovante saem: o valor (o campo Valor; sem ele, a linha só com "R$ 20,00"), a data e a hora (o campo Data e
  hora, Data/Hora, Data do pagamento...; sem ele, a primeira linha com data e hora, como "16 NOV 2026 - 14:30:12"), o
  nome de quem pagou (o Nome do bloco "Dados de quem pagou", "Origem", "Pagador" ou "De:"; nunca o do bloco de quem
  recebeu), o **identificador** (txid: Identificador, Identificação, TXID) e o **ID da transação** (o E2E do Banco
  Central, `E` + 20 algarismos + 11 letras ou algarismos, achado em qualquer lugar, mesmo quebrado em duas linhas; sem
  ele, o campo ID da transação ou Número de controle). O rótulo e o valor podem vir na mesma linha (ou lado a lado)
  ou o valor na linha de baixo. Vira um lançamento só (`formato: "comprovante"`), com a descrição "Comprovante de Pix ·
  <nome> · identificador <txid>" e `origem: "comprovante"`.
- **O layout pesquisado** (fontes públicas, só cópias de comprovantes de terceiros e guias; nenhum banco publica o
  modelo): Bradesco (app e Net Empresa) com "Comprovante de Transação Pix", "Dados de quem recebeu", "Dados de quem
  pagou" (Nome, CPF/CNPJ mascarado, Instituição), "Dados da transação" (Valor, "Data e hora: 20/12/2024 - 15:16:05"),
  "Identificador" ou "Número de controle"; bancos digitais (o jeito do Nubank) com "Comprovante de transferência", a
  data no topo, "Destino" e "Origem" e "ID da transação"; outros (o jeito do Itaú) com "de:" e "para:" e o valor na
  linha de baixo; o E2E de 32 caracteres com E (Banco Central). Os testes usam PDFs sintéticos nesses três jeitos
  (`teste-apoio-pdf.ts`), com dados fictícios. NÃO DOCUMENTADO e a conferir na compra de teste: o nome do campo do
  identificador no comprovante do Bradesco e se ele traz o número do pedido da Rifei.
- **Certo pelo identificador:** o `txid` inteiro igual ao número de um pedido é "Certo" mesmo curto e só de algarismos
  (o mínimo de 8 algarismos da D26 é para pedaços achados no meio do texto do extrato; o campo do identificador é o
  próprio número). Sem identificador, o comprovante cai no Provável/Ambíguo pelo valor e pela hora, como o extrato
  (o comprovante tem a hora: o cruzamento fica mais preciso). O comprovante passa sempre pelo filtro das palavras do
  Pix. O formato do resultado do cruzamento não muda (a RIFA-070 usa a lista "Para marcar"); o `Lancamento` (e o `Pix`)
  ganham só campos opcionais: `origem`, `txid`, `idDaTransacao` e `pagador`.
- **Vários arquivos** (`SeletorArquivo` com `aoEscolherVarios`, o `multiple` do campo): cada arquivo é lido (o PDF pelo
  mesmo leitor sob demanda), a tela mostra **Arquivos lidos** com o resultado de cada um (o extrato com os
  lançamentos, o comprovante com o valor e a hora, quantos Pix já estavam noutro arquivo, ou a falha) e os lidos viram
  um extrato só (`extrato/juntar.ts`, `formato: "varios"`, "Lido dos arquivos"). O CSV sem colunas reconhecidas
  precisa ser escolhido sozinho (o mapeamento na tela é de um CSV). Um arquivo só segue o caminho de antes.
- **O mesmo Pix em dois arquivos conta uma vez:** o mesmo ID da transação é o mesmo Pix (IDs diferentes, Pix
  diferentes); senão, o mesmo valor, a hora a até 2 minutos (sem a hora num dos lados, o mesmo dia) e o mesmo nome
  (dois comprovantes: o mesmo nome; comprovante e extrato: o primeiro e o último nome do comprovante na descrição do
  extrato, o "REM: <nome>"; sem nome no extrato, só com a hora dos dois a até 2 minutos); dois extratos (períodos que se
  cruzam): a mesma linha (valor, instante e descrição). Identificadores (txid) diferentes nunca são o mesmo Pix (o mesmo
  comprador pagando dois pedidos de mesmo valor no mesmo minuto), e, se mais de um lançamento serve, fica o mais perto
  na hora (revisão). Os lançamentos de um mesmo arquivo nunca se juntam. Juntos, fica
  o lançamento do extrato (o banco confirma), com o identificador, o ID e o nome do comprovante: o Pix ambíguo do
  extrato vira Certo com o comprovante.
- **Comprovante pode ser adulterado** (a própria Rifei avisa): o Pix que veio só de comprovante leva a marca "Só no
  comprovante: confira no extrato antes de marcar", e o resultado mostra o aviso enquanto houver um. O jeito seguro é
  escolher o extrato junto. Pix agendado ("agendado"/"agendamento" sem "concluído", "efetivado", "realizado") é uma
  falha clara. Comprovante de Pix **enviado** pela igreja não é distinguido (a tela não sabe a conta da igreja):
  pergunta ao PO.
- **Foto ou print** (tipo `image/*`, extensão de imagem ou a assinatura JPEG, PNG ou HEIC): falha "Esta é uma foto ou
  um print", que pede o PDF (OCR fica fora). O campo aceita `image/*` para a pessoa receber essa mensagem em vez de não
  achar o arquivo. O PDF sem texto (escaneado) continua "Este PDF é uma imagem", agora com o caminho do comprovante.
- **Privacidade (D26 inteira):** nada sai do navegador e nada é gravado; o nome de quem pagou, o identificador e o E2E
  ficam só no estado da tela (`ExtratoDoBanco.test.tsx` varre as chamadas também com os comprovantes). O pdf.js
  continua sob demanda.
- **Peso:** o JS inicial fica em 397,17 KiB (119,06 KiB em gzip; +0,02 KiB pelo `SeletorArquivo`, que é do pacote
  inicial); a seção do extrato vai de 13,6 para 17,7 KiB em gzip (o leitor do comprovante, a junção e a lista dos arquivos); o pacote do pdf.js não muda.

## D35. Bilhetes pagos, reservados e livres (RIFA-075, 2026-11-19)

**Contexto.** O PO quer ver, durante a campanha (início em 23/11), quais números da rifa já estão pagos, quais estão
reservados (pedido aguardando o Pix) e quais estão livres, e achar o pedido de um número (para a marcação de pagos da
RIFA-070). A rifa "projeto-kids-1" da Rifei tem **7005 números** (campo `numbers` da página pública, informado pelo SM).
Cada pedido do webhook já traz os números em `pedidos.numeros` (array JSON; nulo no pedido recuperado pela
Conferência, que não sai do navegador com os números).

**Decisão.**

- **Campanha, grupo `bilhetes`** (migração 0016): `quantidade` (1 a 1.000.000; padrão 7005) e `numero_inicial` (0, 1
  ou null = **automático**). Automático vale 0 se algum pedido pago ou reservado trouxe o número 0, e 1 se não: a
  Rifei não documenta se numera do 0 ou do 1, e a compra de teste confirma (lançamento 4.2). No PUT, o grupo ausente
  mantém o gravado (como `ranking.por_divisao`); admin e coordenação mudam (é configuração, não regra do admin).
  A trilha registra `bilhetes (antes → depois)`.
- **Situação de um número:** **pago** se está num pedido `approved`; **reservado** se está num `in_process` com
  `expira_em` nulo ou ainda no futuro; **livre** no resto. Pago vence reservado (o número que expirou e foi comprado
  de novo). O pedido **desconsiderado** pelo admin (D20) não conta, como em todo lugar que soma pedidos; a busca o
  mostra com o selo.
- **API compacta:** `GET /api/painel/bilhetes` (admin e coordenação, no prefixo do painel, atrás do login, no-store)
  devolve um **mapa de bits em base64 por situação** (bit i = número `numero_inicial + i`; byte i >> 3, bit i & 7):
  7005 números = 876 bytes por mapa; 100.000 = 12,5 KB (~17 KB em base64). Faixas (intervalos) seriam piores com
  números sorteados. Mais os contadores, o % vendido (pagos ÷ quantidade, pontos-base), os pedidos sem números e a
  contagem de números fora da faixa (configuração errada). Duas idas ao D1 (a campanha e os pedidos pagos ou
  reservados com `numeros` em texto); o Worker faz o `JSON.parse` e liga os bits. Medido em
  `src/worker/routes/bilhetes.test.ts` com 100.000 números em 20.000 pedidos (teto folgado de 5 s, só contra desastre).
- **Busca por número:** `GET /api/painel/bilhetes/:numero` percorre os números no D1 (`json_each`, sem índice: uma
  consulta por toque, não por atualização) e devolve até 20 pedidos (os mais recentes) com id, situação
  (pago, reservado ou expirado, inclusive o pendente vencido sem aviso da Rifei), célula, data e bilhetes. Nenhum dado
  do comprador (schema estrito).
- **Tela Bilhetes** (`/coordenacao/bilhetes`, toda a coordenação): contadores, legenda com as contagens, filtro (só
  pagos, só reservados, só livres: os outros ficam apagados na grade), busca, e a grade num **canvas** (três passadas,
  uma por cor; nenhum nó do DOM por número). Quadrados de 8 px no celular (44 colunas em 390 px, sem rolagem lateral)
  e 10 px no computador. Tocar num quadrado busca o número. Atualiza **a cada 30 s com a aba visível** (e logo que ela
  volta a ficar visível) e no **Atualizar agora**; uma falha mantém a grade com o aviso.

**Consequências.** Pedido recuperado (sem números) não aparece na grade: a tela avisa com a contagem de pedidos e de
bilhetes. Números fora da faixa (quantidade ou número inicial errados na Campanha) viram um aviso com o link para a
Campanha. O % vendido é dos números conhecidos (os da grade).

### Adendo da D34: o relatório "Pix recebidos" do Bradesco em PDF (RIFA-077, 2026-11-19)

O PDF real que o PO mandou não é o extrato da conta nem o comprovante: é a **lista de Pix recebidos** (gerada por
iText), com as colunas Data | Referência | Identificação | Horário | Entradas (R$) | Saídas (R$) | "Ver detalhes". Cada
lançamento é um **bloco vertical**: o dia numa linha e "NOV" embaixo (só no primeiro do dia); o nome de quem pagou e o
banco dele quebrados em várias linhas, acima e abaixo da linha do meio; na linha do meio, o E2E, o horário e o valor.
O ano não aparece.

- **Leitor** (`extrato/pix-recebidos.ts`, puro): `pdf-linhas.ts` tenta primeiro o cabeçalho deste relatório (Data,
  Horário, Entradas e Saídas, e Referência ou Identificação, na mesma faixa). Achado, os pedaços viram blocos pela
  linha do meio (horário, valor e E2E na mesma altura); as linhas da Referência vão para o bloco certo pelo **maior vão**
  entre duas linhas do meio (a célula é centrada e o tamanho varia: o mais perto erraria), e a data pelo mais perto. O
  valor é da coluna cujo fim do cabeçalho está mais perto do fim do valor (alinhado pela direita): **Entradas** é
  crédito; **Saídas**, débito (fica de fora, como os débitos da D26). O resultado é um texto canônico (a marca "Pix
  recebidos" e uma linha por lançamento, com tabulações), lido por `lerPixRecebidos` em `leitura.ts`, antes do
  comprovante. Sem o cabeçalho, o PDF segue o leitor de antes.
- **O que sai:** a data (dia e mês da coluna, ano do E2E `E` + ISPB + **aaaamm**ddhhmm, com a virada do ano; sem E2E,
  o ano corrente, como o "16/11" do texto colado), o horário, o valor, o **pagador** (as linhas da Referência juntas,
  sem o banco), o **banco** à parte (campo opcional novo do `Lancamento`; a linha que começa com o nome de um banco,
  ou o parágrafo de baixo com a forma de empresa, "S.A.", "- IP", "LTDA") e o E2E como `idDaTransacao` (acha o mesmo
  Pix num comprovante, D34). A hora do E2E é UTC e não é usada.
- **São Pix pelo próprio relatório:** o `Lancamento` ganha `pix: true`, e o filtro das palavras do Pix ("PIX",
  "TRANSF") não vale para eles, como o comprovante. O cruzamento e o formato do resultado não mudam (RIFA-070).
- **Conferido com a amostra real só localmente** (não está no repositório nem nos testes): 3 lançamentos, R$ 25,00 em
  19/11 às 11:12:04, R$ 2.863,28 em 18/11 às 14:41:43 (na coluna **Saídas**: débito, fica de fora) e R$ 813,26 em
  18/11 às 11:03:38. O teste usa um PDF sintético com o mesmo layout e nomes e E2E fictícios
  (`pdfDePixRecebidos`, `teste-apoio-pdf.ts`).

## D36. Nome e telefone de quem reserva ou compra, só para o admin (RIFA-076, 2026-11-19)

**Substitui em parte** a regra de privacidade do início (D1 da integração, `docs/integracao-rifei.md`; comentário da
`migrations/0001_init.sql`: "nenhuma coluna guarda nome, e-mail, documento, nascimento, endereço ou telefone completo do
comprador. Do telefone ficam só ddd e pais"). Decisão do PO em 19/11: "não tem dado sensível, é só o nome da pessoa e no
máximo o telefone; é só para, caso algo dê errado, saber quem reservou e entrar em contato". Acréscimo do PO no mesmo
dia: uma planilha de compradores para agradecer a compra e para as campanhas futuras da igreja.

- **O que passa a ser guardado:** `pedidos.comprador_nome` (texto de 1 a 120 caracteres, espaços juntados) e
  `pedidos.comprador_telefone` (E.164, ex.: `+5591988887777`; fora do formato, NULL), migração
  `0017_comprador_contato.sql`. Vêm de `buyer.name` e `buyer.phone` (`extrairContatoComprador`, `rifei.ts`).
  **Continuam fora:** e-mail, documento, nascimento, endereço, `observation`, `fbp` e `fbc`.
- **Quando é gravado:** em todo evento do webhook do pedido que traz o valor: no evento processado (o UPSERT, com
  `COALESCE`) e também no evento que não muda o pedido (duplicado ou transição ignorada), que só completa ou corrige o
  contato, sem mexer em status, afiliado ou `atualizado_em`. Um valor ausente nunca apaga o gravado. Os pedidos de
  antes da 0017 ficam com NULL até o próximo evento deles.
- **A trilha não muda:** o payload redigido (`webhook_eventos.payload_redigido`) continua sem nome e sem telefone, e
  os logs continuam só com ids. `CAMPOS_DESCARTADOS_NA_REDACAO` segue valendo para a trilha.
- **Só o admin vê:** `GET /api/admin/pedidos` traz `comprador: { nome, telefone }` só na sessão de admin; para a
  coordenação o campo **não vem** (nem null). A hierarquia (`/api/minha/*`) e o público não têm acesso a nenhuma
  rota que o traga. A resposta de desconsiderar/reconsiderar (só admin) também o traz. Provado em
  `src/worker/protecao.test.ts` e `src/worker/routes/compradores.test.ts`.
- **Planilha de compradores:** `GET /api/admin/pedidos/compradores[?so_pagou=true]`, **só admin** (403 para a
  coordenação, antes de ler a consulta). CSV com BOM, `;` e CRLF (abre direto no Excel em pt-BR, sem dependência
  nova), uma linha por comprador da campanha ativa, sem os desconsiderados: juntados pelo telefone; sem telefone,
  pelo nome (sem acento, maiúsculas e espaços); sem os dois, o pedido fica de fora. Colunas: Nome (o do pedido mais
  recente), Telefone legível (`(11) 98765-4321`), Célula(s), Qtd. de pedidos, Qtd. de bilhetes, Total pago (R$; só os
  aprovados), Primeira e Última compra (no fuso da campanha), Situação (Pagou / Só reservou). Proteção contra fórmula
  como o relatório (D23). A trilha registra `compradores.exportar` (quem e quando, com o filtro), **sem os dados**.
  O relatório da coordenação (D23) continua sem nome e telefone.
- **Na tela:** em Pedidos, a coluna **Comprador** (nome e telefone, com o link `https://wa.me/<numero>`) e o botão
  **Exportar compradores (Excel)** com "Só quem pagou", ambos só para o admin. Na Conferência do extrato, o cruzamento
  (`extrato/nome-do-pix.ts`) compara o `REM: <nome>` do Pix com o nome do pedido: desempata Pix que seria Ambíguo
  (Provável) e marca cada casamento com `nome: "confere" | "difere" | null`.
- **Sem limpeza automática** (pedido explícito do PO). Apagar, se um dia for preciso, é um UPDATE manual do SM.
- **Por que só o admin:** é a menor abertura que atende ao pedido (quem confere o pagamento e entra em contato é o
  admin); a coordenação continua sem dado do comprador, como antes.
- **Ver D38** (RIFA-083, 23/11): o **nome** do comprador passa a aparecer também para o discipulador, só dos compradores
  das células dele, no ranking dos maiores compradores; o telefone e o R$ continuam só do admin.

## D37. Login do discipulador com o nome e a senha padrão (RIFA-082; contrato, 2026-11-23)

Pedido do PO (23/11, no dia em que a campanha começou): "Mas eles [os discipuladores] não têm o login e senha deles?"
→ "Pode fazer". Até aqui, só a célula (D29: nome + senha padrão) e o admin (D33: usuário + senha) entravam com senha;
o discipulador, só pelo link pessoal (D12). Contrato em `src/shared/contracts/` (`login-discipulador.ts`, sem zod;
`acesso.ts`; `api.ts`), API em `src/worker/routes/acesso.ts` e `src/worker/db/login-discipulador.ts`, sem migração.

- **A mesma regra da célula, de propósito.** Senha = `"@" + nome normalizado + "1234"` (a normalização da D29:
  minúsculas, sem acentos, só `a-z` e `0-9`), digitada na mesma forma (`formaDaSenhaDigitada`). Os nomes de hoje:
  Alisson, Edgard, Elvis, Euriano, Fábio, Notte, Pr. Fábio e William → `@alisson1234` ... `@prfabio1234`,
  `@william1234`. `senhaPadraoDoDiscipulador` chama a da célula, e `normalizarNomeLogin` é a mesma função de
  `normalizarNomeCelula`, com um nome que serve aos dois. Uma regra só para a coordenação explicar e o site calcular.
- **Senha previsível, como a D29, e pelo mesmo motivo:** o que o discipulador vê é a /minha dele (D12): só números das
  células dele (ranking, metas, bilhetes, links e QR de vendas), nunca R$, nenhuma rota da coordenação, nenhuma escrita
  além da própria sessão. Quem conhece a regra e o nome de um discipulador (que aparece na Hierarquia, não no ranking
  aberto) entra como ele: o risco aceito é ver o desempenho das células dele. A senha não é gravada (nem hash) e é
  comparada em tempo constante, também sem discipulador (contra uma senha que nunca confere).
- **Reaproveita as chaves, sem coluna nem migração.** O login só abre com as DUAS ligadas: `acesso.discipuladores`
  (o papel tem acesso, D20) **e** `acesso.celulas_senha` (o login com senha padrão, D29), lidas numa subconsulta só da
  campanha ativa (`SQL_LOGIN_DISCIPULADORES_SENHA_LIGADO`; sem campanha, o padrão das duas, ligadas). Desligar qualquer
  uma recusa o login (o mesmo 401) e **derruba na hora** as sessões do discipulador abertas pela senha, do jeito da
  D29: a consulta da sessão sem link do papel `discipulador` passa a valer só com as duas chaves (+1 linha só nessa
  sessão; com link, o `CASE` nem lê a campanha). As sessões do link seguem a D20 (com o acesso desligado, 403
  `acesso_desligado` na /minha, sem apagar). Na Campanha, a chave `acesso.celulas_senha` passa a se chamar "Login com
  senha padrão (células e discipuladores)". Uma chave nova seria mais um interruptor para o admin lembrar no meio da
  campanha, e o acesso dos discipuladores já é o interruptor do papel.
- **A sessão é a do papel `discipulador`, a mesma do link (D12),** com o mesmo usuário (um por discipulador, 0006). Se o
  discipulador ainda não tem usuário (nenhum link gerado), ele nasce no login com o nome do discipulador, como no lote
  de links (o `pessoa_nome` do discipulador é o nome dele), e o nome acompanha a Hierarquia a cada login. Sem link
  (`sessoes.link_id` NULL), `__Host-sessao`, 45 dias, parada há 7 dias deixa de valer; revogar um link não a derruba,
  desativar o usuário derruba e barra o link e a senha. Tudo num `db.batch`, com as chaves e o usuário ativo conferidos
  de novo dentro do lote.
- **Rota à parte:** `POST /api/sessao/discipulador { discipulador, senha }` (corpo estrito), não um campo a mais no
  `POST /api/sessao/senha`: o contrato e os testes da célula ficam como estão, e o nome de uma célula igual ao de um
  discipulador não é ambíguo (cada um tem a sua rota). A mesma pilha das outras: mesma origem (CSRF), `LIMITE_LOGIN`
  no **mesmo contador** do link, da célula e do admin (429), teto de 4 KiB (413). Toda recusa é o **mesmo** 401
  `nao_autenticado` ("Não foi possível entrar com este discipulador e esta senha"): senha errada, nome desconhecido,
  colisão, nome sem letra nem dígito, usuário desativado, qualquer chave desligada.
- **Colisão:** dois discipuladores com o mesmo nome depois da normalização ("Fábio" e "Fabio") ficam de fora, como as
  células da D29; a Hierarquia avisa (`problemasDoLoginDosDiscipuladores`). "Fábio" e "Pr. Fábio" não colidem.
- **Trilha:** `sessao.entrar_com_senha_discipulador`, do usuário do discipulador, alvo `discipulador:<id>`, no mesmo lote
  da sessão, sem a senha. A recusa não registra. Consequência aceita, como na D29: depois de um login por senha, o
  discipulador não pode ser excluído (a trilha segura o usuário); discipulador com células já não se exclui.
- **Site:** em `/entrar`, ao lado de "Sou administrador", **"Sou discipulador"** troca o formulário para "Discipulador" e
  "Senha" (mesma acessibilidade do formulário do admin) e, em 200, vai para a /minha. Na Hierarquia (admin e
  coordenação, nunca a hierarquia), o cartão vira "Login com senha padrão" e ganha **Ver a senha de cada discipulador**,
  com Copiar e o aviso de colisão.
- **Descartado:** senha própria por discipulador (hash, troca, "esqueci"): mais tela e suporte no dia em que a campanha
  começou, sem ganho para o que ele vê; chave nova `acesso.discipuladores_senha`: o PO não pediu e as duas que existem
  bastam.

## D38. Ranking dos maiores compradores; o nome do comprador para o discipulador (RIFA-083; contrato, 2026-11-23)

Pedido do PO (23/11, no dia em que a campanha começou): "No Painel dos discipuladores e do adm coloca o ranking dos
maiores compradores." Contrato em `src/shared/contracts/` (`maiores-compradores.ts`, sem zod: a regra e os itens;
`api.ts`: schemas estritos e o catálogo à parte `ROTAS_MAIORES_COMPRADORES`), API em
`src/worker/db/maiores-compradores.ts`, `src/worker/routes/maiores-compradores.ts` (admin) e `src/worker/routes/minha.ts`
(discipulador), sem migração.

- **Uma regra só para as duas rotas** (`classificarMaioresCompradores`): conta só pedido **aprovado**, da campanha ativa,
  sem desconsideração (D20), com o dia local de `aprovado_em` dentro da janela pedida (R6, como o ranking; a janela sai
  do próprio montador dos rankings, `janelaDosRankings`, como no mapa por DDD, cortada em hoje). Janela `atual` (o
  período de hoje, "esta semana"; padrão) ou `campanha`. Junta por comprador como a D36: pelo telefone; sem telefone,
  pelo nome normalizado; sem os dois, fica de fora. O nome mostrado é o do pedido aprovado mais recente que tem nome.
  Ordem: bilhetes (desc), total pago (desc) e a primeira compra da janela (quem chegou primeiro); empate nos três
  divide a posição (1, 1, 3), e entre eles a ordem do nome em português. No máximo `limite` (1 a 50, padrão 10).
  Reservado (`in_process`) e expirado não contam: o ranking é de quem comprou, não de quem reservou.
- **Admin** (`GET /api/admin/maiores-compradores?janela=&limite=`, só o papel `admin`, como a D36; a coordenação leva 403
  antes de a consulta ser lida): posição, nome, telefone legível (como no CSV) e o número do WhatsApp, bilhetes, total
  pago (centavos), quantidade de pedidos, as células dos pedidos dele e se algum pedido é sem célula. Na tela
  **Rankings** da coordenação, abaixo do ranking, o cartão **"Maiores compradores"**, só para o admin, com a troca
  "Esta semana" / "Campanha toda", e o telefone com o link `https://wa.me/<numero>` (como a coluna Comprador de
  Pedidos). Ficou nos Rankings, e não na Visão geral, porque é um ranking e a Visão geral é da coordenação inteira.
- **Discipulador** (`GET /api/minha/maiores-compradores?janela=&limite=`, só o papel `discipulador`; líder e rede levam
  403, a coordenação também; com `acesso.discipuladores` desligado, o 403 `acesso_desligado` da D20, como todo
  `/api/minha/*`): só os pedidos dos afiliados das **células do discipulador da sessão** (o alvo vem só da sessão, D12;
  nenhum id na consulta). Cada item: posição, **nome**, bilhetes e a célula (a dele com mais bilhetes do comprador;
  empate, a primeira em português). **Sem telefone e sem R$** (D12): o schema da resposta é estrito e não tem esses
  campos (um campo a mais vira 500). Na /minha, o cartão **"Maiores compradores"** depois de "Suas células", com a
  mesma troca de janela, acompanhando a atualização de cada minuto da visão. Sem compra: "Ainda não há compras nesta
  semana."
- **Privacidade: o nome do comprador para o discipulador** (muda em parte a D36, que deixava nome e telefone só para o
  admin). Por quê: a página pública da Rifei já mostra o nome de quem comprou cada número
  (`show_numbers_buyer_name`), então o nome não é segredo; e o discipulador vê só os compradores das células dele. O
  **telefone continua só do admin**, e o R$ continua fora de toda a /minha (D12). A coordenação continua sem dado do
  comprador (o cartão nem aparece para ela). A trilha não muda: o payload redigido do webhook continua sem nome e sem
  telefone, e a leitura do ranking não vai para a trilha (não exporta nada; a planilha da D36 continua registrando).
- **Sem cache e sem trilha da leitura:** as duas rotas leem o D1 a cada requisição (a campanha e os pedidos aprovados
  da janela, pelo índice `(status, aprovado_em)`: ~3 linhas lidas por pedido da janela) e respondem com
  `Cache-Control: no-store` (trazem nomes; são por pessoa). Os discipuladores são poucos (8) e o admin, um.
- **Catálogo à parte** (`ROTAS_MAIORES_COMPRADORES`), como `ROTAS_LINK_VENDAS`: `ROTAS` continua com só a visão em
  `/api/minha`, e o `src/worker/protecao.test.ts` põe o catálogo nas listas dele (o 403 da coordenação na rota do
  admin; a do discipulador fora do filtro da coordenação, com o 403 de líder e rede e o 401 sem sessão).
- **Descartado:** abrir para o líder e a rede (fora do pedido: o PO falou do discipulador e do admin); o telefone para
  o discipulador (o PO não pediu e o contato continua com quem confere o pagamento, D36); contar o reservado (inflaria
  quem reservou e não pagou).

**Adendo (RIFA-089, 2026-11-23): o nome de quem comprou também para o líder da célula.** Pedido do PO: "No painel do
líder mostra quem comprou a rifa dele e o horário? Se não, pode colocar essa informação." Até aqui a /minha do líder
não mostrava compradores (o discipulador via só o ranking dos maiores compradores, acima).

- **Rota** `GET /api/minha/compradores?limite=1..50&antes_de=<cursor>` (`ROTAS_QUEM_COMPROU`, contrato em `api.ts`;
  `src/worker/db/quem-comprou.ts` e `src/worker/routes/minha.ts`), **só o papel do líder** (o discipulador, a rede e a
  coordenação levam 403 `proibido`; com o acesso da célula desligado, o 403 da D20 como todo `/api/minha/*`). Só a
  própria célula: o alvo vem só da sessão (D12); um `celula_id` na consulta é descartado.
- **O que mostra:** as vendas **pagas** (aprovadas) da campanha ativa que contam (sem os desconsiderados, D20) da
  célula, pela célula **efetiva** (D41: as do link da célula e as atribuídas à mão a ela), da mais recente para a mais
  antiga (`aprovado_em`, empate pelo id): o nome do comprador (null quando a Rifei não mandou; o site mostra "Comprador
  sem nome"), o instante (o site mostra "23/11 às 14:03" no fuso da campanha, que vem na resposta) e os bilhetes.
  **Sem telefone, sem os números dos bilhetes e sem R$** (D12: a /minha não mostra dinheiro); o schema da resposta é
  estrito. A reserva não paga fica fora (a lista é de quem comprou).
- **Privacidade:** a mesma razão do discipulador (acima): o nome já é público na página da Rifei, e o líder vê só os
  compradores da própria célula. O telefone continua só do admin (D36).
- **Paginação e custo** (D10): 20 por página com o cursor `(aprovado_em, id)` ("Ver mais"); lida do D1 a cada
  requisição, sem cache, `Cache-Control: no-store`. A página é um MULTI-INDEX OR (os afiliados da célula e os
  atribuídos), com os `+` que tiram do planejador os índices da campanha e de status: o custo acompanha as vendas da
  célula, não a campanha. Na tela, a primeira página acompanha a atualização da visão (a cada minuto) enquanto o líder
  não pediu "Ver mais".
- **Descartado:** abrir para o discipulador e a rede (fora do pedido: eles já têm os maiores compradores, ou nada) e
  mostrar o valor pago (a /minha não mostra R$).

## D39. Grupo do discipulador e ranking por grupo, só na coordenação (RIFA-084; contrato, 2026-11-23)

Pedido do PO (23/11, com a campanha em andamento): "Faz o seguinte: unifica. E embaixo crie uma nova visualização:
separar adultos da manhã, adultos da noite, jovens e adolescentes." O ranking principal já estava unificado
(`ranking.por_divisao = false`, D27). Na mesma tarde o PO decidiu que a visualização por grupo é **só do painel da
coordenação**: o ranking aberto fica exatamente como está. O PO diz qual discipulador é de qual grupo (os dados não
existiam no sistema).

- **O grupo é do discipulador, não a divisão da rede.** A `divisao` (D27) só tem `jovens` e `adultos`, é da rede (a
  igreja tem uma rede só) e muda o ranking, o painel, o mapa e o relatório; reaproveitá-la para quatro valores mexeria
  em tudo isso e na planilha. O grupo é outro recorte, só de um ranking a mais: tabela `grupos` (migração 0018; `nome`
  único de 1 a 60 caracteres e `ordem`, semeada com os 4 grupos do pedido) e `discipuladores.grupo_id` (NULL = sem
  grupo; `ON DELETE SET NULL`). As **células herdam** o grupo do discipulador: o PO separa os grupos pelos
  discipuladores, e assim a coordenação escolhe 8 vezes, e não 38. Sem CRUD dos grupos por enquanto (os 4 vêm da
  migração); um nome novo ou um 5º grupo é uma migração ou uma tarefa nova.
- **Quem define:** a coordenação (admin e coordenação), na Hierarquia (o seletor "Grupo" do Editar discipulador e a
  coluna "Grupo"). O `PUT /api/admin/discipuladores/:id` aceita `grupo_id` (id ou null); **ausente mantém o gravado**
  (a exceção ao "PUT substitui tudo", como os grupos do admin na Campanha, D20): uma aba antiga do site, aberta antes da
  publicação, que só renomeia o discipulador, não apaga o grupo. No POST, ausente = sem grupo. Grupo que não existe: 400
  `referencia_invalida`. A trilha registra `grupo_id` como os outros ids (o antes e o depois; sem dado pessoal); na
  criação e na remoção, só quando há grupo (o resumo de quem não tem fica como antes). A importação da planilha não mexe
  no grupo.
- **O ranking por grupo** (`GET /api/painel/ranking-grupos?janela=atual|campanha&nivel=celula|discipulador`, grupo
  `coordenacao`): o **mesmo critério, a mesma janela e as mesmas metas** do ranking de todas (a meta de cada célula não
  muda: a proporcional reparte o total entre todas as células), com a posição e os vizinhos **dentro do grupo**
  (`montarRankingGruposPainel` em `calculos.ts`, sobre a mesma base do `montarRankingPainel`). O item é o da
  coordenação, completo. Só os grupos com células, na ordem de `ordem`; nenhum, `grupos: []`, e a tela não mostra a
  seção. A rede não é nível aqui (o grupo é do discipulador). Os grupos vão no mesmo lote da leitura do cálculo
  (`comandosExtras`): nenhuma ida a mais ao D1; o comando lê só os discipuladores com grupo, pelo índice novo.
  `no-store`, sem cache, e a resposta passa pelo schema estrito antes de sair.
- **Na tela Rankings**, embaixo do ranking de todas (na mesma aba e na mesma janela), a seção "Ranking por grupo", com
  um bloco por grupo e a tabela de sempre (no celular, os cartões). Na aba Redes, a seção some. Discipulador sem grupo
  fica fora dela e continua no ranking de todas.
- **Descartado:** a rota aberta `/api/publico/ranking-grupos` e a seção no ranking aberto (estavam no primeiro pedido;
  o PO tirou: só a coordenação); usar a `divisao` (acima); grupo por célula (o PO separa pelos discipuladores; se uma
  célula precisar de grupo próprio, vira uma coluna na célula que vence a do discipulador); mexer no telão e na
  `/minha` (fora do pedido).
- **Segurança:** a rota nova fica atrás do login da coordenação (401 sem sessão, 403 para líder, discipulador e rede;
  `src/worker/protecao.test.ts`, parte l), como `GET /api/admin/grupos`; nenhuma rota aberta nova.

**Adendo (RIFA-085, 2026-11-23): o grupo próprio da célula.** O PO informou que algumas células do discipulador William
(grupo Jovens) são de Adolescentes (Teens, Amados Para Amar, Maranata, Escolhidos e Betel). Era o caso previsto em
"Descartado" acima: a célula ganha uma coluna própria que vence a do discipulador.

- **Dado:** `celulas.grupo_id` (migração 0019, `REFERENCES grupos(id) ON DELETE SET NULL`, índice `celulas_por_grupo`).
  NULL = herda o grupo do discipulador (todas as células que existiam ficam assim: nada muda até a coordenação escolher).
  **Grupo efetivo** da célula = o próprio, se houver; senão, o do discipulador; senão, sem grupo.
- **API:** `POST` e `PUT /api/admin/celulas` aceitam `grupo_id` com as mesmas regras do discipulador: id ou `null`
  (herda); no POST, ausente = herda; no **PUT, ausente mantém o gravado** (uma aba antiga do site, aberta antes da
  publicação, não apaga o grupo ao editar a célula); grupo que não existe = 400 `referencia_invalida` no campo
  `grupo_id`. A resposta da célula (lista, GET, POST e PUT) traz `grupo_id` e `grupo_nome` (o próprio) e
  `grupo_efetivo_id` e `grupo_efetivo_nome` (lidos na hora, por `LEFT JOIN`: mudar o grupo do discipulador muda o
  efetivo das células que herdam, e não o das que têm grupo próprio). A trilha registra `grupo_id` como os outros ids
  (só ids; na criação e na remoção, só quando há grupo próprio). A importação da planilha não mexe no grupo (nem no
  INSERT nem no UPDATE).
- **Ranking por grupo:** no nível **célula**, vale o grupo efetivo de cada célula (cada célula num grupo só; um grupo
  sem discipulador, só com células de grupo próprio, também aparece). No nível **discipulador**, nada muda: cada
  discipulador fica só no grupo dele, com **todas** as células dele (inclusive as de grupo próprio), e o total dele é o
  mesmo do ranking de todas. Descartado: pôr o discipulador em mais de um grupo (um por grupo das células dele) ou
  tirar dele as células de grupo próprio, porque o total e a posição dele deixariam de bater com o ranking de todas, e
  a coordenação lê o ranking dos discipuladores como "o resultado do discipulador". O comando dos grupos continua no
  mesmo lote do cálculo (`UNION ALL` das duas leituras): nenhuma ida a mais ao D1.
- **Hierarquia (site):** no Editar célula, o seletor "Grupo" com "Igual ao do discipulador (<grupo dele>)" (o rótulo
  segue o discipulador escolhido no formulário; sem grupo, "sem grupo") e os 4 grupos; na tabela das células, a coluna
  "Grupo" mostra o efetivo, com a marca discreta "(da célula)" quando é o próprio.
- **Segurança:** nenhuma rota nova; o PUT e o POST da célula continuam só da coordenação (`src/worker/protecao.test.ts`,
  parte m: 401 sem sessão, 403 para líder, discipulador e rede, e nada muda).

## D40. Relatório diário por e-mail e saldo da Efí, só do admin (RIFA-086, 2026-11-23)

Pedido do PO (23/11): "um relatório diário por e-mail para o pastor (e para mim), simples e limpo, com os dados da
campanha", no modelo que ele aprovou (uma coluna, 560 px); e "o saldo da conta Efí no relatório e no painel do admin".
Contrato em `src/shared/contracts/relatorio-diario.ts` (constantes, sem zod) e `api.ts` (`ROTAS_RELATORIO_DIARIO`,
`ROTAS_SALDO_EFI` e os schemas); Worker em `src/worker/lib/relatorio-diario.ts` (os números e o e-mail, puro),
`lib/email.ts` (MIME), `lib/relatorio-diario-envio.ts` (leitura e envio), `lib/efi.ts` (saldo), `agendado.ts` (o cron)
e `routes/relatorio-diario.ts` e `routes/efi.ts`; site no cartão `pages/visao-geral/SaldoEfi.tsx`. Sem migração.

- **E-mail pela própria Cloudflare** (binding `send_email`, nome `EMAIL`, pelo Email Routing do domínio
  `projetokidsbelem.com.br`): o mesmo Worker manda, sem conta nova, sem chave de API de terceiros e sem dependência
  nova. O MIME é montado à mão em `lib/email.ts` (multipart/alternative com texto puro e HTML, UTF-8 em base64, assunto
  em encoded-words do RFC 2047, linhas de até 78 caracteres, `Date`, `Message-ID` e `Auto-Submitted`) e vai em
  `new EmailMessage(de, para, mime)` de `cloudflare:email`. Remetente `relatorio@projetokidsbelem.com.br` ("Projeto
  Videira Kids"). Descartados: Resend, SendGrid e afins (conta, chave e DPA novos para dois e-mails por dia); o
  `mimetext` (dependência para o que cabe em ~100 linhas testadas); o envio "estruturado" do binding (`send({ from,
  to, subject, html, text })`, do Email Service novo da Cloudflare): fica como alternativa se o MIME der problema.
- **Destinatários só em segredo** (`RELATORIO_EMAILS`, separados por vírgula; até 10): o repositório é público, então
  nenhum e-mail entra no código, no `wrangler.jsonc` (nem como `allowed_destination_addresses` do binding: o Email
  Routing já só entrega para os destinos verificados da conta), nos testes (só `example.com` e `exemplo.com.br`) ou nos
  logs (que levam só contagens). Um e-mail por destinatário: ninguém vê o endereço do outro, e a falha de um não para
  os outros. Endereço fora do formato simples (com nome, espaço, quebra de linha) é ignorado: não injeta cabeçalho.
- **Ontem como dia de referência.** Cron `0 10 * * *` (10:00 UTC = 07:00 em Belém, `triggers.crons` no
  `wrangler.jsonc`, travado em `config-publicacao.test.ts`): o e-mail sai de manhã com o dia anterior FECHADO (até
  23:59:59.999 de Belém), e não com um dia pela metade. Antes do início da campanha (no 1º dia, ontem é a véspera) e
  depois do fim, não sai; na manhã seguinte ao último dia, sai o último (o resultado final). O "agora" do cron é o
  horário agendado (um disparo atrasado manda o mesmo dia).
- **Os números são os do painel**, dos mesmos montadores (`montarResumoPainel` e `montarRankingPainel` com `data` =
  ontem; `montarRankingGruposPainel` com o último milissegundo de ontem como "agora"), numa leitura só
  (`lerEntradaDoCalculo` com os grupos no mesmo lote: duas idas ao D1 por e-mail, uma vez por dia). Na ordem do modelo:
  arrecadado e bilhetes da campanha (com os sem célula); a barra e o % do alvo; o dia (vendido e a meta do dia, a mesma
  "meta de hoje" do painel naquele dia); o período (vendido de meta e %); as 5 primeiras células do ranking da campanha
  inteira, pelo critério configurado, **só as que já venderam**; o 1º de cada grupo no nível célula, na janela da
  campanha (empate: todos, até 3 e "e mais N"; sem venda: "ainda sem vendas"; sem grupo nenhum, a seção some); os
  discipuladores com venda, na ordem do ranking, e "Sem venda ainda: ..." em ordem alfabética; e a caixa "Atenção"
  (células sem venda, bilhetes sem célula quando há, e o saldo da Efí ou "indisponível"). Percentuais com uma casa,
  **truncados** como no site (R11: nunca "100%" antes da meta; o modelo mostrava 3,1% e 8,1% arredondados). R$ e
  milhar por texto, sem ponto flutuante (D2). O rótulo do dia é "No dia" (o modelo dizia "Hoje", mas o e-mail é de
  ontem).
- **Nada pessoal.** Só números agregados e os nomes de células, discipuladores e grupos (que a coordenação já vê): nem
  o nome e o telefone do comprador (D36), nem o contato do líder. Todo nome é escapado no HTML. Testado com contatos
  gravados no banco.
- **Prévia e envio pelo admin** (`GET /api/admin/relatorio-diario/previa?data=` e `POST .../enviar { data? }`, só o
  papel admin): para ver o e-mail no navegador e mandar de novo sem esperar o cron. A prévia devolve o HTML com uma CSP
  própria (`CSP_PREVIA_EMAIL` em `middleware/cabecalhos-seguranca.ts`): `default-src 'none'; style-src
  'unsafe-inline'; ...`, mais fechada que a de sempre em tudo (nenhum script, fetch, fonte ou formulário) e que só
  libera o estilo inline do e-mail; é a única CSP que uma rota pode pôr (qualquer outra é trocada pela de sempre,
  testado). O envio responde 503 `nao_configurado` sem o binding ou sem destinatário (antes de ler o banco) e registra
  `relatorio_diario.enviar` na trilha (o dia e as contagens, nunca os e-mails). O envio do cron não tem usuário (a
  trilha exige um): fica no log do Worker.
- **Saldo da Efí, só do admin.** `GET /v2/gn/saldo` da API Pix (escopo `gn.balance.read`), com o token OAuth
  (`POST /oauth/token`, Basic do client_id e client_secret). A Efí exige o certificado do cliente (mTLS) em toda
  chamada: as duas vão pelo binding `mtls_certificates` `EFI_CERT` (`env.EFI_CERT.fetch`), com os segredos
  `EFI_CLIENT_ID` e `EFI_CLIENT_SECRET`. O token fica na memória do isolate até `expires_in` menos 60 s; a resposta do
  saldo (o valor ou a falha) vale 60 s, então a tela e o e-mail vão à Efí no máximo uma vez por minuto por servidor.
  Tempo curto (5 s) por chamada; a falha vira `erro` (`autenticacao`, `consulta`, `tempo_esgotado`,
  `resposta_invalida`) e "indisponível" no e-mail, nunca 5xx; o log leva só o passo, o código e o status (nem segredo,
  nem token, nem o corpo da Efí). `GET /api/admin/efi/saldo` responde `{ configurado, saldo_centavos, consultado_em,
  erro? }`. Por que só o admin: o saldo é o dinheiro da conta, e quem cuida dele é o admin (como o comprador na D36); a
  coordenação não vê o cartão nem a rota (403), a hierarquia muito menos. O pastor vê o saldo pelo e-mail.
- **Bindings opcionais, ligados depois pelo SM** (`docs/lancamento.md` 3.8): o código trata a falta de cada um. Sem
  `EMAIL`, o cron só avisa no log; sem `EFI_CERT` ou sem os segredos, o saldo fica "não configurado" no painel e
  "indisponível" no e-mail. Por isso o `wrangler.jsonc` desta tarefa tem só o cron (`config-publicacao.test.ts` trava
  que `send_email` e `mtls_certificates` ainda não estão lá e que o arquivo não tem nenhum endereço de e-mail).
- **O Worker exporta o app com o `scheduled`** (`Object.assign(app, { scheduled })` no `index.ts`): o Hono continua
  sendo o objeto exportado, e os testes que usam `app.request` e `app.routes` não mudam.

**Suposições** (simples e reversíveis):

1. Ontem como referência, envio às 07:00 de Belém, e nada antes do início nem depois da manhã seguinte ao último dia.
2. "Células que mais avançaram" e "Por grupo · quem lidera" na janela da campanha inteira (até ontem), não na semana.
3. Percentuais truncados, como o site (o modelo arredondava).
4. Sem idempotência do cron: um disparo repetido da Cloudflare (raro) manda o e-mail de novo.
5. O e-mail sai em nome de `relatorio@projetokidsbelem.com.br`; o domínio precisa do Email Routing ligado.

**Perguntas ao PO:**

1. A janela de "Células que mais avançaram" e de "quem lidera" por grupo: a campanha inteira (assumido) ou a semana?
2. O domínio `projetokidsbelem.com.br` já recebe e-mail em outro provedor? Ligar o Email Routing da Cloudflare troca os
   registros MX do domínio (o e-mail que chega passaria a ser roteado pela Cloudflare).
3. A conta Efí está aberta e aprovada? Em 16/11 o lançamento saiu sem ela (Pix manual): o saldo só aparece com uma
   aplicação da Efí com o escopo de consulta de saldo e um certificado para o Worker.

### Adendo (RIFA-087, 2026-11-23): sai o saldo da Efí; dois e-mails por dia e o "Arrecadado" do banco

Pedido do PO (23/11, campanha em andamento): "Pode tirar o saldo então. Programe para duas vezes ao dia enviar o
relatório. Você consegue fazer o cálculo de quanto entrou pela API da Rifei?" e, no mesmo dia, o segundo envio às 17h
de Belém (e não às 19h).

- **Por que o saldo saiu.** A consulta não funciona e não vai funcionar daqui: o host `pix.api.efipay.com.br` fica atrás
  da Cloudflare, e o certificado de cliente dos Workers (`mtls_certificates`) não vale para uma zona proxiada pela
  própria Cloudflare (a chamada sai sem o certificado e a Efí recusa); o firewall da Efí também bloqueia a sessão de
  nuvem e os runners do GitHub, então não há de onde consultar. O PO decidiu tirar. Saíram `lib/efi.ts`,
  `GET /api/admin/efi/saldo` (e `routes/efi.ts`), o cartão "Saldo na Efí", a linha do saldo no e-mail, os schemas e as
  constantes da Efí no contrato, os segredos `EFI_CERT`, `EFI_CLIENT_ID` e `EFI_CLIENT_SECRET` do `worker-env.d.ts` e o
  bloco `mtls_certificates` do `wrangler.jsonc` (`config-publicacao.test.ts` trava que ele não volta). O SM apaga o
  certificado mTLS e os segredos `EFI_*` na Cloudflare (`docs/lancamento.md` 3.8). Nada da Efí é chamado.
- **"Quanto entrou" vem do banco**, sem chamada nova à Rifei: a soma dos pedidos pagos que a Rifei manda pelo webhook
  (D2, D32), com a mesma regra do total da campanha do painel (aprovados, sem os desconsiderados, dentro das datas da
  campanha, com os sem célula). É o valor ANTES da tarifa da Efí (o que de fato caiu na conta é menos). No e-mail, o
  número grande continua sendo esse total, agora com "arrecadados · N bilhetes pagos"; a linha do dia ganha o valor
  ("No dia: 61 bilhetes · R$ 1.440,00 (meta 227)"), a mesma fonte filtrada pelo dia (`totaisDoDia` em
  `lib/arrecadado.ts`). Na Visão geral, o cartão do admin virou **"Arrecadado"** (mesma posição, só o admin): o total
  pago, os bilhetes pagos e o valor de hoje, pela rota nova `GET /api/admin/arrecadado` (só admin; o resumo do painel
  não serve: depende do recorte e não traz o R$ do dia), com a legenda "Soma dos bilhetes pagos recebidos da Rifei,
  antes da tarifa da Efí." e atualizando junto com o painel.
- **Dois envios por dia** (`CRONS_RELATORIO_DIARIO` no contrato, os dois no `triggers.crons`; o `scheduled` escolhe pelo
  `controller.cron` e outro cron só avisa no log):
  - **manhã**, `0 10 * * *` (07:00 de Belém): o dia anterior fechado, como antes ("resumo de segunda, 23/11");
  - **tarde**, `0 20 * * *` (17:00 de Belém): o DIA DE HOJE até a hora do envio, parcial. Assunto "Projeto Videira
    Kids · parcial de segunda, 23/11 (até 17h)", subtítulo "Parcial de segunda, 23/11, até 17h · dia 1 de 21" e "Hoje
    até 17h" no lugar de "No dia"; o resto igual. A hora sai do "agora" (o horário agendado do disparo, no fuso da
    campanha): no cron é sempre 17h; num envio do admin às 15:42, "até 15h42".
  - Fora da campanha não sai (manhã: ontem fora; tarde: hoje fora). Rodapé "Enviado todo dia às 7h e às 17h".
- **Prévia e envio do admin com `tipo`** (`manha` | `tarde`, padrão `manha`; `data` continua opcional): na tarde, o
  padrão é hoje e só hoje vale (400 `parcial_so_de_hoje`: os números de um dia passado não têm hora de corte, então
  não dá para mostrar a parcial das 17h dele). A resposta do envio e a trilha levam o tipo ("Relatório da tarde de
  2026-12-01 enviado: ...").
- **Correção da revisão da RIFA-086:** uma data absurda na prévia (ex.: `?data=0001-01-01`) quebrava o fuso dos
  montadores antes da checagem da campanha e virava 500. A checagem agora vem antes do cálculo, só com aritmética de
  calendário (`referenciaDaCampanha`), e responde 400 `fora_da_campanha` para qualquer data que exista.

**Suposições:** a parcial é só de hoje (400 em outro dia); a hora do assunto sai do instante do envio (no cron, 17h); o
"Arrecadado" acompanha a atualização automática do painel (uma leitura a mais por minuto, só para o admin); sem
idempotência entre os dois crons (cada um manda o seu).

## D41. Célula atribuída à mão a uma venda sem célula (RIFA-088, 2026-11-23)

Pedido do PO (23/11, com a campanha em andamento): um comprador da célula Bunker comprou pelo link geral da rifa (sem
afiliado), e a venda não contava para nenhuma célula; ele quer colocar essa venda na Bunker. Até aqui a célula de uma
venda vinha só do afiliado (`pedidos.affiliate_id` → `afiliados.celula_id`, D7). Contrato em `src/shared/contracts/`
(`api.ts`: `ORIGENS_CELULA_PEDIDO`, `celula_origem` no `itemPedidoSchema`, `corpoAtribuirCelulaPedidoSchema`,
`parametroPedidoIdSchema` e a rota em `ROTAS_REGRAS_CAMPANHA`; `erros.ts`: `pedido_ja_tem_celula`; a ação
`pedido.atribuir_celula` da trilha), migração `0020_celula_atribuida.sql`, API em `src/worker/db/celula-atribuida.ts`
e `src/worker/routes/pedidos.ts`, a regra em `src/worker/db/celula-efetiva.ts`, tela em `src/web/pages/pedidos/`.

- **Atribuição manual, e não trocar o `affiliate_id`.** O `affiliate_id` é dado da Rifei: o webhook o grava e o
  reescreve a cada evento que o traz (afiliado tardio, D7), e um afiliado é de uma pessoa, não de uma venda; inventar
  um afiliado ou mexer no do pedido confundiria a conferência pelo CSV (D19), a adesão e os totais do afiliado. A
  atribuição fica em colunas nossas do pedido (`celula_atribuida_id`, `_em`, `_por`; nulas juntas), como a
  desconsideração (D20): o UPSERT do webhook não as lista, então nenhum evento da Rifei as apaga (testado).
- **Célula efetiva** = a do afiliado do pedido, se houver; senão, a atribuída; senão, sem célula. **A do afiliado
  vence**: a API só aceita atribuir quando o pedido não tem célula pelo afiliado (sem afiliado, ou afiliado não
  vinculado), senão 409 `pedido_ja_tem_celula`; se o afiliado ganhar célula depois (vínculo na Adesão ou afiliado
  tardio), vale a dele, e a atribuída fica gravada sem contar (desfazer continua valendo). Assim um vínculo feito pela
  coordenação nunca briga com uma escolha à mão, e a venda volta a ter uma regra só.
- **Em todo lugar que liga venda a célula** vale a efetiva, num lugar só: os trechos de SQL de `db/celula-efetiva.ts`
  (`coalesce(a.celula_id, p.celula_atribuida_id)`, a origem e o "sem célula pelo afiliado") e a view `vendas_aprovadas`,
  recriada na 0020. Passaram a usá-la: a leitura do painel (`db/painel.ts`: resumo e "sem célula", metas e percentuais,
  ranking unificado e por divisão, por grupo, por discipulador e rede, ranking público, bumbo e telão, /minha do líder,
  do discipulador e da rede, o ranking geral da /minha (RIFA-090), relatório por e-mail, CSV da coordenação e
  "Arrecadado", que saem dela), a lista de
  pedidos (item, filtros `celula_id` e `sem_celula`, totais), a leitura do item na desconsideração (e o resumo da trilha
  dela), os pedidos suspeitos, os bilhetes por número, a planilha de compradores, os maiores compradores (admin e
  discipulador), o mapa por DDD com divisão e a adesão (pela view). **Ficou como estava** a conferência pelo CSV (D19 e
  D26): ela compara o relatório da Rifei, em que essa venda aparece sem afiliado, e mostra a célula do afiliado.
- **Desempenho** (D10): o índice de cobertura do painel foi recriado na 0020 com `celula_atribuida_id` logo depois de
  `affiliate_id`, para o painel agrupar por afiliado, célula atribuída e dia na ordem do índice (o mesmo plano, 1 linha
  lida por pedido; `db/painel.test.ts` e o bloco da 0020 em `migrations.test.ts`). O filtro por célula da lista de
  pedidos virou um MULTI-INDEX OR (os pedidos dos afiliados da célula pelo índice por afiliado e os atribuídos pelo
  índice parcial novo, `pedidos_por_celula_atribuida`): +1 linha lida por pedido da célula (o afiliado de cada pedido
  vem pelo JOIN da célula efetiva), ~4 por pedido em vez de ~3 (`db/pedidos-webhook-desempenho.test.ts`). O mapa com
  divisão confere a atribuída na linha que já lê.
- **Só o admin** (`PUT /api/admin/pedidos/:id/celula`, `ROTAS_REGRAS_CAMPANHA`, 403 da coordenação e da hierarquia
  antes de ler o corpo, CSRF como toda escrita): é uma correção de dado de venda, como desconsiderar. A coordenação vê
  a célula efetiva na lista, com o sinal "atribuída à mão", sem o botão. Não depende de chave na campanha. O id do pedido
  vai na URL (decisão do SM; o site o codifica com `encodeURIComponent`), diferente do desconsiderar (D20), que o leva
  no corpo. Qualquer status da campanha ativa: a reserva atribuída passa a contar quando for paga.
- **Trilha** `pedido.atribuir_celula`, no mesmo lote da gravação e com a mesma condição (D20, OBRIGATÓRIO 2): alvo
  `pedido:<id>` e o resumo com o id do pedido e as células de antes e de depois, só ids; nada do comprador. Repetir (a
  mesma célula, ou desfazer o que não existe) não registra.
- **Hierarquia:** a célula com venda atribuída não é excluída (FK RESTRICT); o 409 `em_uso` diz para remover a
  atribuição na tela Pedidos.
- **Descartado:** trocar o `affiliate_id` do pedido (acima); atribuir também o pedido que já tem célula pelo afiliado
  (duas regras brigando; o caminho certo é trocar o vínculo do afiliado na Adesão, que leva todas as vendas dele);
  uma view com a célula efetiva para todas as consultas (as consultas otimizadas não usam view: o SQLite não elimina os
  LEFT JOIN da hierarquia numa consulta agregada, D10).

**Suposições:** desfazer vale mesmo quando o afiliado já tem célula (a atribuída não contava); o pedido desconsiderado
também pode ser atribuído (não conta de qualquer jeito); a tela troca o item e não recalcula os totais da lista (eles
seguem os filtros e mudam ao recarregar); na já atribuída, o botão diz "Trocar a célula".
