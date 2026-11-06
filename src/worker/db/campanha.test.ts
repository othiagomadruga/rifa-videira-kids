// buscarCampanhaAtiva: a única leitura da campanha ativa, usada pelo webhook (D5) e pela
// configuração (GET e PUT /api/admin/campanha).
import { env } from "cloudflare:workers";
import { beforeEach, describe, expect, it } from "vitest";
import { corpoSalvarCampanhaSchema } from "../../shared/contracts";
import {
  buscarCampanhaAtiva,
  montarCampanha,
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
