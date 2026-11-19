# Roteiro de lançamento (RIFA-023)

Passo a passo para colocar a Rifa Videira Kids no ar e conduzir a campanha, que começa em **23/11/2026**. Escrito para o Thiago (PO, dono das contas) e para a coordenação. Site: https://rifa-videira-kids.madruga.workers.dev

**Apresentação (simulação):** https://rifa-videira-kids.madruga.workers.dev/exemplo abre o site com a campanha simulada (a configuração real da campanha: R$ 25 o bilhete, meta de 185 por célula, períodos de 30%, 40% e 30% e ranking por bilhetes; as células e os discipuladores reais, a rede com o nome neutro "Igreja Videira", vendas fictícias; nada é gravado e nada vai para a API de verdade), com a barra "Ver como" para trocar de papel (Público, Coordenação, Líder e Discipulador); o telão ao vivo fica em `/exemplo/#/telao` (sempre com o `#`: `/exemplo/telao` abre o site oficial). Para atualizar, o SM grava de novo a partir da versão do site que se quer mostrar, constrói com `VITE_ROTEADOR=hash npx vite build --base /exemplo/`, troca a pasta `public/exemplo/` inteira numa branch e faz o merge na `main`, que publica; apagar a pasta tira a página do ar (D28; as ferramentas da gravação ainda não estão no repositório).

## Plano de 1 dia

Para pôr tudo de pé num dia, sem perguntar nada ao suporte da Rifei (decisão do PO, 15/11/2026). O que as fontes da Rifei não dizem se descobre no painel, ao criar a campanha, ou na compra de teste, e o sistema já aguenta o que ainda não se sabe (lista abaixo). Os tempos são do trabalho de cada um, com este roteiro aberto: a análise da Efí e a liberação da campanha na Rifei não dependem de nós e ficam fora da conta.

1. **[Thiago] Pix manual: a chave da campanha e o extrato** (≈ 10 min). Decisão do PO (16/11): sem a Efí, o Pix manual da Rifei é o caminho principal. Escolha a chave Pix que recebe (a conta do Bradesco Net Empresa, de preferência no mesmo titular da conta Rifei) e confira que o acesso de consulta abre o extrato e salva o arquivo (PDF ou OFX). A Efí fica para depois, se o PO quiser. → [1.6](#16-pix-manual-o-caminho-do-lançamento) e [1.5](#15-decisões-do-po)
2. **[Thiago] Cloudflare** (≈ 20 min). Assine o Workers Paid. Peça ao SM o bookmark do banco e espere ele dizer que anotou. Crie o token de API (modelo "Edit Cloudflare Workers", com D1 em Edit, só a conta do Worker) e cole direto no segredo `CLOUDFLARE_API_TOKEN` do GitHub. Avise o SM. → [1.1](#11-cloudflare), [2.1](#21-antes-bookmark-do-time-travel-do-d1-thiago-ou-sm) e [1.2](#12-github)
3. **[SM] Publicar e conferir** (≈ 30 min; enquanto isso, siga para o passo 4). O SM publica a `main`, confere que o site está no ar, cria o primeiro admin e te manda o link. Você entra, gera um link novo, entra pelo novo e revoga o primeiro; depois, em **Acessos → Coordenação → Nova pessoa**, cria o segundo admin e os acessos da coordenação, que importa a planilha no passo 5 (≈ 15 min). → [2.2](#22-publicar), [2.3](#23-conferir-que-deu-certo) e [3.1](#31-primeiro-admin-sm-depois-thiago)
4. **[Thiago] Conta e campanha na Rifei** (≈ 30 min, fora a liberação). Crie a campanha, escolha o plano pelo preço do bilhete, pague a taxa de liberação e anote o slug. No mesmo painel, descubra onde ligar os afiliados e gerar o convite, e gere o convite da conta afiliada de teste (passo 7). → [1.3](#13-rifei)
5. **[Thiago + SM] Configurar o sistema** (≈ 30 min). Preencha e ative a **Campanha** com o slug. Gere o token em **Acessos → Webhook da Rifei** e cole na Rifei, com a URL e os três eventos; o SM confere que o webhook passou a responder `nao_autenticado`. A coordenação importa a planilha das 36 células. → [3.3](#33-campanha-admin-com-as-decisões-do-po), [3.2](#32-token-do-webhook-e-webhook-na-rifei-thiago) e [3.4](#34-planilha-das-36-células-coordenação)
6. **[Thiago] Pagamento na Rifei** (≈ 15 min, no computador). Cadastre a chave Pix como forma de pagamento (Pix manual). Quem cuida do dinheiro confere o extrato na **Conferência → Extrato do banco (Pix manual)** e marca os pedidos como pagos na Rifei (6.6). → [1.6](#16-pix-manual-o-caminho-do-lançamento) e [6.6](#66-pix-manual-o-extrato-do-banco-todo-dia-quem-cuida-do-dinheiro)
7. **[Thiago + SM] Compra de teste** (≈ 45 min). Com a conta afiliada de teste, inicie uma compra sem pagar e vincule o código que aparece na **Adesão**; com o link de afiliado dela, grave o modelo do **link de vendas**; faça a compra paga de 1 bilhete pelo QR code da célula. É ela que confirma o formato do link, o código que chega ao sistema, se a indicação do afiliado fica guardada, se marcar como pago avisa o sistema e se o extrato do Bradesco traz o número do pedido (Certo) ou só o nome e o valor (Provável). → [4](#4-compra-de-teste-de-ponta-a-ponta) e [3.6](#36-link-de-vendas-e-qr-code-das-células-admin)
8. **[Thiago e Coordenação] Convites dos líderes e reunião**, antes de 23/11 (≈ 30 min de preparo; a reunião leva 20 min, mais 20 a 30 min de fila). Os convites de afiliado pelo caminho achado no passo 4, os links pessoais em lote, o convite no grupo e o guia do líder em PDF. → [5](#5-reunião-de-cadastro-dos-líderes)

**O que segura o quê.** O passo 3 depende do 2; o 5, do 3 e do 4 (o slug); a compra de teste, do 5 e do 6; a reunião, da compra de teste aprovada (sem campanha ativa e webhook ligado, o código do líder não aparece na Adesão). Sem a Efí, o dinheiro entra pela chave Pix e a conferência do extrato (6.6) diz o que marcar na Rifei. Depois da largada, o dia a dia é da coordenação (seção 6). Se algo cair: seção 7.

**O que o sistema já aguenta sem saber da Rifei:**

- **Código de afiliado desconhecido:** a venda entra mesmo assim, conta no total da campanha e o código aparece em **Adesão → Sem célula** ("Afiliado <código>"). Ao vincular, todas as vendas dele vão para a célula, inclusive as antigas (3.5).
- **Sem o modelo do link de vendas:** o líder vê "A coordenação ainda não liberou o link de vendas." e usa o link da Área de afiliados na Rifei (3.6).
- **Venda paga que não chegou pelo webhook:** volta pela conferência com o CSV do "Exportar Pedidos" da Rifei (6.4). O pedido que chegou como novo e cujo pagamento não chegou aparece em **Pagamento não registrado**, e o admin o marca como pago na mesma tela (1.6 e 6.4).
- **Pix que ainda não foi marcado na Rifei:** a conferência do extrato do banco (6.6) lê o PDF ou o OFX do extrato (ou o texto copiado da tela do banco) no navegador e lista os pedidos para marcar como pagos na Rifei, com o grau (Certo ou Provável), os ambíguos e os Pix sem pedido.

## Como ler este roteiro

- **Quem faz:** **[Thiago]** (contas de terceiros; o caminho principal não pede Node nem terminal, e os comandos com a conta Cloudflare ficam como alternativa), **[SM]** (a sessão do Claude que orquestra: merge, registro e comandos no D1), **[Admin]** (quem tem o papel admin no sistema), **[Coordenação]** (admin ou coordenação).
- **PENDÊNCIA** marca o que o sistema ainda não faz e o lançamento precisaria. A lista completa está no fim.
- **NÃO DOCUMENTADO** quer dizer que a fonte oficial (Rifei ou Efí) não diz. Descubra na tela (no painel da Rifei, ao configurar) ou na compra de teste (seção 4): o lançamento não espera resposta do suporte.
- **Dicas na tela:** com o mouse parado em cima de um botão ou campo, aparece uma explicação curta do que ele faz (no celular, o toque não abre dica). Um botão apagado não faz nada ao clicar, e a dica dele diz por quê (ex.: **Importar** antes de **Conferir** a planilha). **Esc** fecha a dica; dentro de uma janela (diálogo), o primeiro Esc fecha só a dica e o segundo fecha a janela.
- O passo a passo da Rifei e da Efí, com os links oficiais, está em [integracao-rifei.md, seção 12](integracao-rifei.md#12-rifei-e-efí-passo-a-passo-para-o-po). Aqui fica o resumo.
- **Credenciais** (o token da Cloudflare, o token do webhook, a Client Secret e o certificado da Efí e o seu link de admin) não passam por chat (nem o do SM), e-mail ou WhatsApp, e não vão para este documento, o git ou o DevMission. Aqui só se diz **onde** cada uma fica. Se uma delas passar por algum desses lugares, troque (3.1 e 7.3). A exceção combinada é o primeiro link de admin: o SM o cria pela sessão e o manda no chat, e você o troca logo ao entrar (3.1). O token do webhook vai do site direto para a Rifei (3.2). Os links pessoais da equipe e dos líderes vão só no WhatsApp privado da própria pessoa (3.1 e 5.1), nunca em grupo.

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
- **Descubra no painel, ao criar a campanha** (plano, passo 4): procure **"Afiliados"** (na campanha ou nas configurações da conta: a Área de afiliados é do organizador, 12.3), ligue os afiliados e gere o convite da conta afiliada de teste (4.1). Anote o caminho e se o convite é um por afiliado (pedindo o e-mail de cada um?) ou um para todos: é por ele que vão os convites dos líderes (5.1, item 4). Não achou? Chame o SM antes da compra de teste: sem afiliado, a venda não chega à célula.
- **O resto se confirma na compra de teste** (4.1): onde o afiliado acha o link, o formato dele (que vira o modelo do link de vendas das células, 3.6) e o código que chega ao sistema.
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
- **Decisão do PO (16/11): sem a Efí por enquanto.** O lançamento sai com o Pix manual (1.6). O que segue fica para se a Efí entrar depois.
- **Faça primeiro** (12.2, passo A, pelo app no celular): a Efí não publica quanto tempo leva a análise da conta e avisa por e-mail quando termina.
- **Ligar à Rifei** (12.2, passos B a E), depois da aprovação: certificado, aplicação com as permissões do Pix, chave Pix aleatória e, por fim, colar tudo na Rifei.
  - **O certificado e a aplicação exigem o computador** (plataforma web da Efí, no navegador). Deixe a Efí e o painel da Rifei abertos em abas: o certificado só pode ser baixado uma vez e vai direto para a Rifei.
  - Onde fica a Efí no painel da Rifei (na conta ou em cada campanha): NÃO DOCUMENTADO. Procure nas formas de pagamento do painel e anote para o SM ([seção 9, item 13](integracao-rifei.md#9-o-que-confirmar-com-uma-campanha-de-teste)).
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
- [x] **Ranking igual para todos (decisão de 17/11; D27):** a igreja não tem divisão jovens/adultos nem o número de pessoas de cada célula, então:
  - "Regra da meta" **Igual para todas as células** (a meta não depende do número de pessoas; a planilha leva 10 pessoas em todas, provisório);
  - no cartão "Ranking e público", **desmarque "Separar o ranking por divisão (jovens e adultos)"**: um ranking só, com todas as células, no ranking aberto, no telão, nos rankings, na visão dos líderes, no bumbo e no relatório. A divisão continua obrigatória na planilha (ela usa `jovens` em todas); com a caixa desmarcada, ninguém vê "Jovens" nem "Adultos" no ranking. Marcada (o padrão), Jovens e Adultos disputam cada um o seu ranking.
- [ ] **O que o público vê** (cartão "Ranking e público", "O que o público vê"): "Mostrar também o percentual da meta atingido" e "Quantas posições o público vê" (padrão 3; em branco, todas).
- [ ] **Pedidos e acessos** (cartão "Pedidos e acessos", uma caixa de marcar por regra):
  - "Permitir desconsiderar pedidos" (padrão desligada): ligada, o admin tira das contas um pedido de teste, fraude ou estorno, e desfaz, na tela **Pedidos** (4.4). Desligar depois não devolve às contas o que já foi desconsiderado;
  - "Acesso dos discipuladores" e "Acesso das redes" (padrão ligados): links pessoais também para discipuladores e redes (5.1, item 1), que veem as células deles, sem reais. Desligado, eles não entram nem recebem link novo; os links já mandados voltam a valer quando religar. O líder de célula entra sempre. Com uma rede só na planilha (3.4), a caixa "Acesso das redes" e a mensagem do link da rede não aparecem (D30).
  - "Login das células com senha padrão" (padrão **ligado**; RIFA-064, D29; pedido do PO em 17/11, **deixe ligado nesta campanha**): cada célula entra em `/entrar` com o nome dela e a senha `@` + nome da célula sem acentos e sem espaços + `1234` (ex.: `@geracaoqueclama1234`) e vê só a página da célula (ranking, meta, link e QR de vendas, sem reais). A senha não é segredo: quem souber o nome da célula entra como ela. Desligado, ninguém entra pela senha e quem entrou assim sai na hora; o link pessoal continua.
- [ ] **Mensagens do link pessoal** (cartão "Mensagens do link pessoal"; opcional): o texto do WhatsApp de cada tipo de link (coordenação, líder, discipulador e rede). O padrão é o texto de 5.1; a tela mostra como fica e não deixa salvar sem o `{link}`. O bumbo não muda aqui.

Mudar datas, períodos, preço, meta ou critério depois muda os números da campanha inteira, inclusive dos dias que passaram (3.3). Para entender como o sistema conta, leia as suposições S1 a S22 de [regras-de-calculo.md](regras-de-calculo.md#3-suposições-para-o-po).

As regras de pedidos e acessos e as mensagens podem mudar a qualquer hora: ligar ou desligar uma regra não muda nenhum número. Quem muda a Campanha (admin ou coordenação) muda também essas regras.

**Decidir fora do sistema** (o PO decide e passa ao SM, para o DevMission):

- [ ] **Titular da conta Efí:** Efí Pro (CPF) ou Efí Empresas (CNPJ), e em nome de quem. Os Termos da Rifei falam em receber "em contas de sua titularidade": o caminho seguro é o mesmo titular da conta da Rifei (1.4).
- [ ] **Plano da Rifei:** pelo preço e pela quantidade de bilhetes (1.3).
- [ ] **Chave Pix da campanha (Pix manual, 1.6):** a chave de qual conta recebe (a conta do Bradesco Net Empresa). O caminho seguro é o mesmo titular da conta da Rifei.
- [x] **Sem a Efí (16/11):** o Pix manual é o caminho principal; o extrato do Bradesco é baixado à mão (o Open Finance é pago) e conferido no sistema (6.6).
- [ ] **Compra de teste:** manter o bilhete (o dinheiro fica para a causa e o bilhete vale no sorteio) ou estornar (4.4). Nos dois casos, o admin pode desconsiderar o pedido no sistema (4.4).
- [ ] **Autorização do sorteio:** o FAQ da Rifei ("Preciso de autorização para fazer uma campanha?", em [rifei.com.br](https://rifei.com.br/#faq), lido em 11/11/2026) avisa que as regras variam conforme o lugar e que é essencial conferir as normas antes de começar. No Brasil, ele cita a SECAP e o pedido pelo Sistema de Controle de Promoção Comercial (SCPC). A Rifei diz que a plataforma não pede essas autorizações: ficam com o organizador. Aqui só se registra o aviso; não é parecer jurídico.
- [x] **Workers Paid:** sim (a conferência por CSV exige: 1.1 a).

### 1.6 Pix manual: o caminho do lançamento

Decisão do PO (16/11/2026): sem a Efí, o **Pix manual** da própria Rifei é o caminho principal (antes, era o plano B). Fonte: [12.2, alternativa](integracao-rifei.md#122-ligar-a-efí-à-rifei-recebimento-do-pix).

- **Como funciona:** o comprador reserva os bilhetes na Rifei, pelo link de afiliado do líder, e paga pelo QR ou pelo copia e cola na chave Pix da campanha. Quem cuida do dinheiro confere o extrato e marca o pedido como pago no painel da Rifei; a Rifei manda o **Pedido pago** no webhook e a venda passa a contar no sistema, na célula do afiliado. Confira no extrato, não no comprovante: o artigo da Rifei avisa que comprovante pode ser adulterado (e diz que o identificador da transação Pix é o número do pedido).
- **O sistema faz o cruzamento** (RIFA-059; D26): em **Conferência → Extrato do banco (Pix manual)**, suba o PDF (ou o OFX) do extrato baixado do Bradesco Net Empresa (ou cole a tabela do extrato copiada da tela; RIFA-068 para o PDF). O extrato é lido no navegador e não sai do computador. A tela lista os pedidos para marcar como pagos na Rifei (**Certo**: o Pix traz o número do pedido; **Provável**: só um pedido tem o valor e o horário), com **Copiar os números dos pedidos**, e mostra à parte os **Ambíguos** (mais de um pedido serve: decida pelo nome de quem pagou, olhando a Rifei), os **Pix sem pedido** e os **Já contados**. A marcação na Rifei continua à mão: a Rifei não tem API para isso, e o sistema não mexe no painel dela. A rotina do dia: 6.6.
- **O banco:** Bradesco, conta de pessoa jurídica no Net Empresa, com um acesso só de consulta. O extrato é baixado à mão (o Open Finance é pago e ficou fora), e nenhum robô entra no banco (o Net Empresa pede a chave de segurança do app a cada login). Se o extrato do Bradesco mostra o número do pedido, a compra de teste diz (4.1, passo 4).
- **A venda só aparece no sistema depois de marcada:** marque ao longo do dia, de preferência antes de o pedido expirar (o prazo de reserva aparece na compra de teste, 4.1, passo 5). Se a Rifei deixa marcar como pago um pedido que já expirou: NÃO DOCUMENTADO; se deixar e avisar o sistema, ele passa a contar. A tela marca o expirado com o selo **Expirado**.
- **O que não muda:** a compra continua sendo feita na Rifei, pelo link de afiliado, e a célula continua vindo do afiliado do pedido. Pix mandado direto para a chave, sem pedido na Rifei, nunca entra no sistema (na conferência do extrato, aparece em **Pix sem pedido**).
- **Como ligar:** no painel da Rifei, cadastre a chave Pix como forma de pagamento (onde fica: NÃO DOCUMENTADO; procure nas formas de pagamento). A chave de qual conta é decisão do PO (1.5).
- **Na compra de teste (4.1, passo 4), confira se marcar como pago avisa o sistema:** depois de marcar, **Pedidos → Entregas do webhook** precisa mostrar **Pedido pago**, e o pedido, **Aprovado** na célula do teste. A fonte não diz se a marcação dispara o webhook; o exemplo oficial do webhook traz um pedido pago com `status_detail` `changed_by_admin`, o que sugere que sim ([integracao-rifei.md, seção 8](integracao-rifei.md#8-confirmado--suposição)).
  - **Chegou:** o resto do roteiro vale como está; o trabalho do dia é a rotina do extrato (6.6).
  - **Não chegou:** o pedido fica **Aguardando pagamento** (ou **Expirado**) no sistema e não conta até a conferência pelo CSV (6.4), que corrige este caso: ela o mostra em **Pagamento não registrado**, e o **[Admin]** usa **Registrar pagamento**. O pedido passa a pago com a data do pagamento do arquivo e entra na meta e no ranking, na célula do afiliado que ele já tinha. Para isso, o arquivo precisa trazer o código do pedido, o status, a quantidade, o valor e a data, e a quantidade, o valor e o afiliado precisam bater com os do sistema (se não baterem, a tela diz qual e não marca: confira na Rifei). Faça a conferência pelo CSV pelo menos uma vez por dia, depois da do extrato (6.6): até lá, as vendas do Pix manual não aparecem no painel. Se o "Pedido pago" chegar depois, nada conta em dobro. Teste na compra de teste: exporte os pedidos e registre o pagamento do pedido de teste (passo 7).
- **Se a Efí entrar depois:** ligue-a na Rifei (1.4) e refaça a compra paga de 1 bilhete pelo QR code de uma célula (4.1, passo 4), para provar que o Pix pela Efí chega ao sistema sozinho. Depois de 23/11, ela conta como venda (tirar das contas é decisão do PO: **Desconsiderar**, motivo **Teste**, 4.4). Com a Efí, o Pix cai na conta da Efí e não no extrato do Bradesco: a conferência do extrato serve só para o que ainda entrar pela chave do Pix manual.

---

## 2. Primeira publicação e como conferir

### 2.1 Antes: bookmark do Time Travel do D1 [Thiago ou SM]

O Time Travel do D1 permite voltar o banco a um instante anterior. Anote o ponto de antes da primeira publicação (pedido da D12). O SM faz isto da sessão dele: avise-o antes de cadastrar o token (1.2).

```sh
npx wrangler d1 time-travel info DB          # mostra o bookmark de agora
npx wrangler d1 migrations list DB --remote  # lista as migrações que ainda vão rodar
```

- O bookmark **não é segredo**: anote no DevMission (nota da RIFA-023) com a data e a hora.
- A lista de migrações deve trazer as de `migrations/` que ainda não rodaram em produção. A `0000_setup.sql` já foi aplicada em 06/11/2026, junto com a criação do banco de produção: as pendentes são as de `0001_init.sql` em diante (hoje, da `0001` à `0010_link_vendas.sql`, mais as que entrarem na `main` até a publicação).
- A Cloudflare guarda esse histórico por 30 dias no Workers Paid (no gratuito, menos: veja **"Time Travel"** na documentação do D1).

### 2.2 Publicar

1. **[SM]** Confira que a última execução do CI na `main` está verde.
2. **[Thiago]** Com o bookmark anotado (2.1), crie o token (1.1 b) e cadastre direto no segredo `CLOUDFLARE_API_TOKEN` do repositório (1.2).
3. **[SM ou Thiago, pelo celular]** Dispare a publicação com um push na `main` ou, sem nada novo para subir, no GitHub: **Actions** → **CI** → **Run workflow** → branch `main` (o padrão) → **Run workflow**. Ele constrói e publica a `main` como um push (RIFA-035, D22); noutra branch, só constrói. Também serve **Re-run jobs** → **Re-run all jobs** na última execução da `main` (o "all" refaz o build, que vale só 1 dia).

**Pela sessão do SM** (RIFA-058). Da raiz do checkout, onde o `gh` acha o repositório sozinho:

1. Confira a última execução da `main`:
   ```sh
   gh run list --workflow ci.yml --branch main -L 1 --json databaseId,event,status,conclusion,headSha
   ```
   Se ela ainda estiver rodando e o segredo já estiver salvo, esse push publica sozinho: pule para o item 3 com o `databaseId` dela.
2. Dispare a publicação sem commit (o mesmo **Run workflow** do item 3 acima):
   ```sh
   gh workflow run ci.yml --ref main
   ```
   Se responder 403 ("Resource not accessible by integration" ou a recusa do proxy da sessão), publique com um commit vazio na `main` (só o SM faz push na `main`): `git commit --allow-empty -m "RIFA-023: publica"`, com as linhas de atribuição da sessão, e `git push origin main`.
3. Acompanhe. O run leva uns 10 min: na sessão, rode o `gh run watch` em segundo plano, porque o comando em primeiro plano é cortado em 10 min.
   ```sh
   gh run list --workflow ci.yml --branch main -L 1 --json databaseId,event,status,headSha   # o run novo: workflow_dispatch ou push
   gh run watch <databaseId> --exit-status --compact
   ```
4. Leia o log do job **"publicar na Cloudflare"** num arquivo do scratchpad da sessão, não na conversa (uma linha do wrangler pode trazer o e-mail da conta):
   ```sh
   gh run view <databaseId> --json jobs --jq '.jobs[] | "\(.databaseId) \(.name) \(.conclusion)"'
   gh run view <databaseId> --job <id do job "publicar na Cloudflare"> --log > <scratchpad>/log-publicar.txt
   grep -nE 'publicação pulada|Build conferido|dry-run: exiting|Migrations to be applied|✅|Uploaded|Deployed|Current Version ID|"ok":true|##\[error\]' <scratchpad>/log-publicar.txt
   ```
   Tem de aparecer, nesta ordem: **nenhum** "publicação pulada"; "Build conferido: dist/rifa_videira_kids/wrangler.json segue o wrangler.jsonc" (sem o token); "--dry-run: exiting now." (até aqui o D1 não foi tocado); a lista das migrações pendentes (0001 a 0010), cada uma com ✅; "Uploaded rifa-videira-kids" e "Deployed rifa-videira-kids triggers", com o endereço do site; "Current Version ID: <id>" (anote o id no DevMission); e, no passo "Conferir /api/health em produção", `{"ok":true,"db":"ok","latenciaMs":…}`. Depois, siga para 2.3.

**O segredo existe?** Da sessão não dá para ver: o proxy recusa a API `actions/secrets` (403). O sinal é o job **"publicar na Cloudflare"**: sem o segredo, ele avisa "Segredo CLOUDFLARE_API_TOKEN não configurado no repositório: publicação pulada", os passos depois de "Conferir o segredo da Cloudflare" aparecem como `skipped` no `gh run view <databaseId> --json jobs` e o CI fica verde mesmo assim. Se aparecer "publicação pulada", pare e peça ao Thiago para conferir o segredo (1.2).

O primeiro job constrói o site e o Worker, sem segredo, e guarda o build (`dist/`). O job de publicação instala as dependências sem rodar os scripts de instalação, baixa esse build, confere que a configuração gerada é a do `wrangler.jsonc` (`scripts/conferir-artefato.mjs`) e, só então, no passo "Publicar" (`npm run deploy:publicar`, o único com o token), confere o que foi construído (`wrangler deploy --dry-run`), aplica as migrações no D1 remoto e publica. Depois consulta `/api/health` em produção até 6 vezes.

**A partir daqui, todo push na `main` publica.** Sugestão para a campanha: o SM só faz merge de correção, com a `main` verde e fora do horário do culto e dos picos de venda.

### 2.3 Conferir que deu certo

**Tudo de uma vez [SM]** (RIFA-058). Da raiz do checkout:

```sh
npm run verificar:producao -- --url https://rifa-videira-kids.madruga.workers.dev
```

- **Esperado:** `0 FALHA(S)` no resumo e saída 0 (1 = alguma falha, listada no fim; 2 = uso errado). Antes de 3.2 e 3.3, o resumo diz "Webhook: nao_configurado" e "Campanha: não configurada", e os 404 de "campanha ainda não configurada" aparecem como "esperado". Leva cerca de 1 min.
- **O que confere** (os itens 2, 3, 4 e 6 abaixo, e mais): `/api/health`; o app nas rotas do site, com os 4 cabeçalhos de segurança e sem cache longo no HTML; os arquivos que não podem sair (`_headers`, `.dev.vars`, `wrangler.json`...); os assets e a fonte; a área fechada sem sessão (401 em todos os caminhos), cookie forjado e escrita de outra origem (CSRF); o webhook sem token válido; a API pública sem valores em R$; e as telas abertas no Chromium, a 390 e a 1366 px, sem erro no console nem rolagem lateral.
- **Só leitura:** GETs, duas escritas de outra origem (recusadas pelo CSRF antes da sessão) e três POSTs ao webhook sem token válido (recusados antes de ler o corpo). Não cria pedido, não grava configuração, não gera link nem token, e nunca imprime link, token ou cookie.
- **Endereço errado ou site fora do ar:** a saúde falha ("sem resposta", ou "a Cloudflare responde 404 sem o Worker", o erro 1042) e as outras conferências são puladas.
- **Navegador:** as telas usam o Playwright, que o projeto não instala: o script usa o da sessão de nuvem do Claude (`/opt/node-tools/node_modules`). Fora dela, rode com `--sem-navegador` (só HTTP) ou aponte `--playwright <pasta node_modules com o playwright>`; sem Playwright, ele falha dizendo isso.
- Com o link do primeiro admin, `--admin-link <arquivo>` também entra na coordenação (3.1).

O passo a passo à mão, para quem não tem a sessão:

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

1. **[SM]** Da sessão dele, logo depois da primeira publicação e da conferência (2.2 e 2.3). A saída vai para um arquivo só dele no scratchpad da sessão (`umask 077`), nunca para a conversa, até a entrega combinada ao Thiago. Na sessão de nuvem, o wrangler pede um `CLOUDFLARE_API_TOKEN` qualquer (o proxy da sessão põe a credencial de verdade) e o id da conta (não é segredo; é o do `.github/workflows/ci.yml`):
   ```sh
   umask 077
   CLOUDFLARE_API_TOKEN=substituido-pelo-proxy CLOUDFLARE_ACCOUNT_ID=4d8a1d1dae5b596e42e97dcf28292572 \
     npm run --silent acesso:criar -- --nome "<nome do Thiago>" --papel admin --remote --origem https://rifa-videira-kids.madruga.workers.dev \
     > <scratchpad>/link-admin-producao.txt 2>&1; echo "saida=$?"
   sed -E 's#/acesso/[A-Za-z0-9_-]+#/acesso/[omitido]#' <scratchpad>/link-admin-producao.txt
   ```
   - Saída 0: gravado e conferido no D1. 1: o D1 não gravou (migrações não aplicadas, credencial). 2: uso errado. O `sed` mostra o resultado sem o token.
   - O link vale **45 dias** (a data exata está na linha "O link vale até … (UTC)"; `docs/acesso.md`, seções 1 e 5) e abre sessão quantas vezes for preciso nesse prazo.
   - Nunca `cat` no arquivo, nem o link em nota, commit ou DevMission.
   - Antes de mandar, confira o link: `npm run verificar:producao -- --url https://rifa-videira-kids.madruga.workers.dev --admin-link <scratchpad>/link-admin-producao.txt`. Ele entra, abre Visão geral, Campanha e Adesão a 1366 e a 390 px e sai (a sessão que ele abriu é encerrada; o link continua valendo). Esperado: `0 FALHA(S)`.
   - **A entrega combinada:** o SM tira o link do arquivo (`grep -o 'https://rifa-videira-kids.madruga.workers.dev/acesso/[A-Za-z0-9_-]\{43\}' <arquivo>`) e o manda ao Thiago no chat da sessão, com os passos abaixo. Como passou pelo chat, esse link é só para a primeira entrada: o passo 2 o troca.
   - Depois que o Thiago disser que trocou: o mesmo `verificar:producao --admin-link` passa a falhar em "entrar" ("Este link não vale mais"), o que confirma a revogação; então o SM apaga o arquivo (`shred -u <arquivo>`, ou `rm`).
2. **[Thiago]** Abra o link no navegador e toque em **Entrar**: você cai na área `/coordenacao`. Então, nesta ordem:
   1. **Acessos → Coordenação** → no seu cartão, **Gerar link novo** → **Copiar link**;
   2. abra o link novo numa aba nova e toque em **Entrar**;
   3. só então, já dentro pelo link novo, use **Revogar link** no primeiro, o que veio do SM. **No seu cartão, ele é o de baixo:** a lista vem do mais novo para o mais antigo, e o de cima é o link novo, com o qual você acabou de entrar: ele vem marcado **Este aparelho** ("Você entrou por este link neste aparelho"). Confira pelo "Criado em" (o do SM é o mais antigo). Revogar derruba a sessão aberta por ele, e o link novo só aparece uma vez: por isso ele vem antes. O sistema também não deixa revogar o último link válido de admin.
      - Tocou em **Revogar link** no de cima? Ele pede uma confirmação própria, **"Revogar o link deste aparelho?"**, que avisa que você sai do sistema aqui, com o botão **Revogar e sair**: toque em **Cancelar** e revogue o de baixo.
      - Revogou o de cima por engano? A sessão cai e o link novo para de valer. Abra de novo o link do SM (ele ainda vale) e recomece do item 1.
3. Guarde o link novo só para você (ex.: no gerenciador de senhas). Ele vale 45 dias e pode ser aberto de novo nesse prazo (outro aparelho, como o seu celular). Uma sessão parada há mais de 7 dias cai; é só abrir o link de novo.
4. **Crie o seu usuário e senha (RIFA-073):** já dentro pelo link, abra **Minha senha** no menu, escolha o usuário (ex.: `pastor.nome`, sem acento) e uma senha de pelo menos 10 caracteres, repita a senha e toque em **Salvar senha**. Daí em diante, em qualquer aparelho: **Entrar → Sou administrador** → usuário e senha. Não mande a senha por WhatsApp nem por chat. Esqueceu? Entre pelo link e crie outra em Minha senha (`docs/acesso.md`, seção 11).
   - **Alternativa pelo SM:** logo depois do passo 1, `npm run acesso:senha -- --admin "<nome do Thiago>" --usuario <login> --remote` (com as mesmas variáveis do wrangler do passo 1). A senha é pedida no terminal, ou lida da primeira linha da entrada padrão (`printf '%s\n' "$SENHA" | ...`, com a variável vinda de um lugar seguro); nunca vai como argumento nem para o chat. Saída 0: gravada e conferida. Depois, o Thiago troca a senha em Minha senha.

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
   - **Eventos:** os três de pedido: "Novo pedido", "Pedido aprovado" (o "Pedido pago" do artigo) e "Pedido expirado". Deixe **"Prêmio instantâneo" desmarcado** e não use "Selecionar todos".
   - Ao tocar em **Adicionar**, a Rifei manda um teste e só aceita a URL se o sistema responder certo (RIFA-060). Se aparecer "A URL informada não retornou uma resposta válida!", confira a URL e o token e chame o SM.
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
- **Bilhete e meta:** preço do bilhete (R$), unidade, regra e valor da meta, e os números da rifa: **"Quantidade de números da rifa (como na Rifei)"** (já vem `7005`, o da rifa "projeto-kids-1") e **"Número inicial"** (deixe **Automático** até a compra de teste: 4.2).
- **Ranking e público:** critério do ranking, **"Separar o ranking por divisão (jovens e adultos)"** (desmarque nesta campanha: um ranking só, 1.5; o resumo "Regras da campanha", no topo, mostra "Ranking por divisão: Um ranking só, com todas as células juntas.") e o que o público vê (o % da meta e quantas posições).
- **Pedidos e acessos:** "Permitir desconsiderar pedidos" (ligue antes da compra de teste, se o PO quiser tirá-la das contas: 4.4), "Acesso dos discipuladores", "Acesso das redes" e "Login das células com senha padrão" (deixe ligado: 1.5 e 5.1, item 1). Só o admin muda estas regras e as mensagens (a coordenação as vê só leitura).
- **Mensagens do link pessoal** (opcional): um modelo por tipo de link, com os marcadores `{saudacao}`, `{nome}`, `{alvo}` e `{link}` (obrigatório, no começo ou depois de um espaço ou de uma quebra de linha; nenhum outro endereço na mensagem). A pré-visualização mostra a mensagem pronta; **Voltar ao texto padrão** desfaz a edição. Se editar, mantenha as palavras "link pessoal" no texto: o guia do líder ("Perdi o link") manda procurar por elas na conversa.
- **Ativar a campanha** (pede confirmação). A partir daí, as vendas da Rifei com esse slug contam.

Cuidados:

- **Sem campanha ativa, ou com o slug errado, o webhook ignora os pedidos** (a entrega aparece como "Outra campanha" em **Pedidos → Entregas do webhook**) e o código do afiliado não aparece na Adesão. Trocar o slug depois pede confirmação.
- O preço do bilhete também serve para marcar pedidos estranhos (seção 4.2): com um preço diferente do da Rifei, pedidos normais podem cair na lista de suspeitos.
- Os números são recalculados na leitura: mudar meta, preço, períodos ou percentuais depois muda os números da campanha inteira, inclusive dos dias que passaram. Combine com o PO antes.
- A caixa do ranking por divisão pode mudar a qualquer hora: muda só como o ranking é mostrado (as posições passam a ser entre todas as células, ou de novo por divisão), nenhum número de venda ou de meta. No telão e no ranking aberto, vale em até 2 minutos.
- Cada salvamento fica na trilha de auditoria (`campanha.salvar`, com o slug e o preço de antes e de depois, as regras que mudaram e o nome da mensagem alterada). O primeiro, que ativa a campanha, registra "Campanha criada" com o slug, o preço, as três chaves (desconsiderar pedidos, acesso dos discipuladores e acesso das redes, cada uma ligada ou desligada) e o nome das mensagens editadas, sem o texto delas.

### 3.4 Planilha das 36 células [Coordenação]

Siga [importar-hierarquia.md](importar-hierarquia.md). Em resumo: **Coordenação → Hierarquia →** aba **Importar planilha** → **Baixar modelo** → **Escolher arquivo** → **Conferir** (não grava nada) → **Importar**.

- Confira no resultado: 36 células criadas, sem erros. Leia os avisos (coluna ignorada não entra).
- Preencha `lider_telefone`: é ele que abre o WhatsApp do líder na hora de mandar o link (5.1) e de cobrar quem falta (5.3).
- A importação nunca apaga e pode ser repetida com a planilha corrigida.
- **Uma rede só (decisão de 17/11; D30):** a planilha da igreja não tem rede, mas a coluna `rede` continua obrigatória: escreva o mesmo nome em todas as linhas (ex.: `Exploradores`). Com uma rede só, o sistema não mostra a rede em nenhuma tela: a Hierarquia fica com discipuladores e células, os rankings com células e discipuladores, e os acessos com líderes e discipuladores. Só a aba **Importar planilha** fala da coluna `rede`. O relatório em CSV continua com a coluna "Rede" (o mesmo nome em todas as linhas; dá para apagar no Excel). Com duas ou mais redes na planilha, tudo volta a aparecer.

### 3.5 Vinculação de afiliados (visão geral)

**Na Rifei** ([12.3](integracao-rifei.md#123-afiliados-programa-da-campanha-e-líderes)): o organizador manda o convite de afiliado, o líder se cadastra com o e-mail e pega o link de afiliado dele. A venda feita por esse link chega com o código de afiliado (`affiliate_id`) do líder. Onde o líder acha o link e onde o organizador vê o código de cada afiliado: NÃO DOCUMENTADO; a compra de teste mostra, com a conta afiliada de teste (4.1, passos 1 a 3; [seção 9](integracao-rifei.md#9-o-que-confirmar-com-uma-campanha-de-teste), itens 1 e 2).

**No sistema:** a célula sai do vínculo afiliado → célula (`docs/integracao-rifei.md`, D7). O vínculo é feito em **Coordenação → Adesão** de dois jeitos:

- **Fila "Sem célula":** quando o líder inicia uma compra pelo próprio link de afiliado (sem pagar), o código aparece na fila em segundos. Toque em **Vincular** e escolha a célula.
- **Código digitado:** se o líder souber o código (ou se o painel da Rifei mostrar o código de cada afiliado: confira na compra de teste), em **Todas as células** → a célula → **Código de afiliado** → **Salvar código** (pré-cadastro). Uma célula pode ter mais de um código (**Adicionar outro código**).

O roteiro da reunião está na seção 5. Regra de ouro: **não use "Desvincular" num afiliado que já vendeu**, a não ser de propósito: todas as vendas dele, inclusive as antigas, saem da célula na hora.

### 3.6 Link de vendas e QR code das células [Admin]

O link de vendas de uma célula é o link de afiliado do líder na Rifei, montado pelo sistema a partir de um **modelo** (`docs/decisions.md`, D24). A compra feita por ele chega com o código do afiliado e conta para a célula; o QR code abre o mesmo link. Pix mandado direto para uma chave, fora da Rifei, nunca entra no sistema.

- **Antes:** o formato do link de afiliado da Rifei é NÃO DOCUMENTADO: quem mostra é a compra de teste (4.1, passo 3), com o link da conta afiliada de teste. Até lá, deixe o modelo vazio: o líder vê "A coordenação ainda não liberou o link de vendas." e "Enquanto isso, use o link da sua Área de afiliados na Rifei."
- **Onde:** **Coordenação → Adesão** → seção **Links de vendas**, no fim da tela → campo **Modelo do link de vendas** → **Salvar modelo**. Só o admin muda; a coordenação vê o campo só leitura ("Só o admin muda o modelo.").
- **O modelo:** o link de afiliado da Rifei com `{slug}` no lugar do slug da campanha e `{afiliado}` no lugar do código do afiliado. Ex. (o formato real ainda não está confirmado): `https://rifei.com.br/{slug}?afiliado={afiliado}`. Ele precisa começar por `https://rifei.com.br/`. Se o link de afiliado não leva o número do código que apareceu na Adesão, ou fica noutro endereço, não grave: passe o link ao SM ([12.3](integracao-rifei.md#123-afiliados-programa-da-campanha-e-líderes), fim) e os líderes seguem com o link da Área de afiliados. A tela mostra os problemas enquanto você digita e a **prévia**, com o link de um afiliado já vinculado (sem nenhum vinculado, um código de exemplo): abra a prévia e confira que ela cai na campanha certa da Rifei antes de salvar.
- **Depois de salvar,** cada célula com afiliado vinculado tem o link e o QR na hora (quem já estava com a tela aberta em `/minha` vê ao recarregar a página):
  - o líder vê **Seu link de vendas** na tela dele (`/minha`), com **Copiar link**, **Enviar no WhatsApp** e o QR code (**Baixar imagem** e **Imprimir**); o discipulador e a rede veem **Links de vendas das suas células**, com **Ver QR**;
  - na Adesão, **Link de cada célula** tem o link e o QR de cada uma (o **Enviar no WhatsApp** abre a conversa com o telefone do líder) e **Imprimir os QR codes** (uma folha por célula com link).
- Célula sem afiliado vinculado fica "Sem link". Célula com mais de um código mostra todos, o mais recente em destaque: todos contam para ela.
- O salvamento fica na trilha (`campanha.salvar`, com o modelo de antes e o de depois). Trocar o slug na Campanha (3.3) muda os links na hora.
- **Confira com a compra de teste (4.1, passo 4):** a compra feita pelo QR code da célula precisa cair nela. Se cair em "Sem célula" ou em outra célula, o modelo não bate com o link da Rifei: apague-o (campo vazio → **Salvar modelo**) até acertar.

---

### 3.7 Conexão com a Rifei para marcar pagos pelo sistema [SM, depois Thiago] (RIFA-070, D32)

1. **[SM, uma vez]** crie a chave que cifra o token no banco: `openssl rand -base64 32 | npx wrangler secret put RIFEI_CHAVE_CIFRA`
   (o valor não aparece em lugar nenhum; não anote). Sem ela, a tela avisa "Falta a chave RIFEI_CHAVE_CIFRA".
2. **[Thiago, no computador]** **Acessos → Conexão com a Rifei**: siga o passo a passo da tela (janela anônima,
   entrar na Rifei, F12 → Console, colar a linha, voltar e **Salvar e testar**). A tela mostra **Conectado: testado …**
   e "termina em …abcd". **Feche a janela anônima sem clicar em "Sair"** (o "Sair" derruba o token).
3. Se um dia aparecer **"A Rifei recusou o token: cole um novo"** (na tela de Conexão ou no topo do Extrato do banco),
   repita o passo 2. Enquanto isso, o caminho manual (Copiar os números e marcar no painel da Rifei) continua valendo.

## 4. Compra de teste de ponta a ponta

**Quando:** depois de 3.1 a 3.4, com o Pix manual ligado na Rifei (1.6; ou a Efí, 1.4, se ela entrar), e **antes de 23/11** (veja 4.4). **Quem:** Thiago com uma segunda conta da Rifei como afiliada, cadastrada pelo convite gerado no painel (1.3), e um admin olhando o sistema. É esta compra que responde ao que as fontes da Rifei não dizem e que antes ia para o suporte: a lista está na [seção 9 de integracao-rifei.md](integracao-rifei.md#9-o-que-confirmar-com-uma-campanha-de-teste).

### 4.1 Os passos

1. **Conta afiliada de teste:** abra o convite, crie a conta de afiliado com um e-mail e entre pela **"Área de afiliados"** (menu da página da campanha). Ache o **link de afiliado** dela e copie. Anote onde ele fica (é o que se mostra aos líderes na reunião) e se o cadastro pediu confirmação por e-mail.
   - De preferência, use como afiliada de teste a conta de um **líder de verdade** (ex.: alguém da coordenação que lidera uma célula) e, no passo 2, vincule à célula dele: o vínculo já vale para a campanha.
2. **Com esse link, inicie uma compra sem pagar.** Em segundos, o **"Afiliado <código>"** aparece em **Adesão → Sem célula**. Vincule a uma célula.
   - Se a entrega chegar (4.2) e nada aparecer em "Sem célula", o código de afiliado não veio no pedido: chame o SM antes da reunião dos líderes.
3. **Modelo do link de vendas [Admin]:** compare o link do passo 1 com o código do passo 2. Se o número do código está no link e o link começa por `https://rifei.com.br/`, troque o slug por `{slug}` e o número por `{afiliado}` e grave em **Adesão → Links de vendas** (3.6), conferindo a prévia. Se não, deixe o modelo vazio e passe o link ao SM (3.6): os líderes usam o link da Área de afiliados.
4. **Faça uma compra paga de 1 bilhete**, pelo QR code da célula (na tela do líder ou em **Adesão → Links de vendas → Ver QR**) ou, sem modelo, pelo link de afiliado. O pedido precisa aparecer na célula (4.2). Se cair noutro lugar, apague o modelo até acertar.
   - **Com a Efí:** pague o Pix; o pedido vira pago sozinho.
   - **No Pix manual (1.6):** pague na chave. Antes de marcar, baixe o extrato do dia do Bradesco Net Empresa em PDF (ou em OFX) e suba em **Conferência → Extrato do banco (Pix manual)** (6.6): o pedido de teste precisa aparecer em **Para marcar como pago na Rifei**. Com o primeiro PDF de verdade, confira também o que o roteiro 6.6 pede (o PDF tem texto, a data e o débito; não guarde o arquivo). Anote o grau: **Certo** quer dizer que o extrato do Bradesco traz o número do pedido; **Provável**, que traz só o valor e a hora (e o nome de quem pagou, se aparecer na descrição); anote também se a hora veio (o aviso "O extrato não traz a hora" diz que não). Copie o número e marque o pedido como pago no painel da Rifei. Em **Pedidos → Entregas do webhook**, deve chegar **Pedido pago**. Se não chegar, siga: o passo 7 corrige pela conferência (1.6).
     - Se o Net Empresa não salvar o PDF nem o OFX com o acesso de consulta (ou se a tela não ler o PDF), selecione a tabela do extrato na tela, copie e cole na caixa da mesma seção; anote o formato para o SM (só os nomes das colunas e o jeito da linha do Pix, com o nome trocado por um fictício).
5. **Inicie outra compra pelo link de afiliado e não pague:** depois do prazo de reserva, a Rifei avisa que expirou. Anote quanto tempo levou. Não precisa esperar para seguir: os passos 6 e 7 não dependem dele.
6. **A indicação fica guardada?** No mesmo celular do passo 2, abra o link comum da campanha (`rifei.com.br/<slug>`, sem o código) e inicie uma compra sem pagar. Em **Pedidos**, a coluna **Célula** mostra a célula do teste (a Rifei guardou a indicação do afiliado) ou **"Sem afiliado"** (não guardou). De qualquer jeito, o líder orienta a comprar pelo link dele (guia do líder, seção 1).
7. **Exportar Pedidos e Conferência:** exporte os pedidos na Rifei (6.4, passo 1) e abra o arquivo em **Coordenação → Conferência**. Confira se a tela reconhece as colunas (código do pedido, status, quantidade, valor, afiliado e data): ela é a rede de segurança do webhook. Se, no Pix manual, o **Pedido pago** não chegou (passo 4), o pedido de teste aparece em **Pagamento não registrado**: o **[Admin]** usa **Registrar pagamento** e confere que ele passa a **Aprovado** na célula do teste (1.6). O arquivo tem dados pessoais: não mande ao SM, só os nomes das colunas.

Uma conta só de teste dá para tirar depois **[Admin]**: desconsidere **todos** os pedidos dela (4.4), não só o pago: também as compras iniciadas nos passos 2, 5 e 6 (esta, se ficou com o afiliado), que expiraram (pedido de qualquer status conta). Depois toque em **Remover** no afiliado, na **Adesão** (na fila "Sem célula" ou em **Todas as células**), e confirme em **Remover afiliado**. Se ainda faltar algum, o sistema recusa e lista os pedidos que ainda contam, com o link de cada um: desconsidere esses e tente de novo. Se a Rifei mandar outra venda com o mesmo código, ele volta para a fila "Sem célula".

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
- **Bilhetes** (`/coordenacao/bilhetes`): o número do pedido pago aparece verde na grade (o não pago, amarelo, enquanto aguarda o Pix). Busque o número do bilhete: aparece o pedido, com a célula. Se a Rifei deu o número **0**, a numeração começa no 0; se não, confira na Rifei se ela numera do 1 e, se quiser, fixe o **Número inicial** na Campanha. Um aviso "Números fora da rifa" quer dizer quantidade ou número inicial errados na Campanha.
- **Pedidos suspeitos:** tela **Pedidos suspeitos** no menu da coordenação (`/coordenacao/pedidos-suspeitos`). Esperado: lista vazia. Se o pedido de teste aparecer, confira o preço do bilhete na Campanha: ele precisa ser igual ao da Rifei.

### 4.3 O que anotar

As respostas da [seção 9 de integracao-rifei.md](integracao-rifei.md#9-o-que-confirmar-com-uma-campanha-de-teste), que substituem as perguntas ao suporte:

- onde ligar os afiliados e gerar o convite, e se o convite pede o e-mail de cada um (1.3);
- onde o afiliado acha o link, o formato dele e se o cadastro pediu confirmação por e-mail (passos 1 e 3);
- o código que chegou (passo 2) e onde o painel mostra o código de cada afiliado, se mostrar;
- no Pix manual, se marcar como pago avisou o sistema (passo 4);
- o tempo de reserva (passo 5) e se a indicação ficou guardada (passo 6);
- os nomes das colunas do "Exportar Pedidos" (passo 7).

Mande ao SM para o DevMission. O link de afiliado de teste pode ir; os payloads reais e o arquivo exportado **não** vão para o repositório nem para o chat, porque têm dados pessoais.

### 4.4 O pedido de teste depois

**Fazer o teste antes de 23/11 resolve quase tudo.** Venda aprovada antes do 1º dia fica fora de meta, realizado, ranking, bumbo, telão e visão do líder; só aparece no aviso "antes do início" da Visão geral (`docs/regras-de-calculo.md`, S8). O que continua mostrando o teste: a lista de **Pedidos**, a **Adesão** (a célula fica "Já vendeu") e os totais do afiliado. Não atrapalha a campanha.

**Para tirar o teste também da Adesão e dos totais [Admin]:** com "Permitir desconsiderar pedidos" ligada na Campanha (3.3), em **Pedidos**, toque em **Desconsiderar** na linha do pedido, escolha o **Motivo** (**Teste**) e confirme. O pedido sai de todas as contas (inclusive do relatório da campanha, 6.3, onde aparece só no número "Pedidos desconsiderados") e continua na lista, com o selo "Desconsiderado (teste)" (no filtro **Desconsiderados**, **Só os desconsiderados** mostra só eles). **Desfazer** devolve o pedido às contas. Cada um fica na trilha de auditoria. Não mexe na Rifei nem no dinheiro: o bilhete continua valendo no sorteio.

O bilhete comprado é de verdade e entra no sorteio. Decisão do PO (1.5): manter (o dinheiro foi para a causa) ou estornar.

**Para estornar** ([12.6](integracao-rifei.md#126-estorno-de-um-pedido)), nesta ordem:

1. **Efí:** devolva o Pix. No app: "Menu" → "Extrato" → a transação → "Devolver valor".
2. **Rifei:** remova ou ajuste o pedido **antes de 7 dias da reserva**. Pedido pago reservado há 7 dias ou mais fica bloqueado e não pode ser removido (Termos de uso da Rifei, item 5.7). Ex.: teste no dia 17/11, remova até o dia 23/11. Como remover no painel: NÃO DOCUMENTADO (procure na página de pedidos da campanha). Depois do sorteio, nada mais se remove.
3. **Sistema [Admin]:** a Rifei não avisa estorno nem remoção (só pedido novo, pago e expirado), então o pedido continua no sistema como aprovado. Desconsidere-o em **Pedidos**, com o motivo **Estorno** (como acima).

Se um teste for feito **depois de 23/11**, ele conta como venda (e é: o dinheiro entrou). Tirar das contas é decisão do PO: **Desconsiderar** em **Pedidos**, com o motivo **Teste** (fica na trilha e dá para desfazer).

### 4.5 Compra de teste com a marcação pelo sistema (Pix e comprovante; RIFA-070, D32) [Thiago, como admin]

Depois de 3.7 (conexão **Conectado**). Faça com 2 compras de 1 bilhete, pelo link de vendas de uma célula:

1. **Compra A, paga com Pix:** pague na chave. Baixe o extrato do dia (6.6) e suba em **Conferência → Extrato do
   banco**. O pedido aparece em **Para marcar como pago na Rifei**, com a caixa marcada. Toque em **Marcar 1
   selecionado como pago na Rifei**, confira o número na confirmação e confirme.
2. **O resultado:** a tabela "O que aconteceu com cada pedido" mostra **Marcado como pago** (ou **Estava expirado:
   restaurado e marcado**). Toque em **Atualizar**: em segundos o pedido vai para **Já contados**. Confira também em
   **Pedidos → Entregas do webhook** a entrega **Pedido pago** e, na **Trilha**, "Pedidos marcados como pagos na Rifei"
   com o seu nome e o número do pedido.
3. **Compra B, pelo comprovante:** inicie a compra e pague; com o comprovante na mão (sem subir extrato), use
   **Marcar um pedido à mão**: digite o **número do pedido** (ou o número de um bilhete dele) e toque em **Procurar**.
   Confira célula, bilhetes, valor e situação, toque em **Marcar como pago na Rifei** e confirme. Procure de novo o
   mesmo número: a tela diz **Este pedido já está pago**.
4. **Anote para o SM** (integracao-rifei.md, 13.4): se o **Pedido pago** chegou pelo webhook depois da marcação pelo
   sistema; se o número do pedido digitado é o mesmo que a Rifei mostra; quanto tempo levou.
5. **Se der errado:** "A Rifei recusou o token" → cole um novo (3.7). "A Rifei não marcou" ou "Falhou" → marque no
   painel da Rifei como antes (6.6, passo 4) e mande ao SM só a mensagem da tela (sem dados do comprador).

---

## 5. Reunião de cadastro dos líderes

**Pré-requisitos:** campanha ativa com o slug certo (3.3), webhook ligado (3.2), compra de teste aprovada (4), planilha importada com os telefones (3.4) e a campanha na Rifei aceitando pedidos (1.3).

### 5.1 Antes

0. **Senhas das células [Coordenação]** (RIFA-064, D29): é o jeito mais simples de o líder entrar, sem link nenhum.
   - Em **Coordenação → Hierarquia**, no cartão **Login das células com senha**: se aparecer o aviso "… não entram com a senha padrão", duas células ficaram com o mesmo nome no login (ex.: "Pão Vivo" e "Pao Vivo") ou um nome não tem letra nem número. Mude o nome de uma delas (**Editar**, na aba **Células**) antes da reunião: até lá, nenhuma das duas entra pela senha.
   - **Ver a senha de cada célula** → **Copiar** na linha da célula e mande no privado do líder, com o endereço `rifa-videira-kids.madruga.workers.dev/entrar` (ou mande só a regra: o guia do líder, seção 2, já explica com um exemplo).
   - Confira na Campanha que "Login das células com senha padrão" está ligado (3.3).
   - Com a senha, os links do item 1 ficam opcionais para os líderes (servem para quem preferir o link); para discipuladores e redes, continuam sendo o único jeito de entrar.
1. **Links em lote [Admin]:** **Acessos → Líderes, discipuladores e redes** → Papel **Líderes de célula** → **Gerar links para quem ainda não tem (36)**.
   - Abre uma janela com um link por líder. Em cada um: **Abrir no WhatsApp** (abre a conversa com o número da planilha e a mensagem pronta) ou **Copiar mensagem** (sem telefone ou com número estranho).
   - **Os links só aparecem agora**: mande todos antes de tocar em **Pronto**. Se fechar antes, use **Novo link** na linha do líder.
   - A mensagem padrão é esta (o nome e a célula mudam; o link vem na última linha). Para mudar o texto, edite o modelo na Campanha (cartão "Mensagens do link pessoal", 3.3), nunca na hora de mandar:
     > Olá, Fulano! Este é o seu link pessoal para acompanhar a sua célula (Célula X) na campanha da rifa do Videira Kids: as vendas, a meta e a posição no ranking.
     > O link é só seu: não repasse para ninguém, porque quem tiver o link entra como você.
   - Logo depois, se quiser, mande no mesmo privado a mensagem complementar (sem link) da [seção 1 de convite-reuniao.md](convite-reuniao.md#1-mensagem-do-link-pessoal-no-privado-de-cada-líder).
   - Com o acesso deles ligado na Campanha (1.5; padrão ligado), repita com o papel **Discipuladores** e **Redes**. Desligado, a tela avisa e não gera link desse papel. Com uma rede só (3.4), a aba se chama **Líderes e discipuladores** e não tem o papel **Redes**.
   - Cada link vale 45 dias: gerado na semana da reunião, cobre a campanha inteira.
2. **Convite no grupo dos líderes [Coordenação]**, sem link nenhum, depois dos links pessoais: use o texto da [seção 2 de convite-reuniao.md](convite-reuniao.md#2-convite-para-a-reunião-grupo-dos-líderes), que também tem o lembrete da véspera.
3. **Ensaiar a Adesão:** abra **Coordenação → Adesão** no aparelho que vai ser usado na reunião (celular ou notebook). Ela se atualiza sozinha a cada 15 s e tem **Atualizar agora**.
4. **Convites de afiliado [Thiago]:** na Rifei, o cadastro de afiliado é só por convite do organizador ([12.3](integracao-rifei.md#123-afiliados-programa-da-campanha-e-líderes)). Gere e mande o convite de cada líder antes da reunião, pelo caminho que você achou no painel ao ligar os afiliados (1.3) e já usou com a conta afiliada de teste (4.1, passo 1). Se o convite pedir o e-mail de cada líder, use o da **Hierarquia** (coluna `lider_email` da planilha, se a coordenação preencheu) ou peça ao líder. Tenha à mão onde o líder acha o link de afiliado dele, como a conta de teste mostrou (4.1, passo 1), para mostrar na reunião. O que o líder faz está na [seção 1 do guia do líder](guia-lideres.md#1-vender-pela-rifei-o-seu-link-de-afiliado).
5. **Guia do líder [Coordenação]:** gere o PDF de [guia-lideres.md](guia-lideres.md): abra `guia-lideres.html` no navegador → **Imprimir** → **Salvar como PDF**, A4 retrato (1 página). Ele vale como está: das telas da Rifei, fala só do convite, da conta com o e-mail e da Área de afiliados.
6. **Link de vendas [Admin]:** com o modelo gravado na compra de teste (4.1, passo 3), cada líder sai da reunião com o link e o QR code na tela dele. Sem o modelo, o líder usa o link da Área de afiliados (3.6).

### 5.2 Durante

O roteiro de 20 minutos (o que mostrar e em que ordem) está na [seção 3 de convite-reuniao.md](convite-reuniao.md#3-roteiro-da-reunião-20-minutos). Os passos:

1. **Cada líder entra no sistema:** abre `rifa-videira-kids.madruga.workers.dev/entrar`, escreve o nome da célula e a senha (`@nomedacelula1234`, 5.1, item 0) e toca em **Entrar**, ou abre o link pessoal que recebeu e toca em **Entrar**. Ele vê a tela da célula dele (`/minha`), ainda com a contagem regressiva. O limite de 60 entradas por minuto do mesmo Wi-Fi comporta a reunião (a senha e o link contam juntos). "Célula ou senha não conferem."? Confira o nome como está no ranking e, se a célula estiver no aviso da Hierarquia, use o link.
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

**Coordenação → Bumbo** mostra a mensagem do dia, que fala de **ontem** (dia já fechado): venda de ontem em % da meta do dia, acumulado contra a curva, projeção, as 3 primeiras de cada divisão (com o ranking único, as 3 primeiras de todas) e quem mais subiu. Só percentuais e posições, **nunca valores em reais nem quantidade de bilhetes**.

- **Enviar no WhatsApp** abre o WhatsApp com o texto pronto; **Copiar mensagem** copia.
- O seletor de data mostra a mensagem de dias anteriores (ex.: se esqueceu de mandar).
- Antes de 23/11, a mensagem é a contagem regressiva; no 1º dia, a largada; no dia seguinte ao fim, o resultado.

### 6.2 Telão no culto [Coordenação]

- No computador do telão, abra https://rifa-videira-kids.madruga.workers.dev/telao e deixe o navegador em tela cheia (F11 no Chrome e no Edge do Windows).
- Não precisa de login. Mostra jovens e adultos lado a lado (com o ranking único, uma lista só, "Células", na tela toda), só posições e nomes (e o % da meta, se a Campanha estiver configurada para mostrar). Atualiza sozinho a cada minuto; se a internet cair, fica com o último dado e volta sozinho.
- Teste no projetor de verdade antes do primeiro culto.
- O ranking público para mandar nos grupos é a página inicial: https://rifa-videira-kids.madruga.workers.dev/

### 6.3 Acompanhamento [Coordenação]

- **Visão geral:** meta do dia, situação (em dia ou abaixo), curva e projeção, por campanha, divisão, rede, discipulador ou célula. Os avisos de "sem célula" pedem uma olhada na Adesão. No topo, o alerta do webhook (7.1).
- **Rankings:** com valores, para a coordenação.
- **Mapa:** de onde vêm as vendas aprovadas, por estado e por DDD do telefone do comprador (só o DDD é guardado).
- **Bilhetes:** quantos números estão pagos, reservados (aguardando o Pix) e livres, o % vendido e a grade de todos os números (filtro por situação). A busca (ou um toque na grade) mostra o pedido do número: célula, situação e data, sem dado do comprador. Atualiza sozinha a cada 30 s com a tela aberta; depois de marcar pagos na Rifei, toque em **Atualizar agora**. Pedidos recuperados pela Conferência não trazem os números: aparecem num aviso, com a contagem (D35).
- **Adesão:** a fila **Sem célula** deve ficar vazia. Código novo ali = venda de afiliado sem vínculo: vincule. Na seção **Links de vendas** ficam o link e o QR code de cada célula, para mandar ao líder que perdeu o dele ou imprimir (3.6).
- **Pedidos:** a lista dos pedidos (filtro por status, por célula e **Desconsiderados**, busca pelo id da Rifei) e as entregas do webhook. O admin desconsidera ali um pedido de teste, fraude ou estorno (4.4).
- **Líderes, discipuladores e redes** acompanham pelo próprio link (`/minha`), sem valores em reais. O que o líder vê e faz no dia a dia está nas seções [3](guia-lideres.md#3-o-que-você-vê-na-sua-tela) e [4](guia-lideres.md#4-dia-a-dia) do guia do líder.
- **Relatório da campanha** (no fim da **Visão geral**; admin e coordenação): em **O que baixar**, escolha **Totais da campanha**, **Por célula**, **Por discipulador**, **Por rede** (só com mais de uma rede), **Por período**, **Por dia** ou **Por DDD** e toque em **Baixar relatório** (`docs/decisions.md`, D23).
  - É uma planilha (CSV) com os números de agora; depois do fim da campanha, o resultado final. No dia seguinte ao último dia, baixe todos os tipos para guardar e prestar contas.
  - Abre com dois cliques no Excel. No Google Planilhas: **Arquivo → Importar → Fazer upload**, com "Tipo de separador" em "Personalizado" e `;` (ponto e vírgula).
  - As contas fecham entre os arquivos (células + sem célula = totais; períodos, dias e DDD = totais). Os pedidos desconsiderados (4.4) ficam fora de todos; nos totais, só o número deles.
  - Tem valores em reais e o nome dos líderes: fica com a coordenação, nunca nos grupos.
- **Pedidos suspeitos** (mais de 200 bilhetes num pedido ou valor fora do preço): uma vez por semana, um coordenador abre a tela **Pedidos suspeitos** e confere na Rifei. Eles continuam contando até o admin desconsiderá-los em **Pedidos** (motivo **Fraude** ou **Outro**; 4.4), o que é decisão do PO. O desconsiderado continua na lista dos suspeitos, com o selo.

### 6.4 Conferência pelo CSV (RIFA-012; exige o Workers Paid)

A conferência **exige o Workers Paid** (1.1 a): no plano gratuito, a análise de uma campanha cheia passa do limite de CPU por requisição e a Cloudflare pode recusá-la (erro 1102).

1. Na Rifei: pedidos da campanha → **⋮** → **Exportar Pedidos**.
2. **Coordenação → Conferência:** escolha o arquivo como a Rifei baixou (sem abrir e salvar no Excel). O arquivo é lido no navegador e os dados pessoais não saem dele.
3. Confira o mapeamento das colunas, leia as diferenças e use **Recuperar** para as vendas pagas na Rifei que não estão no sistema (**Vendas perdidas**). Elas passam a contar no painel, nos rankings e no bumbo.
   - **Pagamento não registrado** (paga na Rifei, mas no sistema pendente ou expirada: o pedido novo chegou e o pago não; 1.6) **[Admin]**: os que dá para marcar já vêm marcados; **Registrar pagamento** mostra a prévia e só grava na confirmação. O pedido passa a pago com a data do pagamento do arquivo e passa a contar; a quantidade, o valor e o afiliado ficam os do sistema. Se o arquivo traz outra quantidade, outro valor ou outro afiliado, a tela diz qual e não deixa marcar: confira na Rifei. A coordenação vê o grupo, mas só o admin marca.
   - **Recuperações feitas** mostra quem gravou, quando e o tipo (vendas perdidas, pagamentos registrados ou os dois).

Sugestão: uma conferência por semana e sempre que o webhook falhar (7.1); no Pix manual sem o aviso do pagamento (1.6), pelo menos uma por dia, pelo admin, depois da conferência do extrato (6.6). O aviso de webhook parado (na **Visão geral** e em **Pedidos**) leva direto para cá (**Abrir a Conferência**).

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
| Suporte da Rifei (WhatsApp; horário na [12.7](integracao-rifei.md#127-perguntas-para-o-suporte-da-rifei-referência-opcional)) | venda, pagamento ou webhook do lado da Rifei, durante a campanha |

**Quem chamar:** quem notar avisa a coordenação; a coordenação chama o **Thiago**, que abre uma sessão do Claude (SM) com o sintoma, a hora e o print. Problema de pagamento ou de pedido na Rifei: suporte da Rifei (e da Efí, se for o Pix).


### 6.6 Pix manual: o extrato do banco todo dia [Quem cuida do dinheiro]

No Pix manual (1.6), a venda só conta depois de marcada como paga no painel da Rifei. A **Conferência → Extrato do banco (Pix manual)** (admin e coordenação; RIFA-059, D26) diz quais pedidos marcar. Ela só lê: nada do sistema muda ali, e o extrato não sai do computador (é lido no navegador e esquecido ao sair da tela).

1. **Baixe o extrato do dia no Bradesco Net Empresa** (o acesso de consulta basta): **Saldos e Extratos** → extrato **por período** (o dia, ou desde a última conferência) → **Salvar** (o ícone do disquete) → **PDF** (num guia, ele aparece em "Outros"; ou **OFX**, se aparecer: os dois servem). O caminho exato do Net Empresa: NÃO DOCUMENTADO nas fontes públicas (o caminho acima é o que os guias de terceiros descrevem para o Bradesco); anote o caminho certo na compra de teste (4.1, passo 4). Sem as duas opções, selecione a tabela do extrato na tela, copie e cole na caixa **Ou cole aqui a tabela do extrato**, e toque em **Ler o texto colado**.
2. **Suba o arquivo** em **Extrato do banco ou comprovantes de Pix (PDF, OFX ou CSV)**. O PDF é lido aqui, no navegador (na primeira vez, a tela baixa o leitor de PDF, uns 550 KB: espere um instante em **Lendo o extrato…**), e não sai do computador. A tela pega só os créditos com **PIX** ou **TRANSF** na descrição (troque em **Palavras do Pix**, se o banco escrever de outro jeito) e diz quantos ficaram de fora e por quê; no resultado aparece **Lido do arquivo PDF: N lançamentos**. Se o PDF não servir, a tela diz por quê:
   - **Este PDF é uma imagem**: o extrato foi escaneado ou fotografado, e não tem texto para ler. Baixe o extrato do banco de novo (em PDF ou em OFX) ou copie a tabela da tela do banco.
   - **Este PDF tem senha**: a tela não lê PDF com senha. Baixe de novo sem a senha, ou em OFX.
   - **Não achamos lançamentos no PDF**: o PDF não é o extrato (um comprovante, por exemplo) ou o banco mudou o jeito de escrever. Use o OFX ou cole a tabela e avise o SM.
   - **No primeiro PDF de verdade** (compra de teste), confira com o extrato aberto: o número de lançamentos lidos, os débitos de fora e cada Pix com a data certa. Se algo não bater, use o OFX ou o texto colado e avise o SM, sem mandar o arquivo (ele tem dados do banco).
   - **Comprovantes de Pix em PDF (RIFA-074, D34):** no mesmo campo, escolha também os comprovantes (o do app do Bradesco ou o que o comprador mandou, de qualquer banco), um Pix por arquivo, **vários de uma vez** e misturados com o extrato. A tela lê de cada comprovante o valor, a data e a hora, o nome de quem pagou e o **identificador**; no Pix manual da Rifei o identificador é o número do pedido, e então o pedido vem como **Certo**. Sem o identificador, vale o valor, a data e a hora, como no extrato. Com mais de um arquivo, aparece **Arquivos lidos**, com o resultado de cada um; o mesmo Pix no extrato e no comprovante (ou em dois comprovantes) conta uma vez só. **Foto ou print** do comprovante não serve: a tela pede o PDF (no app do banco, abra o Pix → **Compartilhar comprovante** → **PDF**). Pix **agendado** não conta (ainda não foi pago). **Cuidado:** comprovante pode ser adulterado. O Pix que veio só do comprovante aparece com "Só no comprovante: confira no extrato antes de marcar"; o jeito seguro é escolher o extrato junto com os comprovantes.
   - **Relatório "Pix recebidos" do Bradesco em PDF (RIFA-077):** a lista de Pix recebidos (colunas Data, Referência, Identificação, Horário, Entradas e Saídas, com "Ver detalhes") também serve, no mesmo campo. A tela lê cada lançamento: a data (o ano vem do código do Pix), o horário, o valor, o nome de quem pagou (sem o banco) e o código do Pix. Todos contam como Pix, sem precisar das **Palavras do Pix**; o que está na coluna **Saídas** fica de fora. Confira na primeira vez: o número de Pix lidos e os horários batem com o PDF aberto.
   - **Na compra de teste**, suba também o comprovante do Pix de teste (sozinho e depois junto com o extrato) e anote: se o pedido veio **Certo** (o comprovante traz o identificador = número do pedido), e com que nome o banco chama o campo (Identificador, ID da transação...). Não mande o arquivo ao SM; só a forma dos campos, com o nome trocado por um fictício.
3. **Leia o resultado:**
   - **Para marcar como pago na Rifei**: os pedidos pendentes ou expirados que o extrato confirma, com o valor, a célula e o grau (**Certo**: o Pix traz o número do pedido; **Provável**: só este pedido tem o valor e o horário do Pix). Toque em **Copiar os números dos pedidos** (um por linha).
   - **Ambíguos**: mais de um pedido tem o valor e o horário daquele Pix. A tela mostra o nome de quem pagou (se o banco trouxer) e os candidatos (número, célula, hora da reserva e quantidade): procure-os na Rifei e decida pelo nome do comprador.
   - **Pix sem pedido**: nenhum pedido serve. Pode ser um Pix de fora da campanha, um valor errado ou um Pix em dobro (a tela diz). Não marque nada: veja na Rifei ou fale com quem pagou.
   - **Já contados**: o pedido já está pago no sistema. Nada a fazer.
   - **Tempo entre a reserva e o Pix** (padrão 24 horas): se um Pix que você sabe que é da campanha aparece sem pedido, aumente; se aparecem ambíguos demais, diminua. O resultado muda na hora.
4. **[Admin] Marque pelo sistema** (com a conexão de 3.7): escolha os pedidos (todos vêm marcados; **Selecionar
   todos** / **Desmarcar todos**), toque em **Marcar N selecionados como pago na Rifei** e confirme. A tela mostra o
   resultado de cada pedido; **Atualizar** confere se a Rifei avisou o sistema. O Pix que o extrato não achou (ou um
   comprovante): **Marcar um pedido à mão**, pelo número do pedido ou do bilhete. **Sem a conexão (ou a coordenação):**
   na Rifei, procure cada número copiado nos pedidos da campanha e marque como pago. A venda passa a contar quando a
   Rifei avisar o sistema (em segundos, se o aviso funcionar: 1.6).
5. **Confira depois:** suba o mesmo extrato de novo (ou abra **Pedidos**): os marcados passam para **Já contados**. Se continuarem em **Para marcar**, a Rifei não avisou o sistema: faça a **conferência pelo CSV** (6.4) e, como **[Admin]**, **Registrar pagamento**.

Quando: pelo menos uma vez por dia (no fim do dia) e, nos dias de muita venda, de manhã e à tarde, para o ranking ficar em dia. Um extrato de vários dias também serve (a tela busca os pedidos do período, até 12 mil).

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
3. Se um dado estragado derrubou o sistema: volte o banco com o Time Travel (2.4) para um instante antes do problema. **Tudo gravado depois se perde**: recupere as vendas pela conferência (6.4; as que voltaram a pendentes ficam em **Pagamento não registrado**, e o admin as marca como pagas) e refaça as revogações de link desse intervalo. Antes de qualquer mudança arriscada no meio da campanha (importação grande, migração nova), anote um bookmark novo (2.1).
4. Avise os líderes no grupo que as vendas pela Rifei continuam normais.

### 7.3 Um link pessoal vazou (revogar) [Admin]

- **De alguém da coordenação** (vê tudo, inclusive valores): **Acessos → Coordenação** → o cartão da pessoa → **Revogar link** em cada link válido → **Gerar link novo** e mande só para a pessoa. A revogação derruba as sessões abertas por aquele link.
  - O último link válido de admin não pode ser revogado: gere o novo primeiro.
  - Para tirar o acesso de vez: **Desativar acesso** (derruba todas as sessões da pessoa).
  - **Se alguém pode ter entrado com o link:** veja na trilha de auditoria (4.2) o que esse usuário fez depois do vazamento. Um link de coordenação muda campanha, hierarquia e vínculos; um de admin também cria pessoas e links (`usuario.criar`, `link.criar`, `acessos_hierarquia.gerar_links`). Desfaça o que não foi a equipe: em **Acessos**, revogue os links que ele gerou e desative as pessoas que ele criou.
- **De um líder, discipulador ou rede** (vê só os números do alvo dele, sem reais): **Acessos → Líderes, discipuladores e redes** → **Trocar acesso** na linha. Gera um link novo, revoga os anteriores e tira do sistema o aparelho que estava com o link velho. Mande o novo para a pessoa certa. Com o acesso do papel desligado na Campanha (discipuladores ou redes), **Trocar acesso** e **Novo link** ficam indisponíveis: use **Revogar link** em cada link válido da pessoa (o vazado não volta a valer quando religar) e, depois de religar, mande um **Novo link**.
- **Os links públicos** (`/` e `/telao`) não têm segredo: não há o que revogar.
- **A senha das células** (RIFA-064, D29) não é segredo e não se troca: é sempre `@` + nome da célula + `1234`. Se alguém estiver entrando como uma célula que não é a dele: **[Admin]** desligue "Login das células com senha padrão" na Campanha (todos que entraram pela senha saem na hora; quem tem o link continua) ou, só para aquela célula, **Desativar acesso** na linha dela em **Acessos → Líderes, discipuladores e redes** (o link e a senha param de entrar; reative e mande um link novo ao líder). Cada entrada pela senha fica na trilha (**Célula entrou com a senha padrão**, com a célula).
- **Vazou um token [Thiago]:**
  - **Token do webhook:** gere outro no site (3.2, passo 1: o anterior para de valer na hora) e cole na Rifei. As entregas entre os dois passos se perdem: confira pelo CSV (6.4). Se estiver na alternativa do wrangler, gerar pelo site também neutraliza o `RIFEI_WEBHOOK_TOKEN` vazado (o do site tem prioridade).
  - `CLOUDFLARE_API_TOKEN`: em **API Tokens** na Cloudflare, apague ou renove o token e cadastre o novo no segredo `CLOUDFLARE_API_TOKEN` do GitHub (1.2; no ambiente `producao`, se o reforço da D18 estiver ligado).
  - Credenciais da Efí (Client Secret ou certificado): crie na Efí um certificado e uma aplicação novos e cadastre de novo na Rifei (12.2, passos B, C e E).

### 7.4 Um líder trocou (trocar acesso)

1. **Hierarquia → Células → Editar célula:** novo nome e telefone do líder (ou corrija a planilha e importe de novo).
2. **[Admin]** **Acessos → Líderes, discipuladores e redes → Trocar acesso** na célula: o link novo vai para o novo líder e o aparelho do antigo sai. A senha da célula não muda (é a do nome da célula): o líder antigo que entrou pela senha continua até tocar em **Sair**; para tirá-lo, use **Desativar acesso** e depois reative e mande o link novo.
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
8. **Rifei e Efí:** o passo a passo está na [seção 12 de integracao-rifei.md](integracao-rifei.md#12-rifei-e-efí-passo-a-passo-para-o-po). Ainda NÃO DOCUMENTADO pela Rifei: onde ligar os afiliados e gerar o convite, o formato do link de afiliado (sem ele, o modelo do link de vendas fica vazio e as células ficam sem link e sem QR code, 3.6), onde ver o código de cada afiliado, onde adicionar a Efí e o nome do campo da chave Pix. Saem do painel, ao criar a campanha (1.3), e da compra de teste (4.1; [seção 9 de integracao-rifei.md](integracao-rifei.md#9-o-que-confirmar-com-uma-campanha-de-teste)), sem esperar o suporte. O [guia do líder](guia-lideres.md) e o [convite](convite-reuniao.md) já valem de qualquer jeito.
9. **Vínculo afiliado → célula sem data:** trocar ou desvincular é retroativo (7.4).
10. ~~Volta do código só pelo terminal~~: resolvido na RIFA-035 (workflow **Voltar o site para a versão anterior**, pelo celular; 2.4 e 7.2). Continua: na primeira publicação não há versão anterior para voltar; só o Time Travel do banco.
11. ~~**Token do webhook pelo site (RIFA-039) em construção**~~: resolvido na RIFA-039 (Acessos → **Webhook da Rifei**, só admin). A alternativa do wrangler (3.2) continua valendo.
12. ~~Pago na Rifei e pendente no sistema não se corrige pela conferência~~: resolvido na RIFA-056. Quando o "Pedido novo" chega e o "Pedido pago" não (no Pix manual, se marcar como pago não avisar o sistema, 1.6; ou o webhook fora do ar entre os dois avisos), o pedido aparece na conferência (6.4) em **Pagamento não registrado**, e o admin o marca como pago (**Registrar pagamento**; [integracao-rifei.md, seção 10](integracao-rifei.md#10-conferência-pelo-csv-exportar-pedidos-rifa-012), Recuperar). Continua: só o admin faz (a coordenação vê o grupo, sem o botão), o arquivo precisa confirmar a quantidade, o valor e o afiliado gravados, e até a conferência essas vendas não aparecem no painel.
