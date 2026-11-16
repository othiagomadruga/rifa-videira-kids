// Apoio dos testes do extrato do banco (RIFA-059): extratos SINTÉTICOS (OFX 1.x e 2.x, texto colado em 3 formatos e
// CSV), pedidos da lista de pedidos (cada resposta passa pelo schema ESTRITO do contrato) e uma API falsa que guarda
// cada chamada (método, endereço e corpo). Nenhum dado é real: nomes, números de pedido, FITIDs e contas são fictícios.
import { vi } from "vitest";
import {
  respostaPedidosSchema,
  type ItemPedido,
  type RespostaPedidos,
} from "../../../../shared/contracts/api";
import { respostaJson } from "../../../test/renderizar";
import type { PedidoDoCruzamento } from "./cruzamento";
import type { ContextoDeLeitura, Pix } from "./lancamentos";

/** O fuso da campanha nos testes (o padrão da D8) e o "agora" dos testes (18/11/2026, 09:00 em Belém). */
export const FUSO = "America/Belem";
export const AGORA = Date.parse("2026-11-18T12:00:00Z");
export const CONTEXTO: ContextoDeLeitura = { fuso: FUSO, agora: AGORA };

/** Os nomes fictícios de quem pagou: só podem aparecer na tela, nunca numa chamada, no storage ou no log. */
export const PAGADORA_UM = "Pagadora Ficticia Um";
export const PAGADOR_DOIS = "Pagador Ficticio Dois";
export const PAGADORA_TRES = "Pagadora Ficticia Tres";
export const FITID_UM = "2026111600001";

/** OFX 1.x (SGML): as tags de valor não fecham, CHARSET 1252, datas com o deslocamento [-3:BRT]. */
export const OFX_SGML = [
  "OFXHEADER:100",
  "DATA:OFXSGML",
  "VERSION:102",
  "SECURITY:NONE",
  "ENCODING:USASCII",
  "CHARSET:1252",
  "COMPRESSION:NONE",
  "OLDFILEUID:NONE",
  "NEWFILEUID:NONE",
  "",
  "<OFX>",
  "<SIGNONMSGSRSV1><SONRS><STATUS><CODE>0<SEVERITY>INFO</STATUS><DTSERVER>20261116180000[-3:BRT]<LANGUAGE>POR</SONRS></SIGNONMSGSRSV1>",
  "<BANKMSGSRSV1>",
  "<STMTTRNRS>",
  "<TRNUID>1",
  "<STMTRS>",
  "<CURDEF>BRL",
  "<BANKACCTFROM>",
  "<BANKID>0237",
  "<ACCTID>99999",
  "<ACCTTYPE>CHECKING",
  "</BANKACCTFROM>",
  "<BANKTRANLIST>",
  "<DTSTART>20261116000000[-3:BRT]",
  "<DTEND>20261116235959[-3:BRT]",
  // Um Pix com o número do pedido no MEMO (Certo).
  "<STMTTRN>",
  "<TRNTYPE>CREDIT",
  "<DTPOSTED>20261116100500[-3:BRT]",
  "<TRNAMT>20.00",
  `<FITID>${FITID_UM}`,
  "<CHECKNUM>1400200",
  `<MEMO>TRANSFERENCIA PIX PEDTESTE0101 REM: ${PAGADORA_UM}`,
  "</STMTTRN>",
  // Um Pix sem número, com um pedido só de R$ 40,00 na janela (Provável).
  "<STMTTRN>",
  "<TRNTYPE>CREDIT",
  "<DTPOSTED>20261116143000[-3:BRT]",
  "<TRNAMT>40,00",
  "<FITID>2026111600002",
  "<MEMO>TRANSFERENCIA PIX",
  `<NAME>REM: ${PAGADOR_DOIS}`,
  "</STMTTRN>",
  // Um débito (fica de fora).
  "<STMTTRN>",
  "<TRNTYPE>DEBIT",
  "<DTPOSTED>20261116150000[-3:BRT]",
  "<TRNAMT>-15.00",
  "<FITID>2026111600003",
  "<MEMO>TRANSFERENCIA PIX DES: LOJA FICTICIA",
  "</STMTTRN>",
  // Um crédito que não é Pix (fica de fora).
  "<STMTTRN>",
  "<TRNTYPE>CREDIT",
  "<DTPOSTED>20261116160000[-3:BRT]",
  "<TRNAMT>300.00",
  "<FITID>2026111600004",
  "<MEMO>TED RECEBIDA EMPRESA FICTICIA",
  "</STMTTRN>",
  // Um Pix de R$ 20,00 com dois pedidos que servem (Ambíguo).
  "<STMTTRN>",
  "<TRNTYPE>CREDIT",
  "<DTPOSTED>20261116170000[-3:BRT]",
  "<TRNAMT>20.00",
  "<FITID>2026111600005",
  `<MEMO>PIX RECEBIDO ${PAGADORA_TRES}`,
  "</STMTTRN>",
  // Um Pix de um valor que nenhum pedido tem (sem pedido).
  "<STMTTRN>",
  "<TRNTYPE>CREDIT",
  "<DTPOSTED>20261116173000[-3:BRT]",
  "<TRNAMT>7.77",
  "<FITID>2026111600006",
  "<MEMO>PIX RECEBIDO OUTRA PESSOA FICTICIA",
  "</STMTTRN>",
  "</BANKTRANLIST>",
  "<LEDGERBAL><BALAMT>1305.00<DTASOF>20261116180000[-3:BRT]</LEDGERBAL>",
  "</STMTRS>",
  "</STMTTRNRS>",
  "</BANKMSGSRSV1>",
  "</OFX>",
  "",
].join("\r\n");

/** OFX 2.x (XML), numa linha só, com as tags fechadas, entidades, data com milissegundos e o valor com ponto. */
export const OFX_XML =
  '<?xml version="1.0" encoding="UTF-8" standalone="no"?>' +
  '<?OFX OFXHEADER="200" VERSION="211" SECURITY="NONE" OLDFILEUID="NONE" NEWFILEUID="NONE"?>' +
  "<OFX><BANKMSGSRSV1><STMTTRNRS><STMTRS><CURDEF>BRL</CURDEF><BANKTRANLIST>" +
  "<DTSTART>20261117</DTSTART><DTEND>20261117</DTEND>" +
  "<STMTTRN><TRNTYPE>CREDIT</TRNTYPE><DTPOSTED>20261117091245.000[-3:BRT]</DTPOSTED><TRNAMT>1234.56</TRNAMT>" +
  `<FITID>E2E0001</FITID><NAME>${PAGADOR_DOIS}</NAME><MEMO>PIX RECEBIDO &amp; CONFIRMADO</MEMO></STMTTRN>` +
  "<STMTTRN><TRNTYPE>XFER</TRNTYPE><DTPOSTED>20261117120000[-03:EST]</DTPOSTED><TRNAMT>+25.5</TRNAMT>" +
  "<FITID>E2E0002</FITID><MEMO>TRANSF RECEBIDA</MEMO></STMTTRN>" +
  "<STMTTRN><TRNTYPE>DEBIT</TRNTYPE><DTPOSTED>20261117130000</DTPOSTED><TRNAMT>-9.90</TRNAMT>" +
  "<FITID>E2E0003</FITID><MEMO>TARIFA</MEMO></STMTTRN>" +
  "</BANKTRANLIST></STMTRS></STMTTRNRS></BANKMSGSRSV1></OFX>";

/** OFX sem a hora (todas as datas à meia-noite): o cruzamento usa só o dia. */
export const OFX_SEM_HORA = OFX_SGML.replace(
  /<DTPOSTED>(\d{8})\d{6}\[-3:BRT\]/g,
  "<DTPOSTED>$1000000[-3:BRT]",
);

/** Texto colado 1: a tabela do Bradesco copiada da tela (tabulações), com o "REM:" na linha de baixo. Sem hora. */
export const TEXTO_TABELA = [
  "Data\tLançamento\tDcto.\tCrédito (R$)\tDébito (R$)\tSaldo (R$)",
  "16/11/2026\tSALDO ANTERIOR\t\t\t\t1.000,00",
  "16/11/2026\tTRANSFERENCIA PIX\t1400200\t20,00\t\t1.020,00",
  `\tREM: ${PAGADORA_UM} 16/11\t\t\t\t`,
  "16/11/2026\tTRANSFERENCIA PIX\t1400201\t\t15,00\t1.005,00",
  "\tDES: Loja Ficticia 16/11\t\t\t\t",
  "16/11/2026\tPAGTO ELETRON COBRANCA\t0001\t\t50,00\t955,00",
  "17/11/2026\tPIX QR CODE DINAMICO\t1400300\t1.234,56\t\t2.189,56",
  `\tREM: ${PAGADOR_DOIS} 17/11\t\t\t\t`,
].join("\n");

/** Texto colado 2: uma linha por lançamento, com a hora, "R$" e o sinal; a data com e sem o século. */
export const TEXTO_LINHAS = [
  `16/11/2026 10:05 PIX RECEBIDO ${PAGADORA_UM} R$ 20,00`,
  "16/11/2026 11:30 PIX ENVIADO LOJA FICTICIA -R$ 15,00",
  "16/11/2026 14:00 TED RECEBIDA EMPRESA FICTICIA R$ 300,00",
  "16/11/2026 18:00 SALDO DO DIA R$ 1.305,00",
  `17/11/26 09:12:45 Pix recebido - ${PAGADOR_DOIS} + R$ 1.234,56`,
].join("\r\n");

/** Texto colado 3: o jeito dos apps, com a data numa linha só (sem o ano na segunda), "−" e o C do fim. */
export const TEXTO_APP = [
  "Segunda-feira, 16 de novembro de 2026",
  `10:05  Transferência recebida pelo Pix  ${PAGADORA_UM}  20,00 C`,
  "11:30  Pix enviado  Loja Ficticia  − 15,00",
  "",
  "Terça, 17 nov",
  `09h12  Pix recebido  ${PAGADOR_DOIS}  1.234,56 C`,
].join("\n");

/** CSV com linhas de título antes do cabeçalho, data e hora numa coluna e o número do pedido no documento. */
export const CSV_EXTRATO = [
  "Extrato de conta corrente",
  "Agência 0000 Conta 00000-0",
  "Data;Histórico;Documento;Valor (R$);Saldo (R$)",
  `16/11/2026 10:05;PIX RECEBIDO ${PAGADORA_UM};PEDTESTE0101;20,00;1.020,00`,
  "16/11/2026 11:30;PIX ENVIADO LOJA FICTICIA;;-15,00;1.005,00",
  `16/11/2026 14:30;PIX RECEBIDO ${PAGADOR_DOIS};;40,00;1.045,00`,
  "",
].join("\r\n");

/** Os textos do extrato que nunca podem sair do navegador (chamadas à API, storage, log). */
export const TEXTOS_DO_EXTRATO = [
  PAGADORA_UM,
  PAGADOR_DOIS,
  PAGADORA_TRES,
  FITID_UM,
  "1400200",
  "LOJA FICTICIA",
  "Loja Ficticia",
  "TRANSFERENCIA",
  "Ficticia",
  "Ficticio",
];

// ---------------------------------------------------------------------------------------------------
// Pedidos
// ---------------------------------------------------------------------------------------------------

/** "2026-11-16 09:58" em Belém (UTC−3), como ISO com milissegundos (o formato da API). */
export const belem = (data: string, hora: string) =>
  new Date(`${data}T${hora}:00-03:00`).toISOString();

/** Um item da lista de pedidos (GET /api/admin/pedidos), sem dado do comprador. */
export function itemPedido(
  id: string,
  dados: Partial<ItemPedido> & { reserva?: string } = {},
): ItemPedido {
  const { reserva, ...resto } = dados;
  const criado = reserva ?? belem("2026-11-16", "09:58");
  return {
    id,
    status: "in_process",
    qtd_bilhetes: 1,
    total_centavos: 2000,
    affiliate_id: 101,
    celula_id: 1,
    celula_nome: "Célula Ágape",
    ddd: "91",
    criado_em: criado,
    aprovado_em: null,
    expirado_em: null,
    registrado_em: criado,
    atualizado_em: criado,
    suspeito: false,
    desconsiderado: null,
    origem: "webhook",
    ...resto,
  };
}

/** Os pedidos do cenário dos extratos de exemplo (do registrado mais novo para o mais antigo, como a API manda). */
export const PEDIDOS_DO_CENARIO: ItemPedido[] = [
  itemPedido("PEDTESTE0102", {
    status: "approved",
    total_centavos: 123456,
    qtd_bilhetes: 62,
    reserva: belem("2026-11-17", "09:05"),
    aprovado_em: belem("2026-11-17", "10:00"),
  }),
  itemPedido("PEDTESTE0105", {
    total_centavos: 2000,
    reserva: belem("2026-11-16", "16:40"),
    celula_id: 2,
    celula_nome: "Célula Betel",
  }),
  itemPedido("PEDTESTE0104", {
    total_centavos: 2000,
    reserva: belem("2026-11-16", "16:20"),
    status: "expired",
    expirado_em: belem("2026-11-16", "16:50"),
  }),
  itemPedido("PEDTESTE0103", {
    total_centavos: 4000,
    qtd_bilhetes: 2,
    reserva: belem("2026-11-16", "14:25"),
    celula_id: 2,
    celula_nome: "Célula Betel",
  }),
  itemPedido("PEDTESTE0101", { reserva: belem("2026-11-16", "09:58") }),
];

/** As páginas da lista: `porPagina` itens, com o cursor opaco "pagina-N". */
export function paginasDe(
  itens: readonly ItemPedido[],
  porPagina = 200,
): RespostaPedidos[] {
  const paginas: RespostaPedidos[] = [];
  for (
    let inicio = 0;
    inicio < Math.max(itens.length, 1);
    inicio += porPagina
  ) {
    const numero = paginas.length + 1;
    paginas.push(
      respostaPedidosSchema.parse({
        itens: itens.slice(inicio, inicio + porPagina),
        proximo:
          inicio + porPagina < itens.length ? `pagina-${numero + 1}` : null,
        totais:
          numero === 1
            ? {
                in_process: { pedidos: 0, bilhetes: 0, total_centavos: 0 },
                approved: { pedidos: 0, bilhetes: 0, total_centavos: 0 },
                expired: { pedidos: 0, bilhetes: 0, total_centavos: 0 },
              }
            : null,
      }),
    );
  }
  return paginas;
}

export type Chamada = {
  metodo: string;
  url: string;
  corpo: string | undefined;
};

/**
 * A API falsa do extrato: GET /api/admin/campanha (o fuso) e GET /api/admin/pedidos (as páginas, pelo cursor). Guarda
 * cada chamada como saiu (método, endereço inteiro e corpo cru), para a varredura da privacidade.
 */
export function criarApiDoExtrato(
  opcoes: {
    pedidos?: readonly ItemPedido[];
    porPagina?: number;
    campanha?: object | null;
    falharPedidos?: () => Response | null;
  } = {},
) {
  const chamadas: Chamada[] = [];
  const paginas = paginasDe(
    opcoes.pedidos ?? PEDIDOS_DO_CENARIO,
    opcoes.porPagina,
  );
  const fetch = vi.fn(
    async (entrada: RequestInfo | URL, init?: RequestInit) => {
      const url = String(entrada);
      const metodo = init?.method ?? "GET";
      chamadas.push({
        metodo,
        url,
        corpo:
          typeof init?.body === "string"
            ? init.body
            : init?.body == null
              ? undefined
              : "(corpo não textual)",
      });
      const endereco = new URL(url, "http://localhost");
      if (endereco.pathname === "/api/admin/campanha") {
        const campanha =
          opcoes.campanha === undefined
            ? { fuso_horario: FUSO }
            : opcoes.campanha;
        return campanha === null
          ? respostaJson(
              {
                erro: {
                  codigo: "nao_encontrado",
                  mensagem: "Campanha não configurada",
                },
              },
              404,
            )
          : respostaJson(campanha);
      }
      if (endereco.pathname === "/api/admin/pedidos") {
        const falha = opcoes.falharPedidos?.();
        if (falha) return falha;
        const cursor = endereco.searchParams.get("antes_de");
        const numero =
          cursor === null ? 1 : Number(cursor.replace("pagina-", ""));
        return respostaJson(paginas[numero - 1] ?? paginasDe([])[0]);
      }
      if (endereco.pathname === "/api/admin/reconciliacao/recuperacoes")
        return respostaJson({ itens: [], proximo: null });
      return respostaJson(
        { erro: { codigo: "nao_encontrado", mensagem: "Rota não encontrada" } },
        404,
      );
    },
  );
  return {
    fetch,
    chamadas,
    pedidos: () =>
      chamadas.filter((chamada) =>
        chamada.url.startsWith("/api/admin/pedidos"),
      ),
  };
}

// ---------------------------------------------------------------------------------------------------
// Pix e pedidos do cruzamento (os testes do algoritmo)
// ---------------------------------------------------------------------------------------------------

/** Um Pix: `quando` com a hora ("2026-11-16 10:05", em Belém) ou só o dia ("2026-11-16"). */
export function pix(
  ordem: number,
  quando: string,
  centavos: number,
  descricao = "PIX RECEBIDO",
  identificadores: string[] = [],
): Pix {
  const [dia, hora] = quando.split(" ");
  const inicioDoDia = Date.parse(`${dia}T00:00:00-03:00`);
  const instante =
    hora === undefined ? null : Date.parse(`${dia}T${hora}:00-03:00`);
  return {
    ordem,
    chave: `L${ordem}`,
    dia,
    instante,
    centavos,
    descricao,
    identificadores,
    inicio: instante ?? inicioDoDia,
    fim: instante ?? inicioDoDia + 86_400_000 - 1,
  };
}

/** Um pedido do cruzamento: reservado em `reserva` ("2026-11-16 09:58", em Belém). */
export function pedido(
  id: string,
  reserva: string,
  centavos = 2000,
  dados: Partial<PedidoDoCruzamento> & { aprovado?: string } = {},
): PedidoDoCruzamento {
  const { aprovado, ...resto } = dados;
  const instante = (texto: string) => {
    const [dia, hora] = texto.split(" ");
    return Date.parse(`${dia}T${hora}:00-03:00`);
  };
  return {
    id,
    status: aprovado ? "approved" : "in_process",
    qtd_bilhetes: 1,
    total_centavos: centavos,
    celula_nome: "Célula Ágape",
    reserva: instante(reserva),
    aprovado_em: aprovado ? instante(aprovado) : null,
    desconsiderado: false,
    ...resto,
  };
}
