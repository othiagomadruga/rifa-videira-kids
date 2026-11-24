// pedidos (D3, D4): estado atual de cada pedido da Rifei. Do comprador, só ddd e pais (D1) e, desde a RIFA-076 (D36),
// o nome e o telefone (comprador_nome, comprador_telefone), que só o admin vê e que a trilha nunca guarda.
import {
  STATUS_PEDIDO,
  TRANSICOES_PERMITIDAS,
  avisosParaGravar,
  decidirTransicaoPedido,
  reaisParaCentavos,
  type AvisoPayloadRifei,
  type ContatoComprador,
  type PayloadRifeiRedigido,
  type RespostaWebhookRifei,
  type StatusPedido,
} from "../../shared/contracts";
import { avaliarPlausibilidade, type Suspeita } from "../lib/plausibilidade";
import { prepararRegistroAfiliadoOrfao } from "./afiliados";
import { prepararMarcacaoSuspeito } from "./pedidos-suspeitos";
import { prepararRegistroEventoSePedidoIgual } from "./webhook-eventos";

/**
 * Uma tentativa só falha se o pedido (status ou afiliado) mudou entre a leitura e a gravação. Na vida
 * de um pedido isso acontece no máximo 7 vezes: a criação, 2 transições (in_process → expired →
 * approved), o preenchimento do afiliado tardio (de null para um id), a remoção do afiliado de teste pelo
 * admin (RIFA-031, D20: o pedido desconsiderado fica sem afiliado, de um id para null), um evento depois que
 * o preenche de novo (o afiliado tardio, outra vez) e o afiliado gravado pelo próprio sistema quando a Rifei
 * liga a venda ao afiliado da célula atribuída (RIFA-091, adendo da D41: de null para um id, sem webhook).
 * A 8ª sempre grava. A desconsideração (RIFA-028) não
 * conta: não muda status nem afiliado, e o UPSERT abaixo nunca toca nas colunas dela. O pagamento registrado pela
 * conferência (RIFA-056, db/reconciliacao.ts) também não soma: é a transição para approved (a mesma, por outra via;
 * approved é terminal), e o UPSERT abaixo nunca toca em `pagamento_recuperacao_id`.
 */
export const MAX_TENTATIVAS = 8;

/** O que o processamento lê do pedido gravado: o status (guarda da transição, D4) e o afiliado (D7). */
interface PedidoAtual {
  status: StatusPedido;
  affiliate_id: number | null;
}

export async function buscarPedidoAtual(
  db: D1Database,
  id: string,
): Promise<PedidoAtual | null> {
  return db
    .prepare("SELECT status, affiliate_id FROM pedidos WHERE id = ?1")
    .bind(id)
    .first<PedidoAtual>();
}

/** Estados a partir dos quais `alvo` é transição permitida (D4): a guarda do UPSERT condicional. */
function origensPermitidas(alvo: StatusPedido): StatusPedido[] {
  return STATUS_PEDIDO.filter((origem) => {
    const destinos: readonly StatusPedido[] = TRANSICOES_PERMITIDAS[origem];
    return destinos.includes(alvo);
  });
}

// Campos informativos são anuláveis (RIFA-002b): um valor ausente ou inválido segue como null.

/** D8: instantes da Rifei (com fuso) são guardados em UTC. */
function utcOuNulo(instante: string | null): string | null {
  return instante === null ? null : new Date(instante).toISOString();
}

/** D2: reais para centavos inteiros, exatos (reaisParaCentavos do contrato). */
function centavosOuNulo(reais: number | null): number | null {
  return reais === null ? null : reaisParaCentavos(reais);
}

interface GravacaoPedido {
  campanhaId: number;
  payload: PayloadRifeiRedigido;
  contato: ContatoComprador;
  atual: PedidoAtual | null;
  statusResultante: StatusPedido;
  recebidoEm: string;
}

/**
 * Cria ou atualiza o pedido com os dados DESTE evento (D2 centavos, D8 UTC, D1 só ddd e país).
 * - Pedido novo: todos os campos vêm do evento.
 * - Pedido existente: status, qtd_bilhetes e total_centavos vêm do evento; os informativos só são
 *   sobrescritos por valor não nulo (COALESCE), para um null tolerado nunca apagar um valor bom.
 *   ddd e pais andam juntos (CHECK: ddd só com país 55): vêm do evento quando ele traz o país.
 * Grava só se o pedido ainda está como foi lido (a mesma guarda do evento, no mesmo batch) e, no
 * conflito, só a partir de um estado que permite a transição (D4). `registrado_em` não muda. A desconsideração
 * do admin (`desconsiderado_em`, `_motivo` e `_observacao`, D20) nunca é escrita aqui: um evento que chega depois
 * (ex.: o `paid_order` de um pedido de teste desconsiderado) muda o status, mas o pedido continua fora das contas.
 */
function prepararGravacaoPedido(
  db: D1Database,
  gravacao: GravacaoPedido,
): D1PreparedStatement {
  const { payload, contato, statusResultante, recebidoEm } = gravacao;
  // Pedido aprovado sem approved_at: vale o instante do recebimento (CHECK da tabela).
  const aprovadoEm =
    utcOuNulo(payload.approved_at) ??
    (statusResultante === "approved" ? recebidoEm : null);
  return db
    .prepare(
      `INSERT INTO pedidos (
         id, campanha_id, affiliate_id, status, status_rifei, status_detail_rifei,
         qtd_bilhetes, numeros, subtotal_centavos, total_centavos,
         desconto_promocao_centavos, desconto_cupom_centavos, cupom_id, metodo_pagamento, rifinha,
         ddd, pais, utm_source, utm_campaign, utm_medium, utm_content, utm_term,
         criado_em, expira_em, aprovado_em, expirado_em, registrado_em, atualizado_em,
         comprador_nome, comprador_telefone
       )
       SELECT ?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13, ?14, ?15, ?16, ?17,
         ?18, ?19, ?20, ?21, ?22, ?23, ?24, ?25, ?26, ?27, ?27, ?31, ?32
       WHERE (SELECT status FROM pedidos WHERE id = ?1) IS ?28
         AND (SELECT affiliate_id FROM pedidos WHERE id = ?1) IS ?29
       ON CONFLICT (id) DO UPDATE SET
         campanha_id = excluded.campanha_id,
         status = excluded.status,
         qtd_bilhetes = excluded.qtd_bilhetes,
         total_centavos = excluded.total_centavos,
         affiliate_id = COALESCE(excluded.affiliate_id, pedidos.affiliate_id),
         status_rifei = COALESCE(excluded.status_rifei, pedidos.status_rifei),
         status_detail_rifei = COALESCE(excluded.status_detail_rifei, pedidos.status_detail_rifei),
         numeros = COALESCE(excluded.numeros, pedidos.numeros),
         subtotal_centavos = COALESCE(excluded.subtotal_centavos, pedidos.subtotal_centavos),
         desconto_promocao_centavos =
           COALESCE(excluded.desconto_promocao_centavos, pedidos.desconto_promocao_centavos),
         desconto_cupom_centavos =
           COALESCE(excluded.desconto_cupom_centavos, pedidos.desconto_cupom_centavos),
         cupom_id = COALESCE(excluded.cupom_id, pedidos.cupom_id),
         metodo_pagamento = COALESCE(excluded.metodo_pagamento, pedidos.metodo_pagamento),
         rifinha = COALESCE(excluded.rifinha, pedidos.rifinha),
         ddd = CASE WHEN excluded.pais IS NULL THEN pedidos.ddd ELSE excluded.ddd END,
         pais = COALESCE(excluded.pais, pedidos.pais),
         utm_source = COALESCE(excluded.utm_source, pedidos.utm_source),
         utm_campaign = COALESCE(excluded.utm_campaign, pedidos.utm_campaign),
         utm_medium = COALESCE(excluded.utm_medium, pedidos.utm_medium),
         utm_content = COALESCE(excluded.utm_content, pedidos.utm_content),
         utm_term = COALESCE(excluded.utm_term, pedidos.utm_term),
         criado_em = COALESCE(excluded.criado_em, pedidos.criado_em),
         expira_em = COALESCE(excluded.expira_em, pedidos.expira_em),
         aprovado_em = COALESCE(excluded.aprovado_em, pedidos.aprovado_em),
         expirado_em = COALESCE(excluded.expirado_em, pedidos.expirado_em),
         comprador_nome = COALESCE(excluded.comprador_nome, pedidos.comprador_nome),
         comprador_telefone = COALESCE(excluded.comprador_telefone, pedidos.comprador_telefone),
         atualizado_em = excluded.atualizado_em
       WHERE pedidos.status IN (SELECT value FROM json_each(?30))`,
    )
    .bind(
      payload.id,
      gravacao.campanhaId,
      payload.affiliate_id,
      statusResultante,
      payload.status,
      payload.status_detail,
      payload.numbers_count,
      payload.numbers === null ? null : JSON.stringify(payload.numbers),
      centavosOuNulo(payload.subtotal),
      reaisParaCentavos(payload.total),
      centavosOuNulo(payload.promotion_discount),
      centavosOuNulo(payload.coupon_discount),
      payload.coupon_id,
      payload.payment_method,
      payload.is_rifinha === null ? null : payload.is_rifinha ? 1 : 0,
      payload.comprador.ddd,
      payload.comprador.pais,
      payload.utm.source,
      payload.utm.campaign,
      payload.utm.medium,
      payload.utm.content,
      payload.utm.term,
      utcOuNulo(payload.created_at),
      utcOuNulo(payload.expires_at),
      aprovadoEm,
      utcOuNulo(payload.expired_at),
      recebidoEm,
      gravacao.atual?.status ?? null,
      gravacao.atual?.affiliate_id ?? null,
      JSON.stringify(origensPermitidas(statusResultante)),
      contato.nome,
      contato.telefone,
    );
}

/**
 * RIFA-076 (D36): o evento que não grava o pedido (duplicado, transição ignorada) ainda atualiza o contato do
 * comprador, quando traz um valor e ele é diferente do gravado (um valor ausente nunca apaga). Assim os pedidos
 * gravados antes da migração 0017 ganham nome e telefone no próximo evento. Não mexe em status nem afiliado (a guarda
 * da concorrência otimista fica intacta) nem em atualizado_em (o que mudou é só o contato).
 */
function prepararContatoDoComprador(
  db: D1Database,
  pedidoId: string,
  contato: ContatoComprador,
): D1PreparedStatement {
  return db
    .prepare(
      `UPDATE pedidos SET
         comprador_nome = COALESCE(?2, comprador_nome),
         comprador_telefone = COALESCE(?3, comprador_telefone)
       WHERE id = ?1
         AND (comprador_nome IS NOT COALESCE(?2, comprador_nome)
           OR comprador_telefone IS NOT COALESCE(?3, comprador_telefone))`,
    )
    .bind(pedidoId, contato.nome, contato.telefone);
}

/**
 * D7, afiliado tardio: o pedido está sem afiliado e um evento que não o grava (duplicado ou
 * ignorado_transicao) traz affiliate_id. Só o afiliado (e atualizado_em) muda; o resultado do evento,
 * não. Mesma guarda do evento: o pedido ainda tem o status lido e continua sem afiliado.
 */
function prepararAfiliadoTardio(
  db: D1Database,
  payload: PayloadRifeiRedigido,
  statusLido: StatusPedido,
  recebidoEm: string,
): D1PreparedStatement {
  return db
    .prepare(
      `UPDATE pedidos SET affiliate_id = ?1, atualizado_em = ?2
       WHERE id = ?3 AND status = ?4 AND affiliate_id IS NULL`,
    )
    .bind(payload.affiliate_id, recebidoEm, payload.id, statusLido);
}

/** Vai para os avisos do evento quando ele muda o afiliado de um pedido que já existia. */
const AVISO_AFILIADO_ALTERADO: AvisoPayloadRifei = {
  caminho: ["affiliate_id"],
  codigo: "afiliado_alterado",
  mensagem:
    "O affiliate_id do evento é diferente do gravado no pedido: vale o do evento",
  ocorrencias: 1,
};

/** A troca também vai para o log, para auditoria. Só ids, nenhum dado pessoal (D1). */
function registrarTrocaDeAfiliado(
  atual: PedidoAtual,
  payload: PayloadRifeiRedigido,
  eventoId: number,
): void {
  console.warn({
    aviso: "afiliado_alterado",
    mensagem:
      "webhook Rifei: o evento trouxe um affiliate_id diferente do gravado no pedido; vale o do evento",
    evento_id: eventoId,
    pedido_id: payload.id,
    affiliate_id_anterior: atual.affiliate_id,
    affiliate_id_novo: payload.affiliate_id,
  });
}

/**
 * Pedido implausível também vai para o log, para aparecer no Workers Logs. Só ids e os códigos dos
 * motivos, nenhum dado pessoal (D1).
 */
function registrarPedidoImplausivel(
  payload: PayloadRifeiRedigido,
  suspeita: Suspeita,
  eventoId: number,
): void {
  console.warn({
    aviso: "pedido_implausivel",
    mensagem:
      "webhook Rifei: pedido aprovado fora do esperado; continua contando e foi marcado para revisão",
    evento_id: eventoId,
    pedido_id: payload.id,
    affiliate_id: payload.affiliate_id,
    motivos: suspeita.motivos.map((motivo) => motivo.codigo),
  });
}

interface EventoDoPedido {
  campanhaId: number;
  /** Preço do bilhete da campanha ativa: a base da plausibilidade do pedido aprovado (RIFA-013b). */
  precoBilheteCentavos: number;
  /** Payload já redigido (D1) e da campanha ativa (D5). */
  payload: PayloadRifeiRedigido;
  /** RIFA-076 (D36): nome e telefone de quem reservou (só para as colunas do pedido). Padrão: nada. */
  contato?: ContatoComprador;
  /** Diferenças do payload em relação à doc (analisarPayloadRifei). */
  avisos: readonly AvisoPayloadRifei[];
  recebidoEm: string;
}

/**
 * Processa um evento da campanha ativa (passos 7 a 10 de docs/integracao-rifei.md): decide a
 * transição (D4) e grava, num único db.batch (uma transação), o afiliado órfão (D7), o evento, o
 * pedido e o afiliado tardio. Concorrência otimista: tudo leva a mesma guarda ("o pedido ainda é o
 * lido": status e afiliado), então o resultado gravado é sempre o da escrita que de fato aconteceu. Se
 * outra entrega do mesmo pedido gravou no meio do caminho, nada é gravado (o INSERT do evento não
 * devolve id) e a decisão é refeita: duas entregas simultâneas do mesmo evento dão processado + duplicado.
 *
 * Plausibilidade (RIFA-013b, lib/plausibilidade.ts): o evento que APROVA um pedido implausível leva os
 * motivos nos avisos e, no mesmo lote, marca o pedido em pedidos_suspeitos. O pedido é gravado e conta
 * nas vendas como qualquer outro (tirar das vendas é decisão do PO).
 */
export async function processarEventoPedido(
  db: D1Database,
  {
    campanhaId,
    precoBilheteCentavos,
    payload,
    contato = { nome: null, telefone: null },
    avisos,
    recebidoEm,
  }: EventoDoPedido,
): Promise<RespostaWebhookRifei> {
  for (let tentativa = 1; tentativa <= MAX_TENTATIVAS; tentativa++) {
    const atual = await buscarPedidoAtual(db, payload.id);
    const decisao = decidirTransicaoPedido(
      atual?.status ?? null,
      payload.event,
    );
    const processado = decisao.resultado === "processado";
    // O afiliado do pedido muda quando o evento o grava (processado, COALESCE) ou, sem gravar,
    // preenche um pedido que estava sem afiliado (afiliado tardio).
    const trocaAfiliado =
      atual !== null &&
      payload.affiliate_id !== null &&
      payload.affiliate_id !== atual.affiliate_id &&
      (processado || atual.affiliate_id === null);
    // Só o evento que aprova o pedido é avaliado (aprovado é terminal, D4: não há outra aprovação).
    const suspeita =
      processado && decisao.status_resultante === "approved"
        ? avaliarPlausibilidade({
            qtdBilhetes: payload.numbers_count,
            totalCentavos: reaisParaCentavos(payload.total),
            precoBilheteCentavos,
          })
        : null;
    const avisosDoEvento: AvisoPayloadRifei[] = [
      ...avisos,
      ...(trocaAfiliado ? [AVISO_AFILIADO_ALTERADO] : []),
      ...(suspeita?.motivos ?? []),
    ];

    const comandos: D1PreparedStatement[] = [];
    if (payload.affiliate_id !== null) {
      comandos.push(
        prepararRegistroAfiliadoOrfao(db, payload.affiliate_id, recebidoEm),
      );
    }
    const posicaoEvento =
      comandos.push(
        prepararRegistroEventoSePedidoIgual(
          db,
          {
            recebido_em: recebidoEm,
            evento: payload.event,
            pedido_id: payload.id,
            slug: payload.slug,
            resultado: decisao.resultado,
            status_anterior: atual?.status ?? null,
            status_resultante: decisao.status_resultante,
            payload_redigido: payload,
            erro: null,
            avisos: avisosParaGravar(avisosDoEvento),
          },
          atual?.affiliate_id ?? null,
        ),
      ) - 1;
    if (processado) {
      comandos.push(
        prepararGravacaoPedido(db, {
          campanhaId,
          payload,
          contato,
          atual,
          statusResultante: decisao.status_resultante,
          recebidoEm,
        }),
      );
      // Depois da gravação (a marcação aponta para o pedido) e só se ela aconteceu (mesmo lote).
      if (suspeita) {
        comandos.push(
          prepararMarcacaoSuspeito(db, {
            pedidoId: payload.id,
            qtdBilhetes: payload.numbers_count,
            totalCentavos: reaisParaCentavos(payload.total),
            esperadoCentavos: suspeita.esperadoCentavos,
            motivos: suspeita.motivos,
            marcadoEm: recebidoEm,
          }),
        );
      }
    } else if (trocaAfiliado) {
      comandos.push(
        prepararAfiliadoTardio(db, payload, atual.status, recebidoEm),
      );
    }
    if (
      !processado &&
      atual !== null &&
      (contato.nome !== null || contato.telefone !== null)
    )
      comandos.push(prepararContatoDoComprador(db, payload.id, contato));

    const resultados = await db.batch<{ id: number }>(comandos);
    const eventoId = resultados[posicaoEvento]?.results[0]?.id;
    if (eventoId !== undefined) {
      if (trocaAfiliado) registrarTrocaDeAfiliado(atual, payload, eventoId);
      if (suspeita) registrarPedidoImplausivel(payload, suspeita, eventoId);
      return { resultado: decisao.resultado, evento_id: eventoId };
    }
  }
  throw new Error(
    `webhook Rifei: o pedido mudou durante ${MAX_TENTATIVAS} tentativas seguidas`,
  );
}
