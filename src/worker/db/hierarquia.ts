/**
 * Hierarquia da igreja no D1: rede (divisão jovens|adultos) → discipulador → célula.
 *
 * - CRUD das três entidades com as regras do contrato (docs/api.md): nomes únicos sem diferenciar
 *   maiúsculas (inclusive acentuadas) e ignorando espaços nas pontas; id inexistente no corpo =
 *   `referencia_invalida`; excluir algo referenciado = `em_uso` (as FKs da hierarquia são RESTRICT). O acesso
 *   do alvo (o usuário do líder, do discipulador ou da rede, RIFA-014) cai junto, em cascata (migração 0006).
 *   Cada POST, PUT e DELETE que muda algo deixa uma linha na trilha de auditoria, no mesmo `db.batch` (RIFA-018).
 * - Importação da planilha (POST /api/admin/hierarquia/importar): cria e atualiza pelo nome, nunca apaga,
 *   e grava tudo num único `db.batch` (uma transação): ou o arquivo inteiro entra, ou nada.
 *
 * O SQLite do D1 só ignora maiúsculas ASCII (COLLATE NOCASE), então a unicidade "inclusive acentuadas" é
 * conferida aqui, comparando `chaveDeNome`. O UNIQUE do banco continua valendo para corridas.
 */
import type { z } from "zod";
import {
  COLUNAS_CSV_HIERARQUIA,
  COLUNAS_CSV_HIERARQUIA_OBRIGATORIAS,
  LIMITE_LINHAS_CSV_HIERARQUIA,
  linhaCsvHierarquiaSchema,
  normalizarEspacos,
  type AvisoImportacao,
  type Celula,
  type CodigoErro,
  type ColunaCsvHierarquia,
  type DetalheValidacao,
  type Discipulador,
  type Divisao,
  type LinhaCsvHierarquia,
  type ProblemaZod,
  type Rede,
  type RespostaImportarHierarquia,
  type celulaEntradaSchema,
  type consultaCelulasSchema,
  type consultaDiscipuladoresSchema,
  type discipuladorEntradaSchema,
  type redeEntradaSchema,
} from "../../shared/contracts";
import { lerTabelaCsv, type ColunaIgnorada } from "../lib/csv";
import { mensagemDeCelula } from "../lib/mensagens-validacao";
import {
  prepararRegistroAuditoria,
  type Autoria,
  type CondicaoAuditoria,
} from "./auditoria";

export type DadosRede = z.output<typeof redeEntradaSchema>;
export type DadosDiscipulador = z.output<typeof discipuladorEntradaSchema>;
export type DadosCelula = z.output<typeof celulaEntradaSchema>;
export type FiltrosDiscipuladores = z.output<
  typeof consultaDiscipuladoresSchema
>;
export type FiltrosCelulas = z.output<typeof consultaCelulasSchema>;

export type CodigoFalha = Extract<
  CodigoErro,
  | "csv_invalido"
  | "referencia_invalida"
  | "nao_encontrado"
  | "nome_duplicado"
  | "em_uso"
>;
export interface Falha {
  ok: false;
  codigo: CodigoFalha;
  mensagem: string;
  detalhes?: unknown;
}
export type Resultado<T> = { ok: true; valor: T } | Falha;

function falha(
  codigo: CodigoFalha,
  mensagem: string,
  detalhes?: unknown,
): Falha {
  return detalhes === undefined
    ? { ok: false, codigo, mensagem }
    : { ok: false, codigo, mensagem, detalhes };
}

/**
 * Chave de comparação de nomes (CRUD e importação): espaços normalizados (sem os das pontas e com os
 * em sequência, inclusive tab e espaço não separável, juntados num só) e sem diferenciar maiúsculas,
 * inclusive acentuadas ("CÉLULA  01" = "célula 01"). Acentos continuam contando ("Célula" ≠ "Celula").
 */
export function chaveDeNome(nome: string): string {
  return normalizarEspacos(nome).normalize("NFC").toLowerCase();
}

function violou(erro: unknown, restricao: "UNIQUE" | "FOREIGN KEY"): boolean {
  return (
    erro instanceof Error &&
    erro.message.includes(`${restricao} constraint failed`)
  );
}

type Tabela = "redes" | "discipuladores" | "celulas";

const TEXTOS = {
  redes: {
    naoEncontrado: "Rede não encontrada",
    duplicado: "Já existe uma rede com esse nome",
  },
  discipuladores: {
    naoEncontrado: "Discipulador não encontrado",
    duplicado: "Já existe um discipulador com esse nome",
  },
  celulas: {
    naoEncontrado: "Célula não encontrada",
    duplicado: "Já existe uma célula com esse nome",
  },
} as const satisfies Record<
  Tabela,
  { naoEncontrado: string; duplicado: string }
>;

const AGORA = "strftime('%Y-%m-%dT%H:%M:%fZ', 'now')";

// ---------------------------------------------------------------------------------------------------
// Consultas (formato da API: redeSchema, discipuladorSchema, celulaSchema)
// ---------------------------------------------------------------------------------------------------

const SELECT_REDE = `
  SELECT id, nome, divisao, responsavel_nome, criado_em, atualizado_em
  FROM redes`;

const SELECT_DISCIPULADOR = `
  SELECT d.id, d.rede_id, d.nome, r.nome AS rede_nome, r.divisao, d.criado_em, d.atualizado_em
  FROM discipuladores AS d
  JOIN redes AS r ON r.id = d.rede_id`;

const SELECT_CELULA = `
  SELECT c.id, c.discipulador_id, c.nome, c.qtd_pessoas, c.lider_nome, c.lider_email,
    c.lider_telefone, d.nome AS discipulador_nome, d.rede_id, r.nome AS rede_nome, r.divisao,
    c.criado_em, c.atualizado_em
  FROM celulas AS c
  JOIN discipuladores AS d ON d.id = c.discipulador_id
  JOIN redes AS r ON r.id = d.rede_id`;

async function buscar<T>(
  db: D1Database,
  sql: string,
  id: number,
): Promise<T | null> {
  return db.prepare(sql).bind(id).first<T>();
}

const buscarRede = (db: D1Database, id: number) =>
  buscar<Rede>(db, `${SELECT_REDE} WHERE id = ?`, id);
const buscarDiscipulador = (db: D1Database, id: number) =>
  buscar<Discipulador>(db, `${SELECT_DISCIPULADOR} WHERE d.id = ?`, id);
const buscarCelula = (db: D1Database, id: number) =>
  buscar<Celula>(db, `${SELECT_CELULA} WHERE c.id = ?`, id);

function encontrado<T>(item: T | null, tabela: Tabela): Resultado<T> {
  return item === null
    ? falha("nao_encontrado", TEXTOS[tabela].naoEncontrado)
    : { ok: true, valor: item };
}

export async function listarRedes(db: D1Database): Promise<Rede[]> {
  const { results } = await db
    .prepare(`${SELECT_REDE} ORDER BY nome, id`)
    .all<Rede>();
  return results;
}

export async function listarDiscipuladores(
  db: D1Database,
  filtros: FiltrosDiscipuladores,
): Promise<Discipulador[]> {
  const { results } = await db
    .prepare(
      `${SELECT_DISCIPULADOR}
       WHERE (?1 IS NULL OR d.rede_id = ?1)
       ORDER BY d.nome, d.id`,
    )
    .bind(filtros.rede_id ?? null)
    .all<Discipulador>();
  return results;
}

export async function listarCelulas(
  db: D1Database,
  filtros: FiltrosCelulas,
): Promise<Celula[]> {
  const { results } = await db
    .prepare(
      `${SELECT_CELULA}
       WHERE (?1 IS NULL OR c.discipulador_id = ?1)
         AND (?2 IS NULL OR d.rede_id = ?2)
         AND (?3 IS NULL OR r.divisao = ?3)
       ORDER BY c.nome, c.id`,
    )
    .bind(
      filtros.discipulador_id ?? null,
      filtros.rede_id ?? null,
      filtros.divisao ?? null,
    )
    .all<Celula>();
  return results;
}

export async function obterRede(
  db: D1Database,
  id: number,
): Promise<Resultado<Rede>> {
  return encontrado(await buscarRede(db, id), "redes");
}

export async function obterDiscipulador(
  db: D1Database,
  id: number,
): Promise<Resultado<Discipulador>> {
  return encontrado(await buscarDiscipulador(db, id), "discipuladores");
}

export async function obterCelula(
  db: D1Database,
  id: number,
): Promise<Resultado<Celula>> {
  return encontrado(await buscarCelula(db, id), "celulas");
}

// ---------------------------------------------------------------------------------------------------
// Gravação (POST, PUT e DELETE), com a trilha de auditoria no mesmo lote (RIFA-018)
// ---------------------------------------------------------------------------------------------------

/** Valor de uma coluna gravada pelo CRUD (texto, inteiro ou nulo). */
type ValorColuna = string | number | null;

/**
 * Como cada coluna entra no resumo da trilha: `nome` (da rede, do discipulador ou da célula) e `valor` (divisão,
 * ids e qtd_pessoas) com o antes e o depois; `pessoal` (os dados do líder e o responsável da rede) só pelo nome
 * da coluna, nunca o valor.
 */
type FormatoColuna = "nome" | "valor" | "pessoal";

interface Entidade {
  tabela: Tabela;
  /** O tipo do alvo na trilha (`celula:7`). */
  tipo: "rede" | "discipulador" | "celula";
  /** Como o resumo chama o item, e a concordância de "criada", "alterada" e "removida". */
  rotulo: string;
  feminino: boolean;
  /** As colunas que o POST e o PUT gravam, na ordem dos valores (`valoresRede`...). */
  colunas: readonly { nome: string; formato: FormatoColuna }[];
  /** A coluna de `usuarios` que prende o acesso a este alvo (D12; cai junto com ele) e como o resumo o chama. */
  colunaDoAcesso: "celula_id" | "discipulador_id" | "rede_id";
  acesso: string;
}

const ENTIDADES = {
  redes: {
    tabela: "redes",
    tipo: "rede",
    rotulo: "Rede",
    feminino: true,
    colunas: [
      { nome: "nome", formato: "nome" },
      { nome: "divisao", formato: "valor" },
      { nome: "responsavel_nome", formato: "pessoal" },
    ],
    colunaDoAcesso: "rede_id",
    acesso: "acesso da rede",
  },
  discipuladores: {
    tabela: "discipuladores",
    tipo: "discipulador",
    rotulo: "Discipulador",
    feminino: false,
    colunas: [
      { nome: "rede_id", formato: "valor" },
      { nome: "nome", formato: "nome" },
    ],
    colunaDoAcesso: "discipulador_id",
    acesso: "acesso do discipulador",
  },
  celulas: {
    tabela: "celulas",
    tipo: "celula",
    rotulo: "Célula",
    feminino: true,
    colunas: [
      { nome: "discipulador_id", formato: "valor" },
      { nome: "nome", formato: "nome" },
      { nome: "qtd_pessoas", formato: "valor" },
      { nome: "lider_nome", formato: "pessoal" },
      { nome: "lider_email", formato: "pessoal" },
      { nome: "lider_telefone", formato: "pessoal" },
    ],
    colunaDoAcesso: "celula_id",
    acesso: "acesso do líder",
  },
} as const satisfies Record<Tabela, Entidade>;

/** A linha como a leitura a viu: os valores das colunas (na ordem de `colunas`) e o usuário do acesso do alvo. */
interface Retrato {
  valores: readonly ValorColuna[];
  acessoId: number | null;
}

async function lerRetrato(
  db: D1Database,
  entidade: Entidade,
  id: number,
): Promise<Retrato | null> {
  const linha = await db
    .prepare(
      `SELECT ${entidade.colunas.map(({ nome }) => `t.${nome}`).join(", ")},
         (SELECT u.id FROM usuarios AS u WHERE u.${entidade.colunaDoAcesso} = t.id) AS acesso_id
       FROM ${entidade.tabela} AS t WHERE t.id = ?1`,
    )
    .bind(id)
    .first<Record<string, ValorColuna>>();
  if (linha === null) return null;
  return {
    valores: entidade.colunas.map(({ nome }) => linha[nome] ?? null),
    acessoId: (linha.acesso_id as number | null) ?? null,
  };
}

/**
 * A linha `id` continua como no retrato (com `comAcesso`, o acesso do alvo também), em SQL: `?<inicio>` é o id e
 * os seguintes são os de `valoresDoRetrato`. Os textos comparam em BINARY: o NOCASE das colunas de nome não
 * esconde uma troca só de maiúsculas.
 */
function comoNoRetrato(
  entidade: Entidade,
  inicio: number,
  comAcesso: boolean,
): string {
  const condicoes = [
    `id = ?${inicio}`,
    ...entidade.colunas.map(
      ({ nome }, i) => `${nome} IS ?${inicio + 1 + i} COLLATE BINARY`,
    ),
  ];
  if (comAcesso)
    condicoes.push(
      `(SELECT u.id FROM usuarios AS u WHERE u.${entidade.colunaDoAcesso} = ?${inicio}) IS ?${inicio + 1 + entidade.colunas.length}`,
    );
  return condicoes.join(" AND ");
}

function valoresDoRetrato(
  id: number,
  retrato: Retrato,
  comAcesso: boolean,
): unknown[] {
  return [id, ...retrato.valores, ...(comAcesso ? [retrato.acessoId] : [])];
}

/** A condição da trilha no lote: o registro só fica se a linha ainda é a do retrato (a mesma da gravação). */
function condicaoDoRetrato(
  entidade: Entidade,
  id: number,
  retrato: Retrato,
  comAcesso: boolean,
): CondicaoAuditoria {
  return {
    sql: `EXISTS (SELECT 1 FROM ${entidade.tabela} WHERE ${comoNoRetrato(entidade, 6, comAcesso)})`,
    valores: valoresDoRetrato(id, retrato, comAcesso),
  };
}

// --- Resumos da trilha: o nome do item, ids e qtd_pessoas; dos dados pessoais, só o nome da coluna ---

const flexao = (entidade: Entidade, raiz: string) =>
  `${raiz}${entidade.feminino ? "a" : "o"}`;

/** "Célula "Célula Alfa"": o rótulo e o nome do item (o id do alvo pode voltar num item novo). */
function nomeDoItem(
  entidade: Entidade,
  valores: readonly ValorColuna[],
): string {
  const indice = entidade.colunas.findIndex(
    ({ formato }) => formato === "nome",
  );
  return `${entidade.rotulo} ${JSON.stringify(valores[indice])}`;
}

/** As colunas de configuração com o valor: "discipulador_id 5, qtd_pessoas 12". */
function configuracao(
  entidade: Entidade,
  valores: readonly ValorColuna[],
): string {
  return entidade.colunas
    .flatMap(({ nome, formato }, i) =>
      formato === "valor" ? [`${nome} ${String(valores[i])}`] : [],
    )
    .join(", ");
}

/** POST: "Célula "Célula Alfa" criada (discipulador_id 5, qtd_pessoas 12)". */
function resumirCriacao(
  entidade: Entidade,
  valores: readonly ValorColuna[],
): string {
  return `${nomeDoItem(entidade, valores)} ${flexao(entidade, "criad")} (${configuracao(entidade, valores)})`;
}

/**
 * PUT: só o que mudou, com o antes e o depois ("qtd_pessoas (12 → 15)": a meta e o ranking mudam junto); os dados
 * pessoais só pelo nome da coluna ("lider_telefone (apagado)"). null: nada muda, e o PUT não registra.
 */
function resumirAtualizacao(
  entidade: Entidade,
  antes: readonly ValorColuna[],
  depois: readonly ValorColuna[],
): string | null {
  const mudancas = entidade.colunas.flatMap(({ nome, formato }, i) => {
    const [de, para] = [antes[i], depois[i]];
    if (de === para) return [];
    if (formato === "pessoal")
      return [
        `${nome} (${de === null ? "informado" : para === null ? "apagado" : "alterado"})`,
      ];
    const texto = (valor: ValorColuna) =>
      formato === "nome" ? JSON.stringify(valor) : String(valor);
    return [`${nome} (${texto(de)} → ${texto(para)})`];
  });
  return mudancas.length === 0
    ? null
    : `${nomeDoItem(entidade, depois)} ${flexao(entidade, "alterad")}: ${mudancas.join(", ")}`;
}

/**
 * DELETE: o item e, se havia, o acesso da hierarquia que cai junto em cascata (D12), pelo id do usuário. O nome do
 * item fica no resumo porque o id do usuário pode voltar numa pessoa nova (usuarios.id não é AUTOINCREMENT).
 */
function resumirRemocao(entidade: Entidade, retrato: Retrato): string {
  const removido = `${nomeDoItem(entidade, retrato.valores)} ${flexao(entidade, "removid")} (${configuracao(entidade, retrato.valores)})`;
  return retrato.acessoId === null
    ? removido
    : `${removido}; ${entidade.acesso} removido junto, usuário ${retrato.acessoId} (com os links e as sessões)`;
}

// --- Gravação ---

async function existe(
  db: D1Database,
  tabela: Tabela,
  id: number,
): Promise<boolean> {
  const linha = await db
    .prepare(`SELECT 1 AS existe FROM ${tabela} WHERE id = ?`)
    .bind(id)
    .first();
  return linha !== null;
}

/** Outro registro da tabela já usa o nome (na comparação do contrato)? */
async function nomeEmUso(
  db: D1Database,
  tabela: Tabela,
  nome: string,
  exceto?: number,
): Promise<boolean> {
  const chave = chaveDeNome(nome);
  const { results } = await db
    .prepare(`SELECT id, nome FROM ${tabela}`)
    .all<{ id: number; nome: string }>();
  return results.some(
    (linha) => linha.id !== exceto && chaveDeNome(linha.nome) === chave,
  );
}

interface Referencia {
  tabela: Tabela;
  id: number;
  /** Campo do corpo que aponta para a tabela (vai em `detalhes`, como nos erros de validação). */
  campo: string;
  mensagem: string;
}

function referenciaInvalida(referencia: Referencia): Falha {
  const detalhe: DetalheValidacao = {
    caminho: [referencia.campo],
    codigo: "referencia_invalida",
    mensagem: referencia.mensagem,
  };
  return falha("referencia_invalida", referencia.mensagem, [detalhe]);
}

/** O que o POST e o PUT gravam. */
interface Gravacao<T> {
  /** Os valores das colunas, na ordem de `colunas` da entidade. */
  valores: readonly ValorColuna[];
  nome: string;
  referencia?: Referencia;
  reler: (db: D1Database, id: number) => Promise<T | null>;
}

/** Regras comuns de POST e PUT: a referência existe e o nome está livre. */
async function conferir(
  db: D1Database,
  tabela: Tabela,
  gravacao: Gravacao<unknown>,
  exceto?: number,
): Promise<Falha | null> {
  const { referencia } = gravacao;
  if (referencia && !(await existe(db, referencia.tabela, referencia.id)))
    return referenciaInvalida(referencia);
  if (await nomeEmUso(db, tabela, gravacao.nome, exceto))
    return falha("nome_duplicado", TEXTOS[tabela].duplicado);
  return null;
}

/**
 * Roda o lote (uma transação do D1: a gravação e o registro da trilha ficam juntos ou nenhum fica). Violação de
 * UNIQUE ou de FK que escape das conferências (corrida) vira o mesmo erro delas.
 */
async function gravarLote(
  db: D1Database,
  tabela: Tabela,
  referencia: Referencia | undefined,
  comandos: D1PreparedStatement[],
): Promise<Resultado<D1Result<{ id: number }>[]>> {
  try {
    return { ok: true, valor: await db.batch<{ id: number }>(comandos) };
  } catch (erro) {
    if (violou(erro, "UNIQUE"))
      return falha("nome_duplicado", TEXTOS[tabela].duplicado);
    if (referencia && violou(erro, "FOREIGN KEY"))
      return referenciaInvalida(referencia);
    throw erro;
  }
}

/**
 * Quantas vezes o PUT e o DELETE releem e refazem o lote quando a linha (ou o acesso do alvo) muda entre a
 * leitura e o lote, por outra gravação ao mesmo tempo. A gravação vai condicionada ao retrato lido, e o registro
 * da trilha também: o resumo descreve sempre o que mudou de fato.
 */
const TENTATIVAS_GRAVACAO = 3;

function mudouEnquantoIsso(entidade: Entidade): Falha {
  return falha(
    "em_uso",
    `${entidade.feminino ? "A" : "O"} ${entidade.rotulo.toLowerCase()} mudou enquanto isso (outra alteração ao mesmo tempo) e nada foi gravado: atualize a página e tente de novo.`,
  );
}

/** POST: grava e relê o item; com `autoria`, a linha `hierarquia.criar` vai no mesmo lote. */
async function criar<T>(
  db: D1Database,
  entidade: Entidade,
  gravacao: Gravacao<T>,
  autoria?: Autoria,
): Promise<Resultado<T>> {
  const recusa = await conferir(db, entidade.tabela, gravacao);
  if (recusa) return recusa;
  const colunas = entidade.colunas.map(({ nome }) => nome);
  const lote = await gravarLote(db, entidade.tabela, gravacao.referencia, [
    db
      .prepare(
        `INSERT INTO ${entidade.tabela} (${colunas.join(", ")})
         VALUES (${colunas.map((_, i) => `?${i + 1}`).join(", ")}) RETURNING id`,
      )
      .bind(...gravacao.valores),
    // Mesma transação: last_insert_rowid() é o item recém-criado.
    ...(autoria
      ? [
          prepararRegistroAuditoria(db, {
            ...autoria,
            acao: "hierarquia.criar",
            alvo: { tipo: entidade.tipo, idSql: "last_insert_rowid()" },
            resumo: resumirCriacao(entidade, gravacao.valores),
          }),
        ]
      : []),
  ]);
  if (!lote.ok) return lote;
  const id = lote.valor[0]?.results[0]?.id;
  if (id === undefined) throw new Error("INSERT sem RETURNING id");
  return encontrado(await gravacao.reler(db, id), entidade.tabela);
}

/**
 * PUT: confere, grava e relê o item. O UPDATE só vale se a linha ainda é a lida (senão, lê de novo e refaz); com
 * `autoria` e alguma mudança, a linha `hierarquia.atualizar` vai no mesmo lote, ANTES do UPDATE e com a mesma
 * condição (depois dele, a linha já não é a do retrato). PUT igual ao que está gravado não registra.
 */
async function atualizarItem<T>(
  db: D1Database,
  entidade: Entidade,
  id: number,
  gravacao: Gravacao<T>,
  autoria?: Autoria,
): Promise<Resultado<T>> {
  const { tabela } = entidade;
  const sets = entidade.colunas.map(({ nome }, i) => `${nome} = ?${i + 1}`);
  const atualizar = `UPDATE ${tabela} SET ${sets.join(", ")}, atualizado_em = ${AGORA}
    WHERE ${comoNoRetrato(entidade, entidade.colunas.length + 1, false)}`;
  for (let tentativa = 1; tentativa <= TENTATIVAS_GRAVACAO; tentativa++) {
    const antes = await lerRetrato(db, entidade, id);
    if (antes === null)
      return falha("nao_encontrado", TEXTOS[tabela].naoEncontrado);
    const recusa = await conferir(db, tabela, gravacao, id);
    if (recusa) return recusa;
    const resumo = resumirAtualizacao(
      entidade,
      antes.valores,
      gravacao.valores,
    );
    const lote = await gravarLote(db, tabela, gravacao.referencia, [
      ...(autoria && resumo !== null
        ? [
            prepararRegistroAuditoria(
              db,
              {
                ...autoria,
                acao: "hierarquia.atualizar",
                alvo: `${entidade.tipo}:${id}`,
                resumo,
              },
              condicaoDoRetrato(entidade, id, antes, false),
            ),
          ]
        : []),
      db
        .prepare(atualizar)
        .bind(...gravacao.valores, ...valoresDoRetrato(id, antes, false)),
    ]);
    if (!lote.ok) return lote;
    if ((lote.valor.at(-1)?.meta.changes ?? 0) > 0)
      return encontrado(await gravacao.reler(db, id), tabela);
    // A linha mudou (ou sumiu) entre a leitura e o lote: nada foi gravado nem registrado; lê de novo.
  }
  return mudouEnquantoIsso(entidade);
}

const referenciaRede = (id: number): Referencia => ({
  tabela: "redes",
  id,
  campo: "rede_id",
  mensagem: `A rede ${id} não existe`,
});

const referenciaDiscipulador = (id: number): Referencia => ({
  tabela: "discipuladores",
  id,
  campo: "discipulador_id",
  mensagem: `O discipulador ${id} não existe`,
});

/** Nomes e textos livres são gravados com os espaços normalizados, como a importação grava. */
const textoOpcional = (valor: string | null) =>
  valor === null ? null : normalizarEspacos(valor);

// Na ordem de `colunas` de ENTIDADES.
const valoresRede = (dados: DadosRede): ValorColuna[] => [
  normalizarEspacos(dados.nome),
  dados.divisao,
  textoOpcional(dados.responsavel_nome),
];
const valoresDiscipulador = (dados: DadosDiscipulador): ValorColuna[] => [
  dados.rede_id,
  normalizarEspacos(dados.nome),
];
const valoresCelula = (dados: DadosCelula): ValorColuna[] => [
  dados.discipulador_id,
  normalizarEspacos(dados.nome),
  dados.qtd_pessoas,
  normalizarEspacos(dados.lider_nome),
  dados.lider_email,
  textoOpcional(dados.lider_telefone),
];

const gravacaoRede = (dados: DadosRede): Gravacao<Rede> => ({
  valores: valoresRede(dados),
  nome: dados.nome,
  reler: buscarRede,
});
const gravacaoDiscipulador = (
  dados: DadosDiscipulador,
): Gravacao<Discipulador> => ({
  valores: valoresDiscipulador(dados),
  nome: dados.nome,
  referencia: referenciaRede(dados.rede_id),
  reler: buscarDiscipulador,
});
const gravacaoCelula = (dados: DadosCelula): Gravacao<Celula> => ({
  valores: valoresCelula(dados),
  nome: dados.nome,
  referencia: referenciaDiscipulador(dados.discipulador_id),
  reler: buscarCelula,
});

// Com `autoria` (a sessão de quem grava, RIFA-018), cada gravação deixa uma linha na trilha, no mesmo lote.

export function criarRede(
  db: D1Database,
  dados: DadosRede,
  autoria?: Autoria,
): Promise<Resultado<Rede>> {
  return criar(db, ENTIDADES.redes, gravacaoRede(dados), autoria);
}

export function atualizarRede(
  db: D1Database,
  id: number,
  dados: DadosRede,
  autoria?: Autoria,
): Promise<Resultado<Rede>> {
  return atualizarItem(db, ENTIDADES.redes, id, gravacaoRede(dados), autoria);
}

export function criarDiscipulador(
  db: D1Database,
  dados: DadosDiscipulador,
  autoria?: Autoria,
): Promise<Resultado<Discipulador>> {
  return criar(
    db,
    ENTIDADES.discipuladores,
    gravacaoDiscipulador(dados),
    autoria,
  );
}

export function atualizarDiscipulador(
  db: D1Database,
  id: number,
  dados: DadosDiscipulador,
  autoria?: Autoria,
): Promise<Resultado<Discipulador>> {
  return atualizarItem(
    db,
    ENTIDADES.discipuladores,
    id,
    gravacaoDiscipulador(dados),
    autoria,
  );
}

export function criarCelula(
  db: D1Database,
  dados: DadosCelula,
  autoria?: Autoria,
): Promise<Resultado<Celula>> {
  return criar(db, ENTIDADES.celulas, gravacaoCelula(dados), autoria);
}

export function atualizarCelula(
  db: D1Database,
  id: number,
  dados: DadosCelula,
  autoria?: Autoria,
): Promise<Resultado<Celula>> {
  return atualizarItem(
    db,
    ENTIDADES.celulas,
    id,
    gravacaoCelula(dados),
    autoria,
  );
}

// ---------------------------------------------------------------------------------------------------
// Exclusão (DELETE): a FK RESTRICT do banco decide se está em uso. O acesso do alvo cai em cascata (0006)
// ---------------------------------------------------------------------------------------------------

interface Dependentes {
  tabela: "discipuladores" | "celulas" | "afiliados";
  coluna: "rede_id" | "discipulador_id" | "celula_id";
  mensagem: (quantidade: number) => string;
  /** Quando a trilha de auditoria segura o acesso do alvo (o usuário dele aparece como autor de uma ação). */
  mensagemDaTrilha: string;
}

/** Recusada por uma referência que sumiu antes da conferência (outra exclusão ao mesmo tempo). */
const MENSAGEM_REFERENCIA_QUE_MUDOU =
  "A exclusão foi recusada por uma referência que mudou enquanto isso: atualize a página e tente de novo.";

/**
 * Apaga o registro. A exclusão leva junto, em cascata, o acesso do alvo (o usuário do líder, do discipulador ou
 * da rede, com os links e as sessões, migração 0006). O DELETE só vale se a linha e o acesso ainda são os lidos
 * (senão, lê de novo e refaz); com `autoria`, a linha `hierarquia.remover` vai no mesmo lote, ANTES do DELETE e
 * com a mesma condição, e diz qual acesso caiu junto. Recusada por chave estrangeira (nada apagado, nada
 * registrado), a mensagem diz o motivo certo, conferido no banco: os dependentes da hierarquia (RESTRICT) ou, sem
 * eles, a trilha de auditoria, que segura (RESTRICT) o usuário do acesso quando ele aparece como autor de uma ação.
 */
async function remover(
  db: D1Database,
  entidade: Entidade,
  id: number,
  dependentes: Dependentes,
  autoria?: Autoria,
): Promise<Resultado<null>> {
  const { tabela } = entidade;
  for (let tentativa = 1; tentativa <= TENTATIVAS_GRAVACAO; tentativa++) {
    const retrato = await lerRetrato(db, entidade, id);
    if (retrato === null)
      return falha("nao_encontrado", TEXTOS[tabela].naoEncontrado);
    let lote: D1Result[];
    try {
      lote = await db.batch([
        ...(autoria
          ? [
              prepararRegistroAuditoria(
                db,
                {
                  ...autoria,
                  acao: "hierarquia.remover",
                  alvo: `${entidade.tipo}:${id}`,
                  resumo: resumirRemocao(entidade, retrato),
                },
                condicaoDoRetrato(entidade, id, retrato, true),
              ),
            ]
          : []),
        db
          .prepare(
            `DELETE FROM ${tabela} WHERE ${comoNoRetrato(entidade, 1, true)}`,
          )
          .bind(...valoresDoRetrato(id, retrato, true)),
      ]);
    } catch (erro) {
      if (!violou(erro, "FOREIGN KEY")) throw erro;
      return motivoDaRecusa(db, entidade, id, dependentes);
    }
    if ((lote.at(-1)?.meta.changes ?? 0) > 0) return { ok: true, valor: null };
    // A linha ou o acesso mudou (ou sumiu) entre a leitura e o lote: nada foi apagado nem registrado; lê de novo.
  }
  return mudouEnquantoIsso(entidade);
}

/** A exclusão foi recusada por chave estrangeira: os dependentes da hierarquia ou a trilha de auditoria. */
async function motivoDaRecusa(
  db: D1Database,
  entidade: Entidade,
  id: number,
  dependentes: Dependentes,
): Promise<Falha> {
  const [filhos, naTrilha] = await db.batch<{ total: number }>([
    db
      .prepare(
        `SELECT count(*) AS total FROM ${dependentes.tabela} WHERE ${dependentes.coluna} = ?`,
      )
      .bind(id),
    db
      .prepare(
        `SELECT count(*) AS total FROM auditoria
         WHERE usuario_id IN (SELECT id FROM usuarios WHERE ${entidade.colunaDoAcesso} = ?)`,
      )
      .bind(id),
  ]);
  const quantidade = filhos.results[0]?.total ?? 0;
  if (quantidade > 0) return falha("em_uso", dependentes.mensagem(quantidade));
  if ((naTrilha.results[0]?.total ?? 0) > 0)
    return falha("em_uso", dependentes.mensagemDaTrilha);
  return falha("em_uso", MENSAGEM_REFERENCIA_QUE_MUDOU);
}

export function removerRede(
  db: D1Database,
  id: number,
  autoria?: Autoria,
): Promise<Resultado<null>> {
  return remover(
    db,
    ENTIDADES.redes,
    id,
    {
      tabela: "discipuladores",
      coluna: "rede_id",
      mensagem: (quantidade) =>
        `A rede tem discipuladores (${quantidade}). Exclua os discipuladores ou mova-os para outra rede antes de excluir a rede.`,
      mensagemDaTrilha:
        "A rede não pode ser excluída: o acesso dela aparece como autor na trilha de auditoria, que guarda quem fez cada ação.",
    },
    autoria,
  );
}

export function removerDiscipulador(
  db: D1Database,
  id: number,
  autoria?: Autoria,
): Promise<Resultado<null>> {
  return remover(
    db,
    ENTIDADES.discipuladores,
    id,
    {
      tabela: "celulas",
      coluna: "discipulador_id",
      mensagem: (quantidade) =>
        `O discipulador tem células (${quantidade}). Exclua as células ou mova-as para outro discipulador antes de excluir o discipulador.`,
      mensagemDaTrilha:
        "O discipulador não pode ser excluído: o acesso dele aparece como autor na trilha de auditoria, que guarda quem fez cada ação.",
    },
    autoria,
  );
}

export function removerCelula(
  db: D1Database,
  id: number,
  autoria?: Autoria,
): Promise<Resultado<null>> {
  return remover(
    db,
    ENTIDADES.celulas,
    id,
    {
      tabela: "afiliados",
      coluna: "celula_id",
      mensagem: (quantidade) =>
        `A célula tem afiliados vinculados (${quantidade}). Desvincule os afiliados antes de excluir a célula.`,
      mensagemDaTrilha:
        "A célula não pode ser excluída: o acesso dela aparece como autor na trilha de auditoria, que guarda quem fez cada ação.",
    },
    autoria,
  );
}

// ---------------------------------------------------------------------------------------------------
// Importação da planilha
// ---------------------------------------------------------------------------------------------------

type ErroLinha = RespostaImportarHierarquia["erros"][number];
type Contagem = RespostaImportarHierarquia["criados"];

interface LinhaValida {
  linha: number;
  dados: LinhaCsvHierarquia;
}

/** O que o banco tem hoje (só as colunas que a importação compara). */
interface EstadoHierarquia {
  redes: {
    id: number;
    nome: string;
    divisao: Divisao;
    responsavel_nome: string | null;
  }[];
  discipuladores: { id: number; nome: string; rede_id: number }[];
  celulas: {
    id: number;
    nome: string;
    discipulador_id: number;
    qtd_pessoas: number;
    lider_nome: string;
    lider_email: string | null;
    lider_telefone: string | null;
  }[];
}

/** Entidades como o arquivo as descreve, na ordem em que aparecem (a primeira linha válida manda). */
interface RedeDoArquivo {
  chave: string;
  linha: number;
  nome: string;
  divisao: Divisao;
  /** undefined = coluna fora do cabeçalho (mantém o valor atual); null = vazia em todas as linhas. */
  responsavel: string | null | undefined;
  linhaDoResponsavel: number;
}
interface DiscipuladorDoArquivo {
  chave: string;
  linha: number;
  nome: string;
  rede: RedeDoArquivo;
}
interface CelulaDoArquivo {
  chave: string;
  linha: number;
  dados: LinhaCsvHierarquia;
  discipulador: DiscipuladorDoArquivo;
}

/** Valores gravados. As FKs vão pelo nome final do pai e são resolvidas dentro do lote. */
interface RedeGravada {
  nome: string;
  divisao: Divisao;
  responsavel_nome: string | null;
}
interface DiscipuladorGravado {
  nome: string;
  rede_nome: string;
}
interface CelulaGravada {
  nome: string;
  discipulador_nome: string;
  qtd_pessoas: number;
  lider_nome: string;
  lider_email: string | null;
  lider_telefone: string | null;
}

interface Mudancas<T> {
  novas: T[];
  alteradas: (T & { id: number })[];
  inalteradas: number;
}

interface PlanoImportacao {
  erros: ErroLinha[];
  avisos: AvisoImportacao[];
  redes: Mudancas<RedeGravada>;
  discipuladores: Mudancas<DiscipuladorGravado>;
  celulas: Mudancas<CelulaGravada>;
}

/** Um erro por coluna (o primeiro), na ordem das colunas do schema. */
function errosDeValidacao(
  linha: number,
  problemas: readonly ProblemaZod[],
): ErroLinha[] {
  const porColuna = new Map<ErroLinha["coluna"], string>();
  for (const problema of problemas) {
    const coluna =
      COLUNAS_CSV_HIERARQUIA.find((nome) => nome === problema.path[0]) ?? null;
    if (!porColuna.has(coluna)) porColuna.set(coluna, problema.message);
  }
  return [...porColuna].map(([coluna, mensagem]) => ({
    linha,
    coluna,
    mensagem,
  }));
}

/**
 * Colunas em que duas linhas do arquivo diferem, na comparação da importação: textos pela chave de nome
 * (espaços das pontas e maiúsculas não contam); números e vazios como vieram do schema.
 */
function colunasDiferentes(
  a: LinhaCsvHierarquia,
  b: LinhaCsvHierarquia,
): ColunaCsvHierarquia[] {
  const normalizar = (valor: unknown) =>
    typeof valor === "string" ? chaveDeNome(valor) : valor;
  return COLUNAS_CSV_HIERARQUIA.filter(
    (coluna) => normalizar(a[coluna]) !== normalizar(b[coluna]),
  );
}

/**
 * Confere a coerência do arquivo e monta as entidades. Uma linha que contradiz outra anterior (rede com
 * outra divisão ou outro responsável, discipulador em outra rede, célula repetida com dados diferentes)
 * vira erro e fica de fora. A célula repetida com os mesmos dados é tolerada: a linha já foi lida.
 */
function lerEntidades(linhas: LinhaValida[]) {
  const redes = new Map<string, RedeDoArquivo>();
  const discipuladores = new Map<string, DiscipuladorDoArquivo>();
  const celulas = new Map<string, CelulaDoArquivo>();
  const erros: ErroLinha[] = [];
  const avisos: AvisoImportacao[] = [];

  for (const { linha, dados } of linhas) {
    const chaveRede = chaveDeNome(dados.rede);
    const chaveDiscipulador = chaveDeNome(dados.discipulador);
    const chaveCelula = chaveDeNome(dados.celula);
    const rede = redes.get(chaveRede);
    const discipulador = discipuladores.get(chaveDiscipulador);
    const celula = celulas.get(chaveCelula);
    const responsavel = dados.rede_responsavel;
    const diferencas = celula ? colunasDiferentes(celula.dados, dados) : [];
    // Linha repetida com os mesmos dados (ex.: colada duas vezes): não é erro e a célula conta uma vez.
    if (celula && diferencas.length === 0) {
      avisos.push({
        tipo: "linha_repetida",
        linha,
        mensagem: `Linha igual à linha ${celula.linha}: foi ignorada (a célula conta uma vez)`,
      });
      continue;
    }

    const conflitos: ErroLinha[] = [];
    if (rede && rede.divisao !== dados.divisao)
      conflitos.push({
        linha,
        coluna: "divisao",
        mensagem: `A rede "${rede.nome}" já aparece na linha ${rede.linha} com a divisão "${rede.divisao}"`,
      });
    if (
      rede &&
      typeof rede.responsavel === "string" &&
      typeof responsavel === "string" &&
      chaveDeNome(rede.responsavel) !== chaveDeNome(responsavel)
    )
      conflitos.push({
        linha,
        coluna: "rede_responsavel",
        mensagem: `A rede "${rede.nome}" já aparece na linha ${rede.linhaDoResponsavel} com o responsável "${rede.responsavel}"`,
      });
    if (discipulador && discipulador.rede.chave !== chaveRede)
      conflitos.push({
        linha,
        coluna: "discipulador",
        mensagem: `O discipulador "${discipulador.nome}" já aparece na linha ${discipulador.linha} na rede "${discipulador.rede.nome}" (um discipulador fica numa rede só; se forem pessoas diferentes, diferencie os nomes)`,
      });
    if (celula)
      conflitos.push({
        linha,
        coluna: null,
        mensagem: `A célula "${celula.dados.celula}" já aparece na linha ${celula.linha} com dados diferentes (${diferencas.join(", ")}): deixe uma linha só ou, se forem células diferentes, diferencie os nomes`,
      });
    if (conflitos.length > 0) {
      erros.push(...conflitos);
      continue;
    }

    let redeDaLinha = rede;
    if (!redeDaLinha) {
      redeDaLinha = {
        chave: chaveRede,
        linha,
        nome: dados.rede,
        divisao: dados.divisao,
        responsavel,
        linhaDoResponsavel: linha,
      };
      redes.set(chaveRede, redeDaLinha);
    } else if (
      typeof responsavel === "string" &&
      redeDaLinha.responsavel === null
    ) {
      // O responsável pode vir em qualquer linha da rede: as vazias não o apagam.
      redeDaLinha.responsavel = responsavel;
      redeDaLinha.linhaDoResponsavel = linha;
    }
    let discipuladorDaLinha = discipulador;
    if (!discipuladorDaLinha) {
      discipuladorDaLinha = {
        chave: chaveDiscipulador,
        linha,
        nome: dados.discipulador,
        rede: redeDaLinha,
      };
      discipuladores.set(chaveDiscipulador, discipuladorDaLinha);
    }
    celulas.set(chaveCelula, {
      chave: chaveCelula,
      linha,
      dados,
      discipulador: discipuladorDaLinha,
    });
  }
  return { redes, discipuladores, celulas, erros, avisos };
}

/** Primeiro registro de cada chave de nome (o banco vem ordenado por id). */
function porChave<T extends { nome: string }>(itens: T[]): Map<string, T> {
  const mapa = new Map<string, T>();
  for (const item of itens) {
    const chave = chaveDeNome(item.nome);
    if (!mapa.has(chave)) mapa.set(chave, item);
  }
  return mapa;
}

function classificar<A extends { id: number }, G>(
  itens: { atual: A | undefined; gravada: G }[],
  mudou: (atual: A, gravada: G) => boolean,
): Mudancas<G> {
  const mudancas: Mudancas<G> = { novas: [], alteradas: [], inalteradas: 0 };
  for (const { atual, gravada } of itens) {
    if (!atual) mudancas.novas.push(gravada);
    else if (mudou(atual, gravada))
      mudancas.alteradas.push({ ...gravada, id: atual.id });
    else mudancas.inalteradas++;
  }
  return mudancas;
}

/** Compara o arquivo com o banco: o que criar, o que atualizar e o que fica igual. */
function planejarImportacao(
  estado: EstadoHierarquia,
  linhas: LinhaValida[],
): PlanoImportacao {
  const arquivo = lerEntidades(linhas);
  const redesAtuais = porChave(estado.redes);
  const discipuladoresAtuais = porChave(estado.discipuladores);
  const celulasAtuais = porChave(estado.celulas);
  const chavePorId = (itens: { id: number; nome: string }[]) => {
    const mapa = new Map(
      itens.map((item) => [item.id, chaveDeNome(item.nome)]),
    );
    return (id: number) => mapa.get(id);
  };
  const chaveDaRede = chavePorId(estado.redes);
  const chaveDoDiscipulador = chavePorId(estado.discipuladores);

  const redes = classificar(
    [...arquivo.redes.values()].map((rede) => {
      const atual = redesAtuais.get(rede.chave);
      return {
        atual,
        gravada: {
          nome: rede.nome,
          divisao: rede.divisao,
          responsavel_nome:
            rede.responsavel === undefined
              ? (atual?.responsavel_nome ?? null)
              : rede.responsavel,
        },
      };
    }),
    (atual, gravada) =>
      atual.nome !== gravada.nome ||
      atual.divisao !== gravada.divisao ||
      atual.responsavel_nome !== gravada.responsavel_nome,
  );

  const discipuladores = classificar(
    [...arquivo.discipuladores.values()].map((discipulador) => ({
      atual: discipuladoresAtuais.get(discipulador.chave),
      gravada: { nome: discipulador.nome, rede_nome: discipulador.rede.nome },
    })),
    (atual, gravada) =>
      atual.nome !== gravada.nome ||
      chaveDaRede(atual.rede_id) !== chaveDeNome(gravada.rede_nome),
  );

  const celulas = classificar(
    [...arquivo.celulas.values()].map(({ chave, dados, discipulador }) => {
      const atual = celulasAtuais.get(chave);
      return {
        atual,
        gravada: {
          nome: dados.celula,
          discipulador_nome: discipulador.nome,
          qtd_pessoas: dados.qtd_pessoas,
          lider_nome: dados.lider_nome,
          lider_email:
            dados.lider_email === undefined
              ? (atual?.lider_email ?? null)
              : dados.lider_email,
          lider_telefone:
            dados.lider_telefone === undefined
              ? (atual?.lider_telefone ?? null)
              : dados.lider_telefone,
        },
      };
    }),
    (atual, gravada) =>
      atual.nome !== gravada.nome ||
      chaveDoDiscipulador(atual.discipulador_id) !==
        chaveDeNome(gravada.discipulador_nome) ||
      atual.qtd_pessoas !== gravada.qtd_pessoas ||
      atual.lider_nome !== gravada.lider_nome ||
      atual.lider_email !== gravada.lider_email ||
      atual.lider_telefone !== gravada.lider_telefone,
  );

  return {
    erros: arquivo.erros,
    avisos: arquivo.avisos,
    redes,
    discipuladores,
    celulas,
  };
}

async function carregarEstado(db: D1Database): Promise<EstadoHierarquia> {
  const [redes, discipuladores, celulas] = await db.batch([
    db.prepare(
      "SELECT id, nome, divisao, responsavel_nome FROM redes ORDER BY id",
    ),
    db.prepare("SELECT id, nome, rede_id FROM discipuladores ORDER BY id"),
    db.prepare(
      `SELECT id, nome, discipulador_id, qtd_pessoas, lider_nome, lider_email, lider_telefone
       FROM celulas ORDER BY id`,
    ),
  ]);
  return {
    redes: redes.results as EstadoHierarquia["redes"],
    discipuladores:
      discipuladores.results as EstadoHierarquia["discipuladores"],
    celulas: celulas.results as EstadoHierarquia["celulas"],
  };
}

/*
 * Cada instrução recebe até ITENS_POR_INSTRUCAO itens num único parâmetro JSON (json_each): mesmo com o
 * limite de 2000 linhas, o lote fica com poucas instruções, longe dos limites do D1 (consultas por
 * invocação, 100 parâmetros por consulta e 2 MB por valor). A ordem importa: redes, depois
 * discipuladores, depois células (as FKs são resolvidas pelo nome do pai, já gravado).
 */
const ITENS_POR_INSTRUCAO = 500;
const campo = (nome: string) => `json_extract(j.value, '$.${nome}')`;
const ID_DA_REDE = `(SELECT r.id FROM redes AS r WHERE r.nome = ${campo("rede_nome")})`;
const ID_DO_DISCIPULADOR = `(SELECT d.id FROM discipuladores AS d WHERE d.nome = ${campo("discipulador_nome")})`;

const INSERIR_REDES = `INSERT INTO redes (nome, divisao, responsavel_nome)
  SELECT ${campo("nome")}, ${campo("divisao")}, ${campo("responsavel_nome")} FROM json_each(?1) AS j`;
const ATUALIZAR_REDES = `UPDATE redes SET nome = ${campo("nome")}, divisao = ${campo("divisao")},
    responsavel_nome = ${campo("responsavel_nome")}, atualizado_em = ${AGORA}
  FROM json_each(?1) AS j WHERE redes.id = ${campo("id")}`;
const INSERIR_DISCIPULADORES = `INSERT INTO discipuladores (rede_id, nome)
  SELECT ${ID_DA_REDE}, ${campo("nome")} FROM json_each(?1) AS j`;
const ATUALIZAR_DISCIPULADORES = `UPDATE discipuladores SET rede_id = ${ID_DA_REDE},
    nome = ${campo("nome")}, atualizado_em = ${AGORA}
  FROM json_each(?1) AS j WHERE discipuladores.id = ${campo("id")}`;
const INSERIR_CELULAS = `INSERT INTO celulas
    (discipulador_id, nome, qtd_pessoas, lider_nome, lider_email, lider_telefone)
  SELECT ${ID_DO_DISCIPULADOR}, ${campo("nome")}, ${campo("qtd_pessoas")}, ${campo("lider_nome")},
    ${campo("lider_email")}, ${campo("lider_telefone")}
  FROM json_each(?1) AS j`;
const ATUALIZAR_CELULAS = `UPDATE celulas SET discipulador_id = ${ID_DO_DISCIPULADOR},
    nome = ${campo("nome")}, qtd_pessoas = ${campo("qtd_pessoas")}, lider_nome = ${campo("lider_nome")},
    lider_email = ${campo("lider_email")}, lider_telefone = ${campo("lider_telefone")},
    atualizado_em = ${AGORA}
  FROM json_each(?1) AS j WHERE celulas.id = ${campo("id")}`;

/**
 * O que a importação aplicada mudou, para a trilha de auditoria (RIFA-013b): só contagens, nunca nomes
 * (de células e de líderes) nem contatos.
 */
function resumirImportacao(
  plano: PlanoImportacao,
  totalLinhas: number,
): string {
  const texto = ({ redes, discipuladores, celulas }: Contagem) =>
    `${redes} redes, ${discipuladores} discipuladores e ${celulas} células`;
  return `Importação aplicada (${totalLinhas} linhas): criados ${texto(contagem(plano, "novas"))}; atualizados ${texto(contagem(plano, "alteradas"))}`;
}

/**
 * Grava o plano num único lote (transação do D1): se uma instrução falha, nada fica gravado. Com
 * `registro`, a trilha de auditoria vai no mesmo lote (RIFA-013b), mesmo sem mudança nenhuma.
 */
async function gravarPlano(
  db: D1Database,
  plano: PlanoImportacao,
  registro?: D1PreparedStatement,
): Promise<Resultado<null>> {
  const lotes: [string, unknown[]][] = [
    [INSERIR_REDES, plano.redes.novas],
    [ATUALIZAR_REDES, plano.redes.alteradas],
    [INSERIR_DISCIPULADORES, plano.discipuladores.novas],
    [ATUALIZAR_DISCIPULADORES, plano.discipuladores.alteradas],
    [INSERIR_CELULAS, plano.celulas.novas],
    [ATUALIZAR_CELULAS, plano.celulas.alteradas],
  ];
  const instrucoes = lotes.flatMap(([sql, itens]) => {
    const partes: D1PreparedStatement[] = [];
    for (let i = 0; i < itens.length; i += ITENS_POR_INSTRUCAO)
      partes.push(
        db
          .prepare(sql)
          .bind(JSON.stringify(itens.slice(i, i + ITENS_POR_INSTRUCAO))),
      );
    return partes;
  });
  if (registro) instrucoes.push(registro);
  if (instrucoes.length === 0) return { ok: true, valor: null };
  try {
    await db.batch(instrucoes);
  } catch (erro) {
    if (!violou(erro, "UNIQUE")) throw erro;
    return falha(
      "nome_duplicado",
      "Outra alteração feita ao mesmo tempo já usa um destes nomes. Nada foi gravado: importe o arquivo de novo.",
    );
  }
  return { ok: true, valor: null };
}

function contagem(
  plano: PlanoImportacao,
  tipo: "novas" | "alteradas",
): Contagem {
  return {
    redes: plano.redes[tipo].length,
    discipuladores: plano.discipuladores[tipo].length,
    celulas: plano.celulas[tipo].length,
  };
}

/**
 * Palavras de cabeçalhos feitos à mão → palavras das colunas, para sugerir a coluna certa quando o nome
 * não é o do modelo (ex.: "Celular do líder" → lider_telefone; "Quantidade de pessoas" → qtd_pessoas).
 */
const SINONIMOS_COLUNAS: Readonly<Record<string, string>> = {
  quantidade: "qtd",
  qtde: "qtd",
  quant: "qtd",
  numero: "qtd",
  num: "qtd",
  n: "qtd",
  membros: "pessoas",
  integrantes: "pessoas",
  participantes: "pessoas",
  pessoa: "pessoas",
  mail: "email",
  fone: "telefone",
  tel: "telefone",
  celular: "telefone",
  whatsapp: "telefone",
  zap: "telefone",
  pastor: "responsavel",
  pastora: "responsavel",
  obreiro: "responsavel",
  obreira: "responsavel",
  lideres: "lider",
  discipuladora: "discipulador",
  discipuladores: "discipulador",
  redes: "rede",
  celulas: "celula",
  divisoes: "divisao",
};

function avisoDeColunaIgnorada(
  linha: number,
  { nome, sugestao }: ColunaIgnorada<ColunaCsvHierarquia>,
): AvisoImportacao {
  const ignorada = `Coluna "${nome}" ignorada: não é uma coluna do modelo`;
  return {
    tipo: "coluna_ignorada",
    linha,
    mensagem:
      sugestao === null
        ? ignorada
        : `${ignorada}. Você quis dizer "${sugestao}"?`,
  };
}

/**
 * POST /api/admin/hierarquia/importar. Valida cada linha (linhaCsvHierarquiaSchema), confere a coerência
 * do arquivo e compara com o banco pela chave de nome. Grava só se nenhuma linha tiver erro e `simular`
 * for false; caso contrário, devolve o mesmo relatório sem gravar nada. Colunas ignoradas e linhas
 * repetidas iguais saem em `avisos`. Com `autoria` (RIFA-013b), a importação APLICADA deixa na trilha de
 * auditoria quem importou e as contagens, no mesmo lote da gravação; a simulação não registra nada.
 */
export async function importarHierarquia(
  db: D1Database,
  csv: string,
  simular: boolean,
  autoria?: Autoria,
): Promise<Resultado<RespostaImportarHierarquia>> {
  const tabela = lerTabelaCsv(csv, {
    colunas: COLUNAS_CSV_HIERARQUIA,
    obrigatorias: COLUNAS_CSV_HIERARQUIA_OBRIGATORIAS,
    limiteLinhas: LIMITE_LINHAS_CSV_HIERARQUIA,
    sinonimos: SINONIMOS_COLUNAS,
  });
  if (!tabela.ok)
    return falha("csv_invalido", tabela.mensagem, tabela.detalhes);

  const validas: LinhaValida[] = [];
  const erros: ErroLinha[] = [];
  for (const { linha, valores } of tabela.linhas) {
    const leitura = linhaCsvHierarquiaSchema.safeParse(valores, {
      error: mensagemDeCelula,
    });
    if (leitura.success) validas.push({ linha, dados: leitura.data });
    else erros.push(...errosDeValidacao(linha, leitura.error.issues));
  }

  const plano = planejarImportacao(await carregarEstado(db), validas);
  erros.push(...plano.erros);
  erros.sort((a, b) => a.linha - b.linha);

  const aplicado = erros.length === 0 && !simular;
  if (aplicado) {
    const registro =
      autoria &&
      prepararRegistroAuditoria(db, {
        ...autoria,
        acao: "hierarquia.importar",
        alvo: "hierarquia",
        resumo: resumirImportacao(plano, tabela.linhas.length),
      });
    const gravacao = await gravarPlano(db, plano, registro);
    if (!gravacao.ok) return gravacao;
  }
  return {
    ok: true,
    valor: {
      aplicado,
      simulado: simular,
      total_linhas: tabela.linhas.length,
      criados: contagem(plano, "novas"),
      atualizados: contagem(plano, "alteradas"),
      inalterados: {
        redes: plano.redes.inalteradas,
        discipuladores: plano.discipuladores.inalteradas,
        celulas: plano.celulas.inalteradas,
      },
      erros,
      avisos: [
        ...tabela.ignoradas.map((ignorada) =>
          avisoDeColunaIgnorada(tabela.cabecalho, ignorada),
        ),
        ...plano.avisos,
      ],
    },
  };
}
