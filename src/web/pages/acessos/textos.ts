// Textos da tela de acessos: mensagens do WhatsApp (coordenação e hierarquia), o telefone do líder no
// formato do wa.me, a situação do acesso de cada alvo da hierarquia e as falhas de cada ação (409 `em_uso`
// em português, conforme o caso: desativar a si mesmo, o último admin ativo ou revogar o último link válido
// de admin).
import type {
  Alvo,
  ItemAcessoHierarquia,
  PapelHierarquia,
} from "../../../shared/contracts";
import {
  MENSAGENS_PADRAO,
  preencherMensagem,
  type TipoMensagem,
} from "../../../shared/contracts/regras";
import type { TomBadge } from "../../components/ui";
import { ErroApi, mensagemDoErro } from "../../lib/api";
import { formatarDataHora, formatarNumero } from "../../lib/formatadores";
import {
  ACESSO_DO_PAPEL,
  ehAcaoDesligada,
  modeloDaMensagem,
  type Mensagens,
} from "./regras";

export { primeiroNome } from "../../../shared/contracts/regras";

/**
 * Mensagem curta para mandar o link da coordenação pelo WhatsApp: o modelo `link_coordenacao` da campanha (D20,
 * RIFA-032), preenchido; com o modelo gravado com problema, o padrão (o texto de antes).
 */
export function mensagemWhatsApp(
  nome: string,
  url: string,
  mensagens: Mensagens = MENSAGENS_PADRAO,
): string {
  return preencherMensagem(modeloDaMensagem("link_coordenacao", mensagens), {
    pessoaNome: nome,
    url,
  });
}

/** wa.me sem número: o WhatsApp abre com a mensagem pronta e a pessoa escolhe a conversa. */
export function linkWhatsApp(
  nome: string,
  url: string,
  mensagens: Mensagens = MENSAGENS_PADRAO,
): string {
  return `https://wa.me/?text=${encodeURIComponent(mensagemWhatsApp(nome, url, mensagens))}`;
}

// ---------------------------------------------------------------------------------------------------
// Líderes, discipuladores e redes (RIFA-014)
// ---------------------------------------------------------------------------------------------------

/** Nome de cada papel da hierarquia no plural, para o seletor e os textos. */
export const PAPEL_NO_PLURAL: Record<PapelHierarquia, string> = {
  lider: "Líderes de célula",
  discipulador: "Discipuladores",
  rede: "Redes",
};

/** O alvo de cada papel, no singular (o título da coluna da tabela). */
export const ALVO_DO_PAPEL: Record<PapelHierarquia, string> = {
  lider: "Célula",
  discipulador: "Discipulador",
  rede: "Rede",
};

/** Quem recebe o link de cada papel, quando a hierarquia não tem o nome da pessoa. */
export const RESPONSAVEL_DO_ALVO: Record<PapelHierarquia, string> = {
  lider: "o líder da célula",
  discipulador: "o discipulador",
  rede: "quem responde pela rede",
};

/** O modelo de mensagem de cada tipo de alvo (o link do líder, do discipulador ou da rede). */
const MENSAGEM_DO_ALVO: Record<Alvo["tipo"], TipoMensagem> = {
  celula: "link_lider",
  discipulador: "link_discipulador",
  rede: "link_rede",
};

/**
 * Mensagem do link de um líder, discipulador ou rede: o modelo da campanha para o tipo de alvo (D20, RIFA-032),
 * preenchido com o primeiro nome da pessoa (sem nome na hierarquia, só "Olá!"), o nome do alvo e o link. Com o
 * modelo gravado com problema, o padrão: cumprimenta, diz para que é o link e avisa que ele é pessoal.
 */
export function mensagemHierarquia(
  {
    alvo,
    pessoaNome,
    url,
  }: {
    alvo: Pick<Alvo, "tipo" | "nome">;
    pessoaNome: string | null;
    url: string;
  },
  mensagens: Mensagens = MENSAGENS_PADRAO,
): string {
  return preencherMensagem(
    modeloDaMensagem(MENSAGEM_DO_ALVO[alvo.tipo], mensagens),
    { pessoaNome, alvoNome: alvo.nome, url },
  );
}

/** Número do Brasil com o código do país: 55, o DDD (2 dígitos) e o telefone (8 ou 9 dígitos). */
const ehNumeroDoBrasil = (digitos: string) =>
  (digitos.length === 12 || digitos.length === 13) && digitos.startsWith("55");

/** O telefone começa com "+" e um código de país que não é o do Brasil (+55). */
function ehDeOutroPais(telefone: string): boolean {
  return (
    telefone.trim().startsWith("+") &&
    !telefone.replace(/\D/g, "").startsWith("55")
  );
}

/**
 * O telefone do líder como o wa.me pede: só dígitos, com o código do Brasil. Aceita os jeitos comuns de
 * escrever um número do Brasil com DDD ("(91) 98888-7777", "91 3222-1111", "091 98888-7777", "55 91
 * 98888-7777", "+55 91 98888-7777"). Com "+", só o +55: outro código de país, sem DDD, curto ou longo
 * demais dão null (só "Copiar mensagem", e a tela mostra o número para o admin conferir).
 */
export function telefoneParaWhatsApp(telefone: string | null): string | null {
  if (telefone === null) return null;
  const digitos = telefone.replace(/\D/g, "");
  if (telefone.trim().startsWith("+")) {
    return ehNumeroDoBrasil(digitos) ? digitos : null;
  }
  const semPrefixo = digitos.replace(/^0+/, "");
  if (semPrefixo.length === 10 || semPrefixo.length === 11) {
    return `55${semPrefixo}`;
  }
  return ehNumeroDoBrasil(semPrefixo) ? semPrefixo : null;
}

/**
 * Por que o link não vai pelo WhatsApp (sem número que o wa.me abra): sem telefone, com outro código de país
 * ou fora do formato. Com telefone, mostra o número para o admin conferir.
 */
export function motivoSemWhatsApp(telefone: string | null): string {
  if (telefone === null) {
    return "Sem telefone na hierarquia: copie a mensagem e mande por fora.";
  }
  return ehDeOutroPais(telefone)
    ? `O telefone ${telefone} não é do Brasil (+55): confira o número, copie a mensagem e mande por fora.`
    : `O telefone ${telefone} não está num formato que o WhatsApp abre: confira o número, copie a mensagem e mande por fora.`;
}

/** wa.me com o número (a conversa já abre com a pessoa) e a mensagem pronta. */
export function linkWhatsAppDoNumero(numero: string, mensagem: string): string {
  return `https://wa.me/${numero}?text=${encodeURIComponent(mensagem)}`;
}

type UsuarioDoAlvo = NonNullable<ItemAcessoHierarquia["usuario"]>;

/**
 * Situação do acesso de um alvo: sem link (nunca gerado), link válido (com o último uso), só links revogados
 * ou vencidos, ou desativado.
 */
export type SituacaoAcesso =
  | { tipo: "sem_link" }
  | { tipo: "valido"; ultimoUso: string | null }
  | { tipo: "sem_link_valido" }
  | { tipo: "desativado" };

export function situacaoDoAcesso(
  usuario: UsuarioDoAlvo | null,
): SituacaoAcesso {
  if (usuario === null) return { tipo: "sem_link" };
  if (!usuario.ativo) return { tipo: "desativado" };
  if (usuario.links.length === 0) return { tipo: "sem_link" };
  const usos = usuario.links
    .filter((link) => link.situacao === "valido")
    .map((link) => link.ultimo_uso_em);
  if (usos.length === 0) return { tipo: "sem_link_valido" };
  const usados = usos.filter((uso): uso is string => uso !== null);
  usados.sort((a, b) => Date.parse(a) - Date.parse(b));
  return { tipo: "valido", ultimoUso: usados.at(-1) ?? null };
}

/** O selo e a linha de detalhe da situação, para a tabela. */
export function textoDaSituacao(situacao: SituacaoAcesso): {
  tom: TomBadge;
  rotulo: string;
  detalhe: string | null;
} {
  switch (situacao.tipo) {
    case "sem_link":
      return { tom: "neutro", rotulo: "Sem link", detalhe: null };
    case "valido":
      return {
        tom: "sucesso",
        rotulo: "Link válido",
        detalhe: situacao.ultimoUso
          ? `Último uso em ${formatarDataHora(situacao.ultimoUso)}.`
          : "Ainda não usado.",
      };
    case "sem_link_valido":
      return {
        tom: "alerta",
        rotulo: "Só links revogados ou vencidos",
        detalhe: null,
      };
    case "desativado":
      return {
        tom: "perigo",
        rotulo: "Desativado",
        detalhe: "Os links não abrem sessão: reative para gerar outro.",
      };
  }
}

/** As sessões abertas pelos links do alvo: "Nenhum aparelho conectado", "1 aparelho conectado"... */
export function textoDosAparelhos(sessoes: number): string {
  if (sessoes === 0) return "Nenhum aparelho conectado";
  return sessoes === 1
    ? "1 aparelho conectado"
    : `${formatarNumero(sessoes)} aparelhos conectados`;
}

/** O que fazer quando a pessoa mudou, conforme o que a linha oferece. */
const QUANDO_A_PESSOA_MUDOU: Record<SituacaoAcesso["tipo"], string> = {
  // A linha tem "Trocar acesso".
  valido: "troque o acesso",
  // A linha tem "Novo link".
  sem_link: "gere um link novo",
  sem_link_valido: "gere um link novo",
  // A linha só tem "Reativar acesso": o link novo vem depois.
  desativado: "reative e gere um link novo",
};

/**
 * O último link do alvo foi para outra pessoa (a hierarquia mudou depois): o que fazer, conforme a linha. Com
 * link válido, "troque o acesso" (a linha tem "Trocar acesso"); sem link válido, "gere um link novo"; com o
 * acesso desativado, "reative e gere um link novo" (a linha só tem "Reativar acesso"). null quando o link é
 * da pessoa da hierarquia (ou ainda não há usuário).
 */
export function avisoDeOutraPessoa(item: ItemAcessoHierarquia): string | null {
  const { usuario } = item;
  if (!usuario || usuario.nome === (item.pessoa_nome ?? item.alvo.nome)) {
    return null;
  }
  const oQueFazer = QUANDO_A_PESSOA_MUDOU[situacaoDoAcesso(usuario).tipo];
  return `O último link foi para ${usuario.nome}: se a pessoa mudou, ${oQueFazer}.`;
}

/**
 * Quem entra no lote "para quem ainda não tem": todo alvo sem link válido, menos os desativados (a API
 * recusaria o lote inteiro com 409: reative antes).
 */
export function precisaDeLink(item: ItemAcessoHierarquia): boolean {
  const { tipo } = situacaoDoAcesso(item.usuario);
  return tipo === "sem_link" || tipo === "sem_link_valido";
}

/**
 * O acesso do papel está desligado na Campanha (D20): o que a tela diz no lugar de gerar links. O líder não tem
 * chave.
 */
export function textoAcessoDesligado(papel: "discipulador" | "rede"): string {
  const acesso = ACESSO_DO_PAPEL[papel];
  return `${acesso.charAt(0).toUpperCase()}${acesso.slice(1)} está desligado na Campanha.`;
}

/** Falha ao gerar links: o 409 da chave desligada e os 404 e 409 do lote em português (a lista é recarregada). */
export function mensagemAoGerarLinks(
  erro: unknown,
  papel?: PapelHierarquia,
): string {
  if (ehAcaoDesligada(erro)) {
    return papel === "discipulador" || papel === "rede"
      ? `${ACESSO_DO_PAPEL[papel].charAt(0).toUpperCase()}${ACESSO_DO_PAPEL[papel].slice(1)} foi desligado na Campanha: não dá para gerar links agora.`
      : "Este acesso foi desligado na Campanha: não dá para gerar links agora.";
  }
  if (ehEmUso(erro)) {
    return "Algum alvo tem o acesso desativado: reative antes de gerar o link. A lista foi atualizada.";
  }
  if (ehNaoEncontrado(erro)) {
    return "A hierarquia mudou desde que a lista foi carregada. A lista foi atualizada: confira e tente de novo.";
  }
  return mensagemDoErro(erro);
}

export const MENSAGENS_EM_USO = {
  desativarASiMesmo:
    "Você não pode desativar o seu próprio acesso: peça a outro admin.",
  ultimoAdmin:
    "Esta pessoa é o último admin ativo: crie ou reative outro admin antes de desativá-la.",
  ultimoLinkAdmin:
    "Este é o último link válido de um admin ativo: gere um link novo para um admin antes de revogar este.",
} as const;

export function ehEmUso(erro: unknown): boolean {
  return (
    erro instanceof ErroApi && erro.status === 409 && erro.codigo === "em_uso"
  );
}

/** A pessoa ou o link não existe mais (404): a lista está velha. */
export function ehNaoEncontrado(erro: unknown): boolean {
  return erro instanceof ErroApi && erro.status === 404;
}

export function mensagemAoDesativar(erro: unknown, aSiMesmo: boolean): string {
  if (ehEmUso(erro)) {
    return aSiMesmo
      ? MENSAGENS_EM_USO.desativarASiMesmo
      : MENSAGENS_EM_USO.ultimoAdmin;
  }
  if (ehNaoEncontrado(erro)) {
    return "Esta pessoa não foi encontrada. A lista foi atualizada.";
  }
  return mensagemDoErro(erro);
}

export function mensagemAoRevogar(erro: unknown): string {
  if (ehEmUso(erro)) return MENSAGENS_EM_USO.ultimoLinkAdmin;
  if (ehNaoEncontrado(erro)) {
    return "Este link não foi encontrado. A lista foi atualizada.";
  }
  return mensagemDoErro(erro);
}

/** Campos que a API recusou (400 requisicao_invalida: `detalhes[].caminho[0]`). */
export function camposRecusados(erro: unknown): string[] {
  if (!(erro instanceof ErroApi) || !Array.isArray(erro.detalhes)) return [];
  const campos = new Set<string>();
  for (const problema of erro.detalhes as unknown[]) {
    if (typeof problema !== "object" || problema === null) continue;
    const caminho = (problema as { caminho?: unknown }).caminho;
    const campo = Array.isArray(caminho) ? caminho[0] : undefined;
    if (typeof campo === "string") campos.add(campo);
  }
  return [...campos];
}

// ---------------------------------------------------------------------------------------------------
// Dicas (RIFA-045): a explicação que aparece com o mouse parado (ou o foco do teclado) em cada botão e campo da
// tela. Dizem para que serve e o que acontece, sem repetir o rótulo.
// ---------------------------------------------------------------------------------------------------

/** Por que "Gerar links para quem ainda não tem" está indisponível (null: disponível). */
export type MotivoLoteIndisponivel = "desligado" | "ocupado" | "ninguem" | null;

const DICA_INDISPONIVEL_OCUPADO =
  "Indisponível enquanto a ação em andamento termina. Espere um instante.";
const DICA_INDISPONIVEL_DESLIGADO =
  "Indisponível: o acesso deste papel está desligado na tela Campanha.";

export const DICAS = {
  abaCoordenacao:
    "As pessoas que entram na área da coordenação (admin e coordenação), com os links de cada uma.",
  abaHierarquia:
    "Os links pessoais dos líderes, discipuladores e redes. Quem entra por eles vê só a própria visão, sem valores em R$.",
  abaWebhook:
    "O token que a Rifei usa para mandar as vendas ao sistema. Ele é gerado aqui e colado na Rifei.",
  novaPessoa:
    "Cadastra alguém da coordenação e já mostra o link pessoal dela, para mandar pelo WhatsApp.",
  tentarDeNovoLista:
    "Busca a lista de novo. Enquanto isso, a tela continua mostrando a que já tinha.",
  ocupado: DICA_INDISPONIVEL_OCUPADO,
  revogarLink:
    "Faz este link parar de funcionar, e quem entrou com ele sai do sistema. Antes, pede confirmação.",
  revogarLinkDesteAparelho:
    "É o link pelo qual você entrou neste aparelho: revogar tira você do sistema aqui. Antes, pede confirmação.",
  gerarLinkNovo:
    "Cria mais um link pessoal para esta pessoa. Os links que ela já tem continuam valendo.",
  desativarAcesso:
    "Tira a pessoa do sistema em todos os aparelhos e bloqueia os links dela. Antes, pede confirmação. Dá para reativar.",
  reativarAcesso:
    "Deixa a pessoa entrar de novo, com os links dela que ainda valem.",
  nome: "O nome da pessoa, como aparece nos acessos e na mensagem do WhatsApp.",
  email: "Só para saber quem é. A pessoa não usa o e-mail para entrar.",
  papel:
    "O que a pessoa pode fazer no sistema: o admin também cuida dos acessos e das regras.",
  cancelarNovaPessoa: "Fecha sem cadastrar ninguém.",
  criarEGerarLink:
    "Cadastra a pessoa e mostra o link pessoal dela uma vez, para copiar ou mandar.",
  criando: "Indisponível enquanto a pessoa é cadastrada. Espere um instante.",
  campoLink:
    "O link pessoal: quem abrir entra no sistema como esta pessoa. Mande só para ela.",
  copiarLink:
    "Copia o link para você colar onde quiser, como numa conversa do WhatsApp.",
  enviarPeloWhatsApp:
    "Abre o WhatsApp com a mensagem pronta e o link. Você escolhe para quem mandar.",
  fecharLink:
    "Fecha esta janela. Depois disso, o link não aparece de novo: copie ou envie antes.",
  cancelarRevogar: "Fecha sem revogar. O link continua valendo.",
  confirmarRevogar:
    "O link para de funcionar agora, e quem entrou com ele sai do sistema.",
  confirmarRevogarESair:
    "O link para de funcionar agora, e você sai do sistema neste aparelho.",
  revogando: "Indisponível enquanto o link é revogado. Espere um instante.",
  cancelarDesativar: "Fecha sem desativar. A pessoa continua entrando.",
  confirmarDesativar:
    "A pessoa sai do sistema em todos os aparelhos agora. Dá para reativar depois.",
  desativando:
    "Indisponível enquanto o acesso é desativado. Espere um instante.",
  papelDaHierarquia:
    "Escolha de quem ver os acessos: dos líderes de célula, dos discipuladores ou das redes.",
  gerarLote:
    "Cria de uma vez o link de quem está sem link válido. Os links aparecem uma vez, para mandar a cada um.",
  loteIndisponivel: {
    desligado: DICA_INDISPONIVEL_DESLIGADO,
    ocupado: DICA_INDISPONIVEL_OCUPADO,
    ninguem: "Indisponível: todos os ativos já têm link válido.",
  } satisfies Record<NonNullable<MotivoLoteIndisponivel>, string>,
  novoLink:
    "Cria mais um link para esta pessoa e mostra uma vez, para mandar. Os links que ela já tem continuam valendo.",
  trocarAcesso:
    "Cria um link novo e cancela os anteriores: o aparelho antigo sai do sistema. Antes, pede confirmação.",
  semLinkDesligado: DICA_INDISPONIVEL_DESLIGADO,
  cancelarTrocar: "Fecha sem trocar. Os links atuais continuam valendo.",
  confirmarTrocar:
    "Cria o link novo agora e cancela os anteriores. O link novo aparece em seguida, para mandar.",
  trocando:
    "Indisponível enquanto o acesso é trocado e o link novo é criado. Espere um instante.",
  prontoLinks:
    "Fecha esta janela. Se algum link ainda não foi mandado, pede confirmação antes.",
  copiarMensagem:
    "Copia a mensagem pronta, com o link, para colar no WhatsApp da pessoa.",
  abrirNoWhatsApp:
    "Abre a conversa com o número da pessoa e a mensagem pronta, com o link.",
  verAMensagem:
    "Mostra o texto da mensagem, com o link, que vai para a pessoa.",
  campoMensagem:
    "A mensagem pronta, com o link pessoal. Mande só para esta pessoa.",
  voltarAosLinks: "Volta para a lista de links, para mandar os que faltam.",
  fecharMesmoAssim:
    "Fecha sem mandar: os links que faltam não aparecem de novo. Para mandar depois, só gerando outro.",
  campoUrl: "O endereço do sistema que recebe os avisos de venda da Rifei.",
  copiarUrl: "Copia o endereço para você colar na Rifei.",
  gerarToken:
    "Cria o token que a Rifei usa para mandar as vendas. Ele aparece uma vez, para colar na Rifei.",
  gerarTokenComVigente:
    "Cria um token novo. O que vale hoje para de valer: antes, pede confirmação.",
  gerandoToken: "Indisponível enquanto o token é gerado. Espere um instante.",
  campoToken:
    "A senha que a Rifei manda junto com cada venda. Cole na Rifei e não guarde cópia.",
  copiarToken: "Copia o token para você colar na Rifei.",
  cancelarTroca: "Fecha sem gerar. O que vale hoje continua valendo.",
  confirmarTroca:
    "Cria o token novo agora. O de hoje para de valer na hora, e as vendas param de chegar ao sistema até você colar o novo na Rifei.",
} as const;
