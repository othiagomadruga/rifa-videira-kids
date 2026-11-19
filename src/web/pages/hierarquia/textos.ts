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

/**
 * Trecho das mensagens do 409 `em_uso` de outra gravação ao mesmo tempo (RIFA-018): "A célula mudou enquanto
 * isso (outra alteração ao mesmo tempo)..." e "A exclusão foi recusada por uma referência que mudou enquanto
 * isso...". A API não manda outro sinal, então o site procura o texto (cópia de `src/worker/db/hierarquia.ts`,
 * conferida por `hierarquia-contrato.test.ts`).
 */
export const TRECHO_MUDOU_ENQUANTO_ISSO = "mudou enquanto isso";

/**
 * Erros que pedem para recarregar as listas: o registro sumiu, a referência não existe mais ou outra gravação
 * mudou o registro ao mesmo tempo (409 `em_uso` com "mudou enquanto isso"; os outros `em_uso`, como os
 * dependentes, não mudam nada na lista).
 */
export function dadosDesatualizados(erro: unknown): boolean {
  if (!(erro instanceof ErroApi)) return false;
  return (
    erro.codigo === "nao_encontrado" ||
    erro.codigo === "referencia_invalida" ||
    (erro.codigo === "em_uso" &&
      erro.mensagem.includes(TRECHO_MUDOU_ENQUANTO_ISSO))
  );
}

/** Erro curto do campo de nome quando ele já é usado (409 `nome_duplicado`). */
export function mensagemNomeRepetido(entidade: Entidade): string {
  return `Já existe ${TEXTOS[entidade].uma} com esse nome.`;
}

/**
 * Mensagem de erro ao salvar (PUT). `nome` é o nome digitado. Os outros códigos, como o 409 `em_uso` de outra
 * gravação ao mesmo tempo ("mudou enquanto isso", RIFA-018), mostram a mensagem da API.
 */
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

/** Reserva do 409 `em_uso` ao excluir, só para quando a API não manda a mensagem (o motivo mais comum). */
const EM_USO: Record<Entidade, string> = {
  rede: "Não dá para excluir: a rede ainda tem discipuladores. Mova os discipuladores para outra rede (botão Editar, na aba Discipuladores) ou exclua-os antes.",
  discipulador:
    "Não dá para excluir: o discipulador ainda tem células. Mova as células para outro discipulador (botão Editar, na aba Células) ou exclua-as antes.",
  celula:
    "Não dá para excluir: a célula tem afiliado da Rifei vinculado. Passe o afiliado para outra célula (Adesão → Todas as células → Trocar), que leva as vendas junto, antes de excluir esta.",
};

/**
 * Mensagem de erro ao excluir (DELETE). No 409 `em_uso` vale a mensagem da API, que diz o motivo conferido no
 * banco: os dependentes, a trilha de auditoria ou outra gravação ao mesmo tempo ("mudou enquanto isso",
 * RIFA-018). O texto fixo de EM_USO só entra se a mensagem vier vazia.
 */
export function mensagemAoExcluir(erro: unknown, entidade: Entidade): string {
  if (erro instanceof ErroApi) {
    if (erro.codigo === "em_uso") {
      return erro.mensagem.trim() === "" ? EM_USO[entidade] : erro.mensagem;
    }
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

// ---------------------------------------------------------------------------------------------------
// Dicas (RIFA-045): a explicação que aparece com o mouse parado (ou o foco do teclado) em cada botão e campo da
// tela. Dizem para que serve e o que acontece, sem repetir o rótulo.
// ---------------------------------------------------------------------------------------------------

export const DICAS = {
  abaCelulas:
    "Cada célula com rede, discipulador, divisão, pessoas e líder. Dá para filtrar, editar e excluir.",
  abaDiscipuladores:
    "Cada discipulador com a rede e quantas células e pessoas tem. Dá para editar e excluir.",
  abaRedes:
    "Cada rede com a divisão, o responsável e os totais de discipuladores, células e pessoas.",
  abaImportar:
    "Cadastra ou atualiza de uma vez as redes, os discipuladores e as células por uma planilha.",
  tentarDeNovo:
    "Lê as tabelas de novo. Enquanto isso, a tela continua com os dados que já tinha.",
  // Login das células com senha (RIFA-064, D29)
  verSenhas:
    "Mostra a senha padrão de cada célula, para repassar ao líder pelo WhatsApp. A senha sai do nome da célula.",
  copiarSenha:
    "Copia a senha desta célula, para colar na conversa com o líder.",
  limparFiltros:
    "Tira a divisão, a rede e a busca e mostra todas as células de novo.",
  irParaImportar:
    "Abre a aba de importação, onde você baixa o modelo e envia a planilha das células.",
  editar: {
    celula:
      "Abre o formulário para corrigir o nome, o discipulador, as pessoas e o líder desta célula.",
    discipulador:
      "Abre o formulário para corrigir o nome deste discipulador ou mudar a rede dele.",
    rede: "Abre o formulário para corrigir o nome, a divisão e o responsável desta rede.",
  } satisfies Record<Entidade, string>,
  excluir: {
    celula:
      "Apaga a célula, depois de pedir confirmação. Só dá se ela não tiver afiliado da Rifei vinculado.",
    discipulador:
      "Apaga o discipulador, depois de pedir confirmação. Só dá se ele não tiver células.",
    rede: "Apaga a rede, depois de pedir confirmação. Só dá se ela não tiver discipuladores.",
  } satisfies Record<Entidade, string>,
  cancelarEdicao: "Fecha sem salvar. Nada muda na hierarquia.",
  salvar:
    "Grava as mudanças e atualiza as tabelas. Se algum campo estiver errado, ele avisa.",
  salvando: "Gravando as mudanças. Espere um instante.",
  // Confirmação da exclusão
  cancelarExclusao: "Fecha sem excluir. Nada muda na hierarquia.",
  confirmarExclusao:
    "Apaga de vez. Se ainda houver algo ligado, o sistema avisa e não apaga.",
  excluindo: "Excluindo. Espere um instante.",
  // Importação da planilha
  baixarModelo:
    "Baixa a planilha com as colunas certas e duas linhas de exemplo, para preencher no Excel ou no Google Planilhas.",
  colunasDaPlanilha:
    "Abre a explicação de cada coluna da planilha: o que vai nela e se é obrigatória.",
  escolherPlanilha:
    "Abre a escolha do arquivo no aparelho. A tela lê a planilha, mas nada é gravado ainda.",
  escolherPlanilhaOcupado:
    "Indisponível enquanto a planilha é conferida ou importada.",
  conferir:
    "Manda a planilha para o sistema conferir e mostra o que vai mudar e os erros de cada linha. Nada é gravado.",
  conferirIndisponivel:
    "Indisponível até escolher uma planilha que a tela consiga ler, ou enquanto o sistema trabalha nela.",
  importar:
    "Grava a planilha conferida, e as tabelas da hierarquia mudam na hora. Só libera depois de uma conferência sem erros.",
  verCelulas: "Volta para a aba Células, que já mostra o que foi importado.",
} as const;

/**
 * Com uma rede só (RIFA-065, D30), as dicas que citavam a rede, sem ela. A da importação explica que a planilha
 * continua com a coluna `rede`, com o mesmo nome em todas as linhas.
 */
export const DICAS_REDE_UNICA = {
  abaCelulas:
    "Cada célula com o discipulador, a divisão, as pessoas e o líder. Dá para filtrar, editar e excluir.",
  abaDiscipuladores:
    "Cada discipulador com quantas células e pessoas tem. Dá para editar e excluir.",
  abaImportar:
    "Cadastra ou atualiza de uma vez os discipuladores e as células por uma planilha. A coluna rede continua obrigatória, mas a rede pode ser uma só: o mesmo nome em todas as linhas.",
  filtroDivisao: "Mostra só as células de Jovens ou de Adultos.",
  limparFiltros: "Tira a divisão e a busca e mostra todas as células de novo.",
  editarDiscipulador:
    "Abre o formulário para corrigir o nome deste discipulador.",
  discipuladorDaCelula:
    "Quem acompanha a célula. Nos rankings e no painel, ela passa a contar, com as vendas de antes, para este discipulador.",
} as const;
