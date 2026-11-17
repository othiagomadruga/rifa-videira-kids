/**
 * Os afiliados da Rifei com o que o sistema sabe deles (RIFA-070, D27), sem banco nem rede: a lista da tela, as
 * células sem afiliado e o plano da sincronização. Testado em lib/rifei-afiliados.test.ts.
 *
 * Regra do vínculo pelo e-mail: o e-mail da conta de afiliado na Rifei igual (sem diferença de maiúsculas e espaços
 * nas pontas) ao e-mail do líder de EXATAMENTE UMA célula. Dois líderes com o mesmo e-mail, ou nenhum, não sugerem
 * nada: a coordenação vincula à mão na Adesão. Um afiliado já vinculado nunca é trocado.
 */
import {
  emailParaComparar,
  type AfiliadoRifei,
  type CelulaSemAfiliadoRifei,
} from "../../shared/contracts";
import type {
  AfiliadoDoSistema,
  CelulaParaRifei,
  PlanoSincronizacao,
} from "../db/rifei";
import type { AfiliadoDaConta } from "./rifei-api";

const resumoDaCelula = (celula: CelulaParaRifei) => ({
  celula_id: celula.celula_id,
  celula_nome: celula.celula_nome,
  lider_nome: celula.lider_nome,
});

export interface AfiliadosMontados {
  afiliados: AfiliadoRifei[];
  celulas_sem_afiliado: CelulaSemAfiliadoRifei[];
}

/** A lista da tela: cada afiliado da Rifei (na ordem dela) com a célula vinculada ou a sugerida, e as células sem afiliado. */
export function montarAfiliadosRifei(
  daRifei: readonly AfiliadoDaConta[],
  celulas: readonly CelulaParaRifei[],
  doSistema: readonly AfiliadoDoSistema[],
): AfiliadosMontados {
  const celulaPorId = new Map(
    celulas.map((celula) => [celula.celula_id, celula]),
  );
  const celulasPorEmail = new Map<string, CelulaParaRifei[]>();
  for (const celula of celulas) {
    const email = emailParaComparar(celula.lider_email);
    if (email === null) continue;
    celulasPorEmail.set(email, [...(celulasPorEmail.get(email) ?? []), celula]);
  }
  const afiliadoPorId = new Map(
    doSistema.map((afiliado) => [afiliado.affiliate_id, afiliado]),
  );

  const afiliados = daRifei.map((afiliado): AfiliadoRifei => {
    const local = afiliadoPorId.get(afiliado.affiliate_id);
    const vinculada =
      local?.celula_id != null ? celulaPorId.get(local.celula_id) : undefined;
    const email = emailParaComparar(afiliado.email);
    const candidatas = email === null ? [] : (celulasPorEmail.get(email) ?? []);
    return {
      affiliate_id: afiliado.affiliate_id,
      codigo: afiliado.codigo,
      nome: afiliado.nome,
      email: afiliado.email,
      celula: vinculada ? resumoDaCelula(vinculada) : null,
      sugestao:
        local?.celula_id == null && candidatas.length === 1
          ? resumoDaCelula(candidatas[0])
          : null,
    };
  });

  const comAfiliado = new Set(
    doSistema
      .map((afiliado) => afiliado.celula_id)
      .filter((id): id is number => id !== null),
  );
  const celulas_sem_afiliado = celulas
    .filter((celula) => !comAfiliado.has(celula.celula_id))
    .map((celula) => ({
      ...resumoDaCelula(celula),
      tem_email: emailParaComparar(celula.lider_email) !== null,
    }));

  return { afiliados, celulas_sem_afiliado };
}

/**
 * O que a sincronização grava: o código de cada afiliado da Rifei que é novo no sistema ou mudou, e o vínculo dos que
 * têm sugestão (não vinculados, com o e-mail de exatamente um líder).
 */
export function planejarSincronizacao(
  daRifei: readonly AfiliadoDaConta[],
  montados: AfiliadosMontados,
  doSistema: readonly AfiliadoDoSistema[],
): PlanoSincronizacao {
  const afiliadoPorId = new Map(
    doSistema.map((afiliado) => [afiliado.affiliate_id, afiliado]),
  );
  const codigos = daRifei
    .filter((afiliado) => {
      const local = afiliadoPorId.get(afiliado.affiliate_id);
      return (
        local === undefined ||
        (afiliado.codigo !== null && local.codigo_rifei !== afiliado.codigo)
      );
    })
    .map((afiliado) => ({
      affiliate_id: afiliado.affiliate_id,
      codigo: afiliado.codigo,
    }));
  const vinculos = montados.afiliados.flatMap((afiliado) =>
    afiliado.sugestao === null
      ? []
      : [
          {
            affiliate_id: afiliado.affiliate_id,
            celula_id: afiliado.sugestao.celula_id,
          },
        ],
  );
  return { codigos, vinculos };
}
