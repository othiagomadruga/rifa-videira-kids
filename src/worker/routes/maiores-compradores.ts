/**
 * Maiores compradores do admin (RIFA-083, D38; docs/api.md): GET /api/admin/maiores-compradores?janela=atual|campanha
 * &limite=1..50, SÓ ADMIN (como a D36: o telefone e o R$ do comprador são só dele). A coordenação leva 403 antes de a
 * consulta ser lida. O index.ts monta este sub-app sob /api/admin, depois do login da coordenação (passo 4), e a rota
 * exige o papel admin no próprio handler (exigirSessao), nunca num use de /api/admin/*.
 *
 * A leitura é de db/maiores-compradores.ts (a janela e o filtro do ranking, R6) e a regra é a do contrato
 * (`classificarMaioresCompradores`); cada item sai com `itemMaiorCompradorAdmin` (telefone legível, como no CSV, e o
 * número do WhatsApp). A resposta passa pelo schema estrito antes de sair e vai com `Cache-Control: no-store` (o
 * exigirSessao põe). A trilha não registra a leitura: ela não exporta nada (a planilha da D36 continua registrando).
 */
import { Hono } from "hono";
import {
  ROTAS_MAIORES_COMPRADORES,
  itemMaiorCompradorAdmin,
} from "../../shared/contracts";
import { lerMaioresCompradores } from "../db/maiores-compradores";
import { relogioDoSistema, type Relogio } from "../db/painel";
import { responderErro } from "../lib/respostas-erro";
import { exigirSessao, type AmbienteSessao } from "../middleware/sessao";
import { validarConsulta } from "../middleware/validacao";

/** Onde o index.ts monta este sub-app. */
export const PREFIXO_MAIORES_COMPRADORES = "/api/admin";

const ROTA = ROTAS_MAIORES_COMPRADORES.maioresCompradores;

export function criarMaioresCompradores({
  relogio = relogioDoSistema,
}: { relogio?: Relogio } = {}) {
  const app = new Hono<AmbienteSessao>();
  app.get(
    ROTA.caminho.slice(PREFIXO_MAIORES_COMPRADORES.length),
    // Só admin, antes de ler a consulta (a coordenação leva 403 mesmo com uma consulta inválida).
    exigirSessao(ROTA.papeis),
    validarConsulta(ROTA.consulta),
    async (c) => {
      const lido = await lerMaioresCompradores(
        c.env.DB,
        relogio,
        c.req.valid("query"),
      );
      if (!lido.ok) return responderErro(c, lido.codigo, lido.mensagem);
      return c.json(
        ROTA.sucesso.corpo.parse({
          janela: lido.janela,
          itens: lido.compradores.map(itemMaiorCompradorAdmin),
          atualizado_em: lido.agora.toISOString(),
        }),
        200,
      );
    },
  );
  return app;
}

/** O sub-app de produção (relógio do sistema). */
export const maioresCompradores = criarMaioresCompradores();
