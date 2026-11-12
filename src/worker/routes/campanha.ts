/**
 * GET e PUT /api/admin/campanha (grupo `coordenacao`, docs/api.md): a configuração da campanha ativa.
 *
 * Este sub-app NÃO autentica: o index.ts o monta sob /api/admin, atrás do login da coordenação:
 * `app.route(PREFIXO_CAMPANHA, campanha)`. Caminhos e schemas vêm do contrato (`ROTAS`).
 *
 * - GET: 200 com a campanha; 404 `nao_encontrado` enquanto nada foi configurado.
 * - PUT: valida com `corpoSalvarCampanhaSchema`; 400 `json_invalido` (corpo que não é JSON, ou sem
 *   Content-Type JSON) ou `requisicao_invalida` (fora do schema, com os problemas em `detalhes`);
 *   409 `nome_duplicado` (slug de outra campanha). O primeiro PUT cria a campanha já ativa; os
 *   seguintes substituem a configuração dela, numa transação. É a partir daí que o webhook passa a
 *   contar as vendas da Rifei com esse `slug_rifei` (D5). Cada PUT gravado deixa na trilha de auditoria
 *   quem salvou e o que mudou (RIFA-013b; inclusive o slug antes e depois), na mesma transação.
 * - Os grupos `pedidos`, `acesso` e `mensagens` são só do admin (RIFA-042, adendo da D20): quem não é admin e
 *   manda algum deles diferente do gravado leva 403 `proibido` (depois do 400 do schema e antes de gravar), e nada é
 *   gravado. Ausentes ou iguais ao gravado passam, mas a gravação vai sem eles (grupo ausente mantém o gravado): o
 *   PUT da coordenação nunca escreve essas colunas, nem desfaz o que um admin gravar no meio.
 */
import { Hono } from "hono";
import {
  ROTAS,
  detalhesDeValidacao,
  type UsuarioSessao,
} from "../../shared/contracts";
import {
  buscarCampanhaAtiva,
  gruposDoAdminAlterados,
  montarCampanha,
  resumirMudancaDaCampanha,
  salvarCampanhaAtiva,
  semGruposDoAdmin,
} from "../db/campanha";
import { responderErro } from "../lib/respostas-erro";
import { autoriaDaSessao, type AmbienteSessao } from "../middleware/sessao";

// Montado atrás do login: `c.var.usuario` é quem salva (trilha de auditoria, RIFA-013b).
type Ambiente = AmbienteSessao;

/** Onde o index.ts monta este sub-app. */
export const PREFIXO_CAMPANHA = "/api/admin";

/** "/api/admin/campanha" → "/campanha" (o caminho dentro do sub-app). */
const CAMINHO = ROTAS.obterCampanha.caminho.slice(PREFIXO_CAMPANHA.length);

/** A mesma regra que o validador do Hono usa para decidir se o corpo é JSON. */
const CONTEUDO_JSON =
  /^application\/([a-z.-]+\+)?json(;\s*[a-zA-Z0-9-]+=([^;]+))*$/i;

export const campanha = new Hono<Ambiente>();

campanha.get(CAMINHO, async (c) => {
  const ativa = await buscarCampanhaAtiva(c.env.DB);
  return ativa
    ? c.json(montarCampanha(ativa), 200)
    : responderErro(
        c,
        "nao_encontrado",
        "A campanha ainda não foi configurada",
      );
});

campanha.put(CAMINHO, async (c) => {
  if (!CONTEUDO_JSON.test(c.req.header("Content-Type") ?? "")) {
    return responderErro(
      c,
      "json_invalido",
      "Envie o corpo em JSON, com o cabeçalho Content-Type: application/json",
    );
  }
  let corpo: unknown;
  try {
    corpo = await c.req.json();
  } catch {
    // Mensagem fixa: a do JSON.parse cita trechos do corpo.
    return responderErro(
      c,
      "json_invalido",
      "O corpo da requisição não é um JSON válido",
    );
  }
  const validacao = ROTAS.salvarCampanha.corpo.safeParse(corpo);
  if (!validacao.success) {
    return responderErro(
      c,
      "requisicao_invalida",
      "Dados inválidos",
      detalhesDeValidacao(validacao.error),
    );
  }
  // O antes vem da mesma leitura do GET: serve à conferência dos grupos do admin e ao resumo da trilha.
  const antes = await buscarCampanhaAtiva(c.env.DB);
  let dados = validacao.data;
  // Grupos só do admin (RIFA-042). Sem sessão (só no sub-app de teste, montado sem o login), também não é admin.
  const usuario = c.get("usuario") as UsuarioSessao | undefined;
  if (usuario?.papel !== "admin") {
    const alterados = gruposDoAdminAlterados(antes, dados);
    if (alterados.length > 0)
      return responderErro(
        c,
        "proibido",
        `Só o admin muda os grupos pedidos, acesso e mensagens da campanha (este salvamento mudava: ${alterados.join(", ")}). Nada foi salvo: mande esses grupos como estão gravados, ou sem eles.`,
      );
    dados = semGruposDoAdmin(dados);
  }
  // Auditoria (RIFA-013b): o registro vai no lote da gravação.
  const autoria = autoriaDaSessao(c);
  const auditoria = autoria && {
    ...autoria,
    resumo: resumirMudancaDaCampanha(antes, dados),
  };
  const resultado = await salvarCampanhaAtiva(c.env.DB, dados, auditoria);
  return resultado.ok
    ? c.json(resultado.campanha, 200)
    : responderErro(
        c,
        resultado.codigo,
        resultado.mensagem,
        resultado.detalhes,
      );
});

// Vale só para as rotas deste sub-app (o Hono embrulha cada uma com este tratador ao montar).
campanha.onError((erro, c) => {
  console.error(`${c.req.method} ${c.req.path}: erro não tratado`, erro);
  return responderErro(c, "erro_interno", "Erro interno");
});
