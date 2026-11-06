// Textos da tela da hierarquia: rótulos, ordenação, busca e as mensagens de erro da API em português.
import type { Divisao } from "../../../shared/contracts";
import { ErroApi, mensagemDoErro } from "../../lib/api";

/** DIVISOES do contrato (cópia: veja hierarquia-api.ts). */
export const DIVISOES: readonly Divisao[] = ["jovens", "adultos"];

export const ROTULO_DIVISAO: Record<Divisao, string> = {
  jovens: "Jovens",
  adultos: "Adultos",
};

const comparador = new Intl.Collator("pt-BR", {
  numeric: true,
  sensitivity: "base",
});

/** Ordem alfabética do português ("Célula 2" antes de "Célula 10"). */
export function compararNomes(a: string, b: string): number {
  return comparador.compare(a, b);
}

/** Texto para comparar na busca: sem acentos, sem maiúsculas e sem espaços nas pontas. */
export function paraBusca(texto: string): string {
  return texto
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLocaleLowerCase("pt-BR")
    .trim();
}

/** "1 célula", "2 células". */
export function plural(
  quantidade: number,
  singular: string,
  pluralTexto: string,
): string {
  return `${quantidade.toLocaleString("pt-BR")} ${quantidade === 1 ? singular : pluralTexto}`;
}

export type Entidade = "rede" | "discipulador" | "celula";

const TEXTOS: Record<
  Entidade,
  { uma: string; esta: string; excluida: string }
> = {
  rede: { uma: "uma rede", esta: "Esta rede", excluida: "excluída" },
  discipulador: {
    uma: "um discipulador",
    esta: "Este discipulador",
    excluida: "excluído",
  },
  celula: { uma: "uma célula", esta: "Esta célula", excluida: "excluída" },
};

/** Erros que pedem para recarregar as listas (o registro sumiu ou a referência não existe mais). */
export function dadosDesatualizados(erro: unknown): boolean {
  return (
    erro instanceof ErroApi &&
    (erro.codigo === "nao_encontrado" || erro.codigo === "referencia_invalida")
  );
}

/** Erro curto do campo de nome quando ele já é usado (409 `nome_duplicado`). */
export function mensagemNomeRepetido(entidade: Entidade): string {
  return `Já existe ${TEXTOS[entidade].uma} com esse nome.`;
}

/** Mensagem de erro ao salvar (PUT). `nome` é o nome digitado. */
export function mensagemAoSalvar(
  erro: unknown,
  entidade: Entidade,
  nome: string,
): string {
  const textos = TEXTOS[entidade];
  if (erro instanceof ErroApi) {
    switch (erro.codigo) {
      case "nome_duplicado":
        return `Já existe ${textos.uma} com o nome “${nome}”. Os nomes não podem se repetir (maiúsculas e espaços nas pontas não contam): use outro nome.`;
      case "nao_encontrado":
        return `${textos.esta} não existe mais (pode ter sido ${textos.excluida}). A lista foi atualizada: feche e confira.`;
      case "referencia_invalida":
        return entidade === "celula"
          ? "O discipulador escolhido não existe mais. A lista foi atualizada: escolha outro."
          : "A rede escolhida não existe mais. A lista foi atualizada: escolha outra.";
    }
  }
  return mensagemDoErro(erro);
}

const EM_USO: Record<Entidade, string> = {
  rede: "Não dá para excluir: a rede ainda tem discipuladores. Mova os discipuladores para outra rede (botão Editar, na aba Discipuladores) ou exclua-os antes.",
  discipulador:
    "Não dá para excluir: o discipulador ainda tem células. Mova as células para outro discipulador (botão Editar, na aba Células) ou exclua-as antes.",
  celula:
    "Não dá para excluir: a célula tem afiliado da Rifei vinculado. Desvincule o afiliado antes de excluir a célula.",
};

/** Mensagem de erro ao excluir (DELETE): 409 `em_uso` explica o vínculo que impede. */
export function mensagemAoExcluir(erro: unknown, entidade: Entidade): string {
  if (erro instanceof ErroApi) {
    if (erro.codigo === "em_uso") return EM_USO[entidade];
    if (erro.codigo === "nao_encontrado") {
      return `${TEXTOS[entidade].esta} já tinha sido ${TEXTOS[entidade].excluida}. A lista foi atualizada.`;
    }
  }
  return mensagemDoErro(erro);
}

/**
 * Campos citados num 400 `requisicao_invalida` ou `referencia_invalida`: o primeiro item de `caminho`
 * de cada problema em `detalhes` (ex.: `[{ caminho: ["qtd_pessoas"], ... }]` → `["qtd_pessoas"]`).
 */
export function camposDoErro(erro: unknown): string[] {
  if (!(erro instanceof ErroApi) || !Array.isArray(erro.detalhes)) return [];
  const campos: string[] = [];
  for (const problema of erro.detalhes as unknown[]) {
    if (typeof problema !== "object" || problema === null) continue;
    const caminho = (problema as { caminho?: unknown }).caminho;
    const campo = Array.isArray(caminho) ? caminho[0] : undefined;
    if (typeof campo === "string" && !campos.includes(campo)) {
      campos.push(campo);
    }
  }
  return campos;
}
