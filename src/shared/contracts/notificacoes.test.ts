// RIFA-095 (D43): o contrato das notificações de venda. As rotas abertas, a lista dos serviços de push (SSRF), os
// corpos, o texto da notificação e a opção da campanha.
import { describe, expect, expectTypeOf, it } from "vitest";
import * as contrato from "./index";
import {
  ROTAS,
  ROTAS_ACESSO,
  ROTAS_ACESSO_HIERARQUIA,
  ROTAS_ARRECADADO,
  ROTAS_CONEXAO_RIFEI,
  ROTAS_LINK_VENDAS,
  ROTAS_MAIORES_COMPRADORES,
  ROTAS_QUEM_COMPROU,
  ROTAS_QUEM_COMPROU_ADMIN,
  ROTAS_REGRAS_CAMPANHA,
  ROTAS_RELATORIO,
  ROTAS_RELATORIO_DIARIO,
  ROTAS_RIFEI_API,
  ROTAS_TODAS_AS_REDES,
  ROTAS_TOKEN_WEBHOOK,
  type DefinicaoRota,
} from "./index";
import { campanhaEntradaSchema, campanhaSchema } from "./dominio";
import {
  NOTIFICACOES_PADRAO,
  ROTAS_NOTIFICACOES,
  corpoCancelarNotificacoesSchema,
  corpoInscreverNotificacoesSchema,
  endpointDePushPermitido,
  montarNotificacaoDeVenda,
  notificacaoDeVendaSchema,
  respostaEstadoNotificacoesSchema,
  textoDaNotificacaoDeVenda,
} from "./notificacoes";

/** Chaves fictícias no formato certo (a do aparelho: 65 bytes, começa com 0x04 = "B"). */
const P256DH = `B${"A".repeat(86)}`;
const AUTH = "A".repeat(22);
const FCM = "https://fcm.googleapis.com/fcm/send/abc123:APA91bFicticio";

describe("ROTAS_NOTIFICACOES", () => {
  it("três rotas abertas sob /api/publico/notificacoes, no formato do catálogo", () => {
    expect(
      Object.values(ROTAS_NOTIFICACOES).map(
        (rota) => `${rota.metodo} ${rota.caminho}`,
      ),
    ).toEqual([
      "GET /api/publico/notificacoes",
      "POST /api/publico/notificacoes/inscrever",
      "POST /api/publico/notificacoes/cancelar",
    ]);
    for (const rota of Object.values(ROTAS_NOTIFICACOES)) {
      expect(rota.grupo).toBe("aberto");
      expect(rota.situacao).toBe("detalhada");
      expect("papeis" in rota).toBe(false);
      expectTypeOf(rota).toExtend<DefinicaoRota>();
    }
    expect(ROTAS_NOTIFICACOES.inscreverNotificacoes.sucesso).toEqual({
      status: 204,
      corpo: null,
    });
    expect(ROTAS_NOTIFICACOES.cancelarNotificacoes.sucesso).toEqual({
      status: 204,
      corpo: null,
    });
  });

  it("não repetem rota de nenhum outro catálogo, e o index exporta tudo", () => {
    const outras = new Set(
      [
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
        ...Object.values(ROTAS_QUEM_COMPROU),
        ...Object.values(ROTAS_QUEM_COMPROU_ADMIN),
        ...Object.values(ROTAS_RELATORIO_DIARIO),
        ...Object.values(ROTAS_ARRECADADO),
        ...Object.values(ROTAS_TODAS_AS_REDES),
      ].map((rota) => `${rota.metodo} ${rota.caminho}`),
    );
    for (const rota of Object.values(ROTAS_NOTIFICACOES))
      expect(outras.has(`${rota.metodo} ${rota.caminho}`)).toBe(false);
    expect(contrato.ROTAS_NOTIFICACOES).toBe(ROTAS_NOTIFICACOES);
    expect(contrato.corpoInscreverNotificacoesSchema).toBe(
      corpoInscreverNotificacoesSchema,
    );
    expect(contrato.textoDaNotificacaoDeVenda).toBe(textoDaNotificacaoDeVenda);
  });
});

describe("endpointDePushPermitido (SSRF)", () => {
  it.each([
    FCM,
    "https://fcm.googleapis.com/wp/abc",
    "https://updates.push.services.mozilla.com/wpush/v2/gAAAAABficticio",
    "https://web.push.apple.com/QGficticio",
    "https://wns2-par02p.notify.windows.com/w/?token=BQYAAAficticio",
    "https://db5p.notify.windows.com/w/?token=x",
  ])("aceita o serviço de push conhecido %s", (endpoint) => {
    expect(endpointDePushPermitido(endpoint)).toBe(true);
  });

  it.each([
    ["http (sem TLS)", "http://fcm.googleapis.com/fcm/send/x"],
    ["outro servidor", "https://exemplo.com/push"],
    ["sufixo parecido", "https://fcm.googleapis.com.exemplo.com/x"],
    ["prefixo parecido", "https://evilfcm.googleapis.com/x"],
    ["subdomínio do FCM", "https://x.fcm.googleapis.com/x"],
    ["só o sufixo da Microsoft", "https://notify.windows.com/w/"],
    ["Microsoft com ponto vazio", "https://.notify.windows.com/w/"],
    ["Microsoft sem ponto", "https://evilnotify.windows.com/w/"],
    ["IP", "https://127.0.0.1/x"],
    ["IPv6", "https://[::1]/x"],
    ["localhost", "https://localhost/x"],
    ["com porta", "https://fcm.googleapis.com:8443/x"],
    ["com usuário", "https://u:s@fcm.googleapis.com/x"],
    ["outro esquema", "javascript:alert(1)"],
    ["não é URL", "fcm.googleapis.com/x"],
    ["longo demais", `${FCM}${"a".repeat(2048)}`],
  ])("recusa %s", (_nome, endpoint) => {
    expect(endpointDePushPermitido(endpoint)).toBe(false);
  });
});

describe("corpos", () => {
  const valido = {
    endpoint: FCM,
    chaves: { p256dh: P256DH, auth: AUTH },
    origem: "publico",
  };

  it("inscrever: aceita a inscrição do navegador e tira o `=` do base64url", () => {
    expect(corpoInscreverNotificacoesSchema.parse(valido)).toEqual(valido);
    expect(
      corpoInscreverNotificacoesSchema.parse({
        ...valido,
        chaves: { p256dh: `${P256DH}=`, auth: `${AUTH}==` },
        origem: "minha",
      }),
    ).toEqual({ ...valido, origem: "minha" });
  });

  it.each([
    ["endpoint fora da lista", { endpoint: "https://exemplo.com/x" }],
    ["sem chaves", { chaves: undefined }],
    ["p256dh curta", { chaves: { p256dh: "BAAA", auth: AUTH } }],
    [
      "p256dh comprimida (não começa com 0x04)",
      { chaves: { p256dh: `A${"A".repeat(86)}`, auth: AUTH } },
    ],
    [
      "auth com caractere fora do base64url",
      { chaves: { p256dh: P256DH, auth: `${"A".repeat(21)}+` } },
    ],
    ["origem desconhecida", { origem: "telao" }],
    ["campo a mais", { expirationTime: null }],
  ])("inscrever recusa: %s", (_nome, mudanca) => {
    expect(
      corpoInscreverNotificacoesSchema.safeParse({ ...valido, ...mudanca })
        .success,
    ).toBe(false);
  });

  it("o erro do endpoint recusado não ecoa o valor", () => {
    const resultado = corpoInscreverNotificacoesSchema.safeParse({
      ...valido,
      endpoint: "https://interno.exemplo/segredo",
    });
    expect(resultado.success).toBe(false);
    expect(JSON.stringify(resultado.error?.issues)).not.toContain("segredo");
  });

  it("cancelar: só o endpoint", () => {
    expect(corpoCancelarNotificacoesSchema.parse({ endpoint: FCM })).toEqual({
      endpoint: FCM,
    });
    expect(
      corpoCancelarNotificacoesSchema.safeParse({ endpoint: FCM, x: 1 })
        .success,
    ).toBe(false);
    expect(corpoCancelarNotificacoesSchema.safeParse({}).success).toBe(false);
  });

  it("estado: a chave pública vem só com as notificações ligadas", () => {
    expect(
      respostaEstadoNotificacoesSchema.parse({
        ligadas: true,
        chave_publica: P256DH,
      }),
    ).toEqual({ ligadas: true, chave_publica: P256DH });
    expect(
      respostaEstadoNotificacoesSchema.parse({
        ligadas: false,
        chave_publica: null,
      }),
    ).toEqual({ ligadas: false, chave_publica: null });
    for (const estado of [
      { ligadas: true, chave_publica: null },
      { ligadas: false, chave_publica: P256DH },
      { ligadas: true, chave_publica: "curta" },
    ])
      expect(respostaEstadoNotificacoesSchema.safeParse(estado).success).toBe(
        false,
      );
  });
});

describe("a notificação", () => {
  it("o texto do PO: a célula e os bilhetes, no singular e no plural", () => {
    expect(textoDaNotificacaoDeVenda("Betel", 3)).toBe(
      "🎟️ A célula Betel vendeu 3 bilhetes!",
    );
    expect(textoDaNotificacaoDeVenda("  Bunker ", 1)).toBe(
      "🎟️ A célula Bunker vendeu 1 bilhete!",
    );
    // O nome que já começa com "Célula" não repete a palavra.
    expect(textoDaNotificacaoDeVenda("Célula Ficticia", 2)).toBe(
      "🎟️ A Célula Ficticia vendeu 2 bilhetes!",
    );
    expect(textoDaNotificacaoDeVenda("celula nova", 2)).toBe(
      "🎟️ A celula nova vendeu 2 bilhetes!",
    );
    // "Celulares" não é "Célula ...".
    expect(textoDaNotificacaoDeVenda("Celulares", 2)).toBe(
      "🎟️ A célula Celulares vendeu 2 bilhetes!",
    );
  });

  it("o payload tem só título, texto e a URL do ranking aberto", () => {
    const notificacao = montarNotificacaoDeVenda("Betel", 3);
    expect(notificacao).toEqual({
      titulo: "Projeto Videira Kids",
      corpo: "🎟️ A célula Betel vendeu 3 bilhetes!",
      url: "/",
    });
    expect(
      notificacaoDeVendaSchema.safeParse({ ...notificacao, pedido: "1" })
        .success,
    ).toBe(false);
  });
});

describe("a opção da campanha (`notificacoes.vendas`)", () => {
  const entrada = {
    nome: "Campanha",
    slug_rifei: "campanha",
    data_inicio: "2026-11-23",
    preco_bilhete_centavos: 2000,
    meta: { unidade: "bilhetes", regra: "por_pessoa", valor: 10 },
    periodos: [{ nome: "Período 1", dias: 7, percentual_bp: 10000 }],
    ranking: { criterio: "percentual_meta" },
  } as const;

  it("na entrada é opcional (ausente mantém o gravado) e, na resposta, vem com o padrão (ligada)", () => {
    expect(NOTIFICACOES_PADRAO).toEqual({ vendas: true });
    expect(campanhaEntradaSchema.parse(entrada).notificacoes).toBeUndefined();
    expect(
      campanhaEntradaSchema.parse({
        ...entrada,
        notificacoes: { vendas: false },
      }).notificacoes,
    ).toEqual({ vendas: false });
    expect(
      campanhaEntradaSchema.safeParse({
        ...entrada,
        notificacoes: { vendas: "sim" },
      }).success,
    ).toBe(false);
    expect(campanhaSchema.shape.notificacoes.parse(undefined)).toEqual({
      vendas: true,
    });
  });
});
