/**
 * GET /api/admin/auditoria (RIFA-013b; docs/api.md), só para o papel admin: a trilha de quem mudou a
 * campanha, os vínculos de afiliado, a hierarquia (importação aplicada) e os acessos, do mais novo para o
 * mais antigo, com paginação por cursor (`?limite=50&antes_de=<id>`).
 *
 * O index.ts monta este sub-app sob /api/admin, depois do login da coordenação. Como em admin-usuarios.ts,
 * a rota exige admin aqui também, mesmo que o app esqueça de pôr /api/admin/* atrás do login.
 */
import { Hono } from "hono";
import { ROTAS } from "../../shared/contracts";
import { listarAuditoria } from "../db/auditoria";
import { exigirSessao, type AmbienteSessao } from "../middleware/sessao";
import { validarConsulta } from "../middleware/validacao";

/** Onde o index.ts monta este sub-app. */
export const PREFIXO_AUDITORIA = "/api/admin";

const CAMINHO = ROTAS.auditoria.caminho.slice(PREFIXO_AUDITORIA.length);

export const auditoria = new Hono<AmbienteSessao>();

// Caminho específico de propósito: um use("*") aqui valeria para todo /api/admin/*.
auditoria.use(CAMINHO, exigirSessao(ROTAS.auditoria.papeis));

auditoria.get(CAMINHO, validarConsulta(ROTAS.auditoria.consulta), async (c) =>
  c.json(await listarAuditoria(c.env.DB, c.req.valid("query")), 200),
);
