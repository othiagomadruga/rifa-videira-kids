// RIFA-073 (D33): o login do admin com usuário e senha, no app REAL (src/worker/index.ts, via exports.default.fetch) e
// no D1 dos testes. Cobre, por critério:
// 1. o admin define (e troca, e remove) o usuário e a senha na própria conta (PUT/DELETE /api/admin/minha-senha), com
//    senha forte; só o hash PBKDF2 com sal fica no banco;
// 2. POST /api/sessao/admin abre a MESMA sessão do link do admin; toda recusa é o MESMO 401 (sem dizer se o usuário
//    existe); a força bruta é barrada pelo limite de tentativas (429);
// 3. só o papel admin tem senha de admin (coordenação e líder: 403); trocar e remover encerram as sessões da senha; a
//    trilha registra definir, trocar, remover e cada login, sem a senha;
// e CSRF, e a senha não vai para tabela, resposta nem log.
import { env, exports } from "cloudflare:workers";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import {
  NOME_COOKIE_SESSAO,
  ROTAS_ACESSO,
  STATUS_HTTP_DO_ERRO,
  respostaSenhaAdminSchema,
  respostaSessaoSchema,
} from "../../shared/contracts";
import { definirAtivo } from "../db/acessos";
import { ITERACOES_SENHA } from "../lib/senha";
import {
  ORIGEM,
  cabecalhosDeSessao,
  cabecalhosDeSessaoDaHierarquia,
  cookieDaResposta,
  criarAcessoNoBanco,
} from "../test/acesso-teste";
import { CELULAS, semearCenario } from "../test/painel-apoio";

const LOGIN = ROTAS_ACESSO.entrarComoAdmin.caminho;
const MINHA_SENHA = ROTAS_ACESSO.obterMinhaSenhaAdmin.caminho;
const SENHA = "senha de teste 2026";
const OUTRA_SENHA = "outra senha de teste";

// O teste da força bruta faz 61 logins (cada um com o PBKDF2) e espera a janela do limite.
vi.setConfig({ testTimeout: 60_000 });

function pedir(
  metodo: string,
  caminho: string,
  cabecalhos: Record<string, string>,
  corpo?: unknown,
): Promise<Response> {
  const headers = new Headers(cabecalhos);
  if (corpo !== undefined) headers.set("Content-Type", "application/json");
  return exports.default.fetch(`${ORIGEM}${caminho}`, {
    method: metodo,
    headers,
    body: corpo === undefined ? undefined : JSON.stringify(corpo),
  });
}

function entrarComoAdmin(
  corpo: unknown,
  cabecalhos: Record<string, string> = { Origin: ORIGEM },
): Promise<Response> {
  return pedir("POST", LOGIN, cabecalhos, corpo);
}

/** Um admin novo, com a sessão do link (direto no banco). */
async function adminComLink(): Promise<{
  usuarioId: number;
  sessao: Record<string, string>;
}> {
  const acesso = await criarAcessoNoBanco("admin");
  const res = await pedir(
    "POST",
    ROTAS_ACESSO.entrar.caminho,
    { Origin: ORIGEM },
    { token: acesso.token },
  );
  expect(res.status).toBe(200);
  const cookie = cookieDaResposta(res)!;
  return {
    usuarioId: acesso.usuarioId,
    sessao: {
      Cookie: `${NOME_COOKIE_SESSAO}=${cookie.valor}`,
      Origin: ORIGEM,
    },
  };
}

let sequencia = 0;
/** Um usuário de login novo a cada chamada (são únicos entre os admins). */
function usuarioNovo(): string {
  sequencia += 1;
  return `admin.teste${sequencia}`;
}

async function definirSenha(
  sessao: Record<string, string>,
  usuario: string,
  senha = SENHA,
): Promise<Response> {
  return pedir("PUT", MINHA_SENHA, sessao, { usuario, senha });
}

/** Entra com usuário e senha e devolve os cabeçalhos da sessão aberta. */
async function sessaoPelaSenha(
  usuario: string,
  senha = SENHA,
): Promise<{ res: Response; sessao: Record<string, string>; cookie: string }> {
  const res = await entrarComoAdmin({ usuario, senha });
  expect(res.status).toBe(200);
  const cookie = cookieDaResposta(res)!.valor;
  return {
    res,
    cookie,
    sessao: { Cookie: `${NOME_COOKIE_SESSAO}=${cookie}`, Origin: ORIGEM },
  };
}

async function trilha(usuarioId: number) {
  return (
    await env.DB.prepare(
      "SELECT acao, alvo, resumo FROM auditoria WHERE usuario_id = ?1 AND (acao LIKE 'senha_admin.%' OR acao = 'sessao.entrar_como_admin') ORDER BY id",
    )
      .bind(usuarioId)
      .all<{ acao: string; alvo: string; resumo: string }>()
  ).results;
}

async function esperarRecusa(res: Response): Promise<string> {
  expect(res.status).toBe(401);
  expect(res.headers.get("Set-Cookie")).toBeNull();
  const corpo = (await res.json()) as {
    erro: { codigo: string; mensagem: string };
  };
  expect(corpo.erro.codigo).toBe("nao_autenticado");
  return corpo.erro.mensagem;
}

beforeAll(async () => {
  await semearCenario();
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("RIFA-073 (critério 1): o admin define a própria senha", () => {
  it("sem senha, GET diz que não há; PUT grava só o PBKDF2 com sal (100.000 iterações) e a resposta não traz senha nem hash", async () => {
    const { usuarioId, sessao } = await adminComLink();
    const antes = await pedir("GET", MINHA_SENHA, sessao);
    expect(antes.status).toBe(200);
    expect(antes.headers.get("Cache-Control")).toBe("no-store");
    expect(await antes.json()).toEqual({
      definida: false,
      usuario: null,
      atualizada_em: null,
    });

    const res = await definirSenha(sessao, "  Pastor.Teste  ");
    expect(res.status).toBe(200);
    const corpo = respostaSenhaAdminSchema.parse(await res.json());
    expect(corpo).toEqual({
      definida: true,
      usuario: "pastor.teste",
      atualizada_em: expect.any(String),
    });
    expect(await (await pedir("GET", MINHA_SENHA, sessao)).json()).toEqual(
      corpo,
    );

    const linha = await env.DB.prepare(
      "SELECT * FROM senhas_admin WHERE usuario_id = ?1",
    )
      .bind(usuarioId)
      .first<Record<string, unknown>>();
    expect(linha).toMatchObject({
      usuario: "pastor.teste",
      iteracoes: ITERACOES_SENHA,
      sal: expect.stringMatching(/^[0-9a-f]{32}$/),
      hash: expect.stringMatching(/^[0-9a-f]{64}$/),
    });
    expect(ITERACOES_SENHA).toBeGreaterThanOrEqual(100_000);
    // A senha não está em coluna nenhuma.
    expect(JSON.stringify(linha)).not.toContain(SENHA);
  });

  it("dois admins com a mesma senha ficam com hashes diferentes (sal por usuário)", async () => {
    const a = await adminComLink();
    const b = await adminComLink();
    expect((await definirSenha(a.sessao, usuarioNovo())).status).toBe(200);
    expect((await definirSenha(b.sessao, usuarioNovo())).status).toBe(200);
    const { results } = await env.DB.prepare(
      "SELECT sal, hash FROM senhas_admin WHERE usuario_id IN (?1, ?2)",
    )
      .bind(a.usuarioId, b.usuarioId)
      .all<{ sal: string; hash: string }>();
    expect(results).toHaveLength(2);
    expect(results[0].sal).not.toBe(results[1].sal);
    expect(results[0].hash).not.toBe(results[1].hash);
  });

  it("senha fraca ou usuário fora do formato: 400, nada gravado", async () => {
    const { usuarioId, sessao } = await adminComLink();
    for (const corpo of [
      { usuario: "pastor.fraca", senha: "123456789" },
      { usuario: "pastor.igual", senha: "Pastor.Igual" },
      { usuario: "joão", senha: SENHA },
      { usuario: "ab", senha: SENHA },
      { usuario: "pastor.semsenha" },
    ]) {
      const res = await pedir("PUT", MINHA_SENHA, sessao, corpo);
      expect({ corpo, status: res.status }).toEqual({ corpo, status: 400 });
    }
    const total = await env.DB.prepare(
      "SELECT count(*) AS total FROM senhas_admin WHERE usuario_id = ?1",
    )
      .bind(usuarioId)
      .first<{ total: number }>();
    expect(total?.total).toBe(0);
  });

  it("o usuário de login de outro admin: 409 em_uso (sem mudar a senha de ninguém)", async () => {
    const a = await adminComLink();
    const b = await adminComLink();
    const usuario = usuarioNovo();
    expect((await definirSenha(a.sessao, usuario)).status).toBe(200);
    const res = await definirSenha(b.sessao, usuario.toUpperCase());
    expect(res.status).toBe(409);
    expect(res.status).toBe(STATUS_HTTP_DO_ERRO.em_uso);
    expect(await (await pedir("GET", MINHA_SENHA, b.sessao)).json()).toEqual({
      definida: false,
      usuario: null,
      atualizada_em: null,
    });
    // O dono continua entrando com a senha dele.
    await sessaoPelaSenha(usuario);
  });
});

describe("RIFA-073 (critério 2): login do admin em /entrar", () => {
  it("usuário e senha certos: 200 com o MESMO usuário admin do link, cookie __Host-sessao com as flags, sessão sem link e 45 dias", async () => {
    const { usuarioId, sessao } = await adminComLink();
    const usuario = usuarioNovo();
    await definirSenha(sessao, usuario);
    const doLink = respostaSessaoSchema.parse(
      await (await pedir("GET", "/api/sessao", sessao)).json(),
    );

    // Maiúsculas e espaços no usuário não atrapalham.
    const res = await entrarComoAdmin({
      usuario: ` ${usuario.toUpperCase()} `,
      senha: SENHA,
    });
    expect(res.status).toBe(200);
    expect(res.headers.get("Cache-Control")).toBe("no-store");
    const corpo = respostaSessaoSchema.parse(await res.json());
    expect(corpo).toEqual(doLink);
    expect(corpo.usuario).toMatchObject({ id: usuarioId, papel: "admin" });
    const cookie = cookieDaResposta(res)!;
    expect(cookie.atributos).toEqual(
      expect.arrayContaining(["HttpOnly", "Secure", "SameSite=Lax", "Path=/"]),
    );
    const maxAge = Number(
      cookie.atributos.find((a) => a.startsWith("Max-Age="))!.slice(8),
    );
    expect(maxAge).toBeGreaterThan(44 * 24 * 3600);

    const linha = await env.DB.prepare(
      "SELECT link_id FROM sessoes WHERE usuario_id = ?1 AND link_id IS NULL",
    )
      .bind(usuarioId)
      .all();
    expect(linha.results).toHaveLength(1);

    // A sessão da senha é a do admin: entra nos usuários (só admin) e no painel.
    const pelaSenha = {
      Cookie: `${NOME_COOKIE_SESSAO}=${cookie.valor}`,
      Origin: ORIGEM,
    };
    expect((await pedir("GET", "/api/admin/usuarios", pelaSenha)).status).toBe(
      200,
    );
    expect((await pedir("GET", "/api/admin/auditoria", pelaSenha)).status).toBe(
      200,
    );
    expect((await pedir("GET", "/api/sessao", pelaSenha)).status).toBe(200);
  });

  it("toda recusa é o MESMO 401: senha errada, usuário que não existe, vazio, admin desativado", async () => {
    const { usuarioId, sessao } = await adminComLink();
    const usuario = usuarioNovo();
    await definirSenha(sessao, usuario);

    const mensagens = [
      await esperarRecusa(
        await entrarComoAdmin({ usuario, senha: "senha errada demais" }),
      ),
      await esperarRecusa(
        await entrarComoAdmin({ usuario: "ninguem.aqui", senha: SENHA }),
      ),
      await esperarRecusa(await entrarComoAdmin({ usuario: "", senha: "" })),
      // A senha certa com outra caixa não confere (só o usuário ignora maiúsculas).
      await esperarRecusa(
        await entrarComoAdmin({ usuario, senha: SENHA.toUpperCase() }),
      ),
    ];
    expect(await definirAtivo(env.DB, usuarioId, false)).toBe("ok");
    mensagens.push(
      await esperarRecusa(await entrarComoAdmin({ usuario, senha: SENHA })),
    );
    expect(new Set(mensagens).size).toBe(1);
    expect(mensagens[0]).not.toMatch(/existe|senha errada|desativ/i);
  });

  it("o PBKDF2 (100.000 iterações) roda e a comparação é em tempo constante também quando o usuário não existe", async () => {
    const { sessao } = await adminComLink();
    const usuario = usuarioNovo();
    await definirSenha(sessao, usuario);
    const derivar = vi.spyOn(crypto.subtle, "deriveBits");
    const comparar = vi.spyOn(crypto.subtle, "timingSafeEqual");
    for (const corpo of [
      { usuario, senha: "senha errada demais" },
      { usuario: "ninguem.aqui", senha: SENHA },
      { usuario: "", senha: "" },
    ]) {
      derivar.mockClear();
      comparar.mockClear();
      await esperarRecusa(await entrarComoAdmin(corpo));
      expect(derivar).toHaveBeenCalledTimes(1);
      expect(derivar.mock.calls[0]?.[0]).toMatchObject({
        name: "PBKDF2",
        hash: "SHA-256",
        iterations: ITERACOES_SENHA,
      });
      expect(comparar).toHaveBeenCalledTimes(1);
    }
  });

  it("a mesma senha digitada com o acento composto de outro teclado confere (NFC)", async () => {
    const { sessao } = await adminComLink();
    const usuario = usuarioNovo();
    const composta = "senha com acentuação";
    expect(
      (await definirSenha(sessao, usuario, composta.normalize("NFC"))).status,
    ).toBe(200);
    await sessaoPelaSenha(usuario, composta.normalize("NFD"));
  });

  it("CSRF: login de outra origem é 403, sem sessão", async () => {
    const { sessao } = await adminComLink();
    const usuario = usuarioNovo();
    await definirSenha(sessao, usuario);
    const res = await entrarComoAdmin(
      { usuario, senha: SENHA },
      { Origin: "https://site-malicioso.example" },
    );
    expect(res.status).toBe(403);
    expect(res.headers.get("Set-Cookie")).toBeNull();
  });

  it("limite por conta: 5 erros seguidos bloqueiam o login dela por 15 minutos com o MESMO 401 (até com a senha certa); o acerto zera; o link segue", async () => {
    const { usuarioId, sessao: doLink } = await adminComLink();
    const usuario = usuarioNovo();
    await definirSenha(doLink, usuario);
    const errar = async (vezes: number) => {
      for (let i = 0; i < vezes; i++)
        await esperarRecusa(
          await entrarComoAdmin({ usuario, senha: `errada numero ${i}` }),
        );
    };

    // 4 erros e o acerto: entra e zera a contagem.
    await errar(4);
    await sessaoPelaSenha(usuario);
    await errar(4);
    await sessaoPelaSenha(usuario);

    // 5 erros seguidos: bloqueada, a senha certa recebe a mesma recusa da errada.
    await errar(5);
    const recusaCerta = await esperarRecusa(
      await entrarComoAdmin({ usuario, senha: SENHA }),
    );
    const recusaErrada = await esperarRecusa(
      await entrarComoAdmin({ usuario: "ninguem.aqui", senha: SENHA }),
    );
    expect(recusaCerta).toBe(recusaErrada);
    const linha = await env.DB.prepare(
      "SELECT falhas, bloqueada_ate FROM senhas_admin WHERE usuario_id = ?1",
    )
      .bind(usuarioId)
      .first<{ falhas: number; bloqueada_ate: string }>();
    const minutos = (Date.parse(linha!.bloqueada_ate) - Date.now()) / 60_000;
    expect(minutos).toBeGreaterThan(14);
    expect(minutos).toBeLessThanOrEqual(15);
    // Durante o bloqueio, os erros não contam nem estendem o bloqueio (um atacante não o prolonga para sempre).
    await errar(6);
    expect(
      await env.DB.prepare(
        "SELECT falhas, bloqueada_ate FROM senhas_admin WHERE usuario_id = ?1",
      )
        .bind(usuarioId)
        .first(),
    ).toEqual(linha);
    // O link pessoal continua entrando.
    expect((await pedir("GET", "/api/sessao", doLink)).status).toBe(200);

    // Passados os 15 minutos, a senha certa entra de novo.
    await env.DB.prepare(
      "UPDATE senhas_admin SET bloqueada_ate = ?2 WHERE usuario_id = ?1",
    )
      .bind(usuarioId, new Date(Date.now() - 1000).toISOString())
      .run();
    await sessaoPelaSenha(usuario);

    // Trocar a senha (pelo link) também tira o bloqueio.
    await errar(5);
    expect((await definirSenha(doLink, usuario, OUTRA_SENHA)).status).toBe(200);
    await sessaoPelaSenha(usuario, OUTRA_SENHA);
  });

  it("corpo sem campo ou com texto enorme: 400", async () => {
    expect((await entrarComoAdmin({ usuario: "x" })).status).toBe(400);
    expect(
      (await entrarComoAdmin({ usuario: "x", senha: "a".repeat(201) })).status,
    ).toBe(400);
  });

  it("força bruta barrada: do mesmo IP, 60 tentativas por minuto; a 61ª leva 429 mesmo com a senha certa", async () => {
    const { sessao } = await adminComLink();
    const usuario = usuarioNovo();
    await definirSenha(sessao, usuario);
    const n = crypto.getRandomValues(new Uint8Array(3));
    const ip = `203.${n[0]}.${n[1]}.${n[2]}`;
    // A janela do binding é fixa e alinhada ao relógio: a sequência inteira cabe numa janela só.
    const resta = 60_000 - (Date.now() % 60_000);
    if (resta < 25_000)
      await new Promise((resolve) => setTimeout(resolve, resta + 50));

    const cabecalhos = { Origin: ORIGEM, "CF-Connecting-IP": ip };
    const status: number[] = [];
    for (let i = 0; i < 60; i++)
      status.push(
        (
          await entrarComoAdmin(
            // Usuários que não existem: o limite por IP vale antes de qualquer conta (o por conta tem teste próprio).
            { usuario: `tentativa.${i}`, senha: `tentativa errada ${i}` },
            cabecalhos,
          )
        ).status,
      );
    expect(new Set(status)).toEqual(new Set([401]));
    const bloqueada = await entrarComoAdmin(
      { usuario, senha: SENHA },
      cabecalhos,
    );
    expect(bloqueada.status).toBe(429);
    expect(bloqueada.headers.get("Retry-After")).toBe("60");
    expect(bloqueada.headers.get("Set-Cookie")).toBeNull();
    // Outro IP não é afetado.
    const outro = await entrarComoAdmin(
      { usuario, senha: SENHA },
      { Origin: ORIGEM, "CF-Connecting-IP": "192.0.2.73" },
    );
    expect(outro.status).toBe(200);
  });
});

describe("RIFA-073 (critério 3): só admin, trocar, remover e a trilha", () => {
  it("coordenação e líder não têm senha de admin: 403 em GET, PUT e DELETE /api/admin/minha-senha", async () => {
    const coordenacao = await cabecalhosDeSessao("coordenacao");
    const lider = await cabecalhosDeSessaoDaHierarquia("lider", CELULAS[0].id);
    for (const sessao of [coordenacao, lider]) {
      expect((await pedir("GET", MINHA_SENHA, sessao)).status).toBe(403);
      expect((await definirSenha(sessao, usuarioNovo())).status).toBe(403);
      expect((await pedir("DELETE", MINHA_SENHA, sessao)).status).toBe(403);
    }
    expect((await pedir("GET", MINHA_SENHA, { Origin: ORIGEM })).status).toBe(
      401,
    );
    const total = await env.DB.prepare(
      `SELECT count(*) AS total FROM senhas_admin AS sa JOIN usuarios AS u ON u.id = sa.usuario_id
       WHERE u.papel <> 'admin'`,
    ).first<{ total: number }>();
    expect(total?.total).toBe(0);
  });

  it("um admin que tinha senha e deixou de ser admin não entra (o login confere o papel na hora)", async () => {
    const { usuarioId, sessao } = await adminComLink();
    const usuario = usuarioNovo();
    await definirSenha(sessao, usuario);
    const aberta = await sessaoPelaSenha(usuario);
    await env.DB.prepare(
      "UPDATE usuarios SET papel = 'coordenacao' WHERE id = ?1",
    )
      .bind(usuarioId)
      .run();
    try {
      await esperarRecusa(await entrarComoAdmin({ usuario, senha: SENHA }));
      // A sessão da senha também deixa de valer.
      expect((await pedir("GET", "/api/sessao", aberta.sessao)).status).toBe(
        401,
      );
    } finally {
      await env.DB.prepare("UPDATE usuarios SET papel = 'admin' WHERE id = ?1")
        .bind(usuarioId)
        .run();
    }
  });

  it("trocar: a senha antiga deixa de valer, as outras sessões da senha caem, a deste aparelho e a do link continuam", async () => {
    const { usuarioId, sessao: doLink } = await adminComLink();
    const usuario = usuarioNovo();
    await definirSenha(doLink, usuario);
    const aparelho1 = await sessaoPelaSenha(usuario);
    const aparelho2 = await sessaoPelaSenha(usuario);

    const res = await definirSenha(aparelho1.sessao, usuario, OUTRA_SENHA);
    expect(res.status).toBe(200);

    expect((await pedir("GET", "/api/sessao", aparelho1.sessao)).status).toBe(
      200,
    );
    expect((await pedir("GET", "/api/sessao", aparelho2.sessao)).status).toBe(
      401,
    );
    expect((await pedir("GET", "/api/sessao", doLink)).status).toBe(200);
    await esperarRecusa(await entrarComoAdmin({ usuario, senha: SENHA }));
    await sessaoPelaSenha(usuario, OUTRA_SENHA);

    // Trocar também o usuário de login.
    const novo = usuarioNovo();
    expect((await definirSenha(doLink, novo, OUTRA_SENHA)).status).toBe(200);
    await esperarRecusa(await entrarComoAdmin({ usuario, senha: OUTRA_SENHA }));
    await sessaoPelaSenha(novo, OUTRA_SENHA);

    const registros = await trilha(usuarioId);
    expect(registros.map((r) => r.acao)).toEqual([
      "senha_admin.definir",
      "sessao.entrar_como_admin",
      "sessao.entrar_como_admin",
      "senha_admin.trocar",
      "sessao.entrar_como_admin",
      "senha_admin.trocar",
      "sessao.entrar_como_admin",
    ]);
    for (const r of registros) expect(r.alvo).toBe(`usuario:${usuarioId}`);
    expect(registros[3].resumo).toContain("mesmo usuário de login");
    expect(registros[5].resumo).toContain("usuário de login trocado");
    // Nem a senha nem o usuário de login vão para a trilha.
    const texto = JSON.stringify(registros);
    for (const segredo of [SENHA, OUTRA_SENHA, usuario, novo])
      expect(texto).not.toContain(segredo);
  });

  it("remover: o login por senha deixa de valer e as sessões da senha caem; a do link continua; remover de novo é 204 sem trilha", async () => {
    const { usuarioId, sessao: doLink } = await adminComLink();
    const usuario = usuarioNovo();
    await definirSenha(doLink, usuario);
    const pelaSenha = await sessaoPelaSenha(usuario);

    const res = await pedir("DELETE", MINHA_SENHA, doLink);
    expect(res.status).toBe(204);
    expect((await pedir("GET", "/api/sessao", pelaSenha.sessao)).status).toBe(
      401,
    );
    expect((await pedir("GET", "/api/sessao", doLink)).status).toBe(200);
    await esperarRecusa(await entrarComoAdmin({ usuario, senha: SENHA }));
    expect(await (await pedir("GET", MINHA_SENHA, doLink)).json()).toEqual({
      definida: false,
      usuario: null,
      atualizada_em: null,
    });

    expect((await pedir("DELETE", MINHA_SENHA, doLink)).status).toBe(204);
    expect((await trilha(usuarioId)).map((r) => r.acao)).toEqual([
      "senha_admin.definir",
      "sessao.entrar_como_admin",
      "senha_admin.remover",
    ]);
    // O usuário de login fica livre para outro admin.
    const outro = await adminComLink();
    expect((await definirSenha(outro.sessao, usuario)).status).toBe(200);
  });

  it("a sessão do admin aberta pela senha não depende da chave das células (D29)", async () => {
    const { sessao } = await adminComLink();
    const usuario = usuarioNovo();
    await definirSenha(sessao, usuario);
    const pelaSenha = await sessaoPelaSenha(usuario);
    await env.DB.prepare(
      "UPDATE campanhas SET acesso_celulas_senha = 0 WHERE ativa = 1",
    ).run();
    try {
      expect((await pedir("GET", "/api/sessao", pelaSenha.sessao)).status).toBe(
        200,
      );
    } finally {
      await env.DB.prepare(
        "UPDATE campanhas SET acesso_celulas_senha = 1 WHERE ativa = 1",
      ).run();
    }
  });

  it("a senha não aparece em nenhum log (console) do Worker", async () => {
    const chamadas: unknown[][] = [];
    for (const metodo of ["log", "info", "warn", "error", "debug"] as const)
      vi.spyOn(console, metodo).mockImplementation((...args: unknown[]) => {
        chamadas.push(args);
      });
    const { sessao } = await adminComLink();
    const usuario = usuarioNovo();
    await definirSenha(sessao, usuario);
    await sessaoPelaSenha(usuario);
    await entrarComoAdmin({ usuario, senha: "senha errada demais" });
    await pedir("DELETE", MINHA_SENHA, sessao);
    expect(JSON.stringify(chamadas)).not.toContain(SENHA);
  });
});
