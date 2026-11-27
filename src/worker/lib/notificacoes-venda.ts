/**
 * O disparo das notificações de venda (RIFA-095, docs/decisions.md D43). Quando o webhook da Rifei aprova um pedido
 * (o `paid_order` processado: o único ponto em que um pedido passa a contar sozinho; approved é terminal, D4, então a
 * reentrega do mesmo evento é `duplicado` e não chega aqui), `agendarNotificacaoDeVenda` põe o envio no
 * `ctx.waitUntil`: o webhook responde à Rifei sem esperar.
 *
 * `notificarVendaAprovada` confere tudo de novo, na hora: as chaves VAPID, a opção da campanha, o pedido (aprovado,
 * sem desconsiderar, com célula EFETIVA, D41) e a data da aprovação dentro da campanha. Depois manda
 * "🎟️ A célula X vendeu N bilhetes!" para até LIMITE_ENVIOS_POR_VENDA inscrições, ENVIOS_SIMULTANEOS por vez, cada
 * um com TEMPO_LIMITE_ENVIO_MS, e grava os resultados num lote só (404/410 apaga; outra falha soma, e 5 seguidas
 * apagam). Nada aqui faz o webhook falhar.
 *
 * Limites do Worker (D19, plano pago): 1000 subrequisições por invocação (o webhook usa ~5 idas ao D1, o disparo mais
 * 4, e cada push é um fetch), 6 conexões abertas ao mesmo tempo e 30 s de waitUntil depois da resposta. Por isso o
 * teto de 800 envios por venda, 6 simultâneos e o prazo de PRAZO_DOS_ENVIOS_MS para começar um envio. Acima do teto,
 * vai um aviso no log (`notificacoes_acima_do_teto`) e os que ficaram de fora vêm primeiro na venda seguinte. A
 * evolução para mais inscrições é uma fila (Cloudflare Queues) com lotes de envio: docs/decisions.md D43.
 */
import type { Context } from "hono";
import {
  calcularCalendario,
  hojeNoFuso,
  montarNotificacaoDeVenda,
} from "../../shared/contracts";
import type { CampanhaAtiva } from "../db/campanha";
import {
  contarInscricoes,
  gravarResultadosDosEnvios,
  lerInscricoesParaEnvio,
  lerVendaParaNotificar,
  type InscricaoParaEnvio,
} from "../db/push-inscricoes";
import {
  chavesVapidDoAmbiente,
  enviarPush,
  importarChavePrivada,
  type ContextoDoEnvio,
  type ResultadoPush,
} from "./web-push";

/** No máximo estes envios por venda (abaixo das 1000 subrequisições por invocação). */
export const LIMITE_ENVIOS_POR_VENDA = 800;
/** Envios ao mesmo tempo (o Worker abre no máximo 6 conexões simultâneas: mais que isso só espera na fila). */
export const ENVIOS_SIMULTANEOS = 6;
/** Tempo limite de cada envio. */
export const TEMPO_LIMITE_ENVIO_MS = 8_000;
/** Depois deste tempo do início do disparo, nenhum envio novo começa (o waitUntil dura até 30 s). */
export const PRAZO_DOS_ENVIOS_MS = 20_000;
/** Quanto tempo o serviço de push guarda a notificação para um aparelho desligado: 1 hora. */
export const TTL_NOTIFICACAO_SEGUNDOS = 3600;
/** Falhas seguidas que apagam a inscrição. */
export const FALHAS_PARA_APAGAR = 5;

export interface OpcoesDoDisparo {
  fetch?: typeof fetch;
  /** O relógio (os testes fixam). */
  agora?: () => Date;
  /** O teto de envios (os testes usam um menor). */
  limite?: number;
}

/** O que o disparo fez (vai para o log e para os testes). Só contagens. */
export interface ResumoDoDisparo {
  situacao:
    | "desligado"
    | "sem_venda"
    | "fora_da_campanha"
    | "sem_inscricoes"
    | "enviado";
  aceitas: number;
  expiradas: number;
  falharam: number;
  /** As que ficaram de fora (acima do teto ou depois do prazo). */
  puladas: number;
}

const NADA = { aceitas: 0, expiradas: 0, falharam: 0, puladas: 0 };

/** O dia da aprovação (no fuso da campanha) está entre o 1º e o último dia da campanha? */
function dentroDaCampanha(
  campanha: CampanhaAtiva,
  aprovadoEm: string,
): boolean {
  if (campanha.periodos.length === 0) return false;
  const dia = hojeNoFuso(campanha.fuso_horario, new Date(aprovadoEm));
  const { data_fim } = calcularCalendario(
    campanha.data_inicio,
    campanha.periodos,
  );
  return dia >= campanha.data_inicio && dia <= data_fim;
}

/** Roda `tarefa` em cada item, `simultaneos` por vez, sem começar nenhuma depois de `prazo` (ms do relógio). */
async function emLotes<T, R>(
  itens: readonly T[],
  simultaneos: number,
  prazo: number,
  tarefa: (item: T) => Promise<R>,
): Promise<(R | undefined)[]> {
  const resultados: (R | undefined)[] = new Array(itens.length);
  let proximo = 0;
  async function trabalhador() {
    while (proximo < itens.length && Date.now() < prazo) {
      const indice = proximo++;
      resultados[indice] = await tarefa(itens[indice]);
    }
  }
  await Promise.all(
    Array.from({ length: Math.min(simultaneos, itens.length) }, trabalhador),
  );
  return resultados;
}

/**
 * Manda a notificação da venda para as inscrições (veja o topo do arquivo). `campanha` é a ativa, lida pelo webhook
 * (com `notificacoes_vendas`, os períodos e o fuso).
 */
export async function notificarVendaAprovada(
  env: Cloudflare.Env,
  campanha: CampanhaAtiva,
  pedidoId: string,
  {
    fetch: buscar = fetch,
    agora: relogio = () => new Date(),
    limite = LIMITE_ENVIOS_POR_VENDA,
  }: OpcoesDoDisparo = {},
): Promise<ResumoDoDisparo> {
  const chaves = chavesVapidDoAmbiente(env);
  if (chaves === null || campanha.notificacoes_vendas === 0)
    return { situacao: "desligado", ...NADA };
  const db = env.DB;
  const venda = await lerVendaParaNotificar(db, campanha.id, pedidoId);
  if (venda === null) return { situacao: "sem_venda", ...NADA };
  if (!dentroDaCampanha(campanha, venda.aprovado_em))
    return { situacao: "fora_da_campanha", ...NADA };

  const lidas = await lerInscricoesParaEnvio(db, limite + 1);
  if (lidas.length === 0) return { situacao: "sem_inscricoes", ...NADA };
  let puladas = 0;
  let inscricoes: InscricaoParaEnvio[] = lidas;
  if (lidas.length > limite) {
    inscricoes = lidas.slice(0, limite);
    const total = await contarInscricoes(db);
    puladas = total - limite;
    console.warn({
      aviso: "notificacoes_acima_do_teto",
      mensagem: `Notificações de venda: ${total} inscrições, acima do teto de ${limite} por venda; as ${puladas} que ficaram de fora vêm primeiro na próxima venda (evolução: Cloudflare Queues, D43)`,
      inscricoes: total,
      teto: limite,
    });
  }

  const instante = relogio();
  const contexto: ContextoDoEnvio = {
    chaves,
    chaveVapid: await importarChavePrivada(
      chaves.publica,
      chaves.privada,
      "ECDSA",
    ),
    jwts: new Map(),
    ttlSegundos: TTL_NOTIFICACAO_SEGUNDOS,
    tempoLimiteMs: TEMPO_LIMITE_ENVIO_MS,
    agora: instante,
    fetch: buscar,
  };
  const conteudo = new TextEncoder().encode(
    JSON.stringify(montarNotificacaoDeVenda(venda.celula, venda.bilhetes)),
  );
  const resultados = await emLotes(
    inscricoes,
    ENVIOS_SIMULTANEOS,
    Date.now() + PRAZO_DOS_ENVIOS_MS,
    (inscricao) => enviarPush(inscricao, conteudo, contexto),
  );
  const ids = (resultado: ResultadoPush) =>
    inscricoes
      .filter((_, indice) => resultados[indice] === resultado)
      .map((inscricao) => inscricao.id);
  const aceitas = ids("aceito");
  const expiradas = ids("expirado");
  const falharam = ids("falhou");
  puladas += resultados.filter((resultado) => resultado === undefined).length;
  await gravarResultadosDosEnvios(db, {
    aceitas,
    expiradas,
    falharam,
    agora: instante.toISOString(),
    falhasParaApagar: FALHAS_PARA_APAGAR,
  });
  const resumo: ResumoDoDisparo = {
    situacao: "enviado",
    aceitas: aceitas.length,
    expiradas: expiradas.length,
    falharam: falharam.length,
    puladas,
  };
  // Só contagens e o id do pedido (como os outros logs do webhook): nenhum endpoint, chave ou comprador.
  console.log({
    evento: "notificacoes_de_venda",
    pedido_id: pedidoId,
    ...resumo,
  });
  return resumo;
}

/**
 * Para o webhook: põe o disparo no `ctx.waitUntil` (a resposta à Rifei não espera). Sem as chaves ou com a opção
 * desligada, nada (nem uma ida ao banco). Sem contexto de execução (só os testes que chamam o app direto, sem ele),
 * também nada. Uma falha do disparo vai para o log, sem o endpoint, e nunca para o webhook.
 */
export function agendarNotificacaoDeVenda(
  c: Context<{ Bindings: Cloudflare.Env }>,
  campanha: CampanhaAtiva,
  pedidoId: string,
): void {
  if (
    chavesVapidDoAmbiente(c.env) === null ||
    campanha.notificacoes_vendas === 0
  )
    return;
  let contexto: { waitUntil(promessa: Promise<unknown>): void };
  try {
    contexto = c.executionCtx;
  } catch {
    return;
  }
  contexto.waitUntil(
    notificarVendaAprovada(c.env, campanha, pedidoId).catch((erro: unknown) => {
      console.error({
        aviso: "notificacoes_de_venda_falhou",
        mensagem: "Notificações de venda: o disparo falhou",
        pedido_id: pedidoId,
        erro: erro instanceof Error ? erro.name : "desconhecido",
      });
    }),
  );
}
