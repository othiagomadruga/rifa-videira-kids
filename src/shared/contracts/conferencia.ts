/**
 * Contrato da conferência pelo CSV da Rifei (RIFA-012) que vale no navegador e no Worker: constantes, o
 * corpo COMPACTO das rotas POST /api/admin/reconciliacao/analisar e .../recuperar e o validador dele. Sem
 * zod (o site importa daqui sem levar o zod para o pacote); os schemas das respostas estão em ./api.
 *
 * O navegador lê o CSV, reconhece e mapeia as colunas (src/shared/conferencia) e manda à API SÓ as colunas
 * mapeadas que não são de dado pessoal, já normalizadas: uma lista por campo, uma posição por grupo de
 * linhas iguais do arquivo (`vezes` diz quantas). Nome, e-mail, telefone e as demais colunas pessoais
 * nunca saem do navegador (D1), nem os números dos bilhetes (só a contagem deles).
 *
 * O validador é leve de propósito (laços simples, sem zod item a item): a CPU do Worker conta (a conferência
 * exige o Workers Paid; os números medidos estão na D19, docs/decisions.md).
 */
import { diaDoCalendario } from "./calendario";

// ---------------------------------------------------------------------------------------------------
// Limites
// ---------------------------------------------------------------------------------------------------

/** Máximo de caracteres do arquivo lido no navegador: cerca de 5 MB. */
export const LIMITE_CARACTERES_CSV_RECONCILIACAO = 5_000_000;
/**
 * Máximo de linhas de dados do arquivo (sem o cabeçalho e as linhas em branco). O navegador para de ler
 * logo depois do limite (não lê milhões de linhas só para recusar).
 */
export const LIMITE_LINHAS_CSV_RECONCILIACAO = 50_000;
/** Colunas lidas do cabeçalho; as que passarem disso são ignoradas (aviso `colunas_demais`). */
export const LIMITE_COLUNAS_CSV_RECONCILIACAO = 200;
/**
 * Teto do corpo das duas rotas, conferido pela própria rota (src/worker/routes/reconciliacao.ts), que lê o
 * corpo uma vez só: estas rotas ficam FORA do teto geral das escritas da coordenação
 * (src/worker/middleware/limite-corpo.ts), com o mesmo número (1 MiB). Acima dele, 413
 * `corpo_muito_grande` sem ler o resto. O corpo compacto tem uns 60 bytes por pedido: 7 mil pedidos dão
 * uns 430 KB. O navegador confere o tamanho antes de enviar e explica o que fazer (exportar um período
 * menor).
 */
export const LIMITE_CORPO_CONFERENCIA_BYTES = 1024 * 1024;
/** Pedidos por chamada de "Recuperar". */
export const LIMITE_PEDIDOS_RECUPERAR = 500;
/** Itens listados por tipo de divergência; a contagem e as somas do tipo contam todos. */
export const LIMITE_ITENS_POR_DIVERGENCIA = 500;
/** Problemas listados quando o corpo não passa na validação (o resto é só contado). */
export const LIMITE_PROBLEMAS_DO_CORPO = 20;
/**
 * Trava do código (aviso `codigo_nao_confere`): com pelo menos este número de pedidos pagos no arquivo e
 * menos de PROPORCAO_MINIMA_CODIGOS_ENCONTRADOS deles no sistema, a coluna escolhida como código
 * provavelmente não é o código da Rifei, e nada pode ser recuperado até trocá-la.
 */
export const MINIMO_CODIGOS_PARA_CONFERIR = 5;
export const PROPORCAO_MINIMA_CODIGOS_ENCONTRADOS = 0.5;

// ---------------------------------------------------------------------------------------------------
// Listas do contrato
// ---------------------------------------------------------------------------------------------------

/**
 * Campos que a conferência lê do arquivo (todos opcionais):
 * - pedido_id: código do pedido na Rifei (o `id` do webhook). Com ele, a comparação é pedido a pedido;
 *   sem ele, pelos totais (por afiliado e por dia);
 * - status: situação do pedido; sem a coluna, todos os pedidos contam como pagos (aviso);
 * - qtd_bilhetes e bilhetes: a quantidade e os números dos bilhetes (só contados);
 * - valor: valor pago, em centavos;
 * - afiliado: o `affiliate_id` ou o usuário do afiliado na Rifei (comparado com o rótulo cadastrado);
 * - data: dia (e, quando o arquivo tem, o instante) do pagamento, no fuso da campanha.
 */
export const CAMPOS_RECONCILIACAO = [
  "pedido_id",
  "status",
  "qtd_bilhetes",
  "bilhetes",
  "valor",
  "afiliado",
  "data",
] as const;
export type CampoReconciliacao = (typeof CAMPOS_RECONCILIACAO)[number];

/** Coluna do arquivo para cada campo (índice na lista de colunas), ou null quando o campo não tem coluna. */
export type MapeamentoReconciliacao = Record<CampoReconciliacao, number | null>;

/** Uma coluna do cabeçalho, como o navegador a reconheceu. */
export interface ColunaArquivoReconciliacao {
  /** Posição no cabeçalho, a partir de 0. */
  indice: number;
  /** Nome resumido (espaços juntados; vazio vira "Coluna N"). */
  nome: string;
  /** O campo que o nome indica (null = nenhum). */
  campo_detectado: CampoReconciliacao | null;
  /** Coluna de dado pessoal (nome, e-mail, telefone...): nunca é lida nem pode ser mapeada. */
  dado_pessoal: boolean;
}

/**
 * Código do pedido como o arquivo traz: começa com letra ou número e só tem letras, números e . _ : / # -.
 * Assim nunca é uma fórmula de planilha (=, +, - ou @ no início), um e-mail ou um telefone com +.
 */
export const FORMATO_ID_PEDIDO_RECONCILIACAO =
  /^[A-Za-z0-9][A-Za-z0-9._:/#-]{0,127}$/;

/** Status do pedido no arquivo, normalizado ("Pago" e "approved" são `aprovado`). */
export const STATUS_ARQUIVO_RECONCILIACAO = [
  "aprovado",
  "pendente",
  "expirado",
  "cancelado",
  "desconhecido",
] as const;
export type StatusArquivoReconciliacao =
  (typeof STATUS_ARQUIVO_RECONCILIACAO)[number];

/**
 * Afiliado do pedido no arquivo: sem a coluna; vazio (venda sem afiliado); reconhecido (número, ou
 * usuário igual ao rótulo de um afiliado cadastrado); ou não reconhecido (o valor não sai na resposta).
 */
export const SITUACOES_AFILIADO_ARQUIVO = [
  "sem_coluna",
  "vazio",
  "reconhecido",
  "nao_reconhecido",
] as const;
export type SituacaoAfiliadoArquivo =
  (typeof SITUACOES_AFILIADO_ARQUIVO)[number];

/** Como o pedido entrou no sistema: pelo webhook ou recuperado na conferência (migração 0004). */
export const ORIGENS_PEDIDO = ["webhook", "conferencia"] as const;
export type OrigemPedido = (typeof ORIGENS_PEDIDO)[number];

/**
 * Tipos de divergência do modo por pedido, na ordem em que a resposta os traz:
 * - venda_perdida: pago na Rifei e ausente no sistema (não conta no painel nem no ranking): "Recuperar";
 * - pagamento_nao_registrado: pago na Rifei, e no sistema pendente ou expirado;
 * - nao_pago_na_rifei: pago no sistema, e na Rifei pendente, expirado ou cancelado (ex.: estorno);
 * - ausente_no_arquivo: pago no sistema e ausente no arquivo (arquivo parcial ou compra de teste);
 * - valor_diferente, quantidade_diferente e afiliado_diferente: pago nos dois lados, com diferença.
 */
export const TIPOS_DIVERGENCIA = [
  "venda_perdida",
  "pagamento_nao_registrado",
  "nao_pago_na_rifei",
  "ausente_no_arquivo",
  "valor_diferente",
  "quantidade_diferente",
  "afiliado_diferente",
] as const;
export type TipoDivergencia = (typeof TIPOS_DIVERGENCIA)[number];

/**
 * Observações de um item: na venda perdida, o que impede a recuperação (sem quantidade, sem valor, valor
 * ambíguo de um pedido em várias linhas, data no futuro, código que não confere com o sistema); na
 * ausente no arquivo, o pedido é de um dia que o arquivo não cobre.
 */
export const OBSERVACOES_DIVERGENCIA = [
  "sem_quantidade",
  "sem_valor",
  "valor_ambiguo",
  "data_no_futuro",
  "codigo_nao_confere",
  "fora_do_periodo_do_arquivo",
] as const;
export type ObservacaoDivergencia = (typeof OBSERVACOES_DIVERGENCIA)[number];

/**
 * Avisos (mensagens sem nenhum valor do arquivo: só números, nomes de coluna e o preço da campanha), na
 * ordem em que a tela os mostra. O navegador monta os da leitura (colunas, células ilegíveis); a API, os
 * da comparação.
 */
export const CODIGOS_AVISO_RECONCILIACAO = [
  "codigo_nao_confere",
  "sem_coluna_pedido",
  "sem_coluna_status",
  "sem_coluna_quantidade",
  "sem_coluna_valor",
  "sem_coluna_afiliado",
  "sem_coluna_data",
  "colunas_pessoais_ignoradas",
  "colunas_demais",
  "sem_id",
  "id_invalido",
  "status_desconhecido",
  "quantidade_invalida",
  "quantidade_diferente_dos_numeros",
  "valor_invalido",
  "data_invalida",
  "afiliado_nao_reconhecido",
  "formula_ignorada",
  "pedido_inconsistente",
  "um_bilhete_por_linha",
  "valor_por_bilhete",
  "valor_do_pedido_repetido",
  "valor_ambiguo",
  "um_bilhete_por_linha_sem_id",
  "sem_contagem_de_pedidos",
  "pedido_de_outra_campanha",
  "sem_aprovados",
] as const;
export type CodigoAvisoReconciliacao =
  (typeof CODIGOS_AVISO_RECONCILIACAO)[number];

export interface AvisoReconciliacao {
  codigo: CodigoAvisoReconciliacao;
  mensagem: string;
  /** Quantas linhas, pedidos ou colunas o aviso cobre; null quando vale para o arquivo inteiro. */
  quantidade: number | null;
}

export const AFILIADOS_AGREGADO = [
  "afiliado",
  "sem_afiliado",
  "nao_reconhecido",
] as const;

/** De onde veio o instante gravado em `aprovado_em` de um pedido recuperado. */
export const ORIGENS_DATA_RECUPERADA = [
  "arquivo",
  "dia_do_arquivo",
  "recuperacao",
] as const;

export const MOTIVOS_NAO_RECUPERADO = [
  "ja_existe",
  "nao_esta_no_arquivo",
  "nao_aprovado_no_arquivo",
  "inconsistente_no_arquivo",
  "sem_quantidade",
  "sem_valor",
  "valor_ambiguo",
  "data_no_futuro",
] as const;
export type MotivoNaoRecuperado = (typeof MOTIVOS_NAO_RECUPERADO)[number];

// ---------------------------------------------------------------------------------------------------
// Corpo compacto
// ---------------------------------------------------------------------------------------------------

/** Nome da coluna do arquivo usada em cada campo (null = o arquivo não tem a coluna ou ela não foi usada). */
export type ColunasDoCorpo = Record<CampoReconciliacao, string | null>;

/**
 * Afiliado de uma linha: o `affiliate_id` (número), o usuário do afiliado na Rifei já normalizado (sem
 * acento, minúsculo, sem @), `null` (célula vazia: venda sem afiliado) ou `false` (ilegível).
 */
export type AfiliadoDoCorpo = number | string | false | null;

/**
 * Corpo de POST /api/admin/reconciliacao/analisar. Linhas do arquivo com os mesmos valores nas colunas
 * mapeadas viram uma posição só (no "Um bilhete por linha", as linhas de um pedido costumam ser iguais),
 * e `vezes` diz quantas linhas cada posição representa. Cada lista tem uma posição por grupo, na ordem da
 * primeira linha; `null` é célula vazia ou ilegível. Um campo sem coluna fica fora do corpo (e com
 * `colunas[campo]` null). `dia` e `instante` andam juntos (o campo `data`).
 */
export interface CorpoConferencia {
  colunas: ColunasDoCorpo;
  /** Linhas de dados do arquivo: a soma de `vezes`. */
  linhas: number;
  /** SHA-256 (hex minúsculo) do texto do arquivo: identifica o arquivo na auditoria, sem o conteúdo. */
  arquivo_sha256: string;
  /** Quantas linhas iguais do arquivo cada posição representa (1 ou mais). */
  vezes: number[];
  pedido_id?: (string | null)[];
  status?: (StatusArquivoReconciliacao | null)[];
  qtd_bilhetes?: (number | null)[];
  /** Quantos números de bilhete a célula da coluna `bilhetes` traz (os números não saem do navegador). */
  numeros?: (number | null)[];
  /** Centavos. */
  valor?: (number | null)[];
  afiliado?: AfiliadoDoCorpo[];
  /** Dia do pagamento ("YYYY-MM-DD") no fuso da campanha. */
  dia?: (string | null)[];
  /** O instante (ms desde 1970, UTC) quando o arquivo tem a hora; null quando tem só o dia. */
  instante?: (number | null)[];
}

/** Corpo de POST /api/admin/reconciliacao/recuperar: o mesmo, mais os códigos escolhidos. */
export interface CorpoRecuperacao extends CorpoConferencia {
  pedidos: string[];
  /** true: só a prévia, nada é gravado. */
  simular: boolean;
}

/** Um problema do corpo: caminho (campo e posição), código e mensagem; nunca o valor recebido. */
export interface ProblemaDoCorpo {
  caminho: (string | number)[];
  codigo: string;
  mensagem: string;
}

export type ValidacaoDoCorpo<T> =
  | { ok: true; corpo: T }
  | { ok: false; problemas: ProblemaDoCorpo[]; total: number };

const STATUS_DO_ARQUIVO = new Set<string>(STATUS_ARQUIVO_RECONCILIACAO);
const FORMATO_DIA = /^\d{4}-(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])$/;
/**
 * Dias que já passaram por diaDoCalendario. O mesmo dia se repete em milhares de posições, e cada chamada
 * cria um Date: 7 mil chamadas custavam de 3 a 8 ms de CPU no Worker. Só entram dias que existem, até
 * LIMITE_DIAS_CONFERIDOS (aí recomeça), então a memória fica pequena.
 */
const DIAS_QUE_EXISTEM = new Set<string>();
const LIMITE_DIAS_CONFERIDOS = 1000;

/** O dia ("AAAA-MM-DD", já no formato) existe no calendário? */
function diaExiste(dia: string): boolean {
  if (DIAS_QUE_EXISTEM.has(dia)) return true;
  if (diaDoCalendario(dia) === null) return false;
  if (DIAS_QUE_EXISTEM.size >= LIMITE_DIAS_CONFERIDOS) DIAS_QUE_EXISTEM.clear();
  DIAS_QUE_EXISTEM.add(dia);
  return true;
}
const FORMATO_SHA256 = /^[0-9a-f]{64}$/;
/** De 2000-01-01 a 2100-01-01 (UTC), em ms. */
const INSTANTE_MINIMO = 946_684_800_000;
const INSTANTE_MAXIMO = 4_102_444_800_000;
/** Os mesmos tetos da leitura das células no navegador (src/shared/conferencia/valores.ts). */
export const MAXIMO_CENTAVOS_RECONCILIACAO = 1_000_000_000;
export const MAXIMO_BILHETES_RECONCILIACAO = 1_000_000;
/** Tamanho máximo do nome de uma coluna no corpo e do usuário do afiliado. */
const MAXIMO_NOME_COLUNA = 120;
const MAXIMO_USUARIO_AFILIADO = 120;

const ehInteiro = (valor: unknown, minimo: number, maximo: number) =>
  typeof valor === "number" &&
  Number.isInteger(valor) &&
  valor >= minimo &&
  valor <= maximo;

const ehObjeto = (valor: unknown): valor is Record<string, unknown> =>
  typeof valor === "object" && valor !== null && !Array.isArray(valor);

type ChaveDeLista = Exclude<
  keyof CorpoConferencia,
  "colunas" | "linhas" | "arquivo_sha256" | "vezes"
>;

/** Uma lista do corpo: o campo (a coluna) dela, a regra de cada posição (null sempre vale) e a mensagem. */
const LISTAS: Record<
  ChaveDeLista,
  {
    campo: CampoReconciliacao;
    vale: (item: unknown) => boolean;
    mensagem: string;
  }
> = {
  pedido_id: {
    campo: "pedido_id",
    vale: (item) =>
      typeof item === "string" && FORMATO_ID_PEDIDO_RECONCILIACAO.test(item),
    mensagem: "Código de pedido inválido",
  },
  status: {
    campo: "status",
    vale: (item) => typeof item === "string" && STATUS_DO_ARQUIVO.has(item),
    mensagem: "Status inválido",
  },
  qtd_bilhetes: {
    campo: "qtd_bilhetes",
    vale: (item) => ehInteiro(item, 0, MAXIMO_BILHETES_RECONCILIACAO),
    mensagem: "Use um número inteiro de 0 a 1.000.000",
  },
  numeros: {
    campo: "bilhetes",
    vale: (item) => ehInteiro(item, 0, MAXIMO_BILHETES_RECONCILIACAO),
    mensagem: "Use quantos números de bilhete a célula tem",
  },
  valor: {
    campo: "valor",
    vale: (item) => ehInteiro(item, 0, MAXIMO_CENTAVOS_RECONCILIACAO),
    mensagem: "Use centavos inteiros, até R$ 10.000.000,00",
  },
  afiliado: {
    campo: "afiliado",
    vale: (item) =>
      item === false ||
      ehInteiro(item, 1, Number.MAX_SAFE_INTEGER) ||
      (typeof item === "string" &&
        item.length >= 1 &&
        item.length <= MAXIMO_USUARIO_AFILIADO),
    mensagem:
      "Use o número do afiliado, o usuário (até 120 caracteres) ou false",
  },
  dia: {
    campo: "data",
    // O formato e o dia de verdade ("2026-02-31" não existe: sem isto, a conta do dia no fuso dava 500).
    vale: (item) =>
      typeof item === "string" && FORMATO_DIA.test(item) && diaExiste(item),
    mensagem: "Use uma data que existe, no formato AAAA-MM-DD",
  },
  instante: {
    campo: "data",
    vale: (item) => ehInteiro(item, INSTANTE_MINIMO, INSTANTE_MAXIMO),
    mensagem: "Use o instante em milissegundos",
  },
};

const CHAVES_DE_LISTA = Object.keys(LISTAS) as ChaveDeLista[];

/** Chaves aceitas no corpo da análise; o do "Recuperar" aceita também `pedidos` e `simular`. */
const CHAVES_DO_CORPO = new Set<string>([
  "colunas",
  "linhas",
  "arquivo_sha256",
  "vezes",
  ...CHAVES_DE_LISTA,
]);
const CHAVES_DA_RECUPERACAO = new Set<string>([
  ...CHAVES_DO_CORPO,
  "pedidos",
  "simular",
]);

/**
 * Confere o corpo compacto: forma, `vezes` (somando `linhas`), o tamanho de cada lista (uma posição por
 * grupo) e o tipo de cada posição, sem guardar nem devolver valores. Depois de LIMITE_PROBLEMAS_DO_CORPO
 * problemas, só conta.
 */
export function validarCorpoConferencia(
  valor: unknown,
  chavesAceitas: ReadonlySet<string> = CHAVES_DO_CORPO,
): ValidacaoDoCorpo<CorpoConferencia> {
  const problemas: ProblemaDoCorpo[] = [];
  let total = 0;
  const problema = (
    caminho: (string | number)[],
    codigo: string,
    mensagem: string,
  ) => {
    total++;
    if (problemas.length < LIMITE_PROBLEMAS_DO_CORPO)
      problemas.push({ caminho, codigo, mensagem });
  };

  if (!ehObjeto(valor)) {
    problema([], "invalid_type", "Envie um objeto JSON");
    return { ok: false, problemas, total };
  }
  for (const chave of Object.keys(valor))
    if (!chavesAceitas.has(chave))
      problema([chave], "unrecognized_keys", "Campo desconhecido");

  const linhas = valor.linhas;
  if (!ehInteiro(linhas, 0, LIMITE_LINHAS_CSV_RECONCILIACAO))
    problema(
      ["linhas"],
      "too_big",
      `Use um número inteiro de 0 a ${LIMITE_LINHAS_CSV_RECONCILIACAO}`,
    );
  if (
    typeof valor.arquivo_sha256 !== "string" ||
    !FORMATO_SHA256.test(valor.arquivo_sha256)
  )
    problema(["arquivo_sha256"], "invalid_format", "Use o SHA-256 em hex");

  const vezes = valor.vezes;
  let posicoes = -1;
  if (!Array.isArray(vezes) || vezes.length > LIMITE_LINHAS_CSV_RECONCILIACAO)
    problema(
      ["vezes"],
      "invalid_type",
      "Envie quantas linhas cada posição representa",
    );
  else {
    posicoes = vezes.length;
    let soma = 0;
    for (let indice = 0; indice < vezes.length; indice++) {
      const item: unknown = vezes[indice];
      if (ehInteiro(item, 1, LIMITE_LINHAS_CSV_RECONCILIACAO))
        soma += item as number;
      else
        problema(
          ["vezes", indice],
          "invalid_value",
          "Use um inteiro de 1 em diante",
        );
    }
    if (typeof linhas === "number" && soma !== linhas)
      problema(
        ["vezes"],
        "custom",
        "A soma de vezes precisa ser igual a linhas",
      );
  }

  const colunas = valor.colunas;
  if (!ehObjeto(colunas)) {
    problema(
      ["colunas"],
      "invalid_type",
      "Envie o nome da coluna de cada campo",
    );
    return { ok: false, problemas, total };
  }
  for (const campo of CAMPOS_RECONCILIACAO) {
    const nome = colunas[campo];
    if (
      nome !== null &&
      (typeof nome !== "string" ||
        nome === "" ||
        nome.length > MAXIMO_NOME_COLUNA)
    )
      problema(
        ["colunas", campo],
        "invalid_type",
        "Use o nome da coluna (até 120 caracteres) ou null",
      );
  }
  for (const chave of Object.keys(colunas))
    if (!(CAMPOS_RECONCILIACAO as readonly string[]).includes(chave))
      problema(["colunas", chave], "unrecognized_keys", "Campo desconhecido");

  for (const chave of CHAVES_DE_LISTA) {
    const regra = LISTAS[chave];
    const lista = valor[chave];
    if (typeof colunas[regra.campo] !== "string") {
      if (lista !== undefined)
        problema([chave], "unrecognized_keys", "Lista de um campo sem coluna");
      continue;
    }
    if (!Array.isArray(lista) || lista.length !== posicoes) {
      problema([chave], "invalid_type", "Envie uma posição por item de vezes");
      continue;
    }
    for (let indice = 0; indice < lista.length; indice++) {
      const item: unknown = lista[indice];
      if (item !== null && !regra.vale(item))
        problema([chave, indice], "invalid_value", regra.mensagem);
    }
  }
  const { dia, instante } = valor;
  if (Array.isArray(instante) && Array.isArray(dia))
    for (let indice = 0; indice < instante.length; indice++)
      if (instante[indice] !== null && dia[indice] === null)
        problema(["dia", indice], "invalid_value", "Instante sem o dia");

  return total === 0
    ? { ok: true, corpo: valor as unknown as CorpoConferencia }
    : { ok: false, problemas, total };
}

/** O corpo do "Recuperar": o da análise, com a coluna do código, mais `pedidos` (1 a 500) e `simular`. */
export function validarCorpoRecuperacao(
  valor: unknown,
): ValidacaoDoCorpo<CorpoRecuperacao> {
  const base = validarCorpoConferencia(valor, CHAVES_DA_RECUPERACAO);
  const problemas = base.ok ? [] : [...base.problemas];
  let total = base.ok ? 0 : base.total;
  const problema = (
    caminho: (string | number)[],
    codigo: string,
    mensagem: string,
  ) => {
    total++;
    if (problemas.length < LIMITE_PROBLEMAS_DO_CORPO)
      problemas.push({ caminho, codigo, mensagem });
  };
  if (ehObjeto(valor)) {
    if (base.ok && base.corpo.colunas.pedido_id === null)
      problema(
        ["colunas", "pedido_id"],
        "custom",
        "Para recuperar, o arquivo precisa da coluna do código do pedido",
      );
    const pedidos = valor.pedidos;
    if (
      !Array.isArray(pedidos) ||
      pedidos.length < 1 ||
      pedidos.length > LIMITE_PEDIDOS_RECUPERAR
    )
      problema(
        ["pedidos"],
        "invalid_type",
        `Escolha de 1 a ${LIMITE_PEDIDOS_RECUPERAR} pedidos`,
      );
    else
      pedidos.forEach((codigo: unknown, indice) => {
        if (
          typeof codigo !== "string" ||
          !FORMATO_ID_PEDIDO_RECONCILIACAO.test(codigo)
        )
          problema(
            ["pedidos", indice],
            "invalid_value",
            "Código de pedido inválido",
          );
      });
    if (valor.simular !== undefined && typeof valor.simular !== "boolean")
      problema(["simular"], "invalid_type", "Use true ou false");
  }
  if (total > 0) return { ok: false, problemas, total };
  const corpo = valor as unknown as CorpoRecuperacao;
  return { ok: true, corpo: { ...corpo, simular: corpo.simular ?? false } };
}
