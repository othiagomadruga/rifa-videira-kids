/**
 * Conferência pelo CSV "Exportar Pedidos" da Rifei (RIFA-012; docs/api.md e docs/integracao-rifei.md,
 * seção 10), do grupo `coordenacao`:
 * - POST /api/admin/reconciliacao/analisar: compara o corpo compacto (o navegador já leu o CSV e mandou
 *   só as colunas mapeadas, normalizadas) com o banco, pedido a pedido (com o código) ou pelos totais;
 * - POST /api/admin/reconciliacao/recuperar: grava as vendas perdidas escolhidas (simular = prévia);
 * - GET /api/admin/reconciliacao/recuperacoes: as recuperações feitas (auditoria).
 *
 * Este sub-app NÃO autentica: o index.ts o monta sob /api/admin, depois do login da coordenação
 * (`app.route(PREFIXO_RECONCILIACAO, reconciliacao)`), que põe quem está conectado em `c.var.usuario`. O
 * teto do corpo é o da conferência (LIMITE_CORPO_CONFERENCIA_BYTES, 1 MiB), conferido aqui: o teto geral
 * (middleware/limite-corpo.ts) deixa estas rotas de fora para o corpo ser lido uma vez só.
 *
 * CPU: o plano Free dá 10 ms por requisição. Nada aqui lê o CSV nem usa o Intl por linha: a validação é
 * um laço simples (src/shared/contracts/conferencia.ts), o banco devolve só os pedidos com os códigos do
 * arquivo e os totais já somados (db/reconciliacao.ts), e a análise é um passeio pelos pedidos.
 *
 * Privacidade (D1): o corpo nem tem as colunas de dado pessoal (ficam no navegador), e um corpo com uma
 * coluna de nome pessoal mapeada é recusado. O log de erro leva só o nome do erro (e a mensagem do D1).
 */
import { Hono, type Context } from "hono";
import {
  CAMPOS_RECONCILIACAO,
  LIMITE_CORPO_CONFERENCIA_BYTES,
  ROTAS,
  validarCorpoConferencia,
  validarCorpoRecuperacao,
  type CorpoConferencia,
  type DetalheValidacao,
  type ProblemaDoCorpo,
  type RespostaRecuperarReconciliacao,
  type ValidacaoDoCorpo,
} from "../../shared/contracts";
import { ehNomeDeColunaPessoal } from "../../shared/conferencia/colunas";
import { buscarCampanhaAtiva } from "../db/campanha";
import { relogioDoSistema, type Relogio } from "../db/painel";
import {
  gravarRecuperacao,
  lerParaAgregado,
  lerParaPorPedido,
  listarRecuperacoes,
} from "../db/reconciliacao";
import {
  Calendario,
  agruparPedidos,
  analisarAgregado,
  analisarPorPedido,
  decidir,
  periodoDoArquivo,
  planejarRecuperacao,
  type CampanhaDaConferencia,
} from "../lib/conferencia-analise";
import { lerCorpoComLimite } from "../lib/corpo-limitado";
import { MENSAGEM_JSON_INVALIDO, responderErro } from "../lib/respostas-erro";
import { respostaCorpoMuitoGrande } from "../middleware/limite-corpo";
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

/** A mesma regra que o validador do Hono usa para decidir se o corpo é JSON. */
const CONTEUDO_JSON =
  /^application\/([a-z.-]+\+)?json(;\s*[a-zA-Z0-9-]+=([^;]+))*$/i;

type Leitura<T> = { ok: true; corpo: T } | { ok: false; resposta: Response };

/**
 * O texto do corpo até `limite` bytes, ou null acima dele, sem ler o resto. Com o Content-Length (o
 * navegador sempre manda; o HTTP garante que o corpo tem esse tamanho), a decisão sai do cabeçalho e o
 * corpo é lido de uma vez; sem ele (envio em partes), em pedaços contados (lerCorpoComLimite), que custa
 * mais CPU (~2,5 ms a mais para 420 KB no workerd).
 */
export async function lerCorpoDaConferencia(
  requisicao: Request,
  limite: number,
): Promise<string | null> {
  const declarado = requisicao.headers.get("Content-Length");
  if (declarado === null || !/^\d{1,15}$/.test(declarado))
    return lerCorpoComLimite(requisicao, limite);
  if (Number(declarado) > limite) return null;
  const texto = await requisicao.text();
  // Cada caractere tem pelo menos 1 byte: mais caracteres que o limite já passou dele.
  return texto.length > limite ? null : texto;
}

/** Os problemas do corpo como `detalhes` (com um item final quando passaram do limite listado). */
function detalhesDoCorpo(
  problemas: readonly ProblemaDoCorpo[],
  total: number,
): DetalheValidacao[] {
  const detalhes: DetalheValidacao[] = [...problemas];
  if (total > problemas.length)
    detalhes.push({
      caminho: [],
      codigo: "itens_omitidos",
      mensagem: `Mais ${total - problemas.length} problemas no corpo`,
    });
  return detalhes;
}

/**
 * Lê e confere o corpo: sem JSON no Content-Type ou JSON malformado, 400 `json_invalido` (mensagem fixa:
 * a do JSON.parse cita trechos do corpo); acima do teto, 413 `corpo_muito_grande` sem ler o resto; fora
 * do formato, 400 `requisicao_invalida` (detalhes sem os valores); com uma coluna de nome pessoal
 * mapeada, 400 `requisicao_invalida` (`coluna_pessoal`).
 */
async function lerCorpo<T extends CorpoConferencia>(
  c: Context<AmbienteSessao>,
  validar: (valor: unknown) => ValidacaoDoCorpo<T>,
): Promise<Leitura<T>> {
  if (!CONTEUDO_JSON.test(c.req.header("Content-Type") ?? ""))
    return {
      ok: false,
      resposta: responderErro(
        c,
        "json_invalido",
        "Envie o corpo em JSON, com o cabeçalho Content-Type: application/json",
      ),
    };
  const texto = await lerCorpoDaConferencia(
    c.req.raw,
    LIMITE_CORPO_CONFERENCIA_BYTES,
  );
  if (texto === null)
    return {
      ok: false,
      resposta: respostaCorpoMuitoGrande(LIMITE_CORPO_CONFERENCIA_BYTES)(c),
    };
  let valor: unknown;
  try {
    valor = JSON.parse(texto);
  } catch {
    return {
      ok: false,
      resposta: responderErro(c, "json_invalido", MENSAGEM_JSON_INVALIDO),
    };
  }
  const validacao = validar(valor);
  if (!validacao.ok)
    return {
      ok: false,
      resposta: responderErro(
        c,
        "requisicao_invalida",
        "Dados inválidos",
        detalhesDoCorpo(validacao.problemas, validacao.total),
      ),
    };
  const pessoais: DetalheValidacao[] = CAMPOS_RECONCILIACAO.flatMap((campo) => {
    const nome = validacao.corpo.colunas[campo];
    return nome !== null && ehNomeDeColunaPessoal(nome)
      ? [
          {
            caminho: ["colunas", campo],
            codigo: "coluna_pessoal",
            mensagem: `A coluna "${nome}" tem dados pessoais e não pode ser usada`,
          },
        ]
      : [];
  });
  if (pessoais.length > 0)
    return {
      ok: false,
      resposta: responderErro(
        c,
        "requisicao_invalida",
        "Uma coluna com dados pessoais não pode ser usada na conferência",
        pessoais,
      ),
    };
  return { ok: true, corpo: validacao.corpo };
}

const SEM_CAMPANHA =
  "A campanha ainda não foi configurada: configure-a antes de conferir";

/** Mensagem do log de erro: a de banco (D1_…) ajuda e não tem valores; outra poderia citar o corpo. */
function mensagemParaLog(erro: Error): string {
  return erro.message.startsWith("D1_")
    ? erro.message.slice(0, 300)
    : "(mensagem omitida: pode citar o corpo)";
}

const formatadoresDeDeslocamento = new Map<string, Intl.DateTimeFormat>();
const SINAL_MENOS = String.fromCharCode(0x2212);

/**
 * Modificador do date() do SQLite para o dia local de um instante ("-180 minutes" em Belém). É o
 * deslocamento do fuso no fim do período do arquivo: exato em fusos sem horário de verão (os do Brasil);
 * num fuso com horário de verão, uma venda perto da meia-noite de antes da troca pode cair no dia vizinho
 * na tabela por dia (o total e o por afiliado não mudam). Sem o deslocamento no Intl, UTC.
 */
export function modificadorDoDia(fuso: string, instante: number): string {
  let formatador = formatadoresDeDeslocamento.get(fuso);
  if (!formatador) {
    formatador = new Intl.DateTimeFormat("en-US", {
      timeZone: fuso,
      timeZoneName: "longOffset",
    });
    formatadoresDeDeslocamento.set(fuso, formatador);
  }
  const nome =
    formatador
      .formatToParts(instante)
      .find((parte) => parte.type === "timeZoneName")?.value ?? "";
  const partes = /^GMT(?:([+-])(\d{2}):(\d{2}))?$/.exec(
    nome.replace(SINAL_MENOS, "-"),
  );
  if (!partes || partes[1] === undefined) return "+0 minutes";
  const minutos = Number(partes[2]) * 60 + Number(partes[3]);
  return `${partes[1]}${minutos} minutes`;
}

/** O sub-app com o relógio dado (os testes fixam o instante; em produção, o do sistema). */
export function criarReconciliacao(relogio: Relogio = relogioDoSistema) {
  const reconciliacao = new Hono<AmbienteSessao>();

  /** A campanha ativa no que a conferência usa, ou a resposta 404. */
  async function campanhaAtiva(
    c: Context<AmbienteSessao>,
  ): Promise<CampanhaDaConferencia | Response> {
    const campanha = await buscarCampanhaAtiva(c.env.DB);
    if (!campanha) return responderErro(c, "nao_encontrado", SEM_CAMPANHA);
    return {
      id: campanha.id,
      fuso: campanha.fuso_horario,
      preco: campanha.preco_bilhete_centavos,
    };
  }

  reconciliacao.post(local(ROTAS.analisarReconciliacao.caminho), async (c) => {
    const lido = await lerCorpo(c, (valor) => validarCorpoConferencia(valor));
    if (!lido.ok) return lido.resposta;
    const corpo = lido.corpo;
    const campanha = await campanhaAtiva(c);
    if (campanha instanceof Response) return campanha;
    const db = c.env.DB;
    const agora = relogio();
    const periodo = periodoDoArquivo(corpo, campanha.fuso);

    if (corpo.colunas.pedido_id === null) {
      const fimDoPeriodo =
        periodo === null ? agora.getTime() : Date.parse(periodo.utc.fim) - 1;
      const sistema = await lerParaAgregado(db, {
        campanhaId: campanha.id,
        periodoUtc: periodo?.utc ?? null,
        deslocamento:
          corpo.colunas.data === null
            ? null
            : modificadorDoDia(campanha.fuso, fimDoPeriodo),
      });
      return c.json(analisarAgregado({ corpo, sistema, periodo, agora }));
    }

    const agrupamento = agruparPedidos(corpo);
    const leitura = await lerParaPorPedido(db, {
      campanhaId: campanha.id,
      codigos: [...agrupamento.pedidos.keys()],
      periodoUtc: periodo?.utc ?? null,
      comAusentes: true,
    });
    return c.json(
      analisarPorPedido({
        corpo,
        agrupamento,
        sistema: { campanha, ...leitura },
        periodo,
        calendario: new Calendario(campanha.fuso, agora),
      }),
    );
  });

  reconciliacao.post(local(ROTAS.recuperarReconciliacao.caminho), async (c) => {
    const lido = await lerCorpo(c, (valor) => validarCorpoRecuperacao(valor));
    if (!lido.ok) return lido.resposta;
    const corpo = lido.corpo;
    const { pedidos: codigos, simular } = corpo;
    const campanha = await campanhaAtiva(c);
    if (campanha instanceof Response) return campanha;
    const db = c.env.DB;
    const agora = relogio();
    const periodo = periodoDoArquivo(corpo, campanha.fuso);
    const agrupamento = agruparPedidos(corpo);
    const leitura = await lerParaPorPedido(db, {
      campanhaId: campanha.id,
      codigos: [...agrupamento.pedidos.keys()],
      periodoUtc: periodo?.utc ?? null,
      comAusentes: false,
    });
    const sistema = { campanha, ...leitura };
    const { convencao, codigo } = decidir(agrupamento, sistema, periodo);
    // A mesma trava da análise: com a coluna errada como código, nada é gravado.
    if (!codigo.confere)
      return responderErro(
        c,
        "requisicao_invalida",
        "A coluna escolhida como código do pedido não parece ser o código da Rifei: troque a coluna e confira de novo antes de recuperar",
        [
          {
            caminho: ["colunas", "pedido_id"],
            codigo: "codigo_nao_confere",
            mensagem: `Só ${codigo.encontrados} de ${codigo.pagos_no_arquivo} pedidos pagos do arquivo existem no sistema`,
          },
        ] satisfies DetalheValidacao[],
      );

    const plano = planejarRecuperacao(
      {
        corpo,
        agrupamento,
        sistema,
        convencao,
        calendario: new Calendario(campanha.fuso, agora),
      },
      codigos,
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
        linhasArquivo: corpo.linhas,
        arquivoSha256: corpo.arquivo_sha256,
        colunas: corpo.colunas,
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

    const resposta: RespostaRecuperarReconciliacao = {
      simulado: simular,
      aplicado: !simular && gravados.length > 0,
      recuperacao_id: recuperacaoId,
      recuperados: gravados,
      nao_recuperados: naoRecuperados,
      totais: {
        pedidos_aprovados: gravados.length,
        bilhetes: gravados.reduce(
          (soma, pedido) => soma + pedido.qtd_bilhetes,
          0,
        ),
        total_centavos: gravados.reduce(
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
