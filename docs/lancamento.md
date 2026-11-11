# Roteiro de lançamento (RIFA-023)

Passo a passo para colocar a Rifa Videira Kids no ar e conduzir a campanha, que começa em **23/11/2026**. Escrito para o Thiago (PO, dono das contas) e para a coordenação.

- **Site:** https://rifa-videira-kids.madruga.workers.dev (o mesmo endereço do CI e do `CLAUDE.md`).
- **Quem faz:** **[Thiago]** (contas de terceiros e comandos com a conta Cloudflare), **[SM]** (a sessão do Claude que orquestra: merge, registro e comandos no D1), **[Admin]** (quem tem o papel admin no sistema), **[Coordenação]** (admin ou coordenação).
- **PENDÊNCIA** marca o que o sistema ainda não faz e o lançamento precisaria. A lista completa está no fim.
- Nenhum segredo vai neste documento, no git, no DevMission ou no WhatsApp de grupo. Aqui só se diz **onde** cada credencial fica.

## Ordem geral

Cada etapa depende da anterior. As datas são sugestão; quem decide é o PO.

| # | Etapa | Quem | Prazo sugerido |
|---|---|---|---|
| 0 | Decisões do PO (seção 1.5) | Thiago | já |
| 1 | Contas: Cloudflare (plano), Rifei (campanha) e Efí | Thiago | até 14/11 |
| 2 | Bookmark do D1, depois o token da Cloudflare no GitHub, primeira publicação e conferência | Thiago e SM | até 14/11 |
| 3 | Configuração em produção: admin, segredo do webhook, campanha, planilha das células | Thiago e Admin | até 16/11 |
| 4 | Compra de teste de ponta a ponta | Thiago e Admin | até 17/11 |
| 5 | Links dos líderes e reunião de cadastro | Admin e Coordenação | entre 18 e 21/11 |
| 6 | Largada (23/11) e dia a dia | Coordenação | 23/11 em diante |

**Atenção à ordem:** a reunião dos líderes só funciona com a campanha ativa no sistema, o webhook da Rifei ligado e a compra de teste aprovada (etapas 3 e 4). Sem isso, o código de afiliado do líder não aparece na tela de Adesão.

---

## 1. O que só o Thiago faz

### 1.1 Cloudflare

**a) Plano Workers Paid (recomendado).** No plano gratuito, cada requisição tem 10 ms de CPU, o Worker atende até 100 mil requisições por dia e o D1 lê até 5 milhões de linhas por dia. As medições do projeto mostram que isso estoura: a primeira visão do líder em cada servidor leva de 24 a 28 ms (`docs/decisions.md`, D14), a conferência por CSV (RIFA-012, ainda fora da `main`) leva de 18 a 22 ms, e o ranking aberto nos celulares e no telão consome a cota do D1 (D10). No gratuito, o que estoura é recusado pela Cloudflare (erro 1102 ou limite diário).

- Onde: no painel da Cloudflare, procure por **"Workers Paid"** (fica nos planos de **Workers & Pages**). Documentação oficial: página **"Workers pricing"** (preço de referência: US$ 5 por mês; confira antes de assinar).
- O plano vale para a conta; não precisa mudar nada no código.

**b) Token de API para o GitHub publicar.**

Faça isto **só depois do bookmark do D1** (2.1): o token vai direto para o GitHub (1.2), e com ele lá o próximo push na `main` já publica.

1. No painel da Cloudflare, procure por **"API Tokens"** no seu perfil (**My Profile**) e use **Create Token**. Documentação oficial: **"Create API token"** (Cloudflare Fundamentals) e **"Running Wrangler in CI/CD"** (Workers).
2. Comece pelo modelo **"Edit Cloudflare Workers"**. Confira se a lista de permissões tem **D1** com **Edit**; se não tiver, acrescente (a publicação aplica as migrações no D1).
3. Em recursos da conta, deixe só a conta onde está o Worker `rifa-videira-kids`. Se a tela oferecer validade, uma data depois do fim da campanha (ex.: 31/01/2027) reduz o estrago de um vazamento.
4. Copie o token **uma vez** e cole direto no GitHub (1.2). Não guarde em arquivo, e-mail ou WhatsApp. Se perder, gere outro.

Onde fica: **só** no segredo `CLOUDFLARE_API_TOKEN` do GitHub, no ambiente `producao` ou no repositório (1.2). O id da conta Cloudflare não é segredo e já está no `.github/workflows/ci.yml`.

**c) Wrangler na sua máquina (para os comandos das seções 2 e 3).**

```sh
git clone <repositório> && cd rifa-videira-kids
npm ci                 # Node 22 (veja .nvmrc)
npx wrangler login     # abre o navegador para autorizar a sua conta Cloudflare
npx wrangler whoami    # confere a conta
```

A sessão do Claude na nuvem também roda comandos D1 remotos (`CLAUDE.md`), então o SM pode fazer as consultas e o bookmark. O `npm run acesso:criar` (3.1) é melhor rodar na sua máquina: o link impresso é uma credencial e ficaria no histórico da sessão.

### 1.2 GitHub

O CI publica na Cloudflare a cada push na `main`, depois dos testes. O job **"lint, typecheck, test, build"** constrói o site e o Worker sem segredo nenhum e guarda o build; o job **"publicar na Cloudflare"** recebe só esse build, confere e publica, e só o passo que publica recebe o token (`docs/decisions.md`, D18). Sem o segredo, o job de publicação só avisa "Segredo CLOUDFLARE_API_TOKEN não configurado (nem no ambiente producao, nem no repositório): publicação pulada" e o CI fica verde.

1. **Antes**, faça o bookmark do D1 (seção 2.1). Depois do segredo cadastrado, o próximo push na `main` já publica.
2. Cadastre o token em **um** destes lugares (o job funciona com qualquer um; se estiver nos dois, vale o do ambiente):
   - **Ambiente `producao`, só para a `main` (recomendado, se der):** assim nenhum workflow alterado noutra branch consegue ler o token. Em repositório privado, só funciona com o **GitHub Pro** na sua conta; no plano Free, use o segredo do repositório (abaixo).
     1. No repositório: **Settings → Environments**. Abra `producao` se já aparecer (o GitHub o cria vazio na primeira execução do job de publicação) ou use **New environment** com o nome `producao` e **Configure environment**.
     2. Em **Deployment branches and tags**, escolha **Selected branches and tags** → **Add deployment branch or tag rule** → branch `main`.
     3. Em **Environment secrets** → **Add environment secret**: nome `CLOUDFLARE_API_TOKEN`, valor o token de 1.1 b. Salve.
   - **Segredo do repositório (mais simples):** **Settings → Secrets and variables → Actions → New repository secret**. Nome: `CLOUDFLARE_API_TOKEN`. Valor: o token de 1.1 b. Salve.
3. Se mudar do repositório para o ambiente depois, apague o segredo do repositório (**Settings → Secrets and variables → Actions**): enquanto ele existir, outra branch ainda consegue lê-lo.

Documentação oficial: **"Using secrets in GitHub Actions"** e **"Managing environments for deployment"** (GitHub Docs).

### 1.3 Rifei

A Rifei faz a venda, o pagamento e o sorteio. O sistema só recebe os pedidos pelo webhook.

- **Campanha na Rifei:** criada e **aceitando pedidos antes da compra de teste e da reunião dos líderes** (o líder inicia uma compra pelo próprio link para o código aparecer; seção 5). Anote o **slug**: é o identificador que aparece no link da campanha. O preço do bilhete na Rifei precisa ser o mesmo do sistema (3.3).
- **Afiliados:** cada líder de célula vira afiliado da campanha. Como habilitar o programa de afiliados e como o líder adere: procure por **"afiliados"** na Central de Ajuda da Rifei (rifei.com.br/ajuda). Este projeto ainda não documentou essas telas (PENDÊNCIA, `docs/integracao-rifei.md` seção 9, itens 1 e 2).
- **Webhook:** é da conta, não da campanha. Só depois do segredo do Worker (3.2). Caminho conferido na documentação oficial **"Como adicionar um webhook"**: menu do usuário → **Integrações** → seção **Outro** → **Adicionar**. Detalhes em 3.2.
- **Exportar pedidos** (para a conferência, seção 6.4): página de pedidos da campanha → **⋮** → **Exportar Pedidos**.

### 1.4 Conta Efí

A Efí é o meio de pagamento escolhido para a Rifei receber os Pix (`docs/integracao-rifei.md`, seção 9). O sistema não fala com a Efí.

- Abrir ou conferir a conta Efí que vai receber o dinheiro e ligá-la à Rifei: procure por **"Efí"** (ou "meios de pagamento") na Central de Ajuda da Rifei e siga a documentação oficial da Efí. Não documentamos essas telas aqui.
- Faça cedo: a validação de uma conta de pagamento pode levar dias, e sem ela não há compra de teste.
- A compra de teste (seção 4) é o que prova que o dinheiro cai na conta certa.

### 1.5 Decisões do PO antes do lançamento

Confirme e passe para o SM registrar no DevMission:

- [ ] **Datas:** início em 23/11; quantos períodos, com quantos dias (o "modelo de Santo André" da tela é 10, 7 e 7 dias: fim em 16/12).
- [ ] **Preço do bilhete** (o mesmo da Rifei).
- [ ] **Meta:** unidade (bilhetes ou reais), regra (por pessoa, total proporcional ou fixa por célula) e valor. Pergunta P3 em aberto.
- [ ] **Percentuais por período:** o modelo 35/25/45 soma 105%; o sistema normaliza, mas o PO confirma (P3).
- [ ] **Critério do ranking:** % da meta, bilhetes ou arrecadação (P4).
- [ ] **O público vê:** o % da meta de cada célula (sim/não) e quantas posições.
- [ ] **Workers Paid:** sim/não.
- [ ] **Conta Efí:** em nome de quem.
- [ ] **Compra de teste:** manter o bilhete (vale no sorteio) ou pedir estorno (seção 4.4).
- [ ] **Links para discipuladores e redes:** mandar ou só para os líderes.
- [ ] As suposições S1 a S22 de [regras-de-calculo.md](regras-de-calculo.md#3-suposições-para-o-po).

---

## 2. Primeira publicação e como conferir

### 2.1 Antes: bookmark do Time Travel do D1 [Thiago ou SM]

O Time Travel do D1 permite voltar o banco a um instante anterior. Anote o ponto de antes da primeira publicação (pedido da D12):

```sh
npx wrangler d1 time-travel info DB          # mostra o bookmark de agora
npx wrangler d1 migrations list DB --remote  # lista as migrações que ainda vão rodar
```

- O bookmark **não é segredo**: anote no DevMission (nota da RIFA-023) com a data e a hora.
- A lista de migrações deve trazer as de `migrations/` que ainda não rodaram em produção.
- A Cloudflare guarda esse histórico por 30 dias no Workers Paid (no gratuito, menos: veja **"Time Travel"** na documentação do D1).

### 2.2 Publicar

1. **[SM]** Confira que a última execução do CI na `main` está verde.
2. **[Thiago]** Com o bookmark anotado (2.1), crie o token (1.1 b) e cadastre direto no segredo `CLOUDFLARE_API_TOKEN`, no ambiente `producao` ou no repositório (1.2).
3. **[SM]** Dispare a publicação com um push na `main` ou, sem nada novo para subir, no GitHub: **Actions** → a última execução da `main` → **Re-run jobs** → **Re-run all jobs**. Use **Re-run all jobs**: o build guardado pelo primeiro job vale só 1 dia, e o "all" o refaz. Se o job de publicação ainda disser "publicação pulada", faça um push na `main` (o `ci.yml` não tem disparo manual).

O primeiro job constrói o site e o Worker, sem segredo, e guarda o build (`dist/`). O job de publicação instala as dependências sem rodar os scripts de instalação, baixa esse build, confere que a configuração gerada é a do `wrangler.jsonc` (`scripts/conferir-artefato.mjs`) e, só então, no passo "Publicar" (`npm run deploy:publicar`, o único com o token), confere o que foi construído (`wrangler deploy --dry-run`), aplica as migrações no D1 remoto e publica. Depois consulta `/api/health` em produção até 6 vezes.

**A partir daqui, todo push na `main` publica.** Sugestão para a campanha: o SM só faz merge de correção, com a `main` verde e fora do horário do culto e dos picos de venda.

### 2.3 Conferir que deu certo

1. **CI:** os dois jobs verdes, **"lint, typecheck, test, build"** e **"publicar na Cloudflare"**. No segundo, o passo **"Conferir /api/health em produção"** verde.
2. **Saúde:** abra https://rifa-videira-kids.madruga.workers.dev/status (deve mostrar **"API ok"**) ou rode:
   ```sh
   curl -sS https://rifa-videira-kids.madruga.workers.dev/api/health
   # esperado: {"ok":true,"db":"ok","latenciaMs":<número>}
   ```
3. **Cabeçalhos de segurança** no site e na API:
   ```sh
   curl -sS -D - -o /dev/null https://rifa-videira-kids.madruga.workers.dev/
   curl -sS -D - -o /dev/null https://rifa-videira-kids.madruga.workers.dev/api/health
   ```
   Os dois precisam trazer, com estes valores (os de `public/_headers`, `docs/acesso.md` seção 4; o curl pode mostrar os nomes em minúsculas):
   - `Referrer-Policy: no-referrer`
   - `X-Content-Type-Options: nosniff`
   - `X-Frame-Options: DENY`
   - `Content-Security-Policy: default-src 'self'; img-src 'self' data:; object-src 'none'; base-uri 'none'; form-action 'self'; frame-ancestors 'none'`
4. **Área fechada:** sem login, a coordenação recusa.
   ```sh
   curl -sS -o /dev/null -w "%{http_code}\n" https://rifa-videira-kids.madruga.workers.dev/api/admin/campanha
   # esperado: 401
   ```
5. **Migrações aplicadas:** `npx wrangler d1 migrations list DB --remote` não deve listar nenhuma pendente. O log do passo "Publicar" no GitHub também mostra as que rodaram. Se a conferência por CSV (RIFA-012) entrar depois, a migração `0004` dela vai rodar depois da `0006` (o wrangler aplica, por nome, as que faltam); isso já está previsto nas migrações.
6. **Webhook fechado:** antes do segredo do webhook (3.2), ele recusa tudo:
   ```sh
   curl -sS -X POST https://rifa-videira-kids.madruga.workers.dev/api/webhooks/rifei \
     -H "Authorization: Bearer teste" -H "Content-Type: application/json" -d "{}"
   # esperado agora: erro "nao_configurado" (503); depois de 3.2: "nao_autenticado" (401)
   ```

### 2.4 Se der errado

- **O CI falhou antes de publicar:** nada foi ao ar. Isso inclui falha no build, nas conferências do build (passos "Conferir o build para a publicação" e "Conferir o build baixado") e no `wrangler deploy --dry-run` do passo "Publicar": as migrações nem rodaram. Corrija e faça outro push. Se a conferência acusar diferença sem ninguém ter mexido no `wrangler.jsonc`, chame o SM: pode ser uma versão nova do wrangler ou um build adulterado, e não se publica até entender.
- **As migrações rodaram e a publicação falhou:** o banco ficou à frente do código. As migrações são aditivas; corrija e publique de novo.
- **Voltar o banco ao ponto anotado** (apaga tudo o que foi gravado depois dele: pedidos, vínculos, acessos):
  ```sh
  npx wrangler d1 time-travel restore DB --bookmark=<bookmark anotado>
  # ou por instante: --timestamp=2026-11-14T12:00:00Z (até 30 dias para trás no Workers Paid)
  ```
  - O comando pede confirmação e, no fim, mostra o bookmark de antes da volta: anote, ele desfaz a volta.
  - Links revogados depois do ponto voltam a valer, e os gerados depois somem: revogue de novo (7.3) e gere os que faltarem.
  - Voltar para antes de uma migração apaga o que ela criou: a próxima publicação aplica de novo.
- **Voltar o código a uma versão anterior:** `npx wrangler deployments list` mostra as últimas publicações (as de código e as de segredo, como a de 3.2) e `npx wrangler rollback -m "<motivo>"` volta para a anterior. Na primeira publicação não existe versão anterior. O rollback não mexe no banco.
  - Se o wrangler avisar que segredos mudaram desde aquela versão (ex.: `RIFEI_WEBHOOK_TOKEN`), responda **não**: aquela versão tem os segredos de antes, e o webhook pode parar ou voltar ao token antigo. Escolha uma versão mais nova pelo id: `npx wrangler rollback <id da versão> -m "<motivo>"`.
  - Depois do rollback, refaça o teste de 2.3 item 6: com o 3.2 já feito, precisa dar `nao_autenticado` (401).

---

## 3. Configuração inicial em produção

### 3.1 Primeiro admin [Thiago]

Na sua máquina, na pasta do repositório (1.1 c):

```sh
npm run acesso:criar -- --nome "<seu nome>" --papel admin --remote --origem https://rifa-videira-kids.madruga.workers.dev
```

- O link `https://rifa-videira-kids.madruga.workers.dev/acesso/<token>` aparece **uma vez só**. Abra no navegador e toque em **Entrar**: você cai na área `/coordenacao`.
- O link vale 45 dias e pode ser aberto de novo nesse prazo (outro aparelho, como o seu celular). Uma sessão parada há mais de 7 dias cai; é só abrir o link de novo.
- O script só aceita `--nome`, `--papel` (`admin` ou `coordenacao`), `--remote`, `--local` e `--origem` (`docs/acesso.md`, seção 5). Não existe opção de e-mail.
- Se o link aparecer numa sessão do Claude ou em qualquer lugar além do seu terminal, entre uma vez, gere um link novo na tela Acessos e revogue o primeiro.

Depois, no site **[Admin]**: **Acessos → Coordenação → Nova pessoa** (nome, e-mail opcional, papel). O link aparece uma vez, com **Copiar link** e **Enviar pelo WhatsApp**: mande só para a própria pessoa.

- Crie **um segundo admin**: o sistema não deixa desativar o último admin nem revogar o último link válido de admin, e com dois ninguém fica preso.
- O resto da equipe (inclusive quem cuida do bumbo) entra com o papel **coordenação**.

### 3.2 Segredo do webhook (`RIFEI_WEBHOOK_TOKEN`) e webhook na Rifei [Thiago]

1. Gere um token forte e grave como segredo do Worker:
   ```sh
   openssl rand -hex 32                        # gera o token (não salve em arquivo)
   npx wrangler secret put RIFEI_WEBHOOK_TOKEN # cole o token quando pedir
   npx wrangler secret list                    # deve listar o nome RIFEI_WEBHOOK_TOKEN (sem o valor)
   ```
   Sem `openssl` (ex.: Windows), gere com o Node: `node -e "console.log(require('node:crypto').randomBytes(32).toString('hex'))"`. Em hexadecimal o token só tem letras e números, sem `+`, `/` ou `=` que um formulário possa cortar.
2. Na Rifei (menu do usuário → **Integrações** → **Outro** → **Adicionar**):
   - **URL:** `https://rifa-videira-kids.madruga.workers.dev/api/webhooks/rifei`
   - **Token:** o mesmo do passo 1.
   - **Eventos:** os três: "Novo pedido", "Pedido pago" e "Pedido expirado".
3. Confira: o teste de 2.3 item 6 passa a responder `nao_autenticado` (401), e não mais `nao_configurado`.

Onde fica o token: **só** no segredo do Worker (Cloudflare) e no webhook da Rifei. Não precisa guardar cópia: para trocar, gere outro e mude primeiro o Worker, depois a Rifei. Entre os dois passos as entregas recebem 401 e se perdem (seção 7.1).

### 3.3 Campanha [Admin, com as decisões do PO]

No site: **Coordenação → Campanha**. Preencha com o que o PO confirmou (1.5):

- **Identificação:** nome da campanha e **Slug da campanha na Rifei** (o do link da campanha, 1.3).
- **Datas e períodos:** data de início `23/11/2026`, fuso `America/Belem` e os períodos (o botão **Usar o modelo de Santo André** preenche 10/7/7 dias com 35/25/45%).
- **Bilhete e meta:** preço do bilhete (R$), unidade, regra e valor da meta.
- **Ranking e público:** critério do ranking, se o público vê o % e quantas posições.
- **Ativar a campanha** (pede confirmação). A partir daí, as vendas da Rifei com esse slug contam.

Cuidados:

- **Sem campanha ativa, ou com o slug errado, o webhook ignora os pedidos** (resultado `ignorado_outra_campanha`) e o código do afiliado não aparece na Adesão.
- O preço do bilhete também serve para marcar pedidos estranhos (seção 4.2): com um preço diferente do da Rifei, pedidos normais podem cair na lista de suspeitos.
- Os números são recalculados na leitura: mudar meta, preço, períodos ou percentuais depois muda os números da campanha inteira, inclusive dos dias que passaram. Combine com o PO antes.
- Cada salvamento fica na trilha de auditoria (`campanha.salvar`, com o slug e o preço de antes e de depois).

### 3.4 Planilha das 36 células [Coordenação]

Siga [importar-hierarquia.md](importar-hierarquia.md). Em resumo: **Coordenação → Hierarquia →** aba **Importar planilha** → **Baixe o modelo** → **Escolha o arquivo** → **Conferir** (não grava nada) → **Importar**.

- Confira no resultado: 36 células criadas, sem erros. Leia os avisos (coluna ignorada não entra).
- Preencha `lider_telefone`: é ele que abre o WhatsApp do líder na hora de mandar o link (5.1) e de cobrar quem falta (5.3).
- A importação nunca apaga e pode ser repetida com a planilha corrigida.

### 3.5 Vinculação de afiliados (visão geral)

A venda chega com o código de afiliado (`affiliate_id`) do líder, e o sistema descobre a célula pelo vínculo afiliado → célula (`docs/integracao-rifei.md`, D7). O vínculo é feito em **Coordenação → Adesão** de dois jeitos:

- **Fila "Sem célula":** quando o líder inicia uma compra pelo próprio link de afiliado (sem pagar), o código aparece na fila em segundos. Toque em **Vincular** e escolha a célula.
- **Código digitado:** se o líder souber o código, em **Todas as células** → a célula → **Código de afiliado** → **Salvar código** (pré-cadastro). Uma célula pode ter mais de um código (**Adicionar outro código**).

O roteiro da reunião está na seção 5. Regra de ouro: **não use "Desvincular" num afiliado que já vendeu**, a não ser de propósito: todas as vendas dele, inclusive as antigas, saem da célula na hora.

---

## 4. Compra de teste de ponta a ponta

**Quando:** depois de 3.1 a 3.4 e **antes de 23/11** (veja 4.4). **Quem:** Thiago, de preferência com uma segunda conta da Rifei como afiliada (para responder às perguntas da seção 9 de `docs/integracao-rifei.md`), e um admin olhando o sistema.

### 4.1 Os passos

1. Com a conta afiliada de teste, abra o link de afiliado dela e **inicie uma compra sem pagar**. Em segundos, o **"Afiliado <código>"** aparece em **Adesão → Sem célula**. Vincule a uma célula.
   - De preferência, use como afiliada de teste a conta de um **líder de verdade** (ex.: alguém da coordenação que lidera uma célula) e vincule à célula dele: o vínculo já vale para a campanha. O sistema não apaga afiliado: uma conta só de teste ficaria vinculada a uma célula ou, desvinculada, parada na fila "Sem célula".
   - Se a entrega chegar (4.2) e nada aparecer em "Sem célula", o código de afiliado não veio no pedido: chame o SM antes da reunião dos líderes.
2. **Faça uma compra paga de 1 bilhete** (Pix pela Efí), pelo mesmo link de afiliado.
3. Inicie **outra compra e não pague**: depois do prazo de reserva, a Rifei avisa que expirou.

### 4.2 O que olhar

- **Visão geral** (painel): aparece o aviso de venda "antes do início", que **não conta em nada** (ex.: compra de teste). Meta, ranking, bumbo, telão e a visão do líder continuam zerados (contagem regressiva).
- **Adesão:** a célula do teste passa para **Já vendeu**, com 1 pedido aprovado.
- **Pedidos:** a tela **Pedidos** ainda está em construção (RIFA-003). PENDÊNCIA. Até lá, consulte o D1 [Thiago ou SM]. As duas consultas não trazem dado pessoal:
  ```sh
  npx wrangler d1 execute DB --remote --command "SELECT id, status, affiliate_id, qtd_bilhetes, total_centavos, aprovado_em FROM pedidos ORDER BY registrado_em DESC LIMIT 5"
  ```
  Esperado: o pedido pago com `status = approved`, `qtd_bilhetes = 1` e `total_centavos` igual ao preço em centavos (ex.: R$ 20,00 = 2000); o não pago, `in_process` e depois `expired`.
- **Trilha das entregas do webhook:**
  ```sh
  npx wrangler d1 execute DB --remote --command "SELECT id, recebido_em, evento, pedido_id, resultado, status_anterior, status_resultante, json_array_length(avisos) AS avisos FROM webhook_eventos ORDER BY id DESC LIMIT 10"
  ```
  Esperado: `new_order` → `processado` (`in_process`), `paid_order` → `processado` (`approved`) e `expired_order` → `processado` (`expired`).
  - `ignorado_outra_campanha`: o slug do sistema não é o da Rifei (3.3).
  - Nenhuma linha: o webhook não chegou (URL, token ou eventos na Rifei; seção 7.1).
  - `avisos` maior que zero: a Rifei mandou algum campo diferente da documentação. Veja quais (só caminhos e códigos, nunca dado pessoal) com `SELECT avisos FROM webhook_eventos WHERE id = <id>` e mande ao SM.
- **Trilha de auditoria** (o que a equipe fez) [Admin]: tela **Trilha** no menu da coordenação (`/coordenacao/trilha`), do mais novo para o mais antigo, com "Carregar mais". Confira que aparecem o salvamento da campanha, a importação da hierarquia e os vínculos de afiliado.
- **Pedidos suspeitos:** tela **Pedidos suspeitos** no menu da coordenação (`/coordenacao/pedidos-suspeitos`). Esperado: lista vazia. Se o pedido de teste aparecer, confira o preço do bilhete na Campanha: ele precisa ser igual ao da Rifei.

### 4.3 O que anotar

Responda à lista "O que confirmar com uma campanha de teste" de [integracao-rifei.md](integracao-rifei.md#9-o-que-confirmar-com-uma-campanha-de-teste): formato do link de afiliado, onde ver o código do afiliado na Rifei, se o pedido pago depois de expirar volta como pago (Efí), tempo de reserva, colunas do "Exportar Pedidos". Mande ao SM para o DevMission. Os payloads reais **não** vão para o repositório com dados pessoais.

### 4.4 O pedido de teste depois

**O sistema não tem como excluir pedido** (nenhuma rota nem tela). A saída mais simples, que já existe: **fazer o teste antes de 23/11**. Venda aprovada antes do 1º dia fica fora de meta, realizado, ranking, bumbo, telão e visão do líder; só aparece no aviso "antes do início" da Visão geral (`docs/regras-de-calculo.md`, S8).

O que continua mostrando o teste: a Adesão (a célula fica "Já vendeu") e os totais do afiliado. Não atrapalha a campanha.

- O bilhete comprado é de verdade e entra no sorteio. Decisão do PO (1.5): manter (o dinheiro foi para a causa) ou pedir estorno na Rifei/Efí (procure por "estorno" ou "reembolso" na Central de Ajuda da Rifei). O estorno **não chega ao sistema** (a Rifei só avisa pedido novo, pago e expirado), mas como o teste está fora da janela, isso não muda nenhum número.
- Se um teste for feito **depois de 23/11**, ele conta como venda (e é: o dinheiro entrou). Apagar direto no D1 é possível com SQL, mas não fica na trilha de auditoria: só com decisão do PO.

---

## 5. Reunião de cadastro dos líderes

**Pré-requisitos:** campanha ativa com o slug certo (3.3), webhook ligado (3.2), compra de teste aprovada (4), planilha importada com os telefones (3.4) e a campanha na Rifei aceitando pedidos (1.3).

### 5.1 Antes

1. **Links em lote [Admin]:** **Acessos → Líderes, discipuladores e redes** → Papel **Líderes de célula** → **Gerar links para quem ainda não tem (36)**.
   - Abre uma janela com um link por líder. Em cada um: **Abrir no WhatsApp** (abre a conversa com o número da planilha e a mensagem pronta) ou **Copiar mensagem** (sem telefone ou com número estranho).
   - **Os links só aparecem agora**: mande todos antes de tocar em **Pronto**. Se fechar antes, use **Novo link** na linha do líder.
   - A mensagem que o sistema monta é esta (o nome e a célula mudam; o link vem na última linha):
     > Olá, Fulano! Este é o seu link pessoal para acompanhar a sua célula (Célula X) na campanha da rifa do Videira Kids: as vendas, a meta e a posição no ranking.
     > O link é só seu: não repasse para ninguém, porque quem tiver o link entra como você.
   - Se o PO quiser (1.5), repita com o papel **Discipuladores** e **Redes**.
   - Cada link vale 45 dias: gerado na semana da reunião, cobre a campanha inteira.
2. **Convite no grupo dos líderes [Coordenação]** (sugestão de texto, sem link nenhum):
   > Reunião de cadastro da Rifa Videira Kids: <dia>, <hora>, <local>. Traga o celular carregado, com o WhatsApp e o acesso à sua conta da Rifei (ou o e-mail para criar uma). Você já recebeu no privado o seu link pessoal do sistema: não repasse.
3. **Ensaiar a Adesão:** abra **Coordenação → Adesão** no aparelho que vai ser usado na reunião (celular ou notebook). Ela se atualiza sozinha a cada 15 s e tem **Atualizar agora**.
4. **Instruções da Rifei:** tenha à mão o passo a passo da Rifei para o líder virar afiliado (1.3). PENDÊNCIA: não está documentado neste projeto.

### 5.2 Durante

1. **Cada líder abre o link pessoal** que recebeu e toca em **Entrar**. Ele vê a tela da célula dele (`/minha`), ainda com a contagem regressiva. O limite de 60 entradas por minuto do mesmo Wi-Fi comporta a reunião.
2. **Adesão na Rifei:** cada líder vira afiliado da campanha, seguindo a Central de Ajuda da Rifei.
3. **Vincular o afiliado à célula, um líder por vez:**
   1. O líder abre o próprio link de afiliado e **inicia uma compra sem pagar**.
   2. Em segundos, **"Afiliado <código>"** aparece no topo de **Sem célula**, na Adesão. Se não aparecer em um minuto, toque em **Atualizar agora**; se ainda assim não vier, confira se o líder usou o link de afiliado dele (e não o link comum da campanha).
   3. Toque em **Vincular**, escolha a célula do líder e confirme. A célula vai para "Vinculada".
   - **Um de cada vez:** com dois líderes ao mesmo tempo, não dá para saber qual código é de quem.
   - Se o líder souber o código: **Todas as células** → a célula → **Código de afiliado** → **Salvar código**.
   - A compra iniciada e não paga só reserva números até expirar; nunca conta como venda.
4. **Acompanhe** o resumo no topo da Adesão (células vinculadas, células que já venderam e afiliados sem célula) e a seção **Quem falta**.

### 5.3 Depois

- **Quem falta:** a seção **Quem falta** lista as células sem afiliado, com o líder e o telefone (toque para ligar ou **Copiar**). Cobre um por um até 22/11.
- **Quem não entrou no sistema [Admin]:** em **Acessos → Líderes, discipuladores e redes**, a coluna **Situação** mostra quem nunca usou o link. Reenvie com **Novo link**.
- **Fila "Sem célula" vazia antes de 23/11.** Venda de afiliado sem célula conta no total da campanha, mas em nenhuma célula, rede ou ranking. Vincular depois leva todas as vendas antigas para a célula (nada se perde), mas o ranking fica errado até lá.
- Mande ao SM os números finais (células vinculadas e quem falta) para o DevMission.

---

## 6. Dia a dia da campanha

### 6.1 Bumbo no grupo (toda manhã) [Coordenação]

**Coordenação → Bumbo** mostra a mensagem do dia, que fala de **ontem** (dia já fechado): venda de ontem em % da meta do dia, acumulado contra a curva, projeção, as 3 primeiras de cada divisão e quem mais subiu. Só percentuais e posições, **nunca valores em reais nem quantidade de bilhetes**.

- **Enviar no WhatsApp** abre o WhatsApp com o texto pronto; **Copiar mensagem** copia.
- O seletor de data mostra a mensagem de dias anteriores (ex.: se esqueceu de mandar).
- Antes de 23/11, a mensagem é a contagem regressiva; no 1º dia, a largada; no dia seguinte ao fim, o resultado.

### 6.2 Telão no culto [Coordenação]

- No computador do telão, abra https://rifa-videira-kids.madruga.workers.dev/telao e deixe o navegador em tela cheia (F11 no Chrome e no Edge do Windows).
- Não precisa de login. Mostra jovens e adultos lado a lado, só posições e nomes (e o % da meta, se o PO ligou). Atualiza sozinho a cada minuto; se a internet cair, fica com o último dado e volta sozinho.
- Teste no projetor de verdade antes do primeiro culto.
- O ranking público para mandar nos grupos é a página inicial: https://rifa-videira-kids.madruga.workers.dev/

### 6.3 Acompanhamento [Coordenação]

- **Visão geral:** meta do dia, situação (em dia ou abaixo), curva e projeção, por campanha, divisão, rede, discipulador ou célula. Os avisos de "sem célula" pedem uma olhada na Adesão.
- **Rankings:** com valores, para a coordenação.
- **Adesão:** a fila **Sem célula** deve ficar vazia. Código novo ali = venda de afiliado sem vínculo: vincule.
- **Líderes, discipuladores e redes** acompanham pelo próprio link (`/minha`), sem valores em reais.
- **Pedidos suspeitos** (mais de 200 bilhetes num pedido ou valor fora do preço): uma vez por semana, um coordenador abre a tela **Pedidos suspeitos** e confere na Rifei. Eles continuam contando; tirar um pedido é decisão do PO.

### 6.4 Conferência pelo CSV (RIFA-012, quando estiver no ar)

A RIFA-012 ainda não está na `main`: hoje a tela **Conferência** mostra "em construção". **Quando estiver no ar**:

1. Na Rifei: pedidos da campanha → **⋮** → **Exportar Pedidos**.
2. **Coordenação → Conferência:** escolha o arquivo como a Rifei baixou (sem abrir e salvar no Excel). O arquivo é lido no navegador e os dados pessoais não saem dele.
3. Confira o mapeamento das colunas, leia as diferenças e use **Recuperar** para as vendas pagas na Rifei que não chegaram pelo webhook. Elas passam a contar no painel, nos rankings e no bumbo.

Sugestão: uma conferência por semana e sempre que o webhook falhar (7.1). **Até a RIFA-012 entrar, venda perdida pelo webhook não tem como ser recuperada no sistema** (PENDÊNCIA); dá só para comparar à mão o total pago na Rifei com a Visão geral.

### 6.5 Se algo cair: onde olhar e quem chamar

**Importante:** a venda acontece na Rifei. Se o nosso site cair, a Rifei continua vendendo e recebendo; o que para é o painel, e as entregas do webhook nesse intervalo podem se perder, porque a Rifei não documenta reenvio (recuperação pela conferência, 6.4).

| Onde olhar | O quê |
|---|---|
| https://rifa-videira-kids.madruga.workers.dev/status | "API ok" ou o erro |
| GitHub → **Actions** | se a última publicação falhou |
| Cloudflare → **Workers & Pages** → `rifa-videira-kids` → logs (procure por **"Logs"** ou **"Observability"** na página do Worker; documentação oficial: **"Workers Logs"**) | erros do Worker (os logs ficam ligados no `wrangler.jsonc`; o nosso código só registra ids e erros, nunca dado do comprador) |
| `npx wrangler tail rifa-videira-kids --format pretty` [Thiago] | os logs ao vivo |
| www.cloudflarestatus.com | problema geral da Cloudflare |
| Central de Ajuda e suporte da Rifei | venda, pagamento ou webhook do lado da Rifei |

**Quem chamar:** quem notar avisa a coordenação; a coordenação chama o **Thiago**, que abre uma sessão do Claude (SM) com o sintoma, a hora e o print. Problema de pagamento ou de pedido na Rifei: suporte da Rifei (e da Efí, se for o Pix).

---

## 7. Plano de contingência

### 7.1 O webhook parou

**Sinal:** a Rifei mostra vendas pagas e a Visão geral não sobe.

1. Veja a última entrega e os resultados desde uma data (troque a data) [Thiago ou SM]:
   ```sh
   npx wrangler d1 execute DB --remote --command "SELECT max(recebido_em) AS ultima FROM webhook_eventos"
   npx wrangler d1 execute DB --remote --command "SELECT resultado, count(*) AS n FROM webhook_eventos WHERE recebido_em >= '2026-11-23' GROUP BY resultado"
   ```
   Os horários do banco estão em UTC: 3 horas à frente de Belém.
2. Ache a causa:
   - Nada chega: o webhook continua cadastrado na Rifei, com a URL certa e os três eventos? O site está no ar (6.5)?
   - Muitos `ignorado_outra_campanha` (alguns são normais: outras campanhas da mesma conta da Rifei): o slug mudou (renomear a campanha na Rifei pode mudar o slug) ou a campanha do sistema não está ativa. Corrija o slug em **Campanha**.
   - O teste de 2.3 item 6 responde `nao_configurado`: o segredo sumiu do Worker. Refaça 3.2.
   - Os logs mostram erro 1102 ou limite diário: o plano gratuito estourou. Assine o Workers Paid (1.1 a).
3. Recupere as vendas perdidas pela conferência por CSV (6.4), **quando estiver no ar**.

### 7.2 O site caiu

1. Confira 6.5: `/status`, a última publicação no GitHub e o status da Cloudflare.
2. Se começou depois de uma publicação: `npx wrangler rollback -m "<motivo>"` volta o código para a versão anterior (veja as versões com `npx wrangler deployments list` e os cuidados em 2.4). Depois, o SM corrige na `main`.
3. Se um dado estragado derrubou o sistema: volte o banco com o Time Travel (2.4) para um instante antes do problema. **Tudo gravado depois se perde**: recupere as vendas pela conferência (6.4), quando estiver no ar, e refaça as revogações de link desse intervalo. Antes de qualquer mudança arriscada no meio da campanha (importação grande, migração nova), anote um bookmark novo (2.1).
4. Avise os líderes no grupo que as vendas pela Rifei continuam normais.

### 7.3 Um link pessoal vazou (revogar) [Admin]

- **De alguém da coordenação** (vê tudo, inclusive valores): **Acessos → Coordenação** → o cartão da pessoa → **Revogar link** em cada link válido → **Gerar link novo** e mande só para a pessoa. A revogação derruba as sessões abertas por aquele link.
  - O último link válido de admin não pode ser revogado: gere o novo primeiro.
  - Para tirar o acesso de vez: **Desativar acesso** (derruba todas as sessões da pessoa).
  - **Se alguém pode ter entrado com o link:** veja na trilha de auditoria (4.2) o que esse usuário fez depois do vazamento. Um link de coordenação muda campanha, hierarquia e vínculos; um de admin também cria pessoas e links (`usuario.criar`, `link.criar`, `acessos_hierarquia.gerar_links`). Desfaça o que não foi a equipe: em **Acessos**, revogue os links que ele gerou e desative as pessoas que ele criou.
- **De um líder, discipulador ou rede** (vê só os números do alvo dele, sem reais): **Acessos → Líderes, discipuladores e redes** → **Trocar acesso** na linha. Gera um link novo, revoga os anteriores e tira do sistema o aparelho que estava com o link velho. Mande o novo para a pessoa certa.
- **Os links públicos** (`/` e `/telao`) não têm segredo: não há o que revogar.
- **Vazou um token [Thiago]:**
  - `RIFEI_WEBHOOK_TOKEN`: gere outro e troque primeiro no Worker, depois na Rifei (3.2). As entregas entre os dois passos se perdem: confira pelo CSV (6.4).
  - `CLOUDFLARE_API_TOKEN`: em **API Tokens** na Cloudflare, apague ou renove o token e cadastre o novo no mesmo lugar do GitHub (ambiente `producao` ou repositório, 1.2).

### 7.4 Um líder trocou (trocar acesso)

1. **Hierarquia → Células → Editar célula:** novo nome e telefone do líder (ou corrija a planilha e importe de novo).
2. **[Admin]** **Acessos → Líderes, discipuladores e redes → Trocar acesso** na célula: o link novo vai para o novo líder e o aparelho do antigo sai.
3. O novo líder vira afiliado na Rifei, e a coordenação vincula o código dele na **Adesão** (**Adicionar outro código** na célula).
4. **Mantenha o código do líder antigo vinculado**, para as vendas dele continuarem na célula. Desvincular tira todas as vendas dele da célula, inclusive as antigas. O vínculo não tem data: se o líder antigo continuar vendendo pelo link dele, a venda continua indo para a célula.

### 7.5 A hierarquia mudou durante a campanha

Tudo é recalculado na leitura, para a campanha inteira, e cada mudança fica na trilha de auditoria. Combine com o PO e avise os líderes antes.

- **Célula mudou de discipulador ou discipulador mudou de rede:** **Editar célula** ou **Editar discipulador** (ou planilha corrigida, sempre com **Conferir** antes). As vendas da célula vão junto, inclusive as antigas; o ranking de discipuladores e redes muda. O acesso de quem está acima acompanha sozinho (em até 30 s).
- **Mudou o número de pessoas:** a meta da célula muda para a campanha inteira, e o ranking por % muda junto. Na regra "total proporcional", a meta das outras células também muda (o total é repartido pelas pessoas).
- **Célula nova:** cadastre (ou importe). Ela ganha meta desde o 1º dia, então começa "abaixo" (e, na regra "total proporcional", diminui a meta das outras). Gere o link do líder (**Gerar links para quem ainda não tem**) e vincule o afiliado.
- **Célula saiu ou juntou com outra:** com afiliado vinculado, ela não pode ser excluída. Passe os afiliados para a célula de destino (**Adesão → Todas as células → Trocar**), o que leva todas as vendas deles, e então exclua (o acesso do líder dela cai junto). A importação nunca apaga nada.

---

## Pendências encontradas

O que o sistema ainda não faz e o lançamento precisaria (ou faria melhor com):

1. **Conferência por CSV (RIFA-012) fora da `main`.** Sem ela, a venda que o webhook perder não volta para o sistema. É a rede de segurança do webhook: deveria entrar antes de 23/11.
2. **Tela de Pedidos (RIFA-003) em construção.** Não há lista de pedidos nem das entregas do webhook; hoje, só por SQL no D1.
3. ~~Sem tela para a trilha de auditoria e para os pedidos suspeitos~~: resolvido na RIFA-024 (telas **Trilha** e **Pedidos suspeitos**).
4. **Sem exclusão de pedido** (teste ou fraude). Decisão do PO.
5. **Sem alerta de webhook parado:** ninguém é avisado; alguém precisa olhar (7.1).
6. **Estorno ou cancelamento na Rifei não chega ao sistema** (só há os eventos novo, pago e expirado): pedido aprovado e depois estornado continua contando.
7. **Adesão e totais do afiliado não separam a compra de teste:** a célula do teste aparece como "Já vendeu". E não há como apagar um afiliado (o de teste fica no sistema).
8. **Rifei e Efí:** como o líder vira afiliado, onde ver o código de afiliado e como ligar a Efí não estão documentados aqui (`docs/integracao-rifei.md`, seção 9).
9. **Vínculo afiliado → célula sem data:** trocar ou desvincular é retroativo (7.4).
10. **Primeira publicação sem volta do código:** não há versão anterior para o `wrangler rollback`; só o Time Travel do banco.
