import { zValidator } from "@hono/zod-validator";
import { Hono } from "hono";
import { HTTPException } from "hono/http-exception";
import { afterEach, describe, expect, it, vi } from "vitest";
import { z } from "zod";
import {
  CODIGOS_ERRO,
  STATUS_HTTP_DO_ERRO,
  erroApiSchema,
} from "../../shared/contracts";
import {
  erroNaoTratado,
  responderErro,
  rotaInexistente,
} from "./respostas-erro";

const JSON_INVALIDO = {
  erro: {
    codigo: "json_invalido",
    mensagem: "O corpo não é um JSON válido",
  },
};

// App mínimo com os mesmos tratadores do app real (src/worker/index.ts), para exercitar caminhos que
// nenhuma rota real produz hoje (zValidator, c.req.json() sem tratamento, HTTPException de middleware).
function appDeTeste() {
  const app = new Hono();
  app.post(
    "/com-zvalidator",
    zValidator("json", z.object({ nome: z.string() })),
    (c) => c.json(c.req.valid("json")),
  );
  app.post("/com-req-json", async (c) => c.json(await c.req.json()));
  app.post(
    "/com-zvalidator-form",
    zValidator("form", z.object({ nome: z.string() })),
    (c) => c.json(c.req.valid("form")),
  );
  app.get("/syntax-error-sem-json", () => {
    // SyntaxError que não é de JSON (expressão regular inválida montada em tempo de execução).
    return new Response(String(new RegExp(["(", "sem fechar"].join(""))));
  });
  app.get("/http-exception-400-outra", () => {
    throw new HTTPException(400, { message: "Outro problema" });
  });
  app.get("/http-exception-com-resposta", () => {
    throw new HTTPException(401, {
      res: Response.json(
        { erro: { codigo: "nao_autenticado", mensagem: "Faça login" } },
        { status: 401, headers: { "WWW-Authenticate": "Bearer" } },
      ),
    });
  });
  app.get("/http-exception-400-com-resposta", () => {
    throw new HTTPException(400, {
      res: Response.json(
        {
          erro: { codigo: "requisicao_invalida", mensagem: "Dados inválidos" },
        },
        { status: 400 },
      ),
    });
  });
  app.get("/http-exception-simples", () => {
    throw new HTTPException(403, { message: "Sem permissão" });
  });
  app.get("/falha", () => {
    throw new Error("detalhe interno que não pode vazar");
  });
  app.get("/erro/:codigo", (c) => {
    const codigo = CODIGOS_ERRO.find((item) => item === c.req.param("codigo"));
    if (codigo === undefined) throw new Error("código desconhecido no teste");
    return responderErro(c, codigo, `Mensagem de ${codigo}`, {
      exemplo: true,
    });
  });
  app.notFound(rotaInexistente);
  app.onError(erroNaoTratado);
  return app;
}

function postarJson(caminho: string, corpo: string) {
  return appDeTeste().request(caminho, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: corpo,
  });
}

describe("CA7: formato único de erro nos tratadores do app", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("rota inexistente: 404 nao_encontrado", async () => {
    const res = await appDeTeste().request("/nao-existe");

    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({
      erro: { codigo: "nao_encontrado", mensagem: "Rota não encontrada" },
    });
  });

  it("erro não tratado: 500 erro_interno, registrado no log e sem vazar a mensagem interna", async () => {
    const consoleError = vi
      .spyOn(console, "error")
      .mockImplementation(() => {});

    const res = await appDeTeste().request("/falha");

    expect(res.status).toBe(500);
    const texto = await res.text();
    expect(JSON.parse(texto)).toEqual({
      erro: { codigo: "erro_interno", mensagem: "Erro interno" },
    });
    expect(texto).not.toContain("detalhe interno");
    expect(consoleError).toHaveBeenCalledOnce();
  });

  it.each([
    ["JSON malformado", '{"nome": "Fulano'],
    ["corpo vazio", ""],
  ])(
    "zValidator com %s: o Hono lança HTTPException 400 e a resposta é 400 json_invalido",
    async (_caso, corpo) => {
      const res = await postarJson("/com-zvalidator", corpo);

      expect(res.status).toBe(400);
      expect(await res.json()).toEqual(JSON_INVALIDO);
    },
  );

  it("SyntaxError de c.req.json(): 400 json_invalido, sem o trecho do corpo na resposta nem no log", async () => {
    const espioes = [
      vi.spyOn(console, "error"),
      vi.spyOn(console, "warn"),
      vi.spyOn(console, "log"),
    ];
    const pessoal = "Compradora Ficticia Sigilosa";

    const res = await postarJson(
      "/com-req-json",
      `{"buyer": {"name": "${pessoal}"`,
    );

    expect(res.status).toBe(400);
    const texto = await res.text();
    expect(JSON.parse(texto)).toEqual(JSON_INVALIDO);
    expect(texto).not.toContain(pessoal);
    for (const espiao of espioes) expect(espiao).not.toHaveBeenCalled();
  });

  it("HTTPException com resposta própria é devolvida como está (inclusive 400)", async () => {
    const consoleError = vi.spyOn(console, "error");

    const res401 = await appDeTeste().request("/http-exception-com-resposta");
    const res400 = await appDeTeste().request(
      "/http-exception-400-com-resposta",
    );

    expect(res401.status).toBe(401);
    expect(res401.headers.get("WWW-Authenticate")).toBe("Bearer");
    expect(await res401.json()).toEqual({
      erro: { codigo: "nao_autenticado", mensagem: "Faça login" },
    });
    expect(res400.status).toBe(400);
    expect(await res400.json()).toEqual({
      erro: { codigo: "requisicao_invalida", mensagem: "Dados inválidos" },
    });
    expect(consoleError).not.toHaveBeenCalled();
  });

  it.each([
    ["403", "/http-exception-simples", 403, "Sem permissão"],
    [
      "400 que não é de JSON",
      "/http-exception-400-outra",
      400,
      "Outro problema",
    ],
  ])(
    "HTTPException %s sem resposta própria mantém o status e a mensagem dela",
    async (_caso, caminho, status, mensagem) => {
      const res = await appDeTeste().request(caminho);

      expect(res.status).toBe(status);
      expect(await res.text()).toBe(mensagem);
    },
  );

  it("FormData malformado não vira json_invalido: segue como a HTTPException do Hono", async () => {
    const consoleError = vi.spyOn(console, "error");

    const res = await appDeTeste().request("/com-zvalidator-form", {
      method: "POST",
      headers: { "Content-Type": "multipart/form-data; boundary=limite" },
      body: "isto não é multipart",
    });

    expect(res.status).toBe(400);
    expect(await res.text()).toMatch(/^Malformed FormData request\./);
    expect(consoleError).not.toHaveBeenCalled();
  });

  it("SyntaxError que não é de JSON segue o caminho genérico: 500 erro_interno e log", async () => {
    const consoleError = vi
      .spyOn(console, "error")
      .mockImplementation(() => {});

    const res = await appDeTeste().request("/syntax-error-sem-json");

    expect(res.status).toBe(500);
    expect(await res.json()).toEqual({
      erro: { codigo: "erro_interno", mensagem: "Erro interno" },
    });
    expect(consoleError).toHaveBeenCalledOnce();
  });

  it.each(CODIGOS_ERRO)(
    "responderErro(%s) usa o status do contrato e o formato único",
    async (codigo) => {
      const res = await appDeTeste().request(`/erro/${codigo}`);

      expect(res.status).toBe(STATUS_HTTP_DO_ERRO[codigo]);
      const corpo: unknown = await res.json();
      expect(erroApiSchema.parse(corpo)).toEqual(corpo);
      expect(corpo).toEqual({
        erro: {
          codigo,
          mensagem: `Mensagem de ${codigo}`,
          detalhes: { exemplo: true },
        },
      });
    },
  );
});
