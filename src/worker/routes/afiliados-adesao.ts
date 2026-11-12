/**
 * Vínculo afiliado → célula e painel de adesão, do grupo `coordenacao` (docs/api.md):
 * - GET /api/admin/afiliados: afiliados com as vendas aprovadas (`?vinculado=false` = fila de órfãos);
 * - PUT /api/admin/afiliados/:affiliateId: vincula, troca ou desvincula a célula; se o afiliado ainda não
 *   existe, cria (pré-cadastro, origem `manual`). As vendas dele mudam de célula na hora (D7);
 * - GET /api/admin/adesao: resumo e uma linha por célula ("quem falta");
 * - DELETE /api/admin/afiliados/:affiliateId (RIFA-031, D20; ROTAS_REGRAS_CAMPANHA), SÓ ADMIN: remove o afiliado de
 *   teste se nenhum pedido dele conta (204); 404 se não existe; 409 `afiliado_com_pedidos` com quantos contam e os
 *   ids dos mais recentes. O "só admin" fica no handler do DELETE, nunca num `use` do caminho, que pegaria o PUT
 *   (da coordenação).
 *
 * Os caminhos e os schemas vêm do contrato (`ROTAS`). Este sub-app NÃO autentica: o index.ts o monta sob
 * /api/admin, depois do middleware da coordenação: `app.route(PREFIXO_AFILIADOS_ADESAO, afiliadosAdesao)`.
 */
import { zValidator } from "@hono/zod-validator";
import { Hono } from "hono";
import { createMiddleware } from "hono/factory";
import { HTTPException } from "hono/http-exception";
import type { z } from "zod";
import {
  LIMITE_PEDIDOS_NO_DETALHE,
  ROTAS,
  ROTAS_REGRAS_CAMPANHA,
  detalhesDeValidacao,
} from "../../shared/contracts";
import {
  buscarVinculoDoAfiliado,
  listarAfiliados,
  obterAdesao,
  resumirMudancaDoAfiliado,
  salvarAfiliado,
} from "../db/adesao";
import { removerAfiliado } from "../db/regras-campanha";
import { responderErro } from "../lib/respostas-erro";
import {
  autoriaDaSessao,
  exigirSessao,
  type AmbienteSessao,
} from "../middleware/sessao";

// Montado atrás do login: `c.var.usuario` é quem vincula (trilha de auditoria, RIFA-013b).
type Ambiente = AmbienteSessao;

/** Onde o index.ts monta este sub-app. */
export const PREFIXO_AFILIADOS_ADESAO = "/api/admin";

type CaminhoLocal<T extends string> =
  T extends `${typeof PREFIXO_AFILIADOS_ADESAO}${infer Resto}` ? Resto : never;

/** Caminho de ROTAS sem o prefixo de montagem ("/api/admin/adesao" → "/adesao"). */
function local<T extends `${typeof PREFIXO_AFILIADOS_ADESAO}/${string}`>(
  caminho: T,
): CaminhoLocal<T> {
  return caminho.slice(PREFIXO_AFILIADOS_ADESAO.length) as CaminhoLocal<T>;
}

const MENSAGEM_DE_INVALIDO = {
  json: "Dados inválidos",
  param: "Parâmetro inválido no caminho",
  query: "Consulta inválida",
} as const;

/** Valida com o schema do contrato; fora dele, 400 `requisicao_invalida` com os problemas em `detalhes`. */
function validar<
  Alvo extends keyof typeof MENSAGEM_DE_INVALIDO,
  Schema extends z.ZodType,
>(alvo: Alvo, schema: Schema) {
  return zValidator(alvo, schema, (resultado, c) => {
    if (!resultado.success)
      return responderErro(
        c,
        "requisicao_invalida",
        MENSAGEM_DE_INVALIDO[alvo],
        detalhesDeValidacao(resultado.error),
      );
  });
}

/** A mesma regra que o validador do Hono usa para decidir se lê o corpo como JSON. */
const CONTEUDO_JSON =
  /^application\/([a-z.-]+\+)?json(;\s*[a-zA-Z0-9-]+=([^;]+))*$/i;

/**
 * Corpo sem `Content-Type: application/json` não é JSON: 400 `json_invalido`. Sem isto, o validador do
 * Hono validaria um corpo vazio e responderia que falta `celula_id`, o que engana quem chamou.
 */
const exigirJson = createMiddleware<Ambiente>(async (c, next) => {
  if (!CONTEUDO_JSON.test(c.req.header("Content-Type") ?? ""))
    return responderErro(
      c,
      "json_invalido",
      "Envie o corpo em JSON, com o cabeçalho Content-Type: application/json",
    );
  await next();
});

export const afiliadosAdesao = new Hono<Ambiente>();

afiliadosAdesao.get(
  local(ROTAS.listarAfiliados.caminho),
  validar("query", ROTAS.listarAfiliados.consulta),
  async (c) => c.json(await listarAfiliados(c.env.DB, c.req.valid("query"))),
);

afiliadosAdesao.put(
  local(ROTAS.salvarAfiliado.caminho),
  validar("param", ROTAS.salvarAfiliado.parametros),
  exigirJson,
  validar("json", ROTAS.salvarAfiliado.corpo),
  async (c) => {
    const corpo = c.req.valid("json");
    const { affiliateId } = c.req.valid("param");
    const agora = new Date();
    // Auditoria (RIFA-013b): o vínculo de antes dá o resumo; o registro vai no lote da gravação.
    const autoria = autoriaDaSessao(c, agora);
    const auditoria = autoria && {
      ...autoria,
      resumo: resumirMudancaDoAfiliado(
        await buscarVinculoDoAfiliado(c.env.DB, affiliateId),
        corpo,
      ),
    };
    const resultado = await salvarAfiliado(
      c.env.DB,
      affiliateId,
      corpo,
      agora.toISOString(),
      auditoria,
    );
    if (resultado.ok) return c.json(resultado.afiliado);
    // Como nos erros de validação, `detalhes` aponta o campo do corpo.
    const mensagem = `A célula ${corpo.celula_id} não existe`;
    return responderErro(c, "referencia_invalida", mensagem, [
      { caminho: ["celula_id"], codigo: "referencia_invalida", mensagem },
    ]);
  },
);

const { removerAfiliado: REMOVER } = ROTAS_REGRAS_CAMPANHA;

afiliadosAdesao.delete(
  local(REMOVER.caminho),
  // Só admin, antes do parâmetro: a coordenação leva 403 (o PUT do mesmo caminho continua dela).
  exigirSessao(REMOVER.papeis),
  validar("param", REMOVER.parametros),
  async (c) => {
    const { affiliateId } = c.req.valid("param");
    const autoria = autoriaDaSessao(c);
    if (!autoria) throw new Error("remover afiliado sem sessão");
    const resultado = await removerAfiliado(
      c.env.DB,
      affiliateId,
      autoria,
      LIMITE_PEDIDOS_NO_DETALHE,
    );
    if (resultado.ok) return c.body(null, 204);
    if (resultado.motivo === "nao_encontrado")
      return responderErro(c, "nao_encontrado", "Afiliado não encontrado");
    return responderErro(
      c,
      "afiliado_com_pedidos",
      mensagemAfiliadoComPedidos(
        resultado.pedidosQueContam,
        resultado.foraDaCampanhaAtiva,
      ),
      {
        pedidos_que_contam: resultado.pedidosQueContam,
        pedidos: resultado.pedidos,
      },
    );
  },
);

/**
 * A mensagem do 409 `afiliado_com_pedidos`. Só os pedidos da campanha ativa se desconsideram (na tela Pedidos): com
 * todos os que contam nela, a mensagem manda desconsiderar antes de remover. Com algum fora dela (de outra
 * campanha, ou sem campanha ativa), desconsiderar daqui não resolve: o afiliado não é de teste e fica (D20).
 */
function mensagemAfiliadoComPedidos(
  quantos: number,
  foraDaCampanhaAtiva: number,
): string {
  const contam = `O afiliado tem ${quantos} ${quantos === 1 ? "pedido que conta" : "pedidos que contam"}`;
  if (foraDaCampanhaAtiva === 0)
    return `${contam}: desconsidere ${quantos === 1 ? "o pedido" : "os pedidos"} (teste) na tela Pedidos antes de remover`;
  const fora =
    foraDaCampanhaAtiva === quantos
      ? quantos === 1
        ? "fora da campanha ativa"
        : "todos fora da campanha ativa"
      : `${foraDaCampanhaAtiva} fora da campanha ativa`;
  return `${contam}, ${fora}: pedido fora da campanha ativa não se desconsidera daqui, então este afiliado não é de teste e não pode ser removido`;
}

afiliadosAdesao.get(local(ROTAS.adesao.caminho), async (c) =>
  c.json(await obterAdesao(c.env.DB)),
);

// Vale só para as rotas deste sub-app (o Hono embrulha cada uma com este tratador ao montar).
afiliadosAdesao.onError((erro, c) => {
  // O validador do Hono lança HTTPException 400 (sem resposta própria) quando o corpo se diz JSON, mas
  // não é. A mensagem do SyntaxError cita trechos do corpo: não vai para a resposta nem para o log.
  if (erro instanceof HTTPException) {
    return erro.status === 400 && erro.res === undefined
      ? responderErro(
          c,
          "json_invalido",
          "O corpo da requisição não é um JSON válido",
        )
      : erro.getResponse();
  }
  console.error(`${c.req.method} ${c.req.path}: erro não tratado`, erro);
  return responderErro(c, "erro_interno", "Erro interno");
});
