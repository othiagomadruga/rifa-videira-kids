// Campanha: a leitura da campanha ativa e a gravação da configuração (docs/api.md, GET e PUT
// /api/admin/campanha).
//
// - A API v1 trabalha só com a campanha ativa, e o índice parcial campanhas_uma_ativa garante no
//   máximo uma. buscarCampanhaAtiva é a ÚNICA leitura dela: o webhook (D5: só conta o slug_rifei da
//   ativa) e a configuração (GET e a resposta do PUT) usam a mesma função.
// - A leitura é um comando só (a linha e os períodos agregados em JSON): sai inteira, de um mesmo
//   instante do banco, sem db.batch. O webhook a faz antes do db.batch dele, como sempre fez.
// - O PUT cria a campanha ativa ou substitui a configuração dela (mesmo id, então os pedidos já
//   gravados continuam ligados a ela); os períodos são substituídos inteiros. Tudo vai num único
//   db.batch (uma transação no D1): campanha, períodos e a leitura de volta. Se qualquer comando
//   falha, nada muda.
// - As datas dos períodos, a data final e a soma dos percentuais saem do contrato
//   (src/shared/contracts/calendario.ts), o mesmo código que a tela usa.
// - Auditoria (RIFA-013b): quem salvou e o que mudou vão no mesmo db.batch (resumirMudancaDaCampanha).
// - Regras do admin (Sprint 6, D20; colunas da migração 0008): as chaves `pedidos.desconsiderar`,
//   `acesso.discipuladores` e `acesso.redes` e os modelos das mensagens. No PUT, o grupo AUSENTE mantém o gravado
//   (no primeiro PUT, o padrão das colunas) e o grupo presente substitui o grupo inteiro. Um modelo igual ao padrão
//   do contrato (MENSAGENS_PADRAO) é gravado como NULL (= o padrão): se o padrão mudar um dia, quem nunca editou
//   acompanha. Na leitura, NULL volta como o padrão. Esses três grupos são só do admin (RIFA-042, adendo da D20):
//   a rota confere com gruposDoAdminAlterados e grava o PUT da coordenação com semGruposDoAdmin.
// - Ranking por divisão (RIFA-061, D27; coluna da migração 0012): `ranking.por_divisao`. No PUT, ausente mantém o
//   gravado (no primeiro PUT, o padrão da coluna: separa), como os grupos do admin; é do grupo `ranking`, que a
//   coordenação também muda (como o critério).
// - Notificações de venda (RIFA-095, D43; coluna da migração 0022): `notificacoes.vendas`. No PUT, ausente mantém o
//   gravado (no primeiro PUT, o padrão da coluna: ligada), gravada à parte do UPSERT (GRAVAR_NOTIFICACOES), como o
//   login das células com senha. É da coordenação (como o `publico`).
import type { z } from "zod";
import {
  ACESSO_PADRAO,
  BILHETES_PADRAO,
  MENSAGENS_PADRAO,
  NOTIFICACOES_PADRAO,
  PEDIDOS_PADRAO,
  RANKING_POR_DIVISAO_PADRAO,
  TIPOS_MENSAGEM,
  calcularCalendario,
  respostaCampanhaSchema,
  somarPercentuais,
  type Campanha,
  type DetalheValidacao,
  type TipoMensagem,
  type corpoSalvarCampanhaSchema,
} from "../../shared/contracts";
import { prepararRegistroAuditoria, type Autoria } from "./auditoria";

/** Corpo do PUT depois da validação (com os padrões de fuso_horario e publico já aplicados). */
export type DadosCampanha = z.output<typeof corpoSalvarCampanhaSchema>;

export type ResultadoSalvarCampanha =
  | { ok: true; campanha: Campanha }
  | {
      ok: false;
      codigo: "nome_duplicado";
      mensagem: string;
      detalhes: DetalheValidacao[];
    };

/** Período como está gravado em campanha_periodos. */
export interface PeriodoGravado {
  ordem: number;
  nome: string;
  dias: number;
  percentual_bp: number;
}

/**
 * A campanha ativa como está no banco: as colunas de `campanhas` e os períodos, na ordem. Não passa
 * pelo contrato: o webhook só usa `id` e `slug_rifei` (e funciona mesmo com uma campanha gravada sem
 * períodos); a resposta da API sai de `montarCampanha`.
 */
export interface CampanhaAtiva {
  id: number;
  nome: string;
  slug_rifei: string;
  fuso_horario: string;
  data_inicio: string;
  preco_bilhete_centavos: number;
  meta_unidade: string;
  meta_regra: string;
  meta_valor: number;
  ranking_criterio: string;
  /** RIFA-061 (D27, migração 0012): 1 = separa o ranking por divisão; 0 = um ranking só. */
  ranking_por_divisao: number;
  publico_mostra_percentual_meta: number;
  publico_limite_ranking: number | null;
  /** Regras do admin (D20, migração 0008): as chaves (0/1) e os modelos (NULL = o padrão do contrato). */
  pedidos_desconsiderar: number;
  acesso_discipuladores: number;
  acesso_redes: number;
  /**
   * RIFA-064 (D29, migração 0013): o login das células com a senha padrão (1 = ligado). No PUT, ausente dentro de
   * `acesso` mantém o gravado (no primeiro PUT, o padrão da coluna: ligado), gravada à parte do UPSERT
   * (GRAVAR_LOGIN_CELULAS_SENHA).
   */
  acesso_celulas_senha: number;
  mensagem_link_coordenacao: string | null;
  mensagem_link_lider: string | null;
  mensagem_link_discipulador: string | null;
  mensagem_link_rede: string | null;
  /** RIFA-075 (D35, migração 0016): quantos números a rifa tem e o número inicial (NULL = automático). */
  bilhetes_quantidade: number;
  bilhetes_numero_inicial: number | null;
  /** RIFA-095 (D43, migração 0022): 1 = envia as notificações de venda (o padrão); 0 = não envia. */
  notificacoes_vendas: number;
  criado_em: string;
  atualizado_em: string;
  periodos: PeriodoGravado[];
}

/** A coluna de cada modelo de mensagem (D20). */
const COLUNA_DA_MENSAGEM = {
  link_coordenacao: "mensagem_link_coordenacao",
  link_lider: "mensagem_link_lider",
  link_discipulador: "mensagem_link_discipulador",
  link_rede: "mensagem_link_rede",
} as const satisfies Record<TipoMensagem, keyof CampanhaAtiva>;

/** O modelo que vale: o gravado ou, com NULL, o padrão do contrato. */
function modeloGravado(campanha: CampanhaAtiva, tipo: TipoMensagem): string {
  return campanha[COLUNA_DA_MENSAGEM[tipo]] ?? MENSAGENS_PADRAO[tipo];
}

/** Linha da consulta: os períodos chegam como texto JSON. */
type LinhaCampanhaAtiva = Omit<CampanhaAtiva, "periodos"> & {
  periodos: string;
};

// A ativa e os períodos dela num comando só (json_group_array devolve "[]" sem períodos).
const SELECIONAR_CAMPANHA_ATIVA = `
  SELECT c.id, c.notificacoes_vendas, c.nome, c.slug_rifei, c.fuso_horario, c.data_inicio, c.preco_bilhete_centavos,
    c.meta_unidade, c.meta_regra, c.meta_valor, c.ranking_criterio, c.ranking_por_divisao,
    c.publico_mostra_percentual_meta, c.publico_limite_ranking, c.pedidos_desconsiderar,
    c.acesso_discipuladores, c.acesso_redes, c.mensagem_link_coordenacao, c.mensagem_link_lider,
    c.mensagem_link_discipulador, c.mensagem_link_rede, c.acesso_celulas_senha, c.bilhetes_quantidade,
    c.bilhetes_numero_inicial, c.criado_em, c.atualizado_em,
    (SELECT json_group_array(json_object('ordem', p.ordem, 'nome', p.nome, 'dias', p.dias,
        'percentual_bp', p.percentual_bp))
      FROM campanha_periodos AS p WHERE p.campanha_id = c.id) AS periodos
  FROM campanhas AS c WHERE c.ativa = 1 LIMIT 1`;

const ID_DA_ATIVA = "(SELECT id FROM campanhas WHERE ativa = 1)";

// Cria a campanha ativa ou, se já existe uma, troca a configuração dela (upsert pelo índice parcial
// campanhas_uma_ativa). criado_em fica como estava; atualizado_em vira o instante da gravação.
// Regras do admin (D20): ?12 a ?14 são as chaves (null = grupo ausente: o padrão no INSERT, o gravado no UPDATE);
// ?15 = 1 quando o grupo `mensagens` veio, e ?16 a ?19 são os modelos (null = o padrão do contrato).
// RIFA-061 (D27): ?20 é `ranking.por_divisao` (null = ausente: o padrão no INSERT, o gravado no UPDATE).
// RIFA-075 (D35): ?21 = 1 quando o grupo `bilhetes` veio; ?22 a quantidade e ?23 o número inicial (null = automático).
const GRAVAR_CAMPANHA = `
  INSERT INTO campanhas (nome, slug_rifei, ativa, fuso_horario, data_inicio, preco_bilhete_centavos,
    meta_unidade, meta_regra, meta_valor, ranking_criterio, publico_mostra_percentual_meta,
    publico_limite_ranking, pedidos_desconsiderar, acesso_discipuladores, acesso_redes,
    mensagem_link_coordenacao, mensagem_link_lider, mensagem_link_discipulador, mensagem_link_rede,
    ranking_por_divisao, bilhetes_quantidade, bilhetes_numero_inicial)
  VALUES (?1, ?2, 1, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, coalesce(?12, 0), coalesce(?13, 1),
    coalesce(?14, 1), ?16, ?17, ?18, ?19, coalesce(?20, 1), CASE WHEN ?21 = 1 THEN ?22 ELSE ${BILHETES_PADRAO.quantidade} END,
    CASE WHEN ?21 = 1 THEN ?23 ELSE NULL END)
  ON CONFLICT (ativa) WHERE ativa = 1 DO UPDATE SET
    nome = excluded.nome,
    slug_rifei = excluded.slug_rifei,
    fuso_horario = excluded.fuso_horario,
    data_inicio = excluded.data_inicio,
    preco_bilhete_centavos = excluded.preco_bilhete_centavos,
    meta_unidade = excluded.meta_unidade,
    meta_regra = excluded.meta_regra,
    meta_valor = excluded.meta_valor,
    ranking_criterio = excluded.ranking_criterio,
    ranking_por_divisao = coalesce(?20, ranking_por_divisao),
    publico_mostra_percentual_meta = excluded.publico_mostra_percentual_meta,
    publico_limite_ranking = excluded.publico_limite_ranking,
    pedidos_desconsiderar = coalesce(?12, pedidos_desconsiderar),
    acesso_discipuladores = coalesce(?13, acesso_discipuladores),
    acesso_redes = coalesce(?14, acesso_redes),
    mensagem_link_coordenacao = CASE WHEN ?15 = 1 THEN ?16 ELSE mensagem_link_coordenacao END,
    mensagem_link_lider = CASE WHEN ?15 = 1 THEN ?17 ELSE mensagem_link_lider END,
    mensagem_link_discipulador = CASE WHEN ?15 = 1 THEN ?18 ELSE mensagem_link_discipulador END,
    mensagem_link_rede = CASE WHEN ?15 = 1 THEN ?19 ELSE mensagem_link_rede END,
    bilhetes_quantidade = CASE WHEN ?21 = 1 THEN ?22 ELSE bilhetes_quantidade END,
    bilhetes_numero_inicial = CASE WHEN ?21 = 1 THEN ?23 ELSE bilhetes_numero_inicial END,
    atualizado_em = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')`;

/**
 * RIFA-064 (D29): a chave do login das células com senha, num comando à parte do UPSERT, no mesmo lote (depois dele):
 * só quando o corpo traz `acesso.celulas_senha`. Ausente, a coluna fica como está (no primeiro PUT, o DEFAULT 1 da
 * 0013).
 */
const GRAVAR_LOGIN_CELULAS_SENHA =
  "UPDATE campanhas SET acesso_celulas_senha = ?1 WHERE ativa = 1";

/**
 * RIFA-095 (D43): a opção das notificações de venda, como a chave acima: à parte do UPSERT, no mesmo lote (depois
 * dele), só quando o corpo traz `notificacoes`. Ausente, a coluna fica como está (no primeiro PUT, o DEFAULT 1 da 0022).
 */
const GRAVAR_NOTIFICACOES =
  "UPDATE campanhas SET notificacoes_vendas = ?1 WHERE ativa = 1";

/** Chave (0/1) para o bind; null = grupo ausente. */
const chave = (valor: boolean | undefined): number | null =>
  valor === undefined ? null : valor ? 1 : 0;

/** O modelo para gravar: igual ao padrão do contrato vira NULL (= o padrão). */
const modeloParaGravar = (tipo: TipoMensagem, modelo: string): string | null =>
  modelo === MENSAGENS_PADRAO[tipo] ? null : modelo;

function campanhaDaLinha(
  linha: LinhaCampanhaAtiva | null | undefined,
): CampanhaAtiva | null {
  if (!linha) return null;
  // A ordem dos itens do json_group_array não é garantida: ordena aqui.
  const periodos = (JSON.parse(linha.periodos) as PeriodoGravado[]).sort(
    (a, b) => a.ordem - b.ordem,
  );
  return { ...linha, periodos };
}

/**
 * A campanha ativa (no máximo uma), ou null enquanto nenhuma foi ativada. É a única leitura dela:
 * o webhook (D5) e a configuração (GET e PUT /api/admin/campanha) usam esta função.
 */
export async function buscarCampanhaAtiva(
  db: D1Database,
): Promise<CampanhaAtiva | null> {
  return campanhaDaLinha(
    await db.prepare(SELECIONAR_CAMPANHA_ATIVA).first<LinhaCampanhaAtiva>(),
  );
}

/** Os grupos da campanha que só o admin muda (RIFA-042, adendo da D20). */
export const GRUPOS_DO_ADMIN = ["pedidos", "acesso", "mensagens"] as const;
export type GrupoDoAdmin = (typeof GRUPOS_DO_ADMIN)[number];

/**
 * Os grupos só do admin que o corpo do PUT muda em relação ao gravado (sem campanha, aos padrões, que é o que o
 * primeiro PUT grava com o grupo ausente). Grupo ausente não muda nada. Os modelos comparados são os que valem
 * (NULL = o padrão do contrato), já sem os espaços das pontas (o schema da entrada tira).
 */
export function gruposDoAdminAlterados(
  antes: CampanhaAtiva | null,
  depois: DadosCampanha,
): GrupoDoAdmin[] {
  const gravado = {
    desconsiderar:
      antes === null
        ? PEDIDOS_PADRAO.desconsiderar
        : antes.pedidos_desconsiderar === 1,
    discipuladores:
      antes === null
        ? ACESSO_PADRAO.discipuladores
        : antes.acesso_discipuladores === 1,
    redes: antes === null ? ACESSO_PADRAO.redes : antes.acesso_redes === 1,
    celulasSenha:
      antes === null
        ? ACESSO_PADRAO.celulas_senha
        : antes.acesso_celulas_senha === 1,
    modelo: (tipo: TipoMensagem) =>
      antes === null ? MENSAGENS_PADRAO[tipo] : modeloGravado(antes, tipo),
  };
  const { pedidos, acesso, mensagens } = depois;
  const alterados: GrupoDoAdmin[] = [];
  if (pedidos !== undefined && pedidos.desconsiderar !== gravado.desconsiderar)
    alterados.push("pedidos");
  if (
    acesso !== undefined &&
    (acesso.discipuladores !== gravado.discipuladores ||
      acesso.redes !== gravado.redes ||
      // RIFA-064 (D29): ausente mantém o gravado (não muda nada).
      (acesso.celulas_senha !== undefined &&
        acesso.celulas_senha !== gravado.celulasSenha))
  )
    alterados.push("acesso");
  if (
    mensagens !== undefined &&
    TIPOS_MENSAGEM.some((tipo) => mensagens[tipo] !== gravado.modelo(tipo))
  )
    alterados.push("mensagens");
  return alterados;
}

/**
 * O corpo sem os grupos só do admin. Na gravação, grupo ausente mantém o gravado (D20): o PUT da coordenação que
 * passou na conferência (grupos ausentes ou iguais ao gravado) nunca escreve essas colunas, nem desfaz o que um admin
 * gravar entre a leitura e o lote.
 */
export function semGruposDoAdmin(dados: DadosCampanha): DadosCampanha {
  const resto = { ...dados };
  delete resto.pedidos;
  delete resto.acesso;
  delete resto.mensagens;
  return resto;
}

/** Uma chave das regras do admin na trilha ("ligado" ou "desligado"). */
const ligado = (valor: boolean) => (valor ? "ligado" : "desligado");

/**
 * O resumo do primeiro salvamento, o que cria e ativa a campanha: o slug e o preço e, desde a RIFA-043, como nasceram
 * as regras do admin (D20), no formato dos salvamentos seguintes sem o antes: cada chave com o valor gravado (o do
 * corpo ou, com o grupo ausente, o padrão, que é o que o INSERT grava) e, das mensagens, só o nome de cada modelo
 * diferente do padrão (o texto não vai para a trilha). Sem dado pessoal.
 */
function resumirCriacaoDaCampanha(depois: DadosCampanha): string {
  const chaves: [string, boolean][] = [
    [
      "pedidos.desconsiderar",
      depois.pedidos?.desconsiderar ?? PEDIDOS_PADRAO.desconsiderar,
    ],
    [
      "acesso.discipuladores",
      depois.acesso?.discipuladores ?? ACESSO_PADRAO.discipuladores,
    ],
    ["acesso.redes", depois.acesso?.redes ?? ACESSO_PADRAO.redes],
    [
      "acesso.celulas_senha",
      depois.acesso?.celulas_senha ?? ACESSO_PADRAO.celulas_senha,
    ],
  ];
  const { mensagens } = depois;
  const editadas =
    mensagens === undefined
      ? []
      : TIPOS_MENSAGEM.filter(
          (tipo) => mensagens[tipo] !== MENSAGENS_PADRAO[tipo],
        );
  // RIFA-061 (D27): o ranking por divisão só entra quando nasce desligado (ligado é o padrão de sempre).
  const porDivisao =
    (depois.ranking.por_divisao ?? RANKING_POR_DIVISAO_PADRAO)
      ? []
      : [`ranking.por_divisao: ${ligado(false)}`];
  return [
    `Campanha criada: slug_rifei ${JSON.stringify(depois.slug_rifei)}`,
    `preco_bilhete_centavos ${depois.preco_bilhete_centavos}`,
    ...chaves.map(([nome, valor]) => `${nome}: ${ligado(valor)}`),
    ...porDivisao,
    ...editadas.map((tipo) => `mensagens.${tipo}`),
    // RIFA-095 (D43): as notificações de venda só entram quando nascem desligadas (ligadas é o padrão).
    ...((depois.notificacoes?.vendas ?? NOTIFICACOES_PADRAO.vendas)
      ? []
      : [`notificacoes.vendas: ${ligado(false)}`]),
  ].join(", ");
}

/**
 * O que um PUT muda, para a trilha de auditoria (sem dados pessoais: a campanha é só configuração). O slug
 * e o preço saem com o antes e o depois: o slug decide quais vendas contam (D5) e o preço é a base da
 * plausibilidade do webhook; os demais campos saem só pelo nome. O primeiro PUT (sem `antes`) sai como
 * resumirCriacaoDaCampanha.
 */
export function resumirMudancaDaCampanha(
  antes: CampanhaAtiva | null,
  depois: DadosCampanha,
): string {
  if (antes === null) return resumirCriacaoDaCampanha(depois);
  const alterados: string[] = [];
  if (antes.nome !== depois.nome) alterados.push("nome");
  if (antes.slug_rifei !== depois.slug_rifei)
    alterados.push(
      `slug_rifei (${JSON.stringify(antes.slug_rifei)} → ${JSON.stringify(depois.slug_rifei)})`,
    );
  if (antes.fuso_horario !== depois.fuso_horario)
    alterados.push("fuso_horario");
  if (antes.data_inicio !== depois.data_inicio) alterados.push("data_inicio");
  if (antes.preco_bilhete_centavos !== depois.preco_bilhete_centavos)
    alterados.push(
      `preco_bilhete_centavos (${antes.preco_bilhete_centavos} → ${depois.preco_bilhete_centavos})`,
    );
  if (
    antes.meta_unidade !== depois.meta.unidade ||
    antes.meta_regra !== depois.meta.regra ||
    antes.meta_valor !== depois.meta.valor
  )
    alterados.push("meta");
  const periodos = (lista: readonly Omit<PeriodoGravado, "ordem">[]) =>
    JSON.stringify(
      lista.map(({ nome, dias, percentual_bp }) => [nome, dias, percentual_bp]),
    );
  if (periodos(antes.periodos) !== periodos(depois.periodos))
    alterados.push("periodos");
  if (antes.ranking_criterio !== depois.ranking.criterio)
    alterados.push("ranking");
  // RIFA-061 (D27): a opção, com o antes e o depois (ausente no corpo mantém o gravado: não muda nada).
  const { por_divisao } = depois.ranking;
  if (
    por_divisao !== undefined &&
    (antes.ranking_por_divisao === 1) !== por_divisao
  )
    alterados.push(
      `ranking.por_divisao: ${ligado(antes.ranking_por_divisao === 1)} → ${ligado(por_divisao)}`,
    );
  // RIFA-075 (D35): os números da rifa, com o antes e o depois (ausente no corpo mantém o gravado).
  const { bilhetes } = depois;
  if (
    bilhetes !== undefined &&
    (antes.bilhetes_quantidade !== bilhetes.quantidade ||
      antes.bilhetes_numero_inicial !== bilhetes.numero_inicial)
  )
    alterados.push(
      `bilhetes (${antes.bilhetes_quantidade}/${antes.bilhetes_numero_inicial ?? "auto"} → ${bilhetes.quantidade}/${bilhetes.numero_inicial ?? "auto"})`,
    );
  // RIFA-095 (D43): as notificações de venda, com o antes e o depois (ausente no corpo mantém o gravado).
  const vendas = depois.notificacoes?.vendas;
  if (vendas !== undefined && (antes.notificacoes_vendas !== 0) !== vendas)
    alterados.push(
      `notificacoes.vendas: ${ligado(antes.notificacoes_vendas !== 0)} → ${ligado(vendas)}`,
    );
  if (
    (antes.publico_mostra_percentual_meta === 1) !==
      depois.publico.mostra_percentual_meta ||
    antes.publico_limite_ranking !== depois.publico.limite_ranking
  )
    alterados.push("publico");
  // Regras do admin (D20): cada chave que mudou com o antes e o depois; das mensagens, só o nome do modelo. Grupo
  // ausente no corpo mantém o gravado: não muda nada.
  const chaves: [string, number, boolean | undefined][] = [
    [
      "pedidos.desconsiderar",
      antes.pedidos_desconsiderar,
      depois.pedidos?.desconsiderar,
    ],
    [
      "acesso.discipuladores",
      antes.acesso_discipuladores,
      depois.acesso?.discipuladores,
    ],
    ["acesso.redes", antes.acesso_redes, depois.acesso?.redes],
    [
      "acesso.celulas_senha",
      antes.acesso_celulas_senha,
      depois.acesso?.celulas_senha,
    ],
  ];
  for (const [nome, gravada, nova] of chaves)
    if (nova !== undefined && (gravada === 1) !== nova)
      alterados.push(`${nome}: ${ligado(gravada === 1)} → ${ligado(nova)}`);
  const { mensagens } = depois;
  if (mensagens !== undefined)
    for (const tipo of TIPOS_MENSAGEM)
      if (modeloGravado(antes, tipo) !== mensagens[tipo])
        alterados.push(`mensagens.${tipo}`);
  return alterados.length === 0
    ? "Configuração salva sem mudanças"
    : `Alterado: ${alterados.join(", ")}`;
}

/**
 * Cria a campanha ativa ou substitui a configuração dela, numa transação só. Com `auditoria`, o registro
 * (quem e o resumo) vai no mesmo lote: se a gravação falha, ele também não fica.
 */
export async function salvarCampanhaAtiva(
  db: D1Database,
  dados: DadosCampanha,
  auditoria?: Autoria & { resumo: string },
): Promise<ResultadoSalvarCampanha> {
  const gravacao = [
    db
      .prepare(GRAVAR_CAMPANHA)
      .bind(
        dados.nome,
        dados.slug_rifei,
        dados.fuso_horario,
        dados.data_inicio,
        dados.preco_bilhete_centavos,
        dados.meta.unidade,
        dados.meta.regra,
        dados.meta.valor,
        dados.ranking.criterio,
        dados.publico.mostra_percentual_meta ? 1 : 0,
        dados.publico.limite_ranking,
        chave(dados.pedidos?.desconsiderar),
        chave(dados.acesso?.discipuladores),
        chave(dados.acesso?.redes),
        dados.mensagens === undefined ? 0 : 1,
        ...TIPOS_MENSAGEM.map((tipo) =>
          dados.mensagens === undefined
            ? null
            : modeloParaGravar(tipo, dados.mensagens[tipo]),
        ),
        chave(dados.ranking.por_divisao),
        dados.bilhetes === undefined ? 0 : 1,
        dados.bilhetes?.quantidade ?? null,
        dados.bilhetes?.numero_inicial ?? null,
      ),
    db.prepare(
      `DELETE FROM campanha_periodos WHERE campanha_id = ${ID_DA_ATIVA}`,
    ),
    ...dados.periodos.map((periodo, indice) =>
      db
        .prepare(
          `INSERT INTO campanha_periodos (campanha_id, ordem, nome, dias, percentual_bp)
           VALUES (${ID_DA_ATIVA}, ?, ?, ?, ?)`,
        )
        .bind(indice + 1, periodo.nome, periodo.dias, periodo.percentual_bp),
    ),
    ...(dados.acesso?.celulas_senha === undefined
      ? []
      : [
          db
            .prepare(GRAVAR_LOGIN_CELULAS_SENHA)
            .bind(chave(dados.acesso.celulas_senha)),
        ]),
    ...(dados.notificacoes === undefined
      ? []
      : [
          db
            .prepare(GRAVAR_NOTIFICACOES)
            .bind(chave(dados.notificacoes.vendas)),
        ]),
  ];

  if (auditoria)
    gravacao.push(
      prepararRegistroAuditoria(db, {
        ...auditoria,
        acao: "campanha.salvar",
        // O id da campanha ativa já gravada (no primeiro PUT, ele nasce neste lote).
        alvo: { tipo: "campanha", idSql: ID_DA_ATIVA },
      }),
    );

  let resultados: D1Result[];
  try {
    // A leitura de volta vai na mesma transação: a resposta é o que ficou gravado.
    resultados = await db.batch([
      ...gravacao,
      db.prepare(SELECIONAR_CAMPANHA_ATIVA),
    ]);
  } catch (erro) {
    if (slugJaUsado(erro)) {
      const mensagem =
        "Este slug já pertence a outra campanha (inativa) do sistema";
      return {
        ok: false,
        codigo: "nome_duplicado",
        mensagem,
        detalhes: [
          { caminho: ["slug_rifei"], codigo: "slug_duplicado", mensagem },
        ],
      };
    }
    throw erro;
  }

  const gravada = campanhaDaLinha(
    resultados.at(-1)?.results[0] as LinhaCampanhaAtiva | undefined,
  );
  if (!gravada) throw new Error("A campanha gravada não foi encontrada");
  return { ok: true, campanha: montarCampanha(gravada) };
}

/** A campanha no formato do contrato, com as datas dos períodos, a data final e a soma calculadas. */
export function montarCampanha(campanha: CampanhaAtiva): Campanha {
  const { periodos } = campanha;
  const calendario = calcularCalendario(campanha.data_inicio, periodos);
  // O parse garante a resposta no formato do contrato (enums, datas, faixas), mesmo se o banco
  // tiver sido mexido à mão.
  return respostaCampanhaSchema.parse({
    id: campanha.id,
    nome: campanha.nome,
    slug_rifei: campanha.slug_rifei,
    fuso_horario: campanha.fuso_horario,
    data_inicio: campanha.data_inicio,
    data_fim: calendario.data_fim,
    preco_bilhete_centavos: campanha.preco_bilhete_centavos,
    meta: {
      unidade: campanha.meta_unidade,
      regra: campanha.meta_regra,
      valor: campanha.meta_valor,
    },
    periodos: periodos.map((periodo, indice) => ({
      ordem: periodo.ordem,
      nome: periodo.nome,
      dias: periodo.dias,
      percentual_bp: periodo.percentual_bp,
      ...calendario.periodos[indice],
    })),
    soma_percentuais_bp: somarPercentuais(periodos),
    ranking: {
      criterio: campanha.ranking_criterio,
      // Só 0 desliga: uma linha lida sem a coluna (antes da 0012) fica com o padrão, que é o que vale.
      por_divisao: campanha.ranking_por_divisao !== 0,
    },
    publico: {
      mostra_percentual_meta: campanha.publico_mostra_percentual_meta === 1,
      limite_ranking: campanha.publico_limite_ranking,
    },
    pedidos: { desconsiderar: campanha.pedidos_desconsiderar === 1 },
    acesso: {
      discipuladores: campanha.acesso_discipuladores === 1,
      redes: campanha.acesso_redes === 1,
      // RIFA-064 (D29): só 0 desliga (uma linha lida sem a coluna, antes da 0013, fica com o padrão: ligado).
      celulas_senha: campanha.acesso_celulas_senha !== 0,
    },
    mensagens: Object.fromEntries(
      TIPOS_MENSAGEM.map((tipo) => [tipo, modeloGravado(campanha, tipo)]),
    ),
    // RIFA-075 (D35): uma linha lida sem as colunas (antes da 0016) fica com o padrão.
    bilhetes: {
      quantidade: campanha.bilhetes_quantidade ?? BILHETES_PADRAO.quantidade,
      numero_inicial: campanha.bilhetes_numero_inicial ?? null,
    },
    // RIFA-095 (D43): só 0 desliga (uma linha lida sem a coluna, antes da 0022, fica com o padrão: ligada).
    notificacoes: {
      vendas:
        campanha.notificacoes_vendas === undefined
          ? NOTIFICACOES_PADRAO.vendas
          : campanha.notificacoes_vendas !== 0,
    },
    criado_em: campanha.criado_em,
    atualizado_em: campanha.atualizado_em,
  });
}

/** O slug só colide com uma campanha inativa (a ativa é a própria linha atualizada). */
function slugJaUsado(erro: unknown): boolean {
  return (
    erro instanceof Error &&
    erro.message.includes("UNIQUE constraint failed: campanhas.slug_rifei")
  );
}
