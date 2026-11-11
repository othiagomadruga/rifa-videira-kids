// Apoio aos testes da conferência pelo CSV da Rifei (RIFA-012): CSVs fictícios em várias formas, o
// cenário gravado no D1 dos testes (a hierarquia, a campanha e os afiliados do painel-apoio, mais os
// pedidos daqui) e o app de teste (conferência + painel, com o relógio fixo e a pessoa conectada).
//
// Todos os dados pessoais são FICTÍCIOS e ficam em DADOS_PESSOAIS: os testes varrem respostas, banco e
// log atrás de qualquer um deles (nenhum pode aparecer).
import { env } from "cloudflare:workers";
import { Hono } from "hono";
import type {
  AvisoReconciliacao,
  CorpoConferencia,
  MapeamentoReconciliacao,
  UsuarioSessao,
} from "../../shared/contracts";
import {
  lerArquivoConferencia,
  montarCorpo,
  type ArquivoConferencia,
} from "../../shared/conferencia/leitura";
import { sha256Hex } from "../lib/cripto";
import { erroNaoTratado, rotaInexistente } from "../lib/respostas-erro";
import type { AmbienteSessao } from "../middleware/sessao";
import { PREFIXO_PAINEL, criarPainel } from "../routes/painel";
import {
  PREFIXO_RECONCILIACAO,
  criarReconciliacao,
} from "../routes/reconciliacao";
import { semearCenario, type PedidoTeste } from "./painel-apoio";

/** "Agora" dos testes: 01/12/2026 12:00 em Belém (dia 9 da campanha do painel-apoio). */
export const AGORA_CONFERENCIA = new Date("2026-12-01T15:00:00.000Z");

export {
  CABECALHO_DO_CENARIO,
  DADOS_PESSOAIS,
  LINHAS_DO_CENARIO,
  MAPEAMENTO_DO_CENARIO,
  TEXTOS_PESSOAIS,
  csvDoCenario,
  montarCsv,
  textosPessoaisEm,
  type LinhaRifei,
  type OpcoesCsv,
} from "../../shared/conferencia/teste-csv";

/** Fuso da campanha do painel-apoio. */
export const FUSO_DOS_TESTES = "America/Belem";

export interface CorpoDoArquivo {
  corpo: CorpoConferencia;
  /** Os avisos da leitura (os que a tela monta). */
  avisos: AvisoReconciliacao[];
  arquivo: ArquivoConferencia;
}

/**
 * O que o NAVEGADOR manda à API para um CSV: a mesma leitura da tela (src/shared/conferencia), com o
 * mapeamento detectado ou o dado, e o SHA-256 do texto sem o BOM.
 */
export async function corpoDe(
  csv: string,
  mapeamento?: MapeamentoReconciliacao,
  fuso = FUSO_DOS_TESTES,
): Promise<CorpoDoArquivo> {
  const texto = csv.startsWith("\uFEFF") ? csv.slice(1) : csv;
  const arquivo = lerArquivoConferencia(texto);
  if (!arquivo.ok) throw new Error(`arquivo recusado: ${arquivo.motivo}`);
  const montagem = montarCorpo(
    arquivo,
    mapeamento ?? arquivo.mapeamentoDetectado,
    {
      fuso,
      arquivoSha256: await sha256Hex(texto),
    },
  );
  if (!montagem.ok)
    throw new Error(
      `mapeamento recusado: ${JSON.stringify(montagem.problemas)}`,
    );
  return { corpo: montagem.corpo, avisos: montagem.avisos, arquivo };
}

// ---------------------------------------------------------------------------------------------------
// Banco
// ---------------------------------------------------------------------------------------------------

/** 12:00 de Belém (15:00Z) de um dia de novembro de 2026. */
const meioDiaDe = (dia: number) =>
  `2026-11-${String(dia).padStart(2, "0")}T15:00:00.000Z`;

/** Os pedidos gravados do cenário (afiliados 101..105 vinculados às células 1..5; 900 sem célula). */
export const PEDIDOS_DO_CENARIO: PedidoTeste[] = [
  {
    id: "R-0001",
    affiliate_id: 101,
    status: "approved",
    aprovado_em: meioDiaDe(24),
    qtd_bilhetes: 3,
    total_centavos: 6000,
  },
  {
    id: "R-0002",
    affiliate_id: 102,
    status: "approved",
    aprovado_em: meioDiaDe(25),
    qtd_bilhetes: 2,
    total_centavos: 4000,
  },
  {
    id: "R-0003",
    affiliate_id: 103,
    status: "approved",
    aprovado_em: "2026-11-25T16:00:00.000Z",
    qtd_bilhetes: 4,
    total_centavos: 8000,
  },
  {
    id: "R-0004",
    affiliate_id: 104,
    status: "approved",
    aprovado_em: "2026-11-26T12:30:00.000Z",
    qtd_bilhetes: 1,
    total_centavos: 2000,
  },
  {
    id: "R-0005",
    affiliate_id: 101,
    status: "in_process",
    aprovado_em: null,
    qtd_bilhetes: 2,
    total_centavos: 4000,
  },
  {
    id: "R-0006",
    affiliate_id: 105,
    status: "approved",
    aprovado_em: "2026-11-27T11:00:00.000Z",
    qtd_bilhetes: 2,
    total_centavos: 4000,
  },
  // Compra de teste na reunião de cadastro (antes do arquivo): ausente no arquivo, fora do período dele.
  {
    id: "R-0007",
    affiliate_id: null,
    status: "approved",
    aprovado_em: meioDiaDe(20),
    qtd_bilhetes: 1,
    total_centavos: 2000,
  },
  {
    id: "R-0008",
    affiliate_id: 101,
    status: "approved",
    aprovado_em: meioDiaDe(26),
    qtd_bilhetes: 2,
    total_centavos: 4000,
  },
  {
    id: "R-0009",
    affiliate_id: 103,
    status: "expired",
    aprovado_em: null,
    qtd_bilhetes: 1,
    total_centavos: 2000,
  },
  {
    id: "R-OUTRA",
    affiliate_id: 101,
    status: "approved",
    aprovado_em: meioDiaDe(27),
    qtd_bilhetes: 1,
    total_centavos: 2000,
    campanha: "outra",
  },
];

/** Apaga o que a conferência grava e semeia o cenário (o afiliado 102 com o rótulo "lider.betel"). */
export async function semearConferencia(
  pedidos: readonly PedidoTeste[] = PEDIDOS_DO_CENARIO,
): Promise<{ campanhaId: number }> {
  const db = env.DB;
  // pedidos referenciam recuperacoes, e recuperacoes, a campanha: apaga nessa ordem antes do cenário (e a
  // trilha de auditoria, para cada teste contar só as linhas dele).
  await db.batch([
    db.prepare("DELETE FROM webhook_eventos"),
    db.prepare("DELETE FROM pedidos"),
    db.prepare("DELETE FROM recuperacoes"),
    db.prepare("DELETE FROM auditoria"),
  ]);
  const cenario = await semearCenario({ pedidos });
  await db
    .prepare(
      "UPDATE afiliados SET rotulo = 'lider.betel' WHERE affiliate_id = 102",
    )
    .run();
  return cenario;
}

/** Pessoa conectada dos testes (gravada em usuarios: a auditoria referencia o id). */
export async function criarPessoaDaCoordenacao(
  nome = "Coordenadora Ficticia da Conferencia",
): Promise<UsuarioSessao> {
  const linha = await env.DB.prepare(
    "INSERT INTO usuarios (nome, papel) VALUES (?1, 'coordenacao') RETURNING id",
  )
    .bind(nome)
    .first<{ id: number }>();
  if (!linha) throw new Error("não foi possível criar a pessoa de teste");
  return { id: linha.id, nome, papel: "coordenacao" };
}

// ---------------------------------------------------------------------------------------------------
// App de teste
// ---------------------------------------------------------------------------------------------------

/**
 * A conferência e o painel montados como no index.ts (sem o login, que vem antes deles e é provado em
 * protecao.test.ts), com a pessoa conectada já em `c.var.usuario` e o relógio dado.
 */
export function criarAppDaConferencia(
  usuario: () => UsuarioSessao,
  relogio: () => Date = () => AGORA_CONFERENCIA,
) {
  const app = new Hono<AmbienteSessao>();
  app.use("*", async (c, next) => {
    c.set("usuario", usuario());
    await next();
  });
  app.route(PREFIXO_RECONCILIACAO, criarReconciliacao(relogio));
  app.route(PREFIXO_PAINEL, criarPainel(relogio));
  app.notFound(rotaInexistente);
  app.onError(erroNaoTratado);
  return app;
}

export type AppDaConferencia = ReturnType<typeof criarAppDaConferencia>;

export interface RespostaDeTeste {
  status: number;
  texto: string;
  corpo: unknown;
}

/**
 * POST com corpo JSON (ou texto cru) no app de teste, com o Content-Length como o navegador manda (sem
 * `comTamanho`, vai sem ele, como num envio em partes).
 */
export async function postar(
  app: AppDaConferencia,
  caminho: string,
  corpo: unknown,
  cabecalhos: Record<string, string> = { "Content-Type": "application/json" },
  comTamanho = true,
): Promise<RespostaDeTeste> {
  const texto = typeof corpo === "string" ? corpo : JSON.stringify(corpo);
  const res = await app.request(
    caminho,
    {
      method: "POST",
      headers: comTamanho
        ? {
            ...cabecalhos,
            "Content-Length": String(new TextEncoder().encode(texto).length),
          }
        : cabecalhos,
      body: texto,
    },
    env,
  );
  const resposta = await res.text();
  return {
    status: res.status,
    texto: resposta,
    corpo: JSON.parse(resposta) as unknown,
  };
}

export async function obter(
  app: AppDaConferencia,
  caminho: string,
): Promise<RespostaDeTeste> {
  const res = await app.request(caminho, {}, env);
  const texto = await res.text();
  return { status: res.status, texto, corpo: JSON.parse(texto) as unknown };
}
