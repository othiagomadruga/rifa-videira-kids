// RIFA-086 (D40): contrato do relatório diário por e-mail e do saldo da Efí (só admin).
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
  ROTAS_SALDO_EFI,
  ROTAS_TOKEN_WEBHOOK,
  consultaPreviaRelatorioDiarioSchema,
  corpoEnviarRelatorioDiarioSchema,
  respostaEnviarRelatorioDiarioSchema,
  respostaPreviaRelatorioDiarioSchema,
  respostaSaldoEfiSchema,
  type DefinicaoRota,
} from "./index";
import {
  CRON_RELATORIO_DIARIO,
  ERROS_SALDO_EFI,
  LINK_PAINEL_RELATORIO_DIARIO,
  REMETENTE_RELATORIO_DIARIO,
  TIPO_CONTEUDO_HTML,
} from "./relatorio-diario";

const INSTANTE = "2026-11-24T10:00:00.000Z";

describe("ROTAS_RELATORIO_DIARIO e ROTAS_SALDO_EFI", () => {
  it("as três rotas são só do admin, sob /api/admin, no grupo da coordenação", () => {
    expect(Object.keys(ROTAS_RELATORIO_DIARIO)).toEqual([
      "previaRelatorioDiario",
      "enviarRelatorioDiario",
    ]);
    expect(Object.keys(ROTAS_SALDO_EFI)).toEqual(["saldoEfi"]);
    const rotas = [
      ...Object.values(ROTAS_RELATORIO_DIARIO),
      ...Object.values(ROTAS_SALDO_EFI),
    ];
    expect(rotas.map((rota) => `${rota.metodo} ${rota.caminho}`)).toEqual([
      "GET /api/admin/relatorio-diario/previa",
      "POST /api/admin/relatorio-diario/enviar",
      "GET /api/admin/efi/saldo",
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
      ...Object.values(ROTAS_SALDO_EFI),
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
    expect("tipoConteudo" in ROTAS_SALDO_EFI.saldoEfi.sucesso).toBe(false);
  });

  it("prévia: `data` opcional no formato AAAA-MM-DD (ausente = ontem); o corpo é o HTML do e-mail", () => {
    expect(consultaPreviaRelatorioDiarioSchema.parse({})).toEqual({});
    expect(
      consultaPreviaRelatorioDiarioSchema.parse({ data: "2026-11-23" }),
    ).toEqual({ data: "2026-11-23" });
    for (const data of ["23/11/2026", "2026-02-30", "ontem", ""])
      expect(
        consultaPreviaRelatorioDiarioSchema.safeParse({ data }).success,
      ).toBe(false);
    expect(
      respostaPreviaRelatorioDiarioSchema.safeParse("<!doctype html><html>")
        .success,
    ).toBe(true);
    expect(
      respostaPreviaRelatorioDiarioSchema.safeParse('{"ok":true}').success,
    ).toBe(false);
  });

  it("envio: corpo estrito com `data` opcional; a resposta só traz contagens, que fecham", () => {
    expect(corpoEnviarRelatorioDiarioSchema.parse({})).toEqual({});
    expect(
      corpoEnviarRelatorioDiarioSchema.safeParse({
        destinatarios: ["pastor@example.com"],
      }).success,
    ).toBe(false);
    const ok = { data: "2026-11-23", destinatarios: 2, enviados: 1, falhas: 1 };
    expect(respostaEnviarRelatorioDiarioSchema.parse(ok)).toEqual(ok);
    for (const errada of [
      { ...ok, falhas: 0 },
      { ...ok, destinatarios: 0, enviados: 0, falhas: 0 },
      { ...ok, emails: ["pastor@example.com"] },
    ])
      expect(
        respostaEnviarRelatorioDiarioSchema.safeParse(errada).success,
      ).toBe(false);
  });

  it("saldo da Efí: sem configuração, nem saldo nem erro; configurada, o saldo ou o erro", () => {
    for (const certa of [
      { configurado: false, saldo_centavos: null, consultado_em: INSTANTE },
      { configurado: true, saldo_centavos: 1234567, consultado_em: INSTANTE },
      { configurado: true, saldo_centavos: 0, consultado_em: INSTANTE },
      ...ERROS_SALDO_EFI.map((erro) => ({
        configurado: true,
        saldo_centavos: null,
        consultado_em: INSTANTE,
        erro,
      })),
    ])
      expect(respostaSaldoEfiSchema.parse(certa)).toEqual(certa);
    for (const errada of [
      { configurado: false, saldo_centavos: 100, consultado_em: INSTANTE },
      {
        configurado: false,
        saldo_centavos: null,
        consultado_em: INSTANTE,
        erro: "consulta",
      },
      { configurado: true, saldo_centavos: null, consultado_em: INSTANTE },
      {
        configurado: true,
        saldo_centavos: 100,
        consultado_em: INSTANTE,
        erro: "consulta",
      },
      { configurado: true, saldo_centavos: 10.5, consultado_em: INSTANTE },
      {
        configurado: true,
        saldo_centavos: 100,
        consultado_em: INSTANTE,
        token: "x",
      },
    ])
      expect(respostaSaldoEfiSchema.safeParse(errada).success).toBe(false);
  });

  it("trilha, cron, remetente e o link do painel", () => {
    expect(ACOES_AUDITORIA).toContain("relatorio_diario.enviar");
    expect(ALVO_AUDITORIA_RELATORIO_DIARIO).toBe("relatorio_diario");
    // 10:00 UTC = 07:00 em Belém (UTC−3).
    expect(CRON_RELATORIO_DIARIO).toBe("0 10 * * *");
    expect(REMETENTE_RELATORIO_DIARIO).toEqual({
      nome: "Projeto Videira Kids",
      email: "relatorio@projetokidsbelem.com.br",
    });
    expect(LINK_PAINEL_RELATORIO_DIARIO).toBe(
      "https://projetokidsbelem.com.br/coordenacao",
    );
  });
});
