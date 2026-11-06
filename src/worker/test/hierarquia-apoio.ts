// Apoio aos testes das rotas da hierarquia: o sub-app montado como o index.ts vai montar (sob
// /api/admin; a autenticação da coordenação é de outra tarefa), chamadas com o D1 dos testes, limpeza
// das tabelas e atalhos que conferem cada resposta com o schema do contrato.
import { env } from "cloudflare:workers";
import { Hono } from "hono";
import { expect } from "vitest";
import type { z } from "zod";
import {
  celulaSchema,
  discipuladorSchema,
  erroApiSchema,
  redeSchema,
  respostaListaCelulasSchema,
  respostaListaDiscipuladoresSchema,
  respostaListaRedesSchema,
  type CodigoErro,
} from "../../shared/contracts";
import { PREFIXO_HIERARQUIA, hierarquia } from "../routes/hierarquia";

const app = new Hono<{ Bindings: Cloudflare.Env }>().route(
  PREFIXO_HIERARQUIA,
  hierarquia,
);

export interface Resposta {
  status: number;
  corpo: unknown;
}

export async function chamar(
  metodo: "GET" | "POST" | "PUT" | "DELETE",
  caminho: string,
  corpo?: unknown,
  opcoes: {
    db?: D1Database;
    /** Corpo enviado como está (sem JSON.stringify). */
    corpoBruto?: string;
    /** null = sem Content-Type. Padrão: application/json quando há corpo. */
    contentType?: string | null;
  } = {},
): Promise<Resposta> {
  const headers = new Headers();
  const temCorpo = corpo !== undefined || opcoes.corpoBruto !== undefined;
  const contentType =
    opcoes.contentType === undefined ? "application/json" : opcoes.contentType;
  if (temCorpo && contentType !== null)
    headers.set("Content-Type", contentType);
  const resposta = await app.request(
    caminho,
    {
      method: metodo,
      headers,
      body:
        opcoes.corpoBruto ??
        (corpo === undefined ? undefined : JSON.stringify(corpo)),
    },
    { ...env, DB: opcoes.db ?? env.DB },
  );
  const texto = await resposta.text();
  return {
    status: resposta.status,
    corpo: texto === "" ? null : JSON.parse(texto),
  };
}

/** Confere o corpo com o schema do contrato, sem campos a mais, e devolve o valor tipado. */
export function conforme<S extends z.ZodType>(
  schema: S,
  corpo: unknown,
): z.output<S> {
  const valor = schema.parse(corpo);
  expect(corpo).toEqual(valor);
  return valor;
}

/** Confere status e código no formato único de erro e devolve o erro. */
export function esperarErro(
  resposta: Resposta,
  status: number,
  codigo: CodigoErro,
) {
  expect({ status: resposta.status, corpo: resposta.corpo }).toMatchObject({
    status,
    corpo: { erro: { codigo } },
  });
  return erroApiSchema.parse(resposta.corpo).erro;
}

export async function limparHierarquia() {
  await env.DB.batch(
    ["afiliados", "celulas", "discipuladores", "redes"].map((tabela) =>
      env.DB.prepare(`DELETE FROM ${tabela}`),
    ),
  );
}

export async function criarRede(dados: Record<string, unknown> = {}) {
  const resposta = await chamar("POST", "/api/admin/redes", {
    nome: "Rede Jovem Ficticia",
    divisao: "jovens",
    ...dados,
  });
  expect(resposta.status).toBe(201);
  return conforme(redeSchema, resposta.corpo);
}

export async function criarDiscipulador(rede_id: number, nome: string) {
  const resposta = await chamar("POST", "/api/admin/discipuladores", {
    rede_id,
    nome,
  });
  expect(resposta.status).toBe(201);
  return conforme(discipuladorSchema, resposta.corpo);
}

export async function criarCelula(
  discipulador_id: number,
  nome: string,
  dados: Record<string, unknown> = {},
) {
  const resposta = await chamar("POST", "/api/admin/celulas", {
    discipulador_id,
    nome,
    qtd_pessoas: 10,
    lider_nome: `Líder da ${nome}`,
    ...dados,
  });
  expect(resposta.status).toBe(201);
  return conforme(celulaSchema, resposta.corpo);
}

export async function listarRedes() {
  const resposta = await chamar("GET", "/api/admin/redes");
  expect(resposta.status).toBe(200);
  return conforme(respostaListaRedesSchema, resposta.corpo).itens;
}

export async function listarDiscipuladores(consulta = "") {
  const resposta = await chamar("GET", `/api/admin/discipuladores${consulta}`);
  expect(resposta.status).toBe(200);
  return conforme(respostaListaDiscipuladoresSchema, resposta.corpo).itens;
}

export async function listarCelulas(consulta = "") {
  const resposta = await chamar("GET", `/api/admin/celulas${consulta}`);
  expect(resposta.status).toBe(200);
  return conforme(respostaListaCelulasSchema, resposta.corpo).itens;
}

export const nomes = (itens: { nome: string }[]) =>
  itens.map((item) => item.nome);
