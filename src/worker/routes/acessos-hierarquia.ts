/**
 * Acessos da hierarquia (RIFA-014, D12; contrato: ROTAS_ACESSO_HIERARQUIA em acesso.ts), só para o papel admin.
 * Montada em /api/admin, depois do login da coordenação (index.ts); como em admin-usuarios.ts, exige admin aqui
 * também, nos próprios caminhos. Documentação: docs/acesso.md, seção 9.
 *
 * - GET /api/admin/acessos-hierarquia?papel=lider|discipulador|rede → 200 { itens }: TODOS os alvos do papel,
 *   com ou sem acesso, com quem deve receber o link, o telefone do líder e o usuário do alvo (sem token).
 * - POST /api/admin/acessos-hierarquia/links { papel, ids, revogar_anteriores? } → 201 { itens }: um link NOVO
 *   por alvo, na ordem de `ids`, com a URL (a única vez em que ela aparece). Tudo ou nada; 404 `nao_encontrado`
 *   se algum id não é alvo do papel e 409 `em_uso` se algum alvo tem o usuário desativado, com os ids em
 *   `detalhes`. Uma linha na trilha de auditoria por chamada, no mesmo lote.
 *
 * Desativar, gerar um link avulso e revogar usam as rotas de admin-usuarios.ts, que aceitam qualquer papel.
 */
import { Hono } from "hono";
import {
  ROTAS_ACESSO_HIERARQUIA,
  type ItemAcessoHierarquia,
  type LinkGeradoHierarquia,
} from "../../shared/contracts";
import {
  gerarLinksHierarquia,
  listarAcessosHierarquia,
  mensagensDoLote,
} from "../db/acessos-hierarquia";
import { gerarLink, linkCriado } from "../lib/links-acesso";
import { responderErro } from "../lib/respostas-erro";
import {
  autoriaDaSessao,
  exigirSessao,
  type AmbienteSessao,
} from "../middleware/sessao";
import { validarConsulta, validarJson } from "../middleware/validacao";

/** Onde o index.ts monta este sub-app. */
export const PREFIXO_ACESSOS_HIERARQUIA = "/api/admin";

const { listarAcessosHierarquia: LISTAR, gerarLinksHierarquia: GERAR } =
  ROTAS_ACESSO_HIERARQUIA;

/** Caminho do contrato sem o prefixo de montagem ("/api/admin/acessos-hierarquia" → "/acessos-hierarquia"). */
const local = (caminho: string) =>
  caminho.slice(PREFIXO_ACESSOS_HIERARQUIA.length);

export const acessosHierarquia = new Hono<AmbienteSessao>();

// Só admin, mesmo que o app esqueça de pôr /api/admin/* atrás do login. Caminhos específicos de propósito: um
// use("*") aqui valeria para todo /api/admin/*.
acessosHierarquia.use(local(LISTAR.caminho), exigirSessao(LISTAR.papeis));
acessosHierarquia.use(`${local(LISTAR.caminho)}/*`, exigirSessao(GERAR.papeis));

acessosHierarquia.get(
  local(LISTAR.caminho),
  validarConsulta(LISTAR.consulta),
  async (c) => {
    const { papel } = c.req.valid("query");
    const itens: ItemAcessoHierarquia[] = await listarAcessosHierarquia(
      c.env.DB,
      papel,
      new Date().toISOString(),
    );
    return c.json({ itens }, 200);
  },
);

acessosHierarquia.post(
  local(GERAR.caminho),
  validarJson(GERAR.corpo),
  async (c) => {
    const { papel, ids, revogar_anteriores } = c.req.valid("json");
    const agora = new Date();
    const links = await Promise.all(ids.map(() => gerarLink(agora)));
    const resultado = await gerarLinksHierarquia(
      c.env.DB,
      { papel, ids, revogarAnteriores: revogar_anteriores },
      links,
      autoriaDaSessao(c, agora),
    );
    if (!resultado.ok) {
      const mensagens = mensagensDoLote(papel);
      return resultado.codigo === "nao_encontrado"
        ? responderErro(c, "nao_encontrado", mensagens.naoEncontrado, {
            ids: resultado.ids,
          })
        : responderErro(c, "em_uso", mensagens.desativado, {
            ids: resultado.ids,
          });
    }
    const itens: LinkGeradoHierarquia[] = resultado.itens.map(
      (item, indice) => ({
        alvo: item.alvo,
        pessoa_nome: item.pessoa_nome,
        telefone: item.telefone,
        usuario_id: item.usuario_id,
        link: linkCriado(c, item.link_id, links[indice]),
      }),
    );
    return c.json({ itens }, 201);
  },
);
