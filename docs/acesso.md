# Acesso da equipe por link pessoal (RIFA-007, RIFA-014)

A coordenação (Fábio, Felipe, pastor, gestor do bumbo) entra pelo celular, a partir de uma mensagem de WhatsApp, **sem senha**: cada pessoa recebe um link secreto. Ao abrir o link e confirmar, ela ganha uma sessão por cookie. Links e sessões podem ser revogados.

Desde a RIFA-014 (docs/decisions.md, D12), os líderes de célula, os discipuladores e os responsáveis pelas redes entram do mesmo jeito, cada um preso ao próprio alvo (a célula, o discipulador ou a rede), e veem só a visão individual (`GET /api/minha/visao`). Os links deles saem em lote pela administração (seção 9).

- Contrato: `src/shared/contracts/acesso.ts` (schemas e catálogos `ROTAS_ACESSO` e `ROTAS_ACESSO_HIERARQUIA`).
- Banco: `migrations/0002_acessos.sql` e `migrations/0006_acesso_hierarquia.sql`. Código: `src/worker/routes/acesso.ts`, `src/worker/routes/admin-usuarios.ts`, `src/worker/routes/acessos-hierarquia.ts`, `src/worker/middleware/sessao.ts`, `src/worker/middleware/cabecalhos-seguranca.ts`, `src/worker/db/acessos.ts`, `src/worker/db/acessos-hierarquia.ts`, `src/worker/lib/links-acesso.ts`, `src/worker/lib/cripto.ts`. Cabeçalhos do site: `public/_headers`.
- Primeiro acesso: `scripts/criar-acesso.mjs` (`npm run acesso:criar`), só para a coordenação.

## 1. Como funciona

1. Um **admin** cadastra a pessoa (`POST /api/admin/usuarios`) e recebe, **uma única vez**, o link `https://<site>/acesso/<token>`. Ele manda o link no WhatsApp da pessoa.
2. A pessoa abre o link. A página `/acesso/:token` do site mostra uma confirmação ("Entrar como coordenação"). O preview de link do WhatsApp também abre a URL, mas não clica no botão: **só o POST cria a sessão**.
3. O botão faz `POST /api/sessao { token }`. A API confere o link e responde com o cookie `__Host-sessao` e o usuário. A sessão vale até o menor entre 45 dias e o fim do link que a abriu.
4. O site pergunta `GET /api/sessao` para saber quem está conectado. Para a coordenação, as rotas `/api/admin/*` e `/api/painel/*` passam a responder; para o líder, o discipulador e a rede, só `/api/minha/*` (seção 9).
5. O link continua valendo por 45 dias (o bastante para a campanha inteira: vendas de 23/11 a meados de dezembro): serve para entrar de novo (outro aparelho, cookie apagado). O admin pode gerar um link novo, revogar um link ou desativar a pessoa.

## 2. Papéis

| Papel | Alvo | Acesso |
|---|---|---|
| `admin` | nenhum | tudo de `coordenacao` e também usuários e links (`/api/admin/usuarios`, `/api/admin/links`), os acessos da hierarquia (`/api/admin/acessos-hierarquia`, RIFA-014), a trilha de auditoria (`GET /api/admin/auditoria`, RIFA-013b), as ações das regras da campanha (desconsiderar e reconsiderar pedido e remover afiliado, `ROTAS_REGRAS_CAMPANHA`, D20) e o token do webhook da Rifei (`/api/admin/webhook/token`, `ROTAS_TOKEN_WEBHOOK`, D21) |
| `coordenacao` | nenhum | `/api/admin/*` e `/api/painel/*` (campanha, hierarquia, vínculos, painel), menos usuários, links, acessos da hierarquia, trilha, as ações das regras da campanha e o token do webhook (as entregas e o estado do webhook, sim) |
| `lider` | a célula | só `/api/minha/*` (a visão individual da célula); 403 em `/api/admin/*` e `/api/painel/*` |
| `discipulador` | o discipulador | só `/api/minha/*` (o discipulador e as células dele); 403 na coordenação. Com `acesso.discipuladores` desligado na campanha (D20): 403 `acesso_desligado` no `POST /api/sessao` e em todo `/api/minha/*` |
| `rede` | a rede | só `/api/minha/*` (a rede, os discipuladores e as células dela); 403 na coordenação. Com `acesso.redes` desligado na campanha (D20): 403 `acesso_desligado` no `POST /api/sessao` e em todo `/api/minha/*` |

O alvo de cada papel da hierarquia fica numa coluna própria de `usuarios` (seção 7) e vem **só da sessão**: nenhuma rota de `/api/minha` aceita id, então ninguém pede o alvo de outro. `GET /api/sessao` e `POST /api/sessao` devolvem o alvo (`{ tipo, id, nome, divisao }`, lido da hierarquia na hora) nesses papéis; na coordenação, o campo não vem.

## 3. Rotas

Erros no formato único (`docs/api.md`, seção "Erros").

| Rota | Quem | Sucesso | Erros |
|---|---|---|---|
| `POST /api/sessao` `{ token }` | aberto (mesma origem) | **200** `{ usuario: { id, nome, papel, alvo? } }` + `Set-Cookie` (`alvo` só nos papéis da hierarquia) | 401 `nao_autenticado` (link inexistente, fora do formato, expirado, revogado ou de usuário inativo); 400 `requisicao_invalida` (sem `token`); 400 `json_invalido`; 403 `proibido` (outra origem); 413 `corpo_muito_grande` (corpo acima de 4 KiB, recusado antes de ler o JSON); 429 `muitas_requisicoes` (mais de 60 tentativas por minuto do mesmo IP, com `Retry-After`); 403 `acesso_desligado` (link válido de discipulador ou rede com o acesso do papel desligado na campanha, D20: a sessão não é criada) |
| `GET /api/sessao` | sessão de qualquer papel | **200** `{ usuario }` (com `alvo` nos papéis da hierarquia) | 401 |
| `POST /api/sessao/sair` | aberto (mesma origem) | **204**, apaga a sessão e expira o cookie (também sem sessão) | 403 (outra origem) |
| `POST /api/admin/usuarios` `{ nome, email?, papel }` | admin | **201** `{ usuario, link }`: `link.url` só aparece aqui. Só papéis da coordenação | 400 (inclusive papel da hierarquia), 401, 403 |
| `GET /api/admin/usuarios` | admin | **200** `{ itens: [usuario] }`: só a coordenação (a hierarquia tem a lista própria, seção 9), sem token, URL ou hash | 401, 403 |
| `PATCH /api/admin/usuarios/:id` `{ ativo }` | admin | **200** usuário, de qualquer papel (com `alvo` nos da hierarquia) | 400 (outro campo além de `ativo`), 401, 403, 404, 409 `em_uso` (desativar a si mesmo ou o último admin ativo) |
| `POST /api/admin/usuarios/:id/links` | admin | **201** `{ link }`, com `link.url`, para um usuário de qualquer papel | 400, 401, 403, 404, 409 `acao_desligada` (discipulador ou rede com o acesso desligado na campanha, D20; depois do 404 do usuário) |
| `DELETE /api/admin/links/:id` | admin | **204** (de novo: 204, mantém a data da primeira revogação), link de qualquer papel | 400, 401, 403, 404, 409 `em_uso` (nenhum admin ativo ficaria com link válido) |
| `GET /api/admin/acessos-hierarquia?papel=` | admin | **200** `{ itens }`: todos os alvos do papel, com o usuário de cada um (seção 9) | 400, 401, 403 |
| `POST /api/admin/acessos-hierarquia/links` `{ papel, ids, revogar_anteriores? }` | admin | **201** `{ itens }`: um link novo por alvo, com a URL (seção 9) | 400, 401, 403, 404 e 409 (com `detalhes.ids`); 409 `acao_desligada` (papel com o acesso desligado na campanha, D20) |
| `GET /api/admin/webhook/token` | admin | **200** o estado do token do webhook da Rifei: qual credencial vale (`tela`, `segredo` ou nenhuma), desde quando, o último uso e a URL para a Rifei; **nunca o token** ([api.md](api.md#token-do-webhook-da-rifei-rifa-039-docsdecisionsmd-d21)) | 401, 403 |
| `POST /api/admin/webhook/token` `{ substituir? }` | admin | **201** `{ token, estado }`: o token aparece só aqui, uma vez (no banco, só o SHA-256). Gerar de novo invalida o anterior na hora | 400, 401, 403, 409 `em_uso` (já há credencial vigente e o corpo não traz `substituir: true`; `detalhes.vigente`) |
| `GET /api/minha/visao` | `lider`, `discipulador`, `rede` | **200** a visão individual do alvo da sessão ([api.md](api.md#visão-individual-e-acessos-da-hierarquia-sprint-5-rifa-014-docsdecisionsmd-d12)) | 400 (`periodo` fora do schema), 401, 403 (coordenação), 403 `acesso_desligado` (discipulador ou rede com o acesso do papel desligado na campanha, D20; em todo `/api/minha/*`), 404 (sem campanha) |

Usuário na administração (`usuarioSchema`):

```json
{
  "id": 3, "nome": "Coordenadora Ficticia", "email": null, "papel": "coordenacao", "ativo": true,
  "criado_em": "2026-11-06T18:00:00.000Z", "sessoes_ativas": 1,
  "links": [
    { "id": 7, "criado_em": "2026-11-06T18:00:00.000Z", "expira_em": "2026-12-21T18:00:00.000Z",
      "revogado_em": null, "ultimo_uso_em": "2026-11-06T18:05:12.345Z", "situacao": "valido" }
  ]
}
```

- `situacao`: `valido`, `expirado` ou `revogado`. `links` vem do mais novo para o mais antigo.
- Na criação, `link` traz também `"url": "https://<site>/acesso/<token>"`. A origem da URL é a da requisição do admin.
- **Desativar** (`ativo: false`) apaga todas as sessões da pessoa e os links param de abrir sessão. **Reativar** não traz as sessões de volta; os links ainda dentro da validade voltam a funcionar.
- **Ninguém desativa o próprio acesso**, e o **último admin ativo** não pode ser desativado: 409 `em_uso`, nada muda. A condição fica no próprio `UPDATE`, então dois admins desativando um ao outro ao mesmo tempo não deixam a equipe sem admin. Não há troca de papel na API (o `PATCH` só aceita `ativo`), então também não há como rebaixar o último admin.
- **Revogar** um link apaga as sessões abertas **por ele**. As sessões abertas por outros links da mesma pessoa continuam.
- **O último link válido de admin não é revogado**: se, depois da revogação, nenhum admin ativo ficaria com um link válido (não revogado e no prazo), a resposta é 409 `em_uso` e nada muda (o link e as sessões dele continuam). Gere antes um link novo para um admin. A condição fica no próprio `UPDATE`, como na desativação: duas revogações ao mesmo tempo dos dois últimos links não passam juntas. Links de coordenação e links já vencidos não entram na conta.
- **Link novo** não revoga os anteriores (revogue explicitamente, se for o caso).

## 4. Segurança

- **Segredos**: o token do link e o id da sessão têm 32 bytes de `crypto.getRandomValues` (256 bits), em base64url sem `=` (43 caracteres). No banco fica só o **SHA-256 em hex**, e a busca é sempre pelo hash. Quem copiar o banco não consegue montar um link nem um cookie. Um `CHECK` nas colunas `token_hash` e `id_hash` recusa qualquer valor que não seja um hash (64 hex minúsculos).
- **Cookie**: `__Host-sessao=<id>; Max-Age=<segundos até a sessão vencer>; Path=/; HttpOnly; Secure; SameSite=Lax`, sem `Domain` (nome em `NOME_COOKIE_SESSAO`, no contrato).
  - `__Host-`: o navegador só aceita esse nome com `Secure`, `Path=/` e sem `Domain`, gravado pelo próprio host. Outro Worker do mesmo domínio-pai (ex.: `*.madruga.workers.dev`) não consegue gravar um cookie com esse nome por cima do nosso. Um cookie `sessao` (sem o prefixo) é ignorado.
  - `HttpOnly`: o JavaScript da página não lê o cookie.
  - `Secure`: só vai por https. No dev, `http://localhost` conta como seguro: conferido no Chrome com o Vite (`npm run dev`), que gravou o `__Host-sessao` e mandou de volta. Pelo IP da rede local (ex.: celular em `http://192.168.x.x:5173`), o navegador recusa o cookie.
  - `SameSite=Lax`: não acompanha POSTs vindos de outro site.
  - `Max-Age` = o que falta para a sessão vencer no banco (arredondado para baixo).
  - O site não lê o cookie: pergunta a `GET /api/sessao`.
- **CSRF**: toda escrita (POST, PUT, PATCH, DELETE) em `/api/sessao*`, `/api/admin/*` e `/api/painel/*` só é aceita com `Origin` igual à origem da requisição, ou com `Sec-Fetch-Site: same-origin`. Sem nenhum dos dois, a resposta é 403. Os navegadores mandam esses cabeçalhos sozinhos. Fora do navegador (curl), mande `-H "Origin: https://<site>"`. A origem é conferida antes da sessão.
- **Cache**: as respostas autenticadas e as de sessão saem com `Cache-Control: no-store`.
- **Cabeçalhos de segurança**: `Referrer-Policy: no-referrer`, `X-Content-Type-Options: nosniff`, `X-Frame-Options: DENY` e `Content-Security-Policy: default-src 'self'; img-src 'self' data:; object-src 'none'; base-uri 'none'; form-action 'self'; frame-ancestors 'none'`.
  - A CSP (RIFA-013) só deixa carregar script, estilo, fonte e `fetch` da própria origem, sem inline e sem `eval`: um script injetado não roda, mesmo se um XSS aparecer. Imagens também em `data:` (a seta do `<select>` é um SVG em `data:` no CSS). Sem plugins (`object-src`), sem `<base>` e formulários só para a origem. Tela nova não pode usar `<style>` ou `<script>` inline, `eval`, nem nada de outro host (a regra 4 do `docs/frontend.md` já proíbe CDN e fonte externa); `style={...}` do React pode (vai pelo CSSOM). Conferido com `npm run preview` no Chrome em todas as telas, inclusive entrar pelo link, criar acesso, copiar o link e salvar a campanha. No formulário da campanha, o zod testa uma vez se pode usar `Function("")` e o Chrome registra no console uma violação de `script-src` (`eval`): é esperado e inofensivo (o zod segue sem esse atalho). No `npm run dev` o `_headers` não vale para o HTML.
  - No site, vêm do `public/_headers`: o Vite copia para `dist/client`, e o Workers Static Assets aplica nas páginas (inclusive no fallback de SPA, como `/acesso/<token>`) e não serve o arquivo. Conferido com `npm run preview`.
  - Na API, vêm do middleware `cabecalhosSeguranca`, porque o `_headers` não vale para respostas do Worker. Um teste confere que as duas listas são iguais.
  - `no-referrer` também impede que a URL `/acesso/<token>` vá para outro site no `Referer`.
- **Sessão**: vale até o **menor** entre login + 45 dias e o `expira_em` do link que a abriu. Nenhuma sessão dura mais que o link: um link criado há 40 dias dá sessões de no máximo 5 dias. Não renova sozinha. Entrar de novo no mesmo navegador encerra a sessão anterior dele. A cada login, as sessões vencidas e as paradas são apagadas. O `ultimo_uso_em` é regravado no máximo uma vez por minuto.
- **Sessão parada** (RIFA-013b): sem uso há **mais de 7 dias** (`INATIVIDADE_MAXIMA_SESSAO_DIAS`, em `src/worker/db/acessos.ts`), a sessão deixa de valer, mesmo dentro dos 45 dias: um cookie esquecido num aparelho emprestado não vale semanas. Exatamente 7 dias ainda vale; como o `ultimo_uso_em` é regravado no máximo uma vez por minuto, o prazo real pode ser até um minuto menor. O link pessoal continua abrindo uma sessão nova, e a administração não conta a sessão parada em `sessoes_ativas`.
- **Cookie inválido** (sessão inexistente, vencida, parada ou de usuário desativado): 401, e a resposta expira o cookie.
- **Tentativas de login** (RIFA-013b; 60 desde a D12, eram 10): no máximo 60 por minuto por IP (binding de Rate Limiting do Workers; `src/worker/lib/limite-requisicoes.ts`), contadas depois da checagem de origem; acima, 429 `muitas_requisicoes`. Com 256 bits, adivinhar um token nunca dependeu do limite: ele barra o abuso (cada tentativa lê o D1) e deixa passar a reunião dos líderes, em que dezenas de pessoas abrem o link ao mesmo tempo atrás do mesmo IP. O corpo do `POST /api/sessao` passa de 4 KiB? 413, sem ler o resto.
- **Token do webhook da Rifei** (RIFA-039, D21): é um segredo como o token do link (256 bits, só o SHA-256 no banco, mostrado uma vez), mas não abre sessão: só autentica o `POST /api/webhooks/rifei`. Gerado pelo admin na tela, colado direto na Rifei. Com ele, o segredo do Worker `RIFEI_WEBHOOK_TOKEN` deixa de valer (o da tela tem prioridade). Hex de 64 caracteres, não base64url como o link: só letras e números, para o formulário da Rifei.
- **Trilha de auditoria** (RIFA-013b): criar pessoa, gerar link, desativar, reativar e revogar ficam registrados com quem fez (`GET /api/admin/auditoria`, só admin), no mesmo lote da ação e sem o nome nem o e-mail da pessoa no resumo. O que não muda nada não registra (RIFA-018): reativar quem está ativo, desativar quem está desativado e revogar um link já revogado respondem como sempre (200 e 204), sem linha na trilha.

### O que o site (front) deve fazer

- Rota `/acesso/:token`: mostrar a confirmação e só no clique fazer `POST /api/sessao` com `{ token }`. Em 200, ir para a área do papel (`usuario.papel` da resposta): `/coordenacao` para admin e coordenação, `/minha` para líder, discipulador e rede (a resposta já traz o `alvo` destes, que a `/minha` mostra enquanto a visão carrega). Em 401, mostrar "Este link não vale mais: peça um link novo à coordenação" (o mesmo texto da tela, `src/web/pages/acesso/AcessoPage.tsx`).
- Antes do POST, tirar o token da barra de endereço e do histórico (`history.replaceState(null, "", "/acesso")`) e não mandar a URL com o token para logs ou analytics.
  - O `replaceState` limpa o histórico da aba (voltar/avançar), mas o histórico geral do navegador continua com a visita a `/acesso/<token>` (conferido no Chromium). Isso vem do token no endereço e o site não consegue apagar: num aparelho compartilhado ou emprestado, revogue o link e gere outro.
- Rota `/entrar` (sem sessão, depois de um 401): explicar que a entrada é pelo link pessoal recebido no WhatsApp.
- Chamadas com `fetch` normal, na mesma origem: o cookie vai sozinho. Tratar 401 (sem sessão: ir para `/entrar`) e 403 (sem permissão).
- `FORMATO_TOKEN_ACESSO` (contrato) permite avisar cedo que um link chegou cortado.

## 5. Primeiro acesso (bootstrap)

A API só cria usuários para um admin conectado. O primeiro admin sai do script, que grava direto no D1:

```bash
# D1 local (npm run dev): aplique as migrações antes
npm run db:migrate:local
npm run acesso:criar -- --nome "Fulano de Tal" --papel admin

# D1 de produção (precisa de npx wrangler login e das migrações remotas)
npm run db:migrate:remote
npm run acesso:criar -- --nome "Fulano de Tal" --papel admin --remote --origem https://<endereço do site>
```

Saída:

```text
Acesso criado no D1 local: Fulano de Tal (admin), usuário 1.

  http://localhost:5173/acesso/<token>

O link vale até 2026-12-21T16:44:08.737Z (UTC) e pode ser aberto mais de uma vez nesse prazo.
Ele não será mostrado de novo. Mande só para a própria pessoa: quem tiver o link entra como ela.
```

- `--origem`: endereço do site que vai no link. Sem `--remote`, o padrão é `http://localhost:5173` (o `npm run dev`). Com `--remote`, é obrigatória e precisa ser https.
- O script gera o token e grava o usuário e o **hash** com `wrangler d1 execute DB --local|--remote --json --command "<SQL>"`. Ele usa o wrangler do projeto (o mesmo do `npx wrangler`) e roda sem shell. Depois, confere a gravação com um `SELECT` antes de imprimir o link.
- O nome aceita letras (com acento), números, espaço, ponto, hífen e apóstrofo, até 120 caracteres, e começa por letra. Qualquer outro caractere é recusado antes de montar o SQL. Os apóstrofos são dobrados no SQL (`D'Arc` vira `'D''Arc'`).
- `--remote`, `--local` e `--help` não aceitam valor: `--remote=false` é erro, e não liga o D1 remoto. Opção desconhecida (inclusive `--senha=x` ou `--Remote`), valor solto (`--remote false`) e `--local` com `--remote` também são erro.
- Códigos de saída: 0 (ok), 1 (o D1 não gravou: migrações não aplicadas, wrangler sem login...), 2 (uso errado).
- **Em produção** ([lancamento.md, 3.1](lancamento.md#31-primeiro-admin-sm-depois-thiago)): o SM roda o comando com `--remote` da sessão dele e manda o link ao primeiro admin, que entra, gera um link novo para si, entra pelo novo e só então revoga o primeiro (o link passou pelo chat). O PO não precisa de Node.

## 6. Montagem no app (`src/worker/index.ts`)

O Hono roda middlewares e rotas na ordem em que foram registrados. Um middleware registrado depois de uma rota não protege essa rota (conferido). Por isso a ordem é:

1. `cabecalhosSeguranca` em primeiro lugar, logo depois de `new Hono()`: vale para toda resposta, inclusive 401, 403, 404 e 500;
2. as rotas de sessão, abertas;
3. `exigirSessao(["admin", "coordenacao"])` em `/api/admin/*` e `/api/painel/*`, **antes** de qualquer rota desses prefixos (hierarquia, campanha, painel...), e logo depois dele o teto do corpo das escritas (`limitarCorpoDaCoordenacao`, RIFA-013b): sem sessão, o corpo nem é lido; e `exigirSessao(["lider", "discipulador", "rede"])` em `/api/minha/*` (RIFA-014), antes da rota da visão: sem sessão, 401 em todo caminho do prefixo, exista a rota ou não; coordenação, 403. Os papéis vão escritos no `index.ts` de propósito: um papel novo não ganha acesso sozinho;
4. as rotas de usuários e links, os acessos da hierarquia e a trilha de auditoria (só admin; os sub-apps também exigem). O token do webhook (RIFA-039, D21) é só admin no handler de cada rota, nunca num `use` de `/api/admin/webhook/*`, onde as entregas e o estado são da coordenação;
5. as demais rotas, inclusive a visão individual (`/api/minha`), que também exige os papéis da hierarquia no próprio sub-app.

```ts
import { cabecalhosSeguranca } from "./middleware/cabecalhos-seguranca";
import { exigirSessao } from "./middleware/sessao";
import { sessao } from "./routes/acesso";
import { acessosHierarquia } from "./routes/acessos-hierarquia";
import { adminUsuarios } from "./routes/admin-usuarios";

const app = new Hono<{ Bindings: Cloudflare.Env }>();
app.use("*", cabecalhosSeguranca); // 1º: todas as respostas da API

app.route("/api/health", health);
// Acesso da equipe (RIFA-007): antes das demais rotas /api/admin/* e /api/painel/*.
app.route("/api/sessao", sessao);
app.use("/api/admin/*", exigirSessao(["admin", "coordenacao"]));
app.use("/api/painel/*", exigirSessao(["admin", "coordenacao"]));
app.use("/api/minha/*", exigirSessao(["lider", "discipulador", "rede"])); // RIFA-014
app.route("/api/admin", adminUsuarios); // /usuarios e /links: só admin (o sub-app também exige)
app.route("/api/admin", acessosHierarquia); // /acessos-hierarquia: só admin (o sub-app também exige)
// Depois: webhook (/api/webhooks/*), hierarquia, campanha, painel, público, /api/minha... e o notFound/onError.
```

- `exigirSessao` pode ser empilhado: a sessão é lida uma vez por requisição e o handler recebe `c.var.usuario` (tipado com `AmbienteSessao`). Nos papéis da hierarquia, `c.var.usuario.alvo` é o alvo, com o id do banco.
- `adminUsuarios` exige admin nos próprios caminhos (`/usuarios/*`, `/links/*`), e `acessosHierarquia` em `/acessos-hierarquia` e `/acessos-hierarquia/*`, mesmo se o middleware geral faltar.
- Testes de rotas da coordenação no app real: `cabecalhosDeSessao("coordenacao")` (em `src/worker/test/acesso-teste.ts`) cria uma sessão no D1 dos testes e devolve `{ Cookie, Origin }`. Para os papéis da hierarquia, `cabecalhosDeSessaoDaHierarquia("lider", celulaId)` (o alvo precisa existir) cria o acesso pelo mesmo código do lote.

## 7. Banco (`migrations/0002_acessos.sql` e `0006_acesso_hierarquia.sql`)

| Tabela | Colunas | Regras |
|---|---|---|
| `usuarios` | `id`, `nome`, `email` (nulo), `ativo`, `criado_em`, `celula_id`, `discipulador_id` e `rede_id` (nulos; 0006) e `papel` | `papel` ∈ {`admin`, `coordenacao`, `lider`, `discipulador`, `rede`}, com o alvo certo para o papel (o CHECK do papel; a coordenação sem alvo) e papel nunca nulo (dois gatilhos); no máximo um usuário por alvo (índices únicos parciais); a coordenação não é apagada, só desativada; o usuário da hierarquia cai junto com o alvo (`ON DELETE CASCADE`) |
| `links_acesso` | `id`, `usuario_id`, `token_hash` (UNIQUE), `criado_em`, `expira_em`, `revogado_em` (nulo), `ultimo_uso_em` (nulo) | `token_hash` = SHA-256 hex do token |
| `sessoes` | `id_hash` (PK), `usuario_id`, `link_id`, `criado_em`, `expira_em`, `ultimo_uso_em` | `id_hash` = SHA-256 hex do id da sessão; `link_id` = link que abriu a sessão |

Instantes em UTC no formato de `0001_init.sql`. Links e sessões caem junto se um usuário for apagado (`ON DELETE CASCADE`). A trilha de auditoria (0005) segura o usuário que fez alguma ação (`ON DELETE RESTRICT`). Detalhes das colunas novas, dos gatilhos e de como a 0006 foi feita sem recriar a tabela em [modelo-de-dados.md](modelo-de-dados.md#usuarios-links_acesso-e-sessoes-acesso-da-equipe).

## 8. Testes

| Arquivo | Cobre |
|---|---|
| `src/worker/routes/acesso.test.ts` | link → sessão → cookie `__Host-sessao` com as flags e sem `Domain`; cookie sem o prefixo ignorado; sessão limitada ao fim do link (Max-Age, relógio adiantado, link antigo); `GET /api/sessao`; links expirado, revogado, de usuário inativo, inexistente ou cortado (401); reuso do link; saída |
| `src/worker/middleware/cabecalhos-seguranca.test.ts` | os 4 cabeçalhos em 200, 404, 500, Response montada à mão, 401, 403 e no login (com Set-Cookie); a CSP sem inline, sem `eval` e sem outro host; `public/_headers` com a mesma lista |
| `src/worker/middleware/sessao.test.ts` | 401 sem sessão e com sessão expirada; 403 por papel; 403 em POST/PUT/PATCH/DELETE de outra origem; `c.var.usuario` |
| `src/worker/routes/admin-usuarios.test.ts` | só admin administra; o link só na criação; link novo; revogar; o último link válido de admin não é revogado (409); desativar e reativar; ninguém desativa a si mesmo e sobra sempre um admin (inclusive com dois admins desativando um ao outro ao mesmo tempo) |
| `src/worker/db/acessos.test.ts` | varredura de todas as tabelas atrás de tokens e ids de sessão; busca pelo hash; `CHECK` de formato; o último admin ativo não é desativado; `revogarLink` com duas revogações ao mesmo tempo |
| `src/worker/test/criar-acesso.test.ts` | o script cria um admin no D1 e o link impresso abre sessão; `--remote`; nomes perigosos recusados; flags com valor (`--remote=false`), opções desconhecidas e `--local` com `--remote` recusados |
| `src/worker/lib/cripto.test.ts` | formato dos segredos, SHA-256 e equivalência com o script |
| `src/shared/contracts/acesso.test.ts` | catálogo, papéis e ausência de segredos nas respostas |
| `src/worker/routes/sessao-ociosa.test.ts` | RIFA-013b: sessão parada há exatamente 7 dias vale e há 7 dias e 1 ms não (401, cookie expirado); o link abre outra; uso a cada 6 dias mantém; a validade de 45 dias continua; a administração não conta a parada e o login a apaga |
| `src/worker/middleware/limite-corpo.test.ts` | RIFA-013b: 4 KiB no login e 1 MiB na coordenação, antes de ler (pelo `Content-Length` e em partes, com a leitura cortada no limite); bordas exatas; sem sessão, o corpo nem é lido; as importações de CSV com o teto delas |
| `src/worker/lib/limite-requisicoes.test.ts` e `src/worker/routes/limite-requisicoes.test.ts` | RIFA-013b: chave pelo IP (IPv6 pelo /64); 60 logins de verdade do mesmo IP passam e o 61º dá 429 (D12); outra origem não conta; a 61ª ida ao banco das rotas abertas dá 429 sem ler o banco, e o cache não conta; a janela na memória quando o binding falta |
| `src/worker/routes/auditoria.test.ts` | RIFA-013b: cada ação registrada com quem fez, alvo e resumo sem dados pessoais; ação recusada não registra; a listagem só para admin, com cursor. RIFA-018: ação sem mudança não registra; a revogação do último link válido de admin, recusada dentro do lote, dá 409 e não registra |
| `src/worker/routes/auditoria-hierarquia.test.ts` e `src/worker/db/hierarquia-auditoria.test.ts` | RIFA-018: o CRUD da hierarquia registra uma linha por ação, com o antes e o depois e sem dado pessoal; recusada (400, 404, 409, inclusive pelo banco dentro do lote) ou sem mudança, nada; a remoção do alvo diz o acesso que caiu junto; outra gravação entre a leitura e o lote: refaz, e o resumo segue certo |
| `src/worker/routes/acessos-hierarquia.test.ts` e `src/worker/db/acessos-hierarquia.test.ts` | RIFA-014: a lista de todos os alvos do papel, na ordem da hierarquia; um link por alvo, na ordem de `ids`; tudo ou nada (404 e 409 com os ids); `revogar_anteriores` derruba as sessões antigas; só admin; uma linha na trilha, sem nomes; a URL só na resposta; outra gravação no meio do lote; desativar, link avulso e revogar valem para a hierarquia |
| `src/worker/routes/acesso.test.ts` (RIFA-014) e `src/worker/routes/hierarquia-remocao.test.ts` | o alvo na sessão, lido na hora; apagar o alvo apaga o acesso (usuário, links e sessões); a recusa por chave estrangeira diz o motivo certo |
| `src/worker/protecao.test.ts` (seção g) | RIFA-014: os papéis da hierarquia levam 403 em toda rota de `/api/admin` e `/api/painel`; todo caminho de `/api/minha` dá 401 sem sessão e 403 para a coordenação |

## 9. Papéis da hierarquia: links em lote e troca de líder (RIFA-014, D12)

**Quem é quem.** O líder (`lider`) fica preso à célula, o discipulador (`discipulador`) ao discipulador e quem responde pela rede (`rede`) à rede, pela coluna do papel em `usuarios` (seção 7). Cada alvo tem no máximo um usuário. O usuário da hierarquia nasce **só** pelos links em lote, que o prendem ao alvo: `POST /api/admin/usuarios` só cria pessoas da coordenação (papel da hierarquia ali dá 400).

**A lista** (`GET /api/admin/acessos-hierarquia?papel=lider|discipulador|rede`, só admin) traz **todos** os alvos do papel, com ou sem acesso, pelo caminho na hierarquia (nome da rede, do discipulador e da célula, em ordem de português: "Célula Ágape" antes de "Célula Betel", "Célula 2" antes de "Célula 10"; empate, pelo id). Cada item: o alvo (`tipo`, `id`, `nome`, `divisao`); `pessoa_nome`, quem deve receber o link, lido da hierarquia na hora (o `lider_nome` da célula, o nome do discipulador ou o `responsavel_nome` da rede, que pode faltar); `telefone`, só do líder (o `lider_telefone`, para abrir o WhatsApp); e `usuario`, o usuário do alvo (nome, ativo, sessões abertas e links, sem token, URL nem hash) ou null.

**O lote** (`POST /api/admin/acessos-hierarquia/links { papel, ids, revogar_anteriores? }`, só admin) gera um link **novo** por alvo, na ordem de `ids` (no máximo 200, sem repetição), e devolve a URL de cada um, a única vez em que ela aparece:

- alvo sem usuário: cria o usuário, com o papel do pedido, preso ao alvo e com o nome de quem recebe o link (sem `pessoa_nome`, o nome do alvo);
- alvo com usuário: o mesmo usuário, com o nome atualizado para o `pessoa_nome` atual (o líder pode ter mudado). Sem `revogar_anteriores`, os links anteriores continuam valendo (como num link avulso);
- tudo ou nada, num `db.batch` só: 404 `nao_encontrado` se algum id não é alvo do papel e 409 `em_uso` se algum alvo tem o usuário desativado (reative antes com o `PATCH`), os dois com `detalhes: { "ids": [...] }` em ordem crescente e nada gravado. Se outra gravação muda os alvos no meio (o alvo some, ganha um usuário ou é desativado), a restrição do banco desfaz o lote e a conferência é refeita uma vez;
- uma linha na trilha de auditoria por chamada, no mesmo lote: ação `acessos_hierarquia.gerar_links`, alvo `papel:<papel>` e um resumo sem nomes nem telefones (quantos alvos, quantos acessos criados, se os anteriores foram revogados e os ids, se couberem).

**Troca de líder.** Quando a pessoa do alvo muda (ex.: um novo líder na célula): atualize a hierarquia (o `lider_nome`) e gere o link do alvo com `revogar_anteriores: true`. No mesmo lote, os links ainda válidos do alvo são revogados e as sessões abertas por eles são encerradas (o aparelho do líder antigo sai), o usuário passa a ter o nome novo e o link novo vai para o líder novo. Para tirar o acesso sem dar outro, use o `PATCH { "ativo": false }` (encerra as sessões) ou revogue os links (`DELETE /api/admin/links/:id`).

**Apagar o alvo.** Excluir a célula, o discipulador ou a rede (quando a hierarquia deixa: célula sem afiliados, discipulador sem células, rede sem discipuladores) apaga em cascata o usuário do alvo, com os links e as sessões: o link para de entrar e a sessão aberta cai (401). Se a exclusão é recusada por chave estrangeira, a mensagem diz o motivo conferido no banco: os dependentes da hierarquia ou, sem eles, a trilha de auditoria (que segura o usuário que aparece como autor de uma ação; os papéis da hierarquia não escrevem, então isso só acontece com um registro feito à mão). A exclusão fica na trilha de auditoria (RIFA-018, ação `hierarquia.remover`), com o nome do alvo e o id do usuário do acesso que caiu junto (ex.: `Célula "Célula Ágape" removida (discipulador_id 3, qtd_pessoas 12); acesso do líder removido junto, usuário 15 (com os links e as sessões)`), sem o nome da pessoa. Cuidado (D12): os ids de `usuarios` não são AUTOINCREMENT, então o id de um usuário apagado com o alvo pode voltar num usuário novo; as linhas antigas com `usuario:<id>` falam de quem tinha o id antes, e é a linha da remoção que diz até quando (e de qual alvo) ele era.

**Sessão e visão.** O link abre a sessão como o da coordenação (`POST /api/sessao`, cookie `__Host-sessao`, 45 dias no máximo, parada há 7 dias deixa de valer). `GET /api/sessao` devolve o alvo, e o site leva cada papel para a sua área: a coordenação para `/coordenacao`; líder, discipulador e rede para `/minha`, que lê `GET /api/minha/visao` ([api.md](api.md#visão-individual-e-acessos-da-hierarquia-sprint-5-rifa-014-docsdecisionsmd-d12)).
