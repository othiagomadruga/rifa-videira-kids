// O site usa cópias de valores do contrato do acesso (importar os valores poria o zod no pacote do site;
// veja acessos-api.ts e lib/sessao.tsx). Este teste garante que as cópias continuam iguais ao contrato e que
// a consulta e o corpo que a tela monta para os acessos da hierarquia passam nos schemas das rotas.
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  FORMATO_TOKEN_ACESSO,
  LIMITE_ALVOS_POR_LOTE as LIMITE_DO_CONTRATO,
  PAPEIS,
  PAPEIS_COORDENACAO,
  PAPEIS_HIERARQUIA,
  PREFIXO_LINK_ACESSO,
  ROTAS_ACESSO,
  ROTAS_ACESSO_HIERARQUIA,
  consultaAcessosHierarquiaSchema,
  corpoGerarLinksHierarquiaSchema,
  corpoCriarUsuarioSchema,
  usuarioSchema,
} from "../../../shared/contracts";
import { CAMINHOS_SESSAO, ROTULO_PAPEL } from "../../lib/sessao";
import { respostaJson } from "../../test/renderizar";
import { CAMINHO_ACESSO, FORMATO_TOKEN } from "../acesso/AcessoPage";
import {
  CAMINHOS,
  CAMINHOS_HIERARQUIA,
  LIMITES,
  LIMITE_ALVOS_POR_LOTE,
  PAPEIS_DO_FORMULARIO,
  PAPEIS_DO_SELETOR,
  gerarLinksHierarquia,
  listarAlvos,
} from "./acessos-api";
import { ALVO_DO_PAPEL, PAPEL_NO_PLURAL, RESPONSAVEL_DO_ALVO } from "./textos";

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("cópias do contrato do acesso no site", () => {
  it("caminhos da sessão e da administração", () => {
    expect(CAMINHOS_SESSAO).toEqual({
      sessao: ROTAS_ACESSO.entrar.caminho,
      sair: ROTAS_ACESSO.sair.caminho,
    });
    expect(ROTAS_ACESSO.obterSessao.caminho).toBe(CAMINHOS_SESSAO.sessao);
    expect(ROTAS_ACESSO.listarUsuarios.caminho).toBe(CAMINHOS.usuarios);
    expect(ROTAS_ACESSO.criarUsuario.caminho).toBe(CAMINHOS.usuarios);
    expect(ROTAS_ACESSO.atualizarUsuario.caminho).toBe(
      `${CAMINHOS.usuarios}/:id`,
    );
    expect(ROTAS_ACESSO.criarLink.caminho).toBe(
      `${CAMINHOS.usuarios}/:id/links`,
    );
    expect(ROTAS_ACESSO.revogarLink.caminho).toBe(`${CAMINHOS.links}/:id`);
  });

  it("endereço e formato do link pessoal", () => {
    expect(`${CAMINHO_ACESSO}/`).toBe(PREFIXO_LINK_ACESSO);
    expect(FORMATO_TOKEN.source).toBe(FORMATO_TOKEN_ACESSO.source);
    expect(FORMATO_TOKEN.flags).toBe(FORMATO_TOKEN_ACESSO.flags);
  });

  it("papéis e limites do formulário", () => {
    expect([...PAPEIS_DO_FORMULARIO].sort()).toEqual(
      [...PAPEIS_COORDENACAO].sort(),
    );
    expect(Object.keys(ROTULO_PAPEL).sort()).toEqual([...PAPEIS].sort());
    expect(LIMITES.nome).toBe(corpoCriarUsuarioSchema.shape.nome.maxLength);
    expect(LIMITES.nome).toBe(usuarioSchema.shape.nome.maxLength);
    expect(LIMITES.email).toBe(usuarioSchema.shape.email.unwrap().maxLength);
  });
});

describe("cópias do contrato dos acessos da hierarquia (RIFA-014)", () => {
  it("caminhos, método e papel das rotas (só admin)", () => {
    expect(ROTAS_ACESSO_HIERARQUIA.listarAcessosHierarquia).toMatchObject({
      metodo: "GET",
      caminho: CAMINHOS_HIERARQUIA.alvos,
      papeis: ["admin"],
    });
    expect(ROTAS_ACESSO_HIERARQUIA.gerarLinksHierarquia).toMatchObject({
      metodo: "POST",
      caminho: CAMINHOS_HIERARQUIA.links,
      papeis: ["admin"],
    });
  });

  it("papéis do seletor, nomes de cada papel e o limite do lote", () => {
    expect([...PAPEIS_DO_SELETOR].sort()).toEqual(
      [...PAPEIS_HIERARQUIA].sort(),
    );
    for (const nomes of [PAPEL_NO_PLURAL, ALVO_DO_PAPEL, RESPONSAVEL_DO_ALVO]) {
      expect(Object.keys(nomes).sort()).toEqual([...PAPEIS_HIERARQUIA].sort());
    }
    expect(LIMITE_ALVOS_POR_LOTE).toBe(LIMITE_DO_CONTRATO);
  });

  it("a consulta da lista e o corpo dos links que a tela manda passam nos schemas das rotas", async () => {
    const pedidos: { url: string; corpo: unknown }[] = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string, init?: RequestInit) => {
        pedidos.push({
          url,
          corpo: typeof init?.body === "string" ? JSON.parse(init.body) : null,
        });
        return respostaJson({ itens: [] }, url.includes("?") ? 200 : 201);
      }),
    );

    await listarAlvos("discipulador");
    await gerarLinksHierarquia("lider", [3, 1]);
    await gerarLinksHierarquia("rede", [100], true);

    const [lista, lote, troca] = pedidos;
    const consulta = new URL(lista.url, "https://site.example");
    expect(consulta.pathname).toBe(CAMINHOS_HIERARQUIA.alvos);
    expect(
      consultaAcessosHierarquiaSchema.parse(
        Object.fromEntries(consulta.searchParams),
      ),
    ).toEqual({ papel: "discipulador" });
    expect(lote.url).toBe(CAMINHOS_HIERARQUIA.links);
    expect(corpoGerarLinksHierarquiaSchema.parse(lote.corpo)).toEqual({
      papel: "lider",
      ids: [3, 1],
      revogar_anteriores: false,
    });
    expect(corpoGerarLinksHierarquiaSchema.parse(troca.corpo)).toEqual({
      papel: "rede",
      ids: [100],
      revogar_anteriores: true,
    });
  });
});
