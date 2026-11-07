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
- **Limite do corpo antes de ler** (`src/worker/middleware/limite-corpo.ts`, com o leitor do webhook): 4 KiB no
  `POST /api/sessao` e 1 MiB nos POST/PUT/PATCH da coordenação, depois do login (sem sessão, o corpo nem é lido);
  acima, 413 `corpo_muito_grande`. As importações de CSV têm o teto delas na própria rota: a da hierarquia
  (3 × o limite de caracteres + 1 MB, respondendo como arquivo grande) e a conferência da RIFA-012, sob
  `/api/admin/reconciliacao/*`, que lê o corpo bruto com o teto dela (1 MiB, o corpo compacto: D13).
- **Sessão parada há mais de 7 dias** deixa de valer, mesmo dentro dos 45 dias (`ultimo_uso_em`, já gravado no
  máximo uma vez por minuto). O link pessoal continua abrindo uma sessão nova; a administração não conta a sessão
  parada como ativa, e cada login a apaga.
- **Limite de requisições por IP** com o binding de Rate Limiting do Workers (`ratelimits` no `wrangler.jsonc`;
  funciona no workerd local e nos testes): 10 por minuto no `POST /api/sessao` (toda tentativa) e 60 por minuto
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
  ações do admin sobre usuários e links. O CRUD da hierarquia não entra. Leitura: `GET /api/admin/auditoria`, só
  admin, com cursor. Quem pode fazer o quê não mudou.

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
  pode voltar num usuário novo, e a trilha `usuario:<id>` passaria a apontar para outra pessoa. A exclusão em
  cascata também não aparece na trilha: a RIFA-018 (auditoria do CRUD da hierarquia) registra a remoção do alvo
  junto com o acesso dele.
- **Limite de login por IP sobe de 10 para 60 por minuto**: na reunião dos líderes, dezenas de pessoas abrem o link
  ao mesmo tempo atrás do mesmo IP. O token tem 256 bits, então o limite nunca foi o que impede adivinhar link:
  ele só protege CPU e banco.

## D13. Conferência pelo CSV: o arquivo é lido no navegador (RIFA-012, ciclo 2, 2026-11-07)

- Ler o CSV no Worker gastava de 50 a 375 ms de CPU por requisição (1 a 7 mil pedidos; 95% em datas, com um
  `Intl.DateTimeFormat` por célula), e o plano Workers Free dá 10 ms (erro 1102). Decisão do SM: o navegador lê
  o arquivo, detecta e mapeia as colunas (`src/shared/conferencia/`, sem zod) e manda à API só as colunas
  mapeadas que não são de dado pessoal, já normalizadas, numa lista por campo, com as linhas iguais juntadas
  (`vezes`): o corpo compacto de `src/shared/contracts/conferencia.ts`, conferido por um validador leve (laços
  simples, sem zod item a item). Ganho extra: nome, e-mail e telefone nem saem do navegador.
- O Worker não usa o Intl por linha; o banco devolve só os pedidos com os códigos do arquivo (um texto JSON por
  lote, tuplas curtas) e os ausentes e totais já somados. Medido no workerd com 7 mil pedidos: ~7–8 ms em
  `/analisar` e ~6–8 ms em `/recuperar` (`src/worker/routes/reconciliacao-desempenho.test.ts`).
- O corpo vai até 1 MiB (`LIMITE_CORPO_CONFERENCIA_BYTES`, ~15 mil pedidos); a rota lê o corpo uma vez só, de
  uma vez quando há `Content-Length` (o teto geral leria em pedaços de 4 KB: ~2,5 ms a mais para 420 KB), por
  isso continua fora do teto geral, com o mesmo número.
- Regra do valor de um pedido em várias linhas e trava do código que não bate: integracao-rifei.md, seção 10.
- O "Recuperar" muda os números da campanha, então entra na trilha de auditoria da D11 (decisão do SM): ação
  `conferencia.recuperar`, alvo `campanha:<id>`, no mesmo `db.batch` da gravação e só quando algum pedido entra;
  o resumo traz o id da recuperação e quantos pedidos e bilhetes entraram (nada do arquivo).
