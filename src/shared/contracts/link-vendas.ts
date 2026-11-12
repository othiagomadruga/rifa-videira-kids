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
 * Segurança (D24): o modelo começa sempre por `https://rifei.com.br/` (HOSTS_LINK_VENDAS), e o link montado é
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
 * - afiliado: o `affiliate_id` do afiliado vinculado à célula (obrigatório: é ele que faz a venda contar para a
 *   célula).
 */
export const MARCADORES_LINK_VENDAS = ["slug", "afiliado"] as const;
export type MarcadorLinkVendas = (typeof MARCADORES_LINK_VENDAS)[number];

/** Um marcador escrito no modelo: `{` + letras, dígitos ou `_` + `}` (a mesma forma das mensagens, regras.ts). */
const MARCADOR_NO_TEXTO = /\{([A-Za-z0-9_]+)\}/g;

/** Espaço, tabulação, quebra de linha ou outro caractere de controle. */
const ESPACO_OU_CONTROLE = /[\s\p{Cc}]/u;

/** Valores de exemplo para conferir se o modelo forma um endereço (o slug e o id de verdade vêm do banco). */
const EXEMPLO = { slug: "exemplo", affiliateId: 1 } as const;

/** O que preenche os marcadores do modelo. */
export interface ValoresLinkVendas {
  /** O `slug_rifei` da campanha ativa. */
  slug: string;
  /** O `affiliate_id` (inteiro positivo) do afiliado vinculado à célula. */
  affiliateId: number;
}

/** Preenche os marcadores numa passada só: um slug que contenha "{afiliado}" não é trocado de novo. */
function preencher(modelo: string, valores: ValoresLinkVendas): string {
  return modelo.replace(MARCADOR_NO_TEXTO, (trecho, marcador: string) =>
    marcador === "slug"
      ? encodeURIComponent(valores.slug)
      : marcador === "afiliado"
        ? String(valores.affiliateId)
        : trecho,
  );
}

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
 * - sem espaço, tabulação, quebra de linha ou caractere de controle;
 * - só os marcadores `{slug}` e `{afiliado}`, e o `{afiliado}` obrigatório;
 * - nenhuma chave solta (`{` ou `}` fora de um marcador);
 * - preenchido com valores de exemplo, forma um link de vendas válido (`eLinkDeVendas`).
 */
export function problemasDoModeloLinkVendas(modelo: string): string[] {
  const problemas: string[] = [];
  if (!HOSTS_LINK_VENDAS.some((host) => modelo.startsWith(`https://${host}/`)))
    problemas.push(
      `O link de vendas começa com ${HOSTS_LINK_VENDAS.map((host) => `https://${host}/`).join(" ou ")}, o endereço da Rifei.`,
    );
  if (ESPACO_OU_CONTROLE.test(modelo))
    problemas.push(
      "Tire os espaços e as quebras de linha: o link é um endereço só.",
    );
  const aceitos: readonly string[] = MARCADORES_LINK_VENDAS;
  const desconhecidos = new Set<string>();
  for (const [, marcador] of modelo.matchAll(MARCADOR_NO_TEXTO))
    if (!aceitos.includes(marcador)) desconhecidos.add(marcador);
  for (const marcador of desconhecidos)
    problemas.push(
      `Marcador {${marcador}} não existe no link de vendas. Use: {slug} e {afiliado}.`,
    );
  if (!modelo.includes("{afiliado}"))
    problemas.push(
      "O modelo precisa ter {afiliado}: é o número do afiliado que faz a venda contar para a célula.",
    );
  if (/[{}]/.test(modelo.replace(MARCADOR_NO_TEXTO, "")))
    problemas.push(
      "Há uma chave solta no modelo: as chaves só aparecem em {slug} e {afiliado}.",
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
 * formato), modelo com problema (gravado à mão), slug vazio (ou "." e ".."), `affiliateId` que não é inteiro
 * positivo, ou link montado fora de `eLinkDeVendas`. Null nunca vira erro na rota: a resposta sai com
 * `configurado: false` (modelo) ou sem o link daquele afiliado, e o site explica.
 */
export function montarLinkDeVendas(
  modelo: string | null,
  valores: ValoresLinkVendas,
): string | null {
  if (!modeloLinkVendasValido(modelo)) return null;
  if (!Number.isSafeInteger(valores.affiliateId) || valores.affiliateId <= 0)
    return null;
  const slug = valores.slug.trim();
  // "." e ".." viram segmentos de ponto, que o URL apaga do caminho (o encodeURIComponent não codifica o ponto).
  if (slug === "" || slug === "." || slug === "..") return null;
  return normalizar(preencher(modelo, { ...valores, slug }));
}

// ---------------------------------------------------------------------------------------------------
// O QR code (gerado no navegador, sem rede; D24)
// ---------------------------------------------------------------------------------------------------

/**
 * Nível de correção de erros do QR code: M (recupera ~15% dos módulos), o padrão para um link curto. Escuro sobre
 * claro sempre, mesmo no tema escuro (muitos leitores não leem o QR invertido).
 */
export const NIVEL_CORRECAO_QR_LINK_VENDAS = "M";

/** Margem branca em volta do QR code, em módulos (a "zona de silêncio" da norma). */
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
