// buscarCampanhaAtiva: a única leitura da campanha ativa, usada pelo webhook (D5) e pela
// configuração (GET e PUT /api/admin/campanha).
import { env } from "cloudflare:workers";
import { beforeEach, describe, expect, it } from "vitest";
import {
  ACESSO_PADRAO,
  MENSAGENS_PADRAO,
  PEDIDOS_PADRAO,
  corpoSalvarCampanhaSchema,
  type CampanhaEntrada,
} from "../../shared/contracts";
import {
  buscarCampanhaAtiva,
  montarCampanha,
  resumirMudancaDaCampanha,
  salvarCampanhaAtiva,
} from "./campanha";

const db = env.DB;

/** Campanha gravada à mão, como nas fixtures do webhook (sem períodos); devolve o id. */
async function inserirCampanha(slug: string, ativa: 0 | 1): Promise<number> {
  const linha = await db
    .prepare(
      `INSERT INTO campanhas (nome, slug_rifei, ativa, data_inicio, preco_bilhete_centavos,
         meta_unidade, meta_regra, meta_valor, ranking_criterio)
       VALUES ('Campanha de teste', ?1, ?2, '2026-11-23', 2000, 'bilhetes', 'por_pessoa', 10,
         'percentual_meta')
       RETURNING id`,
    )
    .bind(slug, ativa)
    .first<{ id: number }>();
  if (!linha) throw new Error("campanha de teste não gravada");
  return linha.id;
}

beforeEach(async () => {
  await db.batch([
    db.prepare("DELETE FROM campanha_periodos"),
    db.prepare("DELETE FROM campanhas"),
  ]);
});

describe("buscarCampanhaAtiva", () => {
  it("null sem campanha ativa: uma campanha inativa não conta", async () => {
    expect(await buscarCampanhaAtiva(db)).toBeNull();

    await inserirCampanha("campanha-inativa-teste", 0);

    expect(await buscarCampanhaAtiva(db)).toBeNull();
  });

  it("campanha ativa sem períodos (gravada à mão): devolve a linha, com periodos vazio", async () => {
    await inserirCampanha("campanha-inativa-teste", 0);
    const id = await inserirCampanha("campanha-ativa-teste", 1);

    expect(await buscarCampanhaAtiva(db)).toEqual({
      id,
      nome: "Campanha de teste",
      slug_rifei: "campanha-ativa-teste",
      fuso_horario: "America/Belem",
      data_inicio: "2026-11-23",
      preco_bilhete_centavos: 2000,
      meta_unidade: "bilhetes",
      meta_regra: "por_pessoa",
      meta_valor: 10,
      ranking_criterio: "percentual_meta",
      publico_mostra_percentual_meta: 0,
      publico_limite_ranking: 3,
      // 0008 (D20): os padrões das colunas (chave de desconsiderar desligada, acessos ligados, modelos padrão).
      pedidos_desconsiderar: 0,
      acesso_discipuladores: 1,
      acesso_redes: 1,
      mensagem_link_coordenacao: null,
      mensagem_link_lider: null,
      mensagem_link_discipulador: null,
      mensagem_link_rede: null,
      // 0013 (RIFA-064, D29): o login das células com a senha padrão nasce ligado.
      acesso_celulas_senha: 1,
      criado_em: expect.stringMatching(/Z$/),
      atualizado_em: expect.stringMatching(/Z$/),
      periodos: [],
    });
  });

  it("períodos na ordem, mesmo gravados fora dela; nomes com aspas e acentos chegam intactos", async () => {
    const id = await inserirCampanha("campanha-ativa-teste", 1);
    await db.batch(
      [
        [3, "Reta final", 7, 4500],
        [1, 'Semana "1": ação', 10, 3500],
        [2, "Semana 2", 7, 2500],
      ].map((valores) =>
        db
          .prepare(
            `INSERT INTO campanha_periodos (campanha_id, ordem, nome, dias, percentual_bp)
             VALUES (?, ?, ?, ?, ?)`,
          )
          .bind(id, ...valores),
      ),
    );

    expect((await buscarCampanhaAtiva(db))?.periodos).toEqual([
      { ordem: 1, nome: 'Semana "1": ação', dias: 10, percentual_bp: 3500 },
      { ordem: 2, nome: "Semana 2", dias: 7, percentual_bp: 2500 },
      { ordem: 3, nome: "Reta final", dias: 7, percentual_bp: 4500 },
    ]);
  });

  it("é a mesma leitura da configuração: montada no contrato, dá a resposta do PUT", async () => {
    const salvo = await salvarCampanhaAtiva(
      db,
      corpoSalvarCampanhaSchema.parse({
        nome: "Rifa de teste",
        slug_rifei: "rifa-teste",
        data_inicio: "2026-11-23",
        preco_bilhete_centavos: 2000,
        meta: { unidade: "bilhetes", regra: "por_pessoa", valor: 10 },
        periodos: [
          { nome: "Período 1", dias: 10, percentual_bp: 3500 },
          { nome: "Período 2", dias: 7, percentual_bp: 2500 },
        ],
        ranking: { criterio: "percentual_meta" },
      }),
    );
    if (!salvo.ok) throw new Error("a campanha de teste não foi salva");

    const ativa = await buscarCampanhaAtiva(db);

    expect(ativa).toMatchObject({
      id: salvo.campanha.id,
      slug_rifei: "rifa-teste",
    });
    expect(ativa && montarCampanha(ativa)).toEqual(salvo.campanha);
  });

  it("é um comando só, sem db.batch: o webhook lê a ativa antes da própria transação, como antes", async () => {
    const id = await inserirCampanha("campanha-ativa-teste", 1);
    const semBatch = new Proxy(db, {
      get(alvo, propriedade) {
        if (propriedade === "batch") {
          throw new Error("a leitura da campanha ativa não deve usar db.batch");
        }
        const valor: unknown = Reflect.get(alvo, propriedade, alvo);
        return typeof valor === "function" ? valor.bind(alvo) : valor;
      },
    });

    expect(await buscarCampanhaAtiva(semBatch)).toMatchObject({
      id,
      slug_rifei: "campanha-ativa-teste",
    });
  });
});

describe("regras do admin na campanha (D20, migração 0008)", () => {
  const BASE: CampanhaEntrada = {
    nome: "Rifa de teste",
    slug_rifei: "rifa-teste",
    data_inicio: "2026-11-23",
    preco_bilhete_centavos: 2000,
    meta: { unidade: "bilhetes", regra: "por_pessoa", valor: 10 },
    periodos: [{ nome: "Período 1", dias: 10, percentual_bp: 10000 }],
    ranking: { criterio: "percentual_meta" },
  };
  const MENSAGEM_LIDER =
    "{saudacao} Segue o link da célula {alvo}, só seu:\n{link}";

  async function salvar(corpo: CampanhaEntrada) {
    const salvo = await salvarCampanhaAtiva(
      db,
      corpoSalvarCampanhaSchema.parse(corpo),
    );
    if (!salvo.ok) throw new Error(salvo.mensagem);
    return salvo.campanha;
  }
  const colunas = () =>
    db
      .prepare(
        `SELECT pedidos_desconsiderar, acesso_discipuladores, acesso_redes, mensagem_link_coordenacao,
           mensagem_link_lider, mensagem_link_discipulador, mensagem_link_rede
         FROM campanhas WHERE ativa = 1`,
      )
      .first();

  it("o primeiro PUT sem os grupos: os padrões (desconsiderar desligado, acessos ligados, os modelos de hoje)", async () => {
    const campanha = await salvar(BASE);
    expect({
      pedidos: campanha.pedidos,
      acesso: campanha.acesso,
      mensagens: campanha.mensagens,
    }).toEqual({
      pedidos: PEDIDOS_PADRAO,
      acesso: ACESSO_PADRAO,
      mensagens: MENSAGENS_PADRAO,
    });
    expect(await colunas()).toEqual({
      pedidos_desconsiderar: 0,
      acesso_discipuladores: 1,
      acesso_redes: 1,
      mensagem_link_coordenacao: null,
      mensagem_link_lider: null,
      mensagem_link_discipulador: null,
      mensagem_link_rede: null,
    });
  });

  it("grupo presente substitui o grupo inteiro; grupo ausente mantém o gravado (uma aba antiga não religa nada)", async () => {
    await salvar(BASE);
    const mensagens = { ...MENSAGENS_PADRAO, link_lider: MENSAGEM_LIDER };
    const gravada = await salvar({
      ...BASE,
      pedidos: { desconsiderar: true },
      acesso: { discipuladores: true, redes: false },
      mensagens,
    });
    expect({
      pedidos: gravada.pedidos,
      acesso: gravada.acesso,
      mensagens: gravada.mensagens,
    }).toEqual({
      pedidos: { desconsiderar: true },
      // RIFA-064 (D29): a chave do login das células com senha, ausente no corpo, fica com o padrão (ligada).
      acesso: { discipuladores: true, redes: false, celulas_senha: true },
      mensagens,
    });
    // O modelo igual ao padrão fica NULL (= o padrão); o editado, com o texto.
    expect(await colunas()).toEqual({
      pedidos_desconsiderar: 1,
      acesso_discipuladores: 1,
      acesso_redes: 0,
      mensagem_link_coordenacao: null,
      mensagem_link_lider: MENSAGEM_LIDER,
      mensagem_link_discipulador: null,
      mensagem_link_rede: null,
    });

    // Sem os grupos (o corpo de uma aba antiga): nada muda neles.
    const semGrupos = await salvar({ ...BASE, nome: "Rifa renomeada" });
    expect(semGrupos).toMatchObject({
      nome: "Rifa renomeada",
      pedidos: { desconsiderar: true },
      acesso: { discipuladores: true, redes: false },
      mensagens,
    });

    // Só o acesso: os outros grupos ficam; o acesso inteiro é o novo.
    const soAcesso = await salvar({
      ...BASE,
      acesso: { discipuladores: false, redes: true },
    });
    expect(soAcesso).toMatchObject({
      pedidos: { desconsiderar: true },
      acesso: { discipuladores: false, redes: true },
      mensagens,
    });

    // As mensagens de volta ao padrão: NULL de novo nas quatro.
    await salvar({ ...BASE, mensagens: MENSAGENS_PADRAO });
    expect(await colunas()).toMatchObject({
      mensagem_link_coordenacao: null,
      mensagem_link_lider: null,
      mensagem_link_discipulador: null,
      mensagem_link_rede: null,
    });
  });

  it("um modelo gravado fora das regras (SQL à mão) não derruba a leitura: volta como está (só o tamanho é conferido)", async () => {
    await salvar(BASE);
    await db
      .prepare(
        "UPDATE campanhas SET mensagem_link_rede = 'Oi {Nome}, sem o link' WHERE ativa = 1",
      )
      .run();
    const ativa = await buscarCampanhaAtiva(db);
    expect(ativa && montarCampanha(ativa).mensagens.link_rede).toBe(
      "Oi {Nome}, sem o link",
    );
  });

  it("RIFA-043: a trilha do primeiro salvamento diz como as regras nasceram (as chaves e o nome das mensagens editadas)", () => {
    const criacao = (corpo: CampanhaEntrada) =>
      resumirMudancaDaCampanha(null, corpoSalvarCampanhaSchema.parse(corpo));
    const PADROES =
      "pedidos.desconsiderar: desligado, acesso.discipuladores: ligado, acesso.redes: ligado, acesso.celulas_senha: ligado";

    // Sem os grupos (a coordenação, ou um admin que não mexeu): os padrões que o INSERT grava, sem mensagem.
    expect(criacao(BASE)).toBe(
      `Campanha criada: slug_rifei "rifa-teste", preco_bilhete_centavos 2000, ${PADROES}`,
    );
    // Os grupos iguais aos padrões: o mesmo resumo (as mensagens iguais ao padrão não são "editadas").
    expect(
      criacao({
        ...BASE,
        pedidos: PEDIDOS_PADRAO,
        acesso: ACESSO_PADRAO,
        mensagens: MENSAGENS_PADRAO,
      }),
    ).toBe(
      `Campanha criada: slug_rifei "rifa-teste", preco_bilhete_centavos 2000, ${PADROES}`,
    );
    // As chaves com o valor do corpo; das mensagens, só o nome de cada modelo diferente do padrão, na ordem do
    // contrato, e nunca o texto.
    const resumo = criacao({
      ...BASE,
      slug_rifei: 'rifa "aspas"',
      pedidos: { desconsiderar: true },
      acesso: { discipuladores: false, redes: false },
      mensagens: {
        ...MENSAGENS_PADRAO,
        link_rede: `${MENSAGENS_PADRAO.link_rede} Obrigado!`,
        link_coordenacao: `Equipe: {link}`,
      },
    });
    expect(resumo).toBe(
      'Campanha criada: slug_rifei "rifa \\"aspas\\"", preco_bilhete_centavos 2000, pedidos.desconsiderar: ligado, acesso.discipuladores: desligado, acesso.redes: desligado, acesso.celulas_senha: ligado, mensagens.link_coordenacao, mensagens.link_rede',
    );
    expect(resumo).not.toContain("Obrigado");
    expect(resumo).not.toContain("Equipe");
  });

  it("a trilha: cada chave com o antes e o depois; das mensagens, só o nome do modelo; grupo ausente ou igual não entra", async () => {
    await salvar(BASE);
    const antes = await buscarCampanhaAtiva(db);
    const resumo = (corpo: CampanhaEntrada) =>
      resumirMudancaDaCampanha(antes, corpoSalvarCampanhaSchema.parse(corpo));

    expect(resumo(BASE)).toBe("Configuração salva sem mudanças");
    expect(
      resumo({
        ...BASE,
        pedidos: PEDIDOS_PADRAO,
        acesso: ACESSO_PADRAO,
        mensagens: MENSAGENS_PADRAO,
      }),
    ).toBe("Configuração salva sem mudanças");
    expect(
      resumo({
        ...BASE,
        nome: "Outra",
        pedidos: { desconsiderar: true },
        acesso: { discipuladores: true, redes: false },
        mensagens: {
          ...MENSAGENS_PADRAO,
          link_lider: MENSAGEM_LIDER,
          link_rede: `${MENSAGENS_PADRAO.link_rede} Obrigado!`,
        },
      }),
    ).toBe(
      "Alterado: nome, pedidos.desconsiderar: desligado → ligado, acesso.redes: ligado → desligado, mensagens.link_lider, mensagens.link_rede",
    );
  });
});
