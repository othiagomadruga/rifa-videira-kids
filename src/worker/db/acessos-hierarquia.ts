/**
 * Acessos da hierarquia no D1 (RIFA-014, D12; migrations/0006_acesso_hierarquia.sql): os alvos de um papel (as
 * células dos líderes, os discipuladores ou as redes), com o usuário de cada um, e os links novos em lote.
 * Rotas: src/worker/routes/acessos-hierarquia.ts (só admin). Documentação: docs/acesso.md, seção 9.
 *
 * - Cada usuário da hierarquia fica preso a UM alvo pela coluna do papel (celula_id, discipulador_id ou rede_id),
 *   e cada alvo tem no máximo um usuário (índices únicos parciais da 0006). Esta camada só recebe e grava o HASH
 *   do token do link, como db/acessos.ts.
 * - O lote é um `db.batch` só (uma transação do D1: tudo ou nada), com poucas instruções sobre listas JSON
 *   (json_each), como a importação da hierarquia: o D1 limita as consultas por invocação, e um lote de 200
 *   alvos continua com no máximo 6 instruções.
 */
import {
  TIPO_ALVO_DO_PAPEL,
  type Alvo,
  type Divisao,
  type ItemAcessoHierarquia,
  type LinkAcesso,
  type PapelHierarquia,
} from "../../shared/contracts";
import {
  limiteDeInatividade,
  paraLink,
  type LinhaLink,
  type NovoLink,
} from "./acessos";
import {
  LIMITE_RESUMO_AUDITORIA,
  prepararRegistroAuditoria,
  type Autoria,
} from "./auditoria";

/** Como cada papel encontra os alvos dele na hierarquia. `a` é o alvo nas consultas. */
interface DefinicaoDoAlvo {
  /** A coluna de `usuarios` que prende o usuário ao alvo. */
  coluna: "celula_id" | "discipulador_id" | "rede_id";
  /**
   * id, nome e divisão (a da rede) do alvo; quem deve receber o link (o líder da célula, o discipulador ou o
   * responsável da rede) e o telefone (só do líder).
   */
  colunas: string;
  /** A tabela do alvo (`a`) e as da hierarquia acima dele. */
  de: string;
  /**
   * O caminho na hierarquia acima do alvo, para a ordem da lista: a rede e o discipulador (nulos nos níveis que
   * o papel não tem).
   */
  caminho: string;
  /** Para a trilha de auditoria. */
  singular: string;
  plural: string;
  /** Mensagens dos erros do lote (404 e 409). */
  naoEncontrado: string;
  desativado: string;
}

const ALVOS: Record<PapelHierarquia, DefinicaoDoAlvo> = {
  lider: {
    coluna: "celula_id",
    colunas: `a.id AS alvo_id, a.nome AS alvo_nome, r.divisao AS alvo_divisao,
      a.lider_nome AS pessoa_nome, a.lider_telefone AS telefone`,
    de: `celulas AS a
      JOIN discipuladores AS d ON d.id = a.discipulador_id
      JOIN redes AS r ON r.id = d.rede_id`,
    caminho: `r.nome AS rede_nome, r.id AS rede_id, d.nome AS discipulador_nome,
      d.id AS discipulador_id`,
    singular: "célula",
    plural: "células",
    naoEncontrado:
      "Algum id não é de uma célula cadastrada: nenhum link foi gerado",
    desativado:
      "O acesso de alguma célula está desativado: reative-o antes de gerar um link novo (nenhum link foi gerado)",
  },
  discipulador: {
    coluna: "discipulador_id",
    colunas: `a.id AS alvo_id, a.nome AS alvo_nome, r.divisao AS alvo_divisao,
      a.nome AS pessoa_nome, NULL AS telefone`,
    de: "discipuladores AS a JOIN redes AS r ON r.id = a.rede_id",
    caminho: `r.nome AS rede_nome, r.id AS rede_id, NULL AS discipulador_nome,
      NULL AS discipulador_id`,
    singular: "discipulador",
    plural: "discipuladores",
    naoEncontrado:
      "Algum id não é de um discipulador cadastrado: nenhum link foi gerado",
    desativado:
      "O acesso de algum discipulador está desativado: reative-o antes de gerar um link novo (nenhum link foi gerado)",
  },
  rede: {
    coluna: "rede_id",
    colunas: `a.id AS alvo_id, a.nome AS alvo_nome, a.divisao AS alvo_divisao,
      a.responsavel_nome AS pessoa_nome, NULL AS telefone`,
    de: "redes AS a",
    caminho: `NULL AS rede_nome, NULL AS rede_id, NULL AS discipulador_nome,
      NULL AS discipulador_id`,
    singular: "rede",
    plural: "redes",
    naoEncontrado:
      "Algum id não é de uma rede cadastrada: nenhum link foi gerado",
    desativado:
      "O acesso de alguma rede está desativado: reative-o antes de gerar um link novo (nenhum link foi gerado)",
  },
};

/** As mensagens dos erros do lote, por papel (para a rota). */
export function mensagensDoLote(papel: PapelHierarquia): {
  naoEncontrado: string;
  desativado: string;
} {
  const { naoEncontrado, desativado } = ALVOS[papel];
  return { naoEncontrado, desativado };
}

/** Um alvo como as consultas devolvem, com o usuário dele (as colunas `usuario_*` são nulas sem usuário). */
interface LinhaAlvo {
  alvo_id: number;
  alvo_nome: string;
  alvo_divisao: Divisao;
  pessoa_nome: string | null;
  telefone: string | null;
  rede_nome: string | null;
  rede_id: number | null;
  discipulador_nome: string | null;
  discipulador_id: number | null;
  usuario_id: number | null;
  usuario_nome: string | null;
  usuario_ativo: number | null;
}

/** Os alvos do papel (todos, ou os da lista JSON em ?1), com o usuário de cada um. */
function consultaDosAlvos(
  definicao: DefinicaoDoAlvo,
  soOsDaLista: boolean,
): string {
  return `SELECT ${definicao.colunas}, ${definicao.caminho},
      u.id AS usuario_id, u.nome AS usuario_nome, u.ativo AS usuario_ativo
    FROM ${definicao.de}
    LEFT JOIN usuarios AS u ON u.${definicao.coluna} = a.id
    ${soOsDaLista ? "WHERE a.id IN (SELECT value FROM json_each(?1))" : ""}`;
}

/**
 * Nomes em português, como no ranking: sem diferenciar acentos e maiúsculas, "Célula 2" antes de "Célula 10".
 * (O COLLATE NOCASE do SQLite só ignora maiúsculas ASCII e poria "Célula Ágape" depois de "Célula Betel".)
 */
const ordemDosNomes = new Intl.Collator("pt-BR", {
  sensitivity: "base",
  numeric: true,
});

function compararNivel(
  nomeA: string | null,
  idA: number | null,
  nomeB: string | null,
  idB: number | null,
): number {
  return (
    ordemDosNomes.compare(nomeA ?? "", nomeB ?? "") || (idA ?? 0) - (idB ?? 0)
  );
}

/** Pelo caminho na hierarquia: nome da rede, do discipulador e do alvo (empate de nome, pelo id). */
const pelaHierarquia = (a: LinhaAlvo, b: LinhaAlvo) =>
  compararNivel(a.rede_nome, a.rede_id, b.rede_nome, b.rede_id) ||
  compararNivel(
    a.discipulador_nome,
    a.discipulador_id,
    b.discipulador_nome,
    b.discipulador_id,
  ) ||
  compararNivel(a.alvo_nome, a.alvo_id, b.alvo_nome, b.alvo_id);

function alvoDaLinha(papel: PapelHierarquia, linha: LinhaAlvo): Alvo {
  return {
    tipo: TIPO_ALVO_DO_PAPEL[papel],
    id: linha.alvo_id,
    nome: linha.alvo_nome,
    divisao: linha.alvo_divisao,
  };
}

/** Só o líder tem telefone na lista (para abrir o WhatsApp); nos outros papéis, null. */
const telefoneDaLinha = (papel: PapelHierarquia, linha: LinhaAlvo) =>
  papel === "lider" ? linha.telefone : null;

// ---------------------------------------------------------------------------------------------------
// GET /api/admin/acessos-hierarquia
// ---------------------------------------------------------------------------------------------------

/**
 * TODOS os alvos do papel, com ou sem acesso: o alvo, quem deve receber o link, o telefone do líder e o usuário
 * do alvo (nome, ativo, sessões válidas e links, sem token nem hash), ou null. Uma ida ao banco (um lote).
 */
export async function listarAcessosHierarquia(
  db: D1Database,
  papel: PapelHierarquia,
  agora: string,
): Promise<ItemAcessoHierarquia[]> {
  const definicao = ALVOS[papel];
  const [alvos, links, sessoes] = await db.batch([
    db.prepare(consultaDosAlvos(definicao, false)),
    db
      .prepare(
        `SELECT l.id, l.usuario_id, l.criado_em, l.expira_em, l.revogado_em, l.ultimo_uso_em
         FROM links_acesso AS l JOIN usuarios AS u ON u.id = l.usuario_id
         WHERE u.papel = ?1
         ORDER BY l.criado_em DESC, l.id DESC`,
      )
      .bind(papel),
    db
      .prepare(
        `SELECT s.usuario_id, count(*) AS total
         FROM sessoes AS s JOIN usuarios AS u ON u.id = s.usuario_id
         WHERE u.papel = ?1 AND s.expira_em > ?2 AND s.ultimo_uso_em >= ?3
         GROUP BY s.usuario_id`,
      )
      .bind(papel, agora, limiteDeInatividade(agora)),
  ]);

  const linksPorUsuario = new Map<number, LinkAcesso[]>();
  for (const linha of links.results as LinhaLink[]) {
    const lista = linksPorUsuario.get(linha.usuario_id) ?? [];
    lista.push(paraLink(linha, agora));
    linksPorUsuario.set(linha.usuario_id, lista);
  }
  const sessoesPorUsuario = new Map(
    (sessoes.results as { usuario_id: number; total: number }[]).map(
      (linha) => [linha.usuario_id, linha.total],
    ),
  );

  return [...(alvos.results as LinhaAlvo[])]
    .sort(pelaHierarquia)
    .map((linha) => ({
      alvo: alvoDaLinha(papel, linha),
      pessoa_nome: linha.pessoa_nome,
      telefone: telefoneDaLinha(papel, linha),
      usuario:
        linha.usuario_id === null || linha.usuario_nome === null
          ? null
          : {
              id: linha.usuario_id,
              nome: linha.usuario_nome,
              ativo: linha.usuario_ativo === 1,
              sessoes_ativas: sessoesPorUsuario.get(linha.usuario_id) ?? 0,
              links: linksPorUsuario.get(linha.usuario_id) ?? [],
            },
    }));
}

// ---------------------------------------------------------------------------------------------------
// POST /api/admin/acessos-hierarquia/links
// ---------------------------------------------------------------------------------------------------

export interface PedidoLinksHierarquia {
  papel: PapelHierarquia;
  /** Sem repetição (o schema do corpo garante), na ordem em que a resposta sai. */
  ids: readonly number[];
  revogarAnteriores: boolean;
}

/** Um link gravado: o alvo, quem recebe, o usuário (criado agora ou o que já existia) e o id do link. */
export interface LinkGravadoHierarquia {
  alvo: Alvo;
  pessoa_nome: string | null;
  telefone: string | null;
  usuario_id: number;
  link_id: number;
}

export type ResultadoLinksHierarquia =
  | { ok: true; itens: LinkGravadoHierarquia[] }
  /** Nada foi gravado. `ids` em ordem crescente (detalhesIdsRecusadosSchema). */
  | { ok: false; codigo: "nao_encontrado" | "em_uso"; ids: number[] };

const crescente = (a: number, b: number) => a - b;

/** Falhas de restrição que um lote concorrente explica (o alvo sumiu, ganhou usuário ou foi desativado). */
function restricaoDoLote(erro: unknown): boolean {
  return (
    erro instanceof Error &&
    /(UNIQUE|NOT NULL|FOREIGN KEY) constraint failed/.test(erro.message)
  );
}

/**
 * O resumo da trilha, sem nomes: quantos alvos, quantos acessos criados e se os anteriores foram revogados; os
 * ids (em ordem crescente) só se couberem no limite do resumo.
 */
function resumirLote(
  definicao: DefinicaoDoAlvo,
  pedido: PedidoLinksHierarquia,
  criados: number,
): string {
  const alvos = `${pedido.ids.length} ${pedido.ids.length === 1 ? definicao.singular : definicao.plural}`;
  const acessos = `${criados} ${criados === 1 ? "acesso criado" : "acessos criados"}`;
  const anteriores = pedido.revogarAnteriores
    ? "links anteriores revogados e as sessões deles encerradas"
    : "links anteriores mantidos";
  const resumo = `Links novos para ${alvos} (${acessos}); ${anteriores}`;
  const comIds = `${resumo}. Ids: ${[...pedido.ids].sort(crescente).join(", ")}`;
  return comIds.length <= LIMITE_RESUMO_AUDITORIA ? comIds : resumo;
}

/**
 * Um link NOVO para cada alvo de `ids` (`links[i]` é o de `ids[i]`), num lote só (tudo ou nada):
 * - alvo sem usuário: cria o usuário (papel do pedido, preso ao alvo) com o nome de quem recebe o link (sem ele,
 *   o nome do alvo); alvo com usuário: o nome dele passa a ser esse, o atual da hierarquia;
 * - `revogarAnteriores`: revoga os links ainda válidos de cada alvo e encerra as sessões abertas por eles, antes
 *   de gravar os novos;
 * - com `autoria`, uma linha na trilha de auditoria pelo lote inteiro (acessos_hierarquia.gerar_links).
 * Recusa sem gravar nada: `nao_encontrado` se algum id não é alvo do papel; `em_uso` se algum alvo tem o usuário
 * desativado (reative antes com o PATCH). Se outra gravação muda os alvos no meio (o alvo some, ganha um usuário
 * ou é desativado), a restrição do banco desfaz o lote e a conferência é refeita uma vez.
 */
export async function gerarLinksHierarquia(
  db: D1Database,
  pedido: PedidoLinksHierarquia,
  links: readonly NovoLink[],
  autoria?: Autoria,
): Promise<ResultadoLinksHierarquia> {
  if (links.length !== pedido.ids.length)
    throw new RangeError("Um link novo por alvo");
  for (let tentativa = 1; ; tentativa++) {
    try {
      return await gravarLote(db, pedido, links, autoria);
    } catch (erro) {
      if (tentativa >= 2 || !restricaoDoLote(erro)) throw erro;
    }
  }
}

async function gravarLote(
  db: D1Database,
  pedido: PedidoLinksHierarquia,
  links: readonly NovoLink[],
  autoria: Autoria | undefined,
): Promise<ResultadoLinksHierarquia> {
  const { papel, ids } = pedido;
  const definicao = ALVOS[papel];
  const { coluna } = definicao;
  const { results } = await db
    .prepare(consultaDosAlvos(definicao, true))
    .bind(JSON.stringify(ids))
    .all<LinhaAlvo>();
  const porId = new Map(results.map((linha) => [linha.alvo_id, linha]));

  const ausentes = ids.filter((id) => !porId.has(id)).sort(crescente);
  if (ausentes.length > 0)
    return { ok: false, codigo: "nao_encontrado", ids: ausentes };
  const desativados = ids
    .filter((id) => porId.get(id)?.usuario_ativo === 0)
    .sort(crescente);
  if (desativados.length > 0)
    return { ok: false, codigo: "em_uso", ids: desativados };

  const itens = ids.map((id, indice) => {
    const linha = porId.get(id)!;
    return {
      id,
      nome: linha.pessoa_nome ?? linha.alvo_nome,
      token_hash: links[indice].tokenHash,
      existe: linha.usuario_id !== null,
    };
  });
  const novos = itens.filter((item) => !item.existe);
  const existentes = itens.filter((item) => item.existe);
  const { criadoEm, expiraEm } = links[0];
  const json = (lista: typeof itens) => JSON.stringify(lista);
  const daLista = `(SELECT json_extract(j.value, '$.id') FROM json_each(?1) AS j)`;
  const usuariosDaLista = `(SELECT u.id FROM usuarios AS u WHERE u.${coluna} IN ${daLista})`;

  const comandos: D1PreparedStatement[] = [];
  if (novos.length > 0)
    comandos.push(
      db
        .prepare(
          `INSERT INTO usuarios (nome, papel, ${coluna}, criado_em)
           SELECT json_extract(j.value, '$.nome'), ?2, json_extract(j.value, '$.id'), ?3
           FROM json_each(?1) AS j`,
        )
        .bind(json(novos), papel, criadoEm),
    );
  if (existentes.length > 0) {
    comandos.push(
      db
        .prepare(
          `UPDATE usuarios SET nome = json_extract(j.value, '$.nome')
           FROM json_each(?1) AS j WHERE usuarios.${coluna} = json_extract(j.value, '$.id')`,
        )
        .bind(json(existentes)),
    );
    if (pedido.revogarAnteriores)
      comandos.push(
        // Antes da revogação (depois dela não se sabe quais links ela pegou): as sessões dos links válidos.
        db
          .prepare(
            `DELETE FROM sessoes WHERE link_id IN (
               SELECT l.id FROM links_acesso AS l
               WHERE l.usuario_id IN ${usuariosDaLista} AND l.revogado_em IS NULL AND l.expira_em > ?2)`,
          )
          .bind(json(existentes), criadoEm),
        db
          .prepare(
            `UPDATE links_acesso SET revogado_em = ?2
             WHERE usuario_id IN ${usuariosDaLista} AND revogado_em IS NULL AND expira_em > ?2`,
          )
          .bind(json(existentes), criadoEm),
      );
  }
  // O usuário de cada alvo, ativo: sem ele (o alvo sumiu ou foi desativado por outra gravação), o usuario_id
  // fica NULL, o NOT NULL recusa e o lote inteiro é desfeito.
  comandos.push(
    db
      .prepare(
        `INSERT INTO links_acesso (usuario_id, token_hash, criado_em, expira_em)
         SELECT (SELECT u.id FROM usuarios AS u
                 WHERE u.${coluna} = json_extract(j.value, '$.id') AND u.ativo = 1),
           json_extract(j.value, '$.token_hash'), ?2, ?3
         FROM json_each(?1) AS j
         RETURNING id, usuario_id, token_hash`,
      )
      .bind(json(itens), criadoEm, expiraEm),
  );
  if (autoria)
    comandos.push(
      prepararRegistroAuditoria(db, {
        ...autoria,
        acao: "acessos_hierarquia.gerar_links",
        alvo: `papel:${papel}`,
        resumo: resumirLote(definicao, pedido, novos.length),
      }),
    );

  const resultados = await db.batch<{
    id: number;
    usuario_id: number;
    token_hash: string;
  }>(comandos);
  const gravados = resultados[comandos.length - (autoria ? 2 : 1)].results;
  const porHash = new Map(gravados.map((linha) => [linha.token_hash, linha]));
  return {
    ok: true,
    itens: itens.map((item) => {
      const linha = porId.get(item.id)!;
      const gravado = porHash.get(item.token_hash);
      if (gravado === undefined)
        throw new Error("D1 não devolveu o link gravado de um alvo");
      return {
        alvo: alvoDaLinha(papel, linha),
        pessoa_nome: linha.pessoa_nome,
        telefone: telefoneDaLinha(papel, linha),
        usuario_id: gravado.usuario_id,
        link_id: gravado.id,
      };
    }),
  };
}
