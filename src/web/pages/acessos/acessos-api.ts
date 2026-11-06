// Chamadas da tela de acessos (só admin; docs/acesso.md, seção "Rotas"): pessoas da coordenação, links
// pessoais e revogação. Do contrato vêm só os TIPOS: importar valores de src/shared/contracts poria o zod
// no pacote do site. Por isso caminhos, papéis e limites abaixo são cópias, conferidas por
// acessos-contrato.test.ts.
import type {
  LinkAcessoCriado,
  Papel,
  Usuario,
} from "../../../shared/contracts";
import { api } from "../../lib/api";

/** ROTAS_ACESSO: listarUsuarios e criarUsuario (.caminho); atualizarUsuario e criarLink ficam abaixo deles. */
export const CAMINHOS = {
  usuarios: "/api/admin/usuarios",
  /** revogarLink: `${links}/:id`. */
  links: "/api/admin/links",
} as const;

/** PAPEIS do contrato, na ordem do formulário (coordenação primeiro: é o caso comum). */
export const PAPEIS_DO_FORMULARIO: readonly Papel[] = ["coordenacao", "admin"];

/** usuarioSchema / corpoCriarUsuarioSchema: nome até 120 e e-mail até 254 caracteres. */
export const LIMITES = { nome: 120, email: 254 } as const;

export type NovaPessoa = { nome: string; email: string | null; papel: Papel };

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
