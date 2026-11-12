// D1 dos testes que registra cada comando executado, com as linhas lidas e escritas (RIFA-039, D21: o orçamento do
// webhook e das rotas do token). Diferente de bancoQueConta (painel-apoio.ts), guarda o SQL de cada comando: os
// testes conferem QUAL consulta leu quantas linhas.
import { env } from "cloudflare:workers";

export interface ComandoMedido {
  sql: string;
  lidas: number;
  escritas: number;
}

const ORIGINAL = Symbol("comando original");
const SQL = Symbol("sql do comando");

/**
 * O D1 embrulhado para registrar cada comando executado (first, all, run e cada comando de um batch) com as linhas
 * lidas e escritas (`meta.rows_read` e `meta.rows_written`; o first é lido pelo all, a mesma consulta, para ter o
 * `meta`). A réplica de leitura (`withSession`) lança: o webhook e as rotas do token não a usam (D21).
 */
export function bancoQueRegistra(db: D1Database = env.DB): {
  db: D1Database;
  comandos: ComandoMedido[];
} {
  const comandos: ComandoMedido[] = [];
  const registrar = (sql: string, resultado: D1Result) =>
    comandos.push({
      sql,
      lidas: resultado.meta.rows_read,
      escritas: resultado.meta.rows_written,
    });
  const embrulhar = (
    comando: D1PreparedStatement,
    sql: string,
  ): D1PreparedStatement =>
    new Proxy(comando, {
      get(alvo, nome) {
        if (nome === ORIGINAL) return alvo;
        if (nome === SQL) return sql;
        if (nome === "bind")
          return (...args: unknown[]) => embrulhar(alvo.bind(...args), sql);
        if (nome === "first")
          return async (...args: unknown[]) => {
            if (args.length > 0)
              throw new Error("first(coluna) não é usado aqui");
            const resultado = await alvo.all();
            registrar(sql, resultado);
            return resultado.results[0] ?? null;
          };
        if (nome === "all" || nome === "run")
          return async () => {
            const resultado = await alvo[nome]();
            registrar(sql, resultado);
            return resultado;
          };
        if (nome === "raw") throw new Error("raw não é usado aqui");
        const valor: unknown = Reflect.get(alvo, nome, alvo);
        return typeof valor === "function"
          ? (...args: unknown[]) => Reflect.apply(valor, alvo, args)
          : valor;
      },
    });
  const marcado = (comando: D1PreparedStatement) =>
    comando as unknown as {
      [ORIGINAL]?: D1PreparedStatement;
      [SQL]?: string;
    };
  const banco = new Proxy(db, {
    get(alvo, nome) {
      if (nome === "prepare")
        return (sql: string) => embrulhar(alvo.prepare(sql), sql);
      if (nome === "batch")
        return async (lote: D1PreparedStatement[]) => {
          const resultados = await alvo.batch(
            lote.map((comando) => marcado(comando)[ORIGINAL] ?? comando),
          );
          resultados.forEach((resultado, indice) =>
            registrar(marcado(lote[indice])[SQL] ?? "?", resultado),
          );
          return resultados;
        };
      if (nome === "withSession")
        throw new Error("sem a réplica de leitura do D1 (D21)");
      const valor: unknown = Reflect.get(alvo, nome, alvo);
      return typeof valor === "function"
        ? (...args: unknown[]) => Reflect.apply(valor, alvo, args)
        : valor;
    },
  });
  return { db: banco, comandos };
}
