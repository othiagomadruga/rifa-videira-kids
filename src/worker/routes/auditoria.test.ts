// RIFA-013b, item 6: trilha de auditoria no app real (exports.default.fetch). Cada ação da coordenação que
// muda a campanha, os vínculos, a hierarquia (importação aplicada) ou os acessos deixa uma linha (quem,
// quando, ação, alvo, resumo SEM dados pessoais) no MESMO lote da ação: ação recusada não registra nada.
// RIFA-018: nos acessos, a ação sem mudança também não registra (o CRUD da hierarquia tem os testes em
// auditoria-hierarquia.test.ts). GET /api/admin/auditoria: só admin, do mais novo para o mais antigo, com cursor.
import { env, exports } from "cloudflare:workers";
import { beforeAll, describe, expect, it, onTestFinished } from "vitest";
import {
  MENSAGENS_PADRAO,
  respostaAuditoriaSchema,
  type RegistroAuditoria,
} from "../../shared/contracts";
import { ORIGEM, cabecalhosDeSessao } from "../test/acesso-teste";
import { DADOS_CAMPANHA } from "../test/painel-apoio";

let admin: Record<string, string>;
let coordenacao: Record<string, string>;
let adminId: number;
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

async function idDaSessao(cabecalhos: Record<string, string>) {
  const res = await requisitar("GET", "/api/sessao", cabecalhos);
  return ((await res.json()) as { usuario: { id: number } }).usuario.id;
}

interface Linha {
  id: number;
  usuario_id: number;
  em: string;
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

/** As linhas gravadas depois de `desde`, na ordem em que entraram. */
async function registrosDepois(desde: number): Promise<Linha[]> {
  const { results } = await env.DB.prepare(
    "SELECT id, usuario_id, em, acao, alvo, resumo FROM auditoria WHERE id > ?1 ORDER BY id",
  )
    .bind(desde)
    .all<Linha>();
  return results;
}

/** Faz a ação e devolve a resposta e o que ela deixou na trilha. */
async function comTrilha(acao: () => Promise<Response>) {
  const desde = await ultimoId();
  const res = await acao();
  return { res, registros: await registrosDepois(desde) };
}

async function criar(caminho: string, corpo: object): Promise<number> {
  const res = await requisitar("POST", caminho, admin, corpo);
  expect(res.status).toBe(201);
  return ((await res.json()) as { id: number }).id;
}

beforeAll(async () => {
  admin = await cabecalhosDeSessao("admin");
  coordenacao = await cabecalhosDeSessao("coordenacao");
  adminId = await idDaSessao(admin);
  coordenacaoId = await idDaSessao(coordenacao);
});

describe("campanha (PUT /api/admin/campanha)", () => {
  it("criar, trocar o slug e o preço e salvar igual: uma linha cada, com quem fez e o que mudou", async () => {
    const criada = await comTrilha(() =>
      requisitar("PUT", "/api/admin/campanha", coordenacao, DADOS_CAMPANHA),
    );
    expect(criada.res.status).toBe(200);
    const { id } = (await criada.res.json()) as { id: number };
    expect(criada.registros).toEqual([
      {
        id: expect.any(Number),
        usuario_id: coordenacaoId,
        em: expect.stringMatching(
          /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/,
        ),
        acao: "campanha.salvar",
        alvo: `campanha:${id}`,
        // RIFA-043: também como as regras do admin nasceram (a coordenação não manda os grupos: os padrões).
        resumo: `Campanha criada: slug_rifei "${DADOS_CAMPANHA.slug_rifei}", preco_bilhete_centavos 2000, pedidos.desconsiderar: desligado, acesso.discipuladores: ligado, acesso.redes: ligado, acesso.celulas_senha: ligado`,
      },
    ]);

    const trocada = await comTrilha(() =>
      requisitar("PUT", "/api/admin/campanha", admin, {
        ...DADOS_CAMPANHA,
        slug_rifei: "slug-trocado-teste",
        preco_bilhete_centavos: 2500,
        periodos: [{ nome: "Única", dias: 21, percentual_bp: 10000 }],
      }),
    );
    expect(trocada.res.status).toBe(200);
    expect(trocada.registros).toEqual([
      expect.objectContaining({
        usuario_id: adminId,
        alvo: `campanha:${id}`,
        resumo: `Alterado: slug_rifei ("${DADOS_CAMPANHA.slug_rifei}" → "slug-trocado-teste"), preco_bilhete_centavos (2000 → 2500), periodos`,
      }),
    ]);

    const igual = await comTrilha(() =>
      requisitar("PUT", "/api/admin/campanha", admin, {
        ...DADOS_CAMPANHA,
        slug_rifei: "slug-trocado-teste",
        preco_bilhete_centavos: 2500,
        periodos: [{ nome: "Única", dias: 21, percentual_bp: 10000 }],
      }),
    );
    expect(igual.registros.map((linha) => linha.resumo)).toEqual([
      "Configuração salva sem mudanças",
    ]);
  });

  it("RIFA-043: o primeiro salvamento (o que ativa a campanha) registra as regras e o nome das mensagens editadas, sem o texto", async () => {
    // Recomeça sem campanha ativa: o PUT a seguir é o primeiro.
    await env.DB.batch([
      env.DB.prepare(
        "DELETE FROM campanha_periodos WHERE campanha_id IN (SELECT id FROM campanhas WHERE ativa = 1)",
      ),
      env.DB.prepare("DELETE FROM campanhas WHERE ativa = 1"),
    ]);
    const modeloLider = "Oi, Maria Ficticia! O link da célula {alvo}: {link}";

    const criada = await comTrilha(() =>
      requisitar("PUT", "/api/admin/campanha", admin, {
        ...DADOS_CAMPANHA,
        slug_rifei: "slug-rifa-043",
        pedidos: { desconsiderar: true },
        acesso: { discipuladores: true, redes: false },
        mensagens: {
          ...MENSAGENS_PADRAO,
          link_lider: modeloLider,
        },
      }),
    );

    expect(criada.res.status).toBe(200);
    const { id } = (await criada.res.json()) as { id: number };
    expect(criada.registros).toEqual([
      expect.objectContaining({
        usuario_id: adminId,
        acao: "campanha.salvar",
        alvo: `campanha:${id}`,
        // Mesmo formato dos salvamentos seguintes ("acesso.redes: ligado → desligado"), sem o antes. As mensagens
        // iguais ao padrão não entram.
        resumo:
          'Campanha criada: slug_rifei "slug-rifa-043", preco_bilhete_centavos 2000, pedidos.desconsiderar: ligado, acesso.discipuladores: ligado, acesso.redes: desligado, acesso.celulas_senha: ligado, mensagens.link_lider',
      }),
    ]);
    // O texto do modelo (que pode ter um nome) não vai para a trilha.
    expect(criada.registros[0].resumo).not.toContain("Maria");
  });

  it("gravação recusada não registra: 409 (slug de outra campanha) e 400 (fora do schema)", async () => {
    await env.DB.prepare(
      `INSERT INTO campanhas (nome, slug_rifei, ativa, data_inicio, preco_bilhete_centavos,
         meta_unidade, meta_regra, meta_valor, ranking_criterio)
       VALUES ('Antiga', 'slug-da-antiga-auditoria', 0, '2025-11-23', 1500, 'bilhetes',
         'por_pessoa', 10, 'percentual_meta')`,
    ).run();

    const duplicado = await comTrilha(() =>
      requisitar("PUT", "/api/admin/campanha", admin, {
        ...DADOS_CAMPANHA,
        slug_rifei: "slug-da-antiga-auditoria",
      }),
    );
    expect(duplicado.res.status).toBe(409);
    expect(duplicado.registros).toEqual([]);

    const invalido = await comTrilha(() =>
      requisitar("PUT", "/api/admin/campanha", admin, { nome: "" }),
    );
    expect(invalido.res.status).toBe(400);
    expect(invalido.registros).toEqual([]);
  });
});

describe("vínculos de afiliado (PUT /api/admin/afiliados/:affiliateId)", () => {
  it("pré-cadastro, troca, desvínculo e rótulo: os ids das células e nunca o texto do rótulo", async () => {
    const redeId = await criar("/api/admin/redes", {
      nome: "Rede da Auditoria",
      divisao: "jovens",
    });
    const discipuladorId = await criar("/api/admin/discipuladores", {
      rede_id: redeId,
      nome: "Discipulador da Auditoria",
    });
    const celula = (nome: string) =>
      criar("/api/admin/celulas", {
        discipulador_id: discipuladorId,
        nome,
        qtd_pessoas: 10,
        lider_nome: `Lider ${nome}`,
      });
    const [celulaA, celulaB] = [
      await celula("Celula Auditoria A"),
      await celula("Celula Auditoria B"),
    ];
    const salvar = (corpo: object) =>
      comTrilha(() =>
        requisitar("PUT", "/api/admin/afiliados/5151", coordenacao, corpo),
      );

    const resumos: string[] = [];
    for (const corpo of [
      { celula_id: celulaA },
      { celula_id: celulaB },
      { celula_id: celulaB, rotulo: "Usuário Rifei de Fulano Ficticio" },
      { celula_id: null, rotulo: null },
    ]) {
      const { res, registros } = await salvar(corpo);
      expect(res.status).toBe(200);
      expect(registros).toHaveLength(1);
      expect(registros[0]).toMatchObject({
        usuario_id: coordenacaoId,
        acao: "afiliado.salvar",
        alvo: "afiliado:5151",
      });
      resumos.push(registros[0].resumo);
    }
    expect(resumos).toEqual([
      `Pré-cadastro: célula ${celulaA}`,
      `Célula: ${celulaA} → ${celulaB}`,
      `Célula ${celulaB} mantida; rótulo alterado`,
      `Célula: ${celulaB} → nenhuma (desvinculado); rótulo apagado`,
    ]);
    expect(resumos.join(" ")).not.toContain("Fulano");
  });

  it("célula inexistente: 400 referencia_invalida, nada gravado e nada registrado", async () => {
    const { res, registros } = await comTrilha(() =>
      requisitar("PUT", "/api/admin/afiliados/6161", coordenacao, {
        celula_id: 999_999,
      }),
    );
    expect(res.status).toBe(400);
    expect(registros).toEqual([]);
  });
});

describe("importação da hierarquia (POST /api/admin/hierarquia/importar)", () => {
  const csv = [
    "rede,divisao,discipulador,celula,qtd_pessoas,lider_nome,lider_email,lider_telefone",
    "Rede Importada Auditoria,adultos,Disc Importado Auditoria,Celula Importada 1,8,Beltrana Ficticia,beltrana@example.com,(91) 90000-0555",
    "Rede Importada Auditoria,adultos,Disc Importado Auditoria,Celula Importada 2,9,Sicrano Ficticio,,",
  ].join("\n");

  it("a simulação e o arquivo com erro não registram; a aplicada registra só as contagens", async () => {
    const simulada = await comTrilha(() =>
      requisitar("POST", "/api/admin/hierarquia/importar", coordenacao, {
        csv,
        simular: true,
      }),
    );
    expect(simulada.res.status).toBe(200);
    expect(simulada.registros).toEqual([]);

    const comErro = await comTrilha(() =>
      requisitar("POST", "/api/admin/hierarquia/importar", coordenacao, {
        csv: `${csv}\nRede X,adultos,Disc X,Celula X,doze,Lider X,,`,
        simular: false,
      }),
    );
    expect(((await comErro.res.json()) as { aplicado: boolean }).aplicado).toBe(
      false,
    );
    expect(comErro.registros).toEqual([]);

    const aplicada = await comTrilha(() =>
      requisitar("POST", "/api/admin/hierarquia/importar", coordenacao, {
        csv,
        simular: false,
      }),
    );
    expect(
      ((await aplicada.res.json()) as { aplicado: boolean }).aplicado,
    ).toBe(true);
    expect(aplicada.registros).toEqual([
      expect.objectContaining({
        usuario_id: coordenacaoId,
        acao: "hierarquia.importar",
        alvo: "hierarquia",
        resumo:
          "Importação aplicada (2 linhas): criados 1 redes, 1 discipuladores e 2 células; atualizados 0 redes, 0 discipuladores e 0 células",
      }),
    ]);
    for (const pessoal of ["Beltrana", "Sicrano", "beltrana@", "90000-0555"])
      expect(aplicada.registros[0].resumo).not.toContain(pessoal);
  });
});

describe("acessos (usuários e links, só admin)", () => {
  it("criar pessoa, gerar link, desativar, reativar e revogar: uma linha cada, sem nome nem e-mail", async () => {
    const criada = await comTrilha(() =>
      requisitar("POST", "/api/admin/usuarios", admin, {
        nome: "Pessoa Auditada Ficticia",
        email: "pessoa.auditada@example.com",
        papel: "coordenacao",
      }),
    );
    expect(criada.res.status).toBe(201);
    const { usuario, link } = (await criada.res.json()) as {
      usuario: { id: number };
      link: { id: number };
    };

    const novoLink = await comTrilha(() =>
      requisitar("POST", `/api/admin/usuarios/${usuario.id}/links`, admin),
    );
    expect(novoLink.res.status).toBe(201);
    const segundo = ((await novoLink.res.json()) as { link: { id: number } })
      .link;

    const desativada = await comTrilha(() =>
      requisitar("PATCH", `/api/admin/usuarios/${usuario.id}`, admin, {
        ativo: false,
      }),
    );
    const reativada = await comTrilha(() =>
      requisitar("PATCH", `/api/admin/usuarios/${usuario.id}`, admin, {
        ativo: true,
      }),
    );
    const revogado = await comTrilha(() =>
      requisitar("DELETE", `/api/admin/links/${link.id}`, admin),
    );
    expect(
      [desativada, reativada, revogado].map(({ res }) => res.status),
    ).toEqual([200, 200, 204]);

    const registros = [criada, novoLink, desativada, reativada, revogado].map(
      ({ registros }) => {
        expect(registros).toHaveLength(1);
        const [{ usuario_id, acao, alvo, resumo }] = registros;
        return { usuario_id, acao, alvo, resumo };
      },
    );
    expect(registros).toEqual([
      {
        usuario_id: adminId,
        acao: "usuario.criar",
        alvo: `usuario:${usuario.id}`,
        resumo: "Acesso criado com o papel coordenacao e um link",
      },
      {
        usuario_id: adminId,
        acao: "link.criar",
        alvo: `link:${segundo.id}`,
        resumo: `Link novo para o usuário ${usuario.id}`,
      },
      {
        usuario_id: adminId,
        acao: "usuario.desativar",
        alvo: `usuario:${usuario.id}`,
        resumo: "Acesso desativado (as sessões foram encerradas)",
      },
      {
        usuario_id: adminId,
        acao: "usuario.ativar",
        alvo: `usuario:${usuario.id}`,
        resumo: "Acesso reativado (os links no prazo voltam a valer)",
      },
      {
        usuario_id: adminId,
        acao: "link.revogar",
        alvo: `link:${link.id}`,
        resumo: `Link do usuário ${usuario.id} revogado (as sessões abertas por ele foram encerradas)`,
      },
    ]);
    const texto = JSON.stringify(registros);
    expect(texto).not.toContain("Pessoa Auditada");
    expect(texto).not.toContain("pessoa.auditada@");
  });

  it("ação recusada não registra: desativar a si mesmo (409), link para quem não existe (404), revogar link inexistente (404)", async () => {
    for (const [metodo, caminho, corpo, status] of [
      ["PATCH", `/api/admin/usuarios/${adminId}`, { ativo: false }, 409],
      ["POST", "/api/admin/usuarios/999999/links", undefined, 404],
      ["DELETE", "/api/admin/links/999999", undefined, 404],
      ["PATCH", "/api/admin/usuarios/999999", { ativo: false }, 404],
    ] as const) {
      const { res, registros } = await comTrilha(() =>
        requisitar(metodo, caminho, admin, corpo),
      );
      expect({ caminho, status: res.status, registros }).toEqual({
        caminho,
        status,
        registros: [],
      });
    }
  });

  it("RIFA-018: ação sem mudança não registra: reativar quem está ativo, desativar quem está desativado, revogar link já revogado", async () => {
    const criada = await requisitar("POST", "/api/admin/usuarios", admin, {
      nome: "Pessoa Sem Mudanca Ficticia",
      email: null,
      papel: "coordenacao",
    });
    const { usuario, link } = (await criada.json()) as {
      usuario: { id: number };
      link: { id: number };
    };
    const patch = (ativo: boolean) =>
      comTrilha(() =>
        requisitar("PATCH", `/api/admin/usuarios/${usuario.id}`, admin, {
          ativo,
        }),
      );
    const revogar = () =>
      comTrilha(() =>
        requisitar("DELETE", `/api/admin/links/${link.id}`, admin),
      );

    const jaAtivo = await patch(true);
    const desativada = await patch(false);
    const jaDesativado = await patch(false);
    const revogado = await revogar();
    const jaRevogado = await revogar();

    expect(
      [jaAtivo, desativada, jaDesativado, revogado, jaRevogado].map(
        ({ res, registros }) => ({
          status: res.status,
          acoes: registros.map(({ acao }) => acao),
        }),
      ),
    ).toEqual([
      { status: 200, acoes: [] },
      { status: 200, acoes: ["usuario.desativar"] },
      { status: 200, acoes: [] },
      { status: 204, acoes: ["link.revogar"] },
      { status: 204, acoes: [] },
    ]);
    // A resposta do PATCH sem mudança é o usuário como está.
    expect(await jaDesativado.res.json()).toMatchObject({
      id: usuario.id,
      ativo: false,
    });
  });

  it("RIFA-018: revogar o último link válido de admin é recusado dentro do lote: 409 e nenhuma linha", async () => {
    // O admin da sessão fica sendo o único admin ativo (os outros voltam no fim): o link dele é o último válido.
    const { results: outros } = await env.DB.prepare(
      "UPDATE usuarios SET ativo = 0 WHERE papel = 'admin' AND ativo = 1 AND id <> ?1 RETURNING id",
    )
      .bind(adminId)
      .all<{ id: number }>();
    onTestFinished(async () => {
      await env.DB.prepare(
        "UPDATE usuarios SET ativo = 1 WHERE id IN (SELECT value FROM json_each(?1))",
      )
        .bind(JSON.stringify(outros.map(({ id }) => id)))
        .run();
    });
    const { results: links } = await env.DB.prepare(
      "SELECT id FROM links_acesso WHERE usuario_id = ?1 AND revogado_em IS NULL",
    )
      .bind(adminId)
      .all<{ id: number }>();
    expect(links).toHaveLength(1);

    const { res, registros } = await comTrilha(() =>
      requisitar("DELETE", `/api/admin/links/${links[0].id}`, admin),
    );

    expect(res.status).toBe(409);
    expect(
      ((await res.json()) as { erro: { codigo: string } }).erro.codigo,
    ).toBe("em_uso");
    expect(registros).toEqual([]);
    // Nada mudou: o link continua válido.
    expect(
      await env.DB.prepare("SELECT revogado_em FROM links_acesso WHERE id = ?1")
        .bind(links[0].id)
        .first(),
    ).toEqual({ revogado_em: null });
  });
});

describe("GET /api/admin/auditoria", () => {
  async function pagina(consulta: string) {
    const res = await requisitar(
      "GET",
      `/api/admin/auditoria${consulta}`,
      admin,
    );
    expect(res.status).toBe(200);
    expect(res.headers.get("Cache-Control")).toBe("no-store");
    return respostaAuditoriaSchema.parse(await res.json());
  }

  it("do mais novo para o mais antigo, com o nome de quem fez, e o cursor percorre tudo sem repetir", async () => {
    for (let i = 0; i < 3; i++)
      await requisitar("PUT", `/api/admin/afiliados/${7000 + i}`, coordenacao, {
        celula_id: null,
      });
    const total = (await env.DB.prepare(
      "SELECT count(*) AS total FROM auditoria",
    ).first<{
      total: number;
    }>())!.total;

    const vistos: RegistroAuditoria[] = [];
    let consulta = "?limite=2";
    for (;;) {
      const { itens, proximo } = await pagina(consulta);
      expect(itens.length).toBeLessThanOrEqual(2);
      vistos.push(...itens);
      if (proximo === null) break;
      expect(proximo).toBe(itens.at(-1)?.id);
      consulta = `?limite=2&antes_de=${proximo}`;
    }

    expect(vistos).toHaveLength(total);
    const ids = vistos.map((item) => item.id);
    expect(ids).toEqual([...ids].sort((a, b) => b - a));
    expect(new Set(ids).size).toBe(ids.length);
    expect(vistos[0]).toMatchObject({
      acao: "afiliado.salvar",
      alvo: "afiliado:7002",
      usuario_id: coordenacaoId,
      usuario_nome: expect.stringContaining("Pessoa de teste"),
    });
  });

  it("padrão de 50 por página; limite fora de 1 a 200 ou cursor inválido: 400", async () => {
    const { itens } = await pagina("");
    expect(itens.length).toBeLessThanOrEqual(50);
    for (const consulta of [
      "?limite=0",
      "?limite=201",
      "?antes_de=abc",
      "?antes_de=0",
    ]) {
      const res = await requisitar(
        "GET",
        `/api/admin/auditoria${consulta}`,
        admin,
      );
      expect({ consulta, status: res.status }).toEqual({
        consulta,
        status: 400,
      });
    }
  });

  it("só admin: a coordenação recebe 403 e não vê nada", async () => {
    const res = await requisitar("GET", "/api/admin/auditoria", coordenacao);
    expect(res.status).toBe(403);
    expect(await res.text()).not.toContain("afiliado:");
  });
});
