/**
 * Visão individual (RIFA-014, RF08, D12; docs/api.md): GET /api/minha/visao, do grupo `hierarquia` (líder,
 * discipulador e rede). Também GET /api/minha/links-vendas (RIFA-046, D24): os links de vendas (o link de afiliado da
 * Rifei) das células do alvo, para o líder divulgar e o QR code. O index.ts monta este sub-app sob /api/minha, DEPOIS
 * do login desses papéis:
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
 *
 * Os links de vendas: o escopo é o da visão (o líder, a célula dele; o discipulador, as células dele; a rede, as dos
 * discipuladores dela), do alvo da sessão; a consulta da URL é ignorada (um `?celula_id=` não muda nada). Um lote do
 * D1 por requisição (db/links-vendas.ts), sem cache: o modelo novo ou o afiliado vinculado valem na hora. Sem
 * campanha ativa, 404. Com o acesso do papel desligado (D20), o login daqui já deu 403 `acesso_desligado`.
 *
 * Os maiores compradores (RIFA-083, D38): GET /api/minha/maiores-compradores?janela=atual|campanha&limite=1..50, SÓ
 * do discipulador (o líder e a rede levam 403 `proibido`), com os pedidos das células dele (o alvo da sessão; a
 * consulta só tem `janela` e `limite`, o resto é descartado pelo schema). Cada item sai com `itemMeuMaiorComprador`:
 * posição, nome, bilhetes e a célula, sem telefone e sem R$ (D12), conferido no schema estrito. Lido do D1 a cada
 * requisição, sem cache (db/maiores-compradores.ts); sem campanha ativa, 404.
 */
import { Hono } from "hono";
import {
  ROTAS,
  ROTAS_LINK_VENDAS,
  ROTAS_MAIORES_COMPRADORES,
  itemMeuMaiorComprador,
  type UsuarioSessao,
} from "../../shared/contracts";
import { lerLinksVendas } from "../db/links-vendas";
import { lerMaioresCompradores } from "../db/maiores-compradores";
import {
  criarCacheDaBase,
  lerBaseDaVisao,
  type CacheDaBase,
} from "../db/visao-individual";
import { relogioDoSistema, type Relogio } from "../db/painel";
import { montarRespostaMeusLinksVendas } from "../lib/links-vendas";
import { responderErro } from "../lib/respostas-erro";
import {
  MONTADORES_DA_VISAO,
  montarVisaoIndividual,
  type MontadoresDaVisao,
} from "../lib/visao-individual";
import { exigirSessao, type AmbienteSessao } from "../middleware/sessao";
import { validarConsulta } from "../middleware/validacao";

/** Onde o index.ts monta este sub-app. */
export const PREFIXO_MINHA = "/api/minha";

const ROTA = ROTAS.visaoIndividual;
const LINKS = ROTAS_LINK_VENDAS.meusLinksVendas;
const COMPRADORES = ROTAS_MAIORES_COMPRADORES.meusMaioresCompradores;

export interface OpcoesMinha {
  /** "Agora" (os testes fixam o instante); padrão: o relógio do sistema. */
  relogio?: Relogio;
  /** Cache dos dados de base; padrão: 30 s na memória do isolate. */
  cache?: CacheDaBase;
  /** Os montadores do contrato; o teste de desempenho passa uns que contam o trabalho de cada visão. */
  montadores?: MontadoresDaVisao;
}

export function criarMinha({
  relogio = relogioDoSistema,
  cache = criarCacheDaBase(),
  montadores = MONTADORES_DA_VISAO,
}: OpcoesMinha = {}) {
  const minha = new Hono<AmbienteSessao>();

  // Defesa a mais: o login dos papéis da hierarquia também aqui, com a chave de acesso do papel (RIFA-029; a
  // sessão é lida uma vez por requisição).
  minha.use("*", exigirSessao(ROTA.papeis, { acessoDaCampanha: true }));
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
        montadores,
      );
      return c.json(ROTA.sucesso.corpo.parse(visao), 200);
    },
  );

  // Sem validar a consulta: nada dela é lido (o alvo vem só da sessão).
  minha.get(LINKS.caminho.slice(PREFIXO_MINHA.length), async (c) => {
    const usuario: UsuarioSessao = c.var.usuario;
    if (usuario.alvo == null)
      return responderErro(
        c,
        "proibido",
        "Seu acesso não tem células para ver os links de vendas",
      );
    const { alvo } = usuario;
    const leitura = await lerLinksVendas(c.env.DB, {
      tipo: alvo.tipo,
      id: alvo.id,
    });
    if (leitura === null)
      return responderErro(
        c,
        "nao_encontrado",
        "A campanha ainda não foi configurada",
      );
    return c.json(
      LINKS.sucesso.corpo.parse(montarRespostaMeusLinksVendas(leitura, alvo)),
      200,
    );
  });

  // Só o discipulador (o líder e a rede: 403), antes de ler a consulta; a chave do papel já foi conferida acima.
  minha.get(
    COMPRADORES.caminho.slice(PREFIXO_MINHA.length),
    exigirSessao(COMPRADORES.papeis, { acessoDaCampanha: true }),
    validarConsulta(COMPRADORES.consulta),
    async (c) => {
      const { alvo } = c.var.usuario;
      // O papel discipulador sempre tem o alvo dele (o banco garante); a conferência é a defesa a mais.
      if (alvo?.tipo !== "discipulador")
        return responderErro(
          c,
          "proibido",
          "Seu acesso não tem células para ver os compradores",
        );
      const lido = await lerMaioresCompradores(
        c.env.DB,
        relogio,
        c.req.valid("query"),
        { discipuladorId: alvo.id },
      );
      if (!lido.ok) return responderErro(c, lido.codigo, lido.mensagem);
      return c.json(
        COMPRADORES.sucesso.corpo.parse({
          janela: lido.janela,
          itens: lido.compradores.map(itemMeuMaiorComprador),
          atualizado_em: lido.agora.toISOString(),
        }),
        200,
      );
    },
  );

  return minha;
}

/** O sub-app de produção (relógio do sistema e cache de 30 s). */
export const minha = criarMinha();
