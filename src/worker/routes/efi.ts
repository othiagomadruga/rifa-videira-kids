/**
 * Saldo da conta Efí (RIFA-086, D40; docs/api.md): GET /api/admin/efi/saldo, SÓ ADMIN (a coordenação e a hierarquia
 * levam 403). 200 sempre que o login passa: `configurado: false` sem o certificado ou sem os segredos, e `erro` quando a
 * Efí falha (o cartão mostra "indisponível"; a Efí fora do ar não vira 5xx). A consulta é de lib/efi.ts, que guarda a
 * resposta por ~60 s na memória do Worker. A resposta passa pelo schema estrito antes de sair e vai com
 * `Cache-Control: no-store` (o exigirSessao põe).
 *
 * O index.ts monta este sub-app sob /api/admin, depois do login da coordenação (passo 4); a rota exige o papel admin no
 * próprio handler (exigirSessao), nunca num use de /api/admin/*.
 */
import { Hono } from "hono";
import { ROTAS_SALDO_EFI } from "../../shared/contracts";
import { consultarSaldoEfi, type OpcoesEfi } from "../lib/efi";
import { exigirSessao, type AmbienteSessao } from "../middleware/sessao";

/** Onde o index.ts monta este sub-app. */
export const PREFIXO_EFI = "/api/admin";

const ROTA = ROTAS_SALDO_EFI.saldoEfi;

export function criarEfi(opcoes: OpcoesEfi = {}) {
  const app = new Hono<AmbienteSessao>();
  app.get(
    ROTA.caminho.slice(PREFIXO_EFI.length),
    exigirSessao(ROTA.papeis),
    async (c) =>
      c.json(
        ROTA.sucesso.corpo.parse(await consultarSaldoEfi(c.env, opcoes)),
        200,
      ),
  );
  return app;
}

/** O sub-app de produção. */
export const efi = criarEfi();
