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
