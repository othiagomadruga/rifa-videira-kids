// @vitest-environment node
import { describe, expect, it } from "vitest";
import { lerVariavel } from "./dev-vars.mjs";

const NOME = "RIFEI_WEBHOOK_TOKEN";

describe("scripts/dev-vars.mjs: lerVariavel (formato dotenv do .dev.vars)", () => {
  it.each([
    ["sem aspas", "RIFEI_WEBHOOK_TOKEN=abc123", "abc123"],
    [
      "aspas duplas e comentário no fim",
      'RIFEI_WEBHOOK_TOKEN="x" # comentário',
      "x",
    ],
    ["aspas simples com espaço dentro", "RIFEI_WEBHOOK_TOKEN='a b c'", "a b c"],
    [
      "# dentro das aspas faz parte do valor",
      'RIFEI_WEBHOOK_TOKEN="x#y" # nota',
      "x#y",
    ],
    ["sem aspas e comentário no fim", "RIFEI_WEBHOOK_TOKEN=abc # nota", "abc"],
    [
      "export e espaços em volta do =",
      "export RIFEI_WEBHOOK_TOKEN = abc",
      "abc",
    ],
    ["vazio", "RIFEI_WEBHOOK_TOKEN=", ""],
  ])("%s", (_caso, linha, esperado) => {
    expect(lerVariavel(`# Segredos locais\n${linha}\nOUTRA=1\n`, NOME)).toBe(
      esperado,
    );
  });

  it("vale a última linha, aceita CRLF e ignora linha comentada e nome parecido", () => {
    const conteudo = [
      "# RIFEI_WEBHOOK_TOKEN=comentado",
      "RIFEI_WEBHOOK_TOKEN=primeiro",
      "RIFEI_WEBHOOK_TOKEN_ANTIGO=outro",
      'RIFEI_WEBHOOK_TOKEN="ultimo"',
    ].join("\r\n");

    expect(lerVariavel(conteudo, NOME)).toBe("ultimo");
  });

  it("variável ausente devolve undefined", () => {
    expect(lerVariavel("OUTRA=1\n# RIFEI_WEBHOOK_TOKEN=x", NOME)).toBe(
      undefined,
    );
  });
});
