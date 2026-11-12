// RIFA-039 (D21): a gravação do token do webhook gerado pela tela e a trilha num lote só, sob a mesma condição; as
// leituras do webhook e da tela. O D1 é deste arquivo: o beforeEach apaga a linha do token e a trilha.
import { env } from "cloudflare:workers";
import { beforeEach, describe, expect, it } from "vitest";
import { ALVO_AUDITORIA_TOKEN_WEBHOOK } from "../../shared/contracts";
import { gerarTokenWebhook, sha256Hex } from "../lib/cripto";
import { criarAcessoNoBanco } from "../test/acesso-teste";
import type { Autoria } from "./auditoria";
import {
  RESUMOS_TOKEN_WEBHOOK,
  gravarTokenWebhook,
  lerGeradoEmDoTokenWebhook,
  lerHashDoTokenWebhook,
  lerTokenWebhookParaATela,
} from "./token-webhook";

const db = env.DB;

let admin: { usuarioId: number };

/** Autoria do admin no instante dado (o mesmo grava `gerado_em`). */
const por = (em: string): Autoria => ({ usuarioId: admin.usuarioId, em });

async function linhaDoToken() {
  return db
    .prepare("SELECT id, token_hash, gerado_em FROM token_webhook")
    .all<{ id: number; token_hash: string; gerado_em: string }>()
    .then((resultado) => resultado.results);
}

async function trilha() {
  return db
    .prepare(
      "SELECT usuario_id, em, acao, alvo, resumo FROM auditoria WHERE acao = 'webhook.gerar_token' ORDER BY id",
    )
    .all()
    .then((resultado) => resultado.results);
}

beforeEach(async () => {
  await db.batch([
    db.prepare("DELETE FROM token_webhook"),
    db.prepare("DELETE FROM auditoria"),
  ]);
  admin = await criarAcessoNoBanco("admin");
});

describe("gravarTokenWebhook: a gravação e a trilha num lote só, sob a mesma condição (D21, OBRIGATÓRIO 5)", () => {
  it("sem token da tela e sem substituir: grava o hash e a trilha juntos ('não havia credencial')", async () => {
    const hash = await sha256Hex(gerarTokenWebhook());

    expect(
      await gravarTokenWebhook(
        db,
        { tokenHash: hash, substituir: false, segredoConfigurado: false },
        por("2026-11-12T10:00:00.000Z"),
      ),
    ).toBe(true);

    expect(await linhaDoToken()).toEqual([
      { id: 1, token_hash: hash, gerado_em: "2026-11-12T10:00:00.000Z" },
    ]);
    expect(await trilha()).toEqual([
      {
        usuario_id: admin.usuarioId,
        em: "2026-11-12T10:00:00.000Z",
        acao: "webhook.gerar_token",
        alvo: ALVO_AUDITORIA_TOKEN_WEBHOOK,
        resumo: "Token do webhook gerado pela tela; não havia credencial",
      },
    ]);
  });

  it("sem substituir e com um token da tela já gravado (outra aba gerou no meio): false, nada muda e a trilha não registra", async () => {
    const primeiro = await sha256Hex(gerarTokenWebhook());
    await gravarTokenWebhook(
      db,
      { tokenHash: primeiro, substituir: false, segredoConfigurado: false },
      por("2026-11-12T10:00:00.000Z"),
    );

    expect(
      await gravarTokenWebhook(
        db,
        {
          tokenHash: await sha256Hex(gerarTokenWebhook()),
          substituir: false,
          segredoConfigurado: false,
        },
        por("2026-11-12T10:00:01.000Z"),
      ),
    ).toBe(false);

    expect(await linhaDoToken()).toEqual([
      { id: 1, token_hash: primeiro, gerado_em: "2026-11-12T10:00:00.000Z" },
    ]);
    expect(await trilha()).toHaveLength(1);
  });

  it("com substituir: o UPSERT troca a linha e o resumo traz o gerado_em do anterior, lido dentro do lote", async () => {
    await gravarTokenWebhook(
      db,
      {
        tokenHash: await sha256Hex(gerarTokenWebhook()),
        substituir: false,
        segredoConfigurado: true,
      },
      por("2026-11-12T10:00:00.000Z"),
    );
    const novo = await sha256Hex(gerarTokenWebhook());

    expect(
      await gravarTokenWebhook(
        db,
        { tokenHash: novo, substituir: true, segredoConfigurado: true },
        por("2026-11-12T11:30:00.123Z"),
      ),
    ).toBe(true);

    expect(await linhaDoToken()).toEqual([
      { id: 1, token_hash: novo, gerado_em: "2026-11-12T11:30:00.123Z" },
    ]);
    expect((await trilha()).map((linha) => linha.resumo)).toEqual([
      // A primeira (sem token da tela, com o segredo) diz que o segredo deixou de valer.
      RESUMOS_TOKEN_WEBHOOK.segredo,
      "Token do webhook gerado pela tela; o token anterior, gerado em 2026-11-12T10:00:00.000Z, deixou de valer",
    ]);
  });

  it("com substituir e sem token da tela: o resumo diz o segredo do Worker ou 'não havia credencial'", async () => {
    await gravarTokenWebhook(
      db,
      {
        tokenHash: await sha256Hex(gerarTokenWebhook()),
        substituir: true,
        segredoConfigurado: true,
      },
      por("2026-11-12T10:00:00.000Z"),
    );
    await db.prepare("DELETE FROM token_webhook").run();
    await gravarTokenWebhook(
      db,
      {
        tokenHash: await sha256Hex(gerarTokenWebhook()),
        substituir: true,
        segredoConfigurado: false,
      },
      por("2026-11-12T10:05:00.000Z"),
    );

    expect((await trilha()).map((linha) => linha.resumo)).toEqual([
      "Token do webhook gerado pela tela; o segredo do Worker deixou de valer",
      "Token do webhook gerado pela tela; não havia credencial",
    ]);
  });

  it("atômico: se a gravação do token falha (o CHECK do hash), a trilha também não fica, e o token anterior continua", async () => {
    const anterior = await sha256Hex(gerarTokenWebhook());
    await gravarTokenWebhook(
      db,
      { tokenHash: anterior, substituir: false, segredoConfigurado: false },
      por("2026-11-12T10:00:00.000Z"),
    );
    const token = gerarTokenWebhook();

    // O token cru no lugar do hash tem o mesmo formato (64 hex) e passaria; maiúsculo, não.
    await expect(
      gravarTokenWebhook(
        db,
        {
          tokenHash: token.toUpperCase(),
          substituir: true,
          segredoConfigurado: false,
        },
        por("2026-11-12T10:10:00.000Z"),
      ),
    ).rejects.toThrow(/CHECK constraint failed/);

    expect(await linhaDoToken()).toEqual([
      { id: 1, token_hash: anterior, gerado_em: "2026-11-12T10:00:00.000Z" },
    ]);
    expect(await trilha()).toHaveLength(1);
  });

  it("a trilha nunca traz o token nem o hash, em nenhum dos resumos", async () => {
    const tokens: string[] = [];
    const hashes: string[] = [];
    for (const [indice, gravacao] of [
      { substituir: false, segredoConfigurado: false },
      { substituir: true, segredoConfigurado: false },
      { substituir: true, segredoConfigurado: true },
    ].entries()) {
      const token = gerarTokenWebhook();
      tokens.push(token);
      hashes.push(await sha256Hex(token));
      await gravarTokenWebhook(
        db,
        { ...gravacao, tokenHash: hashes[indice] },
        por(`2026-11-12T10:0${indice}:00.000Z`),
      );
    }

    const texto = JSON.stringify(await trilha());
    expect(texto).toContain("webhook.gerar_token");
    for (const segredo of [...tokens, ...hashes])
      expect(texto).not.toContain(segredo);
  });
});

describe("leituras", () => {
  it("o webhook lê só o hash; a tela, só o gerado_em (e a última entrega); null sem token da tela", async () => {
    expect(await lerHashDoTokenWebhook(db)).toBeNull();
    expect(await lerGeradoEmDoTokenWebhook(db)).toBeNull();

    const hash = await sha256Hex(gerarTokenWebhook());
    await gravarTokenWebhook(
      db,
      { tokenHash: hash, substituir: false, segredoConfigurado: false },
      por("2026-11-12T10:00:00.000Z"),
    );
    await db.batch([
      db.prepare("DELETE FROM webhook_eventos"),
      db.prepare(
        `INSERT INTO webhook_eventos (recebido_em, evento, pedido_id, slug, resultado, payload_redigido)
         VALUES ('2026-11-12T10:05:00.000Z', 'new_order', 'PED-LEITURA-1', 'outra', 'ignorado_outra_campanha', '{}')`,
      ),
    ]);

    expect(await lerHashDoTokenWebhook(db)).toBe(hash);
    expect(await lerGeradoEmDoTokenWebhook(db)).toBe(
      "2026-11-12T10:00:00.000Z",
    );
    expect(await lerTokenWebhookParaATela(db)).toEqual({
      geradoEm: "2026-11-12T10:00:00.000Z",
      ultimaEntregaEm: "2026-11-12T10:05:00.000Z",
    });
  });
});
