// As telas de ranking usam cópias de valores do contrato (os valores de api.ts poriam o zod no pacote do
// site; veja rankings-api.ts). Este teste garante que as cópias continuam iguais ao contrato e que as
// consultas que as telas montam passam pelos schemas das rotas.
import { describe, expect, it } from "vitest";
import {
  JANELAS_RANKING,
  NIVEIS_RANKING,
  ROTAS,
  ROTAS_MAIORES_COMPRADORES,
  SITUACOES_RITMO,
  NIVEIS_RANKING_GRUPOS,
  consultaMaioresCompradoresSchema,
  consultaRankingGruposSchema,
  consultaRankingPublicoSchema,
  consultaRankingSchema,
} from "../../../shared/contracts/api";
import {
  CRITERIOS_RANKING,
  UNIDADES_META,
} from "../../../shared/contracts/dominio";
import {
  CAMINHO_RANKING_PUBLICO,
  caminhoDoRankingPublico,
} from "../ranking-publico/ranking-publico-api";
import { JANELAS, NIVEIS } from "./filtros";
import {
  CAMINHO_MAIORES_COMPRADORES,
  caminhoDosMaioresCompradores,
} from "./maiores-compradores-api";
import {
  CAMINHO_RANKING,
  CAMINHO_RANKING_GRUPOS,
  caminhoDoRanking,
  caminhoDoRankingGrupos,
  nivelDosGrupos,
} from "./rankings-api";
import {
  TEXTO_COLUNA_VALORES,
  TEXTO_CRITERIO,
  TEXTO_JANELA,
  TEXTO_NIVEL,
  TEXTO_SITUACAO,
} from "./textos";

/** A consulta de um caminho como objeto, para passar pelo schema da rota. */
function consultaDe(caminho: string): Record<string, string> {
  return Object.fromEntries(new URL(caminho, "http://localhost").searchParams);
}

describe("cópias do contrato dos rankings no site", () => {
  it("os maiores compradores (RIFA-083): o caminho, só admin, e a consulta de cada janela passa no schema", () => {
    const rota = ROTAS_MAIORES_COMPRADORES.maioresCompradores;
    expect(CAMINHO_MAIORES_COMPRADORES).toBe(rota.caminho);
    expect(rota.grupo).toBe("coordenacao");
    expect(rota.papeis).toEqual(["admin"]);
    for (const janela of JANELAS)
      expect(
        consultaMaioresCompradoresSchema.parse(
          consultaDe(caminhoDosMaioresCompradores(janela)),
        ),
      ).toEqual({ janela, limite: 10 });
  });

  it("o ranking por grupo (RIFA-084): o caminho, da coordenação, e a consulta de cada aba e janela passa no schema", () => {
    const rota = ROTAS.painelRankingGrupos;
    expect(CAMINHO_RANKING_GRUPOS).toBe(rota.caminho);
    expect(rota.grupo).toBe("coordenacao");
    expect(NIVEIS.map(nivelDosGrupos)).toEqual([
      ...NIVEIS_RANKING_GRUPOS,
      null,
    ]);
    for (const nivel of NIVEIS_RANKING_GRUPOS)
      for (const janela of JANELAS)
        expect(
          consultaRankingGruposSchema.parse(
            consultaDe(caminhoDoRankingGrupos(nivel, janela)),
          ),
        ).toEqual({ nivel, janela });
  });

  it("caminhos das rotas", () => {
    expect(CAMINHO_RANKING).toBe(ROTAS.painelRanking.caminho);
    expect(ROTAS.painelRanking.grupo).toBe("coordenacao");
    expect(CAMINHO_RANKING_PUBLICO).toBe(ROTAS.rankingPublico.caminho);
    expect(ROTAS.rankingPublico.grupo).toBe("aberto");
  });

  it("níveis, janelas, critérios, situações e unidades têm todos um texto", () => {
    expect(NIVEIS).toEqual(NIVEIS_RANKING);
    expect(JANELAS).toEqual(JANELAS_RANKING);
    expect(Object.keys(TEXTO_NIVEL).sort()).toEqual([...NIVEIS_RANKING].sort());
    expect(Object.keys(TEXTO_JANELA).sort()).toEqual(
      [...JANELAS_RANKING].sort(),
    );
    expect(Object.keys(TEXTO_CRITERIO).sort()).toEqual(
      [...CRITERIOS_RANKING].sort(),
    );
    expect(Object.keys(TEXTO_SITUACAO).sort()).toEqual(
      [...SITUACOES_RITMO].sort(),
    );
    expect(Object.keys(TEXTO_COLUNA_VALORES).sort()).toEqual(
      [...UNIDADES_META].sort(),
    );
  });

  it("as consultas montadas pelas telas passam pelos schemas das rotas", () => {
    for (const nivel of NIVEIS) {
      for (const periodo of JANELAS) {
        for (const divisao of [null, "jovens", "adultos"] as const) {
          const consulta = consultaDe(
            caminhoDoRanking({ nivel, divisao, periodo }),
          );
          expect(consultaRankingSchema.parse(consulta)).toEqual({
            nivel,
            periodo,
            ...(divisao ? { divisao } : {}),
          });
        }
      }
    }
    for (const periodo of JANELAS) {
      for (const divisao of ["jovens", "adultos"] as const) {
        const consulta = consultaDe(caminhoDoRankingPublico(divisao, periodo));
        expect(consultaRankingPublicoSchema.parse(consulta)).toEqual({
          nivel: "celula",
          divisao,
          periodo,
        });
      }
    }
  });
});
