// Chamadas da tela de acessos (só admin; docs/acesso.md, seção "Rotas"): pessoas da coordenação, links
// pessoais e revogação; e os acessos de líderes, discipuladores e redes, com os links em lote (RIFA-014, D12;
// docs/api.md, "Visão individual e acessos da hierarquia"). Do contrato vêm só os TIPOS: importar valores de
// src/shared/contracts poria o zod no pacote do site. Por isso caminhos, papéis e limites abaixo são cópias,
// conferidas por acessos-contrato.test.ts.
import type {
  ItemAcessoHierarquia,
  LinkAcessoCriado,
  LinkGeradoHierarquia,
  PapelCoordenacao,
  PapelHierarquia,
  Usuario,
} from "../../../shared/contracts";
import { api } from "../../lib/api";

/** ROTAS_ACESSO: listarUsuarios e criarUsuario (.caminho); atualizarUsuario e criarLink ficam abaixo deles. */
export const CAMINHOS = {
  usuarios: "/api/admin/usuarios",
  /** revogarLink: `${links}/:id`. */
  links: "/api/admin/links",
} as const;

/**
 * PAPEIS_COORDENACAO do contrato, na ordem do formulário (coordenação primeiro: é o caso comum). Os papéis da
 * hierarquia não entram aqui: os acessos deles nascem pelos links em lote (RIFA-014).
 */
export const PAPEIS_DO_FORMULARIO: readonly PapelCoordenacao[] = [
  "coordenacao",
  "admin",
];

/** usuarioSchema / corpoCriarUsuarioSchema: nome até 120 e e-mail até 254 caracteres. */
export const LIMITES = { nome: 120, email: 254 } as const;

export type NovaPessoa = {
  nome: string;
  email: string | null;
  papel: PapelCoordenacao;
};

type Opcoes = { signal?: AbortSignal };

export async function listarPessoas(opcoes: Opcoes = {}): Promise<Usuario[]> {
  const { itens } = await api.get<{ itens: Usuario[] }>(
    CAMINHOS.usuarios,
    opcoes,
  );
  return itens;
}

/** Cria a pessoa com o primeiro link: `link.url` só vem nesta resposta. */
export function criarPessoa(pessoa: NovaPessoa) {
  return api.post<{ usuario: Usuario; link: LinkAcessoCriado }>(
    CAMINHOS.usuarios,
    pessoa,
  );
}

/** Link novo: os anteriores continuam valendo (revogue à parte). `link.url` só vem nesta resposta. */
export async function gerarLink(usuarioId: number): Promise<LinkAcessoCriado> {
  const { link } = await api.post<{ link: LinkAcessoCriado }>(
    `${CAMINHOS.usuarios}/${usuarioId}/links`,
  );
  return link;
}

/** Desativar encerra as sessões e para os links; 409 `em_uso` para si mesmo e o último admin ativo. */
export function definirAtivo(usuarioId: number, ativo: boolean) {
  return api.patch<Usuario>(`${CAMINHOS.usuarios}/${usuarioId}`, { ativo });
}

/** Revoga e encerra as sessões abertas pelo link; 409 `em_uso` se for o último link válido de admin. */
export async function revogarLink(linkId: number): Promise<void> {
  await api.delete(`${CAMINHOS.links}/${linkId}`);
}

// ---------------------------------------------------------------------------------------------------
// Líderes, discipuladores e redes (RIFA-014): um acesso por alvo da hierarquia, com links em lote. Desativar,
// reativar e revogar usam as rotas de cima (aceitam usuários de qualquer papel).
// ---------------------------------------------------------------------------------------------------

/** ROTAS_ACESSO_HIERARQUIA: listarAcessosHierarquia e gerarLinksHierarquia (.caminho). */
export const CAMINHOS_HIERARQUIA = {
  alvos: "/api/admin/acessos-hierarquia",
  links: "/api/admin/acessos-hierarquia/links",
} as const;

/** PAPEIS_HIERARQUIA do contrato, na ordem do seletor (líderes primeiro: é o caso comum). */
export const PAPEIS_DO_SELETOR: readonly PapelHierarquia[] = [
  "lider",
  "discipulador",
  "rede",
];

/** LIMITE_ALVOS_POR_LOTE: quantos alvos um pedido de links aceita. */
export const LIMITE_ALVOS_POR_LOTE = 200;

/** Todos os alvos do papel, com ou sem acesso, pelo caminho na hierarquia. A lista nunca traz token. */
export async function listarAlvos(
  papel: PapelHierarquia,
  opcoes: Opcoes = {},
): Promise<ItemAcessoHierarquia[]> {
  const consulta = new URLSearchParams({ papel });
  const { itens } = await api.get<{ itens: ItemAcessoHierarquia[] }>(
    `${CAMINHOS_HIERARQUIA.alvos}?${consulta.toString()}`,
    opcoes,
  );
  return itens;
}

/**
 * Um link NOVO para cada alvo de `ids` (na ordem de `ids`), tudo ou nada: 404 se algum id não é alvo do papel
 * e 409 `em_uso` se algum tem o acesso desativado. `revogarAnteriores` troca o acesso: revoga os links
 * válidos e encerra as sessões deles (o aparelho antigo sai). Cada `link.url` só vem nesta resposta.
 */
export async function gerarLinksHierarquia(
  papel: PapelHierarquia,
  ids: readonly number[],
  revogarAnteriores = false,
): Promise<LinkGeradoHierarquia[]> {
  const { itens } = await api.post<{ itens: LinkGeradoHierarquia[] }>(
    CAMINHOS_HIERARQUIA.links,
    { papel, ids, revogar_anteriores: revogarAnteriores },
  );
  return itens;
}
