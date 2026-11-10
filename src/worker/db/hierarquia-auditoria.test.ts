// RIFA-018: a trilha do CRUD da hierarquia quando outra gravação muda a linha (ou o acesso do alvo) entre a leitura e
// o lote. O PUT e o DELETE só gravam, e só registram, se a linha ainda é a lida; senão leem de novo e refazem. O
// resumo descreve sempre o que mudou de fato (o "antes" certo, o acesso que caiu junto); depois de
// TENTATIVAS_GRAVACAO lotes sem sucesso, 409 em_uso e nada gravado.
import { env } from "cloudflare:workers";
import { beforeAll, beforeEach, describe, expect, it } from "vitest";
import {
  criarAcessoDaHierarquiaNoBanco,
  criarAcessoNoBanco,
} from "../test/acesso-teste";
import { limparHierarquia } from "../test/hierarquia-apoio";
import type { Autoria } from "./auditoria";
import {
  atualizarCelula,
  criarCelula,
  criarDiscipulador,
  criarRede,
  removerCelula,
  type DadosCelula,
} from "./hierarquia";

let usuarioId: number;
const autoria = (): Autoria => ({
  usuarioId,
  em: new Date().toISOString(),
});

/** O D1 dos testes, mas com `antes` rodando antes de cada lote (até `vezes` lotes): a gravação concorrente. */
function bancoComConcorrente(
  antes: (lote: number) => Promise<unknown>,
  vezes = 1,
): { db: D1Database; lotes: () => number } {
  let lotes = 0;
  const db = new Proxy(env.DB, {
    get(alvo, nome) {
      if (nome === "batch")
        return async (comandos: D1PreparedStatement[]) => {
          lotes += 1;
          if (lotes <= vezes) await antes(lotes);
          return alvo.batch(comandos);
        };
      const valor: unknown = Reflect.get(alvo, nome, alvo);
      return typeof valor === "function" ? valor.bind(alvo) : valor;
    },
  });
  return { db, lotes: () => lotes };
}

/** O id da última linha da trilha antes do teste: os ids da hierarquia voltam depois da limpeza (sem AUTOINCREMENT). */
let marca = 0;

/** O que o teste deixou na trilha para o alvo. */
async function trilhaDo(alvo: string) {
  const { results } = await env.DB.prepare(
    "SELECT acao, resumo FROM auditoria WHERE alvo = ?1 AND id > ?2 ORDER BY id",
  )
    .bind(alvo, marca)
    .all<{ acao: string; resumo: string }>();
  return results;
}

let celula: { id: number; discipulador_id: number };
let dados: DadosCelula;

beforeAll(async () => {
  usuarioId = (await criarAcessoNoBanco("admin")).usuarioId;
});

beforeEach(async () => {
  await limparHierarquia();
  marca = (await env.DB.prepare(
    "SELECT coalesce(max(id), 0) AS id FROM auditoria",
  ).first<{ id: number }>())!.id;
  const rede = await criarRede(env.DB, {
    nome: "Rede da Corrida",
    divisao: "jovens",
    responsavel_nome: null,
  });
  if (!rede.ok) throw new Error("rede");
  const discipulador = await criarDiscipulador(env.DB, {
    rede_id: rede.valor.id,
    nome: "Discipulador da Corrida",
  });
  if (!discipulador.ok) throw new Error("discipulador");
  dados = {
    discipulador_id: discipulador.valor.id,
    nome: "Celula da Corrida",
    qtd_pessoas: 12,
    lider_nome: "Lider Ficticio da Corrida",
    lider_email: null,
    lider_telefone: null,
  };
  const criada = await criarCelula(env.DB, dados);
  if (!criada.ok) throw new Error("célula");
  celula = criada.valor;
});

const mudarQtd = (qtd: number) =>
  env.DB.prepare("UPDATE celulas SET qtd_pessoas = ?2 WHERE id = ?1")
    .bind(celula.id, qtd)
    .run();

describe("PUT com outra gravação no meio", () => {
  it("a linha mudou entre a leitura e o lote: refaz, e o resumo tem o antes que estava gravado de fato", async () => {
    const { db, lotes } = bancoComConcorrente(() => mudarQtd(20));

    const resultado = await atualizarCelula(
      db,
      celula.id,
      { ...dados, qtd_pessoas: 15 },
      autoria(),
    );

    expect(lotes()).toBe(2);
    expect(resultado).toMatchObject({ ok: true, valor: { qtd_pessoas: 15 } });
    expect(await trilhaDo(`celula:${celula.id}`)).toEqual([
      {
        acao: "hierarquia.atualizar",
        resumo: 'Célula "Celula da Corrida" alterada: qtd_pessoas (20 → 15)',
      },
    ]);
  });

  it("a outra gravação já deixou como o PUT pede: refaz sem mudança e não registra", async () => {
    const { db, lotes } = bancoComConcorrente(() => mudarQtd(15));

    const resultado = await atualizarCelula(
      db,
      celula.id,
      { ...dados, qtd_pessoas: 15 },
      autoria(),
    );

    expect(lotes()).toBe(2);
    expect(resultado.ok).toBe(true);
    expect(await trilhaDo(`celula:${celula.id}`)).toEqual([]);
  });

  it("muda a cada tentativa: 409 em_uso, nada gravado e nada registrado", async () => {
    const { db, lotes } = bancoComConcorrente(
      (lote) => mudarQtd(20 + lote),
      Infinity,
    );

    const resultado = await atualizarCelula(
      db,
      celula.id,
      { ...dados, qtd_pessoas: 15 },
      autoria(),
    );

    expect(lotes()).toBe(3);
    expect(resultado).toEqual({
      ok: false,
      codigo: "em_uso",
      mensagem:
        "A célula mudou enquanto isso (outra alteração ao mesmo tempo) e nada foi gravado: atualize a página e tente de novo.",
    });
    const gravada = await env.DB.prepare(
      "SELECT qtd_pessoas FROM celulas WHERE id = ?1",
    )
      .bind(celula.id)
      .first();
    expect(gravada).toEqual({ qtd_pessoas: 23 });
    expect(await trilhaDo(`celula:${celula.id}`)).toEqual([]);
  });

  it("recusado pelo banco dentro do lote (o nome ou a referência mudou no meio): o registro, que vem antes do UPDATE, é desfeito junto", async () => {
    // Outra célula pega o nome depois da conferência: o UNIQUE barra o UPDATE no lote.
    const nome = bancoComConcorrente(() =>
      env.DB.prepare(
        `INSERT INTO celulas (discipulador_id, nome, qtd_pessoas, lider_nome)
         VALUES (?1, 'Celula Disputada', 5, 'Lider Ficticio')`,
      )
        .bind(celula.discipulador_id)
        .run(),
    );
    expect(
      await atualizarCelula(
        nome.db,
        celula.id,
        { ...dados, nome: "Celula Disputada", qtd_pessoas: 15 },
        autoria(),
      ),
    ).toMatchObject({ ok: false, codigo: "nome_duplicado" });

    // O discipulador novo some depois da conferência: a FK barra o UPDATE no lote.
    const outro = await criarDiscipulador(env.DB, {
      rede_id: (await env.DB.prepare(
        "SELECT rede_id FROM discipuladores WHERE id = ?1",
      )
        .bind(celula.discipulador_id)
        .first<{ rede_id: number }>())!.rede_id,
      nome: "Discipulador que Some",
    });
    if (!outro.ok) throw new Error("discipulador");
    const referencia = bancoComConcorrente(() =>
      env.DB.prepare("DELETE FROM discipuladores WHERE id = ?1")
        .bind(outro.valor.id)
        .run(),
    );
    expect(
      await atualizarCelula(
        referencia.db,
        celula.id,
        { ...dados, discipulador_id: outro.valor.id, qtd_pessoas: 15 },
        autoria(),
      ),
    ).toMatchObject({ ok: false, codigo: "referencia_invalida" });

    expect(
      await env.DB.prepare(
        "SELECT nome, discipulador_id, qtd_pessoas FROM celulas WHERE id = ?1",
      )
        .bind(celula.id)
        .first(),
    ).toEqual({
      nome: "Celula da Corrida",
      discipulador_id: celula.discipulador_id,
      qtd_pessoas: 12,
    });
    expect(await trilhaDo(`celula:${celula.id}`)).toEqual([]);
  });

  it("a linha sumiu entre a leitura e o lote: 404 e nada registrado", async () => {
    const { db } = bancoComConcorrente(() =>
      env.DB.prepare("DELETE FROM celulas WHERE id = ?1").bind(celula.id).run(),
    );

    const resultado = await atualizarCelula(
      db,
      celula.id,
      { ...dados, qtd_pessoas: 15 },
      autoria(),
    );

    expect(resultado).toMatchObject({ ok: false, codigo: "nao_encontrado" });
    expect(await trilhaDo(`celula:${celula.id}`)).toEqual([]);
  });
});

describe("DELETE com outra gravação no meio", () => {
  it("o alvo ganhou um acesso entre a leitura e o lote: refaz, e o resumo diz o acesso que caiu junto", async () => {
    let acessoId = 0;
    const { db, lotes } = bancoComConcorrente(async () => {
      acessoId = (await criarAcessoDaHierarquiaNoBanco("lider", celula.id))
        .usuarioId;
    });

    const resultado = await removerCelula(db, celula.id, autoria());

    expect(lotes()).toBe(2);
    expect(resultado).toEqual({ ok: true, valor: null });
    expect(await trilhaDo(`celula:${celula.id}`)).toEqual([
      {
        acao: "hierarquia.remover",
        resumo: `Célula "Celula da Corrida" removida (discipulador_id ${celula.discipulador_id}, qtd_pessoas 12); acesso do líder removido junto, usuário ${acessoId} (com os links e as sessões)`,
      },
    ]);
    expect(
      await env.DB.prepare("SELECT id FROM usuarios WHERE id = ?1")
        .bind(acessoId)
        .first(),
    ).toBeNull();
  });
});
