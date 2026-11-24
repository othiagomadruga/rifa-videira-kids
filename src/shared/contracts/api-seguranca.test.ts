// RIFA-013b: contrato das duas rotas novas (aditivas) da coordenação.
// - GET /api/admin/pedidos/suspeitos: pedidos aprovados marcados pelo webhook, sem dado do comprador;
// - GET /api/admin/auditoria (só admin): a trilha, com paginação por cursor.
import { describe, expect, it } from "vitest";
import { z } from "zod";
import {
  ACOES_AUDITORIA,
  LIMITE_PEDIDOS_SUSPEITOS,
  MOTIVOS_PEDIDO_SUSPEITO,
  PAGINA_AUDITORIA_MAXIMA,
  PAGINA_AUDITORIA_PADRAO,
  ROTAS,
  consultaAuditoriaSchema,
  respostaAuditoriaSchema,
  respostaPedidosSuspeitosSchema,
} from "./api";

/** Nomes de todos os campos que o schema pode devolver (pelo JSON Schema do zod). */
function campos(schema: z.ZodType): string[] {
  const nomes: string[] = [];
  const visitar = (no: unknown): void => {
    if (Array.isArray(no)) return no.forEach(visitar);
    if (typeof no !== "object" || no === null) return;
    for (const [chave, valor] of Object.entries(no)) {
      if (chave === "properties" && typeof valor === "object" && valor !== null)
        nomes.push(...Object.keys(valor));
      visitar(valor);
    }
  };
  visitar(z.toJSONSchema(schema));
  return nomes;
}

const suspeito = {
  pedido_id: "PEDTESTE0001",
  affiliate_id: 1042,
  celula_id: 7,
  celula_nome: "Célula Ficticia",
  qtd_bilhetes: 300,
  total_centavos: 6000,
  esperado_centavos: 600000,
  motivos: [
    {
      caminho: ["numbers_count"],
      codigo: "quantidade_acima_do_teto",
      mensagem: "Mais de 200 bilhetes num pedido só",
      ocorrencias: 1,
    },
  ],
  aprovado_em: "2026-12-01T12:20:31.512Z",
  marcado_em: "2026-12-01T12:20:32.000Z",
};

describe("GET /api/admin/pedidos/suspeitos", () => {
  it("está no catálogo do grupo coordenacao, para admin e coordenacao (sem papeis próprios)", () => {
    expect(ROTAS.pedidosSuspeitos).toMatchObject({
      metodo: "GET",
      caminho: "/api/admin/pedidos/suspeitos",
      grupo: "coordenacao",
      situacao: "detalhada",
      sucesso: { status: 200, corpo: respostaPedidosSuspeitosSchema },
    });
    expect("papeis" in ROTAS.pedidosSuspeitos).toBe(false);
  });

  it("aceita a resposta do exemplo e recusa motivo fora da lista", () => {
    // A resposta de hoje, sem a desconsideração (D20), sai com `desconsiderado: null`.
    expect(
      respostaPedidosSuspeitosSchema.parse({ itens: [suspeito], total: 1 }),
    ).toEqual({ itens: [{ ...suspeito, desconsiderado: null }], total: 1 });
    expect(MOTIVOS_PEDIDO_SUSPEITO).toEqual([
      "quantidade_acima_do_teto",
      "total_acima_do_esperado",
      "total_abaixo_do_esperado",
    ]);
    const motivoDesconhecido = {
      ...suspeito,
      motivos: [{ ...suspeito.motivos[0], codigo: "outro" }],
    };
    expect(
      respostaPedidosSuspeitosSchema.safeParse({
        itens: [motivoDesconhecido],
        total: 1,
      }).success,
    ).toBe(false);
    expect(
      respostaPedidosSuspeitosSchema.safeParse({
        itens: [{ ...suspeito, motivos: [] }],
        total: 1,
      }).success,
    ).toBe(false);
  });

  it(`no máximo ${LIMITE_PEDIDOS_SUSPEITOS} itens`, () => {
    const itens = Array.from(
      { length: LIMITE_PEDIDOS_SUSPEITOS + 1 },
      () => suspeito,
    );
    expect(
      respostaPedidosSuspeitosSchema.safeParse({ itens, total: itens.length })
        .success,
    ).toBe(false);
  });

  it("lista fechada de campos: nada do comprador (nome, telefone, e-mail, documento, DDD, país, UTM, números)", () => {
    expect([...new Set(campos(respostaPedidosSuspeitosSchema))].sort()).toEqual(
      [
        "affiliate_id",
        "aprovado_em",
        "caminho",
        "celula_id",
        "celula_nome",
        "codigo",
        // D20: a desconsideração do admin (motivo, observação curta e quando), sem quem fez.
        "desconsiderado",
        "em",
        "esperado_centavos",
        "itens",
        "marcado_em",
        "mensagem",
        "motivo",
        "motivos",
        "observacao",
        "ocorrencias",
        "pedido_id",
        "qtd_bilhetes",
        "total",
        "total_centavos",
      ].sort(),
    );
  });
});

describe("GET /api/admin/auditoria", () => {
  it("está no catálogo só para admin", () => {
    expect(ROTAS.auditoria).toMatchObject({
      metodo: "GET",
      caminho: "/api/admin/auditoria",
      grupo: "coordenacao",
      papeis: ["admin"],
      situacao: "detalhada",
      consulta: consultaAuditoriaSchema,
      sucesso: { status: 200, corpo: respostaAuditoriaSchema },
    });
  });

  it("consulta: limite padrão 50 e no máximo 200; antes_de inteiro positivo; textos convertidos", () => {
    expect(consultaAuditoriaSchema.parse({})).toEqual({
      limite: PAGINA_AUDITORIA_PADRAO,
    });
    expect(PAGINA_AUDITORIA_PADRAO).toBe(50);
    expect(PAGINA_AUDITORIA_MAXIMA).toBe(200);
    expect(
      consultaAuditoriaSchema.parse({ limite: "2", antes_de: "40" }),
    ).toEqual({ limite: 2, antes_de: 40 });
    for (const consulta of [
      { limite: "0" },
      { limite: "201" },
      { limite: "1.5" },
      { antes_de: "0" },
      { antes_de: "abc" },
    ])
      expect({
        consulta,
        ok: consultaAuditoriaSchema.safeParse(consulta).success,
      }).toEqual({ consulta, ok: false });
  });

  it("resposta: as 31 ações conhecidas, o cursor e quem fez", () => {
    expect(ACOES_AUDITORIA).toEqual([
      "campanha.salvar",
      "afiliado.salvar",
      "hierarquia.importar",
      "usuario.criar",
      "usuario.ativar",
      "usuario.desativar",
      "link.criar",
      "link.revogar",
      // RIFA-014 (D12): lote de links da hierarquia.
      "acessos_hierarquia.gerar_links",
      // RIFA-018: o CRUD de redes, discipuladores e células.
      "hierarquia.criar",
      "hierarquia.atualizar",
      "hierarquia.remover",
      // RIFA-012 (D19): o "Recuperar" da conferência pelo CSV, quando grava.
      "conferencia.recuperar",
      // Sprint 6 (D20): desconsiderar e reconsiderar pedido (RIFA-028) e remover afiliado (RIFA-031).
      "pedido.desconsiderar",
      "pedido.reconsiderar",
      "afiliado.remover",
      // RIFA-039 (D21): o token do webhook gerado pela tela.
      "webhook.gerar_token",
      // RIFA-064 (D29): o login da célula com a senha padrão.
      "sessao.entrar_com_senha",
      // RIFA-082 (D37): o login do discipulador com a senha padrão.
      "sessao.entrar_com_senha_discipulador",
      // RIFA-073 (D33): o login do admin com usuário e senha e a senha dele (definir, trocar, remover).
      "sessao.entrar_como_admin",
      "senha_admin.definir",
      "senha_admin.trocar",
      "senha_admin.remover",
      // RIFA-070 (D32): a API da Rifei (marcar pagos, sincronizar afiliados e gerar convites).
      "rifei.marcar_pagos",
      "rifei.sincronizar_afiliados",
      "rifei.gerar_convites",
      // RIFA-070 (D32): a conexão com a Rifei pela tela.
      "rifei.conectar",
      "rifei.desconectar",
      // RIFA-076 (D36): a planilha de compradores baixada pelo admin.
      "compradores.exportar",
      // RIFA-086 (D40): o relatório diário enviado pelo admin (o do cron não tem usuário e fica só no log).
      "relatorio_diario.enviar",
      // RIFA-088 (D41): a célula atribuída à mão a uma venda sem célula pelo afiliado.
      "pedido.atribuir_celula",
      // RIFA-091 (adendo da D41): a tentativa de ligar a venda ao afiliado da célula na Rifei.
      "pedido.vincular_afiliado_rifei",
    ]);
    // O CHECK da coluna `acao` (migração 0005) aceita só [a-z_.] e de 3 a 64 caracteres.
    for (const acao of ACOES_AUDITORIA)
      expect({ acao, ok: /^[a-z_.]{3,64}$/.test(acao) }).toEqual({
        acao,
        ok: true,
      });
    const registro = {
      id: 3,
      em: "2026-11-25T15:00:00.000Z",
      usuario_id: 1,
      usuario_nome: "Admin Ficticio",
      acao: "link.revogar",
      alvo: "link:12",
      resumo: "Link do usuário 3 revogado",
    };
    expect(
      respostaAuditoriaSchema.parse({ itens: [registro], proximo: null }),
    ).toEqual({ itens: [registro], proximo: null });
    expect(
      respostaAuditoriaSchema.safeParse({
        itens: [{ ...registro, acao: "campanha.apagar" }],
        proximo: 3,
      }).success,
    ).toBe(false);
  });
});
