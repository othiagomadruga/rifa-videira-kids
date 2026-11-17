// GET /api/painel/relatorio (RIFA-038; docs/decisions.md D23) com o D1 dos testes e o relógio fixo, do banco ao
// arquivo. Um bloco por critério de aceite:
// CA1 os 7 tipos com as colunas do contrato nas duas unidades da meta, e o CSV byte a byte (BOM, ";", vírgula, CRLF);
// CA2 as contas fecham entre os arquivos; CA3 o desconsiderado não aparece em nenhum tipo e entra na contagem;
// CA4 nada pessoal; CA5 proteção contra fórmula; CA6 login por papel, erros e cabeçalhos.
// As linhas de cada tipo, sem banco: lib/relatorio.test.ts. O orçamento do D1: relatorio-desempenho.test.ts.
import { env, exports } from "cloudflare:workers";
import { Hono } from "hono";
import { afterEach, beforeAll, describe, expect, it } from "vitest";
import {
  COLUNAS_RELATORIO,
  PAPEIS_HIERARQUIA,
  TIPOS_RELATORIO,
  cabecalhoDoRelatorio,
  campanhaEntradaSchema,
  erroApiSchema,
  hojeNoFuso,
  pareceFormulaNoCsv,
  type CodigoErro,
  type TipoRelatorio,
  type UnidadeMeta,
} from "../../shared/contracts";
import { lerCsv } from "../../shared/csv";
import { CONTAR_DESCONSIDERADOS, SELECIONAR_LIDERES } from "../db/relatorio";
import { erroNaoTratado, rotaInexistente } from "../lib/respostas-erro";
import {
  ORIGEM,
  cabecalhosDeSessao,
  cabecalhosDeSessaoDaHierarquia,
} from "../test/acesso-teste";
import {
  AGORA,
  DADOS_CAMPANHA,
  DADOS_CAMPANHA_RANKING_UNICO,
  PEDIDOS,
  aprovado,
  desconsiderado,
  dia,
  limparBanco,
  semearCenario,
  semearPedidos,
  type PedidoTeste,
} from "../test/painel-apoio";
import { textoDoCsv } from "../test/relatorio-apoio";
import { PREFIXO_PAINEL, criarPainel } from "./painel";

let agora = AGORA;

// O sub-app como o index.ts monta (sem o login, que vem antes dele; CA6 usa o app real), com o relógio dos testes.
const app = new Hono<{ Bindings: Cloudflare.Env }>();
app.route(
  PREFIXO_PAINEL,
  criarPainel(() => agora),
);
app.notFound(rotaInexistente);
app.onError(erroNaoTratado);

afterEach(() => {
  agora = AGORA;
});

/** 200 com os cabeçalhos do contrato; o texto do CSV com o BOM (conferido nos bytes). */
async function baixar(tipo: TipoRelatorio): Promise<string> {
  const res = await app.request(`/api/painel/relatorio?tipo=${tipo}`, {}, env);
  expect({ tipo, status: res.status }).toEqual({ tipo, status: 200 });
  expect(res.headers.get("Content-Type")).toBe("text/csv; charset=utf-8");
  expect(res.headers.get("Cache-Control")).toBe("no-store");
  expect(res.headers.get("Content-Disposition")).toMatch(
    new RegExp(
      `^attachment; filename="rifa-videira-kids-${tipo}-\\d{4}-\\d{2}-\\d{2}\\.csv"$`,
    ),
  );
  return textoDoCsv(res);
}

async function baixarTodos(): Promise<Record<TipoRelatorio, string>> {
  const arquivos: Partial<Record<TipoRelatorio, string>> = {};
  for (const tipo of TIPOS_RELATORIO) arquivos[tipo] = await baixar(tipo);
  return arquivos as Record<TipoRelatorio, string>;
}

/** Lê o arquivo com o leitor de CSV do projeto: `;`, e toda linha com uma célula por coluna do cabeçalho. */
function lerArquivo(csv: string): string[][] {
  const leitura = lerCsv(csv);
  if (!leitura.ok) throw new Error(leitura.mensagem);
  expect(leitura.separador).toBe(";");
  const [cabecalho, ...linhas] = leitura.registros.map((r) => r.campos);
  for (const linha of linhas) expect(linha).toHaveLength(cabecalho.length);
  return [cabecalho, ...linhas];
}

type Coluna<T extends TipoRelatorio> = (typeof COLUNAS_RELATORIO)[T][number];

/** As linhas de dados de um tipo como registros pelas chaves das colunas do contrato. */
function registros<T extends TipoRelatorio>(
  tipo: T,
  csv: string,
): Record<Coluna<T>, string>[] {
  const [, ...linhas] = lerArquivo(csv);
  const colunas = COLUNAS_RELATORIO[tipo] as readonly Coluna<T>[];
  return linhas.map(
    (linha) =>
      Object.fromEntries(
        colunas.map((coluna, indice) => [coluna, linha[indice]]),
      ) as Record<Coluna<T>, string>,
  );
}

const inteiro = (texto: string): number => {
  expect(texto).toMatch(/^\d+$/);
  return Number(texto);
};
const centavos = (texto: string): number => {
  expect(texto).toMatch(/^\d+,\d{2}$/);
  return Number(texto.replace(",", ""));
};

interface Totais {
  pedidos: number;
  bilhetes: number;
  centavos: number;
}
const ZERO: Totais = { pedidos: 0, bilhetes: 0, centavos: 0 };
const somar = (lista: readonly Totais[]): Totais =>
  lista.reduce(
    (soma, item) => ({
      pedidos: soma.pedidos + item.pedidos,
      bilhetes: soma.bilhetes + item.bilhetes,
      centavos: soma.centavos + item.centavos,
    }),
    ZERO,
  );
/** Pedidos aprovados, bilhetes e arrecadação de uma linha. */
const vendas = (linha: {
  pedidos: string;
  bilhetes: string;
  arrecadacao: string;
}): Totais => ({
  pedidos: inteiro(linha.pedidos),
  bilhetes: inteiro(linha.bilhetes),
  centavos: centavos(linha.arrecadacao),
});

/** País e DDD de cada afiliado do cenário: Ágape e Canaã no 91 (PA), Betel no 11 (SP), Dorcas no 61 (DF), Éfeso no exterior. */
const TELEFONE_DO_AFILIADO: Record<number, [string, string | null]> = {
  101: ["55", "91"],
  102: ["55", "11"],
  103: ["55", "91"],
  104: ["55", "61"],
  105: ["351", null],
};

/** O cenário do painel com o telefone (país e DDD) de cada comprador; as vendas sem célula, sem telefone. */
const PEDIDOS_COM_TELEFONE: PedidoTeste[] = PEDIDOS.map((pedido) => {
  const telefone =
    pedido.affiliate_id === null
      ? undefined
      : TELEFONE_DO_AFILIADO[pedido.affiliate_id];
  return telefone === undefined
    ? pedido
    : { ...pedido, pais: telefone[0], ddd: telefone[1] };
});

/** 12:00 em Belém do dia `n` da campanha. */
const meioDia = (n: number) => `${dia(n)}T15:00:00.000Z`;

/** A campanha do cenário com a meta em R$ (R$ 200,00 por pessoa). */
const CAMPANHA_EM_REAIS = campanhaEntradaSchema.parse({
  ...DADOS_CAMPANHA,
  meta: { unidade: "centavos", regra: "por_pessoa", valor: 20000 },
});

// ---------------------------------------------------------------------------------------------------
// CA1: os 7 tipos e o arquivo
// ---------------------------------------------------------------------------------------------------

describe("CA1: os 7 tipos com as colunas do contrato, nas duas unidades da meta, e o CSV byte a byte", () => {
  it.each(["bilhetes", "centavos"] as const)(
    "meta em %s: cada tipo com o cabeçalho do contrato, BOM, `;`, CRLF em toda linha, e números só com dígitos e vírgula",
    async (unidade: UnidadeMeta) => {
      await semearCenario({
        pedidos: PEDIDOS_COM_TELEFONE,
        campanha: unidade === "bilhetes" ? DADOS_CAMPANHA : CAMPANHA_EM_REAIS,
      });
      for (const tipo of TIPOS_RELATORIO) {
        const csv = await baixar(tipo);
        expect(csv.startsWith("﻿")).toBe(true);
        const semBom = csv.slice(1);
        expect({ tipo, cabecalho: semBom.split("\r\n")[0] }).toEqual({
          tipo,
          cabecalho: cabecalhoDoRelatorio(tipo, unidade).join(";"),
        });
        // CRLF no fim de toda linha, também da última; nenhuma quebra solta.
        expect(semBom.endsWith("\r\n")).toBe(true);
        expect(semBom.replace(/\r\n/g, "")).not.toMatch(/[\r\n]/);
        const linhas = registros(tipo, csv);
        expect(linhas.length).toBeGreaterThan(0);
        for (const linha of linhas) {
          const valores = linha as Record<string, string>;
          for (const coluna of ["pedidos", "bilhetes", "posicao_divisao"])
            if (coluna in valores) expect(valores[coluna]).toMatch(/^\d+$/);
          for (const coluna of [
            "arrecadacao",
            "percentual_meta",
            "parte_bilhetes",
          ])
            if (coluna in valores)
              expect(valores[coluna]).toMatch(/^(\d+,\d{2})?$/);
          if ("meta" in valores)
            expect(valores.meta).toMatch(
              unidade === "bilhetes" ? /^\d+$/ : /^\d+,\d{2}$/,
            );
        }
      }
    },
  );

  it("do banco ao arquivo, byte a byte: totais, células e DDD no dia 9 (01/12/2026)", async () => {
    await semearCenario({ pedidos: PEDIDOS_COM_TELEFONE });
    const res = await app.request("/api/painel/relatorio?tipo=totais", {}, env);
    const bytes = new Uint8Array(await res.clone().arrayBuffer());
    expect([...bytes.subarray(0, 4)]).toEqual([0xef, 0xbb, 0xbf, 0x43]); // BOM + "C"
    expect(await textoDoCsv(res)).toBe(
      "﻿" +
        "Campanha;Data de referência;Situação da campanha;Início;Fim;Meta (bilhetes);Pedidos aprovados;Bilhetes;" +
        "Arrecadação (R$);% da meta;Pedidos sem célula;Bilhetes sem célula;Arrecadação sem célula (R$);" +
        "Pedidos fora das datas da campanha;Bilhetes fora das datas da campanha;" +
        "Arrecadação fora das datas da campanha (R$);Pedidos desconsiderados;Critério do ranking\r\n" +
        "Rifa Videira Kids;2026-12-01;Em andamento;2026-11-23;2026-12-13;600;25;149;2964,00;24,83;3;7;140,00;2;3;" +
        "60,00;0;% da meta\r\n",
    );
    expect(await baixar("celulas")).toBe(
      "﻿" +
        "Divisão;Rede;Discipulador;Célula;Líder;Meta (bilhetes);Pedidos aprovados;Bilhetes;Arrecadação (R$);% da meta;" +
        "Posição na divisão\r\n" +
        "Jovens;Rede Jovem Ficticia;Discipulador Abel;Célula Ágape;Líder da Célula Ágape;120;9;48;960,00;40,00;1\r\n" +
        "Jovens;Rede Jovem Ficticia;Discipulador Abel;Célula Betel;Líder da Célula Betel;60;4;18;360,00;30,00;2\r\n" +
        "Jovens;Rede Jovem Ficticia;Discipulador Boaz;Célula Canaã;Líder da Célula Canaã;120;3;24;480,00;20,00;3\r\n" +
        "Adultos;Rede Adulta Ficticia;Discipulador Caleb;Célula Dorcas;Líder da Célula Dorcas;200;5;47;924,00;23,50;1\r\n" +
        "Adultos;Rede Adulta Ficticia;Discipulador Caleb;Célula Éfeso;Líder da Célula Éfeso;100;1;5;100,00;5,00;2\r\n",
    );
    // PA (Ágape + Canaã: 72 bilhetes), DF (47), SP (18); o exterior é a Éfeso; sem DDD, as 3 vendas sem célula.
    // As partes são truncadas: 72/149 = 48,32%; 47/149 = 31,54%; 18/149 = 12,08%; 5/149 = 3,35%; 7/149 = 4,69%.
    expect(await baixar("ddd")).toBe(
      "﻿" +
        "UF;DDD;Pedidos aprovados;Bilhetes;Arrecadação (R$);% dos bilhetes\r\n" +
        "PA;91;12;72;1440,00;48,32\r\n" +
        "DF;61;5;47;924,00;31,54\r\n" +
        "SP;11;4;18;360,00;12,08\r\n" +
        "Exterior;;1;5;100,00;3,35\r\n" +
        "Sem DDD;;3;7;140,00;4,69\r\n",
    );
  });

  it("meta em R$: Meta (R$) e a meta de cada célula em reais, com vírgula e 2 casas", async () => {
    await semearCenario({ campanha: CAMPANHA_EM_REAIS });
    const [cabecalho, agape] = lerArquivo(await baixar("celulas"));
    expect(cabecalho[5]).toBe("Meta (R$)");
    // Ágape: 12 pessoas × R$ 200,00; R$ 960,00 ÷ R$ 2.400,00 = 40%.
    expect(agape).toEqual([
      "Jovens",
      "Rede Jovem Ficticia",
      "Discipulador Abel",
      "Célula Ágape",
      "Líder da Célula Ágape",
      "2400,00",
      "9",
      "48",
      "960,00",
      "40,00",
      "1",
    ]);
  });
});

// ---------------------------------------------------------------------------------------------------
// CA2: as contas fecham entre os arquivos
// ---------------------------------------------------------------------------------------------------

/** As somas que a D23 exige, conferidas nos arquivos lidos de volta. */
function conferirContas(arquivos: Record<TipoRelatorio, string>): Totais {
  const [linhaTotais] = registros("totais", arquivos.totais);
  const totais = vendas(linhaTotais);
  const semCelula: Totais = {
    pedidos: inteiro(linhaTotais.pedidos_sem_celula),
    bilhetes: inteiro(linhaTotais.bilhetes_sem_celula),
    centavos: centavos(linhaTotais.arrecadacao_sem_celula),
  };
  const celulas = registros("celulas", arquivos.celulas);
  const somaCelulas = somar(celulas.map(vendas));

  // Períodos = dias = totais.
  expect(somar(registros("periodos", arquivos.periodos).map(vendas))).toEqual(
    totais,
  );
  expect(somar(registros("dias", arquivos.dias).map(vendas))).toEqual(totais);
  // Células + sem célula = totais.
  expect(somar([somaCelulas, semCelula])).toEqual(totais);
  // Cada discipulador e cada rede = a soma das células dele; e os três níveis somam o mesmo.
  const discipuladores = registros("discipuladores", arquivos.discipuladores);
  for (const linha of discipuladores)
    expect({ discipulador: linha.discipulador, ...vendas(linha) }).toEqual({
      discipulador: linha.discipulador,
      ...somar(
        celulas
          .filter(
            (celula) =>
              celula.discipulador === linha.discipulador &&
              celula.rede === linha.rede &&
              celula.divisao === linha.divisao,
          )
          .map(vendas),
      ),
    });
  const redes = registros("redes", arquivos.redes);
  for (const linha of redes)
    expect({ rede: linha.rede, ...vendas(linha) }).toEqual({
      rede: linha.rede,
      ...somar(
        celulas
          .filter(
            (celula) =>
              celula.rede === linha.rede && celula.divisao === linha.divisao,
          )
          .map(vendas),
      ),
    });
  expect(somar(discipuladores.map(vendas))).toEqual(somaCelulas);
  expect(somar(redes.map(vendas))).toEqual(somaCelulas);
  // DDD (com Exterior e Sem DDD) = totais.
  expect(somar(registros("ddd", arquivos.ddd).map(vendas))).toEqual(totais);
  return totais;
}

describe("RIFA-061 (D27): sem ranking por divisão, o relatório segue o ranking de todos", () => {
  beforeAll(async () => {
    await semearCenario({
      pedidos: PEDIDOS_COM_TELEFONE,
      campanha: DADOS_CAMPANHA_RANKING_UNICO,
    });
  });

  it('células: uma lista só, na ordem do ranking de todas, com "Posição no ranking" (a coluna Divisão continua)', async () => {
    expect(await baixar("celulas")).toBe(
      "﻿" +
        "Divisão;Rede;Discipulador;Célula;Líder;Meta (bilhetes);Pedidos aprovados;Bilhetes;Arrecadação (R$);% da meta;" +
        "Posição no ranking\r\n" +
        "Jovens;Rede Jovem Ficticia;Discipulador Abel;Célula Ágape;Líder da Célula Ágape;120;9;48;960,00;40,00;1\r\n" +
        "Jovens;Rede Jovem Ficticia;Discipulador Abel;Célula Betel;Líder da Célula Betel;60;4;18;360,00;30,00;2\r\n" +
        "Adultos;Rede Adulta Ficticia;Discipulador Caleb;Célula Dorcas;Líder da Célula Dorcas;200;5;47;924,00;23,50;3\r\n" +
        "Jovens;Rede Jovem Ficticia;Discipulador Boaz;Célula Canaã;Líder da Célula Canaã;120;3;24;480,00;20,00;4\r\n" +
        "Adultos;Rede Adulta Ficticia;Discipulador Caleb;Célula Éfeso;Líder da Célula Éfeso;100;1;5;100,00;5,00;5\r\n",
    );
  });

  it("todos os tipos com o cabeçalho do contrato para a opção desligada; discipuladores e redes numa lista só", async () => {
    for (const tipo of TIPOS_RELATORIO) {
      const csv = await baixar(tipo);
      expect({ tipo, cabecalho: csv.slice(1).split("\r\n")[0] }).toEqual({
        tipo,
        cabecalho: cabecalhoDoRelatorio(tipo, "bilhetes", false).join(";"),
      });
    }
    for (const tipo of ["discipuladores", "redes"] as const) {
      const posicoes = registros(tipo, await baixar(tipo)).map((linha) =>
        Number((linha as Record<string, string>).posicao_divisao),
      );
      expect(posicoes).toEqual([...posicoes].sort((a, b) => a - b));
      expect(posicoes[0]).toBe(1);
    }
  });

  it("as contas continuam fechando entre os arquivos", async () => {
    expect(conferirContas(await baixarTodos())).toEqual({
      pedidos: 25,
      bilhetes: 149,
      centavos: 296400,
    });
  });
});

describe("CA2: as contas fecham entre os arquivos (cenário do painel com telefones)", () => {
  beforeAll(async () => {
    await semearCenario({ pedidos: PEDIDOS_COM_TELEFONE });
  });

  it.each([
    ["véspera (antes do início)", "2026-11-22T15:00:00.000Z", ZERO],
    [
      "1º dia",
      "2026-11-23T15:00:00.000Z",
      { pedidos: 3, bilhetes: 29, centavos: 58000 },
    ],
    [
      "dia 9 (o agora dos testes)",
      AGORA.toISOString(),
      { pedidos: 25, bilhetes: 149, centavos: 296400 },
    ],
    [
      "dia 15 (Semana 3)",
      "2026-12-07T15:00:00.000Z",
      { pedidos: 26, bilhetes: 159, centavos: 316400 },
    ],
    [
      "depois do fim",
      "2026-12-20T15:00:00.000Z",
      { pedidos: 28, bilhetes: 171, centavos: 340400 },
    ],
  ] as const)(
    "%s: períodos = dias = totais; células + sem célula = totais; discipuladores = redes = células; DDD = totais",
    async (_quando, instante, esperado) => {
      agora = new Date(instante);
      expect(conferirContas(await baixarTodos())).toEqual(esperado);
    },
  );
});

describe("CA2: as contas fecham também nas bordas (revisão), em Belém e num fuso de outro deslocamento", () => {
  // Uma célula sem afiliado e sem venda (no Discipulador Davi, que não tinha célula: ele e ela passam a aparecer
  // zerados); vendas sem célula antes do início, na Semana 3 e depois do fim; Brasil sem DDD e com DDD fora da
  // tabela; uma venda mais tarde no dia de hoje (depois do "agora") e outra no dia seguinte (relógio adiantado).
  const BORDAS: PedidoTeste[] = [
    { ...aprovado(null, "2026-11-21T15:00:00.000Z", 2), pais: "55", ddd: "91" },
    { ...aprovado(900, meioDia(16), 3), pais: "55", ddd: "23" },
    { ...aprovado(null, "2026-12-15T15:00:00.000Z", 4), pais: "55", ddd: null },
    { ...aprovado(103, `${dia(9)}T23:00:00.000Z`, 5), pais: "55", ddd: "94" },
    { ...aprovado(104, meioDia(10), 6), pais: "1", ddd: null },
  ];

  /** Os aprovados que contam na campanha ativa, direto do banco (sem as leituras do painel e do mapa). */
  async function noBanco(): Promise<Totais> {
    const linha = await env.DB.prepare(
      `SELECT count(*) AS pedidos, sum(qtd_bilhetes) AS bilhetes, sum(total_centavos) AS centavos
       FROM pedidos JOIN campanhas AS c ON c.id = pedidos.campanha_id
       WHERE c.ativa = 1 AND status = 'approved' AND desconsiderado_em IS NULL`,
    ).first<Totais>();
    return linha!;
  }

  it.each(["America/Belem", "America/Manaus"])(
    "%s: véspera, dia 9, dia 16 e depois do fim; depois do fim, totais + fora das datas = o banco",
    async (fuso) => {
      await semearCenario({
        pedidos: [...PEDIDOS_COM_TELEFONE, ...BORDAS],
        campanha: campanhaEntradaSchema.parse({
          ...DADOS_CAMPANHA,
          fuso_horario: fuso,
        }),
      });
      await env.DB.prepare(
        `INSERT INTO celulas (id, discipulador_id, nome, qtd_pessoas, lider_nome)
         VALUES (6, 40, 'Célula Filadélfia', 8, 'Líder da Célula Filadélfia')`,
      ).run();
      for (const instante of [
        "2026-11-22T15:00:00.000Z",
        AGORA.toISOString(),
        "2026-12-08T15:00:00.000Z",
        "2026-12-20T15:00:00.000Z",
      ]) {
        agora = new Date(instante);
        const arquivos = await baixarTodos();
        const totais = conferirContas(arquivos);
        const filadelfia = registros("celulas", arquivos.celulas).find(
          (linha) => linha.celula === "Célula Filadélfia",
        );
        expect(filadelfia && vendas(filadelfia)).toEqual(ZERO);
        expect(
          registros("discipuladores", arquivos.discipuladores).map(
            (linha) => linha.discipulador,
          ),
        ).toContain("Discipulador Davi");
        if (instante.startsWith("2026-12-20")) {
          const [linha] = registros("totais", arquivos.totais);
          const fora: Totais = {
            pedidos: inteiro(linha.pedidos_fora_das_datas),
            bilhetes: inteiro(linha.bilhetes_fora_das_datas),
            centavos: centavos(linha.arrecadacao_fora_das_datas),
          };
          expect(somar([totais, fora])).toEqual(await noBanco());
        }
      }
    },
  );
});

// ---------------------------------------------------------------------------------------------------
// CA3: o desconsiderado
// ---------------------------------------------------------------------------------------------------

describe("CA3: o pedido aprovado e desconsiderado não aparece em nenhum dos 7 tipos e entra na contagem dos totais", () => {
  // Aprovado da Ágape (Jovens, Rede Jovem, Discipulador Abel), com DDD 91, no dia 3 (Semana 1): mexe em todos os tipos.
  const ALVO: PedidoTeste = {
    ...aprovado(101, meioDia(3), 7),
    pais: "55",
    ddd: "91",
  };
  // Também contam como desconsiderados (de qualquer status): um em processamento. O de outra campanha, não.
  const OUTROS_DESCONSIDERADOS: PedidoTeste[] = [
    desconsiderado(
      {
        ...aprovado(102, meioDia(4), 2),
        status: "in_process",
        aprovado_em: null,
      },
      "fraude",
    ),
    desconsiderado({ ...aprovado(101, meioDia(2), 3), campanha: "outra" }),
  ];

  /** A contagem dos totais e o arquivo de totais sem ela (para comparar o resto). */
  const separarContagem = (csv: string) => {
    const partes = /;(\d+);% da meta\r\n$/.exec(csv);
    expect(partes).not.toBeNull();
    return {
      contagem: Number(partes![1]),
      resto: csv.replace(/;\d+;% da meta\r\n$/, ";?;% da meta\r\n"),
    };
  };

  it("desconsiderado: os 7 arquivos iguais aos de sem ele (só a contagem muda); reconsiderado, volta a todos", async () => {
    await semearCenario({
      pedidos: [...PEDIDOS_COM_TELEFONE, ...OUTROS_DESCONSIDERADOS],
    });
    const semEle = await baixarTodos();
    await semearCenario({
      pedidos: [...PEDIDOS_COM_TELEFONE, ...OUTROS_DESCONSIDERADOS, ALVO],
    });
    const comEle = await baixarTodos();
    await semearCenario({
      pedidos: [
        ...PEDIDOS_COM_TELEFONE,
        ...OUTROS_DESCONSIDERADOS,
        desconsiderado(ALVO),
      ],
    });
    const desconsideradoEle = await baixarTodos();

    // Contando, ele mexe em todos os 7 tipos (o teste vale para cada um).
    for (const tipo of TIPOS_RELATORIO)
      expect({ tipo, mudou: comEle[tipo] !== semEle[tipo] }).toEqual({
        tipo,
        mudou: true,
      });
    // Desconsiderado: nenhum tipo o tem; só a contagem dos totais sobe (o em processamento e ele).
    for (const tipo of TIPOS_RELATORIO)
      if (tipo !== "totais")
        expect({ tipo, csv: desconsideradoEle[tipo] }).toEqual({
          tipo,
          csv: semEle[tipo],
        });
    expect(separarContagem(desconsideradoEle.totais)).toEqual({
      contagem: 2,
      resto: separarContagem(semEle.totais).resto,
    });
    expect(separarContagem(semEle.totais).contagem).toBe(1);

    // Reconsiderado (o admin desfaz): volta a todos os 7, e a contagem desce.
    await env.DB.prepare(
      `UPDATE pedidos SET desconsiderado_em = NULL, desconsiderado_motivo = NULL WHERE id = ?1`,
    )
      .bind(ALVO.id)
      .run();
    const reconsiderado = await baixarTodos();
    expect(reconsiderado).toEqual(comEle);
    expect(separarContagem(reconsiderado.totais).contagem).toBe(1);
  });
});

// ---------------------------------------------------------------------------------------------------
// CA4: nada pessoal
// ---------------------------------------------------------------------------------------------------

describe("CA4: nada pessoal nos 7 arquivos (só o nome do líder)", () => {
  const AFILIADO_RECONHECIVEL = 987654;
  const PEDIDOS_RECONHECIVEIS: PedidoTeste[] = [
    {
      ...aprovado(AFILIADO_RECONHECIVEL, meioDia(2), 3),
      id: "PEDIDO-RECONHECIVEL-1",
      pais: "55",
      ddd: "91",
    },
    desconsiderado(
      {
        ...aprovado(AFILIADO_RECONHECIVEL, meioDia(3), 4),
        id: "PEDIDO-RECONHECIVEL-2",
      },
      "fraude",
    ),
  ];

  beforeAll(async () => {
    await semearCenario({ pedidos: PEDIDOS_COM_TELEFONE });
    await env.DB.batch([
      env.DB.prepare(
        `UPDATE celulas SET lider_telefone = '(91) 98888-' || printf('%04d', id),
           lider_email = 'lider' || id || '@exemplo-secreto.org'`,
      ),
      env.DB.prepare(
        `INSERT INTO afiliados (affiliate_id, celula_id, rotulo, origem, vinculado_em)
         VALUES (?1, 1, 'ROTULO-SECRETO-DO-AFILIADO', 'manual', '2026-11-20T12:00:00.000Z')`,
      ).bind(AFILIADO_RECONHECIVEL),
      env.DB.prepare(
        `UPDATE afiliados SET rotulo = 'usuario.secreto.rifei' WHERE affiliate_id = 101`,
      ),
    ]);
    const { results } = await env.DB.prepare(
      "SELECT id FROM campanhas WHERE ativa = 1",
    ).all<{ id: number }>();
    await semearPedidos(env.DB, PEDIDOS_RECONHECIVEIS, {
      ativa: results[0].id,
    });
    await env.DB.prepare(
      `UPDATE pedidos SET desconsiderado_observacao = 'OBSERVACAO-SECRETA' WHERE id = 'PEDIDO-RECONHECIVEL-2'`,
    ).run();
  });

  it("nenhum telefone, e-mail, id de pedido, id ou rótulo de afiliado, motivo ou observação da desconsideração", async () => {
    const arquivos = await baixarTodos();
    // O pedido reconhecível conta (na Ágape, no DDD 91), e o desconsiderado entra na contagem: estão no banco.
    expect(
      registros("totais", arquivos.totais)[0].pedidos_desconsiderados,
    ).toBe("1");
    for (const tipo of TIPOS_RELATORIO)
      for (const proibido of [
        "98888",
        "exemplo-secreto",
        "@",
        "PT-",
        "PEDIDO-RECONHECIVEL",
        String(AFILIADO_RECONHECIVEL),
        "ROTULO-SECRETO",
        "usuario.secreto",
        "fraude",
        "OBSERVACAO-SECRETA",
        DADOS_CAMPANHA.slug_rifei,
      ])
        expect({
          tipo,
          proibido,
          contem: arquivos[tipo].includes(proibido),
        }).toEqual({
          tipo,
          proibido,
          contem: false,
        });
  });

  it("o líder: só o nome, e só no arquivo das células", async () => {
    const arquivos = await baixarTodos();
    expect(
      registros("celulas", arquivos.celulas).map((linha) => linha.lider),
    ).toEqual([
      "Líder da Célula Ágape",
      "Líder da Célula Betel",
      "Líder da Célula Canaã",
      "Líder da Célula Dorcas",
      "Líder da Célula Éfeso",
    ]);
    for (const tipo of TIPOS_RELATORIO)
      if (tipo !== "celulas")
        expect({ tipo, contem: arquivos[tipo].includes("Líder") }).toEqual({
          tipo,
          contem: false,
        });
  });

  it("o SQL a mais lê só o id e o nome do líder, e da contagem só o número", () => {
    const identificadores = (sql: string) =>
      [
        ...new Set(
          sql
            .match(/\b[a-z_]+\b/g)!
            .filter(
              (palavra) =>
                !/^(select|count|as|from|where|and|is|not|null)$/.test(palavra),
            ),
        ),
      ].sort();
    expect(identificadores(SELECIONAR_LIDERES)).toEqual([
      "celulas",
      "id",
      "lider_nome",
    ]);
    expect(identificadores(CONTAR_DESCONSIDERADOS)).toEqual([
      "campanha_id",
      "desconsiderado_em",
      "pedidos",
      "total",
    ]);
  });
});

// ---------------------------------------------------------------------------------------------------
// CA5: proteção contra fórmula
// ---------------------------------------------------------------------------------------------------

describe("CA5: nomes que parecem fórmula saem protegidos, e o arquivo continua íntegro", () => {
  const HIPERLINK = '=HYPERLINK("https://site.example";"clique")';
  const DDE = "@SUM(1+1)*cmd|' /C calc'!A0";

  beforeAll(async () => {
    await semearCenario({ pedidos: PEDIDOS_COM_TELEFONE });
    await env.DB.batch([
      env.DB.prepare("UPDATE campanhas SET nome = '=1+1' WHERE ativa = 1"),
      env.DB.prepare("UPDATE redes SET nome = '+Vida' WHERE id = 1"),
      env.DB.prepare(`UPDATE redes SET nome = 'Rede; "Adulta"' WHERE id = 2`),
      env.DB.prepare("UPDATE discipuladores SET nome = '-x' WHERE id = 10"),
      env.DB.prepare("UPDATE celulas SET nome = '@x' WHERE id = 1"),
      env.DB.prepare(
        "UPDATE celulas SET nome = ?1, lider_nome = ?2 WHERE id = 2",
      ).bind('Célula "A;B"', HIPERLINK),
      env.DB.prepare("UPDATE celulas SET lider_nome = ?1 WHERE id = 3").bind(
        DDE,
      ),
    ]);
  });

  it("os 7 arquivos relidos pelo lerCsv: nenhuma célula começa como fórmula, e cada linha tem as colunas do cabeçalho", async () => {
    const arquivos = await baixarTodos();
    for (const tipo of TIPOS_RELATORIO)
      for (const linha of lerArquivo(arquivos[tipo]))
        for (const campo of linha)
          expect({ tipo, campo, formula: pareceFormulaNoCsv(campo) }).toEqual({
            tipo,
            campo,
            formula: false,
          });
  });

  it("o apóstrofo na frente de `=`, `+`, `-` e `@`; com `;` e aspas, entre aspas e lido de volta igual", async () => {
    const arquivos = await baixarTodos();
    expect(registros("totais", arquivos.totais)[0].campanha).toBe("'=1+1");
    const celulas = registros("celulas", arquivos.celulas);
    const celula = (nome: string) =>
      celulas.find((linha) => linha.celula === nome);
    expect(celula("'@x")).toMatchObject({
      rede: "'+Vida",
      discipulador: "'-x",
    });
    expect(celula('Célula "A;B"')).toMatchObject({
      rede: "'+Vida",
      discipulador: "'-x",
      lider: `'${HIPERLINK}`,
    });
    expect(celula("Célula Canaã")?.lider).toBe(`'${DDE}`);
    expect(celula("Célula Dorcas")?.rede).toBe('Rede; "Adulta"');
    // No texto: aspas em volta e as internas dobradas.
    expect(arquivos.celulas).toContain(';"Célula ""A;B""";');
    expect(arquivos.celulas).toContain(
      `;"'=HYPERLINK(""https://site.example"";""clique"")";`,
    );
    expect(arquivos.redes).toContain('\r\nAdultos;"Rede; ""Adulta""";');
    expect(
      registros("discipuladores", arquivos.discipuladores).map((l) => l.rede),
    ).toContain("'+Vida");
    expect(registros("redes", arquivos.redes).map((l) => l.rede)).toEqual([
      "'+Vida",
      'Rede; "Adulta"',
    ]);
  });
});

// ---------------------------------------------------------------------------------------------------
// CA6: login, erros e cabeçalhos
// ---------------------------------------------------------------------------------------------------

async function esperarErro(
  consulta: string,
  status: number,
  codigo: CodigoErro,
) {
  const res = await app.request(`/api/painel/relatorio${consulta}`, {}, env);
  const corpo: unknown = await res.json();
  expect({ status: res.status, corpo }).toMatchObject({
    status,
    corpo: { erro: { codigo } },
  });
  expect(res.headers.get("Cache-Control")).toBe("no-store");
  expect(res.headers.get("Content-Type")).toMatch(/^application\/json/);
  expect(res.headers.get("Content-Disposition")).toBeNull();
  return erroApiSchema.parse(corpo).erro;
}

describe("CA6: erros, cabeçalhos e login por papel", () => {
  beforeAll(async () => {
    await semearCenario();
  });

  it.each([
    "",
    "?tipo=",
    "?tipo=Celulas",
    "?tipo=pedidos",
    "?tipo=celulas&tipo=redes",
    "?data=2026-12-01",
  ])("GET %s: 400 requisicao_invalida no `tipo`", async (consulta) => {
    const erro = await esperarErro(consulta, 400, "requisicao_invalida");
    expect(erro.detalhes).toEqual([
      expect.objectContaining({ caminho: ["tipo"] }),
    ]);
  });

  it("um `data` na URL é ignorado: o relatório é o de hoje", async () => {
    const res = await app.request(
      "/api/painel/relatorio?tipo=totais&data=2026-11-25",
      {},
      env,
    );
    expect(res.status).toBe(200);
    expect(registros("totais", await textoDoCsv(res))[0].data_referencia).toBe(
      "2026-12-01",
    );
  });

  it("o nome do arquivo tem a data de hoje NO FUSO da campanha (02:59Z de 02/12 ainda é 01/12 em Belém)", async () => {
    agora = new Date("2026-12-02T02:59:59.000Z");
    for (const tipo of TIPOS_RELATORIO) {
      const res = await app.request(
        `/api/painel/relatorio?tipo=${tipo}`,
        {},
        env,
      );
      expect({
        tipo,
        disposicao: res.headers.get("Content-Disposition"),
      }).toEqual({
        tipo,
        disposicao: `attachment; filename="rifa-videira-kids-${tipo}-2026-12-01.csv"`,
      });
    }
  });

  it("sem campanha ativa: 404 nao_encontrado em todos os tipos (inclusive o ddd)", async () => {
    await limparBanco();
    try {
      for (const tipo of TIPOS_RELATORIO)
        expect(
          await esperarErro(`?tipo=${tipo}`, 404, "nao_encontrado"),
        ).toEqual({
          codigo: "nao_encontrado",
          mensagem: "A campanha ainda não foi configurada",
        });
    } finally {
      await semearCenario();
    }
  });

  describe("no app real (index.ts)", () => {
    const pedir = (tipo: string, cabecalhos: Record<string, string> = {}) =>
      exports.default.fetch(`${ORIGEM}/api/painel/relatorio?tipo=${tipo}`, {
        headers: cabecalhos,
      });

    it("sem sessão: 401 nao_autenticado", async () => {
      const res = await pedir("totais");
      expect({ status: res.status, corpo: await res.json() }).toMatchObject({
        status: 401,
        corpo: { erro: { codigo: "nao_autenticado" } },
      });
    });

    it.each(PAPEIS_HIERARQUIA)("sessão de %s: 403 proibido", async (papel) => {
      const alvo = { lider: 1, discipulador: 10, rede: 1 }[papel];
      const res = await pedir(
        "celulas",
        await cabecalhosDeSessaoDaHierarquia(papel, alvo),
      );
      expect({ status: res.status, corpo: await res.json() }).toMatchObject({
        status: 403,
        corpo: { erro: { codigo: "proibido" } },
      });
    });

    it.each(["coordenacao", "admin"] as const)(
      "sessão de %s: 200 em todos os tipos, com o CSV, o anexo com o nome, o no-store e o nosniff",
      async (papel) => {
        const cabecalhos = await cabecalhosDeSessao(papel);
        for (const tipo of TIPOS_RELATORIO) {
          const antes = hojeNoFuso(DADOS_CAMPANHA.fuso_horario);
          const res = await pedir(tipo, cabecalhos);
          const depois = hojeNoFuso(DADOS_CAMPANHA.fuso_horario);
          expect({ tipo, status: res.status }).toEqual({ tipo, status: 200 });
          expect(res.headers.get("Content-Type")).toBe(
            "text/csv; charset=utf-8",
          );
          expect(res.headers.get("Cache-Control")).toBe("no-store");
          expect(res.headers.get("X-Content-Type-Options")).toBe("nosniff");
          expect(
            [antes, depois].map(
              (data) =>
                `attachment; filename="rifa-videira-kids-${tipo}-${data}.csv"`,
            ),
          ).toContain(res.headers.get("Content-Disposition"));
          const csv = await textoDoCsv(res);
          expect(csv.slice(1).split("\r\n")[0]).toBe(
            cabecalhoDoRelatorio(tipo, "bilhetes").join(";"),
          );
        }
      },
    );
  });
});
