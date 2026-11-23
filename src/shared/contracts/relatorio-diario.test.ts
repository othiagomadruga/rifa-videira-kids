// RIFA-086 e RIFA-087 (D40): contrato do relatório diário por e-mail (manhã e tarde) e do "Arrecadado" (só admin).
import { describe, expect, expectTypeOf, it } from "vitest";
import {
  ACOES_AUDITORIA,
  ALVO_AUDITORIA_RELATORIO_DIARIO,
  ROTAS,
  ROTAS_ACESSO,
  ROTAS_ACESSO_HIERARQUIA,
  ROTAS_CONEXAO_RIFEI,
  ROTAS_LINK_VENDAS,
  ROTAS_MAIORES_COMPRADORES,
  ROTAS_REGRAS_CAMPANHA,
  ROTAS_RELATORIO,
  ROTAS_RELATORIO_DIARIO,
  ROTAS_RIFEI_API,
  ROTAS_ARRECADADO,
  ROTAS_TOKEN_WEBHOOK,
  consultaPreviaRelatorioDiarioSchema,
  corpoEnviarRelatorioDiarioSchema,
  respostaEnviarRelatorioDiarioSchema,
  respostaArrecadadoSchema,
  respostaPreviaRelatorioDiarioSchema,
  type DefinicaoRota,
} from "./index";
import * as contrato from "./index";
import {
  CRONS_RELATORIO_DIARIO,
  CRON_RELATORIO_MANHA,
  CRON_RELATORIO_TARDE,
  LINK_PAINEL_RELATORIO_DIARIO,
  REMETENTE_RELATORIO_DIARIO,
  TIPOS_RELATORIO_DIARIO,
  TIPO_CONTEUDO_HTML,
  TIPO_RELATORIO_DIARIO_PADRAO,
} from "./relatorio-diario";

const INSTANTE = "2026-11-24T20:00:00.000Z";

describe("ROTAS_RELATORIO_DIARIO e ROTAS_ARRECADADO", () => {
  it("as três rotas são só do admin, sob /api/admin, no grupo da coordenação", () => {
    expect(Object.keys(ROTAS_RELATORIO_DIARIO)).toEqual([
      "previaRelatorioDiario",
      "enviarRelatorioDiario",
    ]);
    expect(Object.keys(ROTAS_ARRECADADO)).toEqual(["arrecadado"]);
    const rotas = [
      ...Object.values(ROTAS_RELATORIO_DIARIO),
      ...Object.values(ROTAS_ARRECADADO),
    ];
    expect(rotas.map((rota) => `${rota.metodo} ${rota.caminho}`)).toEqual([
      "GET /api/admin/relatorio-diario/previa",
      "POST /api/admin/relatorio-diario/enviar",
      "GET /api/admin/arrecadado",
    ]);
    for (const rota of rotas) {
      expect(rota.grupo).toBe("coordenacao");
      expect(rota.papeis).toEqual(["admin"]);
      expect(rota.situacao).toBe("detalhada");
      expectTypeOf(rota).toExtend<DefinicaoRota>();
    }
  });

  it("não repetem rota de nenhum outro catálogo; a prévia é a única em HTML", () => {
    const outras: readonly {
      metodo: string;
      caminho: string;
      sucesso: object;
    }[] = [
      ...Object.values(ROTAS),
      ...Object.values(ROTAS_ACESSO),
      ...Object.values(ROTAS_ACESSO_HIERARQUIA),
      ...Object.values(ROTAS_REGRAS_CAMPANHA),
      ...Object.values(ROTAS_TOKEN_WEBHOOK),
      ...Object.values(ROTAS_RELATORIO),
      ...Object.values(ROTAS_LINK_VENDAS),
      ...Object.values(ROTAS_RIFEI_API),
      ...Object.values(ROTAS_CONEXAO_RIFEI),
      ...Object.values(ROTAS_MAIORES_COMPRADORES),
    ];
    const chaves = outras.map((outra) => `${outra.metodo} ${outra.caminho}`);
    for (const rota of [
      ...Object.values(ROTAS_RELATORIO_DIARIO),
      ...Object.values(ROTAS_ARRECADADO),
    ])
      expect(chaves).not.toContain(`${rota.metodo} ${rota.caminho}`);
    expect(ROTAS_RELATORIO_DIARIO.previaRelatorioDiario.sucesso).toEqual({
      status: 200,
      corpo: respostaPreviaRelatorioDiarioSchema,
      tipoConteudo: "text/html; charset=utf-8",
    });
    expect(TIPO_CONTEUDO_HTML).toBe("text/html; charset=utf-8");
    expect(
      outras.filter(
        (outra) =>
          "tipoConteudo" in outra.sucesso &&
          outra.sucesso.tipoConteudo === TIPO_CONTEUDO_HTML,
      ),
    ).toEqual([]);
    expect("tipoConteudo" in ROTAS_ARRECADADO.arrecadado.sucesso).toBe(false);
  });

  it("prévia: `tipo` manha|tarde (padrão manha) e `data` opcional no formato AAAA-MM-DD; o corpo é o HTML do e-mail", () => {
    expect(TIPOS_RELATORIO_DIARIO).toEqual(["manha", "tarde"]);
    expect(TIPO_RELATORIO_DIARIO_PADRAO).toBe("manha");
    expect(consultaPreviaRelatorioDiarioSchema.parse({})).toEqual({
      tipo: "manha",
    });
    expect(
      consultaPreviaRelatorioDiarioSchema.parse({
        tipo: "tarde",
        data: "2026-11-23",
      }),
    ).toEqual({ tipo: "tarde", data: "2026-11-23" });
    // Uma data absurda, mas que existe, passa no schema: a rota responde 400 fora_da_campanha (não 500).
    expect(
      consultaPreviaRelatorioDiarioSchema.parse({ data: "0001-01-01" }),
    ).toEqual({ tipo: "manha", data: "0001-01-01" });
    for (const data of ["23/11/2026", "2026-02-30", "ontem", ""])
      expect(
        consultaPreviaRelatorioDiarioSchema.safeParse({ data }).success,
      ).toBe(false);
    for (const tipo of ["noite", "MANHA", ""])
      expect(
        consultaPreviaRelatorioDiarioSchema.safeParse({ tipo }).success,
      ).toBe(false);
    expect(
      respostaPreviaRelatorioDiarioSchema.safeParse("<!doctype html><html>")
        .success,
    ).toBe(true);
    expect(
      respostaPreviaRelatorioDiarioSchema.safeParse('{"ok":true}').success,
    ).toBe(false);
  });

  it("envio: corpo estrito com `tipo` e `data` opcionais; a resposta traz o tipo e só contagens, que fecham", () => {
    expect(corpoEnviarRelatorioDiarioSchema.parse({})).toEqual({
      tipo: "manha",
    });
    expect(corpoEnviarRelatorioDiarioSchema.parse({ tipo: "tarde" })).toEqual({
      tipo: "tarde",
    });
    for (const errado of [
      { destinatarios: ["pastor@example.com"] },
      { tipo: "noite" },
    ])
      expect(corpoEnviarRelatorioDiarioSchema.safeParse(errado).success).toBe(
        false,
      );
    const ok = {
      tipo: "tarde",
      data: "2026-11-23",
      destinatarios: 2,
      enviados: 1,
      falhas: 1,
    };
    expect(respostaEnviarRelatorioDiarioSchema.parse(ok)).toEqual(ok);
    for (const errada of [
      { ...ok, falhas: 0 },
      { ...ok, destinatarios: 0, enviados: 0, falhas: 0 },
      { ...ok, emails: ["pastor@example.com"] },
      { ...ok, tipo: undefined },
    ])
      expect(
        respostaEnviarRelatorioDiarioSchema.safeParse(errada).success,
      ).toBe(false);
  });

  it("arrecadado: a campanha até agora e hoje (null fora das datas), só totais, nada da Efí", () => {
    const totais = {
      pedidos_aprovados: 40,
      bilhetes: 61,
      total_centavos: 144_000,
    };
    const certa = {
      data: "2026-11-23",
      campanha: totais,
      hoje: totais,
      atualizado_em: INSTANTE,
    };
    expect(respostaArrecadadoSchema.parse(certa)).toEqual(certa);
    expect(respostaArrecadadoSchema.parse({ ...certa, hoje: null })).toEqual({
      ...certa,
      hoje: null,
    });
    for (const errada of [
      { ...certa, hoje: undefined },
      { ...certa, campanha: { ...totais, total_centavos: 10.5 } },
      { ...certa, saldo_centavos: 100 },
      { ...certa, data: "23/11/2026" },
    ])
      expect(respostaArrecadadoSchema.safeParse(errada).success).toBe(false);
  });

  it("nada da Efí no contrato (o saldo saiu na RIFA-087)", () => {
    expect(
      Object.keys(contrato).filter((nome) =>
        /(^|_)EFI(_|$)|Efi|saldo|Saldo|SALDO/.test(nome),
      ),
    ).toEqual([]);
  });

  it("trilha, cron, remetente e o link do painel", () => {
    expect(ACOES_AUDITORIA).toContain("relatorio_diario.enviar");
    expect(ALVO_AUDITORIA_RELATORIO_DIARIO).toBe("relatorio_diario");
    // 10:00 UTC = 07:00 em Belém (UTC−3), o dia anterior; 20:00 UTC = 17:00 em Belém, a parcial de hoje.
    expect(CRON_RELATORIO_MANHA).toBe("0 10 * * *");
    expect(CRON_RELATORIO_TARDE).toBe("0 20 * * *");
    expect(CRONS_RELATORIO_DIARIO).toEqual({
      manha: CRON_RELATORIO_MANHA,
      tarde: CRON_RELATORIO_TARDE,
    });
    expect(REMETENTE_RELATORIO_DIARIO).toEqual({
      nome: "Projeto Videira Kids",
      email: "relatorio@projetokidsbelem.com.br",
    });
    expect(LINK_PAINEL_RELATORIO_DIARIO).toBe(
      "https://projetokidsbelem.com.br/coordenacao",
    );
  });
});
