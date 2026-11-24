/**
 * Quem comprou por célula, para o admin (RIFA-093, adendo da D36; docs/api.md): SÓ ADMIN, como a planilha de
 * compradores e os maiores compradores (o telefone do comprador é só dele). A coordenação leva 403 antes de a consulta
 * ser lida. O index.ts monta este sub-app sob /api/admin, depois do login da coordenação (passo 4), e cada rota exige o
 * papel admin no próprio handler (exigirSessao), nunca num use de /api/admin/*.
 *
 * - GET /api/admin/quem-comprou/celulas: todas as células com o discipulador, os pedidos e os bilhetes (a célula
 *   efetiva, D41), de mais bilhetes para menos.
 * - GET /api/admin/celulas/:id/compradores?limite=&antes_de=: as vendas pagas que contam da célula, da mais recente
 *   para a mais antiga, com o telefone do pedido (E.164), o id do pedido e a origem da célula, e os totais da célula.
 *   A mesma consulta e o mesmo cursor do "Quem comprou" do líder (RIFA-089): cursor inválido, 400 com o detalhe
 *   `cursor_invalido`; célula inexistente, 404.
 *
 * Sem campanha ativa, 404 nas duas. Lidas do D1 a cada requisição (db/quem-comprou-admin.ts), passadas pelo schema
 * estrito antes de sair, com `Cache-Control: no-store` (o exigirSessao põe). A trilha não registra a leitura: ela não
 * exporta nada (a planilha da D36 continua registrando).
 */
import { Hono } from "hono";
import { ROTAS_QUEM_COMPROU_ADMIN } from "../../shared/contracts";
import { relogioDoSistema, type Relogio } from "../db/painel";
import { decodificarCursorQuemComprou } from "../db/quem-comprou";
import {
  lerCelulasQuemComprou,
  lerCompradoresDaCelula,
} from "../db/quem-comprou-admin";
import { responderErro } from "../lib/respostas-erro";
import { exigirSessao, type AmbienteSessao } from "../middleware/sessao";
import { validarConsulta, validarParametros } from "../middleware/validacao";

/** Onde o index.ts monta este sub-app. */
export const PREFIXO_QUEM_COMPROU_ADMIN = "/api/admin";

const CELULAS = ROTAS_QUEM_COMPROU_ADMIN.celulasQuemComprou;
const COMPRADORES = ROTAS_QUEM_COMPROU_ADMIN.compradoresDaCelula;
const SEM_CAMPANHA = "A campanha ainda não foi configurada";

export function criarQuemComprouAdmin({
  relogio = relogioDoSistema,
}: { relogio?: Relogio } = {}) {
  const app = new Hono<AmbienteSessao>();

  app.get(
    CELULAS.caminho.slice(PREFIXO_QUEM_COMPROU_ADMIN.length),
    exigirSessao(CELULAS.papeis),
    async (c) => {
      const celulas = await lerCelulasQuemComprou(c.env.DB);
      if (celulas === null)
        return responderErro(c, "nao_encontrado", SEM_CAMPANHA);
      return c.json(
        CELULAS.sucesso.corpo.parse({
          celulas,
          atualizado_em: relogio().toISOString(),
        }),
        200,
      );
    },
  );

  app.get(
    COMPRADORES.caminho.slice(PREFIXO_QUEM_COMPROU_ADMIN.length),
    // Só admin, antes de ler o id e a consulta (a coordenação leva 403 mesmo com uma consulta inválida).
    exigirSessao(COMPRADORES.papeis),
    validarParametros(COMPRADORES.parametros),
    validarConsulta(COMPRADORES.consulta),
    async (c) => {
      const { id } = c.req.valid("param");
      const consulta = c.req.valid("query");
      let cursor = null;
      if (consulta.antes_de !== undefined) {
        cursor = decodificarCursorQuemComprou(consulta.antes_de);
        if (cursor === null)
          return responderErro(c, "requisicao_invalida", "Consulta inválida", [
            {
              caminho: ["antes_de"],
              codigo: "cursor_invalido",
              mensagem:
                "Cursor inválido: use o valor de `proximo` da página anterior",
            },
          ]);
      }
      const lido = await lerCompradoresDaCelula(c.env.DB, id, consulta, cursor);
      if (lido.tipo === "sem_campanha")
        return responderErro(c, "nao_encontrado", SEM_CAMPANHA);
      if (lido.tipo === "sem_celula")
        return responderErro(c, "nao_encontrado", "Célula não encontrada");
      const { tipo: _tipo, ...resposta } = lido;
      return c.json(
        COMPRADORES.sucesso.corpo.parse({
          ...resposta,
          atualizado_em: relogio().toISOString(),
        }),
        200,
      );
    },
  );

  return app;
}

/** O sub-app de produção (relógio do sistema). */
export const quemComprouAdmin = criarQuemComprouAdmin();
