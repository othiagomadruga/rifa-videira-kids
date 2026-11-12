/**
 * Regras da campanha que o admin liga, desliga ou edita na tela Campanha (Sprint 6; docs/decisions.md D20):
 * - RIFA-028: desconsiderar pedido (teste, fraude ou estorno), com a chave `pedidos.desconsiderar`;
 * - RIFA-029: acesso de discipuladores e de redes, com as chaves `acesso.discipuladores` e `acesso.redes`;
 * - RIFA-031: remover afiliado de teste (sem chave: só admin e só sem pedido que conte);
 * - RIFA-032: os modelos das mensagens do WhatsApp que levam os links de acesso (`mensagens`).
 *
 * Sem zod, como calculos.ts: o site importa daqui (constantes, padrões e o preenchimento das mensagens) sem levar
 * o zod para o pacote. Os schemas ficam em dominio.ts (configuração da campanha) e api.ts (rotas).
 */
import type { Papel } from "./acesso";

// ---------------------------------------------------------------------------------------------------
// RIFA-028: desconsiderar pedido
// ---------------------------------------------------------------------------------------------------

/**
 * Por que o admin tirou o pedido das contas. A Rifei não manda estorno nem cancelamento (só new_order, paid_order
 * e expired_order), por isso o caminho é manual.
 */
export const MOTIVOS_DESCONSIDERACAO = [
  "teste",
  "fraude",
  "estorno",
  "outro",
] as const;
export type MotivoDesconsideracao = (typeof MOTIVOS_DESCONSIDERACAO)[number];

/** Observação curta e opcional do admin (texto livre, sem dado pessoal). */
export const LIMITE_OBSERVACAO_DESCONSIDERACAO = 140;

/**
 * A observação parece ter um contato ou documento do comprador: um "@" (e-mail) ou 8 dígitos seguidos, depois de
 * tirar espaços, pontos, traços, barras e parênteses (telefone com ou sem DDD, CPF, cartão). É uma trava barata,
 * não uma garantia: a tela também pede para não escrever nome, telefone ou e-mail.
 */
export function observacaoTemContato(texto: string): boolean {
  return texto.includes("@") || /\d{8}/.test(texto.replace(/[\s.()/-]/g, ""));
}

/** `pedidos` da campanha: a ação de desconsiderar começa desligada (o PO liga quando precisar). */
export const PEDIDOS_PADRAO = { desconsiderar: false } as const;

// ---------------------------------------------------------------------------------------------------
// RIFA-029: acesso de discipuladores e de redes (líderes não são afetados)
// ---------------------------------------------------------------------------------------------------

/** `acesso` da campanha: os dois acessos começam ligados (como hoje). */
export const ACESSO_PADRAO = { discipuladores: true, redes: true } as const;
export type ChaveDeAcesso = keyof typeof ACESSO_PADRAO;

/** Os papéis que têm chave de acesso na campanha. O `lider` não tem: entra sempre. */
export const PAPEIS_COM_CHAVE_DE_ACESSO = ["discipulador", "rede"] as const;
export type PapelComChaveDeAcesso = (typeof PAPEIS_COM_CHAVE_DE_ACESSO)[number];

/** A chave de `acesso` que vale para cada papel. */
export const CHAVE_DE_ACESSO_DO_PAPEL = {
  discipulador: "discipuladores",
  rede: "redes",
} as const satisfies Record<PapelComChaveDeAcesso, ChaveDeAcesso>;

/**
 * O papel pode entrar e usar /api/minha/* com esta configuração? Só discipulador e rede dependem da chave; o líder
 * e a coordenação, nunca. Sem campanha ativa, vale ACESSO_PADRAO.
 */
export function acessoDoPapelLigado(
  acesso: Readonly<Record<ChaveDeAcesso, boolean>>,
  papel: Papel,
): boolean {
  return papel === "discipulador" || papel === "rede"
    ? acesso[CHAVE_DE_ACESSO_DO_PAPEL[papel]]
    : true;
}

// ---------------------------------------------------------------------------------------------------
// Chaves (`detalhes` do 409 acao_desligada)
// ---------------------------------------------------------------------------------------------------

/** Cada chave da campanha pelo caminho no corpo: é o `chave` do 409 `acao_desligada`. */
export const CHAVES_REGRAS = [
  "pedidos.desconsiderar",
  "acesso.discipuladores",
  "acesso.redes",
] as const;
export type ChaveRegra = (typeof CHAVES_REGRAS)[number];

// ---------------------------------------------------------------------------------------------------
// RIFA-031: remover afiliado de teste
// ---------------------------------------------------------------------------------------------------

/** No 409 `afiliado_com_pedidos`, quantos ids de pedidos que contam vão nos `detalhes` (os mais recentes). */
export const LIMITE_PEDIDOS_NO_DETALHE = 20;

// ---------------------------------------------------------------------------------------------------
// RIFA-032: modelos das mensagens do WhatsApp que levam os links de acesso
// ---------------------------------------------------------------------------------------------------

/**
 * Os textos editáveis: a mensagem do link pessoal de cada tipo de pessoa (tela Acessos, "Copiar mensagem" e
 * "Abrir no WhatsApp"). O bumbo NÃO entra: é montado pela API a cada dia com percentuais e posições, e um texto
 * livre ali quebraria a garantia de nunca ter R$ nem quantidade no que é público (R9).
 */
export const TIPOS_MENSAGEM = [
  "link_coordenacao",
  "link_lider",
  "link_discipulador",
  "link_rede",
] as const;
export type TipoMensagem = (typeof TIPOS_MENSAGEM)[number];

/**
 * Marcadores que um modelo aceita, escritos entre chaves (`{link}`):
 * - nome: o primeiro nome de quem recebe (vazio quando a hierarquia não tem o nome: só na rede sem responsável);
 * - saudacao: "Olá, <primeiro nome>!" ou, sem nome, "Olá!";
 * - alvo: o nome da célula, do discipulador ou da rede (só nas mensagens da hierarquia);
 * - link: o link pessoal (obrigatório: sem ele a mensagem não serve; no começo ou depois de espaço, tabulação ou
 *   quebra de linha, e nenhum outro endereço no modelo: `problemasDoModelo`).
 */
export const MARCADORES_MENSAGEM = [
  "nome",
  "saudacao",
  "alvo",
  "link",
] as const;
export type MarcadorMensagem = (typeof MARCADORES_MENSAGEM)[number];

/** Marcadores aceitos em cada modelo; `{link}` é obrigatório em todos. */
export const MARCADORES_DO_MODELO = {
  link_coordenacao: ["nome", "saudacao", "link"],
  link_lider: ["nome", "saudacao", "alvo", "link"],
  link_discipulador: ["nome", "saudacao", "alvo", "link"],
  link_rede: ["nome", "saudacao", "alvo", "link"],
} as const satisfies Record<TipoMensagem, readonly MarcadorMensagem[]>;

/** Tamanho máximo de um modelo (o link e o nome entram depois; a mensagem real fica perto disso). */
export const LIMITE_CARACTERES_MENSAGEM = 1000;

const CUIDADO_HIERARQUIA =
  " na campanha da rifa do Videira Kids: as vendas, a meta e a posição no ranking.\nO link é só seu: não repasse para ninguém, porque quem tiver o link entra como você.\n{link}";

/**
 * Os modelos padrão: preenchidos, dão EXATAMENTE o texto que a tela Acessos monta hoje (src/web/pages/acessos/
 * textos.ts, `mensagemWhatsApp` e `mensagemHierarquia`). Valem enquanto o admin não editar.
 */
export const MENSAGENS_PADRAO = {
  link_coordenacao:
    "{saudacao} Este é o seu link pessoal para entrar no sistema da Rifa Videira Kids. Ele é só seu, não repasse:\n{link}",
  link_lider: `{saudacao} Este é o seu link pessoal para acompanhar a sua célula ({alvo})${CUIDADO_HIERARQUIA}`,
  link_discipulador: `{saudacao} Este é o seu link pessoal para acompanhar as suas células (discipulador {alvo})${CUIDADO_HIERARQUIA}`,
  link_rede: `{saudacao} Este é o seu link pessoal para acompanhar a sua rede ({alvo})${CUIDADO_HIERARQUIA}`,
} as const satisfies Record<TipoMensagem, string>;

/** Um marcador escrito no modelo: `{` + letras, dígitos ou `_` + `}` (outras chaves soltas ficam como texto). */
const MARCADOR_NO_TEXTO = /\{([A-Za-z0-9_]+)\}/g;

/**
 * Um `{link}` colado no texto de antes (ex.: `https://outro.site/?u={link}` ou `x{link}`): o link pessoal viraria o
 * fim de um endereço de outro site, e o WhatsApp de quem envia busca a prévia desse endereço ao montar a mensagem,
 * levando o token para lá sem ninguém tocar no link (revisão RIFA-041; no modelo da coordenação, o link de um admin).
 * Só vale o `{link}` no começo ou depois de espaço, tabulação ou quebra de linha, como nos padrões (RIFA-042).
 */
// Um \r sozinho não separa: se o app de quem recebe descartar o \r, o link cola no texto de antes (revisão da RIFA-042).
const LINK_COLADO = /[^ \t\n]\{link\}/;

/**
 * Outro endereço no modelo (RIFA-042): `://` (http://, https://...), `www.` ou um domínio seguido de barra
 * (`site.com/`, `bit.ly/`). O único link da mensagem é o `{link}`: outro endereço levaria quem recebe (e a prévia do
 * WhatsApp) a um site que não é o da rifa. É a regra mais simples que pega os casos comuns sem acusar os textos
 * padrão (nenhum tem barra, `://` nem `www.`); um domínio solto, sem barra nem `www.` (`site.com`), passa.
 */
const OUTRO_ENDERECO = /:\/\/|www\.|[a-z0-9-]\.[a-z]{2,}\//i;

/**
 * Problemas de um modelo, em português, para a tela mostrar e a API recusar (lista vazia = válido): marcador que o
 * modelo não aceita (ex.: `{Nome}` ou `{alvo}` na mensagem da coordenação), a falta do `{link}`, o `{link}` colado no
 * texto de antes (LINK_COLADO) e outro endereço no modelo (OUTRO_ENDERECO). Não confere o tamanho (o schema confere).
 */
export function problemasDoModelo(
  tipo: TipoMensagem,
  modelo: string,
): string[] {
  const aceitos: readonly string[] = MARCADORES_DO_MODELO[tipo];
  const problemas: string[] = [];
  const desconhecidos = new Set<string>();
  for (const [, marcador] of modelo.matchAll(MARCADOR_NO_TEXTO))
    if (!aceitos.includes(marcador)) desconhecidos.add(marcador);
  for (const marcador of desconhecidos)
    problemas.push(
      `Marcador {${marcador}} não existe nesta mensagem. Use: ${aceitos.map((m) => `{${m}}`).join(", ")}.`,
    );
  if (!modelo.includes("{link}"))
    problemas.push(
      "A mensagem precisa ter {link}: é por ele que a pessoa entra.",
    );
  else if (LINK_COLADO.test(modelo))
    problemas.push(
      "Deixe o {link} no começo da mensagem ou depois de um espaço ou de uma quebra de linha: colado no texto de antes, o link pessoal vira parte de outro endereço.",
    );
  if (OUTRO_ENDERECO.test(modelo))
    problemas.push(
      "Tire o outro endereço da mensagem (http://, www. ou site.com/): o único link dela é o {link}.",
    );
  return problemas;
}

/** "Maria da Silva" → "Maria" (o primeiro nome, como a tela Acessos usa hoje). */
export function primeiroNome(nome: string): string {
  return nome.trim().split(/\s+/)[0] ?? nome;
}

/** O que preenche os marcadores de uma mensagem. */
export interface ValoresMensagem {
  /** Nome de quem recebe (o usuário da coordenação, ou o `pessoa_nome` do alvo); null = a hierarquia não tem. */
  pessoaNome: string | null;
  /** Nome da célula, do discipulador ou da rede (mensagens da hierarquia). */
  alvoNome?: string;
  /** O link pessoal (a URL que só aparece na resposta que cria o link). */
  url: string;
}

/**
 * Preenche um modelo numa passada só: um valor que contenha "{link}" (ex.: um nome estranho) não é trocado de novo.
 * Marcador desconhecido fica como está (o schema da campanha não deixa gravar um modelo com ele).
 */
export function preencherMensagem(
  modelo: string,
  valores: ValoresMensagem,
): string {
  const nome =
    valores.pessoaNome === null || valores.pessoaNome.trim() === ""
      ? ""
      : primeiroNome(valores.pessoaNome);
  const preenchidos: Record<MarcadorMensagem, string> = {
    nome,
    saudacao: nome === "" ? "Olá!" : `Olá, ${nome}!`,
    alvo: valores.alvoNome ?? "",
    link: valores.url,
  };
  return modelo.replace(MARCADOR_NO_TEXTO, (trecho, marcador: string) =>
    (MARCADORES_MENSAGEM as readonly string[]).includes(marcador)
      ? preenchidos[marcador as MarcadorMensagem]
      : trecho,
  );
}

/** O tipo de mensagem do link de cada papel. */
export const MENSAGEM_DO_PAPEL = {
  admin: "link_coordenacao",
  coordenacao: "link_coordenacao",
  lider: "link_lider",
  discipulador: "link_discipulador",
  rede: "link_rede",
} as const satisfies Record<Papel, TipoMensagem>;
