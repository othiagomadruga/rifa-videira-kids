/**
 * Link de vendas de cada célula, na coordenação (RIFA-046, docs/decisions.md D24; docs/api.md), sob /api/admin:
 * - GET /api/admin/links-vendas (admin e coordenação, para a tela Adesão): o modelo como está gravado, `configurado` e
 *   TODAS as células, inclusive as sem afiliado (com `links` vazia);
 * - PUT /api/admin/links-vendas/modelo { modelo } (SÓ ADMIN): grava o modelo (null ou vazio apaga) na campanha ativa
 *   e responde 200 com a lista do GET, já montada com o modelo novo. A trilha (`campanha.salvar`, com o antes e o
 *   depois) e a gravação vão num lote só, sob a mesma condição: o mesmo modelo de novo responde 200 e não registra.
 *
 * O index.ts monta este sub-app sob /api/admin, depois do login da coordenação (passo 4). O "só admin" fica no
 * handler do PUT (exigirSessao antes de olhar o corpo: a coordenação leva 403, nunca 400), nunca num `use` de
 * /api/admin/links-vendas/*, que pegaria o GET (da coordenação). Sem campanha ativa: 404 nas duas. Toda resposta 200
 * passa pelo schema estrito do contrato antes de sair (um campo a mais vira 500 `erro_interno`), sem cache
 * (`no-store`, do exigirSessao) e lida do D1 a cada requisição.
 */
import { Hono } from "hono";
import { createMiddleware } from "hono/factory";
import { ROTAS_LINK_VENDAS } from "../../shared/contracts";
import { lerLinksVendas, salvarModeloLinkVendas } from "../db/links-vendas";
import { montarRespostaLinksVendas } from "../lib/links-vendas";
import { responderErro } from "../lib/respostas-erro";
import {
  autoriaDaSessao,
  exigirSessao,
  type AmbienteSessao,
} from "../middleware/sessao";
import { validarJson } from "../middleware/validacao";

type Ambiente = AmbienteSessao;

const { linksVendas: LISTAR, salvarModeloLinkVendas: SALVAR } =
  ROTAS_LINK_VENDAS;

/** Onde o index.ts monta este sub-app. */
export const PREFIXO_LINKS_VENDAS = "/api/admin";

const local = (caminho: string) => caminho.slice(PREFIXO_LINKS_VENDAS.length);

/** A mesma regra que o validador do Hono usa para decidir se o corpo é JSON (como o PUT da campanha). */
const CONTEUDO_JSON =
  /^application\/([a-z.-]+\+)?json(;\s*[a-zA-Z0-9-]+=([^;]+))*$/i;

/** Corpo sem `Content-Type: application/json` não é JSON: 400 `json_invalido` (como os outros PUT). */
const exigirJson = createMiddleware<Ambiente>(async (c, next) => {
  if (!CONTEUDO_JSON.test(c.req.header("Content-Type") ?? ""))
    return responderErro(
      c,
      "json_invalido",
      "Envie o corpo em JSON, com o cabeçalho Content-Type: application/json",
    );
  await next();
});

const MENSAGEM_SEM_CAMPANHA =
  "Nenhuma campanha ativa: configure a campanha antes do link de vendas";

export const linksVendas = new Hono<Ambiente>();

linksVendas.get(local(LISTAR.caminho), async (c) => {
  const leitura = await lerLinksVendas(c.env.DB, "todas");
  if (leitura === null)
    return responderErro(c, "nao_encontrado", MENSAGEM_SEM_CAMPANHA);
  return c.json(
    LISTAR.sucesso.corpo.parse(montarRespostaLinksVendas(leitura)),
    200,
  );
});

linksVendas.put(
  local(SALVAR.caminho),
  // Só admin, antes de ler o corpo: a coordenação leva 403 mesmo com um corpo inválido (o GET segue dela).
  exigirSessao(SALVAR.papeis),
  exigirJson,
  validarJson(SALVAR.corpo),
  async (c) => {
    const { modelo } = c.req.valid("json");
    const autoria = autoriaDaSessao(c);
    if (!autoria)
      throw new Error("salvar o modelo do link de vendas sem sessão");
    const { leitura } = await salvarModeloLinkVendas(c.env.DB, modelo, autoria);
    if (leitura === null)
      return responderErro(c, "nao_encontrado", MENSAGEM_SEM_CAMPANHA);
    return c.json(
      SALVAR.sucesso.corpo.parse(montarRespostaLinksVendas(leitura)),
      200,
    );
  },
);
