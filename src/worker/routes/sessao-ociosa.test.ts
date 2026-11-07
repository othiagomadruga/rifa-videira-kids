// RIFA-013b, item 4: a sessão sem uso há MAIS de 7 dias deixa de valer, mesmo dentro da validade de 45
// dias; o link pessoal continua abrindo uma sessão nova. O relógio do Worker é fixado (vi.useFakeTimers só
// no Date, que o app lê com new Date()) e o ultimo_uso_em é posto direto no banco, para as bordas exatas.
import { env } from "cloudflare:workers";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NOME_COOKIE_SESSAO } from "../../shared/contracts";
import {
  INATIVIDADE_MAXIMA_SESSAO_DIAS,
  limiteDeInatividade,
} from "../db/acessos";
import { sha256Hex } from "../lib/cripto";
import {
  chamar,
  cookieDaResposta,
  criarAcessoNoBanco,
  criarAppDeTeste,
  entrar,
  erro,
} from "../test/acesso-teste";

const DIA_MS = 24 * 60 * 60 * 1000;
const SETE_DIAS_MS = INATIVIDADE_MAXIMA_SESSAO_DIAS * DIA_MS;
const app = criarAppDeTeste();

let agora = Date.parse("2026-11-25T15:00:00.000Z");

function irPara(instante: number): void {
  agora = instante;
  vi.setSystemTime(instante);
}

async function gravarUltimoUso(sessao: string, instante: number) {
  await env.DB.prepare(
    "UPDATE sessoes SET ultimo_uso_em = ?2 WHERE id_hash = ?1",
  )
    .bind(await sha256Hex(sessao), new Date(instante).toISOString())
    .run();
}

async function ultimoUso(sessao: string): Promise<string | null> {
  const linha = await env.DB.prepare(
    "SELECT ultimo_uso_em FROM sessoes WHERE id_hash = ?1",
  )
    .bind(await sha256Hex(sessao))
    .first<{ ultimo_uso_em: string }>();
  return linha?.ultimo_uso_em ?? null;
}

/** Usuário novo com link (criado no instante atual) e uma sessão aberta pelo POST /api/sessao. */
async function entrarAgora() {
  const acesso = await criarAcessoNoBanco("coordenacao");
  return { ...acesso, sessao: await entrar(app, acesso.token) };
}

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date"] });
  irPara(agora + DIA_MS);
});

afterEach(() => {
  vi.useRealTimers();
});

describe("sessão parada há mais de 7 dias", () => {
  it("o limite é 7 dias antes do instante, ao milissegundo", () => {
    expect(INATIVIDADE_MAXIMA_SESSAO_DIAS).toBe(7);
    expect(limiteDeInatividade("2026-12-08T12:00:00.000Z")).toBe(
      "2026-12-01T12:00:00.000Z",
    );
  });

  it("borda: parada há exatamente 7 dias ainda vale (e o uso renova o ultimo_uso_em)", async () => {
    const { sessao } = await entrarAgora();
    await gravarUltimoUso(sessao, agora - SETE_DIAS_MS);

    const res = await chamar(app, "GET", "/api/sessao", { sessao });

    expect(res.status).toBe(200);
    expect(await ultimoUso(sessao)).toBe(new Date(agora).toISOString());
  });

  it("borda: parada há 7 dias e 1 ms já não vale: 401 e o cookie é expirado; o link abre uma sessão nova", async () => {
    const { sessao, token } = await entrarAgora();
    await gravarUltimoUso(sessao, agora - SETE_DIAS_MS - 1);

    const res = await chamar(app, "GET", "/api/sessao", { sessao });

    expect(res.status).toBe(401);
    expect(await res.json()).toEqual(erro("nao_autenticado"));
    expect(cookieDaResposta(res)).toMatchObject({
      valor: "",
      atributos: expect.arrayContaining(["Max-Age=0"]),
    });
    // As rotas da coordenação também recusam o mesmo cookie.
    const painel = await chamar(app, "GET", "/api/painel/exemplo", { sessao });
    expect(painel.status).toBe(401);

    // O link pessoal (45 dias) continua valendo: entra de novo e a sessão nova responde.
    const nova = await entrar(app, token);
    expect(nova).not.toBe(sessao);
    expect(
      (await chamar(app, "GET", "/api/sessao", { sessao: nova })).status,
    ).toBe(200);
  });

  it("quem usa a cada 6 dias continua conectado; 7 dias e 1 ms depois do último uso, não", async () => {
    const { sessao } = await entrarAgora();
    const inicio = agora;

    for (const dia of [6, 12, 18]) {
      irPara(inicio + dia * DIA_MS);
      const res = await chamar(app, "GET", "/api/sessao", { sessao });
      expect({ dia, status: res.status }).toEqual({ dia, status: 200 });
    }
    irPara(inicio + 18 * DIA_MS + SETE_DIAS_MS + 1);
    expect((await chamar(app, "GET", "/api/sessao", { sessao })).status).toBe(
      401,
    );
  });

  it("a validade de 45 dias continua valendo para quem usa sempre", async () => {
    const { sessao } = await entrarAgora();
    const inicio = agora;
    for (let dia = 5; dia < 45; dia += 5) {
      irPara(inicio + dia * DIA_MS);
      expect((await chamar(app, "GET", "/api/sessao", { sessao })).status).toBe(
        200,
      );
    }
    irPara(inicio + 45 * DIA_MS);
    expect((await chamar(app, "GET", "/api/sessao", { sessao })).status).toBe(
      401,
    );
  });

  it("a administração não conta a sessão parada como ativa, e o login seguinte a apaga do banco", async () => {
    const admin = await entrarAgora();
    // A sessão do admin precisa ser de admin para listar: promove direto no banco.
    await env.DB.prepare("UPDATE usuarios SET papel = 'admin' WHERE id = ?1")
      .bind(admin.usuarioId)
      .run();
    const pessoa = await entrarAgora();
    await gravarUltimoUso(pessoa.sessao, agora - SETE_DIAS_MS - 1);

    const lista = await chamar(app, "GET", "/api/admin/usuarios", {
      sessao: admin.sessao,
    });
    const { itens } = (await lista.json()) as {
      itens: { id: number; sessoes_ativas: number }[];
    };
    expect(itens.find((item) => item.id === pessoa.usuarioId)).toMatchObject({
      sessoes_ativas: 0,
    });
    expect(itens.find((item) => item.id === admin.usuarioId)).toMatchObject({
      sessoes_ativas: 1,
    });

    // Qualquer login limpa as sessões vencidas e as paradas.
    await entrar(app, (await criarAcessoNoBanco("coordenacao")).token);
    expect(await ultimoUso(pessoa.sessao)).toBeNull();
    expect(await ultimoUso(admin.sessao)).not.toBeNull();
  });

  it("sair com o cookie de uma sessão parada: 204, e a linha dela sai do banco", async () => {
    const { sessao } = await entrarAgora();
    await gravarUltimoUso(sessao, agora - SETE_DIAS_MS - 1);

    const res = await chamar(app, "POST", "/api/sessao/sair", {
      cabecalhos: { Cookie: `${NOME_COOKIE_SESSAO}=${sessao}` },
    });

    expect(res.status).toBe(204);
    expect(await ultimoUso(sessao)).toBeNull();
  });
});
