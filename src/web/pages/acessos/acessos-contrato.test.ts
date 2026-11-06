// O site usa cópias de valores do contrato do acesso (importar os valores poria o zod no pacote do site;
// veja acessos-api.ts e lib/sessao.tsx). Este teste garante que as cópias continuam iguais ao contrato.
import { describe, expect, it } from "vitest";
import {
  FORMATO_TOKEN_ACESSO,
  PAPEIS,
  PREFIXO_LINK_ACESSO,
  ROTAS_ACESSO,
  corpoCriarUsuarioSchema,
  usuarioSchema,
} from "../../../shared/contracts";
import { CAMINHOS_SESSAO, ROTULO_PAPEL } from "../../lib/sessao";
import { CAMINHO_ACESSO, FORMATO_TOKEN } from "../acesso/AcessoPage";
import { CAMINHOS, LIMITES, PAPEIS_DO_FORMULARIO } from "./acessos-api";

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
    expect([...PAPEIS_DO_FORMULARIO].sort()).toEqual([...PAPEIS].sort());
    expect(Object.keys(ROTULO_PAPEL).sort()).toEqual([...PAPEIS].sort());
    expect(LIMITES.nome).toBe(corpoCriarUsuarioSchema.shape.nome.maxLength);
    expect(LIMITES.nome).toBe(usuarioSchema.shape.nome.maxLength);
    expect(LIMITES.email).toBe(usuarioSchema.shape.email.unwrap().maxLength);
  });
});
