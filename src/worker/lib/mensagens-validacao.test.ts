// Mensagens de validação em português (CRUD e planilha): só o texto muda, código e caminho são do zod.
import { describe, expect, it } from "vitest";
import { z } from "zod";
import {
  celulaEntradaSchema,
  linhaCsvHierarquiaSchema,
} from "../../shared/contracts";
import { mensagemDeCampo, mensagemDeCelula } from "./mensagens-validacao";

function problemas(
  schema: z.ZodType,
  valor: unknown,
  mapa: z.core.$ZodErrorMap,
) {
  const resultado = schema.safeParse(valor, { error: mapa });
  if (resultado.success) throw new Error("era para falhar");
  return resultado.error.issues.map(({ path, code, message }) => ({
    path,
    code,
    message,
  }));
}

describe("mensagens de validação em português", () => {
  it("traduz os casos comuns de um corpo do CRUD, mantendo código e caminho", () => {
    expect(
      problemas(
        celulaEntradaSchema,
        { nome: "x".repeat(121), qtd_pessoas: 12.5, lider_email: "x" },
        mensagemDeCampo,
      ),
    ).toEqual([
      {
        path: ["discipulador_id"],
        code: "invalid_type",
        message: "Campo obrigatório",
      },
      {
        path: ["nome"],
        code: "too_big",
        message: "Use no máximo 120 caracteres",
      },
      {
        path: ["qtd_pessoas"],
        code: "invalid_type",
        message: "Use um número inteiro",
      },
      {
        path: ["lider_nome"],
        code: "invalid_type",
        message: "Campo obrigatório",
      },
      {
        path: ["lider_email"],
        code: "invalid_format",
        message: "E-mail inválido",
      },
    ]);
  });

  it.each([
    [z.number().positive(), 0, "Use um número maior que 0"],
    [z.number().min(1), 0, "Use um número a partir de 1"],
    [z.number().max(10), 11, "Use um número até 10"],
    [z.number().lt(10), 10, "Use um número menor que 10"],
    [z.number(), "1", "Use um número"],
    [z.string().min(3), "ab", "Use pelo menos 3 caracteres"],
    [z.string().min(1), "", "Campo obrigatório"],
    [z.string(), null, "Campo obrigatório"],
    [z.string(), 5, "Use um texto"],
    [z.boolean(), "sim", "Use true ou false"],
    [z.object({}), [], "Envie um objeto JSON"],
    [z.enum(["a", "b", "c"]), "d", 'Use "a", "b" ou "c"'],
    [z.url(), "não é url", "Formato inválido"],
    [z.array(z.string()).min(1), [], "Valor inválido"],
  ] as [z.ZodType, unknown, string][])(
    "%#: %j → %s",
    (schema, valor, mensagem) => {
      expect(problemas(schema, valor, mensagemDeCampo)[0].message).toBe(
        mensagem,
      );
    },
  );

  it("na planilha, o vazio pede para preencher a coluna; a mensagem do próprio schema continua valendo", () => {
    const linha = {
      rede: "",
      divisao: "jovens",
      discipulador: "D",
      celula: "C",
      qtd_pessoas: "12,5",
      lider_nome: "L",
    };
    expect(
      problemas(linhaCsvHierarquiaSchema, linha, mensagemDeCelula),
    ).toEqual([
      {
        path: ["rede"],
        code: "invalid_type",
        message: "Preencha esta coluna",
      },
      {
        path: ["qtd_pessoas"],
        code: "invalid_format",
        message: "Use um número inteiro",
      },
    ]);
  });
});
