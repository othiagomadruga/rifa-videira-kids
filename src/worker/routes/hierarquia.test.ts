// CA1: CRUD de redes, discipuladores e células (docs/api.md), com o D1 dos testes.
import { env } from "cloudflare:workers";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  celulaSchema,
  discipuladorSchema,
  redeSchema,
} from "../../shared/contracts";
import {
  chamar,
  conforme,
  criarCelula,
  criarDiscipulador,
  criarRede,
  esperarErro,
  limparHierarquia,
  listarCelulas,
  listarDiscipuladores,
  listarRedes,
  nomes,
} from "../test/hierarquia-apoio";

const qualquerTexto = expect.any(String);

beforeEach(limparHierarquia);
afterEach(() => {
  vi.restoreAllMocks();
});

describe("CA1: redes", () => {
  it("POST cria (201) e GET lista e obtém no formato do contrato", async () => {
    const jovem = await criarRede({
      nome: "  Rede Jovem Norte ",
      divisao: "jovens",
      responsavel_nome: "Pastor Ficticio",
    });
    const adulta = await criarRede({
      nome: "Rede Adulta Sul",
      divisao: "adultos",
    });

    expect(jovem).toEqual({
      id: expect.any(Number),
      nome: "Rede Jovem Norte",
      divisao: "jovens",
      responsavel_nome: "Pastor Ficticio",
      criado_em: qualquerTexto,
      atualizado_em: qualquerTexto,
    });
    expect(adulta.responsavel_nome).toBeNull();
    expect(await listarRedes()).toEqual([adulta, jovem]);

    const obtida = await chamar("GET", `/api/admin/redes/${jovem.id}`);
    expect(obtida.status).toBe(200);
    expect(conforme(redeSchema, obtida.corpo)).toEqual(jovem);
  });

  it("PUT substitui todos os campos (o que fica de fora volta ao padrão)", async () => {
    const rede = await criarRede({ responsavel_nome: "Pastor Ficticio" });

    const resposta = await chamar("PUT", `/api/admin/redes/${rede.id}`, {
      nome: "Rede Adulta Renomeada",
      divisao: "adultos",
    });

    expect(resposta.status).toBe(200);
    const atualizada = conforme(redeSchema, resposta.corpo);
    expect(atualizada).toEqual({
      ...rede,
      nome: "Rede Adulta Renomeada",
      divisao: "adultos",
      responsavel_nome: null,
      atualizado_em: qualquerTexto,
    });
    expect(atualizada.atualizado_em >= rede.atualizado_em).toBe(true);
  });

  it("400 requisicao_invalida com os problemas em detalhes (caminho, código, mensagem em português)", async () => {
    const resposta = await chamar("POST", "/api/admin/redes", {
      nome: "   ",
      divisao: "kids",
    });

    const erro = esperarErro(resposta, 400, "requisicao_invalida");
    expect(erro.detalhes).toEqual([
      { caminho: ["nome"], codigo: "too_small", mensagem: "Campo obrigatório" },
      {
        caminho: ["divisao"],
        codigo: "invalid_value",
        mensagem: 'Use "jovens" ou "adultos"',
      },
    ]);
    expect(await listarRedes()).toEqual([]);
  });

  it("mensagens de validação em português nos casos comuns (códigos e status não mudam)", async () => {
    const rede = await criarRede();
    const discipulador = await criarDiscipulador(rede.id, "Discipulador A");
    const casos: ["GET" | "POST", string, unknown, unknown[]][] = [
      [
        "POST",
        "/api/admin/redes",
        {},
        [
          {
            caminho: ["nome"],
            codigo: "invalid_type",
            mensagem: "Campo obrigatório",
          },
          {
            caminho: ["divisao"],
            codigo: "invalid_value",
            mensagem: 'Use "jovens" ou "adultos"',
          },
        ],
      ],
      [
        "POST",
        "/api/admin/redes",
        { nome: "x".repeat(121), divisao: "jovens", responsavel_nome: 5 },
        [
          {
            caminho: ["nome"],
            codigo: "too_big",
            mensagem: "Use no máximo 120 caracteres",
          },
          {
            caminho: ["responsavel_nome"],
            codigo: "invalid_type",
            mensagem: "Use um texto",
          },
        ],
      ],
      [
        "POST",
        "/api/admin/discipuladores",
        { rede_id: "1", nome: "Discipulador B" },
        [
          {
            caminho: ["rede_id"],
            codigo: "invalid_type",
            mensagem: "Use um número",
          },
        ],
      ],
      [
        "POST",
        "/api/admin/discipuladores",
        { rede_id: 1.5, nome: "Discipulador B" },
        [
          {
            caminho: ["rede_id"],
            codigo: "invalid_type",
            mensagem: "Use um número inteiro",
          },
        ],
      ],
      [
        "POST",
        "/api/admin/celulas",
        {
          discipulador_id: discipulador.id,
          nome: "Célula 01",
          qtd_pessoas: 0,
          lider_nome: "Líder",
          lider_email: "sem-arroba",
        },
        [
          {
            caminho: ["qtd_pessoas"],
            codigo: "too_small",
            mensagem: "Use um número a partir de 1",
          },
          {
            caminho: ["lider_email"],
            codigo: "invalid_format",
            mensagem: "E-mail inválido",
          },
        ],
      ],
      [
        "POST",
        "/api/admin/celulas",
        {
          discipulador_id: discipulador.id,
          nome: "Célula 01",
          qtd_pessoas: 1001,
          lider_nome: " ",
          lider_telefone: "9".repeat(41),
        },
        [
          {
            caminho: ["qtd_pessoas"],
            codigo: "too_big",
            mensagem: "Use um número até 1000",
          },
          {
            caminho: ["lider_nome"],
            codigo: "too_small",
            mensagem: "Campo obrigatório",
          },
          {
            caminho: ["lider_telefone"],
            codigo: "too_big",
            mensagem: "Use no máximo 40 caracteres",
          },
        ],
      ],
      [
        "GET",
        "/api/admin/redes/abc",
        undefined,
        [
          {
            caminho: ["id"],
            codigo: "invalid_type",
            mensagem: "Use um número",
          },
        ],
      ],
      [
        "GET",
        "/api/admin/redes/0",
        undefined,
        [
          {
            caminho: ["id"],
            codigo: "too_small",
            mensagem: "Use um número maior que 0",
          },
        ],
      ],
      [
        "GET",
        "/api/admin/celulas?divisao=kids",
        undefined,
        [
          {
            caminho: ["divisao"],
            codigo: "invalid_value",
            mensagem: 'Use "jovens" ou "adultos"',
          },
        ],
      ],
    ];

    for (const [metodo, caminho, corpo, detalhes] of casos) {
      const erro = esperarErro(
        await chamar(metodo, caminho, corpo),
        400,
        "requisicao_invalida",
      );
      expect({ caminho, detalhes: erro.detalhes }).toEqual({
        caminho,
        detalhes,
      });
    }
  });

  it("nomes com espaços em sequência (inclusive espaço não separável e tab) são o mesmo nome; o gravado tem um espaço só", async () => {
    await criarRede({ nome: "Rede Jovem" });
    for (const nome of [
      "Rede  Jovem",
      "Rede\u00A0Jovem",
      "Rede\tJovem",
      " rede \u00A0 jovem ",
    ]) {
      esperarErro(
        await chamar("POST", "/api/admin/redes", { nome, divisao: "jovens" }),
        409,
        "nome_duplicado",
      );
    }
    // Casos que o UNIQUE NOCASE do banco não pega, só a chave de nome: um nome gravado antes com
    // espaços duplos e uma diferença de maiúscula acentuada somada a espaços.
    await env.DB.prepare(
      "INSERT INTO redes (nome, divisao) VALUES ('Rede  Legada', 'adultos')",
    ).run();
    await criarRede({ nome: "Rede ágape" });
    for (const nome of ["Rede Legada", "REDE  ÁGAPE"]) {
      esperarErro(
        await chamar("POST", "/api/admin/redes", { nome, divisao: "adultos" }),
        409,
        "nome_duplicado",
      );
    }

    const adulta = await criarRede({
      nome: "  Rede\u00A0\u00A0Adulta   Sul ",
      divisao: "adultos",
      responsavel_nome: "Pastor   Fulano",
    });
    expect(adulta).toMatchObject({
      nome: "Rede Adulta Sul",
      responsavel_nome: "Pastor Fulano",
    });
    const discipulador = await criarDiscipulador(
      adulta.id,
      "Discipulador\t\tB",
    );
    expect(discipulador.nome).toBe("Discipulador B");
    const celula = await criarCelula(discipulador.id, "Célula   01", {
      lider_nome: "Líder  Um",
      lider_telefone: "(91)  90000-0001",
    });
    expect(celula).toMatchObject({
      nome: "Célula 01",
      lider_nome: "Líder Um",
      lider_telefone: "(91) 90000-0001",
    });
    const renomeada = await chamar("PUT", `/api/admin/redes/${adulta.id}`, {
      nome: "Rede   Adulta\tSul",
      divisao: "adultos",
    });
    expect(conforme(redeSchema, renomeada.corpo).nome).toBe("Rede Adulta Sul");
  });

  it("400 json_invalido quando o corpo não é JSON ou não vem como JSON", async () => {
    const malformado = await chamar("POST", "/api/admin/redes", undefined, {
      corpoBruto: '{"nome": "Rede',
    });
    esperarErro(malformado, 400, "json_invalido");

    const semContentType = await chamar(
      "POST",
      "/api/admin/redes",
      { nome: "Rede Jovem Ficticia", divisao: "jovens" },
      { contentType: null },
    );
    esperarErro(semContentType, 400, "json_invalido");

    const textoPuro = await chamar(
      "POST",
      "/api/admin/redes",
      { nome: "Rede Jovem Ficticia", divisao: "jovens" },
      { contentType: "text/plain" },
    );
    esperarErro(textoPuro, 400, "json_invalido");
    expect(await listarRedes()).toEqual([]);
  });

  it("400 requisicao_invalida quando :id não é um inteiro positivo", async () => {
    for (const id of ["abc", "0", "-3", "1.5"]) {
      const erro = esperarErro(
        await chamar("GET", `/api/admin/redes/${id}`),
        400,
        "requisicao_invalida",
      );
      expect(erro.detalhes).toEqual([
        expect.objectContaining({ caminho: ["id"] }),
      ]);
    }
  });

  it("404 nao_encontrado para id inexistente em GET, PUT e DELETE", async () => {
    const corpo = { nome: "Rede Jovem Ficticia", divisao: "jovens" };
    esperarErro(
      await chamar("GET", "/api/admin/redes/999"),
      404,
      "nao_encontrado",
    );
    esperarErro(
      await chamar("PUT", "/api/admin/redes/999", corpo),
      404,
      "nao_encontrado",
    );
    esperarErro(
      await chamar("DELETE", "/api/admin/redes/999"),
      404,
      "nao_encontrado",
    );
  });

  it("409 nome_duplicado sem diferenciar maiúsculas (inclusive acentuadas) nem espaços nas pontas", async () => {
    const agape = await criarRede({ nome: "Rede Ágape" });
    const outra = await criarRede({ nome: "Rede Videira" });

    for (const nome of ["Rede Ágape", "  REDE ÁGAPE ", "rede ágape"]) {
      const erro = esperarErro(
        await chamar("POST", "/api/admin/redes", { nome, divisao: "adultos" }),
        409,
        "nome_duplicado",
      );
      expect(erro.mensagem).toBe("Já existe uma rede com esse nome");
    }
    esperarErro(
      await chamar("PUT", `/api/admin/redes/${outra.id}`, {
        nome: "REDE ágape",
        divisao: "jovens",
      }),
      409,
      "nome_duplicado",
    );

    // A própria rede pode mudar as maiúsculas do nome; acento diferente é outro nome.
    const renomeada = await chamar("PUT", `/api/admin/redes/${agape.id}`, {
      nome: "REDE ÁGAPE",
      divisao: "jovens",
    });
    expect(renomeada.status).toBe(200);
    await criarRede({ nome: "Rede Agape" });
    expect(nomes(await listarRedes()).sort()).toEqual(
      ["REDE ÁGAPE", "Rede Agape", "Rede Videira"].sort(),
    );
  });

  it("DELETE responde 204, e 409 em_uso enquanto a rede tem discipulador (FK RESTRICT)", async () => {
    const rede = await criarRede();
    const discipulador = await criarDiscipulador(rede.id, "Discipulador A");

    const emUso = esperarErro(
      await chamar("DELETE", `/api/admin/redes/${rede.id}`),
      409,
      "em_uso",
    );
    expect(emUso.mensagem).toContain("discipuladores (1)");
    expect(nomes(await listarRedes())).toEqual(["Rede Jovem Ficticia"]);

    const semDiscipulador = await chamar(
      "DELETE",
      `/api/admin/discipuladores/${discipulador.id}`,
    );
    expect(semDiscipulador).toEqual({ status: 204, corpo: null });
    expect(await chamar("DELETE", `/api/admin/redes/${rede.id}`)).toEqual({
      status: 204,
      corpo: null,
    });
    esperarErro(
      await chamar("GET", `/api/admin/redes/${rede.id}`),
      404,
      "nao_encontrado",
    );
  });

  it("falha inesperada vira 500 erro_interno no formato único", async () => {
    const consoleError = vi
      .spyOn(console, "error")
      .mockImplementation(() => {});
    const dbComFalha = {
      prepare: () => {
        throw new Error("D1 indisponível");
      },
    } as unknown as D1Database;

    const resposta = await chamar("GET", "/api/admin/redes", undefined, {
      db: dbComFalha,
    });

    expect(resposta).toEqual({
      status: 500,
      corpo: { erro: { codigo: "erro_interno", mensagem: "Erro interno" } },
    });
    expect(consoleError).toHaveBeenCalledOnce();
  });
});

describe("CA1: discipuladores", () => {
  it("POST cria com o nome e a divisão da rede; GET obtém", async () => {
    const rede = await criarRede({
      nome: "Rede Adulta Leste",
      divisao: "adultos",
    });

    const discipulador = await criarDiscipulador(
      rede.id,
      " Discipulador João ",
    );

    expect(discipulador).toEqual({
      id: expect.any(Number),
      rede_id: rede.id,
      nome: "Discipulador João",
      rede_nome: "Rede Adulta Leste",
      divisao: "adultos",
      criado_em: qualquerTexto,
      atualizado_em: qualquerTexto,
    });
    const obtido = await chamar(
      "GET",
      `/api/admin/discipuladores/${discipulador.id}`,
    );
    expect(conforme(discipuladorSchema, obtido.corpo)).toEqual(discipulador);
  });

  it("lista com o filtro ?rede_id=", async () => {
    const norte = await criarRede({ nome: "Rede Norte" });
    const sul = await criarRede({ nome: "Rede Sul", divisao: "adultos" });
    await criarDiscipulador(norte.id, "Discipulador B");
    await criarDiscipulador(sul.id, "Discipulador C");
    await criarDiscipulador(norte.id, "Discipulador A");

    expect(nomes(await listarDiscipuladores())).toEqual([
      "Discipulador A",
      "Discipulador B",
      "Discipulador C",
    ]);
    expect(nomes(await listarDiscipuladores(`?rede_id=${norte.id}`))).toEqual([
      "Discipulador A",
      "Discipulador B",
    ]);
    expect(await listarDiscipuladores("?rede_id=999")).toEqual([]);
    const erro = esperarErro(
      await chamar("GET", "/api/admin/discipuladores?rede_id=abc"),
      400,
      "requisicao_invalida",
    );
    expect(erro.detalhes).toEqual([
      expect.objectContaining({ caminho: ["rede_id"] }),
    ]);
  });

  it("400 referencia_invalida quando rede_id não existe (POST e PUT)", async () => {
    const rede = await criarRede();
    const discipulador = await criarDiscipulador(rede.id, "Discipulador A");

    for (const resposta of [
      await chamar("POST", "/api/admin/discipuladores", {
        rede_id: 999,
        nome: "Discipulador Novo",
      }),
      await chamar("PUT", `/api/admin/discipuladores/${discipulador.id}`, {
        rede_id: 999,
        nome: "Discipulador A",
      }),
    ]) {
      const erro = esperarErro(resposta, 400, "referencia_invalida");
      expect(erro.detalhes).toEqual([
        {
          caminho: ["rede_id"],
          codigo: "referencia_invalida",
          mensagem: "A rede 999 não existe",
        },
      ]);
    }
    expect(nomes(await listarDiscipuladores())).toEqual(["Discipulador A"]);
  });

  it("PUT muda de rede (e de divisão); 404 e 409 seguem o padrão", async () => {
    const jovem = await criarRede({ nome: "Rede Jovem" });
    const adulta = await criarRede({ nome: "Rede Adulta", divisao: "adultos" });
    const discipulador = await criarDiscipulador(jovem.id, "Discipulador A");
    await criarDiscipulador(jovem.id, "Discipulador B");

    const movido = await chamar(
      "PUT",
      `/api/admin/discipuladores/${discipulador.id}`,
      { rede_id: adulta.id, nome: "Discipulador A" },
    );
    expect(movido.status).toBe(200);
    expect(conforme(discipuladorSchema, movido.corpo)).toMatchObject({
      rede_id: adulta.id,
      rede_nome: "Rede Adulta",
      divisao: "adultos",
    });

    esperarErro(
      await chamar("PUT", "/api/admin/discipuladores/999", {
        rede_id: adulta.id,
        nome: "Outro",
      }),
      404,
      "nao_encontrado",
    );
    esperarErro(
      await chamar("PUT", `/api/admin/discipuladores/${discipulador.id}`, {
        rede_id: adulta.id,
        nome: "discipulador b",
      }),
      409,
      "nome_duplicado",
    );
  });

  it("DELETE: 409 em_uso enquanto há célula, 204 depois, 404 se não existe", async () => {
    const rede = await criarRede();
    const discipulador = await criarDiscipulador(rede.id, "Discipulador A");
    const celula = await criarCelula(discipulador.id, "Célula 01");

    const emUso = esperarErro(
      await chamar("DELETE", `/api/admin/discipuladores/${discipulador.id}`),
      409,
      "em_uso",
    );
    expect(emUso.mensagem).toContain("células (1)");

    await chamar("DELETE", `/api/admin/celulas/${celula.id}`);
    expect(
      await chamar("DELETE", `/api/admin/discipuladores/${discipulador.id}`),
    ).toEqual({ status: 204, corpo: null });
    esperarErro(
      await chamar("DELETE", `/api/admin/discipuladores/${discipulador.id}`),
      404,
      "nao_encontrado",
    );
  });
});

describe("CA1: células", () => {
  async function montarHierarquia() {
    const jovem = await criarRede({ nome: "Rede Jovem", divisao: "jovens" });
    const adulta = await criarRede({ nome: "Rede Adulta", divisao: "adultos" });
    const discipuladorA = await criarDiscipulador(jovem.id, "Discipulador A");
    const discipuladorB = await criarDiscipulador(jovem.id, "Discipulador B");
    const discipuladorC = await criarDiscipulador(adulta.id, "Discipulador C");
    await criarCelula(discipuladorA.id, "Célula 01");
    await criarCelula(discipuladorB.id, "Célula 02");
    await criarCelula(discipuladorC.id, "Célula 03");
    return { jovem, adulta, discipuladorA, discipuladorB, discipuladorC };
  }

  it("POST cria com os dados do discipulador e da rede; e-mail e telefone são opcionais", async () => {
    const rede = await criarRede({ nome: "Rede Jovem", divisao: "jovens" });
    const discipulador = await criarDiscipulador(rede.id, "Discipulador A");

    const celula = await criarCelula(discipulador.id, " Célula Conceição ", {
      qtd_pessoas: 12,
      lider_nome: "Líder Fictício",
      lider_email: "lider@example.com",
    });

    expect(celula).toEqual({
      id: expect.any(Number),
      discipulador_id: discipulador.id,
      nome: "Célula Conceição",
      qtd_pessoas: 12,
      lider_nome: "Líder Fictício",
      lider_email: "lider@example.com",
      lider_telefone: null,
      discipulador_nome: "Discipulador A",
      rede_id: rede.id,
      rede_nome: "Rede Jovem",
      divisao: "jovens",
      criado_em: qualquerTexto,
      atualizado_em: qualquerTexto,
    });
    const obtida = await chamar("GET", `/api/admin/celulas/${celula.id}`);
    expect(conforme(celulaSchema, obtida.corpo)).toEqual(celula);
  });

  it("lista com os filtros ?discipulador_id=, ?rede_id= e ?divisao= (combináveis)", async () => {
    const { jovem, adulta, discipuladorB, discipuladorC } =
      await montarHierarquia();

    expect(nomes(await listarCelulas())).toEqual([
      "Célula 01",
      "Célula 02",
      "Célula 03",
    ]);
    expect(nomes(await listarCelulas("?divisao=jovens"))).toEqual([
      "Célula 01",
      "Célula 02",
    ]);
    expect(nomes(await listarCelulas("?divisao=adultos"))).toEqual([
      "Célula 03",
    ]);
    expect(nomes(await listarCelulas(`?rede_id=${jovem.id}`))).toEqual([
      "Célula 01",
      "Célula 02",
    ]);
    expect(
      nomes(await listarCelulas(`?discipulador_id=${discipuladorB.id}`)),
    ).toEqual(["Célula 02"]);
    expect(
      nomes(
        await listarCelulas(
          `?rede_id=${adulta.id}&discipulador_id=${discipuladorC.id}&divisao=adultos`,
        ),
      ),
    ).toEqual(["Célula 03"]);
    expect(await listarCelulas(`?rede_id=${jovem.id}&divisao=adultos`)).toEqual(
      [],
    );
    esperarErro(
      await chamar("GET", "/api/admin/celulas?divisao=kids"),
      400,
      "requisicao_invalida",
    );
  });

  it("400 requisicao_invalida para qtd_pessoas fora de 1–1000 e e-mail inválido", async () => {
    const { discipuladorA } = await montarHierarquia();
    const base = {
      discipulador_id: discipuladorA.id,
      nome: "Célula Nova",
      qtd_pessoas: 10,
      lider_nome: "Líder",
    };

    for (const [alteracao, campo] of [
      [{ qtd_pessoas: 0 }, "qtd_pessoas"],
      [{ qtd_pessoas: 1001 }, "qtd_pessoas"],
      [{ qtd_pessoas: 12.5 }, "qtd_pessoas"],
      [{ lider_email: "sem-arroba" }, "lider_email"],
      [{ lider_nome: "" }, "lider_nome"],
    ] as const) {
      const erro = esperarErro(
        await chamar("POST", "/api/admin/celulas", { ...base, ...alteracao }),
        400,
        "requisicao_invalida",
      );
      expect(erro.detalhes).toEqual([
        expect.objectContaining({ caminho: [campo] }),
      ]);
    }
    expect(await listarCelulas()).toHaveLength(3);
  });

  it("400 referencia_invalida quando discipulador_id não existe; 409 com nome de outra célula", async () => {
    const { discipuladorC } = await montarHierarquia();

    const erro = esperarErro(
      await chamar("POST", "/api/admin/celulas", {
        discipulador_id: 999,
        nome: "Célula Nova",
        qtd_pessoas: 10,
        lider_nome: "Líder",
      }),
      400,
      "referencia_invalida",
    );
    expect(erro.detalhes).toEqual([
      expect.objectContaining({ caminho: ["discipulador_id"] }),
    ]);

    // O nome é único entre todas as células, de qualquer discipulador.
    esperarErro(
      await chamar("POST", "/api/admin/celulas", {
        discipulador_id: discipuladorC.id,
        nome: "CÉLULA 01",
        qtd_pessoas: 10,
        lider_nome: "Líder",
      }),
      409,
      "nome_duplicado",
    );
    expect(nomes(await listarCelulas())).toEqual([
      "Célula 01",
      "Célula 02",
      "Célula 03",
    ]);
  });

  it("PUT substitui tudo: e-mail e telefone que ficam de fora viram null", async () => {
    const rede = await criarRede();
    const discipulador = await criarDiscipulador(rede.id, "Discipulador A");
    const outro = await criarDiscipulador(rede.id, "Discipulador B");
    const celula = await criarCelula(discipulador.id, "Célula 01", {
      lider_email: "lider@example.com",
      lider_telefone: "(91) 90000-0001",
    });

    const resposta = await chamar("PUT", `/api/admin/celulas/${celula.id}`, {
      discipulador_id: outro.id,
      nome: "Célula 01",
      qtd_pessoas: 20,
      lider_nome: "Nova Líder",
    });

    expect(resposta.status).toBe(200);
    expect(conforme(celulaSchema, resposta.corpo)).toMatchObject({
      discipulador_id: outro.id,
      discipulador_nome: "Discipulador B",
      qtd_pessoas: 20,
      lider_nome: "Nova Líder",
      lider_email: null,
      lider_telefone: null,
    });
    esperarErro(
      await chamar("PUT", "/api/admin/celulas/999", {
        discipulador_id: outro.id,
        nome: "Célula 01",
        qtd_pessoas: 20,
        lider_nome: "Nova Líder",
      }),
      404,
      "nao_encontrado",
    );
  });

  it("DELETE: 409 em_uso com afiliado vinculado, 204 depois de desvincular", async () => {
    const rede = await criarRede();
    const discipulador = await criarDiscipulador(rede.id, "Discipulador A");
    const celula = await criarCelula(discipulador.id, "Célula 01");
    await env.DB.prepare(
      `INSERT INTO afiliados (affiliate_id, celula_id, origem, vinculado_em)
       VALUES (4242, ?, 'manual', '2026-11-06T18:00:00.000Z')`,
    )
      .bind(celula.id)
      .run();

    const emUso = esperarErro(
      await chamar("DELETE", `/api/admin/celulas/${celula.id}`),
      409,
      "em_uso",
    );
    expect(emUso.mensagem).toBe(
      "A célula tem afiliados vinculados (1). Desvincule os afiliados antes de excluir a célula.",
    );

    await env.DB.prepare(
      "UPDATE afiliados SET celula_id = NULL, vinculado_em = NULL WHERE affiliate_id = 4242",
    ).run();
    expect(await chamar("DELETE", `/api/admin/celulas/${celula.id}`)).toEqual({
      status: 204,
      corpo: null,
    });
    esperarErro(
      await chamar("GET", `/api/admin/celulas/${celula.id}`),
      404,
      "nao_encontrado",
    );
  });
});
