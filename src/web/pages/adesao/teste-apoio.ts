// Apoio dos testes da Adesão (só nos testes; nunca vai para o pacote do site): uma API falsa (fetch trocado) com as
// células, a fila de órfãos e os links de vendas, que responde no formato do contrato (conferido pelos schemas) e
// aplica o PUT do vínculo e o DELETE do afiliado de teste como o Worker faria. Usada pela varredura das dicas
// (pages/coordenacao/dicas-fase2.test.tsx); os testes de cada comportamento têm as APIs falsas deles.
import { vi } from "vitest";
import {
  afiliadoResumoSchema,
  corpoSalvarAfiliadoSchema,
  detalhesAfiliadoComPedidosSchema,
  respostaAdesaoSchema,
  respostaListaAfiliadosSchema,
  type AfiliadoResumo,
} from "../../../shared/contracts";
import { respostaJson } from "../../test/renderizar";
import type { CelulaAdesao } from "./adesao-api";
import {
  MODELO_DE_TESTE,
  SLUG_DE_TESTE,
  respostaLinksDe,
} from "./teste-apoio-links";

const SEM_VENDAS = { pedidos_aprovados: 0, bilhetes: 0, total_centavos: 0 };

/** Uma célula fictícia da reunião (sem afiliado e sem telefone, se `dados` não disser outra coisa). */
export function celulaDeTeste(
  id: number,
  nome: string,
  dados: Partial<CelulaAdesao> = {},
): CelulaAdesao {
  return {
    celula_id: id,
    celula_nome: nome,
    qtd_pessoas: 10,
    lider_nome: `Lider ${nome.replace("Célula ", "")}`,
    lider_telefone: null,
    discipulador_id: 1,
    discipulador_nome: "Discipulador Ficticio A",
    rede_id: 1,
    rede_nome: "Rede Jovem Ficticia",
    divisao: "jovens",
    afiliados: [],
    vinculada: false,
    primeira_venda_em: null,
    pedidos_aprovados: 0,
    ...dados,
  };
}

/** Um afiliado sem célula (o que a Rifei mandou e ainda espera o vínculo). */
export function orfaoDeTeste(affiliateId: number): AfiliadoResumo {
  return {
    affiliate_id: affiliateId,
    celula_id: null,
    celula_nome: null,
    rotulo: null,
    origem: "webhook",
    criado_em: "2026-11-11T22:30:00.000Z",
    vinculado_em: null,
    atualizado_em: "2026-11-11T22:30:00.000Z",
    vendas: SEM_VENDAS,
    primeira_venda_em: null,
    ultima_venda_em: null,
  };
}

/**
 * A reunião de cadastro: Ágape (sem afiliado, com o telefone do líder), Betel e Canaã (com afiliado) e Débora (sem
 * afiliado e sem telefone); na fila, os afiliados 1044 e 1043.
 */
export function cenarioDaAdesao(): {
  celulas: CelulaAdesao[];
  orfaos: AfiliadoResumo[];
} {
  return {
    celulas: [
      celulaDeTeste(1, "Célula Ágape", { lider_telefone: "(91) 90000-0001" }),
      celulaDeTeste(2, "Célula Betel", { afiliados: [1001], vinculada: true }),
      celulaDeTeste(3, "Célula Canaã", { afiliados: [1002], vinculada: true }),
      celulaDeTeste(4, "Célula Débora", {
        rede_nome: "Rede Adulta Ficticia",
      }),
    ],
    orfaos: [orfaoDeTeste(1044), orfaoDeTeste(1043)],
  };
}

type Opcoes = Partial<ReturnType<typeof cenarioDaAdesao>> & {
  /** O modelo do link de vendas (padrão: o de teste, para a seção mostrar o link de cada célula). */
  modelo?: string | null;
  /** Pedidos que ainda contam, por afiliado: com algum, o DELETE dá 409 `afiliado_com_pedidos`. */
  comPedidos?: Record<number, string[]>;
  /** Quantas das próximas consultas do painel falham sem conexão. */
  falhas?: number;
};

/**
 * Troca o fetch pela API falsa da Adesão: o painel (GET adesao e GET afiliados?vinculado=false), os links de vendas
 * e a campanha (o slug, só para o admin), o PUT do vínculo e o DELETE do afiliado. `segurarGravacoes()` deixa os
 * próximos PUT e DELETE esperando (a tela fica em "Salvando…") até a função devolvida ser chamada.
 */
export function simularApiAdesao({
  celulas = cenarioDaAdesao().celulas,
  orfaos = cenarioDaAdesao().orfaos,
  modelo = MODELO_DE_TESTE,
  comPedidos = {},
  falhas = 0,
}: Opcoes = {}) {
  const estado = { celulas: structuredClone(celulas), orfaos, falhas };
  const inesperadas: string[] = [];
  let portao: Promise<void> | null = null;

  function aplicarVinculo(affiliateId: number, celulaId: number | null) {
    const destino = estado.celulas.find((c) => c.celula_id === celulaId);
    const anterior =
      estado.orfaos.find((o) => o.affiliate_id === affiliateId) ??
      orfaoDeTeste(affiliateId);
    estado.orfaos = estado.orfaos.filter((o) => o.affiliate_id !== affiliateId);
    for (const celula of estado.celulas) {
      celula.afiliados = celula.afiliados.filter((id) => id !== affiliateId);
      celula.vinculada = celula.afiliados.length > 0;
    }
    const salvo: AfiliadoResumo = {
      ...anterior,
      celula_id: destino?.celula_id ?? null,
      celula_nome: destino?.celula_nome ?? null,
      vinculado_em: destino ? "2026-11-11T22:35:00.000Z" : null,
    };
    if (destino) {
      destino.afiliados = [...destino.afiliados, affiliateId].sort(
        (a, b) => a - b,
      );
      destino.vinculada = true;
    } else {
      estado.orfaos = [salvo, ...estado.orfaos];
    }
    return afiliadoResumoSchema.parse(salvo);
  }

  const fetchMock = vi.fn(
    async (url: string, init?: RequestInit): Promise<Response> => {
      const metodo = init?.method ?? "GET";
      if (metodo === "GET" && url === "/api/admin/adesao") {
        if (estado.falhas > 0) {
          estado.falhas -= 1;
          throw new TypeError("Failed to fetch");
        }
        return respostaJson(
          respostaAdesaoSchema.parse({
            resumo: {
              celulas: estado.celulas.length,
              vinculadas: estado.celulas.filter((c) => c.vinculada).length,
              com_venda: 0,
              afiliados_nao_vinculados: estado.orfaos.length,
            },
            itens: estado.celulas,
          }),
        );
      }
      if (metodo === "GET" && url === "/api/admin/afiliados?vinculado=false")
        return respostaJson(
          respostaListaAfiliadosSchema.parse({
            itens: estado.orfaos,
            sem_afiliado: SEM_VENDAS,
          }),
        );
      if (metodo === "GET" && url === "/api/admin/links-vendas")
        return respostaJson(respostaLinksDe(estado.celulas, modelo));
      if (metodo === "GET" && url === "/api/admin/campanha")
        return respostaJson({ slug_rifei: SLUG_DE_TESTE });
      const afiliado = /^\/api\/admin\/afiliados\/(\d+)$/.exec(url);
      if (afiliado && (metodo === "PUT" || metodo === "DELETE")) {
        if (portao) await portao;
        const affiliateId = Number(afiliado[1]);
        if (metodo === "PUT") {
          const { celula_id } = corpoSalvarAfiliadoSchema.parse(
            JSON.parse(String(init?.body)),
          );
          return respostaJson(aplicarVinculo(affiliateId, celula_id));
        }
        const pedidos = comPedidos[affiliateId];
        if (pedidos)
          return respostaJson(
            {
              erro: {
                codigo: "afiliado_com_pedidos",
                mensagem: "O afiliado tem pedidos que contam",
                detalhes: detalhesAfiliadoComPedidosSchema.parse({
                  pedidos_que_contam: pedidos.length,
                  pedidos,
                }),
              },
            },
            409,
          );
        aplicarVinculo(affiliateId, null);
        estado.orfaos = estado.orfaos.filter(
          (o) => o.affiliate_id !== affiliateId,
        );
        return new Response(null, { status: 204 });
      }
      inesperadas.push(`${metodo} ${url}`);
      return respostaJson(
        { erro: { codigo: "nao_encontrado", mensagem: "Rota não encontrada" } },
        404,
      );
    },
  );

  vi.stubGlobal("fetch", fetchMock);
  return {
    estado,
    inesperadas,
    fetchMock,
    /** Os próximos PUT e DELETE esperam até a função devolvida ser chamada. */
    segurarGravacoes() {
      let soltar = () => {};
      portao = new Promise<void>((resolver) => {
        soltar = resolver;
      });
      return () => {
        portao = null;
        soltar();
      };
    },
  };
}
