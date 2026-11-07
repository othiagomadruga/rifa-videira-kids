// RIFA-013b, item 1: limite do corpo ANTES de ler ou validar, no app real (src/worker/index.ts).
// - POST /api/sessao (aberto): 4 KiB → 413 corpo_muito_grande;
// - POST/PUT/PATCH da coordenação: 1 MiB → 413, depois do login (sem sessão, o corpo nem é lido);
// - a importação da hierarquia tem o teto dela (o maior corpo com um csv dentro do limite de caracteres);
// - a conferência da RIFA-012 (/api/admin/reconciliacao/*) fica com o teto próprio: o geral não lê o corpo.
// Os corpos em fluxo (ReadableStream sem Content-Length) contam quantos pedaços foram puxados.
import { env } from "cloudflare:workers";
import { Hono } from "hono";
import { beforeAll, describe, expect, it } from "vitest";
import {
  LIMITE_CARACTERES_CSV_HIERARQUIA,
  NOME_COOKIE_SESSAO,
  erroApiSchema,
} from "../../shared/contracts";
import app from "../index";
import { lerCorpoComLimite } from "../lib/corpo-limitado";
import { ORIGEM, cabecalhosDeSessao } from "../test/acesso-teste";
import {
  LIMITE_CORPO_COORDENACAO_BYTES,
  LIMITE_CORPO_IMPORTACAO_HIERARQUIA_BYTES,
  LIMITE_CORPO_SESSAO_BYTES,
  limitarCorpoDaCoordenacao,
} from "./limite-corpo";

const PEDACO = 1024;

/** Corpo em fluxo, sem Content-Length: `pedacos` de 1 KiB, puxados só quando alguém lê. */
function fluxo(pedacos: number, conteudo = "x") {
  const contagem = { puxados: 0, cancelado: false };
  const bytes = new TextEncoder().encode(conteudo.repeat(PEDACO));
  const corpo = new ReadableStream<Uint8Array>(
    {
      pull(controle) {
        if (contagem.puxados === pedacos) {
          controle.close();
          return;
        }
        contagem.puxados += 1;
        controle.enqueue(bytes);
      },
      cancel() {
        contagem.cancelado = true;
      },
    },
    { highWaterMark: 0 },
  );
  return { corpo, contagem };
}

function enviar(
  metodo: string,
  caminho: string,
  corpo: BodyInit,
  cabecalhos: Record<string, string> = {},
): Promise<Response> {
  return Promise.resolve(
    app.request(
      caminho,
      {
        method: metodo,
        headers: {
          "Content-Type": "application/json",
          Origin: ORIGEM,
          ...cabecalhos,
        },
        body: corpo,
        // Corpo em fluxo exige duplex no RequestInit.
        ...(corpo instanceof ReadableStream ? { duplex: "half" } : {}),
      } as RequestInit,
      env,
    ),
  );
}

/** Status e código no formato único; o 413 sai sem `detalhes`. Devolve o corpo para o resto do teste. */
async function esperarErro(res: Response, status: number, codigo: string) {
  const corpo = erroApiSchema.parse(await res.json());
  expect({ status: res.status, codigo: corpo.erro.codigo }).toEqual({
    status,
    codigo,
  });
  if (status === 413) expect(corpo.erro.detalhes).toBeUndefined();
  return corpo;
}

/** JSON de exatamente `bytes` bytes: {"token":"xxx…"}. */
function corpoDeSessao(bytes: number): string {
  const vazio = JSON.stringify({ token: "" });
  return JSON.stringify({ token: "x".repeat(bytes - vazio.length) });
}

let admin: Record<string, string>;

beforeAll(async () => {
  admin = await cabecalhosDeSessao("admin");
});

describe("POST /api/sessao: 4 KiB, antes de ler ou validar", () => {
  it("Content-Length acima do limite: 413 sem puxar nada do corpo", async () => {
    const { corpo, contagem } = fluxo(10);
    const res = await enviar("POST", "/api/sessao", corpo, {
      "Content-Length": String(10 * PEDACO),
    });

    const erro = await esperarErro(res, 413, "corpo_muito_grande");
    expect(erro.erro.mensagem).toBe("O corpo passa do limite de 4 KiB");
    expect(contagem.puxados).toBe(0);
  });

  it("sem Content-Length (em partes): a leitura para logo depois do limite e o resto nem é pedido", async () => {
    const { corpo, contagem } = fluxo(100);
    const res = await enviar("POST", "/api/sessao", corpo);

    await esperarErro(res, 413, "corpo_muito_grande");
    // 4 KiB = 4 pedaços; o 5º passa do limite e a leitura é cancelada.
    expect(contagem.puxados).toBe(LIMITE_CORPO_SESSAO_BYTES / PEDACO + 1);
    expect(contagem.cancelado).toBe(true);
  });

  it("borda: 4096 bytes passam para a validação (401 do link inválido); 4097 bytes dão 413", async () => {
    expect(
      new TextEncoder().encode(corpoDeSessao(LIMITE_CORPO_SESSAO_BYTES)).length,
    ).toBe(LIMITE_CORPO_SESSAO_BYTES);
    // O token passa de 512 caracteres: fora do schema, 400 (o limite deixou ler).
    await esperarErro(
      await enviar(
        "POST",
        "/api/sessao",
        corpoDeSessao(LIMITE_CORPO_SESSAO_BYTES),
      ),
      400,
      "requisicao_invalida",
    );
    await esperarErro(
      await enviar(
        "POST",
        "/api/sessao",
        corpoDeSessao(LIMITE_CORPO_SESSAO_BYTES + 1),
      ),
      413,
      "corpo_muito_grande",
    );
  });

  it("dentro do limite, o corpo em partes chega inteiro à validação e ao login", async () => {
    const texto = '{"token":"link-que-nao-existe"}';
    const corpo = new ReadableStream<Uint8Array>({
      start(controle) {
        const bytes = new TextEncoder().encode(texto);
        controle.enqueue(bytes.slice(0, 5));
        controle.enqueue(bytes.slice(5));
        controle.close();
      },
    });
    await esperarErro(
      await enviar("POST", "/api/sessao", corpo),
      401,
      "nao_autenticado",
    );
  });

  it("bytes fora de UTF-8 viram U+FFFD, como na leitura direta: o login segue (401) e não quebra", async () => {
    const bytes = new Uint8Array([
      ...new TextEncoder().encode('{"token":"'),
      0xff,
      0xfe,
      ...new TextEncoder().encode('"}'),
    ]);
    await esperarErro(
      await enviar("POST", "/api/sessao", bytes, {
        "Content-Length": String(bytes.length),
      }),
      401,
      "nao_autenticado",
    );
  });

  it("a origem vem antes: de outro site, 403 (o corpo grande não é nem medido)", async () => {
    const res = await enviar(
      "POST",
      "/api/sessao",
      corpoDeSessao(10 * LIMITE_CORPO_SESSAO_BYTES),
      { Origin: "https://site-malicioso.example" },
    );
    await esperarErro(res, 403, "proibido");
  });
});

describe("escritas da coordenação: 1 MiB, depois do login", () => {
  const grande = (bytes: number) => {
    const vazio = JSON.stringify({ nome: "", divisao: "jovens" });
    return JSON.stringify({
      nome: "x".repeat(bytes - vazio.length),
      divisao: "jovens",
    });
  };

  it("sem sessão: 401 e o corpo não é lido (nenhum pedaço puxado)", async () => {
    const { corpo, contagem } = fluxo(2048);
    const res = await enviar("POST", "/api/admin/redes", corpo);

    await esperarErro(res, 401, "nao_autenticado");
    expect(contagem.puxados).toBe(0);
  });

  it.each([
    ["POST", "/api/admin/redes"],
    ["PUT", "/api/admin/campanha"],
    ["PUT", "/api/admin/afiliados/1"],
    ["PATCH", "/api/admin/usuarios/1"],
    ["POST", "/api/painel/qualquer"],
  ])(
    "%s %s com sessão e corpo de 1 MiB + 1 byte: 413 corpo_muito_grande",
    async (metodo, caminho) => {
      const res = await enviar(
        metodo,
        caminho,
        grande(LIMITE_CORPO_COORDENACAO_BYTES + 1),
        admin,
      );
      const erro = await esperarErro(res, 413, "corpo_muito_grande");
      expect(erro.erro.mensagem).toBe("O corpo passa do limite de 1 MiB");
    },
  );

  it("exatamente 1 MiB passa para a rota (o schema recusa o nome comprido: 400, não 413)", async () => {
    const corpo = grande(LIMITE_CORPO_COORDENACAO_BYTES);
    expect(new TextEncoder().encode(corpo).length).toBe(
      LIMITE_CORPO_COORDENACAO_BYTES,
    );
    await esperarErro(
      await enviar("POST", "/api/admin/redes", corpo, admin),
      400,
      "requisicao_invalida",
    );
  });

  it("em partes, sem Content-Length: a leitura para logo depois de 1 MiB", async () => {
    const { corpo, contagem } = fluxo(4096);
    const res = await enviar("POST", "/api/admin/redes", corpo, admin);

    await esperarErro(res, 413, "corpo_muito_grande");
    expect(contagem.puxados).toBe(LIMITE_CORPO_COORDENACAO_BYTES / PEDACO + 1);
  });

  it("dentro do limite, a rota lê o corpo normalmente (em partes ou não)", async () => {
    const nome = `Rede do limite ${crypto.randomUUID()}`;
    const texto = JSON.stringify({ nome, divisao: "adultos" });
    const emPartes = new ReadableStream<Uint8Array>({
      start(controle) {
        const bytes = new TextEncoder().encode(texto);
        controle.enqueue(bytes.slice(0, 7));
        controle.enqueue(bytes.slice(7));
        controle.close();
      },
    });

    const criada = await enviar("POST", "/api/admin/redes", emPartes, admin);
    expect(criada.status).toBe(201);
    expect(await criada.json()).toMatchObject({ nome, divisao: "adultos" });
    // DELETE não tem corpo lido: passa direto pelo limite.
    const { id } = (await (
      await enviar(
        "POST",
        "/api/admin/redes",
        JSON.stringify({ nome: `${nome} 2`, divisao: "jovens" }),
        admin,
      )
    ).json()) as { id: number };
    const removida = await app.request(
      `/api/admin/redes/${id}`,
      { method: "DELETE", headers: admin },
      env,
    );
    expect(removida.status).toBe(204);
  });

  it("o cookie de sessão inválido continua dando 401 antes do limite", async () => {
    const res = await enviar(
      "POST",
      "/api/admin/redes",
      grande(LIMITE_CORPO_COORDENACAO_BYTES + 1),
      { Cookie: `${NOME_COOKIE_SESSAO}=${"a".repeat(43)}` },
    );
    await esperarErro(res, 401, "nao_autenticado");
  });
});

describe("importações de CSV: o teto delas", () => {
  it("a importação da hierarquia aceita corpo acima de 1 MiB com o csv dentro do limite de caracteres", async () => {
    // 600 mil "ç" (2 bytes cada em UTF-8): ~1,2 MB de corpo, csv bem abaixo de 1.000.000 de caracteres.
    const csv = `rede,divisao\n${"ç".repeat(600_000)}`;
    const corpo = JSON.stringify({ csv, simular: true });
    expect(new TextEncoder().encode(corpo).length).toBeGreaterThan(
      LIMITE_CORPO_COORDENACAO_BYTES,
    );

    const res = await enviar(
      "POST",
      "/api/admin/hierarquia/importar",
      corpo,
      admin,
    );
    // O arquivo foi lido: o erro é do conteúdo (faltam colunas), não do tamanho.
    const erro = await esperarErro(res, 400, "csv_invalido");
    expect(erro.erro.detalhes).toMatchObject({ motivo: "colunas_faltando" });
  });

  it("acima do teto da importação: 400 csv_invalido de arquivo grande, como o do schema, sem ler o resto", async () => {
    const pedacos = LIMITE_CORPO_IMPORTACAO_HIERARQUIA_BYTES / PEDACO + 100;
    const { corpo, contagem } = fluxo(Math.ceil(pedacos));
    const res = await enviar(
      "POST",
      "/api/admin/hierarquia/importar",
      corpo,
      admin,
    );

    const erro = await esperarErro(res, 400, "csv_invalido");
    expect(erro.erro.detalhes).toEqual({
      motivo: "arquivo_grande",
      limite_caracteres: LIMITE_CARACTERES_CSV_HIERARQUIA,
    });
    expect(contagem.cancelado).toBe(true);
    expect(contagem.puxados).toBeLessThan(Math.ceil(pedacos));
  });

  it("a conferência da RIFA-012 (/api/admin/reconciliacao/*) fica fora do teto geral: o corpo chega intacto à rota, que lê c.req.raw", async () => {
    // Montagem como a do index.ts (teto geral em /api/admin/*), com uma rota que lê o corpo como a da
    // conferência: lerCorpoComLimite(c.req.raw, <teto dela>).
    const teste = new Hono();
    teste.use("/api/admin/*", limitarCorpoDaCoordenacao);
    teste.post("/api/admin/reconciliacao/analisar", async (c) => {
      const texto = await lerCorpoComLimite(c.req.raw, 10 * 1024 * 1024);
      return c.json({ bytes: texto?.length ?? null });
    });
    const { corpo, contagem } = fluxo(2048);

    const res = await teste.request("/api/admin/reconciliacao/analisar", {
      method: "POST",
      body: corpo,
      duplex: "half",
    } as RequestInit);

    expect(await res.json()).toEqual({ bytes: 2048 * PEDACO });
    expect(contagem.puxados).toBe(2048);
  });
});
