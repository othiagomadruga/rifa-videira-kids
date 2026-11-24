// RIFA-092 (adendo da D39): GET /api/painel/resumo?escopo=grupo&id=..., o recorte da Visão geral por grupo (adultos da
// manhã, adultos da noite, jovens, adolescentes), com o D1 dos testes e o relógio fixo. O grupo vale pelo grupo EFETIVO
// de cada célula (o próprio, se houver; senão, o do discipulador), o mesmo do ranking por grupo no nível célula. Cada
// resposta 200 passa pelo schema estrito e é comparada com o montador sobre a entrada montada no JS (sem o SQL) e, à
// parte, com a soma das células do grupo (o resumo de cada célula e o ranking por grupo). O login fica de fora daqui
// (protecao.test.ts confere no app real).
//
// Cenário (test/painel-apoio.ts), no dia 9: Caleb (Dorcas e Éfeso) em "Adultos da manhã"; Abel (Ágape e Betel) em
// "Adultos da noite", mas a Betel tem o grupo próprio "Adolescentes"; Davi (sem células) em "Adolescentes"; Boaz
// (Canaã) sem grupo; "Jovens" sem discipulador. Uma venda sem afiliado (4 bilhetes no dia 3) foi atribuída à mão à
// Dorcas (RIFA-088, D41).
import { env } from "cloudflare:workers";
import { Hono } from "hono";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  erroApiSchema,
  montarResumoPainel,
  respostaPainelResumoSchema,
  respostaRankingGruposSchema,
  type EntradaCalculo,
  type EscopoResolvido,
  type RespostaPainelResumo,
  type TotaisVendas,
} from "../../shared/contracts";
import { erroNaoTratado, rotaInexistente } from "../lib/respostas-erro";
import {
  AGORA,
  PEDIDOS,
  entradaEsperada,
  limparBanco,
  semearCenario,
} from "../test/painel-apoio";
import { PREFIXO_PAINEL, criarPainel } from "./painel";

const app = new Hono<{ Bindings: Cloudflare.Env }>();
app.route(
  PREFIXO_PAINEL,
  criarPainel(() => AGORA),
);
app.notFound(rotaInexistente);
app.onError(erroNaoTratado);

/** Os ids dos grupos semeados pela migração 0018. */
const GRUPO = { manha: 1, noite: 2, jovens: 3, adolescentes: 4 } as const;
const NOMES_DOS_GRUPOS: Record<number, string> = {
  [GRUPO.manha]: "Adultos da manhã",
  [GRUPO.noite]: "Adultos da noite",
  [GRUPO.jovens]: "Jovens",
  [GRUPO.adolescentes]: "Adolescentes",
};

/** O grupo efetivo de cada célula no cenário (Canaã sem grupo). */
const GRUPO_EFETIVO: Record<number, number | null> = {
  1: GRUPO.noite,
  2: GRUPO.adolescentes,
  3: null,
  4: GRUPO.manha,
  5: GRUPO.manha,
};

const DORCAS = 4;
/** A venda sem afiliado do dia 3 (4 bilhetes), atribuída à mão à Dorcas. */
const ATRIBUIDA = PEDIDOS.find(
  (pedido) => pedido.affiliate_id === null && pedido.qtd_bilhetes === 4,
)!;
/** O afiliado da Dorcas: na entrada montada no JS, a venda atribuída conta como dela. */
const AFILIADO_DA_DORCAS = 104;

async function chamar(caminho: string) {
  const res = await app.request(caminho, {}, env);
  return {
    status: res.status,
    corpo: (await res.json()) as unknown,
    cacheControl: res.headers.get("Cache-Control"),
  };
}

async function resumo(consulta: string): Promise<RespostaPainelResumo> {
  const resposta = await chamar(`/api/painel/resumo${consulta}`);
  expect({ status: resposta.status, corpo: resposta.corpo }).toMatchObject({
    status: 200,
  });
  expect(resposta.cacheControl).toBe("no-store");
  return respostaPainelResumoSchema.parse(resposta.corpo);
}

/** A entrada dos montadores para o cenário, no JS: o grupo efetivo de cada célula e a venda atribuída na Dorcas. */
function entradaDoCenario(): EntradaCalculo {
  const pedidos = PEDIDOS.map((pedido) =>
    pedido.id === ATRIBUIDA.id
      ? { ...pedido, affiliate_id: AFILIADO_DA_DORCAS }
      : pedido,
  );
  const entrada = entradaEsperada(undefined, pedidos);
  return {
    ...entrada,
    celulas: entrada.celulas.map((celula) => ({
      ...celula,
      grupo_efetivo_id: GRUPO_EFETIVO[celula.id],
    })),
  };
}

const escopoDoGrupo = (id: number): EscopoResolvido => ({
  tipo: "grupo",
  id,
  divisao: null,
  nome: NOMES_DOS_GRUPOS[id],
});

const somar = (totais: readonly TotaisVendas[]): TotaisVendas => ({
  pedidos_aprovados: totais.reduce((s, t) => s + t.pedidos_aprovados, 0),
  bilhetes: totais.reduce((s, t) => s + t.bilhetes, 0),
  total_centavos: totais.reduce((s, t) => s + t.total_centavos, 0),
});

beforeAll(async () => {
  await semearCenario();
  await env.DB.batch([
    env.DB.prepare(
      "UPDATE discipuladores SET grupo_id = CASE id WHEN 10 THEN ?1 WHEN 30 THEN ?2 WHEN 40 THEN ?3 END",
    ).bind(GRUPO.noite, GRUPO.manha, GRUPO.adolescentes),
    env.DB.prepare("UPDATE celulas SET grupo_id = ?1 WHERE id = 2").bind(
      GRUPO.adolescentes,
    ),
    env.DB.prepare(
      `UPDATE pedidos SET celula_atribuida_id = ?1, celula_atribuida_em = '2026-11-26T18:00:00.000Z',
         celula_atribuida_por = 1 WHERE id = ?2`,
    ).bind(DORCAS, ATRIBUIDA.id),
  ]);
});

afterAll(async () => {
  await limparBanco();
});

describe("GET /api/painel/resumo?escopo=grupo (RIFA-092)", () => {
  it.each(Object.values(GRUPO))(
    "grupo %i: o mesmo que montarResumoPainel sobre as células do grupo efetivo",
    async (id) => {
      const corpo = await resumo(`?escopo=grupo&id=${id}`);
      expect(corpo.escopo).toEqual(escopoDoGrupo(id));
      expect(corpo).toEqual(
        montarResumoPainel(
          entradaDoCenario(),
          { escopo: escopoDoGrupo(id) },
          AGORA,
        ),
      );
    },
  );

  it("Adultos da manhã = a soma da Dorcas e da Éfeso: metas, ritmo, hoje, curva e vendas (com a venda atribuída à mão, D41)", async () => {
    const manha = await resumo(`?escopo=grupo&id=${GRUPO.manha}`);
    const celulas = await Promise.all(
      [4, 5].map((id) => resumo(`?escopo=celula&id=${id}`)),
    );
    const soma = (valor: (r: RespostaPainelResumo) => number) =>
      celulas.reduce((total, celula) => total + valor(celula), 0);

    expect(manha.vendas).toEqual(somar(celulas.map((c) => c.vendas)));
    expect(manha.campanha.meta).toBe(soma((r) => r.campanha.meta));
    expect(manha.campanha.realizado).toBe(soma((r) => r.campanha.realizado));
    expect(manha.periodo?.meta).toBe(soma((r) => r.periodo?.meta ?? 0));
    expect(manha.periodo?.realizado).toBe(
      soma((r) => r.periodo?.realizado ?? 0),
    );
    expect(manha.hoje?.realizado).toBe(soma((r) => r.hoje?.realizado ?? 0));
    expect(manha.curva.map((ponto) => ponto.realizado_no_dia)).toEqual(
      manha.curva.map((_, dia) =>
        celulas.every((c) => c.curva[dia].realizado_no_dia === null)
          ? null
          : soma((r) => r.curva[dia].realizado_no_dia ?? 0),
      ),
    );
    expect(manha.vendas_sem_celula).toBeNull();
    expect(manha.vendas_fora_da_janela).toBeNull();

    // A venda atribuída à Dorcas entra no grupo: sem ela, 4 bilhetes a menos.
    const semAtribuicao = montarResumoPainel(
      {
        ...entradaEsperada(),
        celulas: entradaDoCenario().celulas,
      },
      { escopo: escopoDoGrupo(GRUPO.manha) },
      AGORA,
    );
    expect(manha.vendas.bilhetes - semAtribuicao.vendas.bilhetes).toBe(
      ATRIBUIDA.qtd_bilhetes,
    );
  });

  it("o ranking por grupo (nível célula, campanha inteira) bate com o resumo de cada grupo: as mesmas células, a meta e o realizado somados", async () => {
    const resposta = await chamar(
      "/api/painel/ranking-grupos?nivel=celula&janela=campanha",
    );
    expect(resposta.status).toBe(200);
    const { grupos } = respostaRankingGruposSchema.parse(resposta.corpo);
    expect(grupos.map((grupo) => grupo.id)).toEqual([
      GRUPO.manha,
      GRUPO.noite,
      GRUPO.adolescentes,
    ]);
    for (const grupo of grupos) {
      const doResumo = await resumo(`?escopo=grupo&id=${grupo.id}`);
      expect(grupo.itens.map((item) => item.id).sort(), grupo.nome).toEqual(
        Object.entries(GRUPO_EFETIVO)
          .filter(([, efetivo]) => efetivo === grupo.id)
          .map(([celula]) => Number(celula)),
      );
      const somaDosItens = (
        valor: (item: (typeof grupo.itens)[number]) => number,
      ) => grupo.itens.reduce((total, item) => total + valor(item), 0);
      expect(
        {
          meta: doResumo.campanha.meta,
          realizado: doResumo.campanha.realizado,
          vendas: doResumo.vendas,
        },
        grupo.nome,
      ).toEqual({
        meta: somaDosItens((item) => item.meta),
        realizado: somaDosItens((item) => item.realizado),
        vendas: somar(grupo.itens.map((item) => item.vendas)),
      });
    }
  });

  it("a célula com grupo próprio entra no grupo dela e sai do grupo do discipulador; o discipulador sem grupo fica fora de todos", async () => {
    const [noite, adolescentes, jovens, agape, betel, canaa, campanha] =
      await Promise.all([
        resumo(`?escopo=grupo&id=${GRUPO.noite}`),
        resumo(`?escopo=grupo&id=${GRUPO.adolescentes}`),
        resumo(`?escopo=grupo&id=${GRUPO.jovens}`),
        resumo("?escopo=celula&id=1"),
        resumo("?escopo=celula&id=2"),
        resumo("?escopo=celula&id=3"),
        resumo(""),
      ]);
    // Abel está em "Adultos da noite", mas a Betel (dele) é de Adolescentes: na noite, só a Ágape.
    expect(noite.campanha.meta).toBe(agape.campanha.meta);
    expect(noite.vendas).toEqual(agape.vendas);
    expect(adolescentes.campanha.meta).toBe(betel.campanha.meta);
    expect(adolescentes.vendas).toEqual(betel.vendas);
    // "Jovens" existe e não tem células: responde, sem meta e sem vendas.
    expect(jovens.campanha).toMatchObject({ meta: 0, realizado: 0 });
    expect(jovens.vendas).toEqual(somar([]));
    // A Canaã (Boaz, sem grupo) não está em nenhum grupo: os grupos + a Canaã + as sem célula = a campanha.
    const grupos = await Promise.all(
      [GRUPO.manha, GRUPO.noite, GRUPO.adolescentes].map((id) =>
        resumo(`?escopo=grupo&id=${id}`),
      ),
    );
    expect(
      somar([
        ...grupos.map((g) => g.vendas),
        canaa.vendas,
        campanha.vendas_sem_celula!,
      ]),
    ).toEqual(campanha.vendas);
    expect(
      grupos.reduce((total, g) => total + g.campanha.meta, 0) +
        canaa.campanha.meta,
    ).toBe(campanha.campanha.meta);
  });

  it("grupo inexistente: 404 nao_encontrado, como um discipulador inexistente", async () => {
    for (const [consulta, mensagem] of [
      ["?escopo=grupo&id=999", "Grupo não encontrado"],
      ["?escopo=discipulador&id=999", "Discipulador não encontrado"],
    ]) {
      const resposta = await chamar(`/api/painel/resumo${consulta}`);
      expect({ status: resposta.status, corpo: resposta.corpo }).toMatchObject({
        status: 404,
        corpo: { erro: { codigo: "nao_encontrado" } },
      });
      expect(resposta.cacheControl).toBe("no-store");
      expect(erroApiSchema.parse(resposta.corpo).erro.mensagem).toBe(mensagem);
    }
  });

  it.each([
    ["sem id", "?escopo=grupo"],
    ["id que não é número", "?escopo=grupo&id=abc"],
    ["id zero", "?escopo=grupo&id=0"],
  ])("%s: 400 requisicao_invalida no campo id", async (_caso, consulta) => {
    const resposta = await chamar(`/api/painel/resumo${consulta}`);
    expect({ status: resposta.status, corpo: resposta.corpo }).toMatchObject({
      status: 400,
      corpo: { erro: { codigo: "requisicao_invalida" } },
    });
    expect(erroApiSchema.parse(resposta.corpo).erro.detalhes).toEqual(
      expect.arrayContaining([expect.objectContaining({ caminho: ["id"] })]),
    );
  });
});
