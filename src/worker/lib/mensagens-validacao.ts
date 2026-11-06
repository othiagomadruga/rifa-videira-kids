// Mensagens de validação em português para os problemas do zod, usadas como mapa de erros por chamada
// (`schema.safeParse(valor, { error: mensagemDeCampo })`). Só a `mensagem` muda: código e caminho de
// cada problema continuam os do zod. A mensagem escrita no próprio schema (ex.: "Use um número inteiro")
// continua valendo, porque o zod dá prioridade a ela.
import type { z } from "zod";

/** "a", "b" ou "c". */
function opcoes(valores: readonly unknown[]): string {
  const textos = valores.map((valor) => `"${String(valor)}"`);
  return textos.length <= 1
    ? (textos[0] ?? "")
    : `${textos.slice(0, -1).join(", ")} ou ${textos[textos.length - 1]}`;
}

/** Mapa de erros em português. `obrigatorio` é a mensagem de valor ausente ou vazio. */
export function mapaDeMensagens(obrigatorio: string): z.core.$ZodErrorMap {
  return (problema) => {
    switch (problema.code) {
      case "invalid_type":
        if (problema.input === undefined || problema.input === null)
          return obrigatorio;
        switch (problema.expected) {
          case "int":
            return "Use um número inteiro";
          case "number":
            return "Use um número";
          case "string":
            return "Use um texto";
          case "boolean":
            return "Use true ou false";
          case "object":
            return "Envie um objeto JSON";
          default:
            return "Valor inválido";
        }
      case "too_small":
        if (problema.origin === "string")
          return Number(problema.minimum) <= 1
            ? obrigatorio
            : `Use pelo menos ${problema.minimum} caracteres`;
        if (problema.origin === "number" || problema.origin === "int")
          return problema.inclusive === false
            ? `Use um número maior que ${problema.minimum}`
            : `Use um número a partir de ${problema.minimum}`;
        return "Valor inválido";
      case "too_big":
        if (problema.origin === "string")
          return `Use no máximo ${problema.maximum} caracteres`;
        if (problema.origin === "number" || problema.origin === "int")
          return problema.inclusive === false
            ? `Use um número menor que ${problema.maximum}`
            : `Use um número até ${problema.maximum}`;
        return "Valor inválido";
      case "invalid_format":
        return problema.format === "email"
          ? "E-mail inválido"
          : "Formato inválido";
      case "invalid_value":
        return `Use ${opcoes(problema.values)}`;
      default:
        return "Valor inválido";
    }
  };
}

/** Campos do corpo, da consulta e do caminho (CRUD). */
export const mensagemDeCampo = mapaDeMensagens("Campo obrigatório");

/** Células da planilha importada. */
export const mensagemDeCelula = mapaDeMensagens("Preencha esta coluna");
