/**
 * Leitura do CSV "Exportar Pedidos" da Rifei NO NAVEGADOR (RIFA-012; docs/integracao-rifei.md, seção 10):
 * o arquivo vira a lista de colunas (com o mapeamento detectado) e, com o mapeamento escolhido, o corpo
 * compacto que vai à API (CorpoConferencia, src/shared/contracts/conferencia.ts).
 *
 * Privacidade (D1): o texto do arquivo e os registros ficam só na memória da tela. Do arquivo, sai do
 * navegador apenas o que as colunas MAPEADAS têm, já normalizado (código validado, status, quantidade,
 * contagem dos números, centavos, afiliado, dia e instante), mais os nomes dessas colunas e o SHA-256 do
 * texto. Uma coluna de dado pessoal não pode ser mapeada, e as não mapeadas nem são lidas.
 */
import {
  CAMPOS_RECONCILIACAO,
  LIMITE_CARACTERES_CSV_RECONCILIACAO,
  LIMITE_CORPO_CONFERENCIA_BYTES,
  LIMITE_LINHAS_CSV_RECONCILIACAO,
  type AfiliadoDoCorpo,
  type AvisoReconciliacao,
  type CampoReconciliacao,
  type ColunaArquivoReconciliacao,
  type ColunasDoCorpo,
  type CorpoConferencia,
  type MapeamentoReconciliacao,
  type ProblemaDoCorpo,
  type StatusArquivoReconciliacao,
} from "../contracts/conferencia";
import { lerCsv, type RegistroCsv } from "../csv";
import { Avisos, formatarInteiro } from "./avisos";
import { conferirMapeamento, detectarColunas, pareceDado } from "./colunas";
import {
  INVALIDO,
  VAZIO,
  contarNumeros,
  criarLeitorDeData,
  lerAfiliado,
  lerCentavos,
  lerIdPedido,
  lerQuantidade,
  lerStatus,
  pareceFormula,
} from "./valores";

/** O que o decodificador põe no lugar de bytes que não são UTF-8. */
const CARACTERE_INVALIDO = String.fromCharCode(0xfffd);

export type MotivoFalhaDaLeitura =
  | "arquivo_grande"
  | "vazio"
  | "aspas_abertas"
  | "codificacao_invalida"
  | "sem_cabecalho"
  | "linhas_demais";

export interface FalhaDaLeitura {
  ok: false;
  motivo: MotivoFalhaDaLeitura;
  titulo: string;
  mensagem: string;
}

/** O arquivo lido: as colunas, o mapeamento detectado e os registros (só na memória do navegador). */
export interface ArquivoConferencia {
  ok: true;
  colunas: ColunaArquivoReconciliacao[];
  mapeamentoDetectado: MapeamentoReconciliacao;
  /** Colunas do cabeçalho além do limite (ignoradas). */
  colunasDemais: number;
  /** As linhas de dados, sem o cabeçalho. */
  registros: RegistroCsv[];
}

const falha = (
  motivo: MotivoFalhaDaLeitura,
  titulo: string,
  mensagem: string,
): FalhaDaLeitura => ({ ok: false, motivo, titulo, mensagem });

const LIMITE_MB = LIMITE_CARACTERES_CSV_RECONCILIACAO / 1_000_000;

export const FALHA_ARQUIVO_GRANDE = falha(
  "arquivo_grande",
  "O arquivo é grande demais",
  `O limite é de ${LIMITE_MB} MB. Exporte da Rifei só as colunas da conferência (sem nome, e-mail e telefone) ou um período menor.`,
);

export const FALHA_ARQUIVO_VAZIO = falha(
  "vazio",
  "O arquivo está vazio",
  "Confira se escolheu o arquivo certo: o que a Rifei baixa em “Exportar Pedidos”.",
);

/**
 * Lê o arquivo (o texto já decodificado): falha quando ele passa dos limites, está vazio, tem aspas
 * abertas, não está em UTF-8 ou não tem cabeçalho (ou a primeira linha é de dados). A leitura para logo
 * depois do limite de linhas.
 */
export function lerArquivoConferencia(
  texto: string,
): ArquivoConferencia | FalhaDaLeitura {
  if (texto.length > LIMITE_CARACTERES_CSV_RECONCILIACAO)
    return FALHA_ARQUIVO_GRANDE;
  // O cabeçalho mais o limite de linhas mais uma: com ela, o arquivo passou do limite.
  const leitura = lerCsv(texto, {
    maximoRegistros: LIMITE_LINHAS_CSV_RECONCILIACAO + 2,
  });
  if (!leitura.ok)
    return falha(
      "aspas_abertas",
      "Não foi possível ler o arquivo",
      `${leitura.mensagem}. Exporte o arquivo de novo pela Rifei.`,
    );
  const [cabecalho, ...dados] = leitura.registros;
  if (!cabecalho) return FALHA_ARQUIVO_VAZIO;
  if (texto.includes(CARACTERE_INVALIDO)) {
    const linha =
      leitura.registros.find((registro) =>
        registro.campos.some((campo) => campo.includes(CARACTERE_INVALIDO)),
      )?.linha ?? 1;
    return falha(
      "codificacao_invalida",
      "Não foi possível ler o arquivo",
      `O arquivo não está em UTF-8 (caractere inválido na linha ${linha}). Use o arquivo como a Rifei baixou, sem abrir e salvar no Excel; se precisar salvar, use “CSV UTF-8”.`,
    );
  }
  if (dados.length > LIMITE_LINHAS_CSV_RECONCILIACAO)
    return falha(
      "linhas_demais",
      "O arquivo tem linhas demais",
      `O arquivo tem mais de ${formatarInteiro(LIMITE_LINHAS_CSV_RECONCILIACAO)} linhas de pedidos. Exporte um período menor, ou sem a opção “Um bilhete por linha”.`,
    );
  const deteccao = detectarColunas(cabecalho.campos);
  if (
    cabecalho.campos
      .slice(0, deteccao.colunas.length)
      .some((nome) => pareceDado(nome))
  )
    return falha(
      "sem_cabecalho",
      "O arquivo não tem cabeçalho",
      "A primeira linha do arquivo não parece um cabeçalho: ela tem números, datas, valores ou e-mails. Exporte de novo pela Rifei: a primeira linha precisa ter os nomes das colunas.",
    );
  return {
    ok: true,
    colunas: deteccao.colunas,
    mapeamentoDetectado: deteccao.mapeamento,
    colunasDemais: deteccao.colunasDemais,
    registros: dados,
  };
}

export type MontagemDoCorpo =
  | { ok: true; corpo: CorpoConferencia; avisos: AvisoReconciliacao[] }
  | { ok: false; problemas: ProblemaDoCorpo[] };

/** Uma linha com as colunas mapeadas já lidas (cada campo sem coluna fica undefined). */
interface LinhaNormalizada {
  pedido_id?: string | null;
  status?: StatusArquivoReconciliacao | null;
  qtd_bilhetes?: number | null;
  numeros?: number | null;
  valor?: number | null;
  afiliado?: AfiliadoDoCorpo;
  dia?: string | null;
  instante?: number | null;
}

const CHAVES_DAS_LISTAS = [
  "pedido_id",
  "status",
  "qtd_bilhetes",
  "numeros",
  "valor",
  "afiliado",
  "dia",
  "instante",
] as const;

/**
 * O corpo compacto para o mapeamento escolhido (conferido antes: coluna inexistente, repetida ou de dado
 * pessoal não passa) e os avisos da leitura. Linhas iguais nas colunas mapeadas viram uma posição só, com
 * `vezes`. Só as colunas mapeadas são lidas.
 */
export function montarCorpo(
  arquivo: ArquivoConferencia,
  mapeamento: MapeamentoReconciliacao,
  opcoes: { fuso: string; arquivoSha256: string },
): MontagemDoCorpo {
  const problemas = conferirMapeamento(mapeamento, arquivo.colunas);
  if (problemas.length > 0) return { ok: false, problemas };

  const avisos = new Avisos();
  const pessoais = arquivo.colunas
    .filter((coluna) => coluna.dado_pessoal)
    .map((coluna) => coluna.nome);
  if (pessoais.length > 0)
    avisos.marcar("colunas_pessoais_ignoradas", { nomes: pessoais });
  avisos.contar("colunas_demais", arquivo.colunasDemais);

  const indice = (campo: CampoReconciliacao) => mapeamento[campo];
  const lerData =
    indice("data") === null ? null : criarLeitorDeData(opcoes.fuso);
  let semId = 0;
  let idInvalido = 0;
  let quantidadeInvalida = 0;
  let valorInvalido = 0;
  let dataInvalida = 0;
  let formulas = 0;
  /** Célula ilegível: conta a fórmula (sem guardar o texto). */
  const ilegivel = (texto: string) => {
    if (pareceFormula(texto)) formulas++;
  };

  const posicoes = new Map<string, number>();
  const vezes: number[] = [];
  const linhas: LinhaNormalizada[] = [];
  for (const registro of arquivo.registros) {
    const celula = (campo: CampoReconciliacao): string | null => {
      const coluna = indice(campo);
      return coluna === null ? null : (registro.campos[coluna] ?? "");
    };
    const linha: LinhaNormalizada = {};

    const textoId = celula("pedido_id");
    if (textoId !== null) {
      const id = lerIdPedido(textoId);
      if (id === VAZIO) semId++;
      else if (id === INVALIDO) {
        idInvalido++;
        ilegivel(textoId);
      }
      linha.pedido_id = id === VAZIO || id === INVALIDO ? null : id;
    }
    const textoStatus = celula("status");
    if (textoStatus !== null) {
      const status = lerStatus(textoStatus);
      if (status === "desconhecido") ilegivel(textoStatus);
      linha.status = status === VAZIO ? null : status;
    }
    const textoQtd = celula("qtd_bilhetes");
    if (textoQtd !== null) {
      const qtd = lerQuantidade(textoQtd);
      if (qtd === INVALIDO) {
        quantidadeInvalida++;
        ilegivel(textoQtd);
      }
      linha.qtd_bilhetes = typeof qtd === "number" ? qtd : null;
    }
    const textoNumeros = celula("bilhetes");
    if (textoNumeros !== null) {
      const numeros = contarNumeros(textoNumeros);
      if (numeros === INVALIDO) {
        quantidadeInvalida++;
        ilegivel(textoNumeros);
      }
      linha.numeros = typeof numeros === "number" ? numeros : null;
    }
    const textoValor = celula("valor");
    if (textoValor !== null) {
      const valor = lerCentavos(textoValor);
      if (valor === INVALIDO) {
        valorInvalido++;
        ilegivel(textoValor);
      }
      linha.valor = typeof valor === "number" ? valor : null;
    }
    const textoAfiliado = celula("afiliado");
    if (textoAfiliado !== null) {
      const afiliado = lerAfiliado(textoAfiliado);
      if (afiliado === false) ilegivel(textoAfiliado);
      linha.afiliado = afiliado;
    }
    const textoData = celula("data");
    if (textoData !== null && lerData) {
      const data = lerData(textoData);
      if (data === INVALIDO) {
        dataInvalida++;
        ilegivel(textoData);
      }
      const lida = data === VAZIO || data === INVALIDO ? null : data;
      linha.dia = lida?.dia ?? null;
      linha.instante = lida?.instante ?? null;
    }

    const chave = JSON.stringify(CHAVES_DAS_LISTAS.map((nome) => linha[nome]));
    const posicao = posicoes.get(chave);
    if (posicao === undefined) {
      posicoes.set(chave, linhas.length);
      linhas.push(linha);
      vezes.push(1);
    } else {
      vezes[posicao]++;
    }
  }

  if (indice("pedido_id") !== null) {
    avisos.contar("sem_id", semId);
    avisos.contar("id_invalido", idInvalido);
  }
  avisos.contar("quantidade_invalida", quantidadeInvalida);
  avisos.contar("valor_invalido", valorInvalido);
  avisos.contar("data_invalida", dataInvalida);
  avisos.contar("formula_ignorada", formulas);

  const colunas = Object.fromEntries(
    CAMPOS_RECONCILIACAO.map((campo) => {
      const coluna = indice(campo);
      return [campo, coluna === null ? null : arquivo.colunas[coluna].nome];
    }),
  ) as ColunasDoCorpo;
  const corpo: CorpoConferencia = {
    colunas,
    linhas: arquivo.registros.length,
    arquivo_sha256: opcoes.arquivoSha256,
    vezes,
  };
  const lista = <K extends (typeof CHAVES_DAS_LISTAS)[number]>(chave: K) =>
    linhas.map((linha) => linha[chave] ?? null) as NonNullable<
      CorpoConferencia[K]
    >;
  if (colunas.pedido_id !== null) corpo.pedido_id = lista("pedido_id");
  if (colunas.status !== null) corpo.status = lista("status");
  if (colunas.qtd_bilhetes !== null) corpo.qtd_bilhetes = lista("qtd_bilhetes");
  if (colunas.bilhetes !== null) corpo.numeros = lista("numeros");
  if (colunas.valor !== null) corpo.valor = lista("valor");
  if (colunas.afiliado !== null) corpo.afiliado = lista("afiliado");
  if (colunas.data !== null) {
    corpo.dia = lista("dia");
    corpo.instante = lista("instante");
  }
  return { ok: true, corpo, avisos: avisos.lista() };
}

/** Tamanho em bytes (UTF-8) do JSON que vai no corpo. */
export function bytesDoJson(json: string): number {
  return new TextEncoder().encode(json).length;
}

/** O corpo (já em JSON) passa do teto das rotas (LIMITE_CORPO_CONFERENCIA_BYTES)? */
export function corpoGrandeDemais(json: string): boolean {
  // Cada caractere ocupa ao menos 1 byte e no máximo 3 (UTF-16 → UTF-8): só conta quando precisa.
  if (json.length > LIMITE_CORPO_CONFERENCIA_BYTES) return true;
  if (json.length * 3 <= LIMITE_CORPO_CONFERENCIA_BYTES) return false;
  return bytesDoJson(json) > LIMITE_CORPO_CONFERENCIA_BYTES;
}
