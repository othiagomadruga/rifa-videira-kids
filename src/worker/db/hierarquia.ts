/**
 * Hierarquia da igreja no D1: rede (divisão jovens|adultos) → discipulador → célula.
 *
 * - CRUD das três entidades com as regras do contrato (docs/api.md): nomes únicos sem diferenciar
 *   maiúsculas (inclusive acentuadas) e ignorando espaços nas pontas; id inexistente no corpo =
 *   `referencia_invalida`; excluir algo referenciado = `em_uso` (as FKs são RESTRICT).
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
  type Celula,
  type CodigoErro,
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
import { lerTabelaCsv, mensagemDeCelula } from "../lib/csv";

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
 * Chave de comparação de nomes (CRUD e importação): sem os espaços das pontas e sem diferenciar
 * maiúsculas, inclusive acentuadas ("CÉLULA" = "célula"). Acentos continuam contando ("Célula" ≠ "Celula").
 */
export function chaveDeNome(nome: string): string {
  return nome.trim().normalize("NFC").toLowerCase();
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
// Gravação (POST e PUT)
// ---------------------------------------------------------------------------------------------------

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

/**
 * Regras comuns de POST e PUT: o registro existe (PUT), a referência existe, o nome está livre. Depois
 * grava e relê o item. Violação de UNIQUE ou de FK que escape das checagens (corrida) vira o mesmo erro.
 */
async function salvar<T>(
  db: D1Database,
  tabela: Tabela,
  opcoes: {
    id?: number;
    nome: string;
    referencia?: Referencia;
    gravar: () => Promise<number>;
    reler: (db: D1Database, id: number) => Promise<T | null>;
  },
): Promise<Resultado<T>> {
  const { id, referencia } = opcoes;
  if (id !== undefined && !(await existe(db, tabela, id)))
    return falha("nao_encontrado", TEXTOS[tabela].naoEncontrado);
  if (referencia && !(await existe(db, referencia.tabela, referencia.id)))
    return referenciaInvalida(referencia);
  if (await nomeEmUso(db, tabela, opcoes.nome, id))
    return falha("nome_duplicado", TEXTOS[tabela].duplicado);

  let gravado: number;
  try {
    gravado = await opcoes.gravar();
  } catch (erro) {
    if (violou(erro, "UNIQUE"))
      return falha("nome_duplicado", TEXTOS[tabela].duplicado);
    if (referencia && violou(erro, "FOREIGN KEY"))
      return referenciaInvalida(referencia);
    throw erro;
  }
  return encontrado(await opcoes.reler(db, gravado), tabela);
}

async function inserir(
  db: D1Database,
  sql: string,
  valores: unknown[],
): Promise<number> {
  const linha = await db
    .prepare(`${sql} RETURNING id`)
    .bind(...valores)
    .first<{ id: number }>();
  if (linha === null) throw new Error("INSERT sem RETURNING id");
  return linha.id;
}

async function atualizar(
  db: D1Database,
  sql: string,
  valores: unknown[],
  id: number,
): Promise<number> {
  await db
    .prepare(sql)
    .bind(...valores, id)
    .run();
  return id;
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

const valoresRede = (dados: DadosRede) => [
  dados.nome,
  dados.divisao,
  dados.responsavel_nome,
];
const valoresDiscipulador = (dados: DadosDiscipulador) => [
  dados.rede_id,
  dados.nome,
];
const valoresCelula = (dados: DadosCelula) => [
  dados.discipulador_id,
  dados.nome,
  dados.qtd_pessoas,
  dados.lider_nome,
  dados.lider_email,
  dados.lider_telefone,
];

const INSERIR_REDE =
  "INSERT INTO redes (nome, divisao, responsavel_nome) VALUES (?, ?, ?)";
const ATUALIZAR_REDE = `UPDATE redes SET nome = ?, divisao = ?, responsavel_nome = ?,
  atualizado_em = ${AGORA} WHERE id = ?`;
const INSERIR_DISCIPULADOR =
  "INSERT INTO discipuladores (rede_id, nome) VALUES (?, ?)";
const ATUALIZAR_DISCIPULADOR = `UPDATE discipuladores SET rede_id = ?, nome = ?,
  atualizado_em = ${AGORA} WHERE id = ?`;
const INSERIR_CELULA = `INSERT INTO celulas
  (discipulador_id, nome, qtd_pessoas, lider_nome, lider_email, lider_telefone)
  VALUES (?, ?, ?, ?, ?, ?)`;
const ATUALIZAR_CELULA = `UPDATE celulas SET discipulador_id = ?, nome = ?, qtd_pessoas = ?,
  lider_nome = ?, lider_email = ?, lider_telefone = ?, atualizado_em = ${AGORA} WHERE id = ?`;

export function criarRede(
  db: D1Database,
  dados: DadosRede,
): Promise<Resultado<Rede>> {
  return salvar(db, "redes", {
    nome: dados.nome,
    gravar: () => inserir(db, INSERIR_REDE, valoresRede(dados)),
    reler: buscarRede,
  });
}

export function atualizarRede(
  db: D1Database,
  id: number,
  dados: DadosRede,
): Promise<Resultado<Rede>> {
  return salvar(db, "redes", {
    id,
    nome: dados.nome,
    gravar: () => atualizar(db, ATUALIZAR_REDE, valoresRede(dados), id),
    reler: buscarRede,
  });
}

export function criarDiscipulador(
  db: D1Database,
  dados: DadosDiscipulador,
): Promise<Resultado<Discipulador>> {
  return salvar(db, "discipuladores", {
    nome: dados.nome,
    referencia: referenciaRede(dados.rede_id),
    gravar: () => inserir(db, INSERIR_DISCIPULADOR, valoresDiscipulador(dados)),
    reler: buscarDiscipulador,
  });
}

export function atualizarDiscipulador(
  db: D1Database,
  id: number,
  dados: DadosDiscipulador,
): Promise<Resultado<Discipulador>> {
  return salvar(db, "discipuladores", {
    id,
    nome: dados.nome,
    referencia: referenciaRede(dados.rede_id),
    gravar: () =>
      atualizar(db, ATUALIZAR_DISCIPULADOR, valoresDiscipulador(dados), id),
    reler: buscarDiscipulador,
  });
}

export function criarCelula(
  db: D1Database,
  dados: DadosCelula,
): Promise<Resultado<Celula>> {
  return salvar(db, "celulas", {
    nome: dados.nome,
    referencia: referenciaDiscipulador(dados.discipulador_id),
    gravar: () => inserir(db, INSERIR_CELULA, valoresCelula(dados)),
    reler: buscarCelula,
  });
}

export function atualizarCelula(
  db: D1Database,
  id: number,
  dados: DadosCelula,
): Promise<Resultado<Celula>> {
  return salvar(db, "celulas", {
    id,
    nome: dados.nome,
    referencia: referenciaDiscipulador(dados.discipulador_id),
    gravar: () => atualizar(db, ATUALIZAR_CELULA, valoresCelula(dados), id),
    reler: buscarCelula,
  });
}

// ---------------------------------------------------------------------------------------------------
// Exclusão (DELETE): sem cascata; a FK RESTRICT do banco decide se está em uso
// ---------------------------------------------------------------------------------------------------

interface Dependentes {
  tabela: "discipuladores" | "celulas" | "afiliados";
  coluna: "rede_id" | "discipulador_id" | "celula_id";
  mensagem: (quantidade: number) => string;
}

async function remover(
  db: D1Database,
  tabela: Tabela,
  id: number,
  dependentes: Dependentes,
): Promise<Resultado<null>> {
  try {
    const { meta } = await db
      .prepare(`DELETE FROM ${tabela} WHERE id = ?`)
      .bind(id)
      .run();
    return meta.changes > 0
      ? { ok: true, valor: null }
      : falha("nao_encontrado", TEXTOS[tabela].naoEncontrado);
  } catch (erro) {
    if (!violou(erro, "FOREIGN KEY")) throw erro;
    const linha = await db
      .prepare(
        `SELECT count(*) AS total FROM ${dependentes.tabela} WHERE ${dependentes.coluna} = ?`,
      )
      .bind(id)
      .first<{ total: number }>();
    return falha("em_uso", dependentes.mensagem(linha?.total ?? 0));
  }
}

export function removerRede(
  db: D1Database,
  id: number,
): Promise<Resultado<null>> {
  return remover(db, "redes", id, {
    tabela: "discipuladores",
    coluna: "rede_id",
    mensagem: (quantidade) =>
      `A rede tem discipuladores (${quantidade}). Exclua os discipuladores ou mova-os para outra rede antes de excluir a rede.`,
  });
}

export function removerDiscipulador(
  db: D1Database,
  id: number,
): Promise<Resultado<null>> {
  return remover(db, "discipuladores", id, {
    tabela: "celulas",
    coluna: "discipulador_id",
    mensagem: (quantidade) =>
      `O discipulador tem células (${quantidade}). Exclua as células ou mova-as para outro discipulador antes de excluir o discipulador.`,
  });
}

export function removerCelula(
  db: D1Database,
  id: number,
): Promise<Resultado<null>> {
  return remover(db, "celulas", id, {
    tabela: "afiliados",
    coluna: "celula_id",
    mensagem: (quantidade) =>
      `A célula tem afiliados vinculados (${quantidade}). Desvincule os afiliados antes de excluir a célula.`,
  });
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
 * Confere a coerência do arquivo e monta as entidades. Uma linha que contradiz outra anterior (rede com
 * outra divisão ou outro responsável, discipulador em outra rede, célula repetida) vira erro e fica de fora.
 */
function lerEntidades(linhas: LinhaValida[]) {
  const redes = new Map<string, RedeDoArquivo>();
  const discipuladores = new Map<string, DiscipuladorDoArquivo>();
  const celulas = new Map<string, CelulaDoArquivo>();
  const erros: ErroLinha[] = [];

  for (const { linha, dados } of linhas) {
    const chaveRede = chaveDeNome(dados.rede);
    const chaveDiscipulador = chaveDeNome(dados.discipulador);
    const chaveCelula = chaveDeNome(dados.celula);
    const rede = redes.get(chaveRede);
    const discipulador = discipuladores.get(chaveDiscipulador);
    const celula = celulas.get(chaveCelula);
    const responsavel = dados.rede_responsavel;

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
        mensagem: `A célula "${celula.dados.celula}" já aparece na linha ${celula.linha}`,
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
  return { redes, discipuladores, celulas, erros };
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

  return { erros: arquivo.erros, redes, discipuladores, celulas };
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

/** Grava o plano num único lote (transação do D1): se uma instrução falha, nada fica gravado. */
async function gravarPlano(
  db: D1Database,
  plano: PlanoImportacao,
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
 * POST /api/admin/hierarquia/importar. Valida cada linha (linhaCsvHierarquiaSchema), confere a coerência
 * do arquivo e compara com o banco pela chave de nome. Grava só se nenhuma linha tiver erro e `simular`
 * for false; caso contrário, devolve o mesmo relatório sem gravar nada.
 */
export async function importarHierarquia(
  db: D1Database,
  csv: string,
  simular: boolean,
): Promise<Resultado<RespostaImportarHierarquia>> {
  const tabela = lerTabelaCsv(csv, {
    colunas: COLUNAS_CSV_HIERARQUIA,
    obrigatorias: COLUNAS_CSV_HIERARQUIA_OBRIGATORIAS,
    limiteLinhas: LIMITE_LINHAS_CSV_HIERARQUIA,
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
    const gravacao = await gravarPlano(db, plano);
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
    },
  };
}
