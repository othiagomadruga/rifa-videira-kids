/**
 * Token do webhook da Rifei gerado pela tela (RIFA-039, docs/decisions.md D21; docs/api.md), SÓ ADMIN:
 * - GET /api/admin/webhook/token: o estado (qual credencial vale, desde quando, o último uso e a URL para a Rifei),
 *   conferido no estadoTokenWebhookSchema (estrito). NUNCA o token nem o hash.
 * - POST /api/admin/webhook/token { substituir? }: gera um token novo e responde 201 { token, estado }, a única vez
 *   em que o token aparece (com `Cache-Control: no-store`, do exigirSessao). Com credencial vigente (o token da tela
 *   ou o segredo do Worker) e sem `substituir: true`: 409 `em_uso` com { vigente } e nada muda. A gravação e a trilha
 *   vão num lote só (db/token-webhook.ts). Se a gravação falha, 500 pelo onError, e o token é descartado sem ter sido
 *   mostrado.
 *
 * O index.ts monta este sub-app sob /api/admin, depois do login da coordenação (passo 4). O "só admin" fica no
 * handler de cada rota (exigirSessao antes do validador: a coordenação leva 403, nunca 400 ou 409), nunca num `use`
 * de /api/admin/webhook/*: as entregas e o estado do webhook (routes/webhook-coordenacao.ts) são da coordenação.
 */
import { Hono, type Context } from "hono";
import {
  CAMINHOS_WEBHOOK_RIFEI,
  ROTAS_TOKEN_WEBHOOK,
  SEGREDO_WEBHOOK_RIFEI,
  credencialVigenteDoWebhook,
  estadoTokenWebhookSchema,
  respostaGerarTokenWebhookSchema,
  segredoDoWorkerConfigurado,
  ultimoUsoDoWebhook,
  type EstadoTokenWebhook,
  type RespostaGerarTokenWebhook,
} from "../../shared/contracts";
import {
  gravarTokenWebhook,
  lerGeradoEmDoTokenWebhook,
  lerTokenWebhookParaATela,
} from "../db/token-webhook";
import { gerarTokenWebhook, sha256Hex } from "../lib/cripto";
import { responderErro } from "../lib/respostas-erro";
import {
  autoriaDaSessao,
  exigirSessao,
  type AmbienteSessao,
} from "../middleware/sessao";
import { validarJson } from "../middleware/validacao";

type Ambiente = AmbienteSessao;

const { obterTokenWebhook: OBTER, gerarTokenWebhook: GERAR } =
  ROTAS_TOKEN_WEBHOOK;

/** Onde o index.ts monta este sub-app. */
export const PREFIXO_TOKEN_WEBHOOK = "/api/admin";

const local = (caminho: string) => caminho.slice(PREFIXO_TOKEN_WEBHOOK.length);

/** O estado do token antes da conferência no schema: a regra das credenciais e a do último uso são do contrato. */
function montarEstado(
  c: Context<Ambiente>,
  geradoEm: string | null,
  ultimaEntregaEm: string | null,
): EstadoTokenWebhook {
  const segredoConfigurado = segredoDoWorkerConfigurado(
    c.env[SEGREDO_WEBHOOK_RIFEI],
  );
  const vigente = credencialVigenteDoWebhook({
    tokenDaTela: geradoEm !== null,
    segredoConfigurado,
  });
  return {
    vigente,
    gerado_em: geradoEm,
    ultimo_uso_em: ultimoUsoDoWebhook(vigente, geradoEm, ultimaEntregaEm),
    segredo_configurado: segredoConfigurado,
    // A origem da requisição, como as URLs dos links de acesso (lib/links-acesso.ts).
    url: `${new URL(c.req.url).origin}${CAMINHOS_WEBHOOK_RIFEI[0]}`,
  };
}

/** Quem gera e quando (o mesmo instante grava `gerado_em`): a rota roda depois de exigirSessao. */
function autoria(c: Context<Ambiente>) {
  const quem = autoriaDaSessao(c);
  if (!quem)
    throw new Error("gerar token do webhook sem sessão (falta exigirSessao)");
  return quem;
}

/** O 409 `em_uso` (detalhesTokenWebhookEmUsoSchema): a credencial que deixaria de valer. */
function responderEmUso(
  c: Context<Ambiente>,
  vigente: NonNullable<EstadoTokenWebhook["vigente"]>,
) {
  return responderErro(
    c,
    "em_uso",
    vigente === "tela"
      ? "Já existe um token do webhook gerado pela tela: confirme para gerar outro (o anterior para de valer na hora)"
      : "O webhook usa o segredo do Worker: confirme para gerar o token pela tela (o segredo para de valer na hora)",
    { vigente },
  );
}

export const tokenWebhook = new Hono<Ambiente>();

tokenWebhook.get(
  local(OBTER.caminho),
  // Só admin, no handler: um `use` de /api/admin/webhook/* tiraria da coordenação as entregas e o estado.
  exigirSessao(OBTER.papeis),
  async (c) => {
    const { geradoEm, ultimaEntregaEm } = await lerTokenWebhookParaATela(
      c.env.DB,
    );
    return c.json(
      estadoTokenWebhookSchema.parse(
        montarEstado(c, geradoEm, ultimaEntregaEm),
      ),
      200,
    );
  },
);

tokenWebhook.post(
  local(GERAR.caminho),
  // Só admin, antes de ler o corpo: a coordenação leva 403 mesmo com um corpo inválido ou com credencial vigente.
  exigirSessao(GERAR.papeis),
  validarJson(GERAR.corpo),
  async (c) => {
    const { substituir } = c.req.valid("json");
    const db = c.env.DB;
    const segredoConfigurado = segredoDoWorkerConfigurado(
      c.env[SEGREDO_WEBHOOK_RIFEI],
    );
    // 1 linha: decide o 409 e o `vigente` do detalhe. O segredo do Worker sem `substituir` dá 409 antes do lote.
    const vigente = credencialVigenteDoWebhook({
      tokenDaTela: (await lerGeradoEmDoTokenWebhook(db)) !== null,
      segredoConfigurado,
    });
    if (vigente !== null && !substituir) return responderEmUso(c, vigente);

    const quem = autoria(c);
    // O estado novo (vale o token da tela, ainda sem uso), conferido no schema da resposta ANTES de gravar (um erro
    // aqui não deixa um token valendo sem ter sido mostrado) e SEM o token no parse (o erro iria para o log).
    const estado = respostaGerarTokenWebhookSchema.shape.estado.parse(
      montarEstado(c, quem.em, null),
    );
    const token = gerarTokenWebhook();
    const gravado = await gravarTokenWebhook(
      db,
      { tokenHash: await sha256Hex(token), substituir, segredoConfigurado },
      quem,
    );
    // Sem `substituir`, outra aba gerou um token entre a leitura e o lote: nada mudou, e o token daqui é descartado.
    if (!gravado) return responderEmUso(c, "tela");
    return c.json({ token, estado } satisfies RespostaGerarTokenWebhook, 201);
  },
);
