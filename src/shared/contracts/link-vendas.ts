/**
 * Link de vendas de cada célula e o QR code dele (RIFA-046; docs/decisions.md D24). A venda só conta para uma célula
 * quando é feita na Rifei pelo link de afiliado do líder: o pedido chega pelo webhook com o `affiliate_id`, e a
 * coordenação liga o afiliado à célula na tela Adesão (D7 da integração). Pix mandado direto para uma chave, fora da
 * Rifei, nunca entra no sistema.
 *
 * O formato do link de afiliado da Rifei NÃO está documentado (integracao-rifei.md, seção 12.3). Por isso o link sai
 * de um MODELO que só o admin grava (`PUT /api/admin/links-vendas/modelo`), vazio até o PO confirmar o formato com a
 * Rifei, com dois marcadores: `{slug}` (o slug da campanha) e `{afiliado}` (o `affiliate_id`, o mesmo número que
 * chega no webhook). Assim o link que o sistema mostra é, por construção, o que faz a venda contar para a célula.
 *
 * Segurança (D24): o modelo começa sempre por `https://rifei.com.br/` (HOSTS_LINK_VENDAS), sem outro endereço depois
 * (OUTRO_ENDERECO_NO_LINK), e o link montado é
 * conferido de novo (`eLinkDeVendas`) antes de sair da API e no schema das respostas: nenhum outro endereço chega aos
 * líderes, aos compradores ou ao QR code.
 *
 * Sem zod, como regras.ts: o site importa daqui (as regras, o nome do arquivo do QR) sem levar o zod para o pacote.
 * Os schemas e o catálogo das rotas (ROTAS_LINK_VENDAS) ficam em api.ts.
 */

// ---------------------------------------------------------------------------------------------------
// O modelo do link
// ---------------------------------------------------------------------------------------------------

/**
 * Os endereços aceitos no link de vendas: só o da Rifei, sem `www.` e sem subdomínio (a campanha está em
 * `rifei.com.br/<slug>`, integracao-rifei.md 12.1). Se a Rifei confirmar o link de afiliado noutro endereço (ex.:
 * `app.rifei.com.br`), o SM acrescenta aqui (D24); o banco só confere o tamanho do modelo.
 */
export const HOSTS_LINK_VENDAS = ["rifei.com.br"] as const;

/** Tamanho máximo do modelo (um link de afiliado real tem poucas dezenas de caracteres). */
export const LIMITE_CARACTERES_MODELO_LINK_VENDAS = 300;

/** Tamanho máximo do link montado (o slug da campanha tem até 200 caracteres e vai codificado). */
export const LIMITE_CARACTERES_LINK_VENDAS = 2048;

/**
 * Marcadores do modelo, entre chaves:
 * - slug: o `slug_rifei` da campanha ativa (codificado com encodeURIComponent);
 * - afiliado: o `affiliate_id` do afiliado vinculado à célula;
 * - codigo (RIFA-070, D29): o código do afiliado na Rifei (`afiliados.codigo_rifei`, gravado pela sincronização com a
 *   API da Rifei; codificado com encodeURIComponent). É o `ref` do link de vendas real:
 *   `https://rifei.com.br/{slug}?ref={codigo}`.
 * O modelo precisa de {afiliado} ou de {codigo}: é o que faz a venda contar para a célula.
 */
export const MARCADORES_LINK_VENDAS = ["slug", "afiliado", "codigo"] as const;
export type MarcadorLinkVendas = (typeof MARCADORES_LINK_VENDAS)[number];

/** Um marcador escrito no modelo: `{` + letras, dígitos ou `_` + `}` (a mesma forma das mensagens, regras.ts). */
const MARCADOR_NO_TEXTO = /\{([A-Za-z0-9_]+)\}/g;

/**
 * Espaço, tabulação, quebra de linha, caractere de controle ou invisível (de formatação, como o espaço de largura
 * zero e as marcas de direção do texto, que vêm junto quando se copia um link do WhatsApp ou de um site).
 */
const ESPACO_OU_INVISIVEL = /[\s\p{Cc}\p{Cf}]/u;

/**
 * Outro endereço depois do da Rifei (como o adendo da RIFA-042 nas mensagens): `//` (também `https://` e o caminho
 * que começa por `//`), `\` (o navegador lê como `/`) ou `www.`. O site de destino continua o da Rifei, mas um segundo
 * endereço no link só serviria para levar o comprador a outro site por um redirecionamento da página de destino, e
 * nenhum formato plausível do link de afiliado tem um.
 */
const OUTRO_ENDERECO_NO_LINK = /\/\/|\\|www\./i;

/** Valores de exemplo para conferir se o modelo forma um endereço (o slug e o id de verdade vêm do banco). */
const EXEMPLO = { slug: "exemplo", affiliateId: 1, codigo: "exemplo" } as const;

/** O que preenche os marcadores do modelo. */
export interface ValoresLinkVendas {
  /** O `slug_rifei` da campanha ativa. */
  slug: string;
  /** O `affiliate_id` (inteiro positivo) do afiliado vinculado à célula. */
  affiliateId: number;
  /** O código do afiliado na Rifei (RIFA-070); null ou ausente = ainda não sincronizado (sem link com {codigo}). */
  codigo?: string | null;
}

/** Preenche os marcadores numa passada só: um slug que contenha "{afiliado}" não é trocado de novo. */
function preencher(modelo: string, valores: ValoresLinkVendas): string {
  return modelo.replace(MARCADOR_NO_TEXTO, (trecho, marcador: string) =>
    marcador === "slug"
      ? encodeURIComponent(valores.slug)
      : marcador === "afiliado"
        ? String(valores.affiliateId)
        : marcador === "codigo" && valores.codigo
          ? encodeURIComponent(valores.codigo)
          : trecho,
  );
}

/** O texto que a tela e as mensagens usam para a lista dos marcadores. */
const LISTA_DE_MARCADORES = "{slug}, {afiliado} e {codigo}";

/** O endereço na forma canônica (`URL.href`), ou null se não for um link de vendas válido. */
function normalizar(texto: string): string | null {
  try {
    const href = new URL(texto).href;
    return eLinkDeVendas(href) ? href : null;
  } catch {
    return null;
  }
}

/**
 * O texto é um link de vendas que pode sair da API e virar QR code: `https:`, endereço de HOSTS_LINK_VENDAS, sem
 * usuário, senha nem porta, na forma canônica (`URL.href` igual ao texto) e até LIMITE_CARACTERES_LINK_VENDAS.
 * É a conferência do schema das respostas: um modelo gravado à mão, ou um erro na montagem, nunca leva outro
 * endereço aos líderes.
 */
export function eLinkDeVendas(texto: string): boolean {
  if (texto.length > LIMITE_CARACTERES_LINK_VENDAS) return false;
  try {
    const url = new URL(texto);
    return (
      url.protocol === "https:" &&
      (HOSTS_LINK_VENDAS as readonly string[]).includes(url.hostname) &&
      url.username === "" &&
      url.password === "" &&
      url.port === "" &&
      url.href === texto
    );
  } catch {
    return false;
  }
}

/**
 * Problemas de um modelo, em português, para a tela mostrar enquanto o admin digita e a API recusar (lista vazia =
 * válido). Não confere o tamanho (o schema confere). Regras:
 * - começa por `https://<endereço da Rifei>/` (HOSTS_LINK_VENDAS), exatamente assim, em minúsculas: o endereço fica
 *   fixo e os marcadores só entram depois da barra, então nenhum valor muda o site de destino;
 * - depois do endereço da Rifei, nenhum outro endereço (`//`, `\` ou `www.`; OUTRO_ENDERECO_NO_LINK);
 * - sem espaço, tabulação, quebra de linha, caractere de controle ou invisível;
 * - só os marcadores `{slug}`, `{afiliado}` e `{codigo}`, e o `{afiliado}` ou o `{codigo}` obrigatório;
 * - nenhuma chave solta (`{` ou `}` fora de um marcador);
 * - preenchido com valores de exemplo, forma um link de vendas válido (`eLinkDeVendas`).
 */
export function problemasDoModeloLinkVendas(modelo: string): string[] {
  const problemas: string[] = [];
  const inicio = HOSTS_LINK_VENDAS.map((host) => `https://${host}/`).find(
    (endereco) => modelo.startsWith(endereco),
  );
  if (inicio === undefined)
    problemas.push(
      `O link de vendas começa com ${HOSTS_LINK_VENDAS.map((host) => `https://${host}/`).join(" ou ")}, o endereço da Rifei.`,
    );
  // A barra do fim do endereço fica no trecho conferido: "https://rifei.com.br//golpe.example" também é recusado.
  else if (OUTRO_ENDERECO_NO_LINK.test(modelo.slice(inicio.length - 1)))
    problemas.push(
      "Tire do modelo o outro endereço (//, \\ ou www.): o link de vendas leva só à Rifei.",
    );
  if (ESPACO_OU_INVISIVEL.test(modelo))
    problemas.push(
      "Tire os espaços, as quebras de linha e os caracteres invisíveis: o link é um endereço só.",
    );
  const aceitos: readonly string[] = MARCADORES_LINK_VENDAS;
  const desconhecidos = new Set<string>();
  for (const [, marcador] of modelo.matchAll(MARCADOR_NO_TEXTO))
    if (!aceitos.includes(marcador)) desconhecidos.add(marcador);
  for (const marcador of desconhecidos)
    problemas.push(
      `Marcador {${marcador}} não existe no link de vendas. Use: ${LISTA_DE_MARCADORES}.`,
    );
  if (!modelo.includes("{afiliado}") && !modelo.includes("{codigo}"))
    problemas.push(
      "O modelo precisa ter {afiliado} ou {codigo}: é o afiliado que faz a venda contar para a célula.",
    );
  if (/[{}]/.test(modelo.replace(MARCADOR_NO_TEXTO, "")))
    problemas.push(
      `Há uma chave solta no modelo: as chaves só aparecem em ${LISTA_DE_MARCADORES}.`,
    );
  if (problemas.length === 0 && normalizar(preencher(modelo, EXEMPLO)) === null)
    problemas.push("O modelo não forma um endereço válido da Rifei.");
  return problemas;
}

/** O modelo gravado serve para montar os links (não é null, cabe no limite e não tem problema). */
export function modeloLinkVendasValido(
  modelo: string | null,
): modelo is string {
  return (
    modelo !== null &&
    modelo.length <= LIMITE_CARACTERES_MODELO_LINK_VENDAS &&
    problemasDoModeloLinkVendas(modelo).length === 0
  );
}

/**
 * O link de vendas de um afiliado, na forma canônica (`URL.href`), ou null: sem modelo (o PO ainda não confirmou o
 * formato), modelo com problema (gravado à mão), slug vazio (ou "." e ".."), slug que o `encodeURIComponent` recusa
 * (um surrogate solto), `affiliateId` que não é inteiro positivo, modelo com {codigo} e o afiliado sem código (ainda não
 * sincronizado com a Rifei, RIFA-070), ou link montado fora de `eLinkDeVendas`. Null
 * nunca vira erro na rota: a resposta sai com `configurado: false` (modelo) ou sem o link daquele afiliado, e o site
 * explica.
 */
export function montarLinkDeVendas(
  modelo: string | null,
  valores: ValoresLinkVendas,
): string | null {
  if (!modeloLinkVendasValido(modelo)) return null;
  if (!Number.isSafeInteger(valores.affiliateId) || valores.affiliateId <= 0)
    return null;
  // Com {codigo}, o afiliado ainda não sincronizado (sem código) fica sem link: nunca um link com "{codigo}" cru.
  if (modelo.includes("{codigo}") && !valores.codigo?.trim()) return null;
  const slug = valores.slug.trim();
  // "." e ".." viram segmentos de ponto, que o URL apaga do caminho (o encodeURIComponent não codifica o ponto).
  if (slug === "" || slug === "." || slug === "..") return null;
  try {
    return normalizar(preencher(modelo, { ...valores, slug }));
  } catch {
    // URIError do encodeURIComponent (slug com surrogate solto): sem link, nunca um 500.
    return null;
  }
}

// ---------------------------------------------------------------------------------------------------
// O QR code (gerado no navegador, sem rede; D24)
// ---------------------------------------------------------------------------------------------------

/**
 * Nível de correção de erros do QR code: M (recupera ~15% dos módulos), o padrão para um link curto. Escuro sobre
 * claro sempre, mesmo no tema escuro (muitos leitores não leem o QR invertido).
 */
export const NIVEL_CORRECAO_QR_LINK_VENDAS = "M";

/**
 * Margem branca em volta do QR code, em módulos (a "zona de silêncio" da norma). Vai como o `border` do `encodeQR`
 * (a matriz `raw` já sai com ela; o `qr` 0.7.2 recusa `border: 0` com RangeError), e a tela pinta só os módulos
 * escuros sobre o fundo branco.
 */
export const MARGEM_QR_LINK_VENDAS_MODULOS = 4;

/** Prefixo do arquivo da imagem do QR code ("Baixar imagem"). */
export const PREFIXO_ARQUIVO_QR_LINK_VENDAS = "link-de-vendas";

/**
 * O nome do arquivo da imagem do QR code de uma célula: `link-de-vendas-<nome em ASCII>.png` (ex.: "Célula Ágape" →
 * `link-de-vendas-celula-agape.png`). Só letras minúsculas sem acento, dígitos e hífen, até 60 caracteres no nome;
 * sem nada aproveitável, `link-de-vendas-celula.png`.
 */
export function nomeDoArquivoQrLinkVendas(celulaNome: string): string {
  const nome = celulaNome
    .normalize("NFD")
    .replace(/\p{M}/gu, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60)
    .replace(/-+$/, "");
  return `${PREFIXO_ARQUIVO_QR_LINK_VENDAS}-${nome === "" ? "celula" : nome}.png`;
}
