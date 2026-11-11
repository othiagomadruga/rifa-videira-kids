// Sprint 6 (docs/decisions.md D20): as regras novas da campanha no contrato. RIFA-028 (desconsiderar pedido),
// RIFA-029 (acesso de discipuladores e de redes), RIFA-031 (remover afiliado de teste) e RIFA-032 (mensagens do
// WhatsApp dos links). Um teste por critério do contrato; as rotas e o banco são das tarefas -db e -api.
import { describe, expect, expectTypeOf, it } from "vitest";
import { z } from "zod";
import {
  ACOES_AUDITORIA,
  LIMITE_ALVO_AUDITORIA,
  ROTAS,
  ROTAS_REGRAS_CAMPANHA,
  alvoDoPedidoNaAuditoria,
  consultaPedidosSchema,
  corpoDesconsiderarPedidoSchema,
  corpoReconsiderarPedidoSchema,
  desconsideracaoSchema,
  detalhesAcaoDesligadaSchema,
  detalhesAfiliadoComPedidosSchema,
  grupoDesconsideradosSchema,
  itemPedidoSchema,
  pedidoSuspeitoSchema,
  respostaPedidosSchema,
  type ItemPedido,
} from "./api";
import {
  PAPEIS,
  ROTAS_ACESSO,
  ROTAS_ACESSO_HIERARQUIA,
  detalhesAcessoDesligadoSchema,
} from "./acesso";
import {
  campanhaEntradaSchema,
  campanhaSchema,
  pedidoSchema,
  type Campanha,
  type CampanhaEntrada,
} from "./dominio";
import { CODIGOS_ERRO, STATUS_HTTP_DO_ERRO } from "./erros";
import * as contrato from "./index";
import {
  ACESSO_PADRAO,
  CHAVES_REGRAS,
  LIMITE_CARACTERES_MENSAGEM,
  LIMITE_OBSERVACAO_DESCONSIDERACAO,
  LIMITE_PEDIDOS_NO_DETALHE,
  MARCADORES_DO_MODELO,
  MENSAGEM_DO_PAPEL,
  MENSAGENS_PADRAO,
  MOTIVOS_DESCONSIDERACAO,
  PEDIDOS_PADRAO,
  TIPOS_MENSAGEM,
  acessoDoPapelLigado,
  observacaoTemContato,
  preencherMensagem,
  primeiroNome,
  problemasDoModelo,
} from "./regras";

const AGORA = "2026-11-11T18:00:00.000Z";
const URL_FICTICIA =
  "https://rifa.example/acesso/TokenFicticioDeTeste_0123456789-abcdefghijk";

/** O corpo do PUT de hoje (sem os grupos novos). */
const corpoDeHoje = {
  nome: "Rifa Videira Kids",
  slug_rifei: "videira-kids-teste",
  data_inicio: "2026-11-23",
  preco_bilhete_centavos: 2000,
  meta: { unidade: "bilhetes", regra: "por_pessoa", valor: 10 },
  periodos: [{ nome: "Semana 1", dias: 24, percentual_bp: 10_000 }],
  ranking: { criterio: "percentual_meta" },
};

/** A resposta da campanha como a API de hoje devolve (sem os grupos novos). */
const respostaDeHoje = {
  ...corpoDeHoje,
  id: 1,
  fuso_horario: "America/Belem",
  data_fim: "2026-12-16",
  periodos: [
    {
      ordem: 1,
      nome: "Semana 1",
      dias: 24,
      percentual_bp: 10_000,
      data_inicio: "2026-11-23",
      data_fim: "2026-12-16",
    },
  ],
  soma_percentuais_bp: 10_000,
  publico: { mostra_percentual_meta: false, limite_ranking: 3 },
  criado_em: AGORA,
  atualizado_em: AGORA,
};

/** Um item da lista de pedidos como a API de hoje devolve (sem `desconsiderado`). */
const itemDeHoje = {
  id: "PEDFIC0001",
  status: "approved",
  qtd_bilhetes: 2,
  total_centavos: 4000,
  affiliate_id: 1001,
  celula_id: 1,
  celula_nome: "Célula Ficticia 01",
  ddd: "91",
  criado_em: AGORA,
  aprovado_em: AGORA,
  expirado_em: null,
  registrado_em: AGORA,
  atualizado_em: AGORA,
  suspeito: false,
};

const aceita = (schema: z.ZodType, valor: unknown) =>
  schema.safeParse(valor).success;

describe("D20: as regras na campanha (corpo do PUT)", () => {
  it("o corpo de hoje continua valendo e os grupos novos ficam ausentes: a API mantém o gravado (na criação, o padrão)", () => {
    const corpo = campanhaEntradaSchema.parse(corpoDeHoje);
    expect(corpo.pedidos).toBeUndefined();
    expect(corpo.acesso).toBeUndefined();
    expect(corpo.mensagens).toBeUndefined();
    expectTypeOf<CampanhaEntrada["acesso"]>().toEqualTypeOf<
      { discipuladores: boolean; redes: boolean } | undefined
    >();
  });

  it("um grupo presente vem inteiro e é validado", () => {
    const corpo = campanhaEntradaSchema.parse({
      ...corpoDeHoje,
      pedidos: { desconsiderar: true },
      acesso: { discipuladores: false, redes: true },
      mensagens: MENSAGENS_PADRAO,
    });
    expect(corpo.pedidos).toEqual({ desconsiderar: true });
    expect(corpo.acesso).toEqual({ discipuladores: false, redes: true });
    expect(corpo.mensagens).toEqual(MENSAGENS_PADRAO);
    for (const alteracao of [
      { pedidos: {} },
      { pedidos: { desconsiderar: "sim" } },
      { acesso: { discipuladores: false } },
      { acesso: { discipuladores: 0, redes: 1 } },
      { mensagens: { link_coordenacao: MENSAGENS_PADRAO.link_coordenacao } },
      { pedidos: null },
    ])
      expect({
        alteracao,
        ok: aceita(campanhaEntradaSchema, { ...corpoDeHoje, ...alteracao }),
      }).toEqual({ alteracao, ok: false });
  });

  it("mensagens: os modelos sem os espaços das pontas; recusa marcador que o modelo não aceita, a falta do {link}, vazio e acima do limite", () => {
    const comMensagens = (mudanca: Partial<Record<string, string>>) => ({
      ...corpoDeHoje,
      mensagens: { ...MENSAGENS_PADRAO, ...mudanca },
    });
    expect(
      campanhaEntradaSchema.parse(
        comMensagens({ link_lider: "  Oi, {nome}! Seu link: {link}\n " }),
      ).mensagens?.link_lider,
    ).toBe("Oi, {nome}! Seu link: {link}");
    for (const mudanca of [
      { link_lider: "Oi, {Nome}! {link}" },
      { link_lider: "Oi, {nomee}! {link}" },
      { link_coordenacao: "Olá ({alvo}): {link}" },
      { link_rede: "Olá, {nome}! Sem o link." },
      { link_discipulador: "   " },
      { link_coordenacao: `{link}${"a".repeat(LIMITE_CARACTERES_MENSAGEM)}` },
    ])
      expect({
        mudanca,
        ok: aceita(campanhaEntradaSchema, comMensagens(mudanca)),
      }).toEqual({ mudanca, ok: false });
    // Chaves soltas que não são marcador ficam como texto.
    expect(
      aceita(
        campanhaEntradaSchema,
        comMensagens({ link_rede: "{ } {saudacao} {{link}} :-}" }),
      ),
    ).toBe(true);
  });

  it("o problema do modelo vem em português, com os marcadores aceitos", () => {
    expect(problemasDoModelo("link_coordenacao", "Olá ({alvo})")).toEqual([
      "Marcador {alvo} não existe nesta mensagem. Use: {nome}, {saudacao}, {link}.",
      "A mensagem precisa ter {link}: é por ele que a pessoa entra.",
    ]);
    expect(problemasDoModelo("link_lider", "{x} {x} {link}")).toHaveLength(1);
    for (const tipo of TIPOS_MENSAGEM)
      expect(problemasDoModelo(tipo, MENSAGENS_PADRAO[tipo])).toEqual([]);
  });
});

describe("D20: as regras na resposta da campanha", () => {
  it("a resposta de hoje, sem os grupos, ganha os padrões (transição: a API ainda não grava)", () => {
    const campanha = campanhaSchema.parse(respostaDeHoje);
    expect(campanha.pedidos).toEqual({ desconsiderar: false });
    expect(campanha.acesso).toEqual({ discipuladores: true, redes: true });
    expect(campanha.mensagens).toEqual(MENSAGENS_PADRAO);
    expectTypeOf<Campanha["pedidos"]>().toEqualTypeOf<{
      desconsiderar: boolean;
    }>();
  });

  it("padrões: desconsiderar desligado; acesso de discipuladores e redes ligado; as mensagens de hoje", () => {
    expect(PEDIDOS_PADRAO).toEqual({ desconsiderar: false });
    expect(ACESSO_PADRAO).toEqual({ discipuladores: true, redes: true });
    expect(Object.keys(MENSAGENS_PADRAO)).toEqual([...TIPOS_MENSAGEM]);
    // Cada parse devolve um objeto novo: mexer num não muda o padrão.
    const uma = campanhaSchema.parse(respostaDeHoje);
    uma.acesso.redes = false;
    expect(campanhaSchema.parse(respostaDeHoje).acesso.redes).toBe(true);
    expect(ACESSO_PADRAO.redes).toBe(true);
  });

  it("os grupos gravados saem como estão; fora do formato, a resposta é recusada", () => {
    const gravada = {
      ...respostaDeHoje,
      pedidos: { desconsiderar: true },
      acesso: { discipuladores: false, redes: false },
      mensagens: {
        ...MENSAGENS_PADRAO,
        link_lider: "{saudacao} Link da célula {alvo}: {link}",
      },
    };
    expect(campanhaSchema.parse(gravada)).toEqual(gravada);
    expect(
      aceita(campanhaSchema, { ...gravada, acesso: { discipuladores: false } }),
    ).toBe(false);
  });
});

describe("RIFA-029: a chave de acesso de cada papel", () => {
  it("discipulador e rede seguem a chave deles; líder e coordenação entram sempre", () => {
    const desligado = { discipuladores: false, redes: false };
    expect(
      PAPEIS.filter((papel) => !acessoDoPapelLigado(desligado, papel)),
    ).toEqual(["discipulador", "rede"]);
    expect(
      acessoDoPapelLigado({ discipuladores: false, redes: true }, "rede"),
    ).toBe(true);
    expect(
      acessoDoPapelLigado(
        { discipuladores: false, redes: true },
        "discipulador",
      ),
    ).toBe(false);
    expect(
      PAPEIS.every((papel) => acessoDoPapelLigado(ACESSO_PADRAO, papel)),
    ).toBe(true);
  });

  it("403 acesso_desligado diz o papel (só discipulador ou rede)", () => {
    expect(STATUS_HTTP_DO_ERRO.acesso_desligado).toBe(403);
    expect(
      detalhesAcessoDesligadoSchema.parse({ papel: "discipulador" }),
    ).toEqual({ papel: "discipulador" });
    for (const detalhes of [
      { papel: "lider" },
      { papel: "admin" },
      {},
      { papel: "rede", nome: "x" },
    ])
      expect(aceita(detalhesAcessoDesligadoSchema, detalhes)).toBe(false);
  });
});

describe("RIFA-032: as mensagens preenchidas", () => {
  it("os padrões dão exatamente o texto de hoje da tela Acessos", () => {
    expect(
      preencherMensagem(MENSAGENS_PADRAO.link_coordenacao, {
        pessoaNome: "  Maria Aparecida Fictícia ",
        url: URL_FICTICIA,
      }),
    ).toBe(
      `Olá, Maria! Este é o seu link pessoal para entrar no sistema da Rifa Videira Kids. Ele é só seu, não repasse:\n${URL_FICTICIA}`,
    );
    const cuidado = ` na campanha da rifa do Videira Kids: as vendas, a meta e a posição no ranking.\nO link é só seu: não repasse para ninguém, porque quem tiver o link entra como você.\n${URL_FICTICIA}`;
    expect(
      preencherMensagem(MENSAGENS_PADRAO.link_lider, {
        pessoaNome: "  Maria Aparecida Fictícia ",
        alvoNome: "Célula Ágape",
        url: URL_FICTICIA,
      }),
    ).toBe(
      `Olá, Maria! Este é o seu link pessoal para acompanhar a sua célula (Célula Ágape)${cuidado}`,
    );
    expect(
      preencherMensagem(MENSAGENS_PADRAO.link_discipulador, {
        pessoaNome: "Davi Fictício",
        alvoNome: "Davi Fictício",
        url: URL_FICTICIA,
      }),
    ).toBe(
      `Olá, Davi! Este é o seu link pessoal para acompanhar as suas células (discipulador Davi Fictício)${cuidado}`,
    );
    expect(
      preencherMensagem(MENSAGENS_PADRAO.link_rede, {
        pessoaNome: null,
        alvoNome: "Rede Adulta Fictícia",
        url: URL_FICTICIA,
      }),
    ).toBe(
      `Olá! Este é o seu link pessoal para acompanhar a sua rede (Rede Adulta Fictícia)${cuidado}`,
    );
  });

  it("preenche numa passada só: um nome com '{link}' não vira o link; marcador desconhecido fica como está", () => {
    expect(
      preencherMensagem("{alvo} | {nome} | {saudacao} | {link} | {x}", {
        pessoaNome: "{link} da Silva",
        alvoNome: "Célula {link}",
        url: URL_FICTICIA,
      }),
    ).toBe(`Célula {link} | {link} | Olá, {link}! | ${URL_FICTICIA} | {x}`);
    expect(
      preencherMensagem("[{nome}] {saudacao}", {
        pessoaNome: "   ",
        url: URL_FICTICIA,
      }),
    ).toBe("[] Olá!");
    expect(primeiroNome("  Ana  Maria ")).toBe("Ana");
  });

  it("cada papel tem o seu modelo; os da hierarquia aceitam {alvo}, o da coordenação não", () => {
    expect(MENSAGEM_DO_PAPEL).toEqual({
      admin: "link_coordenacao",
      coordenacao: "link_coordenacao",
      lider: "link_lider",
      discipulador: "link_discipulador",
      rede: "link_rede",
    });
    for (const tipo of TIPOS_MENSAGEM) {
      expect(MARCADORES_DO_MODELO[tipo]).toContain("link");
      expect(
        (MARCADORES_DO_MODELO[tipo] as readonly string[]).includes("alvo"),
      ).toBe(tipo !== "link_coordenacao");
    }
  });
});

describe("RIFA-028: desconsiderar e reconsiderar pedido", () => {
  it("corpo: motivo da lista, observação opcional (sem os espaços das pontas; vazia ou ausente = null)", () => {
    expect(MOTIVOS_DESCONSIDERACAO).toEqual([
      "teste",
      "fraude",
      "estorno",
      "outro",
    ]);
    expect(
      corpoDesconsiderarPedidoSchema.parse({
        pedido_id: " PEDFIC0001 ",
        motivo: "teste",
      }),
    ).toEqual({ pedido_id: "PEDFIC0001", motivo: "teste", observacao: null });
    for (const observacao of ["", "   ", null])
      expect(
        corpoDesconsiderarPedidoSchema.parse({
          pedido_id: "P1",
          motivo: "estorno",
          observacao,
        }).observacao,
      ).toBeNull();
    expect(
      corpoDesconsiderarPedidoSchema.parse({
        pedido_id: "P1",
        motivo: "fraude",
        observacao: "  compra repetida na reunião ",
      }).observacao,
    ).toBe("compra repetida na reunião");
  });

  it("corpo: recusa motivo fora da lista, observação longa ou com contato, id vazio ou longo e campo a mais", () => {
    const valido = { pedido_id: "P1", motivo: "teste" };
    for (const corpo of [
      { ...valido, motivo: "cancelado" },
      { ...valido, motivo: undefined },
      {
        ...valido,
        observacao: "a".repeat(LIMITE_OBSERVACAO_DESCONSIDERACAO + 1),
      },
      { ...valido, observacao: "comprador fulano@example.com" },
      { ...valido, observacao: "ligar no (91) 98888-7777" },
      { ...valido, observacao: "CPF 123.456.789-00" },
      { ...valido, pedido_id: "   " },
      { ...valido, pedido_id: "x".repeat(129) },
      { ...valido, celula_id: 1 },
      { motivo: "teste" },
    ])
      expect({
        corpo,
        ok: aceita(corpoDesconsiderarPedidoSchema, corpo),
      }).toEqual({ corpo, ok: false });
    expect(
      aceita(corpoDesconsiderarPedidoSchema, {
        ...valido,
        observacao: "a".repeat(LIMITE_OBSERVACAO_DESCONSIDERACAO),
      }),
    ).toBe(true);
    expect(corpoReconsiderarPedidoSchema.parse({ pedido_id: " P1 " })).toEqual({
      pedido_id: "P1",
    });
    expect(
      aceita(corpoReconsiderarPedidoSchema, { pedido_id: "P1", motivo: "x" }),
    ).toBe(false);
  });

  it("observação: a trava de contato pega e-mail e 8 dígitos seguidos (com ou sem separadores), e só isso", () => {
    for (const texto of [
      "a@b",
      "91988887777",
      "(91) 9888-7777",
      "9888 7777",
      "123.456.789-00",
    ])
      expect({ texto, contato: observacaoTemContato(texto) }).toEqual({
        texto,
        contato: true,
      });
    for (const texto of [
      "teste da reunião de 22/11",
      "pedido 1234567 repetido",
      "estorno pedido pela Rifei",
    ])
      expect({ texto, contato: observacaoTemContato(texto) }).toEqual({
        texto,
        contato: false,
      });
  });

  it("lista de pedidos: o item de hoje (sem o campo) sai como 'conta'; desconsiderado traz motivo, observação e quando", () => {
    expect(itemPedidoSchema.parse(itemDeHoje).desconsiderado).toBeNull();
    const desconsiderado: ItemPedido = itemPedidoSchema.parse({
      ...itemDeHoje,
      desconsiderado: { motivo: "fraude", observacao: null, em: AGORA },
    });
    expect(desconsiderado.desconsiderado).toEqual({
      motivo: "fraude",
      observacao: null,
      em: AGORA,
    });
    for (const desconsideracao of [
      { motivo: "cancelado", observacao: null, em: AGORA },
      { motivo: "teste", observacao: "", em: AGORA },
      { motivo: "teste", observacao: null, em: "2026-11-11" },
      { motivo: "teste", observacao: null, em: AGORA, usuario_id: 1 },
      { motivo: "teste", em: AGORA },
    ])
      expect(
        aceita(itemPedidoSchema, {
          ...itemDeHoje,
          desconsiderado: desconsideracao,
        }),
      ).toBe(false);
    // Quem desconsiderou fica só na trilha (só admin): nada de usuário no item.
    expect(Object.keys(desconsideracaoSchema.shape)).toEqual([
      "motivo",
      "observacao",
      "em",
    ]);
    expect(
      respostaPedidosSchema.parse({
        itens: [itemDeHoje],
        proximo: null,
        totais: null,
      }).itens[0].desconsiderado,
    ).toBeNull();
  });

  it("pedidos suspeitos: o desconsiderado continua na lista, com a desconsideração (a de hoje sai como null)", () => {
    const suspeito = {
      pedido_id: "PEDTESTE0001",
      affiliate_id: 1042,
      celula_id: 7,
      celula_nome: "Célula Ficticia 07",
      qtd_bilhetes: 300,
      total_centavos: 6000,
      esperado_centavos: 600000,
      motivos: [
        {
          caminho: ["numbers_count"],
          codigo: "quantidade_acima_do_teto",
          mensagem: "Mais de 200 bilhetes",
          ocorrencias: 1,
        },
      ],
      aprovado_em: AGORA,
      marcado_em: AGORA,
    };
    expect(pedidoSuspeitoSchema.parse(suspeito).desconsiderado).toBeNull();
    const fraude = { motivo: "fraude", observacao: null, em: AGORA };
    expect(
      pedidoSuspeitoSchema.parse({ ...suspeito, desconsiderado: fraude })
        .desconsiderado,
    ).toEqual(fraude);
  });

  it("lista de pedidos: a origem do pedido (webhook ou conferência); a resposta de hoje, sem o campo, sai como webhook", () => {
    expect(itemPedidoSchema.parse(itemDeHoje).origem).toBe("webhook");
    expect(
      itemPedidoSchema.parse({ ...itemDeHoje, origem: "conferencia" }).origem,
    ).toBe("conferencia");
    expect(aceita(itemPedidoSchema, { ...itemDeHoje, origem: "manual" })).toBe(
      false,
    );
  });

  it("lista de pedidos: filtro desconsiderado=true|false; outro valor é 400", () => {
    expect(consultaPedidosSchema.parse({ desconsiderado: "true" })).toEqual({
      limite: 50,
      desconsiderado: true,
    });
    expect(
      consultaPedidosSchema.parse({ desconsiderado: "false" }).desconsiderado,
    ).toBe(false);
    expect(consultaPedidosSchema.parse({}).desconsiderado).toBeUndefined();
    for (const valor of ["sim", "1", ""])
      expect(aceita(consultaPedidosSchema, { desconsiderado: valor })).toBe(
        false,
      );
  });

  it("pedido (linha do banco): as três colunas da desconsideração, null nas linhas de antes da 0008", () => {
    const linha = {
      id: "PEDFIC0001",
      campanha_id: 1,
      affiliate_id: null,
      status: "approved",
      status_rifei: "approved",
      status_detail_rifei: null,
      qtd_bilhetes: 1,
      numeros: null,
      subtotal_centavos: null,
      total_centavos: 2000,
      desconto_promocao_centavos: null,
      desconto_cupom_centavos: null,
      cupom_id: null,
      metodo_pagamento: null,
      rifinha: null,
      ddd: null,
      pais: null,
      utm: {
        source: null,
        campaign: null,
        medium: null,
        content: null,
        term: null,
      },
      criado_em: null,
      expira_em: null,
      aprovado_em: AGORA,
      expirado_em: null,
      registrado_em: AGORA,
      atualizado_em: AGORA,
    };
    expect(pedidoSchema.parse(linha)).toMatchObject({
      desconsiderado_em: null,
      desconsiderado_motivo: null,
      desconsiderado_observacao: null,
    });
    expect(
      pedidoSchema.parse({
        ...linha,
        desconsiderado_em: AGORA,
        desconsiderado_motivo: "teste",
      }).desconsiderado_motivo,
    ).toBe("teste");
    expect(
      aceita(pedidoSchema, { ...linha, desconsiderado_motivo: "cancelado" }),
    ).toBe(false);
  });

  it("409 acao_desligada diz a chave desligada", () => {
    expect(STATUS_HTTP_DO_ERRO.acao_desligada).toBe(409);
    expect(CHAVES_REGRAS).toEqual([
      "pedidos.desconsiderar",
      "acesso.discipuladores",
      "acesso.redes",
    ]);
    for (const chave of CHAVES_REGRAS)
      expect(detalhesAcaoDesligadaSchema.parse({ chave })).toEqual({ chave });
    expect(aceita(detalhesAcaoDesligadaSchema, { chave: "publico" })).toBe(
      false,
    );
  });
});

describe("RIFA-031: remover afiliado", () => {
  it("409 afiliado_com_pedidos: quantos contam e os ids dos mais recentes (até o limite)", () => {
    expect(STATUS_HTTP_DO_ERRO.afiliado_com_pedidos).toBe(409);
    const detalhes = {
      pedidos_que_contam: 25,
      pedidos: Array.from(
        { length: LIMITE_PEDIDOS_NO_DETALHE },
        (_, i) => `P${i}`,
      ),
    };
    expect(detalhesAfiliadoComPedidosSchema.parse(detalhes)).toEqual(detalhes);
    for (const errado of [
      { pedidos_que_contam: 0, pedidos: ["P1"] },
      { pedidos_que_contam: 1, pedidos: [] },
      { pedidos_que_contam: 1, pedidos: ["P1", "P2"] },
      {
        pedidos_que_contam: 99,
        pedidos: Array.from(
          { length: LIMITE_PEDIDOS_NO_DETALHE + 1 },
          (_, i) => `P${i}`,
        ),
      },
      { pedidos_que_contam: 1, pedidos: ["P1"], affiliate_id: 3 },
    ])
      expect(aceita(detalhesAfiliadoComPedidosSchema, errado)).toBe(false);
  });
});

describe("D20: o catálogo das rotas novas", () => {
  const definicoes = Object.values(ROTAS_REGRAS_CAMPANHA);

  it("desconsiderar, reconsiderar e remover afiliado: só admin, no grupo da coordenação, sob /api/admin", () => {
    expect(
      definicoes.map((rota) => `${rota.metodo} ${rota.caminho}`).sort(),
    ).toEqual(
      [
        "POST /api/admin/pedidos/desconsiderar",
        "POST /api/admin/pedidos/reconsiderar",
        "DELETE /api/admin/afiliados/:affiliateId",
      ].sort(),
    );
    for (const rota of definicoes) {
      expect(rota.papeis).toEqual(["admin"]);
      expect(rota.grupo).toBe("coordenacao");
      expect(rota.situacao).toBe("detalhada");
      expect(rota.caminho.startsWith("/api/admin/")).toBe(true);
      expect(rota.sucesso.status === 204).toBe(rota.sucesso.corpo === null);
    }
    expect(ROTAS_REGRAS_CAMPANHA.desconsiderarPedido.sucesso.corpo).toBe(
      itemPedidoSchema,
    );
    expect(ROTAS_REGRAS_CAMPANHA.reconsiderarPedido.sucesso.corpo).toBe(
      itemPedidoSchema,
    );
    expect(ROTAS_REGRAS_CAMPANHA.removerAfiliado.sucesso).toEqual({
      status: 204,
      corpo: null,
    });
  });

  it("não repete rota de nenhum outro catálogo, e o id do pedido vai no corpo (nunca na URL)", () => {
    const existentes = new Set(
      [
        ...Object.values(ROTAS),
        ...Object.values(ROTAS_ACESSO),
        ...Object.values(ROTAS_ACESSO_HIERARQUIA),
      ].map((rota) => `${rota.metodo} ${rota.caminho}`),
    );
    for (const rota of definicoes)
      expect(existentes.has(`${rota.metodo} ${rota.caminho}`)).toBe(false);
    for (const rota of [
      ROTAS_REGRAS_CAMPANHA.desconsiderarPedido,
      ROTAS_REGRAS_CAMPANHA.reconsiderarPedido,
    ])
      expect(rota.caminho).not.toContain(":");
  });

  it("o index exporta o catálogo, os padrões e o preenchimento das mensagens", () => {
    expect(contrato.ROTAS_REGRAS_CAMPANHA).toBe(ROTAS_REGRAS_CAMPANHA);
    expect(contrato.MENSAGENS_PADRAO).toBe(MENSAGENS_PADRAO);
    expect(contrato.preencherMensagem).toBe(preencherMensagem);
  });
});

describe("D20: erros e trilha", () => {
  it("os três códigos novos estão no catálogo com o status certo", () => {
    expect(CODIGOS_ERRO).toEqual(
      expect.arrayContaining([
        "acao_desligada",
        "acesso_desligado",
        "afiliado_com_pedidos",
      ]),
    );
    expect({
      acao_desligada: STATUS_HTTP_DO_ERRO.acao_desligada,
      acesso_desligado: STATUS_HTTP_DO_ERRO.acesso_desligado,
      afiliado_com_pedidos: STATUS_HTTP_DO_ERRO.afiliado_com_pedidos,
    }).toEqual({
      acao_desligada: 409,
      acesso_desligado: 403,
      afiliado_com_pedidos: 409,
    });
  });

  it("as ações novas na trilha e o alvo do pedido (só `pedido` quando o id não cabe nos 64 caracteres)", () => {
    expect(ACOES_AUDITORIA).toEqual(
      expect.arrayContaining([
        "pedido.desconsiderar",
        "pedido.reconsiderar",
        "afiliado.remover",
      ]),
    );
    expect(alvoDoPedidoNaAuditoria("PEDFIC0001")).toBe("pedido:PEDFIC0001");
    const cabe = "x".repeat(LIMITE_ALVO_AUDITORIA - "pedido:".length);
    expect(alvoDoPedidoNaAuditoria(cabe)).toBe(`pedido:${cabe}`);
    expect(alvoDoPedidoNaAuditoria(`${cabe}x`)).toBe("pedido");
  });
});

describe("D20: a conferência pelo CSV (RIFA-012) e o pedido desconsiderado", () => {
  it("o desconsiderado vai para um grupo à parte, com o lado do arquivo, o do sistema e a desconsideração", () => {
    const item = {
      pedido_id: "PEDTESTE0001",
      arquivo: {
        status: "aprovado",
        qtd_bilhetes: 2,
        total_centavos: 4000,
        afiliado: "reconhecido",
        affiliate_id: 1001,
        celula: { id: 1, nome: "Célula Ficticia 01" },
        data: "2026-11-24",
      },
      sistema: {
        status: "approved",
        qtd_bilhetes: 2,
        total_centavos: 4000,
        affiliate_id: 1001,
        celula: { id: 1, nome: "Célula Ficticia 01" },
        aprovado_em: AGORA,
        origem: "webhook",
      },
      desconsiderado: { motivo: "teste", observacao: null, em: AGORA },
    };
    const grupo = { quantidade: 1, itens: [item], itens_omitidos: 0 };
    expect(grupoDesconsideradosSchema.parse(grupo)).toEqual(grupo);
    expect(
      aceita(grupoDesconsideradosSchema, {
        ...grupo,
        itens: [{ ...item, desconsiderado: null }],
      }),
    ).toBe(false);
  });
});
