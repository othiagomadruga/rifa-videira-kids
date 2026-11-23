/**
 * O "Arrecadado" do admin (RIFA-087, adendo da D40; docs/api.md): GET /api/admin/arrecadado, SÓ ADMIN (a coordenação e
 * a hierarquia levam 403). Quanto entrou, do banco: a soma dos pedidos pagos que a Rifei manda pelo webhook (D2, D32),
 * na campanha até agora e hoje (lib/arrecadado.ts). Nada é perguntado à Efí nem à Rifei. 404 `nao_encontrado` sem
 * campanha ativa. A resposta passa pelo schema estrito antes de sair e vai com `Cache-Control: no-store` (o
 * exigirSessao põe).
 *
 * O index.ts monta este sub-app sob /api/admin, depois do login da coordenação (passo 4); a rota exige o papel admin no
 * próprio handler (exigirSessao), nunca num use de /api/admin/*.
 */
import { Hono } from "hono";
import { ROTAS_ARRECADADO } from "../../shared/contracts";
import {
  lerEntradaDoCalculo,
  relogioDoSistema,
  type Relogio,
} from "../db/painel";
import { montarArrecadado } from "../lib/arrecadado";
import { responderErro } from "../lib/respostas-erro";
import { exigirSessao, type AmbienteSessao } from "../middleware/sessao";

/** Onde o index.ts monta este sub-app. */
export const PREFIXO_ARRECADADO = "/api/admin";

const ROTA = ROTAS_ARRECADADO.arrecadado;

export function criarArrecadado({
  relogio = relogioDoSistema,
}: { relogio?: Relogio } = {}) {
  const app = new Hono<AmbienteSessao>();
  app.get(
    ROTA.caminho.slice(PREFIXO_ARRECADADO.length),
    exigirSessao(ROTA.papeis),
    async (c) => {
      const lido = await lerEntradaDoCalculo(c.env.DB, relogio);
      if (!lido.ok)
        return responderErro(c, lido.codigo, lido.mensagem, lido.detalhes);
      return c.json(
        ROTA.sucesso.corpo.parse(montarArrecadado(lido.entrada, lido.agora)),
        200,
      );
    },
  );
  return app;
}

/** O sub-app de produção (relógio do sistema). */
export const arrecadado = criarArrecadado();
