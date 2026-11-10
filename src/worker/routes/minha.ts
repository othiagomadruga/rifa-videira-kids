/**
 * Visão individual (RIFA-014, RF08, D12; docs/api.md): GET /api/minha/visao, do grupo `hierarquia` (líder,
 * discipulador e rede). O index.ts monta este sub-app sob /api/minha, DEPOIS do login desses papéis:
 *   app.use("/api/minha/*", exigirSessao(["lider", "discipulador", "rede"]));
 * e o sub-app exige o mesmo login (mesmo que o app esqueça). Sem sessão: 401; sessão da coordenação: 403.
 *
 * O alvo vem SÓ de `c.var.usuario` (o usuário da sessão, com os ids do banco): nada aqui lê id de célula,
 * discipulador ou rede da URL, da consulta, do corpo ou dos cabeçalhos. A consulta só tem `periodo` (o schema
 * descarta o resto).
 *
 * A conta é do montador (lib/visao-individual.ts, com as funções de calculos.ts); os dados de base vêm de
 * db/visao-individual.ts, com cache de até 30 s por isolate. A resposta, que é por pessoa, nunca fica em cache
 * (`no-store`) e passa pelo schema ESTRITO do contrato antes de sair, como nas rotas abertas: um campo a mais
 * (um valor que vazasse) vira 500 `erro_interno` e nunca chega ao usuário.
 */
import { Hono } from "hono";
import { ROTAS, type UsuarioSessao } from "../../shared/contracts";
import {
  criarCacheDaBase,
  lerBaseDaVisao,
  type CacheDaBase,
} from "../db/visao-individual";
import { relogioDoSistema, type Relogio } from "../db/painel";
import { responderErro } from "../lib/respostas-erro";
import { montarVisaoIndividual } from "../lib/visao-individual";
import { exigirSessao, type AmbienteSessao } from "../middleware/sessao";
import { validarConsulta } from "../middleware/validacao";

/** Onde o index.ts monta este sub-app. */
export const PREFIXO_MINHA = "/api/minha";

const ROTA = ROTAS.visaoIndividual;

export interface OpcoesMinha {
  /** "Agora" (os testes fixam o instante); padrão: o relógio do sistema. */
  relogio?: Relogio;
  /** Cache dos dados de base; padrão: 30 s na memória do isolate. */
  cache?: CacheDaBase;
}

export function criarMinha({
  relogio = relogioDoSistema,
  cache = criarCacheDaBase(),
}: OpcoesMinha = {}) {
  const minha = new Hono<AmbienteSessao>();

  // Defesa a mais: o login dos papéis da hierarquia também aqui (a sessão é lida uma vez por requisição).
  minha.use("*", exigirSessao(ROTA.papeis));
  // Por pessoa: nunca em cache, nem nos erros.
  minha.use("*", async (c, next) => {
    await next();
    c.header("Cache-Control", "no-store");
  });

  minha.get(
    ROTA.caminho.slice(PREFIXO_MINHA.length),
    validarConsulta(ROTA.consulta),
    async (c) => {
      const usuario: UsuarioSessao = c.var.usuario;
      // O exigirSessao já garante um papel da hierarquia, que sempre tem alvo (o banco garante).
      if (usuario.alvo == null)
        return responderErro(
          c,
          "proibido",
          "Seu acesso não tem uma visão individual",
        );
      const agora = relogio();
      const lido = await lerBaseDaVisao(c.env.DB, agora, usuario.alvo, cache);
      if (!lido.ok)
        return responderErro(c, lido.codigo, lido.mensagem, lido.detalhes);
      const visao = montarVisaoIndividual(
        lido.base,
        { pessoa: usuario.nome, alvo: usuario.alvo },
        c.req.valid("query"),
        agora,
      );
      return c.json(ROTA.sucesso.corpo.parse(visao), 200);
    },
  );

  return minha;
}

/** O sub-app de produção (relógio do sistema e cache de 30 s). */
export const minha = criarMinha();
