// Textos da tela de acessos: mensagem do WhatsApp e as falhas de cada ação (409 `em_uso` em português,
// conforme o caso: desativar a si mesmo, o último admin ativo ou revogar o último link válido de admin).
import { ErroApi, mensagemDoErro } from "../../lib/api";

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
