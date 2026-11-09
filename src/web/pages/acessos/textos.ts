// Textos da tela de acessos: mensagens do WhatsApp (coordenação e hierarquia), o telefone do líder no
// formato do wa.me, a situação do acesso de cada alvo da hierarquia e as falhas de cada ação (409 `em_uso`
// em português, conforme o caso: desativar a si mesmo, o último admin ativo ou revogar o último link válido
// de admin).
import type {
  Alvo,
  ItemAcessoHierarquia,
  PapelHierarquia,
} from "../../../shared/contracts";
import type { TomBadge } from "../../components/ui";
import { ErroApi, mensagemDoErro } from "../../lib/api";
import { formatarDataHora, formatarNumero } from "../../lib/formatadores";

export function primeiroNome(nome: string): string {
  return nome.trim().split(/\s+/)[0] ?? nome;
}

/** Mensagem curta para mandar o link pelo WhatsApp. */
export function mensagemWhatsApp(nome: string, url: string): string {
  return `Olá, ${primeiroNome(nome)}! Este é o seu link pessoal para entrar no sistema da Rifa Videira Kids. Ele é só seu, não repasse:\n${url}`;
}

/** wa.me sem número: o WhatsApp abre com a mensagem pronta e a pessoa escolhe a conversa. */
export function linkWhatsApp(nome: string, url: string): string {
  return `https://wa.me/?text=${encodeURIComponent(mensagemWhatsApp(nome, url))}`;
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

/** Para que é o link, conforme o alvo. */
const PARA_QUE_SERVE: Record<Alvo["tipo"], (nome: string) => string> = {
  celula: (nome) => `acompanhar a sua célula (${nome})`,
  discipulador: (nome) => `acompanhar as suas células (discipulador ${nome})`,
  rede: (nome) => `acompanhar a sua rede (${nome})`,
};

/**
 * Mensagem do link de um líder, discipulador ou rede: cumprimenta a pessoa (sem nome na hierarquia, só
 * "Olá!"), diz para que é o link e avisa que ele é pessoal e não deve ser repassado.
 */
export function mensagemHierarquia({
  alvo,
  pessoaNome,
  url,
}: {
  alvo: Pick<Alvo, "tipo" | "nome">;
  pessoaNome: string | null;
  url: string;
}): string {
  const saudacao = pessoaNome ? `Olá, ${primeiroNome(pessoaNome)}!` : "Olá!";
  return `${saudacao} Este é o seu link pessoal para ${PARA_QUE_SERVE[alvo.tipo](alvo.nome)} na campanha da rifa do Videira Kids: as vendas, a meta e a posição no ranking.\nO link é só seu: não repasse para ninguém, porque quem tiver o link entra como você.\n${url}`;
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

/**
 * Quem entra no lote "para quem ainda não tem": todo alvo sem link válido, menos os desativados (a API
 * recusaria o lote inteiro com 409: reative antes).
 */
export function precisaDeLink(item: ItemAcessoHierarquia): boolean {
  const { tipo } = situacaoDoAcesso(item.usuario);
  return tipo === "sem_link" || tipo === "sem_link_valido";
}

/** Falha ao gerar links: os 404 e 409 do lote em português (a lista é recarregada nos dois casos). */
export function mensagemAoGerarLinks(erro: unknown): string {
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
