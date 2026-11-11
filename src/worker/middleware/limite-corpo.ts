/**
 * Limite de tamanho do corpo ANTES de ler ou validar (RIFA-013b). Reaproveita o leitor do webhook
 * (lib/corpo-limitado.ts): um `Content-Length` acima do limite recusa sem ler nada; sem ele (envio em
 * partes), o fluxo é contado enquanto chega e a leitura para no limite, sem guardar o resto. Dentro do
 * limite, o corpo lido volta para a requisição (`c.req.raw`), e o resto da cadeia o lê como antes
 * (`c.req.json()`, os validadores ou o próprio `c.req.raw`).
 *
 * - POST /api/sessao (aberto): LIMITE_CORPO_SESSAO_BYTES (o corpo real tem uns 60 bytes);
 * - POST, PUT e PATCH da coordenação (/api/admin/*, /api/painel/*): LIMITE_CORPO_COORDENACAO_BYTES,
 *   depois do login (sem sessão, o corpo nem é lido);
 * - as importações de CSV têm o teto delas, conferido na própria rota: a da hierarquia
 *   (LIMITE_CORPO_IMPORTACAO_HIERARQUIA_BYTES, routes/hierarquia.ts) e a conferência da RIFA-012
 *   (/api/admin/reconciliacao/*: LIMITE_CORPO_CONFERENCIA_BYTES, no contrato, lido uma vez só pela rota,
 *   e de uma vez quando há Content-Length; ler em pedaços aqui e de novo lá custava ~2 ms de CPU a mais
 *   para os 420 KB de 7 mil pedidos; D19).
 * Acima do limite: 413 `corpo_muito_grande` (a importação da hierarquia responde como ao arquivo grande).
 */
import type { Context } from "hono";
import { createMiddleware } from "hono/factory";
import {
  LIMITE_CARACTERES_CSV_HIERARQUIA,
  ROTAS,
} from "../../shared/contracts";
import { lerCorpoComLimite } from "../lib/corpo-limitado";
import { responderErro } from "../lib/respostas-erro";

/** POST /api/sessao: `{ "token": "<43 caracteres>" }` cabe com folga. */
export const LIMITE_CORPO_SESSAO_BYTES = 4 * 1024;

/** Escritas da coordenação: os corpos reais têm poucos KB (a campanha com períodos é o maior). */
export const LIMITE_CORPO_COORDENACAO_BYTES = 1024 * 1024;

/**
 * Importação da hierarquia: o `csv` vai até LIMITE_CARACTERES_CSV_HIERARQUIA caracteres (o limite dela, no
 * contrato); em UTF-8 e escapado no JSON (aspas e quebras de linha viram 2 bytes, letras acentuadas 2,
 * outras escritas até 3), com folga. A mesma conta da conferência da RIFA-012.
 */
export const LIMITE_CORPO_IMPORTACAO_HIERARQUIA_BYTES =
  LIMITE_CARACTERES_CSV_HIERARQUIA * 3 + 1_000_000;

/**
 * Rotas da coordenação com teto próprio, conferido nelas: o geral não lê o corpo delas (a conferência lê
 * `c.req.raw` direto). Prefixo da RIFA-012 escrito aqui de propósito (é o PREFIXO_RECONCILIACAO de
 * routes/reconciliacao.ts; o teste da conferência em limite-corpo.test.ts usa o mesmo caminho).
 */
const IMPORTACAO_HIERARQUIA = ROTAS.importarHierarquia.caminho;
const PREFIXO_CONFERENCIA = "/api/admin/reconciliacao";

function temTetoProprio(caminho: string): boolean {
  return (
    caminho === IMPORTACAO_HIERARQUIA ||
    caminho === PREFIXO_CONFERENCIA ||
    caminho.startsWith(`${PREFIXO_CONFERENCIA}/`)
  );
}

const METODOS_COM_CORPO = new Set(["POST", "PUT", "PATCH"]);

function formatarBytes(limite: number): string {
  return limite % (1024 * 1024) === 0
    ? `${limite / (1024 * 1024)} MiB`
    : `${limite / 1024} KiB`;
}

/** 413 `corpo_muito_grande`, com o limite na mensagem. */
export function respostaCorpoMuitoGrande(limite: number) {
  return (c: Context): Response =>
    responderErro(
      c,
      "corpo_muito_grande",
      `O corpo passa do limite de ${formatarBytes(limite)}`,
    );
}

/**
 * Lê o corpo até `limite` bytes antes do resto da cadeia; acima disso, responde com `recusar` (padrão:
 * 413 `corpo_muito_grande`) sem ler o resto. Requisição sem corpo passa direto.
 */
export function limitarCorpo(
  limite: number,
  recusar: (c: Context) => Response = respostaCorpoMuitoGrande(limite),
) {
  return createMiddleware(async (c, next) => {
    const original = c.req.raw;
    if (original.body !== null) {
      const texto = await lerCorpoComLimite(original, limite);
      if (texto === null) return recusar(c);
      // O fluxo original já foi lido: a cadeia lê o mesmo texto de uma requisição igual (URL, método e
      // cabeçalhos). Nada ficou em c.req.bodyCache antes deste ponto.
      c.req.raw = new Request(original, { body: texto });
    }
    await next();
  });
}

const limitarCorpoDaCoordenacaoNoTeto = limitarCorpo(
  LIMITE_CORPO_COORDENACAO_BYTES,
);

/**
 * Para o index.ts, em /api/admin/* e /api/painel/*, DEPOIS do login: POST, PUT e PATCH com o teto da
 * coordenação, exceto as rotas com teto próprio.
 */
export const limitarCorpoDaCoordenacao = createMiddleware(async (c, next) => {
  if (!METODOS_COM_CORPO.has(c.req.method) || temTetoProprio(c.req.path)) {
    await next();
    return;
  }
  return limitarCorpoDaCoordenacaoNoTeto(c, next);
});
