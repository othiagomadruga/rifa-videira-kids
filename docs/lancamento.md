# Roteiro de lançamento (RIFA-023)

Passo a passo para colocar a Rifa Videira Kids no ar e conduzir a campanha, que começa em **23/11/2026**. Escrito para o Thiago (PO, dono das contas) e para a coordenação. Site: https://rifa-videira-kids.madruga.workers.dev

## O que o Thiago faz, em ordem

Siga de cima para baixo. Cada passo leva à seção com os detalhes.

1. **Abrir a conta Efí, já.** Efí Pro (CPF) ou Efí Empresas (CNPJ), pelo app. A Efí não publica o prazo da análise. Antes, decida quem é o titular. → [1.4](#14-conta-efí) e [1.5](#15-decisões-do-po)
2. **Assinar o Workers Paid** na Cloudflare. A conferência pelo CSV exige. → [1.1 a](#11-cloudflare)
3. **Token da Cloudflare no GitHub.** Antes de criar o token, peça ao SM o ponto de volta do banco (bookmark) e espere ele dizer que anotou: com o token no GitHub, qualquer mudança na `main` já publica. → [2.1](#21-antes-bookmark-do-time-travel-do-d1-thiago-ou-sm), [1.1 b](#11-cloudflare) e [1.2](#12-github)
4. **Avisar o SM que o token está salvo.** Ele publica, confere o site, cria o primeiro admin pela sessão dele e te manda o link. Abra, gere um link novo para você, entre pelo novo e só então revogue o primeiro. → [2.2](#22-publicar) e [3.1](#31-primeiro-admin-sm-depois-thiago)
5. **Campanha na Rifei.** Escolha o plano pelo preço do bilhete, pague a taxa de liberação e anote o slug. → [1.3](#13-rifei)
6. **Afiliados na Rifei.** Mande já as perguntas prontas ao suporte da Rifei. Com as respostas, ligue os afiliados e prepare os convites dos líderes. Com o formato do link de afiliado confirmado, grave o modelo do **link de vendas** na Adesão: é dele que saem o link e o QR code de cada célula. → [1.3](#13-rifei) e [3.6](#36-link-de-vendas-e-qr-code-das-células-admin)
7. **Efí na Rifei**, quando a Efí aprovar a conta. Faça num computador. → [1.4](#14-conta-efí)
8. **Token do webhook e webhook na Rifei, de uma vez, pelo site** (sem Node nem terminal): em **Acessos → Webhook da Rifei**, gere o token, copie e cole direto na Rifei, com a URL e os três eventos. → [3.2](#32-token-do-webhook-e-webhook-na-rifei-thiago)
9. **Preencher a Campanha no site** e ativar: nome, slug da Rifei, datas, preço, meta, ranking, o que o público vê e as regras de pedidos e acessos (as mensagens do link são opcionais). → [1.5](#15-decisões-do-po) e [3.3](#33-campanha-admin-com-as-decisões-do-po)
10. **Planilha das 36 células** (a coordenação pode fazer). → [3.4](#34-planilha-das-36-células-coordenação)
11. **Compra de teste** de 1 bilhete, antes de 23/11. → [4](#4-compra-de-teste-de-ponta-a-ponta)
12. **Reunião dos líderes**: antes, os convites de afiliado e os links pessoais. → [5](#5-reunião-de-cadastro-dos-líderes)

Depois da largada, o dia a dia é da coordenação (seção 6). Se algo cair: seção 7.

## Como ler este roteiro

- **Quem faz:** **[Thiago]** (contas de terceiros; o caminho principal não pede Node nem terminal, e os comandos com a conta Cloudflare ficam como alternativa), **[SM]** (a sessão do Claude que orquestra: merge, registro e comandos no D1), **[Admin]** (quem tem o papel admin no sistema), **[Coordenação]** (admin ou coordenação).
- **PENDÊNCIA** marca o que o sistema ainda não faz e o lançamento precisaria. A lista completa está no fim.
- **NÃO DOCUMENTADO** quer dizer que a fonte oficial (Rifei ou Efí) não diz. Confira na tela ou pergunte ao suporte.
- **Dicas na tela:** com o mouse parado em cima de um botão ou campo, aparece uma explicação curta do que ele faz (no celular, o toque não abre dica). Um botão apagado não faz nada ao clicar, e a dica dele diz por quê (ex.: **Importar** antes de **Conferir** a planilha). **Esc** fecha a dica; dentro de uma janela (diálogo), o primeiro Esc fecha só a dica e o segundo fecha a janela.
- O passo a passo da Rifei e da Efí, com os links oficiais, está em [integracao-rifei.md, seção 12](integracao-rifei.md#12-rifei-e-efí-passo-a-passo-para-o-po). Aqui fica o resumo.
- **Credenciais** (o token da Cloudflare, o token do webhook, a Client Secret e o certificado da Efí e o seu link de admin) não passam por chat (nem o do SM), e-mail ou WhatsApp, e não vão para este documento, o git ou o DevMission. Aqui só se diz **onde** cada uma fica. Se uma delas passar por algum desses lugares, troque (3.1 e 7.3). A exceção combinada é o primeiro link de admin: o SM o cria pela sessão e o manda no chat, e você o troca logo ao entrar (3.1). O token do webhook vai do site direto para a Rifei (3.2). Os links pessoais da equipe e dos líderes vão só no WhatsApp privado da própria pessoa (3.1 e 5.1), nunca em grupo.

## Ordem geral

Cada etapa depende da anterior. As datas são sugestão; quem decide é o PO.

| # | Etapa | Quem | Prazo sugerido |
|---|---|---|---|
| 0 | Abrir a conta Efí e as decisões fora do sistema (1.5) | Thiago | já |
| 1 | Contas: Cloudflare (Workers Paid) e Rifei (campanha e perguntas ao suporte) | Thiago | até 14/11 |
| 2 | Bookmark do D1, depois o token da Cloudflare no GitHub, primeira publicação e conferência | Thiago e SM | até 14/11 |
| 3 | Configuração em produção: admin, token do webhook e webhook na Rifei, Campanha, planilha das células, a Efí ligada à Rifei e o modelo do link de vendas (quando a Rifei confirmar o formato) | SM, Thiago e Admin | até 16/11 |
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
4. Copie o token **uma vez** e cole direto no GitHub (1.2). Não guarde em arquivo, e-mail, WhatsApp ou chat. Se perder, gere outro.

Onde fica: **só** no segredo `CLOUDFLARE_API_TOKEN` do repositório no GitHub (1.2). O id da conta Cloudflare não é segredo e já está no `.github/workflows/ci.yml`.

**c) Wrangler na sua máquina (opcional: só para os caminhos alternativos).**

```sh
git clone <repositório> && cd rifa-videira-kids
npm ci                 # Node 22 (veja .nvmrc)
npx wrangler login     # abre o navegador para autorizar a sua conta Cloudflare
npx wrangler whoami    # confere a conta
```

O lançamento não depende disto. A sessão do Claude na nuvem roda os comandos D1 remotos (`CLAUDE.md`): o SM faz as consultas, o bookmark (2.1) e o primeiro admin (3.1), e o token do webhook sai pelo site (3.2). Com a sua máquina pronta, você pode rodar o `npm run acesso:criar` você mesmo (o link não passa pelo chat) ou usar o segredo do Worker no lugar do token do site (alternativa da 3.2).

### 1.2 GitHub

O CI publica na Cloudflare a cada push na `main`, depois dos testes. O job **"lint, typecheck, test, build"** constrói o site e o Worker sem segredo nenhum e guarda o build; o job **"publicar na Cloudflare"** recebe só esse build, confere e publica, e só o passo que publica recebe o token (`docs/decisions.md`, D18). Sem o segredo, o job de publicação só avisa "Segredo CLOUDFLARE_API_TOKEN não configurado no repositório: publicação pulada" e o CI fica verde. O mesmo segredo serve ao workflow manual **Voltar o site para a versão anterior** (2.4), no mesmo padrão: só o passo que volta a versão recebe o token.

1. **Antes**, peça ao SM o bookmark do D1 (seção 2.1) e espere ele confirmar que anotou. Depois do segredo cadastrado, o próximo push na `main` já publica.
2. No repositório: **Settings → Secrets and variables → Actions → New repository secret**.
3. Nome: `CLOUDFLARE_API_TOKEN`. Valor: o token de 1.1 b. Salve.

Funciona em qualquer plano do GitHub. **Reforço opcional, depois do lançamento e só com o GitHub Pro:** guardar o token num ambiente `producao` restrito à `main`, para que um workflow alterado noutra branch não consiga lê-lo. No plano Free, ambientes não existem em repositório privado. Se tiver o Pro e quiser, avise o SM: o passo a passo e a ordem (criar o ambiente, o SM ligar o ambiente no CI e no workflow da volta, só então apagar o segredo do repositório) estão na D18 do `docs/decisions.md`.

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

- Na Rifei, o afiliado se cadastra **por convite**: o organizador manda o convite, o líder se cadastra com o e-mail e entra pela **"Área de afiliados"** (menu da página da campanha). É o que mostra a conta de demonstração da Rifei; se dá para liberar o cadastro sem convite: NÃO DOCUMENTADO.
- A Central de Ajuda da Rifei não tem artigo sobre afiliados. Onde ligar os afiliados, onde gerar o convite, o formato do link de afiliado e onde ver o código de cada afiliado: NÃO DOCUMENTADO.
- Por isso, **mande já as perguntas prontas da [12.7](integracao-rifei.md#127-perguntas-prontas-para-o-suporte-da-rifei)** ao suporte da Rifei (WhatsApp, de segunda a sábado, das 9h às 21h de Brasília). Passe as respostas ao SM. A do formato do link de afiliado (pergunta 2) vira o modelo do link de vendas das células (3.6).
- Os convites vão para os líderes antes da reunião (5.1, item 4).
- Não confunda com o "Indique e Ganhe": é o programa de indicação da própria Rifei, não o afiliado da campanha.

**Webhook** ([12.4](integracao-rifei.md#124-webhook-caminho-conferido)): é da conta, não da campanha. Faça junto com o token gerado no site (3.2). Caminho conferido na documentação oficial: ícone do usuário → **Integrações** → seção **Outro** → **Adicionar**. Detalhes em 3.2.

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
- [ ] **Pedidos e acessos** (cartão "Pedidos e acessos", uma caixa de marcar por regra):
  - "Permitir desconsiderar pedidos" (padrão desligada): ligada, o admin tira das contas um pedido de teste, fraude ou estorno, e desfaz, na tela **Pedidos** (4.4). Desligar depois não devolve às contas o que já foi desconsiderado;
  - "Acesso dos discipuladores" e "Acesso das redes" (padrão ligados): links pessoais também para discipuladores e redes (5.1, item 1), que veem as células deles, sem reais. Desligado, eles não entram nem recebem link novo; os links já mandados voltam a valer quando religar. O líder de célula entra sempre.
- [ ] **Mensagens do link pessoal** (cartão "Mensagens do link pessoal"; opcional): o texto do WhatsApp de cada tipo de link (coordenação, líder, discipulador e rede). O padrão é o texto de 5.1; a tela mostra como fica e não deixa salvar sem o `{link}`. O bumbo não muda aqui.

Mudar datas, períodos, preço, meta ou critério depois muda os números da campanha inteira, inclusive dos dias que passaram (3.3). Para entender como o sistema conta, leia as suposições S1 a S22 de [regras-de-calculo.md](regras-de-calculo.md#3-suposições-para-o-po).

As regras de pedidos e acessos e as mensagens podem mudar a qualquer hora: ligar ou desligar uma regra não muda nenhum número. Quem muda a Campanha (admin ou coordenação) muda também essas regras.

**Decidir fora do sistema** (o PO decide e passa ao SM, para o DevMission):

- [ ] **Titular da conta Efí:** Efí Pro (CPF) ou Efí Empresas (CNPJ), e em nome de quem. Os Termos da Rifei falam em receber "em contas de sua titularidade": o caminho seguro é o mesmo titular da conta da Rifei (1.4).
- [ ] **Plano da Rifei:** pelo preço e pela quantidade de bilhetes (1.3).
- [ ] **Compra de teste:** manter o bilhete (o dinheiro fica para a causa e o bilhete vale no sorteio) ou estornar (4.4). Nos dois casos, o admin pode desconsiderar o pedido no sistema (4.4).
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
3. **[SM ou Thiago, pelo celular]** Dispare a publicação com um push na `main` ou, sem nada novo para subir, no GitHub: **Actions** → **CI** → **Run workflow** → branch `main` (o padrão) → **Run workflow**. Ele constrói e publica a `main` como um push (RIFA-035, D22); noutra branch, só constrói. Também serve **Re-run jobs** → **Re-run all jobs** na última execução da `main` (o "all" refaz o build, que vale só 1 dia).

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
6. **Webhook fechado:** antes do token do webhook (3.2), ele recusa tudo:
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
  - O token do webhook gerado no site depois do ponto some, e volta a valer o que valia no ponto (o token anterior ou o segredo do Worker, mesmo que tenha vazado): o webhook passa a recusar as entregas da Rifei. Gere de novo e cole na Rifei (3.2).
  - Voltar para antes de uma migração apaga o que ela criou: a próxima publicação aplica de novo (ou o SM, na hora: `npx wrangler d1 migrations apply DB --remote`). Até lá, o que depende dela falha: para antes da `0009` (token do site), o webhook responde 500 a toda entrega.
- **Voltar o código a uma versão anterior [Thiago, pelo celular]** (RIFA-035, D22): no GitHub, **Actions** → **Voltar o site para a versão anterior** → **Run workflow** → branch `main` (o padrão) → em **motivo**, o porquê numa linha (até 120 caracteres; fica no histórico da Cloudflare) → **versao** vazio (volta para a anterior à que está no ar) → **Run workflow**. Acompanhe a execução até o fim: o resumo dela lista as publicações recentes (data, id da versão, origem e mensagem; as de código e as de segredo, como a da alternativa da 3.2), e o último passo confere `/api/health`.
  - **O rollback não mexe no banco:** só o código volta; pedidos, vínculos e acessos ficam como estão. Para o banco, veja o Time Travel acima.
  - **Na primeira publicação não existe versão anterior:** o workflow termina com erro dizendo isso (só o Time Travel do banco volta algo). Sem o segredo `CLOUDFLARE_API_TOKEN`, ele só avisa "volta da versão pulada".
  - **Segredos que mudaram depois daquela versão** (ex.: `RIFEI_WEBHOOK_TOKEN`): o workflow **não** confirma sozinho e termina com erro ("Os segredos do site mudaram..."), sem mudar nada no site: aquela versão tem os segredos de antes, e o webhook pode parar ou voltar ao token antigo. Rode de novo com, em **versao**, o id de uma versão publicada depois da troca do segredo (a lista está no resumo da execução que falhou; também em Cloudflare → **Workers & Pages** → `rifa-videira-kids` → **Deployments**).
  - **Para desfazer a volta:** rode de novo com o id da versão que estava no ar (o resumo diz qual era) ou publique a `main` de novo (2.2). Um push na `main` também publica por cima da volta: até a correção, o SM não faz merge de outra coisa na `main`.
  - **Rodar de novo com versao vazio logo depois de uma volta** (um toque a mais, um **Re-run**) não volta mais nem desfaz a volta: o workflow termina com erro ("O site já está numa versão que voltou..."), sem mudar nada. Para voltar mais, informe em **versao** o id da versão desejada.
  - Uma volta e uma publicação nunca rodam ao mesmo tempo: a segunda espera a primeira terminar. Se chegar outra enquanto uma espera, a que esperava é cancelada (aparece como cancelada em **Actions**): confira e rode de novo, se ainda precisar.
  - **Pelo terminal (alternativa, com o Node e a conta Cloudflare):** `npx wrangler deployments list` mostra as últimas publicações e `npx wrangler rollback -m "<motivo>"` volta para a anterior. Se o wrangler avisar que segredos mudaram desde aquela versão, responda **não** e escolha uma versão mais nova pelo id: `npx wrangler rollback <id da versão> -m "<motivo>"`. Só num terminal em que você responde às perguntas: sem interação (a sessão do Claude, um script, o CI), o `wrangler rollback` responde "sim" sozinho e volta com os segredos de antes (D22). Ali, use `npx wrangler versions deploy <id da versão>@100% --message="<motivo>" --yes`, que nunca força.
  - **Não volte para uma versão de antes da RIFA-039** (o token do webhook pelo site): ela só conhece o segredo do Worker, e o webhook passa a recusar tudo (503, ou 401 com um segredo antigo) até a versão nova voltar. Se for inevitável, grave o segredo do Worker com um token novo e cole o mesmo token na Rifei (alternativa da 3.2). Ao voltar para a versão nova, o token do site (que continua no banco) volta a ter prioridade sobre esse segredo: antes, o SM apaga o token do site (`DELETE FROM token_webhook`, 3.2), ou gere de novo no site e cole na Rifei.
  - Depois do rollback, refaça o teste de 2.3 item 6: com o 3.2 já feito, precisa dar `nao_autenticado` (401).

---

## 3. Configuração inicial em produção

### 3.1 Primeiro admin [SM, depois Thiago]

1. **[SM]** Da sessão dele, logo depois da primeira publicação (2.2):
   ```sh
   npm run acesso:criar -- --nome "<nome do Thiago>" --papel admin --remote --origem https://rifa-videira-kids.madruga.workers.dev
   ```
   O link `https://rifa-videira-kids.madruga.workers.dev/acesso/<token>` aparece uma vez, no terminal da sessão, e o SM o manda ao Thiago no chat da sessão. Como passou pelo chat, esse link é só para a primeira entrada: o passo 2 o troca.
2. **[Thiago]** Abra o link no navegador e toque em **Entrar**: você cai na área `/coordenacao`. Então, nesta ordem:
   1. **Acessos → Coordenação** → no seu cartão, **Gerar link novo** → **Copiar link**;
   2. abra o link novo numa aba nova e toque em **Entrar**;
   3. só então, já dentro pelo link novo, use **Revogar link** no primeiro, o que veio do SM. **No seu cartão, ele é o de baixo:** a lista vem do mais novo para o mais antigo, e o de cima é o link novo, com o qual você acabou de entrar: ele vem marcado **Este aparelho** ("Você entrou por este link neste aparelho"). Confira pelo "Criado em" (o do SM é o mais antigo). Revogar derruba a sessão aberta por ele, e o link novo só aparece uma vez: por isso ele vem antes. O sistema também não deixa revogar o último link válido de admin.
      - Tocou em **Revogar link** no de cima? Ele pede uma confirmação própria, **"Revogar o link deste aparelho?"**, que avisa que você sai do sistema aqui, com o botão **Revogar e sair**: toque em **Cancelar** e revogue o de baixo.
      - Revogou o de cima por engano? A sessão cai e o link novo para de valer. Abra de novo o link do SM (ele ainda vale) e recomece do item 1.
3. Guarde o link novo só para você (ex.: no gerenciador de senhas). Ele vale 45 dias e pode ser aberto de novo nesse prazo (outro aparelho, como o seu celular). Uma sessão parada há mais de 7 dias cai; é só abrir o link de novo.

- O script só aceita `--nome`, `--papel` (`admin` ou `coordenacao`), `--remote`, `--local` e `--origem` (`docs/acesso.md`, seção 5). Não existe opção de e-mail.
- **Alternativa, com a sua máquina pronta (1.1 c):** rode você mesmo o comando do passo 1. O link aparece só no seu terminal, sem passar pelo chat; abra e toque em **Entrar** (o passo 2 fica opcional).

Depois, no site **[Admin]**: **Acessos → Coordenação → Nova pessoa** (nome, e-mail opcional, papel). O link aparece uma vez, com **Copiar link** e **Enviar pelo WhatsApp**: mande só para a própria pessoa.

- Crie **um segundo admin**: o sistema não deixa desativar o último admin nem revogar o último link válido de admin, e com dois ninguém fica preso.
- O resto da equipe (inclusive quem cuida do bumbo) entra com o papel **coordenação**.

### 3.2 Token do webhook e webhook na Rifei [Thiago]

O token do webhook sai do site: não precisa de Node nem de terminal (`docs/decisions.md`, D21). Faça com o site e a Rifei abertos ao mesmo tempo (no computador, em duas abas; no celular, alternando entre o navegador e a Rifei): o token vai da tela direto para a Rifei, sem passar por WhatsApp, e-mail ou chat.

1. **No site [Admin]:** **Acessos → Webhook da Rifei → Gerar token do webhook**. O token aparece **uma vez só**, com **Copiar**, junto com a URL do webhook.
   - Se já houver um token (ou o segredo do Worker da alternativa abaixo), gerar outro pede confirmação: o anterior para de valer na hora, e as vendas que chegarem antes de você colar o novo na Rifei se perdem (recupere pela conferência, 6.4). Faça a troca fora do horário de pico.
2. **Na Rifei** ([12.4](integracao-rifei.md#124-webhook-caminho-conferido)): ícone do usuário → **Integrações** → role até **Outro** → **Adicionar** no webhook (ou edite o webhook que já existe).
   - **URL:** `https://rifa-videira-kids.madruga.workers.dev/api/webhooks/rifei` (a tela mostra, com **Copiar**).
   - **Token:** cole o token copiado no passo 1. A Rifei chama o token de opcional, mas **para o sistema ele é obrigatório**: sem ele, toda entrega é recusada e se perde.
   - **Eventos:** os três: "Novo pedido", "Pedido pago" e "Pedido expirado".
   - Toque em **Adicionar** (ou salve).
3. **Confira:** o teste de 2.3 item 6 passa a responder `nao_autenticado` (401), e não mais `nao_configurado`. Depois da compra de teste (seção 4), a tela **Webhook da Rifei** mostra o **último uso**; se continuar "ainda não usado" depois de um pedido, o token na Rifei não é o do site: gere outro e cole de novo.

Onde fica o token: **só** no webhook da Rifei. O sistema guarda só um resumo (hash) que não deixa reconstruí-lo, e a tela nunca o mostra de novo. Não guarde cópia: perdeu ou vazou, gere outro (passo 1) e cole na Rifei. Cada geração fica na trilha de auditoria, sem o token.

**Alternativa com o wrangler** (quem tiver a máquina pronta, 1.1 c; é o único caminho enquanto a tela da RIFA-039 não estiver no ar). O segredo se chama `RIFEI_WEBHOOK_TOKEN`:

```sh
openssl rand -hex 32                        # gera o token (não salve em arquivo)
npx wrangler secret put RIFEI_WEBHOOK_TOKEN # cole o token quando pedir
npx wrangler secret list                    # deve listar o nome RIFEI_WEBHOOK_TOKEN (sem o valor)
```

Sem `openssl` (ex.: Windows), gere com o Node: `node -e "console.log(require('node:crypto').randomBytes(32).toString('hex'))"`. Em hexadecimal o token só tem letras e números, sem `+`, `/` ou `=` que um formulário possa cortar. Depois, cole o mesmo token na Rifei (passo 2) e confira (passo 3).

- **O token do site tem prioridade:** com um token gerado pelo site, o segredo do Worker não vale. Gerar o primeiro token no site, com o segredo configurado, também para as vendas até colar o novo na Rifei (a tela pede confirmação).
- Para voltar ao segredo depois de usar o site (contingência): com o segredo já gravado no Worker (comandos acima), o SM apaga o token do site no D1 (`npx wrangler d1 execute DB --remote --command "DELETE FROM token_webhook"`) e você cola o valor do segredo na Rifei logo em seguida. Entre os dois, as entregas recebem 401; sem o segredo gravado, o webhook passa a responder 503.
- Para trocar o segredo: gere outro e mude primeiro o Worker, depois a Rifei. Entre os dois passos as entregas recebem 401 e se perdem (seção 7.1).

### 3.3 Campanha [Admin, com as decisões do PO]

No site: **Coordenação → Campanha**. Preencha com o que o PO decidiu (1.5):

- **Identificação:** "Nome da campanha" e **Slug da campanha na Rifei** (o fim do link da campanha, 1.3).
- **Datas e períodos:** "Data de início" `23/11/2026`, "Fuso horário" `America/Belem` e os períodos (o botão **Usar o modelo de Santo André** preenche 10/7/7 dias com 35/25/45%).
- **Bilhete e meta:** preço do bilhete (R$), unidade, regra e valor da meta.
- **Ranking e público:** critério do ranking e o que o público vê (o % da meta e quantas posições).
- **Pedidos e acessos:** "Permitir desconsiderar pedidos" (ligue antes da compra de teste, se o PO quiser tirá-la das contas: 4.4), "Acesso dos discipuladores" e "Acesso das redes". Só o admin muda estas regras e as mensagens (a coordenação as vê só leitura).
- **Mensagens do link pessoal** (opcional): um modelo por tipo de link, com os marcadores `{saudacao}`, `{nome}`, `{alvo}` e `{link}` (obrigatório, no começo ou depois de um espaço ou de uma quebra de linha; nenhum outro endereço na mensagem). A pré-visualização mostra a mensagem pronta; **Voltar ao texto padrão** desfaz a edição. Se editar, mantenha as palavras "link pessoal" no texto: o guia do líder ("Perdi o link") manda procurar por elas na conversa.
- **Ativar a campanha** (pede confirmação). A partir daí, as vendas da Rifei com esse slug contam.

Cuidados:

- **Sem campanha ativa, ou com o slug errado, o webhook ignora os pedidos** (a entrega aparece como "Outra campanha" em **Pedidos → Entregas do webhook**) e o código do afiliado não aparece na Adesão. Trocar o slug depois pede confirmação.
- O preço do bilhete também serve para marcar pedidos estranhos (seção 4.2): com um preço diferente do da Rifei, pedidos normais podem cair na lista de suspeitos.
- Os números são recalculados na leitura: mudar meta, preço, períodos ou percentuais depois muda os números da campanha inteira, inclusive dos dias que passaram. Combine com o PO antes.
- Cada salvamento fica na trilha de auditoria (`campanha.salvar`, com o slug e o preço de antes e de depois, as regras que mudaram e o nome da mensagem alterada). O primeiro, que ativa a campanha, registra "Campanha criada" com o slug, o preço, as três chaves (desconsiderar pedidos, acesso dos discipuladores e acesso das redes, cada uma ligada ou desligada) e o nome das mensagens editadas, sem o texto delas.

### 3.4 Planilha das 36 células [Coordenação]

Siga [importar-hierarquia.md](importar-hierarquia.md). Em resumo: **Coordenação → Hierarquia →** aba **Importar planilha** → **Baixar modelo** → **Escolher arquivo** → **Conferir** (não grava nada) → **Importar**.

- Confira no resultado: 36 células criadas, sem erros. Leia os avisos (coluna ignorada não entra).
- Preencha `lider_telefone`: é ele que abre o WhatsApp do líder na hora de mandar o link (5.1) e de cobrar quem falta (5.3).
- A importação nunca apaga e pode ser repetida com a planilha corrigida.

### 3.5 Vinculação de afiliados (visão geral)

**Na Rifei** ([12.3](integracao-rifei.md#123-afiliados-programa-da-campanha-e-líderes)): o organizador manda o convite de afiliado, o líder se cadastra com o e-mail e pega o link de afiliado dele. A venda feita por esse link chega com o código de afiliado (`affiliate_id`) do líder. Onde o líder acha o link e onde o organizador vê o código de cada afiliado: NÃO DOCUMENTADO (perguntas 2 e 3 da [12.7](integracao-rifei.md#127-perguntas-prontas-para-o-suporte-da-rifei)).

**No sistema:** a célula sai do vínculo afiliado → célula (`docs/integracao-rifei.md`, D7). O vínculo é feito em **Coordenação → Adesão** de dois jeitos:

- **Fila "Sem célula":** quando o líder inicia uma compra pelo próprio link de afiliado (sem pagar), o código aparece na fila em segundos. Toque em **Vincular** e escolha a célula.
- **Código digitado:** se o líder souber o código (ou se o suporte da Rifei disser onde o organizador o vê), em **Todas as células** → a célula → **Código de afiliado** → **Salvar código** (pré-cadastro). Uma célula pode ter mais de um código (**Adicionar outro código**).

O roteiro da reunião está na seção 5. Regra de ouro: **não use "Desvincular" num afiliado que já vendeu**, a não ser de propósito: todas as vendas dele, inclusive as antigas, saem da célula na hora.

### 3.6 Link de vendas e QR code das células [Admin]

O link de vendas de uma célula é o link de afiliado do líder na Rifei, montado pelo sistema a partir de um **modelo** (`docs/decisions.md`, D24). A compra feita por ele chega com o código do afiliado e conta para a célula; o QR code abre o mesmo link. Pix mandado direto para uma chave, fora da Rifei, nunca entra no sistema.

- **Antes:** o formato do link de afiliado da Rifei é NÃO DOCUMENTADO (pergunta 2 da [12.7](integracao-rifei.md#127-perguntas-prontas-para-o-suporte-da-rifei); também se vê na compra de teste, seção 4). Até a resposta, deixe o modelo vazio: o líder vê "A coordenação ainda não liberou o link de vendas." e usa o link da Área de afiliados na Rifei.
- **Onde:** **Coordenação → Adesão** → seção **Links de vendas**, no fim da tela → campo **Modelo do link de vendas** → **Salvar modelo**. Só o admin muda; a coordenação vê o campo só leitura ("Só o admin muda o modelo.").
- **O modelo:** o link de afiliado da Rifei com `{slug}` no lugar do slug da campanha e `{afiliado}` no lugar do código do afiliado. Ex. (o formato real ainda não está confirmado): `https://rifei.com.br/{slug}?afiliado={afiliado}`. Ele precisa começar por `https://rifei.com.br/`. A tela mostra os problemas enquanto você digita e a **prévia**, com o link de um afiliado já vinculado: abra a prévia e confira que ela cai na campanha certa da Rifei antes de salvar.
- **Depois de salvar,** cada célula com afiliado vinculado tem o link e o QR na hora:
  - o líder vê **Seu link de vendas** na tela dele (`/minha`), com **Copiar link**, **Enviar no WhatsApp** e o QR code (**Baixar imagem** e **Imprimir**); o discipulador e a rede veem **Links de vendas das suas células**, com **Ver QR**;
  - na Adesão, **Link de cada célula** tem o link e o QR de cada uma (o **Enviar no WhatsApp** abre a conversa com o telefone do líder) e **Imprimir os QR codes** (uma folha por célula com link).
- Célula sem afiliado vinculado fica "Sem link". Célula com mais de um código mostra todos, o mais recente em destaque: todos contam para ela.
- O salvamento fica na trilha (`campanha.salvar`, com o modelo de antes e o de depois). Trocar o slug na Campanha (3.3) muda os links na hora.
- **Confira com a compra de teste (4.1, passo 2):** a compra feita pelo QR code da célula precisa cair nela. Se cair em "Sem célula" ou em outra célula, o modelo não bate com o link da Rifei: apague-o (campo vazio → **Salvar modelo**) até acertar.

---

## 4. Compra de teste de ponta a ponta

**Quando:** depois de 3.1 a 3.4, com a Efí ligada à Rifei (1.4), e **antes de 23/11** (veja 4.4). **Quem:** Thiago, de preferência com uma segunda conta da Rifei como afiliada, cadastrada pelo convite (12.3), para responder às perguntas da seção 9 de `docs/integracao-rifei.md`; e um admin olhando o sistema.

### 4.1 Os passos

1. Com a conta afiliada de teste, abra o link de afiliado dela e **inicie uma compra sem pagar**. Em segundos, o **"Afiliado <código>"** aparece em **Adesão → Sem célula**. Vincule a uma célula.
   - De preferência, use como afiliada de teste a conta de um **líder de verdade** (ex.: alguém da coordenação que lidera uma célula) e vincule à célula dele: o vínculo já vale para a campanha.
   - Uma conta só de teste dá para tirar depois **[Admin]**: desconsidere **todos** os pedidos dela (4.4), não só o pago: também a compra iniciada no passo 1 e a do passo 3, que expiraram (pedido de qualquer status conta). Depois toque em **Remover** no afiliado, na **Adesão** (na fila "Sem célula" ou em **Todas as células**), e confirme em **Remover afiliado**. Se ainda faltar algum, o sistema recusa e lista os pedidos que ainda contam, com o link de cada um: desconsidere esses e tente de novo. Se a Rifei mandar outra venda com o mesmo código, ele volta para a fila "Sem célula".
   - Se a entrega chegar (4.2) e nada aparecer em "Sem célula", o código de afiliado não veio no pedido: chame o SM antes da reunião dos líderes.
2. **Faça uma compra paga de 1 bilhete** (Pix pela Efí), pelo mesmo link de afiliado. Com o modelo do link de vendas gravado (3.6), faça esta compra **pelo QR code da célula** (na tela do líder ou em **Adesão → Links de vendas → Ver QR**): o pedido precisa aparecer na célula (4.2). Se cair noutro lugar, apague o modelo até acertar com a Rifei.
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
- **Alerta do webhook** (topo da Visão geral e de Pedidos): depois do teste, mostra só a linha "Última entrega da Rifei há …" (7.1). Ele consulta o sistema a cada 5 minutos: com a tela aberta desde antes do teste, pode continuar mostrando "Ainda não chegou nenhuma venda" por até 5 minutos. Recarregue a página para ver na hora.
- **Trilha de auditoria** (o que a equipe fez) [Admin]: tela **Trilha** no menu da coordenação (`/coordenacao/trilha`), do mais novo para o mais antigo, com "Carregar mais". Confira que aparecem o salvamento da campanha, a importação da hierarquia e os vínculos de afiliado.
- **Pedidos suspeitos:** tela **Pedidos suspeitos** no menu da coordenação (`/coordenacao/pedidos-suspeitos`). Esperado: lista vazia. Se o pedido de teste aparecer, confira o preço do bilhete na Campanha: ele precisa ser igual ao da Rifei.

### 4.3 O que anotar

Responda à lista "O que confirmar com uma campanha de teste" de [integracao-rifei.md](integracao-rifei.md#9-o-que-confirmar-com-uma-campanha-de-teste): formato do link de afiliado, onde ver o código do afiliado na Rifei, se o pedido pago depois de expirar volta como pago (Efí), tempo de reserva, colunas do "Exportar Pedidos". Junte as respostas do suporte da Rifei (12.7). Mande ao SM para o DevMission. Os payloads reais **não** vão para o repositório com dados pessoais.

### 4.4 O pedido de teste depois

**Fazer o teste antes de 23/11 resolve quase tudo.** Venda aprovada antes do 1º dia fica fora de meta, realizado, ranking, bumbo, telão e visão do líder; só aparece no aviso "antes do início" da Visão geral (`docs/regras-de-calculo.md`, S8). O que continua mostrando o teste: a lista de **Pedidos**, a **Adesão** (a célula fica "Já vendeu") e os totais do afiliado. Não atrapalha a campanha.

**Para tirar o teste também da Adesão e dos totais [Admin]:** com "Permitir desconsiderar pedidos" ligada na Campanha (3.3), em **Pedidos**, toque em **Desconsiderar** na linha do pedido, escolha o **Motivo** (**Teste**) e confirme. O pedido sai de todas as contas (inclusive do relatório da campanha, 6.3, onde aparece só no número "Pedidos desconsiderados") e continua na lista, com o selo "Desconsiderado (teste)" (no filtro **Desconsiderados**, **Só os desconsiderados** mostra só eles). **Desfazer** devolve o pedido às contas. Cada um fica na trilha de auditoria. Não mexe na Rifei nem no dinheiro: o bilhete continua valendo no sorteio.

O bilhete comprado é de verdade e entra no sorteio. Decisão do PO (1.5): manter (o dinheiro foi para a causa) ou estornar.

**Para estornar** ([12.6](integracao-rifei.md#126-estorno-de-um-pedido)), nesta ordem:

1. **Efí:** devolva o Pix. No app: "Menu" → "Extrato" → a transação → "Devolver valor".
2. **Rifei:** remova ou ajuste o pedido **antes de 7 dias da reserva**. Pedido pago reservado há 7 dias ou mais fica bloqueado e não pode ser removido (Termos de uso da Rifei, item 5.7). Ex.: teste no dia 17/11, remova até o dia 23/11. Como remover no painel: NÃO DOCUMENTADO (pergunta 5 da 12.7). Depois do sorteio, nada mais se remove.
3. **Sistema [Admin]:** a Rifei não avisa estorno nem remoção (só pedido novo, pago e expirado), então o pedido continua no sistema como aprovado. Desconsidere-o em **Pedidos**, com o motivo **Estorno** (como acima).

Se um teste for feito **depois de 23/11**, ele conta como venda (e é: o dinheiro entrou). Tirar das contas é decisão do PO: **Desconsiderar** em **Pedidos**, com o motivo **Teste** (fica na trilha e dá para desfazer).

---

## 5. Reunião de cadastro dos líderes

**Pré-requisitos:** campanha ativa com o slug certo (3.3), webhook ligado (3.2), compra de teste aprovada (4), planilha importada com os telefones (3.4) e a campanha na Rifei aceitando pedidos (1.3).

### 5.1 Antes

1. **Links em lote [Admin]:** **Acessos → Líderes, discipuladores e redes** → Papel **Líderes de célula** → **Gerar links para quem ainda não tem (36)**.
   - Abre uma janela com um link por líder. Em cada um: **Abrir no WhatsApp** (abre a conversa com o número da planilha e a mensagem pronta) ou **Copiar mensagem** (sem telefone ou com número estranho).
   - **Os links só aparecem agora**: mande todos antes de tocar em **Pronto**. Se fechar antes, use **Novo link** na linha do líder.
   - A mensagem padrão é esta (o nome e a célula mudam; o link vem na última linha). Para mudar o texto, edite o modelo na Campanha (cartão "Mensagens do link pessoal", 3.3), nunca na hora de mandar:
     > Olá, Fulano! Este é o seu link pessoal para acompanhar a sua célula (Célula X) na campanha da rifa do Videira Kids: as vendas, a meta e a posição no ranking.
     > O link é só seu: não repasse para ninguém, porque quem tiver o link entra como você.
   - Logo depois, se quiser, mande no mesmo privado a mensagem complementar (sem link) da [seção 1 de convite-reuniao.md](convite-reuniao.md#1-mensagem-do-link-pessoal-no-privado-de-cada-líder).
   - Com o acesso deles ligado na Campanha (1.5; padrão ligado), repita com o papel **Discipuladores** e **Redes**. Desligado, a tela avisa e não gera link desse papel.
   - Cada link vale 45 dias: gerado na semana da reunião, cobre a campanha inteira.
2. **Convite no grupo dos líderes [Coordenação]**, sem link nenhum, depois dos links pessoais: use o texto da [seção 2 de convite-reuniao.md](convite-reuniao.md#2-convite-para-a-reunião-grupo-dos-líderes), que também tem o lembrete da véspera.
3. **Ensaiar a Adesão:** abra **Coordenação → Adesão** no aparelho que vai ser usado na reunião (celular ou notebook). Ela se atualiza sozinha a cada 15 s e tem **Atualizar agora**.
4. **Convites de afiliado [Thiago]:** na Rifei, o cadastro de afiliado é só por convite do organizador ([12.3](integracao-rifei.md#123-afiliados-programa-da-campanha-e-líderes)). Mande a cada líder o convite antes da reunião, pelo caminho que o suporte indicar (pergunta 1 da [12.7](integracao-rifei.md#127-perguntas-prontas-para-o-suporte-da-rifei)). Onde gerar o convite: NÃO DOCUMENTADO. Tenha à mão também onde o líder acha o link de afiliado dele (pergunta 2). O que o líder faz está na [seção 1 do guia do líder](guia-lideres.md#1-vender-pela-rifei-o-seu-link-de-afiliado).
5. **Guia do líder [Coordenação]:** troque os trechos `[confirmar com a Rifei]` de [guia-lideres.md](guia-lideres.md) e de `guia-lideres.html` com as respostas do suporte (12.7) e gere o PDF: abra `guia-lideres.html` no navegador → **Imprimir** → **Salvar como PDF**, A4 retrato (1 página).
6. **Link de vendas [Admin]:** com o formato confirmado pela Rifei, grave o modelo antes da reunião (3.6): cada líder sai da reunião com o link e o QR code na tela dele.

### 5.2 Durante

O roteiro de 20 minutos (o que mostrar e em que ordem) está na [seção 3 de convite-reuniao.md](convite-reuniao.md#3-roteiro-da-reunião-20-minutos). Os passos:

1. **Cada líder abre o link pessoal** que recebeu e toca em **Entrar**. Ele vê a tela da célula dele (`/minha`), ainda com a contagem regressiva. O limite de 60 entradas por minuto do mesmo Wi-Fi comporta a reunião.
2. **Adesão na Rifei:** cada líder abre o convite de afiliado que recebeu (5.1, item 4), faz o cadastro com o e-mail e entra pela **"Área de afiliados"** (menu da página da campanha). Depois pega o link de afiliado dele ([12.3](integracao-rifei.md#123-afiliados-programa-da-campanha-e-líderes)).
3. **Vincular o afiliado à célula, um líder por vez:**
   1. O líder abre o próprio link de afiliado e **inicia uma compra sem pagar**.
   2. Em segundos, **"Afiliado <código>"** aparece no topo de **Sem célula**, na Adesão. Se não aparecer em um minuto, toque em **Atualizar agora**; se ainda assim não vier, confira se o líder usou o link de afiliado dele (e não o link comum da campanha).
   3. Toque em **Vincular**, escolha a célula do líder e confirme. A célula vai para "Vinculada".
   4. Na tela do líder, o aviso amarelo sobre o link de afiliado some sozinho em até 2 minutos, sem recarregar. Com o modelo gravado (3.6), no mesmo instante aparecem o link e o QR code em **Seu link de vendas**.
   - **Um de cada vez:** com dois líderes ao mesmo tempo, não dá para saber qual código é de quem.
   - Se o líder souber o código: **Todas as células** → a célula → **Código de afiliado** → **Salvar código**.
   - A compra iniciada e não paga só reserva números até expirar; nunca conta como venda.
4. **Acompanhe** o resumo no topo da Adesão (células vinculadas, células que já venderam e afiliados sem célula) e a seção **Quem falta**.

### 5.3 Depois

- **Quem falta:** a seção **Quem falta** lista as células sem afiliado, com o líder e o telefone (toque para ligar ou **Copiar**). Cobre um por um até 22/11.
- **Quem não entrou no sistema [Admin]:** em **Acessos → Líderes, discipuladores e redes**, a coluna **Situação** mostra quem nunca usou o link. Reenvie com **Novo link**.
- **Fila "Sem célula" vazia antes de 23/11.** Venda de afiliado sem célula conta no total da campanha, mas em nenhuma célula, rede ou ranking. Vincular depois leva todas as vendas antigas para a célula (nada se perde), mas o ranking fica errado até lá.
- **Guia do líder no grupo:** mande o PDF do guia (5.1, item 5) no grupo dos líderes, para quem quiser rever como vender e o que a tela mostra.
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
- **Adesão:** a fila **Sem célula** deve ficar vazia. Código novo ali = venda de afiliado sem vínculo: vincule. Na seção **Links de vendas** ficam o link e o QR code de cada célula, para mandar ao líder que perdeu o dele ou imprimir (3.6).
- **Pedidos:** a lista dos pedidos (filtro por status, por célula e **Desconsiderados**, busca pelo id da Rifei) e as entregas do webhook. O admin desconsidera ali um pedido de teste, fraude ou estorno (4.4).
- **Líderes, discipuladores e redes** acompanham pelo próprio link (`/minha`), sem valores em reais. O que o líder vê e faz no dia a dia está nas seções [3](guia-lideres.md#3-o-que-você-vê-na-sua-tela) e [4](guia-lideres.md#4-dia-a-dia) do guia do líder.
- **Relatório da campanha** (no fim da **Visão geral**; admin e coordenação): em **O que baixar**, escolha **Totais da campanha**, **Por célula**, **Por discipulador**, **Por rede**, **Por período**, **Por dia** ou **Por DDD** e toque em **Baixar relatório** (`docs/decisions.md`, D23).
  - É uma planilha (CSV) com os números de agora; depois do fim da campanha, o resultado final. No dia seguinte ao último dia, baixe os 7 tipos para guardar e prestar contas.
  - Abre com dois cliques no Excel. No Google Planilhas: **Arquivo → Importar → Fazer upload**, com "Tipo de separador" em "Personalizado" e `;` (ponto e vírgula).
  - As contas fecham entre os arquivos (células + sem célula = totais; períodos, dias e DDD = totais). Os pedidos desconsiderados (4.4) ficam fora de todos; nos totais, só o número deles.
  - Tem valores em reais e o nome dos líderes: fica com a coordenação, nunca nos grupos.
- **Pedidos suspeitos** (mais de 200 bilhetes num pedido ou valor fora do preço): uma vez por semana, um coordenador abre a tela **Pedidos suspeitos** e confere na Rifei. Eles continuam contando até o admin desconsiderá-los em **Pedidos** (motivo **Fraude** ou **Outro**; 4.4), o que é decisão do PO. O desconsiderado continua na lista dos suspeitos, com o selo.

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

O alerta consulta o sistema a cada 5 minutos, com a tela aberta (passar da Visão geral para Pedidos não consulta de novo; para ver na hora, recarregue a página):

- **"A Rifei mandou pedidos com erro nas últimas 24 h":** o botão **Ver as entregas com erro** abre as entregas recusadas. Confira cada pedido na Rifei.
- **"Nenhuma venda chegou há N horas"** (ou **"até agora"**, se nenhuma chegou desde o início): durante a campanha, das 8h às 22h, depois de 4 horas sem venda. O botão **Abrir a Conferência** leva à conferência pelo CSV (6.4).
- **"Ainda não chegou nenhuma venda":** nenhuma entrega da campanha até agora.
- Tudo certo: só uma linha discreta, "Última entrega da Rifei há …". Ela conta qualquer entrega da campanha (pedido novo, pago ou expirado), não só as vendas.
- Limites: um webhook que pare depois das 18h só acende o alerta no dia seguinte, ao meio-dia. Entrega recusada por token errado não fica gravada: o alerta mostra como se nenhuma venda tivesse chegado.

1. **Veja as entregas [Coordenação]:** **Pedidos** → aba **Entregas do webhook** (a mais recente no topo; filtre por **Resultado**). Sem acesso ao site, o SM consulta o mesmo no D1 (tabela `webhook_eventos`).
2. **Ache a causa:**
   - Nada chega: o webhook continua cadastrado na Rifei, com a URL certa, o token e os três eventos (3.2)? O site está no ar (6.5)? **[Admin]** A tela **Acessos → Webhook da Rifei** mostra quando o token foi gerado e o último uso: "ainda não usado" depois de uma venda quer dizer que o token na Rifei não é o do site (gere outro e cole, 3.2).
   - Muitas **Outra campanha** (algumas são normais: outras campanhas da mesma conta da Rifei; quando só chegam essas, o alerta sugere conferir o slug): o slug mudou (renomear a campanha na Rifei pode mudar o slug) ou a campanha do sistema não está ativa. Corrija o slug em **Campanha**.
   - **Recusada:** a entrega veio com erro e não foi gravada. A coluna **Erro e avisos** diz o campo e o código: mande um print ao SM e confira o pedido na Rifei.
   - O teste de 2.3 item 6 responde `nao_configurado`: não há token do site nem segredo do Worker (ex.: depois de voltar o banco ou o código, 2.4). Refaça 3.2.
   - Os logs mostram erro 1102 ou limite diário: o plano gratuito estourou. Assine o Workers Paid (1.1 a).
3. **Recupere** as vendas perdidas pela conferência por CSV (6.4).

### 7.2 O site caiu

1. Confira 6.5: `/status`, a última publicação no GitHub e o status da Cloudflare.
2. Se começou depois de uma publicação, volte o código para a versão anterior **pelo celular**: GitHub → **Actions** → **Voltar o site para a versão anterior** → **Run workflow**, com o motivo e **versao** vazio (os cuidados estão em 2.4: o banco não volta, e com segredos trocados o workflow para e pede o id). No terminal, a alternativa é `npx wrangler rollback -m "<motivo>"`. Depois, o SM corrige na `main`.
3. Se um dado estragado derrubou o sistema: volte o banco com o Time Travel (2.4) para um instante antes do problema. **Tudo gravado depois se perde**: recupere as vendas pela conferência (6.4) e refaça as revogações de link desse intervalo. Antes de qualquer mudança arriscada no meio da campanha (importação grande, migração nova), anote um bookmark novo (2.1).
4. Avise os líderes no grupo que as vendas pela Rifei continuam normais.

### 7.3 Um link pessoal vazou (revogar) [Admin]

- **De alguém da coordenação** (vê tudo, inclusive valores): **Acessos → Coordenação** → o cartão da pessoa → **Revogar link** em cada link válido → **Gerar link novo** e mande só para a pessoa. A revogação derruba as sessões abertas por aquele link.
  - O último link válido de admin não pode ser revogado: gere o novo primeiro.
  - Para tirar o acesso de vez: **Desativar acesso** (derruba todas as sessões da pessoa).
  - **Se alguém pode ter entrado com o link:** veja na trilha de auditoria (4.2) o que esse usuário fez depois do vazamento. Um link de coordenação muda campanha, hierarquia e vínculos; um de admin também cria pessoas e links (`usuario.criar`, `link.criar`, `acessos_hierarquia.gerar_links`). Desfaça o que não foi a equipe: em **Acessos**, revogue os links que ele gerou e desative as pessoas que ele criou.
- **De um líder, discipulador ou rede** (vê só os números do alvo dele, sem reais): **Acessos → Líderes, discipuladores e redes** → **Trocar acesso** na linha. Gera um link novo, revoga os anteriores e tira do sistema o aparelho que estava com o link velho. Mande o novo para a pessoa certa. Com o acesso do papel desligado na Campanha (discipuladores ou redes), **Trocar acesso** e **Novo link** ficam indisponíveis: use **Revogar link** em cada link válido da pessoa (o vazado não volta a valer quando religar) e, depois de religar, mande um **Novo link**.
- **Os links públicos** (`/` e `/telao`) não têm segredo: não há o que revogar.
- **Vazou um token [Thiago]:**
  - **Token do webhook:** gere outro no site (3.2, passo 1: o anterior para de valer na hora) e cole na Rifei. As entregas entre os dois passos se perdem: confira pelo CSV (6.4). Se estiver na alternativa do wrangler, gerar pelo site também neutraliza o `RIFEI_WEBHOOK_TOKEN` vazado (o do site tem prioridade).
  - `CLOUDFLARE_API_TOKEN`: em **API Tokens** na Cloudflare, apague ou renove o token e cadastre o novo no segredo `CLOUDFLARE_API_TOKEN` do GitHub (1.2; no ambiente `producao`, se o reforço da D18 estiver ligado).
  - Credenciais da Efí (Client Secret ou certificado): crie na Efí um certificado e uma aplicação novos e cadastre de novo na Rifei (12.2, passos B, C e E).

### 7.4 Um líder trocou (trocar acesso)

1. **Hierarquia → Células → Editar célula:** novo nome e telefone do líder (ou corrija a planilha e importe de novo).
2. **[Admin]** **Acessos → Líderes, discipuladores e redes → Trocar acesso** na célula: o link novo vai para o novo líder e o aparelho do antigo sai.
3. O novo líder recebe o convite de afiliado da Rifei (5.1, item 4), e a coordenação vincula o código dele na **Adesão** (**Adicionar outro código** na célula). Com o modelo do link de vendas gravado (3.6), o link do novo código aparece em destaque em **Seu link de vendas** (o mais recente primeiro); o do líder antigo continua listado e contando.
4. **Mantenha o código do líder antigo vinculado**, para as vendas dele continuarem na célula. Desvincular tira todas as vendas dele da célula, inclusive as antigas. O vínculo não tem data: se o líder antigo continuar vendendo pelo link dele, a venda continua indo para a célula.

### 7.5 A hierarquia mudou durante a campanha

Tudo é recalculado na leitura, para a campanha inteira, e cada mudança fica na trilha de auditoria. Combine com o PO e avise os líderes antes.

- **Célula mudou de discipulador ou discipulador mudou de rede:** **Editar célula** ou **Editar discipulador** (ou planilha corrigida, sempre com **Conferir** antes). As vendas da célula vão junto, inclusive as antigas; o ranking de discipuladores e redes muda. O acesso de quem está acima acompanha sozinho (em até 30 s).
- **Mudou o número de pessoas:** a meta da célula muda para a campanha inteira, e o ranking por % muda junto. Na regra "Total da campanha, dividido pelas células", a meta das outras células também muda (o total é repartido pelas pessoas).
- **Célula nova:** importe uma planilha com a linha dela (a tela **Hierarquia** não tem cadastro de célula avulsa; o arquivo pode ter só essa linha, com a rede, a divisão e o discipulador escritos como já estão no sistema, senão eles entram como novos ou mudam; sempre com **Conferir** antes, e o esperado é **Criados** 1 em Células e **Atualizados** 0 em tudo). A coluna `rede_responsavel` vazia apaga o responsável da rede (a conferência mostra a rede em **Atualizados**): preencha como está no sistema ou tire a coluna do arquivo. A célula nova ganha meta desde o 1º dia, então começa "abaixo" (e, na regra "Total da campanha, dividido pelas células", diminui a meta das outras). Gere o link do líder (**Gerar links para quem ainda não tem**) e vincule o afiliado.
- **Célula saiu ou juntou com outra:** com afiliado vinculado, ela não pode ser excluída (**Excluir** recusa e diz o porquê). Passe os afiliados para a célula de destino (**Adesão → Todas as células → Trocar**), o que leva todas as vendas deles, e então exclua (o acesso do líder dela cai junto). Não use **Desvincular** aqui: as vendas do afiliado sairiam de todas as células. A importação nunca apaga nada.

---

## Pendências encontradas

O que o sistema ainda não faz e o lançamento precisaria (ou faria melhor com):

1. ~~Conferência por CSV (RIFA-012) fora da `main`~~: resolvido na RIFA-012 (tela **Conferência**, 6.4). Exige o Workers Paid (1.1 a).
2. ~~Tela de Pedidos (RIFA-003) em construção~~: resolvido na RIFA-025 (tela **Pedidos**, com a lista dos pedidos e as entregas do webhook; 4.2).
3. ~~Sem tela para a trilha de auditoria e para os pedidos suspeitos~~: resolvido na RIFA-024 (telas **Trilha** e **Pedidos suspeitos**).
4. ~~Sem exclusão de pedido~~: resolvido na RIFA-028 (**Desconsiderar** na tela Pedidos, só admin, com "Permitir desconsiderar pedidos" ligada na Campanha; fica na trilha e dá para desfazer; 4.4). Desconsiderar continua sendo decisão do PO.
5. ~~Sem alerta de webhook parado~~: resolvido na RIFA-025 (alerta na Visão geral e em Pedidos; 7.1). Fica o limite: entrega recusada por token errado não é gravada (o alerta mostra como se nenhuma venda tivesse chegado), e um webhook que pare de noite só acende o alerta no dia seguinte.
6. **Estorno ou cancelamento na Rifei não chega ao sistema** (a Rifei só avisa pedido novo, pago e expirado): pedido aprovado e depois estornado continua contando até o admin desconsiderá-lo (motivo **Estorno**). A ordem do estorno (Efí → Rifei, antes de 7 dias da reserva → **Desconsiderar** no sistema) está em 4.4 e na [12.6](integracao-rifei.md#126-estorno-de-um-pedido).
7. ~~Adesão e totais do afiliado não separam a compra de teste~~: resolvido nas RIFA-028 e 031. O pedido de teste desconsiderado sai da Adesão (a célula deixa de estar "Já vendeu" por ele) e dos totais do afiliado (4.4); o afiliado só de teste sai com **Remover**, na Adesão [Admin], depois de desconsiderados os pedidos dele (4.1).
8. **Rifei e Efí:** o passo a passo está na [seção 12 de integracao-rifei.md](integracao-rifei.md#12-rifei-e-efí-passo-a-passo-para-o-po). Ainda NÃO DOCUMENTADO pela Rifei: onde ligar os afiliados e gerar o convite, o formato do link de afiliado (sem ele, o modelo do link de vendas fica vazio e as células ficam sem link e sem QR code, 3.6), onde ver o código de cada afiliado, onde adicionar a Efí e o nome do campo da chave Pix. Vão para o suporte (12.7) e para a compra de teste (seção 9). As mesmas respostas fecham os trechos `[confirmar com a Rifei]` do [guia do líder](guia-lideres.md) (seção 1 e "Perdi o link") e do [convite](convite-reuniao.md) (seções 2 e 3): troque-os antes de mandar (5.1, item 5).
9. **Vínculo afiliado → célula sem data:** trocar ou desvincular é retroativo (7.4).
10. ~~Volta do código só pelo terminal~~: resolvido na RIFA-035 (workflow **Voltar o site para a versão anterior**, pelo celular; 2.4 e 7.2). Continua: na primeira publicação não há versão anterior para voltar; só o Time Travel do banco.
11. ~~**Token do webhook pelo site (RIFA-039) em construção**~~: resolvido na RIFA-039 (Acessos → **Webhook da Rifei**, só admin). A alternativa do wrangler (3.2) continua valendo.
