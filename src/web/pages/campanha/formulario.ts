// Formulário da campanha: estado da tela (textos como a pessoa digita), conversão para o corpo do
// PUT (reais → centavos, % → pontos-base) e mensagens de erro em português perto de cada campo.
// A validação é a do contrato (corpoSalvarCampanhaSchema), a mesma que a API aplica: aqui só se
// lê o que foi digitado e se traduz cada problema para o campo certo.
import {
  ACESSO_PADRAO,
  BILHETES_PADRAO,
  FUSO_PADRAO,
  LIMITE_CARACTERES_MENSAGEM,
  MENSAGENS_PADRAO,
  PEDIDOS_PADRAO,
  PUBLICO_PADRAO,
  RANKING_POR_DIVISAO_PADRAO,
  TIPOS_MENSAGEM,
  calcularCalendario,
  corpoSalvarCampanhaSchema,
  detalhesDeValidacao,
  diaDoCalendario,
  type Campanha,
  type CriterioRanking,
  type DatasPeriodo,
  type DetalheValidacao,
  type RegraMeta,
  type TipoMensagem,
  type UnidadeMeta,
} from "../../../shared/contracts";
import type { z } from "zod";
import { formatarNumero, formatarPercentual } from "../../lib/formatadores";

export type PeriodoFormulario = {
  /** Identifica a linha na lista (não vai para a API). */
  chave: string;
  nome: string;
  dias: string;
  /** Percentual como digitado: "35" ou "12,5". */
  percentual: string;
};

export type Formulario = {
  nome: string;
  slug_rifei: string;
  fuso_horario: string;
  /** "YYYY-MM-DD" (campo de data) ou "". */
  data_inicio: string;
  /** Preço em reais, como digitado: "20,00". */
  preco: string;
  meta_unidade: UnidadeMeta | "";
  meta_regra: RegraMeta | "";
  /** Bilhetes (inteiro) ou reais, conforme a unidade. */
  meta_valor: string;
  periodos: PeriodoFormulario[];
  ranking_criterio: CriterioRanking | "";
  /** RIFA-061 (D27): separa o ranking por divisão (Jovens e Adultos) ou um ranking só. */
  ranking_por_divisao: boolean;
  publico_mostra_percentual_meta: boolean;
  /** "" = todas as posições (null na API). */
  publico_limite_ranking: string;
  /** Regras do admin (D20): desconsiderar pedido e o acesso de discipuladores e de redes. */
  pedidos_desconsiderar: boolean;
  acesso_discipuladores: boolean;
  acesso_redes: boolean;
  /** RIFA-064 (D29): o login das células com a senha padrão. */
  acesso_celulas_senha: boolean;
  /** Os modelos das mensagens do link pessoal (RIFA-032), como digitados. */
  mensagens: Record<TipoMensagem, string>;
  /** RIFA-075 (D35): quantos números a rifa tem, como digitado. */
  bilhetes_quantidade: string;
  /** "" = automático (null na API), "0" ou "1". */
  bilhetes_numero_inicial: "" | "0" | "1";
};

/** Corpo do PUT já validado pelo contrato (espaços tirados, padrões aplicados). */
export type CorpoCampanha = z.output<typeof corpoSalvarCampanhaSchema>;

/** Erros por campo. A chave é o caminho do contrato: "nome", "meta.valor", "periodos.0.dias"... */
export type ErrosFormulario = Record<string, string>;

export const LIMITE_PERIODOS = 53;

/** O botão "Usar o modelo de Santo André" (o resumo das regras leva a ele quando ainda não há períodos). */
export const ID_MODELO_SANTO_ANDRE = "campanha-modelo-santo-andre";

/** Campanha de referência de Santo André: 24 dias em 3 períodos de 10, 7 e 7 dias (35/25/45%). */
export const MODELO_SANTO_ANDRE = [
  { dias: 10, percentual_bp: 3500 },
  { dias: 7, percentual_bp: 2500 },
  { dias: 7, percentual_bp: 4500 },
] as const;

let ultimaChave = 0;
function novaChave(): string {
  ultimaChave += 1;
  return `periodo-${ultimaChave}`;
}

export function periodoVazio(numero: number): PeriodoFormulario {
  return {
    chave: novaChave(),
    nome: `Período ${numero}`,
    dias: "",
    percentual: "",
  };
}

/** Os 3 períodos do modelo de Santo André (não mexe em preço nem meta). */
export function periodosDoModeloSantoAndre(): PeriodoFormulario[] {
  return MODELO_SANTO_ANDRE.map(({ dias, percentual_bp }, indice) => ({
    chave: novaChave(),
    nome: `Período ${indice + 1}`,
    dias: String(dias),
    percentual: percentualParaTexto(percentual_bp),
  }));
}

/** Campanha ainda não configurada: só os padrões do contrato (fuso e visão pública). */
export function formularioVazio(): Formulario {
  return {
    nome: "",
    slug_rifei: "",
    fuso_horario: FUSO_PADRAO,
    data_inicio: "",
    preco: "",
    meta_unidade: "",
    meta_regra: "",
    meta_valor: "",
    periodos: [],
    ranking_criterio: "",
    ranking_por_divisao: RANKING_POR_DIVISAO_PADRAO,
    publico_mostra_percentual_meta: PUBLICO_PADRAO.mostra_percentual_meta,
    publico_limite_ranking: String(PUBLICO_PADRAO.limite_ranking),
    pedidos_desconsiderar: PEDIDOS_PADRAO.desconsiderar,
    acesso_discipuladores: ACESSO_PADRAO.discipuladores,
    acesso_redes: ACESSO_PADRAO.redes,
    acesso_celulas_senha: ACESSO_PADRAO.celulas_senha,
    mensagens: { ...MENSAGENS_PADRAO },
    bilhetes_quantidade: String(BILHETES_PADRAO.quantidade),
    bilhetes_numero_inicial: "",
  };
}

export function formularioDaCampanha(campanha: Campanha): Formulario {
  return {
    nome: campanha.nome,
    slug_rifei: campanha.slug_rifei,
    fuso_horario: campanha.fuso_horario,
    data_inicio: campanha.data_inicio,
    preco: reaisParaTexto(campanha.preco_bilhete_centavos),
    meta_unidade: campanha.meta.unidade,
    meta_regra: campanha.meta.regra,
    meta_valor:
      campanha.meta.unidade === "centavos"
        ? reaisParaTexto(campanha.meta.valor)
        : String(campanha.meta.valor),
    periodos: campanha.periodos.map((periodo) => ({
      chave: novaChave(),
      nome: periodo.nome,
      dias: String(periodo.dias),
      percentual: percentualParaTexto(periodo.percentual_bp),
    })),
    ranking_criterio: campanha.ranking.criterio,
    // Só false desliga: uma resposta sem a opção (API de antes dela) vale o padrão.
    ranking_por_divisao: campanha.ranking.por_divisao !== false,
    publico_mostra_percentual_meta: campanha.publico.mostra_percentual_meta,
    publico_limite_ranking:
      campanha.publico.limite_ranking === null
        ? ""
        : String(campanha.publico.limite_ranking),
    pedidos_desconsiderar: campanha.pedidos.desconsiderar,
    acesso_discipuladores: campanha.acesso.discipuladores,
    acesso_redes: campanha.acesso.redes,
    acesso_celulas_senha: campanha.acesso.celulas_senha,
    mensagens: { ...campanha.mensagens },
    // RIFA-075: uma resposta sem o grupo (API de antes dele) vale o padrão.
    bilhetes_quantidade: String(
      campanha.bilhetes?.quantidade ?? BILHETES_PADRAO.quantidade,
    ),
    bilhetes_numero_inicial:
      campanha.bilhetes?.numero_inicial === 0
        ? "0"
        : campanha.bilhetes?.numero_inicial === 1
          ? "1"
          : "",
  };
}

// ---------------------------------------------------------------------------------------------------
// Leitura do que foi digitado
// ---------------------------------------------------------------------------------------------------

const REAIS_PT_BR = /^(\d{1,3}(?:\.\d{3})+|\d+)(?:,(\d{1,2}))?$/;
const REAIS_COM_PONTO = /^(\d+)\.(\d{1,2})$/;

/**
 * Reais em centavos, sem conta com ponto flutuante: "20" → 2000, "20,5" → 2050, "1.234,56" →
 * 123456, "20.50" → 2050, "R$ 20,00" → 2000. null se não for um valor com até 2 casas decimais.
 */
export function lerReais(texto: string): number | null {
  const limpo = texto.replace(/R\$/i, "").replace(/\s/g, "");
  const ptBr = REAIS_PT_BR.exec(limpo);
  const comPonto = ptBr ? null : REAIS_COM_PONTO.exec(limpo);
  const partes = ptBr
    ? { inteiro: ptBr[1].replaceAll(".", ""), fracao: ptBr[2] ?? "" }
    : comPonto
      ? { inteiro: comPonto[1], fracao: comPonto[2] }
      : null;
  if (!partes) return null;
  const centavos =
    Number(partes.inteiro) * 100 + Number(partes.fracao.padEnd(2, "0"));
  return Number.isSafeInteger(centavos) ? centavos : null;
}

/** Percentual em pontos-base: "35" → 3500, "12,5" → 1250, "12.75" → 1275. null se não for número com até 2 casas. */
export function lerPercentual(texto: string): number | null {
  const partes = /^(\d{1,3})(?:[.,](\d{1,2}))?$/.exec(
    texto.replace(/[%\s]/g, ""),
  );
  if (!partes) return null;
  return Number(partes[1]) * 100 + Number((partes[2] ?? "").padEnd(2, "0"));
}

/** Inteiro sem sinal: "10" → 10, "1.000" → 1000. null se não for inteiro. */
export function lerInteiro(texto: string): number | null {
  const limpo = texto.trim();
  if (!/^(\d{1,3}(?:\.\d{3})+|\d+)$/.test(limpo)) return null;
  const numero = Number(limpo.replaceAll(".", ""));
  return Number.isSafeInteger(numero) ? numero : null;
}

/** 2000 → "20,00"; 123456 → "1.234,56" (sem "R$": o rótulo do campo diz a moeda). */
export function reaisParaTexto(centavos: number): string {
  const reais = Math.trunc(centavos / 100);
  const resto = String(centavos % 100).padStart(2, "0");
  return `${formatarNumero(reais)},${resto}`;
}

/** 3500 → "35"; 1250 → "12,5"; 1234 → "12,34". */
export function percentualParaTexto(pontosBase: number): string {
  const inteiro = Math.trunc(pontosBase / 100);
  const resto = pontosBase % 100;
  if (resto === 0) return String(inteiro);
  return `${inteiro},${String(resto).padStart(2, "0").replace(/0$/, "")}`;
}

/** Pontos-base com as casas que tiverem: 10500 → "105%", 10050 → "100,5%", 3333 → "33,33%". */
export function textoPercentual(pontosBase: number): string {
  const casasDecimais =
    pontosBase % 100 === 0 ? 0 : pontosBase % 10 === 0 ? 1 : 2;
  return formatarPercentual(pontosBase, { casasDecimais });
}

// ---------------------------------------------------------------------------------------------------
// Prévia: datas dos períodos e soma dos percentuais enquanto a pessoa digita
// ---------------------------------------------------------------------------------------------------

export type PreviaCalendario = {
  /** null = ainda não dá para calcular (sem data de início ou com dias inválidos antes). */
  periodos: (DatasPeriodo | null)[];
  data_fim: string | null;
  total_dias: number | null;
};

export function previaDoCalendario(formulario: Formulario): PreviaCalendario {
  const semDatas: PreviaCalendario = {
    periodos: formulario.periodos.map(() => null),
    data_fim: null,
    total_dias: null,
  };
  if (diaDoCalendario(formulario.data_inicio) === null) return semDatas;
  const dias: number[] = [];
  for (const periodo of formulario.periodos) {
    const valor = lerInteiro(periodo.dias);
    if (valor === null || valor < 1) break;
    dias.push(valor);
  }
  const calendario = calcularCalendario(
    formulario.data_inicio,
    dias.map((valor) => ({ dias: valor })),
  );
  const completo =
    dias.length === formulario.periodos.length && dias.length > 0;
  return {
    periodos: formulario.periodos.map(
      (_periodo, indice) => calendario.periodos[indice] ?? null,
    ),
    data_fim: completo ? calendario.data_fim : null,
    total_dias: completo ? calendario.total_dias : null,
  };
}

/** Percentuais em pontos-base; null se algum ainda não é um percentual válido. */
export function percentuaisDoFormulario(
  formulario: Formulario,
): number[] | null {
  const percentuais = formulario.periodos.map((periodo) =>
    lerPercentual(periodo.percentual),
  );
  return percentuais.every((valor) => valor !== null)
    ? (percentuais as number[])
    : null;
}

/** Se o texto parece um link, a última parte do caminho (onde fica o slug); senão null. */
export function slugDoLink(texto: string): string | null {
  const limpo = texto.trim();
  if (!limpo.includes("/")) return null;
  const caminho = limpo.split(/[?#]/)[0] ?? "";
  const ultima = caminho.split("/").filter(Boolean).at(-1);
  if (!ultima || ultima.includes(".") || ultima.endsWith(":")) return null;
  return ultima;
}

// ---------------------------------------------------------------------------------------------------
// Montagem do corpo e erros por campo
// ---------------------------------------------------------------------------------------------------

export type ResultadoMontagem =
  { ok: true; corpo: CorpoCampanha } | { ok: false; erros: ErrosFormulario };

const MENSAGEM_REAIS = "Use só números, com até 2 casas decimais. Ex.: 20,00.";

/** Lê o formulário e valida com o contrato. Erros de leitura (ex.: "abc" no preço) vêm primeiro. */
export function montarCorpo(
  formulario: Formulario,
  {
    regrasDoAdmin,
  }: {
    /**
     * Manda os grupos `pedidos`, `acesso` e `mensagens` (só o admin muda, RIFA-042). Sem eles, a API mantém o
     * gravado; e um modelo gravado com problema não barra o salvamento do resto.
     */
    regrasDoAdmin: boolean;
  },
): ResultadoMontagem {
  const errosDeLeitura: ErrosFormulario = {};
  function ler<T>(
    chave: string,
    texto: string,
    leitor: (texto: string) => T | null,
    mensagemVazio: string,
    mensagemInvalido: string,
  ): T | undefined {
    if (texto.trim() === "") {
      errosDeLeitura[chave] = mensagemVazio;
      return undefined;
    }
    const valor = leitor(texto);
    if (valor === null) {
      errosDeLeitura[chave] = mensagemInvalido;
      return undefined;
    }
    return valor;
  }

  const metaEmReais = formulario.meta_unidade === "centavos";
  const corpo = {
    nome: formulario.nome,
    slug_rifei: formulario.slug_rifei,
    fuso_horario: formulario.fuso_horario.trim() || undefined,
    data_inicio: formulario.data_inicio,
    preco_bilhete_centavos: ler(
      "preco_bilhete_centavos",
      formulario.preco,
      lerReais,
      "Informe o preço do bilhete.",
      MENSAGEM_REAIS,
    ),
    meta: {
      unidade: formulario.meta_unidade,
      regra: formulario.meta_regra,
      valor: ler(
        "meta.valor",
        formulario.meta_valor,
        metaEmReais ? lerReais : lerInteiro,
        "Informe a meta.",
        metaEmReais ? MENSAGEM_REAIS : "Use um número inteiro de bilhetes.",
      ),
    },
    periodos: formulario.periodos.map((periodo, indice) => ({
      nome: periodo.nome,
      dias: ler(
        `periodos.${indice}.dias`,
        periodo.dias,
        lerInteiro,
        "Informe quantos dias o período dura.",
        "Use um número inteiro de 1 a 366.",
      ),
      percentual_bp: ler(
        `periodos.${indice}.percentual_bp`,
        periodo.percentual,
        lerPercentual,
        "Informe o percentual do período.",
        "Use um percentual de 0 a 100, com até 2 casas decimais. Ex.: 35 ou 12,5.",
      ),
    })),
    // RIFA-061: a opção vai sempre (é do grupo ranking, que a coordenação também muda, como o critério).
    ranking: {
      criterio: formulario.ranking_criterio,
      por_divisao: formulario.ranking_por_divisao,
    },
    publico: {
      mostra_percentual_meta: formulario.publico_mostra_percentual_meta,
      limite_ranking:
        formulario.publico_limite_ranking.trim() === ""
          ? null
          : (lerInteiro(formulario.publico_limite_ranking) ?? -1),
    },
    // RIFA-075 (D35): os números da rifa vão sempre (a coordenação também muda, como o ranking).
    bilhetes: {
      quantidade: ler(
        "bilhetes.quantidade",
        formulario.bilhetes_quantidade,
        lerInteiro,
        "Informe quantos números a rifa tem.",
        "Use um número inteiro de 1 a 1.000.000.",
      ),
      numero_inicial:
        formulario.bilhetes_numero_inicial === ""
          ? null
          : Number(formulario.bilhetes_numero_inicial),
    },
    // Os três grupos vão sempre que é o admin (D20: o grupo presente substitui o gravado); da coordenação, nunca
    // (RIFA-042: grupo ausente mantém o gravado).
    ...(regrasDoAdmin && {
      pedidos: { desconsiderar: formulario.pedidos_desconsiderar },
      acesso: {
        discipuladores: formulario.acesso_discipuladores,
        redes: formulario.acesso_redes,
        celulas_senha: formulario.acesso_celulas_senha,
      },
      mensagens: { ...formulario.mensagens },
    }),
  };

  const validacao = corpoSalvarCampanhaSchema.safeParse(corpo);
  const erros = {
    ...(validacao.success
      ? {}
      : errosDosDetalhes(detalhesDeValidacao(validacao.error))),
    ...errosDeLeitura,
  };
  if (!validacao.success || Object.keys(erros).length > 0) {
    return { ok: false, erros };
  }
  return { ok: true, corpo: validacao.data };
}

/** Problemas genéricos do zod, cuja mensagem vem em inglês: trocadas pela mensagem do campo. */
const CODIGOS_GENERICOS = new Set([
  "invalid_type",
  "invalid_value",
  "invalid_format",
  "invalid_union",
  "too_small",
  "too_big",
  "not_multiple_of",
  "unrecognized_keys",
]);

/** Mensagem de cada campo do contrato ("*" = qualquer período). */
const MENSAGEM_DO_CAMPO: Record<string, string> = {
  nome: "Informe o nome da campanha, com até 120 caracteres.",
  slug_rifei: "Informe o slug da campanha na Rifei, com até 200 caracteres.",
  fuso_horario: "Use um fuso horário válido, como America/Belem.",
  data_inicio: "Informe uma data de início válida.",
  preco_bilhete_centavos: "O preço do bilhete precisa ser maior que zero.",
  "meta.unidade": "Escolha a unidade da meta.",
  "meta.regra": "Escolha a regra da meta.",
  "meta.valor": "A meta precisa ser maior que zero.",
  periodos: `A campanha precisa de 1 a ${LIMITE_PERIODOS} períodos.`,
  "periodos.*.nome": "Dê um nome ao período, com até 60 caracteres.",
  "periodos.*.dias": "Use um número inteiro de 1 a 366.",
  "periodos.*.percentual_bp": "Use um percentual de 0 a 100.",
  "ranking.criterio": "Escolha o critério do ranking.",
  "ranking.por_divisao": "Marque ou desmarque esta opção.",
  "bilhetes.quantidade": "Use um número inteiro de 1 a 1.000.000.",
  "bilhetes.numero_inicial": "Escolha 0, 1 ou automático.",
  "publico.mostra_percentual_meta": "Marque ou desmarque esta opção.",
  "publico.limite_ranking":
    "Use um número inteiro de 1 a 100, ou deixe em branco para mostrar todas.",
  "pedidos.desconsiderar": "Marque ou desmarque esta opção.",
  "acesso.discipuladores": "Marque ou desmarque esta opção.",
  "acesso.redes": "Marque ou desmarque esta opção.",
  "acesso.celulas_senha": "Marque ou desmarque esta opção.",
  ...Object.fromEntries(
    TIPOS_MENSAGEM.map((tipo) => [
      `mensagens.${tipo}`,
      `Escreva a mensagem, com até ${formatarNumero(LIMITE_CARACTERES_MENSAGEM)} caracteres.`,
    ]),
  ),
};

/**
 * Converte os `detalhes` da validação (da API ou do contrato rodando aqui) em erros por campo, em
 * português. Um problema por campo (o primeiro). Mensagens próprias do contrato e da API (ex.:
 * "Pelo menos um período precisa ter percentual maior que zero") já vêm em português e ficam.
 */
export function errosDosDetalhes(
  detalhes: readonly DetalheValidacao[],
): ErrosFormulario {
  const erros: ErrosFormulario = {};
  for (const { caminho, codigo, mensagem } of detalhes) {
    const chave = caminho.join(".");
    if (chave in erros) continue;
    const modelo = caminho
      .map((parte) => (typeof parte === "number" ? "*" : parte))
      .join(".");
    erros[chave] = CODIGOS_GENERICOS.has(codigo)
      ? (MENSAGEM_DO_CAMPO[modelo] ?? mensagem)
      : mensagem;
  }
  return erros;
}

/** `detalhes` de um erro da API, se tiverem o formato de validação. */
export function detalhesDoErro(detalhes: unknown): DetalheValidacao[] {
  if (!Array.isArray(detalhes)) return [];
  return detalhes.filter(
    (item): item is DetalheValidacao =>
      typeof item === "object" &&
      item !== null &&
      Array.isArray(item.caminho) &&
      typeof item.codigo === "string" &&
      typeof item.mensagem === "string",
  );
}

/** O nome de cada mensagem do link pessoal (o rótulo do campo na tela). */
export const ROTULO_MENSAGEM: Record<TipoMensagem, string> = {
  link_coordenacao: "Mensagem do link da coordenação",
  link_lider: "Mensagem do link do líder de célula",
  link_discipulador: "Mensagem do link do discipulador",
  link_rede: "Mensagem do link da rede",
};

const ROTULO_DO_CAMPO: Record<string, string> = {
  nome: "Nome da campanha",
  slug_rifei: "Slug da campanha na Rifei",
  fuso_horario: "Fuso horário",
  data_inicio: "Data de início",
  preco_bilhete_centavos: "Preço do bilhete",
  "meta.unidade": "Unidade da meta",
  "meta.regra": "Regra da meta",
  "meta.valor": "Valor da meta",
  periodos: "Períodos",
  "ranking.criterio": "Critério do ranking",
  "ranking.por_divisao": "Separar o ranking por divisão",
  "bilhetes.quantidade": "Quantidade de números da rifa",
  "bilhetes.numero_inicial": "Número inicial da rifa",
  "publico.mostra_percentual_meta": "Percentual da meta no ranking público",
  "publico.limite_ranking": "Posições no ranking público",
  "pedidos.desconsiderar": "Permitir desconsiderar pedidos",
  "acesso.discipuladores": "Acesso dos discipuladores",
  "acesso.redes": "Acesso das redes",
  "acesso.celulas_senha": "Login das células com senha padrão",
  ...Object.fromEntries(
    TIPOS_MENSAGEM.map((tipo) => [`mensagens.${tipo}`, ROTULO_MENSAGEM[tipo]]),
  ),
};

const ROTULO_DO_PERIODO: Record<string, string> = {
  nome: "Nome",
  dias: "Dias",
  percentual_bp: "Percentual",
};

/** Ordem dos campos na tela, para a lista de erros seguir a mesma ordem. */
const ORDEM_DOS_CAMPOS = [
  "nome",
  "slug_rifei",
  "data_inicio",
  "fuso_horario",
  "periodos",
  "preco_bilhete_centavos",
  "meta.unidade",
  "meta.regra",
  "meta.valor",
  "bilhetes.quantidade",
  "bilhetes.numero_inicial",
  "ranking.criterio",
  "ranking.por_divisao",
  "publico.mostra_percentual_meta",
  "publico.limite_ranking",
  "pedidos.desconsiderar",
  "acesso.discipuladores",
  "acesso.redes",
  "acesso.celulas_senha",
  ...TIPOS_MENSAGEM.map((tipo) => `mensagens.${tipo}`),
];
const ORDEM_NO_PERIODO = ["nome", "dias", "percentual_bp"];

export function ordenarChavesDeErro(chaves: readonly string[]): string[] {
  const posicao = (chave: string): [number, number, number] => {
    const periodo = /^periodos\.(\d+)\.(\w+)$/.exec(chave);
    if (periodo) {
      return [
        ORDEM_DOS_CAMPOS.indexOf("periodos"),
        Number(periodo[1]) + 1,
        ORDEM_NO_PERIODO.indexOf(periodo[2]),
      ];
    }
    const indice = ORDEM_DOS_CAMPOS.indexOf(chave);
    return [indice === -1 ? ORDEM_DOS_CAMPOS.length : indice, 0, 0];
  };
  return [...chaves].sort((a, b) => {
    const [pa, pb] = [posicao(a), posicao(b)];
    return pa[0] - pb[0] || pa[1] - pb[1] || pa[2] - pb[2];
  });
}

/** Nome do campo para a lista de erros: "Dias do período 2". */
export function rotuloDoCampo(chave: string): string {
  const periodo = /^periodos\.(\d+)\.(nome|dias|percentual_bp)$/.exec(chave);
  if (periodo) {
    return `${ROTULO_DO_PERIODO[periodo[2]]} do período ${Number(periodo[1]) + 1}`;
  }
  return ROTULO_DO_CAMPO[chave] ?? chave;
}
