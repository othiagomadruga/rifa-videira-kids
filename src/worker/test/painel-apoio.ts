// Apoio aos testes do painel, dos rankings e das rotas abertas (RIFA-PAINEL): o cenário gravado direto no
// D1 dos testes (como a hierarquia, o PUT da campanha e o webhook gravariam), a entrada esperada dos
// montadores calculada À PARTE (vendas agrupadas no JS com agruparVendasPorDia, sem o SQL), um D1 que
// conta as idas ao banco e as varreduras de campos e textos das respostas abertas.
//
// Cenário: redes Jovem (jovens) e Adulta (adultos); discipuladores Abel e Boaz (jovens), Caleb e Davi
// (adultos; Davi sem células); 5 células (metas de 10 bilhetes por pessoa: Ágape 120, Betel 60, Canaã 120,
// Dorcas 200, Éfeso 100). Campanha ativa de 21 dias a partir de 23/11/2026 em America/Belem, com 3
// semanas de 7 dias e 35/25/45. Vendas: antes do início (reunião de cadastro e a véspera às 02:59:59.999Z),
// a largada às 03:00Z, a virada do dia 7 para o 8 (02:59:59.999Z / 03:00Z), o último segundo do dia 21 e
// o 1º instante depois do fim, vendas sem célula (sem afiliado e afiliado não vinculado), pedidos não
// aprovados e um pedido de outra campanha.
import { env } from "cloudflare:workers";
import {
  agruparVendasPorDia,
  campanhaEntradaSchema,
  somarDias,
  type CampanhaCalculo,
  type CelulaCalculo,
  type EntradaCalculo,
  type MotivoDesconsideracao,
} from "../../shared/contracts";
import { salvarCampanhaAtiva, type DadosCampanha } from "../db/campanha";

export const REDES = [
  { id: 1, nome: "Rede Jovem Ficticia", divisao: "jovens" },
  { id: 2, nome: "Rede Adulta Ficticia", divisao: "adultos" },
] as const;

export const DISCIPULADORES = [
  { id: 10, rede_id: 1, nome: "Discipulador Abel" },
  { id: 20, rede_id: 1, nome: "Discipulador Boaz" },
  { id: 30, rede_id: 2, nome: "Discipulador Caleb" },
  // Sem células: no resumo, escopo sem meta; nos rankings, não aparece.
  { id: 40, rede_id: 2, nome: "Discipulador Davi" },
] as const;

function celula(
  id: number,
  nome: string,
  qtd_pessoas: number,
  discipuladorId: 10 | 20 | 30,
): CelulaCalculo {
  const discipulador = DISCIPULADORES.find(
    (item) => item.id === discipuladorId,
  )!;
  const rede = REDES.find((item) => item.id === discipulador.rede_id)!;
  return {
    id,
    nome,
    qtd_pessoas,
    discipulador_id: discipulador.id,
    discipulador_nome: discipulador.nome,
    rede_id: rede.id,
    rede_nome: rede.nome,
    divisao: rede.divisao,
  };
}

/** Na ordem do id, como a leitura do banco devolve. */
export const CELULAS: CelulaCalculo[] = [
  celula(1, "Célula Ágape", 12, 10),
  celula(2, "Célula Betel", 6, 10),
  celula(3, "Célula Canaã", 12, 20),
  celula(4, "Célula Dorcas", 20, 30),
  celula(5, "Célula Éfeso", 10, 30),
];

/** affiliate_id → célula; o 900 não está vinculado (as vendas dele são sem célula). */
export const AFILIADOS = [
  { affiliate_id: 101, celula_id: 1 },
  { affiliate_id: 102, celula_id: 2 },
  { affiliate_id: 103, celula_id: 3 },
  { affiliate_id: 104, celula_id: 4 },
  { affiliate_id: 105, celula_id: 5 },
  { affiliate_id: 900, celula_id: null },
] as const;

export const DADOS_CAMPANHA: DadosCampanha = campanhaEntradaSchema.parse({
  nome: "Rifa Videira Kids",
  slug_rifei: "rifa-videira-kids-teste",
  data_inicio: "2026-11-23",
  preco_bilhete_centavos: 2000,
  meta: { unidade: "bilhetes", regra: "por_pessoa", valor: 10 },
  periodos: [
    { nome: "Semana 1", dias: 7, percentual_bp: 3500 },
    { nome: "Semana 2", dias: 7, percentual_bp: 2500 },
    { nome: "Semana 3", dias: 7, percentual_bp: 4500 },
  ],
  ranking: { criterio: "percentual_meta" },
  publico: { mostra_percentual_meta: false, limite_ranking: 3 },
});

/** Data do dia `n` da campanha do cenário (1 = 23/11/2026). */
export const dia = (n: number, inicio = DADOS_CAMPANHA.data_inicio) =>
  somarDias(inicio, n - 1);

export interface PedidoTeste {
  id: string;
  affiliate_id: number | null;
  status: "approved" | "in_process" | "expired";
  aprovado_em: string | null;
  qtd_bilhetes: number;
  total_centavos: number;
  /** "outra" = de uma campanha inativa (não conta). Padrão: a ativa. */
  campanha?: "ativa" | "outra";
  /** País e DDD do comprador (RIFA-015, mapa por DDD); padrão: null (sem telefone). */
  pais?: string | null;
  ddd?: string | null;
  /** Desconsiderado pelo admin (RIFA-028, D20): não conta em nada. Padrão: conta. */
  desconsiderado?: MotivoDesconsideracao;
}

/** Instante gravado na desconsideração dos pedidos de teste. */
export const DESCONSIDERADO_EM = "2026-11-30T12:00:00.000Z";

/** O mesmo pedido, desconsiderado pelo admin (D20). */
export const desconsiderado = (
  pedido: PedidoTeste,
  motivo: MotivoDesconsideracao = "teste",
): PedidoTeste => ({ ...pedido, desconsiderado: motivo });

let sequencia = 0;

/** Pedido aprovado; `total_centavos` padrão = bilhetes × R$ 20,00. */
export function aprovado(
  affiliate_id: number | null,
  aprovado_em: string,
  qtd_bilhetes: number,
  total_centavos = qtd_bilhetes * 2000,
): PedidoTeste {
  sequencia += 1;
  return {
    id: `PT-${String(sequencia).padStart(5, "0")}`,
    affiliate_id,
    status: "approved",
    aprovado_em,
    qtd_bilhetes,
    total_centavos,
  };
}

/** 12:00 em Belém (15:00Z) do dia `n`. */
const meioDia = (n: number) => `${dia(n)}T15:00:00.000Z`;

export const PEDIDOS: PedidoTeste[] = [
  // Antes do início: compra de teste na reunião de cadastro e a véspera no último milissegundo local.
  aprovado(101, "2026-11-20T15:00:00.000Z", 1),
  aprovado(102, "2026-11-23T02:59:59.999Z", 2),
  // Dia 1 começa às 03:00Z.
  aprovado(102, "2026-11-23T03:00:00.000Z", 3),
  // Semana 1 (dias 1 a 7).
  ...[1, 2, 3, 4, 5, 6].map((n) => aprovado(101, meioDia(n), 6)),
  aprovado(101, "2026-11-30T02:59:59.999Z", 6), // 29/11 23:59:59.999 em Belém: dia 7
  aprovado(102, meioDia(3), 4),
  aprovado(102, meioDia(5), 5),
  aprovado(103, meioDia(2), 10),
  aprovado(103, meioDia(4), 8),
  aprovado(104, meioDia(1), 20),
  aprovado(104, meioDia(6), 7),
  aprovado(104, meioDia(6), 8, 8 * 1800), // com desconto
  aprovado(105, meioDia(2), 5),
  // Sem célula: sem afiliado e afiliado não vinculado.
  aprovado(null, meioDia(3), 4),
  aprovado(900, meioDia(4), 2),
  // Semana 2 (dias 8 a 14). Às 03:00Z de 30/11 já é o dia 8. Ágape e Canaã empatam (6 de 120).
  aprovado(103, "2026-11-30T03:00:00.000Z", 6),
  aprovado(101, meioDia(8), 5),
  aprovado(102, meioDia(8), 6),
  aprovado(101, `${dia(9)}T13:00:00.000Z`, 1),
  aprovado(104, `${dia(9)}T12:00:00.000Z`, 5),
  aprovado(104, `${dia(9)}T14:00:00.000Z`, 7),
  aprovado(null, `${dia(9)}T13:30:00.000Z`, 1),
  // Depois do dia 9 (o "agora" principal dos testes): só entram em datas de referência posteriores.
  aprovado(105, meioDia(15), 10),
  aprovado(104, meioDia(20), 9),
  aprovado(105, "2026-12-14T02:59:59.999Z", 3), // 13/12 23:59:59.999: dia 21 (último)
  aprovado(104, "2026-12-14T03:00:00.000Z", 4), // 14/12 00:00: depois do fim
  // Não contam: não aprovados e de outra campanha.
  {
    id: "PT-PROCESSO",
    affiliate_id: 101,
    status: "in_process",
    aprovado_em: null,
    qtd_bilhetes: 9,
    total_centavos: 18000,
  },
  {
    id: "PT-EXPIRADO",
    affiliate_id: 103,
    status: "expired",
    aprovado_em: null,
    qtd_bilhetes: 7,
    total_centavos: 14000,
  },
  { ...aprovado(101, meioDia(3), 50), id: "PT-OUTRA", campanha: "outra" },
];

/** "Agora" principal: 01/12/2026 12:00 em Belém, dia 9 de 21 (2º dia da Semana 2). */
export const AGORA = new Date("2026-12-01T15:00:00.000Z");

/** Os mesmos pedidos `dias` dias depois (Belém não tem horário de verão: o dia local anda junto). */
export function deslocarPedidos(
  pedidos: readonly PedidoTeste[],
  dias: number,
): PedidoTeste[] {
  return pedidos.map((pedido) => ({
    ...pedido,
    aprovado_em:
      pedido.aprovado_em === null
        ? null
        : new Date(
            Date.parse(pedido.aprovado_em) + dias * 86_400_000,
          ).toISOString(),
  }));
}

/** A campanha do cenário como os montadores a recebem. */
export const CAMPANHA: CampanhaCalculo = DADOS_CAMPANHA;

// ---------------------------------------------------------------------------------------------------
// Gravação
// ---------------------------------------------------------------------------------------------------

const TABELAS = [
  "webhook_eventos",
  "pedidos",
  "afiliados",
  "celulas",
  "discipuladores",
  "redes",
  "campanha_periodos",
  "campanhas",
] as const;

/** Apaga campanha, hierarquia e pedidos (usuários e sessões ficam). */
export async function limparBanco(db: D1Database = env.DB): Promise<void> {
  await db.batch(TABELAS.map((tabela) => db.prepare(`DELETE FROM ${tabela}`)));
}

export async function semearHierarquia(
  db: D1Database = env.DB,
  celulas: readonly CelulaCalculo[] = CELULAS,
): Promise<void> {
  await db.batch([
    ...REDES.map((rede) =>
      db
        .prepare("INSERT INTO redes (id, nome, divisao) VALUES (?, ?, ?)")
        .bind(rede.id, rede.nome, rede.divisao),
    ),
    ...DISCIPULADORES.map((discipulador) =>
      db
        .prepare(
          "INSERT INTO discipuladores (id, rede_id, nome) VALUES (?, ?, ?)",
        )
        .bind(discipulador.id, discipulador.rede_id, discipulador.nome),
    ),
    ...celulas.map((item) =>
      db
        .prepare(
          `INSERT INTO celulas (id, discipulador_id, nome, qtd_pessoas, lider_nome)
           VALUES (?, ?, ?, ?, ?)`,
        )
        .bind(
          item.id,
          item.discipulador_id,
          item.nome,
          item.qtd_pessoas,
          `Líder da ${item.nome}`,
        ),
    ),
    ...AFILIADOS.map((afiliado) =>
      db
        .prepare(
          `INSERT INTO afiliados (affiliate_id, celula_id, origem, vinculado_em)
           VALUES (?, ?, 'manual', ?)`,
        )
        .bind(
          afiliado.affiliate_id,
          afiliado.celula_id,
          afiliado.celula_id === null ? null : "2026-11-20T12:00:00.000Z",
        ),
    ),
  ]);
}

/** Cria a campanha ativa pelo mesmo código do PUT /api/admin/campanha e devolve o id. */
export async function semearCampanha(
  db: D1Database = env.DB,
  dados: DadosCampanha = DADOS_CAMPANHA,
): Promise<number> {
  const resultado = await salvarCampanhaAtiva(db, dados);
  if (!resultado.ok) throw new Error(resultado.mensagem);
  return resultado.campanha.id;
}

/** Campanha inativa de outra edição, para o pedido que não pode contar. */
async function semearOutraCampanha(db: D1Database): Promise<number> {
  const linha = await db
    .prepare(
      `INSERT INTO campanhas (nome, slug_rifei, ativa, data_inicio, preco_bilhete_centavos,
         meta_unidade, meta_regra, meta_valor, ranking_criterio)
       VALUES ('Rifa de outra edição', 'rifa-de-outra-edicao', 0, '2026-11-23', 2000,
         'bilhetes', 'por_pessoa', 10, 'percentual_meta')
       RETURNING id`,
    )
    .first<{ id: number }>();
  return linha!.id;
}

export async function semearPedidos(
  db: D1Database,
  pedidos: readonly PedidoTeste[],
  campanhas: { ativa: number; outra?: number },
): Promise<void> {
  if (pedidos.length === 0) return;
  await db.batch(
    pedidos.map((pedido) =>
      db
        .prepare(
          `INSERT INTO pedidos (id, campanha_id, affiliate_id, status, qtd_bilhetes,
             total_centavos, aprovado_em, pais, ddd, desconsiderado_em, desconsiderado_motivo)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        )
        .bind(
          pedido.id,
          pedido.campanha === "outra" ? campanhas.outra! : campanhas.ativa,
          pedido.affiliate_id,
          pedido.status,
          pedido.qtd_bilhetes,
          pedido.total_centavos,
          pedido.aprovado_em,
          pedido.pais ?? null,
          pedido.ddd ?? null,
          pedido.desconsiderado === undefined ? null : DESCONSIDERADO_EM,
          pedido.desconsiderado ?? null,
        ),
    ),
  );
}

/** Apaga tudo e grava o cenário (ou outra campanha e outros pedidos). */
export async function semearCenario(
  opcoes: {
    db?: D1Database;
    campanha?: DadosCampanha;
    pedidos?: readonly PedidoTeste[];
  } = {},
): Promise<{ campanhaId: number }> {
  const db = opcoes.db ?? env.DB;
  await limparBanco(db);
  await semearHierarquia(db);
  const ativa = await semearCampanha(db, opcoes.campanha);
  const outra = await semearOutraCampanha(db);
  await semearPedidos(db, opcoes.pedidos ?? PEDIDOS, { ativa, outra });
  return { campanhaId: ativa };
}

// ---------------------------------------------------------------------------------------------------
// Entrada esperada (sem o SQL)
// ---------------------------------------------------------------------------------------------------

/**
 * A entrada dos montadores para os mesmos dados, montada no JS: só os aprovados da campanha ativa que contam
 * (sem os desconsiderados, D20), a célula pelo afiliado (D7) e o dia local pelo Intl (agruparVendasPorDia), sem
 * passar pelo banco.
 */
export function entradaEsperada(
  campanha: CampanhaCalculo = CAMPANHA,
  pedidos: readonly PedidoTeste[] = PEDIDOS,
): EntradaCalculo {
  const celulaDoAfiliado = new Map<number, number | null>(
    AFILIADOS.map((afiliado) => [afiliado.affiliate_id, afiliado.celula_id]),
  );
  const vendas = agruparVendasPorDia(
    pedidos
      .filter(
        (pedido) =>
          pedido.status === "approved" &&
          pedido.campanha !== "outra" &&
          pedido.desconsiderado === undefined,
      )
      .map((pedido) => ({
        celula_id:
          pedido.affiliate_id === null
            ? null
            : (celulaDoAfiliado.get(pedido.affiliate_id) ?? null),
        aprovado_em: pedido.aprovado_em!,
        qtd_bilhetes: pedido.qtd_bilhetes,
        total_centavos: pedido.total_centavos,
      })),
    campanha.fuso_horario,
  );
  return { campanha, celulas: CELULAS, vendas };
}

/** Ordem estável das vendas por dia, para comparar listas sem depender da ordem do banco. */
export const ordenarVendas = <
  T extends { dia: string; celula_id: number | null },
>(
  vendas: readonly T[],
): T[] =>
  [...vendas].sort(
    (a, b) =>
      a.dia.localeCompare(b.dia) || (a.celula_id ?? 0) - (b.celula_id ?? 0),
  );

// ---------------------------------------------------------------------------------------------------
// D1 que conta as idas ao banco
// ---------------------------------------------------------------------------------------------------

export interface ContagemBanco {
  /** Idas ao banco: cada first/all/run/raw e cada batch inteiro. */
  idas: number;
  /** Comandos SQL executados (um batch conta os dele). */
  comandos: number;
  /** Tempo de relógio esperando o banco, em ms. */
  ms: number;
  /** Linhas lidas pelo D1 nos batches (`meta.rows_read`; o `first` não informa). */
  linhasLidas: number;
  /**
   * Linhas lidas pelo D1 em TODOS os comandos: os batches e cada first, all e run (o `first` é lido pelo `all`, a
   * mesma consulta, para ter o `meta`). Mede a requisição inteira, inclusive a sessão e a campanha.
   */
  linhasLidasTotal: number;
}

const ORIGINAL = Symbol("comando original");
const EXECUTAM = new Set(["first", "all", "run", "raw"]);

/** Embrulha o D1 dos testes para contar idas, comandos e o tempo de espera (o resto não muda). */
export function bancoQueConta(db: D1Database = env.DB): {
  db: D1Database;
  contagem: ContagemBanco;
} {
  const contagem: ContagemBanco = {
    idas: 0,
    comandos: 0,
    ms: 0,
    linhasLidas: 0,
    linhasLidasTotal: 0,
  };
  const medir = async <T>(promessa: () => Promise<T>): Promise<T> => {
    const inicio = performance.now();
    try {
      return await promessa();
    } finally {
      contagem.ms += performance.now() - inicio;
    }
  };
  const embrulhar = (comando: D1PreparedStatement): D1PreparedStatement =>
    new Proxy(comando, {
      get(alvo, nome) {
        if (nome === ORIGINAL) return alvo;
        const valor: unknown = Reflect.get(alvo, nome, alvo);
        if (typeof valor !== "function") return valor;
        if (nome === "bind")
          return (...args: unknown[]) =>
            embrulhar(Reflect.apply(valor, alvo, args) as D1PreparedStatement);
        if (nome === "first" || nome === "all" || nome === "run")
          return async (...args: unknown[]) => {
            contagem.idas += 1;
            contagem.comandos += 1;
            if (nome === "first" && args.length > 0)
              throw new Error("first(coluna) não é usado aqui");
            // O first não traz `meta`: lê pelo all (mesma consulta) e devolve a primeira linha.
            const resultado = await medir(() =>
              nome === "run" ? alvo.run() : alvo.all(),
            );
            contagem.linhasLidasTotal += resultado.meta.rows_read ?? 0;
            return nome === "first"
              ? (resultado.results[0] ?? null)
              : resultado;
          };
        if (typeof nome === "string" && EXECUTAM.has(nome))
          return (...args: unknown[]) => {
            contagem.idas += 1;
            contagem.comandos += 1;
            return medir(
              () => Reflect.apply(valor, alvo, args) as Promise<unknown>,
            );
          };
        return (...args: unknown[]) => Reflect.apply(valor, alvo, args);
      },
    });
  const original = (comando: D1PreparedStatement) =>
    (comando as unknown as { [ORIGINAL]?: D1PreparedStatement })[ORIGINAL] ??
    comando;
  const banco = new Proxy(db, {
    get(alvo, nome) {
      if (nome === "prepare")
        return (sql: string) => embrulhar(alvo.prepare(sql));
      if (nome === "batch")
        return async (comandos: D1PreparedStatement[]) => {
          contagem.idas += 1;
          contagem.comandos += comandos.length;
          const resultados = await medir(() =>
            alvo.batch(comandos.map(original)),
          );
          for (const resultado of resultados) {
            contagem.linhasLidas += resultado.meta.rows_read ?? 0;
            contagem.linhasLidasTotal += resultado.meta.rows_read ?? 0;
          }
          return resultados;
        };
      const valor: unknown = Reflect.get(alvo, nome, alvo);
      return typeof valor === "function"
        ? (...args: unknown[]) => Reflect.apply(valor, alvo, args)
        : valor;
    },
  });
  return { db: banco, contagem };
}

// ---------------------------------------------------------------------------------------------------
// Varreduras das respostas abertas
// ---------------------------------------------------------------------------------------------------

/** Todos os nomes de campo, em qualquer nível. */
export function camposDe(
  valor: unknown,
  campos = new Set<string>(),
): Set<string> {
  if (Array.isArray(valor)) for (const item of valor) camposDe(item, campos);
  else if (valor !== null && typeof valor === "object")
    for (const [campo, item] of Object.entries(valor)) {
      campos.add(campo);
      camposDe(item, campos);
    }
  return campos;
}

/** Todos os textos, em qualquer nível. */
export function textosDe(valor: unknown, textos: string[] = []): string[] {
  if (typeof valor === "string") textos.push(valor);
  else if (Array.isArray(valor))
    for (const item of valor) textosDe(item, textos);
  else if (valor !== null && typeof valor === "object")
    for (const item of Object.values(valor)) textosDe(item, textos);
  return textos;
}

/** Os únicos campos que as rotas abertas podem ter (a mesma lista fechada de api.test.ts). */
export const CAMPOS_PUBLICOS = new Set([
  "nivel",
  "divisao",
  "janela",
  "tipo",
  "ordem",
  "nome",
  "data_inicio",
  "data_fim",
  "criterio",
  "itens",
  "posicao",
  "percentual_meta_bp",
  "atualizado_em",
  "referencia",
  "data",
  "fase",
  "duracao_dias",
  "dia_campanha",
  "dias_restantes",
  "dias_para_inicio",
  "periodo",
  "dias",
  "dia_no_periodo",
  "texto",
  "gerado_em",
]);

/** Nome de campo de valor (em R$ ou em unidades). */
export const CAMPO_DE_VALOR =
  /centavos|valor|reais|total|preco|arrecad|vendas|realizado|bilhete|esperado|diferenca|projecao|^meta/i;

/** Texto com valor em R$, centavos ou quantidade de bilhetes. */
export const TEXTO_DE_VALOR = /R\$|centavo|bilhete/i;
