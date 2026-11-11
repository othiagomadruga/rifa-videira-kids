# Roteiro de lançamento (RIFA-023)

Passo a passo para colocar a Rifa Videira Kids no ar e conduzir a campanha, que começa em **23/11/2026**. Escrito para o Thiago (PO, dono das contas) e para a coordenação. Site: https://rifa-videira-kids.madruga.workers.dev

## O que o Thiago faz, em ordem

Siga de cima para baixo. Cada passo leva à seção com os detalhes.

1. **Abrir a conta Efí, já.** Efí Pro (CPF) ou Efí Empresas (CNPJ), pelo app. A Efí não publica o prazo da análise. Antes, decida quem é o titular. → [1.4](#14-conta-efí) e [1.5](#15-decisões-do-po)
2. **Assinar o Workers Paid** na Cloudflare. A conferência pelo CSV exige. → [1.1 a](#11-cloudflare)
3. **Token da Cloudflare no GitHub.** Antes de salvar, avise o SM: ele anota o ponto de volta do banco (bookmark). → [2.1](#21-antes-bookmark-do-time-travel-do-d1-thiago-ou-sm), [1.1 b](#11-cloudflare) e [1.2](#12-github)
4. **Avisar o SM que o token está salvo.** Ele publica e confere o site. Depois, com ele, crie o primeiro admin e o segredo do webhook. → [2.2](#22-publicar), [3.1](#31-primeiro-admin-thiago) e [3.2](#32-segredo-do-webhook-e-webhook-na-rifei-thiago)
5. **Campanha na Rifei.** Escolha o plano pelo preço do bilhete, pague a taxa de liberação e anote o slug. → [1.3](#13-rifei)
6. **Afiliados na Rifei.** Mande já as perguntas prontas ao suporte da Rifei. Com as respostas, ligue os afiliados e prepare os convites dos líderes. → [1.3](#13-rifei)
7. **Efí na Rifei**, quando a Efí aprovar a conta. Faça num computador. → [1.4](#14-conta-efí)
8. **Webhook na Rifei**, com a URL e o token do passo 4. → [3.2](#32-segredo-do-webhook-e-webhook-na-rifei-thiago)
9. **Preencher a Campanha no site** e ativar: datas, preço, meta, ranking e o que o público vê. → [1.5](#15-decisões-do-po) e [3.3](#33-campanha-admin-com-as-decisões-do-po)
10. **Planilha das 36 células** (a coordenação pode fazer). → [3.4](#34-planilha-das-36-células-coordenação)
11. **Compra de teste** de 1 bilhete, antes de 23/11. → [4](#4-compra-de-teste-de-ponta-a-ponta)
12. **Reunião dos líderes**: antes, os convites de afiliado e os links pessoais. → [5](#5-reunião-de-cadastro-dos-líderes)

Depois da largada, o dia a dia é da coordenação (seção 6). Se algo cair: seção 7.

## Como ler este roteiro

- **Quem faz:** **[Thiago]** (contas de terceiros e comandos com a conta Cloudflare), **[SM]** (a sessão do Claude que orquestra: merge, registro e comandos no D1), **[Admin]** (quem tem o papel admin no sistema), **[Coordenação]** (admin ou coordenação).
- **PENDÊNCIA** marca o que o sistema ainda não faz e o lançamento precisaria. A lista completa está no fim.
- **NÃO DOCUMENTADO** quer dizer que a fonte oficial (Rifei ou Efí) não diz. Confira na tela ou pergunte ao suporte.
- O passo a passo da Rifei e da Efí, com os links oficiais, está em [integracao-rifei.md, seção 12](integracao-rifei.md#12-rifei-e-efí-passo-a-passo-para-o-po). Aqui fica o resumo.
- Nenhum segredo vai neste documento, no git, no DevMission ou no WhatsApp de grupo. Aqui só se diz **onde** cada credencial fica.

## Ordem geral

Cada etapa depende da anterior. As datas são sugestão; quem decide é o PO.

| # | Etapa | Quem | Prazo sugerido |
|---|---|---|---|
| 0 | Abrir a conta Efí e as decisões fora do sistema (1.5) | Thiago | já |
| 1 | Contas: Cloudflare (Workers Paid) e Rifei (campanha e perguntas ao suporte) | Thiago | até 14/11 |
| 2 | Bookmark do D1, depois o token da Cloudflare no GitHub, primeira publicação e conferência | Thiago e SM | até 14/11 |
| 3 | Configuração em produção: admin, segredo e webhook, Campanha, planilha das células e a Efí ligada à Rifei | Thiago e Admin | até 16/11 |
| 4 | Compra de teste de ponta a ponta | Thiago e Admin | até 17/11 |
| 5 | Convites de afiliado, links dos líderes e reunião de cadastro | Thiago, Admin e Coordenação | entre 18 e 21/11 |
| 6 | Largada (23/11) e dia a dia | Coordenação | 23/11 em diante |

**Atenção à ordem:** a reunião dos líderes só funciona com a campanha ativa no sistema, o webhook da Rifei ligado e a compra de teste aprovada (etapas 3 e 4). Sem isso, o código de afiliado do líder não aparece na tela de Adesão. E a compra de teste só sai com a conta Efí aprovada e ligada à Rifei: se a análise da Efí atrasar, avise o SM.

---

## 1. O que só o Thiago faz

### 1.1 Cloudflare

**a) Plano Workers Paid (decisão do PO; a conferência por CSV exige).** No plano gratuito, cada requisição tem 10 ms de CPU, o Worker atende até 100 mil requisições por dia e o D1 lê até 5 milhões de linhas por dia. As medições do projeto mostram que isso estoura: a primeira visão do líder em cada servidor leva de 24 a 28 ms (`docs/decisions.md`, D14), a conferência por CSV (RIFA-012) leva de 18 a 22 ms e por isso **exige o Workers Paid** (D19), e o ranking aberto nos celulares e no telão consome a cota do D1 (D10). No gratuito, o que estoura é recusado pela Cloudflare (erro 1102 ou limite diário).

- Onde: no painel da Cloudflare, procure por **"Workers Paid"** (fica nos planos de **Workers & Pages**). Documentação oficial: página **"Workers pricing"** (preço de referência: US$ 5 por mês; confira antes de assinar).
- O plano vale para a conta; não precisa mudar nada no código.

**b) Token de API para o GitHub publicar.**

Faça isto **só depois do bookmark do D1** (2.1): o token vai direto para o GitHub (1.2), e com ele lá o próximo push na `main` já publica.

1. No painel da Cloudflare, procure por **"API Tokens"** no seu perfil (**My Profile**) e use **Create Token**. Documentação oficial: **"Create API token"** (Cloudflare Fundamentals) e **"Running Wrangler in CI/CD"** (Workers).
2. Comece pelo modelo **"Edit Cloudflare Workers"**. Confira se a lista de permissões tem **D1** com **Edit**; se não tiver, acrescente (a publicação aplica as migrações no D1).
3. Em recursos da conta, deixe só a conta onde está o Worker `rifa-videira-kids`. Se a tela oferecer validade, uma data depois do fim da campanha (ex.: 31/01/2027) reduz o estrago de um vazamento.
4. Copie o token **uma vez** e cole direto no GitHub (1.2). Não guarde em arquivo, e-mail ou WhatsApp. Se perder, gere outro.

Onde fica: **só** no segredo `CLOUDFLARE_API_TOKEN` do repositório no GitHub (1.2). O id da conta Cloudflare não é segredo e já está no `.github/workflows/ci.yml`.

**c) Wrangler na sua máquina (para os comandos das seções 2 e 3).**

```sh
git clone <repositório> && cd rifa-videira-kids
npm ci                 # Node 22 (veja .nvmrc)
npx wrangler login     # abre o navegador para autorizar a sua conta Cloudflare
npx wrangler whoami    # confere a conta
```

A sessão do Claude na nuvem também roda comandos D1 remotos (`CLAUDE.md`), então o SM pode fazer as consultas e o bookmark. O `npm run acesso:criar` (3.1) é melhor rodar na sua máquina: o link impresso é uma credencial e ficaria no histórico da sessão.

### 1.2 GitHub

O CI publica na Cloudflare a cada push na `main`, depois dos testes. O job **"lint, typecheck, test, build"** constrói o site e o Worker sem segredo nenhum e guarda o build; o job **"publicar na Cloudflare"** recebe só esse build, confere e publica, e só o passo que publica recebe o token (`docs/decisions.md`, D18). Sem o segredo, o job de publicação só avisa "Segredo CLOUDFLARE_API_TOKEN não configurado no repositório: publicação pulada" e o CI fica verde.

1. **Antes**, peça ao SM o bookmark do D1 (seção 2.1). Depois do segredo cadastrado, o próximo push na `main` já publica.
2. No repositório: **Settings → Secrets and variables → Actions → New repository secret**.
3. Nome: `CLOUDFLARE_API_TOKEN`. Valor: o token de 1.1 b. Salve.

Funciona em qualquer plano do GitHub. **Reforço opcional, depois do lançamento e só com o GitHub Pro:** guardar o token num ambiente `producao` restrito à `main`, para que um workflow alterado noutra branch não consiga lê-lo. No plano Free, ambientes não existem em repositório privado. Se tiver o Pro e quiser, avise o SM: o passo a passo e a ordem (criar o ambiente, o SM ligar o ambiente no CI, só então apagar o segredo do repositório) estão na D18 do `docs/decisions.md`.

Documentação oficial: **"Using secrets in GitHub Actions"** (GitHub Docs).

### 1.3 Rifei

A Rifei faz a venda, o pagamento e o sorteio. O sistema só recebe os pedidos pelo webhook. Detalhes e links oficiais: [integracao-rifei.md, seção 12](integracao-rifei.md#12-rifei-e-efí-passo-a-passo-para-o-po).

**Campanha e slug** ([12.1](integracao-rifei.md#121-criar-a-campanha-na-rifei-e-achar-o-slug)):

- Crie em rifei.com.br ("Criar minha campanha") ou no app Rifei. Só maiores de 18 anos criam campanha.
- Para vender, pague a **taxa de liberação**. Ela é por campanha, e o plano depende do preço e da quantidade de bilhetes:
  - Econômico, R$ 97,00: bilhete de até R$ 5,00 e até 1.000 bilhetes;
  - Padrão, R$ 199,90: qualquer preço de bilhete e até 100.000 bilhetes;
  - Premium e Pro: para mais bilhetes.
- Com bilhete acima de R$ 5,00 (ex.: R$ 20,00), o plano mínimo é o Padrão. Confira os valores na página de Preços da Rifei antes de pagar. O plano é decisão do PO (1.5).
- A campanha precisa estar publicada e **aceitando pedidos antes da compra de teste e da reunião dos líderes** (o líder inicia uma compra pelo próprio link para o código aparecer; seção 5).
- **Slug:** é o fim do link público da campanha, `rifei.com.br/<slug>`. Copie sem a barra. Ele vai em **Slug da campanha na Rifei** no sistema (3.3).
- O preço do bilhete na Rifei precisa ser o mesmo do sistema (3.3).
- Depois de configurar o sistema, não troque o título da campanha na Rifei sem conferir o link: não se sabe se o slug muda junto (NÃO DOCUMENTADO).

**Afiliados** ([12.3](integracao-rifei.md#123-afiliados-programa-da-campanha-e-líderes)): cada líder de célula vira afiliado da campanha. É pelo código de afiliado que a venda chega à célula.

- Na Rifei, o cadastro de afiliado é **só por convite**: o organizador manda o convite, o líder se cadastra com o e-mail e entra pela **"Área de afiliados"** (menu da página da campanha).
- A Central de Ajuda da Rifei não tem artigo sobre afiliados. Onde ligar os afiliados, onde gerar o convite, o formato do link de afiliado e onde ver o código de cada afiliado: NÃO DOCUMENTADO.
- Por isso, **mande já as perguntas prontas da [12.7](integracao-rifei.md#127-perguntas-prontas-para-o-suporte-da-rifei)** ao suporte da Rifei (WhatsApp, de segunda a sábado, das 9h às 21h de Brasília). Passe as respostas ao SM.
- Os convites vão para os líderes antes da reunião (5.1, item 4).
- Não confunda com o "Indique e Ganhe": é o programa de indicação da própria Rifei, não o afiliado da campanha.

**Webhook** ([12.4](integracao-rifei.md#124-webhook-caminho-conferido)): é da conta, não da campanha. Faça só depois do segredo do Worker (3.2). Caminho conferido na documentação oficial: ícone do usuário → **Integrações** → seção **Outro** → **Adicionar**. Detalhes em 3.2.

**Exportar pedidos** ([12.5](integracao-rifei.md#125-exportar-pedidos-caminho-conferido), para a conferência da seção 6.4): página de pedidos da campanha no painel → **⋮** → **Exportar Pedidos**.

### 1.4 Conta Efí

A Efí recebe os Pix das vendas da Rifei. O sistema não fala com a Efí. Passo a passo com os links oficiais: [12.2](integracao-rifei.md#122-ligar-a-efí-à-rifei-recebimento-do-pix).

- **Que conta:** a Rifei pede **Efí Pro** (pessoa física, CPF) ou **Efí Empresas** (CNPJ ativo e regular). A conta pessoal "Efí Para você" não basta.
  - Na Efí Empresas, a conta é aberta em nome do responsável legal do CNPJ. Para organização religiosa, a Efí pede o estatuto social, a ata de constituição e a ata de eleição da diretoria atual.
  - Já tem "Efí Para você"? O upgrade para Efí Pro é grátis e sem análise. Para Efí Empresas, é uma conta nova.
  - O titular é decisão do PO (1.5).
- **Faça primeiro** (12.2, passo A, pelo app no celular): a Efí não publica quanto tempo leva a análise da conta e avisa por e-mail quando termina. Sem a conta aprovada, não há compra de teste.
- **Ligar à Rifei** (12.2, passos B a E), depois da aprovação: certificado, aplicação com as permissões do Pix, chave Pix aleatória e, por fim, colar tudo na Rifei.
  - **O certificado e a aplicação exigem o computador** (plataforma web da Efí, no navegador). Deixe a Efí e o painel da Rifei abertos em abas: o certificado só pode ser baixado uma vez e vai direto para a Rifei.
  - Onde fica a Efí no painel da Rifei (na conta ou em cada campanha): NÃO DOCUMENTADO (pergunta 4 da 12.7).
- **Onde ficam as credenciais:** a Client Secret e o certificado ficam só na Rifei (e, se quiser guardar, num gerenciador de senhas seu). Nunca no WhatsApp, no e-mail, no DevMission ou no projeto.
- **Tarifa:** a página de tarifas da Efí mostra 1,19% por Pix recebido pela API. Confira a da sua conta na Efí.
- A compra de teste (seção 4) é o que prova que o dinheiro cai na conta certa.

### 1.5 Decisões do PO

O PO decidiu que as regras da campanha ficam configuráveis pela coordenação, na tela **Campanha** do site. O que é do sistema se preenche lá; o resto fica fora do sistema.

**Preencher na tela Campanha** (**Coordenação → Campanha**; admin ou coordenação; passo a passo em 3.3):

- [ ] **Datas e períodos** (cartão "Datas e períodos"): "Data de início" (23/11/2026), "Fuso horário" (`America/Belem`) e os "Períodos", cada um com nome, dias e "Percentual (%)".
  - O botão **Usar o modelo de Santo André** preenche 10, 7 e 7 dias com 35/25/45% (fim em 16/12).
  - A tela mostra a data final e a soma dos percentuais. Se a soma não der 100% (35/25/45 dá 105%), a conta normaliza sozinha.
- [ ] **Preço do bilhete** (cartão "Bilhete e meta", campo "Preço do bilhete (R$)"): o mesmo da Rifei.
- [ ] **Meta** (cartão "Bilhete e meta"):
  - "Unidade da meta": bilhetes vendidos ou valor arrecadado;
  - "Regra da meta": por pessoa da célula, total da campanha dividido pelas células, ou igual para todas as células;
  - o valor da meta (o nome do campo muda com a regra).
- [ ] **Critério do ranking** (cartão "Ranking e público"): percentual da meta atingido, bilhetes vendidos ou valor arrecadado.
- [ ] **O que o público vê** (cartão "Ranking e público", "O que o público vê"): "Mostrar também o percentual da meta atingido" e "Quantas posições o público vê" (padrão 3; em branco, todas).

Mudar qualquer um depois muda os números da campanha inteira, inclusive dos dias que passaram (3.3). Para entender como o sistema conta, leia as suposições S1 a S22 de [regras-de-calculo.md](regras-de-calculo.md#3-suposições-para-o-po).

Hoje fora da tela Campanha: **links para discipuladores e redes**. O admin decide na hora de gerar os links (5.1, item 1): só para os líderes ou também para discipuladores e redes. <!-- RIFA-029 -->

**Decidir fora do sistema** (o PO decide e passa ao SM, para o DevMission):

- [ ] **Titular da conta Efí:** Efí Pro (CPF) ou Efí Empresas (CNPJ), e em nome de quem. Os Termos da Rifei falam em receber "em contas de sua titularidade": o caminho seguro é o mesmo titular da conta da Rifei (1.4).
- [ ] **Plano da Rifei:** pelo preço e pela quantidade de bilhetes (1.3).
- [ ] **Compra de teste:** manter o bilhete (o dinheiro fica para a causa e o bilhete vale no sorteio) ou estornar (4.4).
- [ ] **Autorização do sorteio:** o FAQ da Rifei ("Preciso de autorização para fazer uma campanha?", em [rifei.com.br](https://rifei.com.br/#faq), lido em 11/11/2026) avisa que as regras variam conforme o lugar e que é essencial conferir as normas antes de começar. No Brasil, ele cita a SECAP e o pedido pelo Sistema de Controle de Promoção Comercial (SCPC). A Rifei diz que a plataforma não pede essas autorizações: ficam com o organizador. Aqui só se registra o aviso; não é parecer jurídico.
- [x] **Workers Paid:** sim (a conferência por CSV exige: 1.1 a).

---

## 2. Primeira publicação e como conferir

### 2.1 Antes: bookmark do Time Travel do D1 [Thiago ou SM]

O Time Travel do D1 permite voltar o banco a um instante anterior. Anote o ponto de antes da primeira publicação (pedido da D12). O SM faz isto da sessão dele: avise-o antes de cadastrar o token (1.2).

```sh
npx wrangler d1 time-travel info DB          # mostra o bookmark de agora
npx wrangler d1 migrations list DB --remote  # lista as migrações que ainda vão rodar
```

- O bookmark **não é segredo**: anote no DevMission (nota da RIFA-023) com a data e a hora.
- A lista de migrações deve trazer as de `migrations/` que ainda não rodaram em produção.
- A Cloudflare guarda esse histórico por 30 dias no Workers Paid (no gratuito, menos: veja **"Time Travel"** na documentação do D1).

### 2.2 Publicar

1. **[SM]** Confira que a última execução do CI na `main` está verde.
2. **[Thiago]** Com o bookmark anotado (2.1), crie o token (1.1 b) e cadastre direto no segredo `CLOUDFLARE_API_TOKEN` do repositório (1.2).
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
5. **Migrações aplicadas:** `npx wrangler d1 migrations list DB --remote` não deve listar nenhuma pendente. O log do passo "Publicar" no GitHub também mostra as que rodaram. A migração `0004` (conferência por CSV, RIFA-012) entrou na `main` depois da `0005` à `0007`: num banco que já tenha essas, o wrangler aplica a `0004` por último (aplica, por nome, as que faltam), com o mesmo resultado (`src/worker/test/migracao-0004-depois.test.ts`).
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
- **Sem a sua máquina pronta:** o SM pode rodar o mesmo comando da sessão dele e te passar o link. Nesse caso, e sempre que o link aparecer em qualquer lugar além do seu terminal: entre uma vez, gere um link novo para você em **Acessos → Coordenação** (no seu cartão, **Gerar link novo**) e use **Revogar link** no primeiro.

Depois, no site **[Admin]**: **Acessos → Coordenação → Nova pessoa** (nome, e-mail opcional, papel). O link aparece uma vez, com **Copiar link** e **Enviar pelo WhatsApp**: mande só para a própria pessoa.

- Crie **um segundo admin**: o sistema não deixa desativar o último admin nem revogar o último link válido de admin, e com dois ninguém fica preso.
- O resto da equipe (inclusive quem cuida do bumbo) entra com o papel **coordenação**.

### 3.2 Segredo do webhook e webhook na Rifei [Thiago]

O segredo se chama `RIFEI_WEBHOOK_TOKEN`.

1. Gere um token forte e grave como segredo do Worker:
   ```sh
   openssl rand -hex 32                        # gera o token (não salve em arquivo)
   npx wrangler secret put RIFEI_WEBHOOK_TOKEN # cole o token quando pedir
   npx wrangler secret list                    # deve listar o nome RIFEI_WEBHOOK_TOKEN (sem o valor)
   ```
   Sem `openssl` (ex.: Windows), gere com o Node: `node -e "console.log(require('node:crypto').randomBytes(32).toString('hex'))"`. Em hexadecimal o token só tem letras e números, sem `+`, `/` ou `=` que um formulário possa cortar.
2. Na Rifei ([12.4](integracao-rifei.md#124-webhook-caminho-conferido)): ícone do usuário → **Integrações** → role até **Outro** → **Adicionar** no webhook.
   - **URL:** `https://rifa-videira-kids.madruga.workers.dev/api/webhooks/rifei`
   - **Token:** o mesmo do passo 1. A Rifei chama o token de opcional, mas **para o sistema ele é obrigatório**: sem ele, toda entrega é recusada e se perde.
   - **Eventos:** os três: "Novo pedido", "Pedido pago" e "Pedido expirado".
   - Toque em **Adicionar**.
3. Confira: o teste de 2.3 item 6 passa a responder `nao_autenticado` (401), e não mais `nao_configurado`.

Onde fica o token: **só** no segredo do Worker (Cloudflare) e no webhook da Rifei. Não precisa guardar cópia: para trocar, gere outro e mude primeiro o Worker, depois a Rifei. Entre os dois passos as entregas recebem 401 e se perdem (seção 7.1).

### 3.3 Campanha [Admin, com as decisões do PO]

No site: **Coordenação → Campanha**. Preencha com o que o PO decidiu (1.5):

- **Identificação:** "Nome da campanha" e **Slug da campanha na Rifei** (o fim do link da campanha, 1.3).
- **Datas e períodos:** "Data de início" `23/11/2026`, "Fuso horário" `America/Belem` e os períodos (o botão **Usar o modelo de Santo André** preenche 10/7/7 dias com 35/25/45%).
- **Bilhete e meta:** preço do bilhete (R$), unidade, regra e valor da meta.
- **Ranking e público:** critério do ranking e o que o público vê (o % da meta e quantas posições).
- **Ativar a campanha** (pede confirmação). A partir daí, as vendas da Rifei com esse slug contam.

Cuidados:

- **Sem campanha ativa, ou com o slug errado, o webhook ignora os pedidos** (a entrega aparece como "Outra campanha" em **Pedidos → Entregas do webhook**) e o código do afiliado não aparece na Adesão. Trocar o slug depois pede confirmação.
- O preço do bilhete também serve para marcar pedidos estranhos (seção 4.2): com um preço diferente do da Rifei, pedidos normais podem cair na lista de suspeitos.
- Os números são recalculados na leitura: mudar meta, preço, períodos ou percentuais depois muda os números da campanha inteira, inclusive dos dias que passaram. Combine com o PO antes.
- Cada salvamento fica na trilha de auditoria (`campanha.salvar`, com o slug e o preço de antes e de depois).

### 3.4 Planilha das 36 células [Coordenação]

Siga [importar-hierarquia.md](importar-hierarquia.md). Em resumo: **Coordenação → Hierarquia →** aba **Importar planilha** → **Baixe o modelo** → **Escolha o arquivo** → **Conferir** (não grava nada) → **Importar**.

- Confira no resultado: 36 células criadas, sem erros. Leia os avisos (coluna ignorada não entra).
- Preencha `lider_telefone`: é ele que abre o WhatsApp do líder na hora de mandar o link (5.1) e de cobrar quem falta (5.3).
- A importação nunca apaga e pode ser repetida com a planilha corrigida.

### 3.5 Vinculação de afiliados (visão geral)

**Na Rifei** ([12.3](integracao-rifei.md#123-afiliados-programa-da-campanha-e-líderes)): o organizador manda o convite de afiliado, o líder se cadastra com o e-mail e pega o link de afiliado dele. A venda feita por esse link chega com o código de afiliado (`affiliate_id`) do líder. Onde o líder acha o link e onde o organizador vê o código de cada afiliado: NÃO DOCUMENTADO (perguntas 2 e 3 da [12.7](integracao-rifei.md#127-perguntas-prontas-para-o-suporte-da-rifei)).

**No sistema:** a célula sai do vínculo afiliado → célula (`docs/integracao-rifei.md`, D7). O vínculo é feito em **Coordenação → Adesão** de dois jeitos:

- **Fila "Sem célula":** quando o líder inicia uma compra pelo próprio link de afiliado (sem pagar), o código aparece na fila em segundos. Toque em **Vincular** e escolha a célula.
- **Código digitado:** se o líder souber o código (ou se o suporte da Rifei disser onde o organizador o vê), em **Todas as células** → a célula → **Código de afiliado** → **Salvar código** (pré-cadastro). Uma célula pode ter mais de um código (**Adicionar outro código**).

O roteiro da reunião está na seção 5. Regra de ouro: **não use "Desvincular" num afiliado que já vendeu**, a não ser de propósito: todas as vendas dele, inclusive as antigas, saem da célula na hora.

---

## 4. Compra de teste de ponta a ponta

**Quando:** depois de 3.1 a 3.4, com a Efí ligada à Rifei (1.4), e **antes de 23/11** (veja 4.4). **Quem:** Thiago, de preferência com uma segunda conta da Rifei como afiliada, cadastrada pelo convite (12.3), para responder às perguntas da seção 9 de `docs/integracao-rifei.md`; e um admin olhando o sistema.

### 4.1 Os passos

1. Com a conta afiliada de teste, abra o link de afiliado dela e **inicie uma compra sem pagar**. Em segundos, o **"Afiliado <código>"** aparece em **Adesão → Sem célula**. Vincule a uma célula.
   - De preferência, use como afiliada de teste a conta de um **líder de verdade** (ex.: alguém da coordenação que lidera uma célula) e vincule à célula dele: o vínculo já vale para a campanha. O sistema não apaga afiliado: uma conta só de teste ficaria vinculada a uma célula ou, desvinculada, parada na fila "Sem célula".
   - Se a entrega chegar (4.2) e nada aparecer em "Sem célula", o código de afiliado não veio no pedido: chame o SM antes da reunião dos líderes.
2. **Faça uma compra paga de 1 bilhete** (Pix pela Efí), pelo mesmo link de afiliado.
3. Inicie **outra compra e não pague**: depois do prazo de reserva, a Rifei avisa que expirou.

### 4.2 O que olhar

- **Visão geral** (painel): aparece o aviso de venda "antes do início", que **não conta em nada** (ex.: compra de teste). Meta, ranking, bumbo, telão e a visão do líder continuam zerados (contagem regressiva).
- **Adesão:** a célula do teste passa para **Já vendeu**, com 1 pedido aprovado.
- **Pedidos** (**Coordenação → Pedidos**), aba **Pedidos**, do mais recente para o mais antigo:
  - o pedido pago aparece como **Aprovado**, com 1 bilhete e o valor igual ao preço do bilhete;
  - o não pago aparece como **Aguardando pagamento** e, depois do prazo de reserva, **Expirado**;
  - a coluna **Célula** mostra a célula do vínculo (ou "Sem célula (afiliado <código>)", se ainda não vinculou).
- **Pedidos**, aba **Entregas do webhook** (uma linha por entrega da Rifei): esperado **Pedido novo**, **Pedido pago** e **Pedido expirado**, todas **Processada**.
  - **Outra campanha:** o slug do sistema não é o da Rifei (3.3).
  - Nenhuma entrega: o webhook não chegou (URL, token ou eventos na Rifei; seção 7.1).
  - Algo na coluna **Erro e avisos:** a Rifei mandou um campo diferente da documentação. A tela mostra só o campo e o código, nunca dado pessoal: mande um print ao SM.
- **Alerta do webhook** (topo da Visão geral e de Pedidos): depois do teste, mostra só a linha "Última venda recebida há …" (7.1).
- **Trilha de auditoria** (o que a equipe fez) [Admin]: tela **Trilha** no menu da coordenação (`/coordenacao/trilha`), do mais novo para o mais antigo, com "Carregar mais". Confira que aparecem o salvamento da campanha, a importação da hierarquia e os vínculos de afiliado.
- **Pedidos suspeitos:** tela **Pedidos suspeitos** no menu da coordenação (`/coordenacao/pedidos-suspeitos`). Esperado: lista vazia. Se o pedido de teste aparecer, confira o preço do bilhete na Campanha: ele precisa ser igual ao da Rifei.

### 4.3 O que anotar

Responda à lista "O que confirmar com uma campanha de teste" de [integracao-rifei.md](integracao-rifei.md#9-o-que-confirmar-com-uma-campanha-de-teste): formato do link de afiliado, onde ver o código do afiliado na Rifei, se o pedido pago depois de expirar volta como pago (Efí), tempo de reserva, colunas do "Exportar Pedidos". Junte as respostas do suporte da Rifei (12.7). Mande ao SM para o DevMission. Os payloads reais **não** vão para o repositório com dados pessoais.

### 4.4 O pedido de teste depois

**Fazer o teste antes de 23/11 resolve quase tudo.** Venda aprovada antes do 1º dia fica fora de meta, realizado, ranking, bumbo, telão e visão do líder; só aparece no aviso "antes do início" da Visão geral (`docs/regras-de-calculo.md`, S8). O que continua mostrando o teste: a lista de **Pedidos**, a **Adesão** (a célula fica "Já vendeu") e os totais do afiliado. Não atrapalha a campanha.

O bilhete comprado é de verdade e entra no sorteio. Decisão do PO (1.5): manter (o dinheiro foi para a causa) ou estornar.

**Para estornar** ([12.6](integracao-rifei.md#126-estorno-de-um-pedido)), nesta ordem:

1. **Efí:** devolva o Pix. No app: "Menu" → "Extrato" → a transação → "Devolver valor".
2. **Rifei:** remova ou ajuste o pedido **antes de 7 dias da reserva**. Pedido pago reservado há 7 dias ou mais fica bloqueado e não pode ser removido (Termos de uso da Rifei, item 5.7). Ex.: teste no dia 17/11, remova até o dia 23/11. Como remover no painel: NÃO DOCUMENTADO (pergunta 5 da 12.7). Depois do sorteio, nada mais se remove.
3. **Sistema:** a Rifei não avisa estorno nem remoção (só pedido novo, pago e expirado), então o pedido continua no sistema como aprovado. Hoje o sistema não tem como tirar um pedido (nenhuma tela nem rota). Como o teste está fora da janela, isso não muda nenhum número. <!-- RIFA-028 -->

Se um teste for feito **depois de 23/11**, ele conta como venda (e é: o dinheiro entrou). Hoje, tirar só é possível direto no D1, com SQL, sem trilha de auditoria: só com decisão do PO. <!-- RIFA-028 -->

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
   - Se o PO quiser (1.5), repita com o papel **Discipuladores** e **Redes**. <!-- RIFA-029 -->
   - Cada link vale 45 dias: gerado na semana da reunião, cobre a campanha inteira.
2. **Convite no grupo dos líderes [Coordenação]** (sugestão de texto, sem link nenhum):
   > Reunião de cadastro da Rifa Videira Kids: <dia>, <hora>, <local>. Traga o celular carregado, com o WhatsApp e o acesso ao e-mail do cadastro de afiliado da Rifei (por convite, que você recebe antes). Você já recebeu no privado o seu link pessoal do sistema: não repasse.
3. **Ensaiar a Adesão:** abra **Coordenação → Adesão** no aparelho que vai ser usado na reunião (celular ou notebook). Ela se atualiza sozinha a cada 15 s e tem **Atualizar agora**.
4. **Convites de afiliado [Thiago]:** na Rifei, o cadastro de afiliado é só por convite do organizador ([12.3](integracao-rifei.md#123-afiliados-programa-da-campanha-e-líderes)). Mande a cada líder o convite antes da reunião, pelo caminho que o suporte indicar (pergunta 1 da [12.7](integracao-rifei.md#127-perguntas-prontas-para-o-suporte-da-rifei)). Onde gerar o convite: NÃO DOCUMENTADO. Tenha à mão também onde o líder acha o link de afiliado dele (pergunta 2).

### 5.2 Durante

1. **Cada líder abre o link pessoal** que recebeu e toca em **Entrar**. Ele vê a tela da célula dele (`/minha`), ainda com a contagem regressiva. O limite de 60 entradas por minuto do mesmo Wi-Fi comporta a reunião.
2. **Adesão na Rifei:** cada líder abre o convite de afiliado que recebeu (5.1, item 4), faz o cadastro com o e-mail e entra pela **"Área de afiliados"** (menu da página da campanha). Depois pega o link de afiliado dele ([12.3](integracao-rifei.md#123-afiliados-programa-da-campanha-e-líderes)).
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
- Não precisa de login. Mostra jovens e adultos lado a lado, só posições e nomes (e o % da meta, se a Campanha estiver configurada para mostrar). Atualiza sozinho a cada minuto; se a internet cair, fica com o último dado e volta sozinho.
- Teste no projetor de verdade antes do primeiro culto.
- O ranking público para mandar nos grupos é a página inicial: https://rifa-videira-kids.madruga.workers.dev/

### 6.3 Acompanhamento [Coordenação]

- **Visão geral:** meta do dia, situação (em dia ou abaixo), curva e projeção, por campanha, divisão, rede, discipulador ou célula. Os avisos de "sem célula" pedem uma olhada na Adesão. No topo, o alerta do webhook (7.1).
- **Rankings:** com valores, para a coordenação.
- **Mapa:** de onde vêm as vendas aprovadas, por estado e por DDD do telefone do comprador (só o DDD é guardado).
- **Adesão:** a fila **Sem célula** deve ficar vazia. Código novo ali = venda de afiliado sem vínculo: vincule.
- **Pedidos:** a lista dos pedidos (filtro por status e por célula, busca pelo id da Rifei) e as entregas do webhook.
- **Líderes, discipuladores e redes** acompanham pelo próprio link (`/minha`), sem valores em reais.
- **Pedidos suspeitos** (mais de 200 bilhetes num pedido ou valor fora do preço): uma vez por semana, um coordenador abre a tela **Pedidos suspeitos** e confere na Rifei. Eles continuam contando; hoje o sistema não tira pedido (4.4), e tirar é decisão do PO. <!-- RIFA-028 -->

### 6.4 Conferência pelo CSV (RIFA-012; exige o Workers Paid)

A conferência **exige o Workers Paid** (1.1 a): no plano gratuito, a análise de uma campanha cheia passa do limite de CPU por requisição e a Cloudflare pode recusá-la (erro 1102).

1. Na Rifei: pedidos da campanha → **⋮** → **Exportar Pedidos**.
2. **Coordenação → Conferência:** escolha o arquivo como a Rifei baixou (sem abrir e salvar no Excel). O arquivo é lido no navegador e os dados pessoais não saem dele.
3. Confira o mapeamento das colunas, leia as diferenças e use **Recuperar** para as vendas pagas na Rifei que não chegaram pelo webhook. Elas passam a contar no painel, nos rankings e no bumbo.

Sugestão: uma conferência por semana e sempre que o webhook falhar (7.1). O aviso de webhook parado (na **Visão geral** e em **Pedidos**) leva direto para cá (**Abrir a Conferência**).

### 6.5 Se algo cair: onde olhar e quem chamar

**Importante:** a venda acontece na Rifei. Se o nosso site cair, a Rifei continua vendendo e recebendo; o que para é o painel, e as entregas do webhook nesse intervalo podem se perder, porque a Rifei não documenta reenvio (recuperação pela conferência, 6.4).

| Onde olhar | O quê |
|---|---|
| https://rifa-videira-kids.madruga.workers.dev/status | "API ok" ou o erro |
| **Coordenação → Pedidos** (o alerta no topo e a aba **Entregas do webhook**) | se a Rifei está mandando e o que o sistema fez com cada entrega |
| GitHub → **Actions** | se a última publicação falhou |
| Cloudflare → **Workers & Pages** → `rifa-videira-kids` → logs (procure por **"Logs"** ou **"Observability"** na página do Worker; documentação oficial: **"Workers Logs"**) | erros do Worker (os logs ficam ligados no `wrangler.jsonc`; o nosso código só registra ids e erros, nunca dado do comprador) |
| `npx wrangler tail rifa-videira-kids --format pretty` [Thiago] | os logs ao vivo |
| www.cloudflarestatus.com | problema geral da Cloudflare |
| Suporte da Rifei (WhatsApp, 12.7) | venda, pagamento ou webhook do lado da Rifei |

**Quem chamar:** quem notar avisa a coordenação; a coordenação chama o **Thiago**, que abre uma sessão do Claude (SM) com o sintoma, a hora e o print. Problema de pagamento ou de pedido na Rifei: suporte da Rifei (e da Efí, se for o Pix).

---

## 7. Plano de contingência

### 7.1 O webhook parou

**Sinal:** o alerta no topo da **Visão geral** e de **Pedidos**, ou vendas pagas na Rifei que o painel não mostra.

O alerta consulta o sistema a cada 5 minutos, com a tela aberta:

- **"A Rifei mandou pedidos com erro nas últimas 24 h":** o botão **Ver as entregas com erro** abre as entregas recusadas. Confira cada pedido na Rifei.
- **"Nenhuma venda chegou há N horas":** durante a campanha, das 8h às 22h, depois de 4 horas sem venda. O botão **Abrir a Conferência** leva à conferência pelo CSV (6.4).
- **"Ainda não chegou nenhuma venda":** nenhuma entrega da campanha até agora.
- Tudo certo: só uma linha discreta, "Última venda recebida há …".
- Limites: um webhook que pare depois das 18h só acende o alerta no dia seguinte, ao meio-dia. Entrega recusada por token errado não fica gravada: o alerta mostra como se nenhuma venda tivesse chegado.

1. **Veja as entregas [Coordenação]:** **Pedidos** → aba **Entregas do webhook** (a mais recente no topo; filtre por **Resultado**). Sem acesso ao site, o SM consulta o mesmo no D1 (tabela `webhook_eventos`).
2. **Ache a causa:**
   - Nada chega: o webhook continua cadastrado na Rifei, com a URL certa, o token e os três eventos (3.2)? O site está no ar (6.5)?
   - Muitas **Outra campanha** (algumas são normais: outras campanhas da mesma conta da Rifei; quando só chegam essas, o alerta sugere conferir o slug): o slug mudou (renomear a campanha na Rifei pode mudar o slug) ou a campanha do sistema não está ativa. Corrija o slug em **Campanha**.
   - **Recusada:** a entrega veio com erro e não foi gravada. A coluna **Erro e avisos** diz o campo e o código: mande um print ao SM e confira o pedido na Rifei.
   - O teste de 2.3 item 6 responde `nao_configurado`: o segredo sumiu do Worker. Refaça 3.2.
   - Os logs mostram erro 1102 ou limite diário: o plano gratuito estourou. Assine o Workers Paid (1.1 a).
3. **Recupere** as vendas perdidas pela conferência por CSV (6.4).

### 7.2 O site caiu

1. Confira 6.5: `/status`, a última publicação no GitHub e o status da Cloudflare.
2. Se começou depois de uma publicação: `npx wrangler rollback -m "<motivo>"` volta o código para a versão anterior (veja as versões com `npx wrangler deployments list` e os cuidados em 2.4). Depois, o SM corrige na `main`.
3. Se um dado estragado derrubou o sistema: volte o banco com o Time Travel (2.4) para um instante antes do problema. **Tudo gravado depois se perde**: recupere as vendas pela conferência (6.4) e refaça as revogações de link desse intervalo. Antes de qualquer mudança arriscada no meio da campanha (importação grande, migração nova), anote um bookmark novo (2.1).
4. Avise os líderes no grupo que as vendas pela Rifei continuam normais.

### 7.3 Um link pessoal vazou (revogar) [Admin]

- **De alguém da coordenação** (vê tudo, inclusive valores): **Acessos → Coordenação** → o cartão da pessoa → **Revogar link** em cada link válido → **Gerar link novo** e mande só para a pessoa. A revogação derruba as sessões abertas por aquele link.
  - O último link válido de admin não pode ser revogado: gere o novo primeiro.
  - Para tirar o acesso de vez: **Desativar acesso** (derruba todas as sessões da pessoa).
  - **Se alguém pode ter entrado com o link:** veja na trilha de auditoria (4.2) o que esse usuário fez depois do vazamento. Um link de coordenação muda campanha, hierarquia e vínculos; um de admin também cria pessoas e links (`usuario.criar`, `link.criar`, `acessos_hierarquia.gerar_links`). Desfaça o que não foi a equipe: em **Acessos**, revogue os links que ele gerou e desative as pessoas que ele criou.
- **De um líder, discipulador ou rede** (vê só os números do alvo dele, sem reais): **Acessos → Líderes, discipuladores e redes** → **Trocar acesso** na linha. Gera um link novo, revoga os anteriores e tira do sistema o aparelho que estava com o link velho. Mande o novo para a pessoa certa. <!-- RIFA-029 -->
- **Os links públicos** (`/` e `/telao`) não têm segredo: não há o que revogar.
- **Vazou um token [Thiago]:**
  - `RIFEI_WEBHOOK_TOKEN`: gere outro e troque primeiro no Worker, depois na Rifei (3.2). As entregas entre os dois passos se perdem: confira pelo CSV (6.4).
  - `CLOUDFLARE_API_TOKEN`: em **API Tokens** na Cloudflare, apague ou renove o token e cadastre o novo no segredo `CLOUDFLARE_API_TOKEN` do GitHub (1.2; no ambiente `producao`, se o reforço da D18 estiver ligado).
  - Credenciais da Efí (Client Secret ou certificado): crie na Efí um certificado e uma aplicação novos e cadastre de novo na Rifei (12.2, passos B, C e E).

### 7.4 Um líder trocou (trocar acesso)

1. **Hierarquia → Células → Editar célula:** novo nome e telefone do líder (ou corrija a planilha e importe de novo).
2. **[Admin]** **Acessos → Líderes, discipuladores e redes → Trocar acesso** na célula: o link novo vai para o novo líder e o aparelho do antigo sai.
3. O novo líder recebe o convite de afiliado da Rifei (5.1, item 4), e a coordenação vincula o código dele na **Adesão** (**Adicionar outro código** na célula).
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

1. ~~Conferência por CSV (RIFA-012) fora da `main`~~: resolvido na RIFA-012 (tela **Conferência**, 6.4). Exige o Workers Paid (1.1 a).
2. ~~Tela de Pedidos (RIFA-003) em construção~~: resolvido na RIFA-025 (tela **Pedidos**, com a lista dos pedidos e as entregas do webhook; 4.2).
3. ~~Sem tela para a trilha de auditoria e para os pedidos suspeitos~~: resolvido na RIFA-024 (telas **Trilha** e **Pedidos suspeitos**).
4. **Sem exclusão de pedido** (teste, fraude ou estorno): hoje, só por SQL no D1, sem trilha de auditoria. Decisão do PO. <!-- RIFA-028 -->
5. ~~Sem alerta de webhook parado~~: resolvido na RIFA-025 (alerta na Visão geral e em Pedidos; 7.1). Fica o limite: entrega recusada por token errado não é gravada (o alerta mostra como se nenhuma venda tivesse chegado), e um webhook que pare de noite só acende o alerta no dia seguinte.
6. **Estorno ou cancelamento na Rifei não chega ao sistema** (a Rifei só avisa pedido novo, pago e expirado): pedido aprovado e depois estornado continua contando. A ordem do estorno (Efí → Rifei, antes de 7 dias da reserva → sistema) está em 4.4 e na [12.6](integracao-rifei.md#126-estorno-de-um-pedido). <!-- RIFA-028 -->
7. **Adesão e totais do afiliado não separam a compra de teste:** a célula do teste aparece como "Já vendeu". E não há como apagar um afiliado (o de teste fica no sistema). <!-- RIFA-028 -->
8. **Rifei e Efí:** o passo a passo está na [seção 12 de integracao-rifei.md](integracao-rifei.md#12-rifei-e-efí-passo-a-passo-para-o-po). Ainda NÃO DOCUMENTADO pela Rifei: onde ligar os afiliados e gerar o convite, o formato do link de afiliado, onde ver o código de cada afiliado, onde adicionar a Efí e o nome do campo da chave Pix. Vão para o suporte (12.7) e para a compra de teste (seção 9).
9. **Vínculo afiliado → célula sem data:** trocar ou desvincular é retroativo (7.4).
10. **Primeira publicação sem volta do código:** não há versão anterior para o `wrangler rollback`; só o Time Travel do banco.
