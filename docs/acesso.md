# Acesso da equipe por link pessoal (RIFA-007)

A coordenação (Fábio, Felipe, pastor, gestor do bumbo) entra pelo celular, a partir de uma mensagem de WhatsApp, **sem senha**: cada pessoa recebe um link secreto. Ao abrir o link e confirmar, ela ganha uma sessão por cookie. Links e sessões podem ser revogados.

- Contrato: `src/shared/contracts/acesso.ts` (schemas e catálogo `ROTAS_ACESSO`).
- Banco: `migrations/0002_acessos.sql`. Código: `src/worker/routes/acesso.ts`, `src/worker/routes/admin-usuarios.ts`, `src/worker/middleware/sessao.ts`, `src/worker/db/acessos.ts`, `src/worker/lib/cripto.ts`.
- Primeiro acesso: `scripts/criar-acesso.mjs` (`npm run acesso:criar`).

## 1. Como funciona

1. Um **admin** cadastra a pessoa (`POST /api/admin/usuarios`) e recebe, **uma única vez**, o link `https://<site>/acesso/<token>`. Ele manda o link no WhatsApp da pessoa.
2. A pessoa abre o link. A página `/acesso/:token` do site mostra uma confirmação ("Entrar como coordenação"). O preview de link do WhatsApp também abre a URL, mas não clica no botão: **só o POST cria a sessão**.
3. O botão faz `POST /api/sessao { token }`. A API confere o link e responde com o cookie `sessao` (30 dias) e o usuário.
4. O site pergunta `GET /api/sessao` para saber quem está conectado. As rotas `/api/admin/*` e `/api/painel/*` passam a responder.
5. O link continua valendo por 30 dias: serve para entrar de novo (outro aparelho, cookie apagado). O admin pode gerar um link novo, revogar um link ou desativar a pessoa.

## 2. Papéis

| Papel | Acesso |
|---|---|
| `admin` | tudo de `coordenacao` e também usuários e links (`/api/admin/usuarios`, `/api/admin/links`) |
| `coordenacao` | `/api/admin/*` e `/api/painel/*` (campanha, hierarquia, vínculos, painel), menos usuários e links |

## 3. Rotas

Erros no formato único (`docs/api.md`, seção "Erros").

| Rota | Quem | Sucesso | Erros |
|---|---|---|---|
| `POST /api/sessao` `{ token }` | aberto (mesma origem) | **200** `{ usuario: { id, nome, papel } }` + `Set-Cookie` | 401 `nao_autenticado` (link inexistente, fora do formato, expirado, revogado ou de usuário inativo); 400 `requisicao_invalida` (sem `token`); 400 `json_invalido`; 403 `proibido` (outra origem) |
| `GET /api/sessao` | sessão de qualquer papel | **200** `{ usuario }` | 401 |
| `POST /api/sessao/sair` | aberto (mesma origem) | **204**, apaga a sessão e expira o cookie (também sem sessão) | 403 (outra origem) |
| `POST /api/admin/usuarios` `{ nome, email?, papel }` | admin | **201** `{ usuario, link }`: `link.url` só aparece aqui | 400, 401, 403 |
| `GET /api/admin/usuarios` | admin | **200** `{ itens: [usuario] }`, sem token, URL ou hash | 401, 403 |
| `PATCH /api/admin/usuarios/:id` `{ ativo }` | admin | **200** usuário | 400 (outro campo além de `ativo`), 401, 403, 404 |
| `POST /api/admin/usuarios/:id/links` | admin | **201** `{ link }`, com `link.url` | 400, 401, 403, 404 |
| `DELETE /api/admin/links/:id` | admin | **204** (de novo: 204, mantém a data da primeira revogação) | 400, 401, 403, 404 |

Usuário na administração (`usuarioSchema`):

```json
{
  "id": 3, "nome": "Coordenadora Ficticia", "email": null, "papel": "coordenacao", "ativo": true,
  "criado_em": "2026-11-06T18:00:00.000Z", "sessoes_ativas": 1,
  "links": [
    { "id": 7, "criado_em": "2026-11-06T18:00:00.000Z", "expira_em": "2026-12-06T18:00:00.000Z",
      "revogado_em": null, "ultimo_uso_em": "2026-11-06T18:05:12.345Z", "situacao": "valido" }
  ]
}
```

- `situacao`: `valido`, `expirado` ou `revogado`. `links` vem do mais novo para o mais antigo.
- Na criação, `link` traz também `"url": "https://<site>/acesso/<token>"`. A origem da URL é a da requisição do admin.
- **Desativar** (`ativo: false`) apaga todas as sessões da pessoa e os links param de abrir sessão. **Reativar** não traz as sessões de volta; os links ainda dentro da validade voltam a funcionar.
- **Revogar** um link apaga as sessões abertas **por ele**. As sessões abertas por outros links da mesma pessoa continuam.
- **Link novo** não revoga os anteriores (revogue explicitamente, se for o caso).

## 4. Segurança

- **Segredos**: o token do link e o id da sessão têm 32 bytes de `crypto.getRandomValues` (256 bits), em base64url sem `=` (43 caracteres). No banco fica só o **SHA-256 em hex**, e a busca é sempre pelo hash. Quem copiar o banco não consegue montar um link nem um cookie. Um `CHECK` nas colunas `token_hash` e `id_hash` recusa qualquer valor que não seja um hash (64 hex minúsculos).
- **Cookie**: `sessao=<id>; Max-Age=2592000; Path=/; HttpOnly; Secure; SameSite=Lax`.
  - `HttpOnly`: o JavaScript da página não lê o cookie.
  - `Secure`: só vai por https (os navegadores aceitam também em `http://localhost`).
  - `SameSite=Lax`: não acompanha POSTs vindos de outro site.
  - O site não lê o cookie: pergunta a `GET /api/sessao`.
- **CSRF**: toda escrita (POST, PUT, PATCH, DELETE) em `/api/sessao*`, `/api/admin/*` e `/api/painel/*` só é aceita com `Origin` igual à origem da requisição, ou com `Sec-Fetch-Site: same-origin`. Sem nenhum dos dois, a resposta é 403. Os navegadores mandam esses cabeçalhos sozinhos. Fora do navegador (curl), mande `-H "Origin: https://<site>"`. A origem é conferida antes da sessão.
- **Cache**: as respostas autenticadas e as de sessão saem com `Cache-Control: no-store`.
- **Sessão**: dura 30 dias a partir do login (não renova sozinha). Entrar de novo no mesmo navegador encerra a sessão anterior dele. A cada login, as sessões vencidas são apagadas. O `ultimo_uso_em` é regravado no máximo uma vez por minuto.
- **Cookie inválido** (sessão inexistente, vencida ou de usuário desativado): 401, e a resposta expira o cookie.
- **Sem limite de tentativas**: com 256 bits, adivinhar um token não é viável.

### O que o site (front) deve fazer

- Rota `/acesso/:token`: mostrar a confirmação e só no clique fazer `POST /api/sessao` com `{ token }`. Em 200, ir para a área da coordenação. Em 401, mostrar "Link inválido ou expirado: peça um novo à coordenação".
- Antes do POST, tirar o token da barra de endereço e do histórico (`history.replaceState(null, "", "/acesso")`) e não mandar a URL com o token para logs ou analytics.
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

O link vale até 2026-12-06T16:44:08.737Z (UTC) e pode ser aberto mais de uma vez nesse prazo.
Ele não será mostrado de novo. Mande só para a própria pessoa: quem tiver o link entra como ela.
```

- `--origem`: endereço do site que vai no link. Sem `--remote`, o padrão é `http://localhost:5173` (o `npm run dev`). Com `--remote`, é obrigatória e precisa ser https.
- O script gera o token e grava o usuário e o **hash** com `wrangler d1 execute DB --local|--remote --json --command "<SQL>"`. Ele usa o wrangler do projeto (o mesmo do `npx wrangler`) e roda sem shell. Depois, confere a gravação com um `SELECT` antes de imprimir o link.
- O nome aceita letras (com acento), números, espaço, ponto, hífen e apóstrofo, até 120 caracteres, e começa por letra. Qualquer outro caractere é recusado antes de montar o SQL. Os apóstrofos são dobrados no SQL (`D'Arc` vira `'D''Arc'`).
- Códigos de saída: 0 (ok), 1 (o D1 não gravou: migrações não aplicadas, wrangler sem login...), 2 (uso errado).

## 6. Montagem no app (`src/worker/index.ts`)

As rotas de sessão ficam abertas. O middleware geral vem **antes** de qualquer rota `/api/admin/*` ou `/api/painel/*`, porque o Hono roda middlewares e rotas na ordem em que foram registrados:

```ts
import { exigirSessao } from "./middleware/sessao";
import { sessao } from "./routes/acesso";
import { adminUsuarios } from "./routes/admin-usuarios";

// Acesso da equipe (RIFA-007): antes das demais rotas /api/admin/* e /api/painel/*.
app.route("/api/sessao", sessao);
app.use("/api/admin/*", exigirSessao(["admin", "coordenacao"]));
app.use("/api/painel/*", exigirSessao(["admin", "coordenacao"]));
app.route("/api/admin", adminUsuarios); // /usuarios e /links: só admin (o sub-app também exige)
```

- `exigirSessao` pode ser empilhado: a sessão é lida uma vez por requisição e o handler recebe `c.var.usuario` (tipado com `AmbienteSessao`).
- `adminUsuarios` exige admin nos próprios caminhos (`/usuarios/*`, `/links/*`), mesmo se o middleware geral faltar.
- Testes de rotas da coordenação no app real: `cabecalhosDeSessao("coordenacao")` (em `src/worker/test/acesso-teste.ts`) cria uma sessão no D1 dos testes e devolve `{ Cookie, Origin }`.

## 7. Banco (`migrations/0002_acessos.sql`)

| Tabela | Colunas | Regras |
|---|---|---|
| `usuarios` | `id`, `nome`, `email` (nulo), `papel`, `ativo`, `criado_em` | `papel` ∈ {`admin`, `coordenacao`}; usuários não são apagados, só desativados |
| `links_acesso` | `id`, `usuario_id`, `token_hash` (UNIQUE), `criado_em`, `expira_em`, `revogado_em` (nulo), `ultimo_uso_em` (nulo) | `token_hash` = SHA-256 hex do token |
| `sessoes` | `id_hash` (PK), `usuario_id`, `link_id`, `criado_em`, `expira_em`, `ultimo_uso_em` | `id_hash` = SHA-256 hex do id da sessão; `link_id` = link que abriu a sessão |

Instantes em UTC no formato de `0001_init.sql`. Links e sessões caem junto se um usuário for apagado (`ON DELETE CASCADE`).

## 8. Testes

| Arquivo | Cobre |
|---|---|
| `src/worker/routes/acesso.test.ts` | link → sessão → cookie com as flags; `GET /api/sessao`; links expirado, revogado, de usuário inativo, inexistente ou cortado (401); reuso do link; saída |
| `src/worker/middleware/sessao.test.ts` | 401 sem sessão e com sessão expirada; 403 por papel; 403 em POST/PUT/PATCH/DELETE de outra origem; `c.var.usuario` |
| `src/worker/routes/admin-usuarios.test.ts` | só admin administra; o link só na criação; link novo; revogar; desativar e reativar |
| `src/worker/db/acessos.test.ts` | varredura de todas as tabelas atrás de tokens e ids de sessão; busca pelo hash; `CHECK` de formato |
| `src/worker/test/criar-acesso.test.ts` | o script cria um admin no D1 e o link impresso abre sessão; `--remote`; nomes perigosos recusados |
| `src/worker/lib/cripto.test.ts` | formato dos segredos, SHA-256 e equivalência com o script |
| `src/shared/contracts/acesso.test.ts` | catálogo, papéis e ausência de segredos nas respostas |
