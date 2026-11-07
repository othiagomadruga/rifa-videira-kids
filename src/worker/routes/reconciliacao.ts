/**
 * Conferência pelo CSV "Exportar Pedidos" da Rifei (RIFA-012; docs/api.md e docs/integracao-rifei.md,
 * seção 10), do grupo `coordenacao`:
 * - POST /api/admin/reconciliacao/analisar: lê o arquivo, detecta (ou confere) as colunas e compara com o
 *   banco, pedido a pedido (com o código) ou pelos totais (sem ele);
 * - POST /api/admin/reconciliacao/recuperar: grava as vendas perdidas escolhidas (simular = prévia);
 * - GET /api/admin/reconciliacao/recuperacoes: as recuperações feitas (auditoria).
 *
 * Este sub-app NÃO autentica: o index.ts o monta sob /api/admin, depois do login da coordenação
 * (`app.route(PREFIXO_RECONCILIACAO, reconciliacao)`), que põe quem está conectado em `c.var.usuario`.
 *
 * Privacidade (D1): o corpo traz o CSV com nome, e-mail e telefone dos compradores. Ele é lido com teto de
 * tamanho, interpretado na memória e descartado: não vai para o banco, para a resposta nem para o log
 * (nem nas mensagens de erro, que só citam linhas, contagens e nomes de coluna).
 */
import { Hono, type Context } from "hono";
import type { z } from "zod";
import {
  LIMITE_CARACTERES_CSV_RECONCILIACAO,
  ROTAS,
  detalhesDeValidacao,
  type ProblemaZod,
  type RespostaRecuperarReconciliacao,
} from "../../shared/contracts";
import { buscarCampanhaAtiva } from "../db/campanha";
import { relogioDoSistema, type Relogio } from "../db/painel";
import {
  gravarRecuperacao,
  lerDadosDaConferencia,
  lerParaRecuperar,
  listarRecuperacoes,
} from "../db/reconciliacao";
import {
  analisarAgregado,
  analisarPorPedido,
  colunasDoMapeamento,
  paraResposta,
  planejarRecuperacao,
} from "../lib/conferencia-analise";
import {
  arquivoGrandeParaConferencia,
  lerArquivoReconciliacao,
  type LeituraArquivo,
} from "../lib/conferencia-arquivo";
import { lerCorpoComLimite } from "../lib/corpo-limitado";
import { sha256Hex } from "../lib/cripto";
import { arquivoVazio, type FalhaCsv } from "../lib/csv";
import { mensagemDeCampo } from "../lib/mensagens-validacao";
import { MENSAGEM_JSON_INVALIDO, responderErro } from "../lib/respostas-erro";
import type { AmbienteSessao } from "../middleware/sessao";

/** Onde o index.ts monta este sub-app. */
export const PREFIXO_RECONCILIACAO = "/api/admin/reconciliacao";

type CaminhoLocal<T extends string> =
  T extends `${typeof PREFIXO_RECONCILIACAO}${infer Resto}` ? Resto : never;

/** Caminho de ROTAS sem o prefixo ("/api/admin/reconciliacao/analisar" → "/analisar"). */
function local<T extends `${typeof PREFIXO_RECONCILIACAO}/${string}`>(
  caminho: T,
): CaminhoLocal<T> {
  return caminho.slice(PREFIXO_RECONCILIACAO.length) as CaminhoLocal<T>;
}

/**
 * Teto do corpo em bytes, lido antes do JSON: o CSV no limite de caracteres, em UTF-8 e escapado no JSON
 * (aspas e quebras de linha viram 2 bytes), com folga. Acima disso a leitura para sem guardar o resto.
 */
export const LIMITE_CORPO_RECONCILIACAO_BYTES =
  LIMITE_CARACTERES_CSV_RECONCILIACAO * 3 + 1_000_000;

/** A mesma regra que o validador do Hono usa para decidir se o corpo é JSON. */
const CONTEUDO_JSON =
  /^application\/([a-z.-]+\+)?json(;\s*[a-zA-Z0-9-]+=([^;]+))*$/i;

/** `csv` vazio ou acima do limite é problema do arquivo (csv_invalido), e não do resto do corpo. */
function problemaDoCsv(problemas: readonly ProblemaZod[]): FalhaCsv | null {
  const doCsv = problemas.find((problema) => problema.path[0] === "csv");
  if (doCsv?.code === "too_big") return arquivoGrandeParaConferencia();
  if (doCsv?.code === "too_small") return arquivoVazio();
  return null;
}

type Leitura<T> = { ok: true; corpo: T } | { ok: false; resposta: Response };

/**
 * Lê e valida o corpo: sem JSON no Content-Type ou JSON malformado, 400 `json_invalido` (mensagem fixa: a
 * do JSON.parse cita trechos do corpo); acima do teto ou com `csv` fora do limite, 400 `csv_invalido`;
 * fora do schema, 400 `requisicao_invalida` (detalhes sem os valores).
 */
async function lerCorpo<S extends z.ZodType>(
  c: Context<AmbienteSessao>,
  schema: S,
): Promise<Leitura<z.output<S>>> {
  if (!CONTEUDO_JSON.test(c.req.header("Content-Type") ?? ""))
    return {
      ok: false,
      resposta: responderErro(
        c,
        "json_invalido",
        "Envie o corpo em JSON, com o cabeçalho Content-Type: application/json",
      ),
    };
  const texto = await lerCorpoComLimite(
    c.req.raw,
    LIMITE_CORPO_RECONCILIACAO_BYTES,
  );
  if (texto === null) {
    const falha = arquivoGrandeParaConferencia();
    return {
      ok: false,
      resposta: responderErro(
        c,
        "csv_invalido",
        falha.mensagem,
        falha.detalhes,
      ),
    };
  }
  let corpo: unknown;
  try {
    corpo = JSON.parse(texto);
  } catch {
    return {
      ok: false,
      resposta: responderErro(c, "json_invalido", MENSAGEM_JSON_INVALIDO),
    };
  }
  const resultado = await schema.safeParseAsync(corpo, {
    error: mensagemDeCampo,
  });
  if (resultado.success) return { ok: true, corpo: resultado.data };
  const doArquivo = problemaDoCsv(resultado.error.issues);
  return {
    ok: false,
    resposta: doArquivo
      ? responderErro(c, "csv_invalido", doArquivo.mensagem, doArquivo.detalhes)
      : responderErro(
          c,
          "requisicao_invalida",
          "Dados inválidos",
          detalhesDeValidacao(resultado.error),
        ),
  };
}

/** A falha da leitura do arquivo como resposta (400 csv_invalido ou 400 requisicao_invalida). */
function responderFalhaDoArquivo(
  c: Context<AmbienteSessao>,
  leitura: Extract<LeituraArquivo, { ok: false }>,
): Response {
  return leitura.tipo === "arquivo"
    ? responderErro(
        c,
        "csv_invalido",
        leitura.falha.mensagem,
        leitura.falha.detalhes,
      )
    : responderErro(
        c,
        "requisicao_invalida",
        "O mapeamento não serve para as colunas do arquivo",
        leitura.problemas,
      );
}

const SEM_CAMPANHA =
  "A campanha ainda não foi configurada: configure-a antes de conferir";

/** Mensagem do log de erro: a de banco (D1_…) ajuda e não tem valores; outra poderia citar o arquivo. */
function mensagemParaLog(erro: Error): string {
  return erro.message.startsWith("D1_")
    ? erro.message.slice(0, 300)
    : "(mensagem omitida: pode citar o arquivo)";
}

/** O sub-app com o relógio dado (os testes fixam o instante; em produção, o do sistema). */
export function criarReconciliacao(relogio: Relogio = relogioDoSistema) {
  const reconciliacao = new Hono<AmbienteSessao>();

  reconciliacao.post(local(ROTAS.analisarReconciliacao.caminho), async (c) => {
    const lido = await lerCorpo(c, ROTAS.analisarReconciliacao.corpo);
    if (!lido.ok) return lido.resposta;
    const db = c.env.DB;
    const campanha = await buscarCampanhaAtiva(db);
    if (!campanha) return responderErro(c, "nao_encontrado", SEM_CAMPANHA);

    const arquivo = lerArquivoReconciliacao(lido.corpo.csv, {
      mapeamento: lido.corpo.mapeamento,
      fuso: campanha.fuso_horario,
    });
    if (!arquivo.ok) return responderFalhaDoArquivo(c, arquivo);

    const { pedidos, afiliados } = await lerDadosDaConferencia(db);
    const dados = {
      campanhaId: campanha.id,
      fuso: campanha.fuso_horario,
      pedidos,
      afiliados,
    };
    const agora = relogio();
    return c.json(
      arquivo.mapeamento.pedido_id === null
        ? analisarAgregado(arquivo, dados, agora)
        : analisarPorPedido(arquivo, dados, agora),
    );
  });

  reconciliacao.post(local(ROTAS.recuperarReconciliacao.caminho), async (c) => {
    const lido = await lerCorpo(c, ROTAS.recuperarReconciliacao.corpo);
    if (!lido.ok) return lido.resposta;
    const { csv, mapeamento, pedidos: codigos, simular } = lido.corpo;
    const db = c.env.DB;
    const campanha = await buscarCampanhaAtiva(db);
    if (!campanha) return responderErro(c, "nao_encontrado", SEM_CAMPANHA);

    const arquivo = lerArquivoReconciliacao(csv, {
      mapeamento,
      fuso: campanha.fuso_horario,
    });
    if (!arquivo.ok) return responderFalhaDoArquivo(c, arquivo);

    const { existentes, afiliados } = await lerParaRecuperar(db, codigos);
    const agora = relogio();
    const plano = planejarRecuperacao(
      arquivo,
      { fuso: campanha.fuso_horario, afiliados, existentes },
      codigos,
      agora,
    );

    let gravados = plano.gravar;
    const naoRecuperados = [...plano.naoRecuperados];
    let recuperacaoId: number | null = null;
    if (!simular && plano.gravar.length > 0) {
      const usuario = c.var.usuario;
      const resultado = await gravarRecuperacao(db, {
        campanhaId: campanha.id,
        usuarioId: usuario.id,
        executadoEm: agora.toISOString(),
        pedidosSolicitados: new Set(codigos).size,
        linhasArquivo: arquivo.linhas.length,
        arquivoSha256: await sha256Hex(csv),
        colunas: colunasDoMapeamento(arquivo),
        pedidos: plano.gravar,
      });
      recuperacaoId = resultado.recuperacaoId;
      // O que não entrou já existia: gravado por outra via entre a leitura e o lote.
      gravados = plano.gravar.filter((pedido) =>
        resultado.gravados.has(pedido.pedido_id),
      );
      for (const pedido of plano.gravar)
        if (!resultado.gravados.has(pedido.pedido_id))
          naoRecuperados.push({
            pedido_id: pedido.pedido_id,
            motivo: "ja_existe",
          });
      // Auditoria também no log: só ids e contagens, nada do arquivo.
      console.info({
        evento: "recuperacao_conferencia",
        recuperacao_id: recuperacaoId,
        usuario_id: usuario.id,
        pedidos_recuperados: gravados.length,
      });
    }

    const recuperados = gravados.map(paraResposta);
    const resposta: RespostaRecuperarReconciliacao = {
      simulado: simular,
      aplicado: !simular && recuperados.length > 0,
      recuperacao_id: recuperacaoId,
      recuperados,
      nao_recuperados: naoRecuperados,
      totais: {
        pedidos_aprovados: recuperados.length,
        bilhetes: recuperados.reduce(
          (soma, pedido) => soma + pedido.qtd_bilhetes,
          0,
        ),
        total_centavos: recuperados.reduce(
          (soma, pedido) => soma + pedido.total_centavos,
          0,
        ),
      },
      avisos: plano.avisos,
    };
    return c.json(resposta);
  });

  reconciliacao.get(local(ROTAS.listarRecuperacoes.caminho), async (c) =>
    c.json({ itens: await listarRecuperacoes(c.env.DB) }),
  );

  // Vale só para as rotas deste sub-app. O log nunca leva o corpo, nem uma mensagem que possa citá-lo.
  reconciliacao.onError((erro, c) => {
    console.error(
      `${c.req.method} ${c.req.path}: erro não tratado (${erro.name}): ${mensagemParaLog(erro)}`,
    );
    return responderErro(c, "erro_interno", "Erro interno");
  });

  return reconciliacao;
}

/** O sub-app de produção (relógio do sistema). */
export const reconciliacao = criarReconciliacao();
