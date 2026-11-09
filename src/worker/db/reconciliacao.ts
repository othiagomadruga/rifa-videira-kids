/**
 * Conferência pelo CSV da Rifei (RIFA-012; docs/api.md e docs/integracao-rifei.md, seção 10): o que a
 * análise lê do banco, a gravação do "Recuperar" e a lista das recuperações feitas (auditoria).
 *
 * CPU (o Worker do plano Free tem 10 ms por requisição): o banco faz o trabalho pesado. Os códigos do
 * arquivo vão num parâmetro JSON (json_each) e voltam só os pedidos com esses códigos, cada lote num texto
 * JSON único (json_group_array: uma linha, em vez de milhares de objetos para o Worker montar); os pagos
 * que o arquivo não tem, os totais e o modo sem código chegam já contados e somados (GROUP BY).
 *
 * Nada do arquivo chega aqui além dos códigos e, no "Recuperar", do pedido recuperado (código, quantidade,
 * valor, afiliado e instante) e, na auditoria, do SHA-256 do arquivo e dos nomes das colunas usadas (D1).
 *
 * Gravação (um único db.batch, que o D1 roda numa transação: tudo ou nada):
 * 1. a linha da auditoria em `recuperacoes`;
 * 2. os afiliados novos (fila de órfãos, como os do webhook: origem 'webhook' = apareceu numa venda);
 * 3. os pedidos, com INSERT ... ON CONFLICT (id) DO NOTHING: um pedido que já existe (inclusive um que o
 *    webhook gravou depois da pré-visualização) nunca é sobrescrito, e repetir a mesma recuperação não
 *    duplica nada (idempotente). Cada pedido leva `origem = 'conferencia'` e o id da auditoria;
 * 4. as contagens da auditoria, tiradas dos pedidos que de fato entraram;
 * 5. a linha da trilha de auditoria da coordenação (`auditoria`, ação `conferencia.recuperar`, alvo
 *    `campanha:<id>`), só se algum pedido entrou;
 * 6. a lista desses pedidos;
 * 7. se nada entrou, a auditoria da recuperação é apagada (não houve mudança a registrar).
 * O id da auditoria é o maior de `recuperacoes` dentro do lote: o D1 serializa as escritas, então nenhuma
 * outra gravação entra no meio da transação.
 */
import {
  LIMITE_ITENS_POR_DIVERGENCIA,
  type AcaoAuditoria,
  type CampoReconciliacao,
  type ColunasDoCorpo,
  type PedidoRecuperado,
  type Recuperacao,
  type TotaisVendas,
} from "../../shared/contracts";
import type {
  Acumulado,
  AfiliadoGravado,
  AusentesDoArquivo,
  PedidoGravado,
} from "../lib/conferencia-analise";

const SELECIONAR_AFILIADOS = `
  SELECT a.affiliate_id, a.rotulo, a.celula_id, c.nome AS celula_nome
  FROM afiliados AS a
  LEFT JOIN celulas AS c ON c.id = a.celula_id`;

/**
 * Códigos por comando: a resposta de cada um é um texto JSON só (a tupla curta tem ~50 bytes; com o
 * código de 128 caracteres, ~180), bem abaixo do limite de 2 MB por valor do D1.
 */
const CODIGOS_POR_COMANDO = 8_000;

/**
 * O pedido como tupla curta, na ordem de `tupla()`: status e origem como números (STATUS_DA_TUPLA e
 * ORIGENS_DA_TUPLA) e `aprovado_em` em ms (segundos do strftime mais os milissegundos do texto). Com 7 mil
 * pedidos, a resposta do D1 cai de ~520 KB para ~330 KB: menos JSON para o Worker ler.
 */
const COLUNAS_DO_PEDIDO = `json_array(p.id, p.campanha_id,
  CASE p.status WHEN 'approved' THEN 1 WHEN 'expired' THEN 2 ELSE 0 END,
  p.qtd_bilhetes, p.total_centavos, p.affiliate_id,
  CAST(strftime('%s', p.aprovado_em) AS INTEGER) * 1000 + CAST(substr(p.aprovado_em, 21, 3) AS INTEGER),
  CASE p.origem WHEN 'conferencia' THEN 1 ELSE 0 END)`;

const STATUS_DA_TUPLA: readonly PedidoGravado["status"][] = [
  "in_process",
  "approved",
  "expired",
];
const ORIGENS_DA_TUPLA: readonly PedidoGravado["origem"][] = [
  "webhook",
  "conferencia",
];

type TuplaDoPedido = [
  string,
  number,
  number,
  number,
  number,
  number | null,
  number | null,
  number,
];

const tupla = (linha: TuplaDoPedido): PedidoGravado => ({
  id: linha[0],
  campanha_id: linha[1],
  status: STATUS_DA_TUPLA[linha[2]],
  qtd_bilhetes: linha[3],
  total_centavos: linha[4],
  affiliate_id: linha[5],
  aprovado_ms: linha[6],
  origem: ORIGENS_DA_TUPLA[linha[7]],
});

/** Os pedidos (de qualquer campanha) com os códigos do lote, como um texto JSON de tuplas. */
const SELECIONAR_ENCONTRADOS = `
  SELECT json_group_array(${COLUNAS_DO_PEDIDO}) AS linhas
  FROM json_each(?1) AS j
  JOIN pedidos AS p ON p.id = j.value`;

const PAGOS_DA_CAMPANHA = "p.campanha_id = ?1 AND p.status = 'approved'";
/** Com o período do arquivo em ?2 e ?3 (UTC, `[inicio, fim)`); null nos dois = sem recorte. */
const NO_PERIODO =
  "(?2 IS NULL OR (p.aprovado_em >= ?2 AND p.aprovado_em < ?3))";
const SOMAS = `count(*) AS pedidos, coalesce(sum(p.qtd_bilhetes), 0) AS bilhetes,
  coalesce(sum(p.total_centavos), 0) AS centavos`;

const CONTAR_PAGOS_NO_PERIODO = `
  SELECT count(*) AS pedidos FROM pedidos AS p WHERE ${PAGOS_DA_CAMPANHA} AND ${NO_PERIODO}`;

const SOMAR_PAGOS = `SELECT ${SOMAS} FROM pedidos AS p WHERE ${PAGOS_DA_CAMPANHA}`;

/** Pagos da campanha que o arquivo não tem (?2: TODOS os códigos do arquivo, em JSON). */
const FORA_DO_ARQUIVO = "p.id NOT IN (SELECT value FROM json_each(?2))";

/** Aprovado fora do período do arquivo (?3 e ?4; sem período, nenhum). */
const FORA_DO_PERIODO = `?3 IS NOT NULL AND p.aprovado_em IS NOT NULL
  AND (p.aprovado_em < ?3 OR p.aprovado_em >= ?4)`;

/** Os ausentes somados e quantos deles são de dias que o arquivo não cobre. */
const SOMAR_AUSENTES = `
  SELECT ${SOMAS}, coalesce(sum(CASE WHEN ${FORA_DO_PERIODO} THEN 1 ELSE 0 END), 0) AS fora
  FROM pedidos AS p WHERE ${PAGOS_DA_CAMPANHA} AND ${FORA_DO_ARQUIVO}`;

/** Os primeiros ausentes (?5), com `fora`: aprovado fora do período do arquivo (?3 e ?4). */
const LISTAR_AUSENTES = `
  SELECT json_group_array(json_array(json(t.pedido), t.fora)) AS linhas
  FROM (
    SELECT ${COLUNAS_DO_PEDIDO} AS pedido,
      CASE WHEN ${FORA_DO_PERIODO} THEN 1 ELSE 0 END AS fora
    FROM pedidos AS p
    WHERE ${PAGOS_DA_CAMPANHA} AND ${FORA_DO_ARQUIVO}
    ORDER BY p.id
    LIMIT ?5
  ) AS t`;

type Somas = { pedidos: number; bilhetes: number; centavos: number };

const totais = (linha: Somas | undefined): TotaisVendas => ({
  pedidos_aprovados: linha?.pedidos ?? 0,
  bilhetes: linha?.bilhetes ?? 0,
  total_centavos: linha?.centavos ?? 0,
});

/** Os códigos em lotes de JSON (cada um vira um comando de SELECIONAR_ENCONTRADOS); `todos` = um lote só. */
function lotesDeCodigos(codigos: readonly string[], todos: string): string[] {
  if (codigos.length <= CODIGOS_POR_COMANDO) return [todos];
  const lotes: string[] = [];
  for (let i = 0; i < codigos.length; i += CODIGOS_POR_COMANDO)
    lotes.push(JSON.stringify(codigos.slice(i, i + CODIGOS_POR_COMANDO)));
  return lotes;
}

/** O texto JSON de um json_group_array (a primeira coluna `linhas` da primeira linha). */
function linhasDoTexto<T>(resultado: D1Result | undefined): T[] {
  const texto = (resultado?.results[0] as { linhas?: string } | undefined)
    ?.linhas;
  return typeof texto === "string" ? (JSON.parse(texto) as T[]) : [];
}

export interface LeituraPorPedido {
  afiliados: AfiliadoGravado[];
  encontrados: Map<string, PedidoGravado>;
  pagosNoPeriodo: number;
  /** Só com `comAusentes` (análise); zerados no "Recuperar", que não precisa. */
  aprovados: TotaisVendas;
  ausentes: AusentesDoArquivo;
}

/**
 * Tudo o que o modo por pedido lê, num db.batch só: os afiliados, os pedidos com os códigos do arquivo,
 * quantos pagos da campanha há no período do arquivo e, na análise (`comAusentes`), os totais pagos e os
 * pagos que o arquivo não tem (contados e somados, mais os primeiros em ordem de código).
 */
export async function lerParaPorPedido(
  db: D1Database,
  consulta: {
    campanhaId: number;
    codigos: readonly string[];
    periodoUtc: { inicio: string; fim: string } | null;
    comAusentes: boolean;
  },
): Promise<LeituraPorPedido> {
  const { campanhaId, codigos, periodoUtc, comAusentes } = consulta;
  const todos = JSON.stringify(codigos);
  const lotes = lotesDeCodigos(codigos, todos);
  const inicio = periodoUtc?.inicio ?? null;
  const fim = periodoUtc?.fim ?? null;
  const comandos: D1PreparedStatement[] = [
    db.prepare(SELECIONAR_AFILIADOS),
    db.prepare(CONTAR_PAGOS_NO_PERIODO).bind(campanhaId, inicio, fim),
    ...lotes.map((lote) => db.prepare(SELECIONAR_ENCONTRADOS).bind(lote)),
  ];
  if (comAusentes) {
    comandos.push(
      db.prepare(SOMAR_PAGOS).bind(campanhaId),
      db.prepare(SOMAR_AUSENTES).bind(campanhaId, todos, inicio, fim),
      db
        .prepare(LISTAR_AUSENTES)
        .bind(campanhaId, todos, inicio, fim, LIMITE_ITENS_POR_DIVERGENCIA),
    );
  }
  const [afiliados, pagos, ...resto] = await db.batch(comandos);

  const encontrados = new Map<string, PedidoGravado>();
  for (const resultado of resto.slice(0, lotes.length))
    for (const linha of linhasDoTexto<TuplaDoPedido>(resultado)) {
      const pedido = tupla(linha);
      encontrados.set(pedido.id, pedido);
    }

  let aprovados = totais(undefined);
  let ausentes: AusentesDoArquivo = {
    quantidade: 0,
    bilhetes: 0,
    total_centavos: 0,
    fora_do_periodo: 0,
    itens: [],
  };
  if (comAusentes) {
    const [somaPagos, somaAusentes, listaAusentes] = resto.slice(lotes.length);
    aprovados = totais(somaPagos.results[0] as Somas | undefined);
    const linha = somaAusentes.results[0] as
      (Somas & { fora: number }) | undefined;
    const somados = totais(linha);
    ausentes = {
      quantidade: somados.pedidos_aprovados,
      bilhetes: somados.bilhetes,
      total_centavos: somados.total_centavos,
      fora_do_periodo: linha?.fora ?? 0,
      itens: linhasDoTexto<[TuplaDoPedido, number]>(listaAusentes).map(
        ([pedido, fora]) => ({ ...tupla(pedido), fora_do_periodo: fora === 1 }),
      ),
    };
  }

  return {
    afiliados: afiliados.results as unknown as AfiliadoGravado[],
    encontrados,
    pagosNoPeriodo:
      (pagos.results[0] as { pedidos: number } | undefined)?.pedidos ?? 0,
    aprovados,
    ausentes,
  };
}

const SOMAR_PAGOS_NO_PERIODO = `
  SELECT ${SOMAS} FROM pedidos AS p WHERE ${PAGOS_DA_CAMPANHA} AND ${NO_PERIODO}`;

const SOMAR_POR_AFILIADO = `
  SELECT p.affiliate_id, ${SOMAS} FROM pedidos AS p
  WHERE ${PAGOS_DA_CAMPANHA} AND ${NO_PERIODO}
  GROUP BY p.affiliate_id`;

/** Por dia local: ?4 é o deslocamento do fuso para o date() do SQLite ("-180 minutes"). */
const SOMAR_POR_DIA = `
  SELECT date(p.aprovado_em, ?4) AS dia, ${SOMAS} FROM pedidos AS p
  WHERE ${PAGOS_DA_CAMPANHA} AND ${NO_PERIODO} AND p.aprovado_em IS NOT NULL
  GROUP BY dia`;

const acumulado = (linha: Somas | undefined): Acumulado => ({
  pedidos: linha?.pedidos ?? 0,
  bilhetes: linha?.bilhetes ?? 0,
  centavos: linha?.centavos ?? 0,
});

/**
 * O modo sem código: os afiliados e os pagos da campanha (no período do arquivo, se ele tem datas), no
 * total, por afiliado e, com `deslocamento` (o modificador do date() do SQLite), por dia local.
 */
export async function lerParaAgregado(
  db: D1Database,
  consulta: {
    campanhaId: number;
    periodoUtc: { inicio: string; fim: string } | null;
    deslocamento: string | null;
  },
): Promise<{
  afiliados: AfiliadoGravado[];
  total: Acumulado;
  porAfiliado: { affiliate_id: number | null; soma: Acumulado }[];
  porDia: { dia: string; soma: Acumulado }[] | null;
}> {
  const { campanhaId, periodoUtc, deslocamento } = consulta;
  const inicio = periodoUtc?.inicio ?? null;
  const fim = periodoUtc?.fim ?? null;
  const comandos = [
    db.prepare(SELECIONAR_AFILIADOS),
    db.prepare(SOMAR_PAGOS_NO_PERIODO).bind(campanhaId, inicio, fim),
    db.prepare(SOMAR_POR_AFILIADO).bind(campanhaId, inicio, fim),
  ];
  if (deslocamento !== null)
    comandos.push(
      db.prepare(SOMAR_POR_DIA).bind(campanhaId, inicio, fim, deslocamento),
    );
  const [afiliados, total, porAfiliado, porDia] = await db.batch(comandos);
  return {
    afiliados: afiliados.results as unknown as AfiliadoGravado[],
    total: acumulado(total.results[0] as Somas | undefined),
    porAfiliado: (
      porAfiliado.results as (Somas & { affiliate_id: number | null })[]
    ).map((linha) => ({
      affiliate_id: linha.affiliate_id,
      soma: acumulado(linha),
    })),
    porDia:
      porDia === undefined
        ? null
        : (porDia.results as (Somas & { dia: string })[]).map((linha) => ({
            dia: linha.dia,
            soma: acumulado(linha),
          })),
  };
}

export interface GravacaoRecuperacao {
  campanhaId: number;
  usuarioId: number;
  executadoEm: string;
  pedidosSolicitados: number;
  linhasArquivo: number;
  arquivoSha256: string;
  /** Nome da coluna usada em cada campo. */
  colunas: ColunasDoCorpo;
  pedidos: readonly PedidoRecuperado[];
}

/** Tamanho máximo (em caracteres) do JSON de pedidos num comando: o D1 limita o tamanho de um valor. */
const LIMITE_JSON_POR_COMANDO = 400_000;

/** Os pedidos em pedaços de JSON pequenos o bastante para um parâmetro do D1. */
function pedacosDePedidos(pedidos: readonly PedidoRecuperado[]): string[] {
  const pedacos: string[] = [];
  let atual: string[] = [];
  let tamanho = 0;
  for (const pedido of pedidos) {
    const json = JSON.stringify({
      id: pedido.pedido_id,
      afiliado: pedido.affiliate_id,
      bilhetes: pedido.qtd_bilhetes,
      centavos: pedido.total_centavos,
      aprovado_em: pedido.aprovado_em,
    });
    if (atual.length > 0 && tamanho + json.length > LIMITE_JSON_POR_COMANDO) {
      pedacos.push(`[${atual.join(",")}]`);
      atual = [];
      tamanho = 0;
    }
    atual.push(json);
    tamanho += json.length + 1;
  }
  if (atual.length > 0) pedacos.push(`[${atual.join(",")}]`);
  return pedacos;
}

const ID_DA_RECUPERACAO = "(SELECT max(id) FROM recuperacoes)";

/**
 * Grava a recuperação num lote só (veja o topo do arquivo). Devolve o id da auditoria (null se nada
 * entrou) e os códigos que de fato foram gravados. Os números dos bilhetes não saem do navegador: o pedido
 * recuperado fica com `numeros` nulo.
 */
export async function gravarRecuperacao(
  db: D1Database,
  gravacao: GravacaoRecuperacao,
): Promise<{ recuperacaoId: number | null; gravados: Set<string> }> {
  const afiliados = [
    ...new Set(
      gravacao.pedidos.flatMap((pedido) =>
        pedido.affiliate_id === null ? [] : [pedido.affiliate_id],
      ),
    ),
  ];
  const comandos: D1PreparedStatement[] = [
    db
      .prepare(
        `INSERT INTO recuperacoes (campanha_id, usuario_id, executado_em, pedidos_solicitados,
           linhas_arquivo, arquivo_sha256, mapeamento)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)`,
      )
      .bind(
        gravacao.campanhaId,
        gravacao.usuarioId,
        gravacao.executadoEm,
        gravacao.pedidosSolicitados,
        gravacao.linhasArquivo,
        gravacao.arquivoSha256,
        JSON.stringify(gravacao.colunas),
      ),
    db
      .prepare(
        `INSERT INTO afiliados (affiliate_id, origem, criado_em, atualizado_em)
         SELECT DISTINCT value, 'webhook', ?2, ?2 FROM json_each(?1) WHERE true
         ON CONFLICT (affiliate_id) DO NOTHING`,
      )
      .bind(JSON.stringify(afiliados), gravacao.executadoEm),
    ...pedacosDePedidos(gravacao.pedidos).map((pedaco) =>
      db
        .prepare(
          `INSERT INTO pedidos (id, campanha_id, affiliate_id, status, qtd_bilhetes, total_centavos,
             aprovado_em, registrado_em, atualizado_em, origem, recuperacao_id)
           SELECT json_extract(j.value, '$.id'), ?1, json_extract(j.value, '$.afiliado'), 'approved',
             json_extract(j.value, '$.bilhetes'), json_extract(j.value, '$.centavos'),
             json_extract(j.value, '$.aprovado_em'), ?2, ?2, 'conferencia', ${ID_DA_RECUPERACAO}
           FROM json_each(?3) AS j WHERE true
           ON CONFLICT (id) DO NOTHING`,
        )
        .bind(gravacao.campanhaId, gravacao.executadoEm, pedaco),
    ),
    db.prepare(
      `UPDATE recuperacoes SET
         pedidos_recuperados = (SELECT count(*) FROM pedidos WHERE recuperacao_id = recuperacoes.id),
         bilhetes = (SELECT coalesce(sum(qtd_bilhetes), 0) FROM pedidos
           WHERE recuperacao_id = recuperacoes.id),
         total_centavos = (SELECT coalesce(sum(total_centavos), 0) FROM pedidos
           WHERE recuperacao_id = recuperacoes.id)
       WHERE id = ${ID_DA_RECUPERACAO}
       RETURNING id, pedidos_recuperados`,
    ),
    // A trilha de auditoria (RIFA-013b) no mesmo lote, só quando algum pedido entrou: o id da recuperação
    // e as contagens saem da linha dela, já com o que de fato foi gravado (nada do arquivo, nenhum código).
    db
      .prepare(
        `INSERT INTO auditoria (usuario_id, em, acao, alvo, resumo)
         SELECT ?1, ?2, ?3, ?4,
           'Recuperação ' || r.id || ' (conferência pelo CSV): ' || r.pedidos_recuperados
             || CASE r.pedidos_recuperados WHEN 1 THEN ' pedido' ELSE ' pedidos' END || ' e '
             || r.bilhetes || CASE r.bilhetes WHEN 1 THEN ' bilhete' ELSE ' bilhetes' END
             || ' gravados como vendas aprovadas'
         FROM recuperacoes AS r
         WHERE r.id = ${ID_DA_RECUPERACAO} AND r.pedidos_recuperados > 0`,
      )
      .bind(
        gravacao.usuarioId,
        gravacao.executadoEm,
        "conferencia.recuperar" satisfies AcaoAuditoria,
        `campanha:${gravacao.campanhaId}`,
      ),
    db.prepare(
      `SELECT id FROM pedidos WHERE recuperacao_id = ${ID_DA_RECUPERACAO} ORDER BY id`,
    ),
    db.prepare(
      `DELETE FROM recuperacoes WHERE id = ${ID_DA_RECUPERACAO} AND pedidos_recuperados = 0`,
    ),
  ];
  const resultados = await db.batch(comandos);
  const contagem = resultados[resultados.length - 4].results[0] as
    { id: number; pedidos_recuperados: number } | undefined;
  const gravados = new Set(
    (resultados[resultados.length - 2].results as { id: string }[]).map(
      (linha) => linha.id,
    ),
  );
  return {
    recuperacaoId:
      contagem !== undefined && contagem.pedidos_recuperados > 0
        ? contagem.id
        : null,
    gravados,
  };
}

interface LinhaRecuperacao {
  id: number;
  executado_em: string;
  usuario_id: number;
  usuario: string;
  pedidos_solicitados: number;
  pedidos_recuperados: number;
  bilhetes: number;
  total_centavos: number;
  linhas_arquivo: number;
  arquivo_sha256: string;
  mapeamento: string;
  pedidos: string;
}

const CAMPOS_DAS_COLUNAS: readonly CampoReconciliacao[] = [
  "pedido_id",
  "status",
  "qtd_bilhetes",
  "bilhetes",
  "valor",
  "afiliado",
  "data",
];

/** As recuperações feitas, da mais recente para a mais antiga, com quem fez e os pedidos gravados. */
export async function listarRecuperacoes(
  db: D1Database,
): Promise<Recuperacao[]> {
  const { results } = await db
    .prepare(
      `SELECT r.id, r.executado_em, r.usuario_id, u.nome AS usuario, r.pedidos_solicitados,
         r.pedidos_recuperados, r.bilhetes, r.total_centavos, r.linhas_arquivo, r.arquivo_sha256,
         r.mapeamento,
         (SELECT json_group_array(p.id) FROM pedidos AS p WHERE p.recuperacao_id = r.id) AS pedidos
       FROM recuperacoes AS r
       JOIN usuarios AS u ON u.id = r.usuario_id
       ORDER BY r.id DESC`,
    )
    .all<LinhaRecuperacao>();
  return results.map((linha) => {
    const mapeamento = JSON.parse(linha.mapeamento) as Record<string, unknown>;
    const colunas = Object.fromEntries(
      CAMPOS_DAS_COLUNAS.map((campo) => {
        const nome = mapeamento[campo];
        return [campo, typeof nome === "string" && nome !== "" ? nome : null];
      }),
    ) as Recuperacao["colunas"];
    return {
      id: linha.id,
      executado_em: linha.executado_em,
      usuario: { id: linha.usuario_id, nome: linha.usuario },
      pedidos_solicitados: linha.pedidos_solicitados,
      pedidos_recuperados: linha.pedidos_recuperados,
      bilhetes: linha.bilhetes,
      total_centavos: linha.total_centavos,
      linhas_arquivo: linha.linhas_arquivo,
      arquivo_sha256: linha.arquivo_sha256,
      colunas,
      pedidos: (JSON.parse(linha.pedidos) as string[]).sort(),
    };
  });
}
