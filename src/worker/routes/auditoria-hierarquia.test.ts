// RIFA-018: trilha de auditoria no CRUD da hierarquia, no app real (exports.default.fetch). POST, PUT e DELETE de
// redes, discipuladores e células deixam uma linha cada (hierarquia.criar, hierarquia.atualizar e
// hierarquia.remover), no MESMO lote da gravação, com o nome do item, o antes e o depois do que mudou e nenhum dado
// pessoal (nome, e-mail e telefone do líder, nome do responsável da rede). Ação recusada (400, 404, 409) e PUT igual
// ao gravado não registram nada. A remoção diz qual acesso da hierarquia caiu junto (D12).
import { env, exports } from "cloudflare:workers";
import { beforeAll, describe, expect, it, onTestFinished } from "vitest";
import { respostaAuditoriaSchema } from "../../shared/contracts";
import {
  ORIGEM,
  cabecalhosDeSessao,
  criarAcessoDaHierarquiaNoBanco,
} from "../test/acesso-teste";

let coordenacao: Record<string, string>;
let admin: Record<string, string>;
let coordenacaoId: number;

async function requisitar(
  metodo: string,
  caminho: string,
  cabecalhos: Record<string, string>,
  corpo?: unknown,
): Promise<Response> {
  return exports.default.fetch(`${ORIGEM}${caminho}`, {
    method: metodo,
    headers: { "Content-Type": "application/json", ...cabecalhos },
    body: corpo === undefined ? undefined : JSON.stringify(corpo),
  });
}

interface Linha {
  usuario_id: number;
  acao: string;
  alvo: string;
  resumo: string;
}

async function ultimoId(): Promise<number> {
  const linha = await env.DB.prepare(
    "SELECT coalesce(max(id), 0) AS id FROM auditoria",
  ).first<{ id: number }>();
  return linha!.id;
}

/** Faz a ação (como a coordenação, se nada mais for dito) e devolve o status, o corpo e o que ficou na trilha. */
async function comTrilha(
  metodo: string,
  caminho: string,
  corpo?: unknown,
  cabecalhos = coordenacao,
) {
  const desde = await ultimoId();
  const res = await requisitar(metodo, caminho, cabecalhos, corpo);
  const texto = await res.text();
  const { results } = await env.DB.prepare(
    "SELECT usuario_id, acao, alvo, resumo FROM auditoria WHERE id > ?1 ORDER BY id",
  )
    .bind(desde)
    .all<Linha>();
  return {
    status: res.status,
    corpo: (texto === "" ? null : JSON.parse(texto)) as { id: number } | null,
    registros: results,
  };
}

/** Cria pela API e devolve o id (a linha da trilha da criação é conferida em CA1). */
async function criar(caminho: string, corpo: object): Promise<number> {
  const { status, corpo: criado } = await comTrilha("POST", caminho, corpo);
  expect(status).toBe(201);
  return criado!.id;
}

const CELULA = {
  qtd_pessoas: 12,
  lider_nome: "Lider Ficticio da Trilha",
  lider_email: "lider.trilha@example.com",
  lider_telefone: "(91) 90000-0777",
};

/** Nada de dado pessoal no que a trilha guardou. */
function semDadoPessoal(registros: Linha[]) {
  const texto = JSON.stringify(registros);
  for (const pessoal of [
    "Pastor",
    "Lider Ficticio",
    "Outro Lider",
    "lider.trilha@",
    "outro.lider@",
    "90000-0777",
  ])
    expect({ pessoal, presente: texto.includes(pessoal) }).toEqual({
      pessoal,
      presente: false,
    });
}

beforeAll(async () => {
  coordenacao = await cabecalhosDeSessao("coordenacao");
  admin = await cabecalhosDeSessao("admin");
  const res = await requisitar("GET", "/api/sessao", coordenacao);
  coordenacaoId = ((await res.json()) as { usuario: { id: number } }).usuario
    .id;
});

describe("CA1: criar, atualizar e remover gravam uma linha cada, com o resumo certo e sem dado pessoal", () => {
  it("rede, discipulador e célula: o nome do item, ids e qtd_pessoas; dos dados pessoais, só o nome do campo", async () => {
    const passos: { status: number; registros: Linha[] }[] = [];
    const passo = async (metodo: string, caminho: string, corpo?: object) => {
      const resultado = await comTrilha(metodo, caminho, corpo);
      passos.push(resultado);
      return resultado;
    };

    const rede = (await passo("POST", "/api/admin/redes", {
      nome: "Rede da Trilha",
      divisao: "jovens",
    }))!.corpo!.id;
    const outraRede = await criar("/api/admin/redes", {
      nome: "Outra Rede da Trilha",
      divisao: "adultos",
    });
    const discipulador = (await passo("POST", "/api/admin/discipuladores", {
      rede_id: rede,
      nome: "Discipulador da Trilha",
    }))!.corpo!.id;
    const celula = (await passo("POST", "/api/admin/celulas", {
      discipulador_id: discipulador,
      nome: "Celula da Trilha",
      ...CELULA,
    }))!.corpo!.id;

    await passo("PUT", `/api/admin/redes/${rede}`, {
      nome: "Rede da Trilha Renomeada",
      divisao: "adultos",
      responsavel_nome: "Pastor Ficticio da Trilha",
    });
    await passo("PUT", `/api/admin/discipuladores/${discipulador}`, {
      rede_id: outraRede,
      nome: "Discipulador da Trilha",
    });
    // A meta e o ranking dependem de qtd_pessoas: o antes e o depois. Do líder, só o que mudou, sem o valor.
    await passo("PUT", `/api/admin/celulas/${celula}`, {
      discipulador_id: discipulador,
      nome: "Celula da Trilha",
      qtd_pessoas: 15,
      lider_nome: "Outro Lider Ficticio",
      lider_email: "outro.lider@example.com",
      lider_telefone: null,
    });

    await passo("DELETE", `/api/admin/celulas/${celula}`);
    await passo("DELETE", `/api/admin/discipuladores/${discipulador}`);
    await passo("DELETE", `/api/admin/redes/${rede}`);

    expect(passos.map(({ status }) => status)).toEqual([
      201, 201, 201, 200, 200, 200, 204, 204, 204,
    ]);
    const registros = passos.map(({ registros }) => {
      expect(registros).toHaveLength(1);
      return registros[0];
    });
    expect(registros).toEqual([
      {
        usuario_id: coordenacaoId,
        acao: "hierarquia.criar",
        alvo: `rede:${rede}`,
        resumo: 'Rede "Rede da Trilha" criada (divisao jovens)',
      },
      {
        usuario_id: coordenacaoId,
        acao: "hierarquia.criar",
        alvo: `discipulador:${discipulador}`,
        resumo: `Discipulador "Discipulador da Trilha" criado (rede_id ${rede})`,
      },
      {
        usuario_id: coordenacaoId,
        acao: "hierarquia.criar",
        alvo: `celula:${celula}`,
        resumo: `Célula "Celula da Trilha" criada (discipulador_id ${discipulador}, qtd_pessoas 12)`,
      },
      {
        usuario_id: coordenacaoId,
        acao: "hierarquia.atualizar",
        alvo: `rede:${rede}`,
        resumo:
          'Rede "Rede da Trilha Renomeada" alterada: nome ("Rede da Trilha" → "Rede da Trilha Renomeada"), divisao (jovens → adultos), responsavel_nome (informado)',
      },
      {
        usuario_id: coordenacaoId,
        acao: "hierarquia.atualizar",
        alvo: `discipulador:${discipulador}`,
        resumo: `Discipulador "Discipulador da Trilha" alterado: rede_id (${rede} → ${outraRede})`,
      },
      {
        usuario_id: coordenacaoId,
        acao: "hierarquia.atualizar",
        alvo: `celula:${celula}`,
        resumo:
          'Célula "Celula da Trilha" alterada: qtd_pessoas (12 → 15), lider_nome (alterado), lider_email (alterado), lider_telefone (apagado)',
      },
      {
        usuario_id: coordenacaoId,
        acao: "hierarquia.remover",
        alvo: `celula:${celula}`,
        resumo: `Célula "Celula da Trilha" removida (discipulador_id ${discipulador}, qtd_pessoas 15)`,
      },
      {
        usuario_id: coordenacaoId,
        acao: "hierarquia.remover",
        alvo: `discipulador:${discipulador}`,
        resumo: `Discipulador "Discipulador da Trilha" removido (rede_id ${outraRede})`,
      },
      {
        usuario_id: coordenacaoId,
        acao: "hierarquia.remover",
        alvo: `rede:${rede}`,
        resumo: 'Rede "Rede da Trilha Renomeada" removida (divisao adultos)',
      },
    ]);
    semDadoPessoal(registros);

    // A leitura da trilha (só admin) traz as linhas novas no formato do contrato.
    const res = await requisitar(
      "GET",
      "/api/admin/auditoria?limite=20",
      admin,
    );
    const { itens } = respostaAuditoriaSchema.parse(await res.json());
    expect(itens.map(({ acao, alvo }) => `${acao} ${alvo}`)).toEqual(
      expect.arrayContaining([
        `hierarquia.remover rede:${rede}`,
        `hierarquia.atualizar celula:${celula}`,
        `hierarquia.criar discipulador:${discipulador}`,
      ]),
    );
  });

  it("o nome no resumo sai como JSON (aspas e barras escapadas) e a troca só de maiúsculas aparece", async () => {
    const rede = await criar("/api/admin/redes", {
      nome: 'Rede "Aspas" da Trilha',
      divisao: "jovens",
    });
    const { status, registros } = await comTrilha(
      "PUT",
      `/api/admin/redes/${rede}`,
      { nome: 'REDE "ASPAS" DA TRILHA', divisao: "jovens" },
    );
    expect(status).toBe(200);
    expect(registros.map(({ resumo }) => resumo)).toEqual([
      'Rede "REDE \\"ASPAS\\" DA TRILHA" alterada: nome ("Rede \\"Aspas\\" da Trilha" → "REDE \\"ASPAS\\" DA TRILHA")',
    ]);
  });
});

describe("CA2: ação recusada (400, 404, 409) não grava nada", () => {
  it("POST, PUT e DELETE recusados, inclusive a exclusão recusada pelo banco dentro do lote", async () => {
    const rede = await criar("/api/admin/redes", {
      nome: "Rede das Recusas",
      divisao: "jovens",
    });
    const discipulador = await criar("/api/admin/discipuladores", {
      rede_id: rede,
      nome: "Discipulador das Recusas",
    });
    const celula = await criar("/api/admin/celulas", {
      discipulador_id: discipulador,
      nome: "Celula das Recusas",
      ...CELULA,
    });
    const celulaComAfiliado = await criar("/api/admin/celulas", {
      discipulador_id: discipulador,
      nome: "Celula com Afiliado das Recusas",
      ...CELULA,
    });
    await env.DB.prepare(
      `INSERT INTO afiliados (affiliate_id, celula_id, origem, vinculado_em)
       VALUES (8181, ?1, 'manual', '2026-11-20T12:00:00.000Z')`,
    )
      .bind(celulaComAfiliado)
      .run();
    // Sem dependentes, mas com o acesso do líder como autor na trilha: o DELETE passa das conferências e é
    // recusado pela FK RESTRICT da trilha dentro do lote, depois do registro (que é desfeito junto).
    const celulaPresa = await criar("/api/admin/celulas", {
      discipulador_id: discipulador,
      nome: "Celula Presa pela Trilha",
      ...CELULA,
    });
    const acesso = await criarAcessoDaHierarquiaNoBanco("lider", celulaPresa);
    await env.DB.prepare(
      `INSERT INTO auditoria (usuario_id, em, acao, alvo, resumo)
       VALUES (?1, '2026-11-20T12:00:00.000Z', 'link.criar', 'link:1', 'Registro de teste')`,
    )
      .bind(acesso.usuarioId)
      .run();
    onTestFinished(async () => {
      await env.DB.prepare("DELETE FROM auditoria WHERE usuario_id = ?1")
        .bind(acesso.usuarioId)
        .run();
    });

    const celulaValida = {
      discipulador_id: discipulador,
      nome: "Celula das Recusas",
      ...CELULA,
    };
    const casos: [string, string, object | undefined, number, string][] = [
      [
        "POST",
        "/api/admin/redes",
        { nome: "", divisao: "jovens" },
        400,
        "requisicao_invalida",
      ],
      [
        "POST",
        "/api/admin/discipuladores",
        { rede_id: 999_999, nome: "Disc Sem Rede" },
        400,
        "referencia_invalida",
      ],
      [
        "POST",
        "/api/admin/redes",
        { nome: "REDE DAS RECUSAS", divisao: "adultos" },
        409,
        "nome_duplicado",
      ],
      ["PUT", "/api/admin/celulas/999999", celulaValida, 404, "nao_encontrado"],
      [
        "PUT",
        `/api/admin/celulas/${celula}`,
        { ...celulaValida, discipulador_id: 999_999 },
        400,
        "referencia_invalida",
      ],
      [
        "PUT",
        `/api/admin/celulas/${celula}`,
        { ...celulaValida, nome: "Celula Presa pela Trilha" },
        409,
        "nome_duplicado",
      ],
      [
        "PUT",
        `/api/admin/celulas/${celula}`,
        { ...celulaValida, qtd_pessoas: 0 },
        400,
        "requisicao_invalida",
      ],
      [
        "DELETE",
        "/api/admin/discipuladores/999999",
        undefined,
        404,
        "nao_encontrado",
      ],
      ["DELETE", `/api/admin/redes/${rede}`, undefined, 409, "em_uso"],
      [
        "DELETE",
        `/api/admin/discipuladores/${discipulador}`,
        undefined,
        409,
        "em_uso",
      ],
      [
        "DELETE",
        `/api/admin/celulas/${celulaComAfiliado}`,
        undefined,
        409,
        "em_uso",
      ],
      ["DELETE", `/api/admin/celulas/${celulaPresa}`, undefined, 409, "em_uso"],
    ];
    for (const [metodo, caminho, corpo, status, codigo] of casos) {
      const resultado = await comTrilha(metodo, caminho, corpo);
      expect({
        metodo,
        caminho,
        status: resultado.status,
        codigo: (resultado.corpo as { erro?: { codigo: string } } | null)?.erro
          ?.codigo,
        registros: resultado.registros,
      }).toEqual({ metodo, caminho, status, codigo, registros: [] });
    }
    // A exclusão recusada no lote não apagou a célula nem o acesso dela.
    expect(
      await env.DB.prepare(
        "SELECT count(*) AS total FROM usuarios WHERE id = ?1",
      )
        .bind(acesso.usuarioId)
        .first<{ total: number }>(),
    ).toEqual({ total: 1 });
  });
});

describe("CA3: PUT sem mudança não grava nada", () => {
  it("o mesmo corpo (ou só com espaços a mais, que a gravação normaliza) responde 200 e não registra", async () => {
    const rede = await criar("/api/admin/redes", {
      nome: "Rede Sem Mudanca",
      divisao: "adultos",
      responsavel_nome: "Pastor Ficticio",
    });
    const discipulador = await criar("/api/admin/discipuladores", {
      rede_id: rede,
      nome: "Discipulador Sem Mudanca",
    });
    const celula = await criar("/api/admin/celulas", {
      discipulador_id: discipulador,
      nome: "Celula Sem Mudanca",
      ...CELULA,
    });

    for (const [caminho, corpo] of [
      [
        `/api/admin/redes/${rede}`,
        {
          nome: "  Rede   Sem Mudanca ",
          divisao: "adultos",
          responsavel_nome: "Pastor  Ficticio",
        },
      ],
      [
        `/api/admin/discipuladores/${discipulador}`,
        { rede_id: rede, nome: "Discipulador Sem Mudanca" },
      ],
      [
        `/api/admin/celulas/${celula}`,
        {
          discipulador_id: discipulador,
          nome: "Celula Sem Mudanca",
          ...CELULA,
        },
      ],
    ] as const) {
      const { status, registros } = await comTrilha("PUT", caminho, corpo);
      expect({ caminho, status, registros }).toEqual({
        caminho,
        status: 200,
        registros: [],
      });
    }
  });
});

describe("CA5: remover o alvo com acesso registra o acesso removido junto", () => {
  it.each(["lider", "discipulador", "rede"] as const)(
    "%s: o resumo diz o usuário do acesso que caiu (sem o nome da pessoa) e o usuário some",
    async (papel) => {
      const rede = await criar("/api/admin/redes", {
        nome: `Rede do Acesso ${papel}`,
        divisao: "jovens",
        responsavel_nome: "Pastor Ficticio do Acesso",
      });
      const discipulador = await criar("/api/admin/discipuladores", {
        rede_id: rede,
        nome: `Discipulador do Acesso ${papel}`,
      });
      const celula = await criar("/api/admin/celulas", {
        discipulador_id: discipulador,
        nome: `Celula do Acesso ${papel}`,
        ...CELULA,
      });
      // Para apagar o discipulador, ele fica sem células; para apagar a rede, ela fica sem discipuladores.
      if (papel !== "lider")
        await requisitar("DELETE", `/api/admin/celulas/${celula}`, coordenacao);
      if (papel === "rede")
        await requisitar(
          "DELETE",
          `/api/admin/discipuladores/${discipulador}`,
          coordenacao,
        );
      const { caminho, alvoId, resumo } = {
        lider: {
          caminho: "/api/admin/celulas",
          alvoId: celula,
          resumo: `Célula "Celula do Acesso lider" removida (discipulador_id ${discipulador}, qtd_pessoas 12); acesso do líder removido junto`,
        },
        discipulador: {
          caminho: "/api/admin/discipuladores",
          alvoId: discipulador,
          resumo: `Discipulador "Discipulador do Acesso discipulador" removido (rede_id ${rede}); acesso do discipulador removido junto`,
        },
        rede: {
          caminho: "/api/admin/redes",
          alvoId: rede,
          resumo:
            'Rede "Rede do Acesso rede" removida (divisao jovens); acesso da rede removido junto',
        },
      }[papel];
      const acesso = await criarAcessoDaHierarquiaNoBanco(papel, alvoId);

      const remocao = await comTrilha("DELETE", `${caminho}/${alvoId}`);

      expect(remocao.status).toBe(204);
      expect(remocao.registros).toEqual([
        {
          usuario_id: coordenacaoId,
          acao: "hierarquia.remover",
          alvo: `${{ lider: "celula", discipulador: "discipulador", rede: "rede" }[papel]}:${alvoId}`,
          resumo: `${resumo}, usuário ${acesso.usuarioId} (com os links e as sessões)`,
        },
      ]);
      semDadoPessoal(remocao.registros);
      // O usuário do acesso, com os links, caiu em cascata.
      expect(
        await env.DB.prepare(
          "SELECT (SELECT count(*) FROM usuarios WHERE id = ?1) + (SELECT count(*) FROM links_acesso WHERE usuario_id = ?1) AS total",
        )
          .bind(acesso.usuarioId)
          .first<{ total: number }>(),
      ).toEqual({ total: 0 });
    },
  );
});
