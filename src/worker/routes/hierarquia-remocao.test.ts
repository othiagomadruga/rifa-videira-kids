// RIFA-014, CA6: apagar a célula, o discipulador ou a rede (quando a hierarquia permite) apaga o acesso dela: o
// usuário do alvo, os links e as sessões (cascata da migração 0006), e o link para de entrar. Recusada por chave
// estrangeira, a mensagem diz o motivo certo: os dependentes da hierarquia (afiliados, células, discipuladores)
// ou, sem eles, a trilha de auditoria, que segura o acesso do alvo quando ele aparece como autor de uma ação.
import { env } from "cloudflare:workers";
import {
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  onTestFinished,
} from "vitest";
import type { PapelHierarquia } from "../../shared/contracts";
import {
  chamar as chamarAcesso,
  criarAcessoDaHierarquiaNoBanco,
  criarAppDeTeste,
  entrar,
  type AppDeTeste,
} from "../test/acesso-teste";
import {
  chamar,
  criarCelula,
  criarDiscipulador,
  criarRede,
  esperarErro,
  limparHierarquia,
} from "../test/hierarquia-apoio";

let app: AppDeTeste;

beforeAll(() => {
  app = criarAppDeTeste();
});

beforeEach(limparHierarquia);

const CAMINHO = {
  lider: "/api/admin/celulas",
  discipulador: "/api/admin/discipuladores",
  rede: "/api/admin/redes",
} as const satisfies Record<PapelHierarquia, string>;

/** Uma rede, um discipulador nela e uma célula dele (sem afiliados), criados pela API. */
async function hierarquia() {
  const rede = await criarRede({ nome: "Rede Ficticia da Remocao" });
  const discipulador = await criarDiscipulador(
    rede.id,
    "Discipulador Ficticio da Remocao",
  );
  const celula = await criarCelula(
    discipulador.id,
    "Celula Ficticia da Remocao",
  );
  return { rede, discipulador, celula };
}

/** O acesso do alvo com dois links e uma sessão aberta por um deles. */
async function acessoComSessao(papel: PapelHierarquia, alvoId: number) {
  const primeiro = await criarAcessoDaHierarquiaNoBanco(papel, alvoId);
  const segundo = await criarAcessoDaHierarquiaNoBanco(papel, alvoId);
  expect(segundo.usuarioId).toBe(primeiro.usuarioId);
  const sessao = await entrar(app, primeiro.token);
  return { ...primeiro, tokens: [primeiro.token, segundo.token], sessao };
}

/** Quantos usuários, links e sessões do usuário ainda existem. */
async function restos(usuarioId: number): Promise<number[]> {
  const resultados = await env.DB.batch<{ total: number }>([
    env.DB.prepare("SELECT count(*) AS total FROM usuarios WHERE id = ?1").bind(
      usuarioId,
    ),
    env.DB.prepare(
      "SELECT count(*) AS total FROM links_acesso WHERE usuario_id = ?1",
    ).bind(usuarioId),
    env.DB.prepare(
      "SELECT count(*) AS total FROM sessoes WHERE usuario_id = ?1",
    ).bind(usuarioId),
  ]);
  return resultados.map((resultado) => resultado.results[0].total);
}

async function sessaoValida(sessao: string): Promise<boolean> {
  return (
    (await chamarAcesso(app, "GET", "/api/sessao", { sessao })).status === 200
  );
}

async function loginPelo(token: string): Promise<number> {
  return (await chamarAcesso(app, "POST", "/api/sessao", { corpo: { token } }))
    .status;
}

describe("CA6: apagar o alvo apaga o acesso dele", () => {
  it.each(["lider", "discipulador", "rede"] as const)(
    "%s: a exclusão do alvo (204) leva o usuário, os links e as sessões; o link para de entrar",
    async (papel) => {
      const { rede, discipulador, celula } = await hierarquia();
      // Para apagar o discipulador, ele fica sem células; para apagar a rede, ela fica sem discipuladores.
      if (papel !== "lider")
        expect(
          (await chamar("DELETE", `${CAMINHO.lider}/${celula.id}`)).status,
        ).toBe(204);
      if (papel === "rede")
        expect(
          (await chamar("DELETE", `${CAMINHO.discipulador}/${discipulador.id}`))
            .status,
        ).toBe(204);
      const alvoId = {
        lider: celula.id,
        discipulador: discipulador.id,
        rede: rede.id,
      }[papel];
      const acesso = await acessoComSessao(papel, alvoId);
      expect(await restos(acesso.usuarioId)).toEqual([1, 2, 1]);
      expect(await sessaoValida(acesso.sessao)).toBe(true);

      const exclusao = await chamar("DELETE", `${CAMINHO[papel]}/${alvoId}`);

      expect(exclusao).toEqual({ status: 204, corpo: null });
      expect(await restos(acesso.usuarioId)).toEqual([0, 0, 0]);
      expect(await sessaoValida(acesso.sessao)).toBe(false);
      for (const token of acesso.tokens)
        expect(await loginPelo(token)).toBe(401);
    },
  );

  it("o acesso de outro alvo não vai junto", async () => {
    const { discipulador, celula } = await hierarquia();
    const outra = await criarCelula(discipulador.id, "Outra Celula Ficticia");
    const daOutra = await acessoComSessao("lider", outra.id);
    const doDiscipulador = await acessoComSessao(
      "discipulador",
      discipulador.id,
    );
    await acessoComSessao("lider", celula.id);

    expect(
      (await chamar("DELETE", `${CAMINHO.lider}/${celula.id}`)).status,
    ).toBe(204);

    expect(await restos(daOutra.usuarioId)).toEqual([1, 2, 1]);
    expect(await restos(doDiscipulador.usuarioId)).toEqual([1, 2, 1]);
    expect(await sessaoValida(daOutra.sessao)).toBe(true);
  });
});

describe("recusada por chave estrangeira: a mensagem diz o motivo certo e nada é apagado", () => {
  it("pela hierarquia: afiliados da célula, células do discipulador, discipuladores da rede", async () => {
    const { rede, discipulador, celula } = await hierarquia();
    await env.DB.prepare(
      `INSERT INTO afiliados (affiliate_id, celula_id, origem, vinculado_em)
       VALUES (7001, ?1, 'manual', '2026-11-20T12:00:00.000Z')`,
    )
      .bind(celula.id)
      .run();
    const acessos = {
      lider: await acessoComSessao("lider", celula.id),
      discipulador: await acessoComSessao("discipulador", discipulador.id),
      rede: await acessoComSessao("rede", rede.id),
    };
    for (const [papel, id, mensagem] of [
      [
        "lider",
        celula.id,
        "A célula tem afiliados vinculados (1). Passe os afiliados para outra célula (Adesão → Todas as células → Trocar), que leva as vendas junto, antes de excluir esta.",
      ],
      [
        "discipulador",
        discipulador.id,
        "O discipulador tem células (1). Exclua as células ou mova-as para outro discipulador antes de excluir o discipulador.",
      ],
      [
        "rede",
        rede.id,
        "A rede tem discipuladores (1). Exclua os discipuladores ou mova-os para outra rede antes de excluir a rede.",
      ],
    ] as const) {
      const erro = esperarErro(
        await chamar("DELETE", `${CAMINHO[papel]}/${id}`),
        409,
        "em_uso",
      );
      expect({ papel, mensagem: erro.mensagem }).toEqual({ papel, mensagem });
      expect(await restos(acessos[papel].usuarioId)).toEqual([1, 2, 1]);
      expect(await sessaoValida(acessos[papel].sessao)).toBe(true);
    }
  });

  it.each(["lider", "discipulador", "rede"] as const)(
    "%s: sem dependentes, mas com o acesso do alvo como autor na trilha de auditoria, a mensagem fala da trilha (não de dependentes)",
    async (papel) => {
      const { rede, discipulador, celula } = await hierarquia();
      if (papel !== "lider")
        await chamar("DELETE", `${CAMINHO.lider}/${celula.id}`);
      if (papel === "rede")
        await chamar("DELETE", `${CAMINHO.discipulador}/${discipulador.id}`);
      const alvoId = {
        lider: celula.id,
        discipulador: discipulador.id,
        rede: rede.id,
      }[papel];
      const acesso = await acessoComSessao(papel, alvoId);
      // Os papéis da hierarquia não escrevem (403 em /api/admin): só aqui o usuário dele vira autor na trilha.
      await env.DB.prepare(
        `INSERT INTO auditoria (usuario_id, em, acao, alvo, resumo)
         VALUES (?1, '2026-11-20T12:00:00.000Z', 'link.criar', 'link:1', 'Registro de teste')`,
      )
        .bind(acesso.usuarioId)
        .run();
      // Sem o registro de teste, a limpeza do próximo teste consegue apagar o alvo (e o acesso, em cascata).
      onTestFinished(async () => {
        await env.DB.prepare("DELETE FROM auditoria WHERE usuario_id = ?1")
          .bind(acesso.usuarioId)
          .run();
      });

      const erro = esperarErro(
        await chamar("DELETE", `${CAMINHO[papel]}/${alvoId}`),
        409,
        "em_uso",
      );

      expect(erro.mensagem).toMatch(/trilha de auditoria/);
      expect(erro.mensagem).not.toMatch(/\(0\)/);
      expect(erro.mensagem).toMatch(
        {
          lider: /^A célula/,
          discipulador: /^O discipulador/,
          rede: /^A rede/,
        }[papel],
      );
      expect(await restos(acesso.usuarioId)).toEqual([1, 2, 1]);
      const tabela = {
        lider: "celulas",
        discipulador: "discipuladores",
        rede: "redes",
      }[papel];
      expect(
        await env.DB.prepare(`SELECT id FROM ${tabela} WHERE id = ?1`)
          .bind(alvoId)
          .first(),
      ).toEqual({ id: alvoId });
    },
  );
});
