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
  chaves é quem muda a Campanha hoje (admin e coordenação): pergunta ao PO.
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
   da 0007); desconsiderar e reconsiderar leem menos de 10 linhas; remover afiliado lê os pedidos dele (índice por
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
  [modelo-de-dados.md, seção 10](modelo-de-dados.md#10-plano-da-migração-0009_token_webhooksql-rifa-039-d21)) com o
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
  Antes da primeira publicação, ou com uma publicação só, termina com erro: não há versão anterior.
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
