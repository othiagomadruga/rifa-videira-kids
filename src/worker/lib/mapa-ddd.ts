/**
 * Montagem do mapa de vendas por DDD (RIFA-015, D17; docs/api.md, "Mapa de vendas por DDD"): das linhas agregadas
 * por país e DDD (db/mapa-ddd.ts) para a resposta do contrato. Função pura, sem banco e sem relógio.
 *
 * - DDD → UF pela tabela fixa da Anatel (`UF_DO_DDD`, src/shared/contracts/ddd.ts).
 * - `pais` gravado e diferente de 55 → `exterior`; `pais` null, Brasil sem DDD ou DDD fora da tabela → `sem_ddd`.
 * - `parte_bilhetes_bp` = bilhetes × 10000 ÷ bilhetes do total, truncado (`percentualBp` do contrato); 0 quando o
 *   total não tem bilhete.
 * - Ordem: UFs pelos bilhetes, do maior para o menor (empate pela sigla); DDDs na ordem das UFs e, dentro de cada
 *   UF, pelos bilhetes (empate pelo DDD). Só UFs e DDDs com venda (toda linha do banco tem pelo menos um pedido).
 */
import {
  UF_DO_DDD,
  percentualBp,
  type ConsultaMapaDdd,
  type JanelaRankingResposta,
  type RespostaMapaDdd,
  type Uf,
} from "../../shared/contracts";
import type { LinhaMapaDdd } from "../db/mapa-ddd";

/** Código de discagem do Brasil, como em pedidos.pais. */
const PAIS_BRASIL = "55";

type Totais = { pedidos: number; bilhetes: number; centavos: number };
type Recorte = RespostaMapaDdd["total"];

const vazio = (): Totais => ({ pedidos: 0, bilhetes: 0, centavos: 0 });

function somar(destino: Totais, linha: Totais): void {
  destino.pedidos += linha.pedidos;
  destino.bilhetes += linha.bilhetes;
  destino.centavos += linha.centavos;
}

/** Onde a linha entra: a UF do DDD, `exterior` ou `sem_ddd`. */
export function recorteDaLinha(
  linha: Pick<LinhaMapaDdd, "pais" | "ddd">,
): { uf: Uf; ddd: string } | "exterior" | "sem_ddd" {
  if (linha.pais === null) return "sem_ddd";
  if (linha.pais !== PAIS_BRASIL) return "exterior";
  const { ddd } = linha;
  if (ddd === null || !Object.hasOwn(UF_DO_DDD, ddd)) return "sem_ddd";
  return { uf: UF_DO_DDD[ddd], ddd };
}

/** Comparação binária de textos (siglas e DDDs: maiúsculas e dígitos). */
const crescente = (a: string, b: string): number =>
  a < b ? -1 : a > b ? 1 : 0;

export function montarMapaDdd(
  linhas: readonly LinhaMapaDdd[],
  contexto: {
    janela: JanelaRankingResposta;
    divisao: ConsultaMapaDdd["divisao"];
    agora: Date;
  },
): RespostaMapaDdd {
  const porUf = new Map<Uf, Totais & { uf: Uf }>();
  const porDdd = new Map<string, Totais & { uf: Uf; ddd: string }>();
  const exterior = vazio();
  const semDdd = vazio();
  const total = vazio();

  for (const linha of linhas) {
    somar(total, linha);
    const recorte = recorteDaLinha(linha);
    if (recorte === "exterior") somar(exterior, linha);
    else if (recorte === "sem_ddd") somar(semDdd, linha);
    else {
      const { uf, ddd } = recorte;
      const daUf = porUf.get(uf) ?? { uf, ...vazio() };
      somar(daUf, linha);
      porUf.set(uf, daUf);
      const doDdd = porDdd.get(ddd) ?? { uf, ddd, ...vazio() };
      somar(doDdd, linha);
      porDdd.set(ddd, doDdd);
    }
  }

  const recorte = (totais: Totais): Recorte => ({
    pedidos_aprovados: totais.pedidos,
    bilhetes: totais.bilhetes,
    total_centavos: totais.centavos,
    parte_bilhetes_bp:
      percentualBp(
        { num: BigInt(totais.bilhetes), den: 1n },
        { num: BigInt(total.bilhetes), den: 1n },
      ) ?? 0,
  });

  const ufs = [...porUf.values()].sort(
    (a, b) => b.bilhetes - a.bilhetes || crescente(a.uf, b.uf),
  );
  const posicaoDaUf = new Map(ufs.map((item, indice) => [item.uf, indice]));
  const ddds = [...porDdd.values()].sort(
    (a, b) =>
      posicaoDaUf.get(a.uf)! - posicaoDaUf.get(b.uf)! ||
      b.bilhetes - a.bilhetes ||
      crescente(a.ddd, b.ddd),
  );

  return {
    janela: contexto.janela,
    divisao: contexto.divisao ?? null,
    ufs: ufs.map((item) => ({ ...recorte(item), uf: item.uf })),
    ddds: ddds.map((item) => ({
      ...recorte(item),
      ddd: item.ddd,
      uf: item.uf,
    })),
    exterior: recorte(exterior),
    sem_ddd: recorte(semDdd),
    total: recorte(total),
    atualizado_em: contexto.agora.toISOString(),
  };
}
