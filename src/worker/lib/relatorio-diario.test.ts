// RIFA-086 (D40): o montador do relatório diário por e-mail (puro: sem banco, sem rede). Cenário do painel
// (test/painel-apoio.ts): 5 células, 10 bilhetes por pessoa, 21 dias desde 23/11/2026 em Belém, 3 semanas 35/25/45.
// Grupos: Caleb (Dorcas, Éfeso) em "Adultos da manhã", Abel (Ágape, Betel) em "Adultos da noite" e Boaz (Canaã) em
// "Adolescentes"; Davi, sem células, em "Jovens".
import { describe, expect, it } from "vitest";
import {
  LINK_PAINEL_RELATORIO_DIARIO,
  type CelulaCalculo,
  type EntradaCalculo,
  type GrupoCalculo,
  type RespostaSaldoEfi,
} from "../../shared/contracts";
import {
  CAMPANHA,
  CELULAS,
  PEDIDOS,
  aprovado,
  entradaEsperada,
} from "../test/painel-apoio";
import {
  assuntoDoRelatorioDiario,
  dadosDoRelatorioDiario,
  diaDaSemana,
  escaparHtml,
  formatarInteiro,
  formatarPercentualBp,
  formatarReais,
  horaNoFuso,
  intervaloDeDias,
  juntarNomes,
  montarRelatorioDiario,
  type DadosRelatorioDiario,
} from "./relatorio-diario";

const GRUPOS: GrupoCalculo[] = [
  { id: 1, nome: "Adultos da manhã", ordem: 1, discipuladores: [30] },
  { id: 2, nome: "Adultos da noite", ordem: 2, discipuladores: [10] },
  { id: 3, nome: "Jovens", ordem: 3, discipuladores: [40] },
  { id: 4, nome: "Adolescentes", ordem: 4, discipuladores: [20] },
];

const SALDO_OK: RespostaSaldoEfi = {
  configurado: true,
  saldo_centavos: 1234567,
  consultado_em: "2026-12-01T10:00:03.000Z",
};

const SALDO_FALHOU: RespostaSaldoEfi = {
  configurado: true,
  saldo_centavos: null,
  consultado_em: "2026-12-01T10:00:03.000Z",
  erro: "tempo_esgotado",
};

const SEM_EFI: RespostaSaldoEfi = {
  configurado: false,
  saldo_centavos: null,
  consultado_em: "2026-12-01T10:00:03.000Z",
};

function dadosDe(
  data: string,
  opcoes: {
    entrada?: EntradaCalculo;
    grupos?: GrupoCalculo[];
    saldo?: RespostaSaldoEfi;
  } = {},
): DadosRelatorioDiario {
  const dados = dadosDoRelatorioDiario(
    opcoes.entrada ?? entradaEsperada(),
    opcoes.grupos ?? GRUPOS,
    data,
    opcoes.saldo ?? SALDO_OK,
  );
  if (dados === null) throw new Error(`${data}: fora da campanha`);
  return dados;
}

/** Cada trecho aparece no texto DEPOIS do anterior (a ordem do modelo): devolve os que faltam ou estão fora de ordem. */
function foraDeOrdem(texto: string, trechos: readonly string[]): string[] {
  let desde = 0;
  const problemas: string[] = [];
  for (const trecho of trechos) {
    const posicao = texto.indexOf(trecho, desde);
    if (posicao < 0) problemas.push(trecho);
    else desde = posicao + trecho.length;
  }
  return problemas;
}

describe("montarRelatorioDiario: o e-mail de segunda, 30/11 (dia 8, o 1º da Semana 2)", () => {
  const email = montarRelatorioDiario(dadosDe("2026-11-30"));

  it("assunto: 'Projeto Videira Kids · resumo de <dia da semana>, <dd/mm>'", () => {
    expect(email.assunto).toBe(
      "Projeto Videira Kids · resumo de segunda, 30/11",
    );
    expect(assuntoDoRelatorioDiario("2026-11-24")).toBe(
      "Projeto Videira Kids · resumo de terça, 24/11",
    );
  });

  it("texto puro: o conteúdo inteiro, na ordem do modelo, com os números em pt-BR", () => {
    expect(email.texto).toBe(
      [
        "PROJETO VIDEIRA KIDS",
        "Resumo de segunda, 30/11 · dia 8 de 21",
        "",
        // 135 bilhetes (com os 6 sem célula); R$ 2.700,00 menos o desconto de R$ 16,00 da Dorcas.
        "R$ 2.684,00 arrecadados · 135 bilhetes vendidos",
        "22,5% do alvo da campanha (600 bilhetes)",
        "",
        "No dia: 17 bilhetes (meta 103)",
        // 17 de 142,857... (25/105 de 600) = 11,9%.
        "Semana 2 · 30/11 a 06/12: 17 de 143 · 11,9%",
        "",
        "CÉLULAS QUE MAIS AVANÇARAM",
        "1. Célula Ágape: 39,1% · 47",
        "2. Célula Betel: 30,0% · 18",
        "3. Célula Canaã: 20,0% · 24",
        "4. Célula Dorcas: 17,5% · 35",
        "5. Célula Éfeso: 5,0% · 5",
        "(% do alvo da célula (10 bilhetes por membro) · bilhetes vendidos)",
        "",
        "POR GRUPO · QUEM LIDERA",
        "Adultos da manhã: Célula Dorcas",
        "Adultos da noite: Célula Ágape",
        "Adolescentes: Célula Canaã",
        "",
        "DISCIPULADORES",
        "Discipulador Abel 36,1% · Discipulador Boaz 20,0% · Discipulador Caleb 13,3%",
        "",
        "ATENÇÃO",
        "• Todas as 5 células já venderam",
        "• 6 bilhetes foram vendidos sem link de célula (não contam para nenhuma)",
        "• Saldo na Efí: R$ 12.345,67 (às 07:00)",
        "",
        `Abrir o painel completo: ${LINK_PAINEL_RELATORIO_DIARIO}`,
        "",
        "Enviado todo dia às 7h · Projeto Videira Kids",
        "",
      ].join("\n"),
    );
  });

  it("HTML: as mesmas seções na mesma ordem, os mesmos números e o botão para o painel", () => {
    expect(email.html.startsWith("<!doctype html>")).toBe(true);
    expect(
      foraDeOrdem(email.html, [
        "PROJETO VIDEIRA KIDS",
        "Resumo de segunda, 30/11 · dia 8 de 21",
        "R$ 2.684,00",
        "<b>135 bilhetes</b> vendidos",
        "width:22.5%",
        "22,5% do alvo da campanha (600 bilhetes)",
        "No dia",
        "<b>17</b> bilhetes",
        "(meta 103)",
        "Semana 2 · 30/11 a 06/12",
        "<b>17</b> de 143 · 11,9%",
        "CÉLULAS QUE MAIS AVANÇARAM",
        "1. Célula Ágape",
        "<b>39,1%</b>",
        "5. Célula Éfeso",
        "% do alvo da célula (10 bilhetes por membro) · bilhetes vendidos",
        "POR GRUPO · QUEM LIDERA",
        "Adultos da manhã",
        "Célula Dorcas",
        "Adolescentes",
        "DISCIPULADORES",
        "Discipulador Abel <b>36,1%</b>",
        "Atenção",
        "Todas as 5 células já venderam",
        "6 bilhetes foram vendidos sem link de célula",
        "Saldo na Efí: <b>R$ 12.345,67</b>",
        `href="${LINK_PAINEL_RELATORIO_DIARIO}"`,
        "Abrir o painel completo",
        "Enviado todo dia às 7h · Projeto Videira Kids",
      ]),
    ).toEqual([]);
  });

  it("HTML de e-mail: uma coluna de até 560 px, só estilos inline, sem script, sem classe e sem nada externo", () => {
    expect(email.html).toContain("max-width:560px");
    expect(email.html).toContain(
      "<title>Projeto Videira Kids · resumo de segunda, 30/11</title>",
    );
    for (const proibido of [
      /<script/i,
      /<style/i,
      /<link/i,
      /<img/i,
      /\sclass=/i,
      /\son[a-z]+=/i,
      /src=/i,
    ])
      expect(email.html).not.toMatch(proibido);
    // Só um link, o do painel.
    expect(email.html.match(/href=/g)).toHaveLength(1);
  });
});

describe("dadosDoRelatorioDiario", () => {
  it("o dia de referência fecha às 23:59:59.999 de Belém: a venda das 03:00Z do dia seguinte não entra", () => {
    // Dia 7 (29/11): a venda de 30/11 02:59:59.999Z (Ágape, 6) entra; a de 30/11 03:00Z (Canaã, 6) não.
    const dados = dadosDe("2026-11-29");
    expect(dados.dia_campanha).toBe(7);
    expect(dados.dia.realizado).toBe(6);
    // Sem as 17 do dia 8 (Canaã 6, Ágape 5, Betel 6).
    expect(dados.vendas.bilhetes).toBe(135 - 17);
    expect(dados.periodo).toMatchObject({
      nome: "Semana 1",
      data_inicio: "2026-11-23",
      data_fim: "2026-11-29",
    });
  });

  it("só as células que já venderam entram nas 5 primeiras; as que não venderam vão para o aviso; discipulador sem venda, à parte", () => {
    // Dia 1 (23/11): Ágape (6), Betel (3) e Dorcas (20) venderam; Canaã e Éfeso não.
    const dados = dadosDe("2026-11-23");
    expect(dados.celulas.map((celula) => celula.nome)).toEqual([
      "Célula Dorcas",
      "Célula Ágape",
      "Célula Betel",
    ]);
    expect(dados.celulas_sem_venda).toBe(2);
    expect(dados.total_celulas).toBe(5);
    // Caleb: 20 de 300 (6,6%); Abel: 9 de 180 (5%); Boaz: nada.
    expect(dados.discipuladores).toEqual({
      com_venda: [
        { nome: "Discipulador Caleb", percentual_meta_bp: 666 },
        { nome: "Discipulador Abel", percentual_meta_bp: 500 },
      ],
      sem_venda: ["Discipulador Boaz"],
    });
    const { texto, html } = montarRelatorioDiario(dados);
    expect(texto).toContain("• 2 de 5 células ainda não venderam");
    expect(texto).toContain("Sem venda ainda: Discipulador Boaz");
    expect(texto).not.toContain("sem link de célula");
    expect(html).toContain("Sem venda ainda: Discipulador Boaz");
  });

  it("grupo sem venda: 'ainda sem vendas'; empate em 1º: os dois; sem grupo nenhum, a seção some", () => {
    // Dia 1: Canaã (Boaz, Adolescentes) não vendeu; Davi (Jovens) não tem células, então "Jovens" não aparece.
    const dia1 = montarRelatorioDiario(dadosDe("2026-11-23"));
    expect(dia1.texto).toContain(
      [
        "POR GRUPO · QUEM LIDERA",
        "Adultos da manhã: Célula Dorcas",
        // Ágape (6 de 120) e Betel (3 de 60) empatam em 5%.
        "Adultos da noite: Célula Ágape e Célula Betel",
        "Adolescentes: ainda sem vendas",
      ].join("\n"),
    );
    expect(dia1.texto).not.toContain("Jovens:");
    expect(dia1.html).toMatch(
      /Adolescentes<\/td><td style="[^"]*color:#8a8499[^"]*">ainda sem vendas</,
    );

    // Empate: Ágape (12 pessoas) e Canaã (12 pessoas) no mesmo grupo, com 6 bilhetes cada no 1º dia.
    const empate: EntradaCalculo = {
      ...entradaEsperada(CAMPANHA, [
        aprovado(101, "2026-11-23T15:00:00.000Z", 6),
        aprovado(103, "2026-11-23T16:00:00.000Z", 6),
      ]),
    };
    const juntos = dadosDe("2026-11-23", {
      entrada: empate,
      grupos: [
        { id: 2, nome: "Adultos da noite", ordem: 2, discipuladores: [10, 20] },
      ],
    });
    expect(juntos.grupos).toEqual([
      { nome: "Adultos da noite", primeiros: ["Célula Ágape", "Célula Canaã"] },
    ]);
    expect(montarRelatorioDiario(juntos).texto).toContain(
      "Adultos da noite: Célula Ágape e Célula Canaã",
    );

    const semGrupos = montarRelatorioDiario(
      dadosDe("2026-11-30", { grupos: [] }),
    );
    expect(semGrupos.texto).not.toContain("POR GRUPO");
    expect(semGrupos.html).not.toContain("POR GRUPO");
  });

  it("saldo da Efí indisponível: a consulta falhou ou a Efí não está configurada", () => {
    for (const saldo of [SALDO_FALHOU, SEM_EFI]) {
      const dados = dadosDe("2026-11-30", { saldo });
      expect(dados.saldo_efi).toBeNull();
      const { texto, html } = montarRelatorioDiario(dados);
      expect(texto).toContain("• Saldo na Efí: indisponível\n");
      expect(html).toContain(
        'Saldo na Efí: <span style="color:#8a8499">indisponível</span>',
      );
      expect(texto).not.toContain("R$ 12.345,67");
    }
  });

  it("fora da campanha (antes do 1º dia ou depois do último), null: o e-mail não sai", () => {
    for (const data of ["2026-11-20", "2026-11-22", "2026-12-14", "2027-01-10"])
      expect({
        data,
        dados: dadosDoRelatorioDiario(
          entradaEsperada(),
          GRUPOS,
          data,
          SALDO_OK,
        ),
      }).toEqual({ data, dados: null });
    expect(dadosDe("2026-11-23").dia_campanha).toBe(1);
    // O último dia (13/12) sai: o e-mail de 14/12 de manhã fecha a campanha.
    const ultimo = dadosDe("2026-12-13");
    expect(ultimo.dia_campanha).toBe(21);
    expect(ultimo.vendas.bilhetes).toBe(
      PEDIDOS.filter(
        (pedido) =>
          pedido.status === "approved" &&
          pedido.campanha !== "outra" &&
          pedido.aprovado_em! >= "2026-11-23T03:00:00.000Z" &&
          pedido.aprovado_em! < "2026-12-14T03:00:00.000Z",
      ).reduce((soma, pedido) => soma + pedido.qtd_bilhetes, 0),
    );
  });

  it("nada pessoal: só números agregados e nomes de células, discipuladores e grupos (nada do líder nem do comprador)", () => {
    const dados = dadosDe("2026-11-30");
    const chaves = JSON.stringify(dados);
    for (const campo of [
      "telefone",
      "email",
      "comprador",
      "lider",
      "affiliate",
      "pedido",
    ])
      expect(chaves.toLowerCase()).not.toContain(campo);
    const { texto, html } = montarRelatorioDiario(dados);
    for (const conteudo of [texto, html]) {
      expect(conteudo).not.toMatch(/@/);
      expect(conteudo).not.toMatch(/\(\d{2}\)\s?\d{4,5}-?\d{4}|\+55\d{10,11}/);
    }
  });

  it("nomes digitados pela coordenação saem escapados no HTML (e como estão no texto)", () => {
    const celulas: CelulaCalculo[] = CELULAS.map((celula) =>
      celula.id === 1
        ? { ...celula, nome: `<script>alert("x")</script> & 'Ágape'` }
        : celula,
    );
    const dados = dadosDe("2026-11-30", {
      entrada: { ...entradaEsperada(), celulas },
    });
    const { html, texto } = montarRelatorioDiario(dados);
    expect(html).not.toContain("<script>");
    expect(html).toContain(
      "1. &lt;script&gt;alert(&quot;x&quot;)&lt;/script&gt; &amp; &#39;Ágape&#39;",
    );
    expect(texto).toContain(`1. <script>alert("x")</script> & 'Ágape': 39,1%`);
  });

  it("meta em R$ e fixa por célula: o dia, a semana e o alvo em reais; a nota cita o alvo por célula", () => {
    const campanha = {
      ...CAMPANHA,
      meta: { unidade: "centavos", regra: "fixa_por_celula", valor: 500_000 },
    } as const;
    const dados = dadosDe("2026-11-30", {
      entrada: { ...entradaEsperada(campanha) },
    });
    const { texto } = montarRelatorioDiario(dados);
    // R$ 2.684,00 de R$ 25.000,00 (5 células × R$ 5.000,00).
    expect(texto).toContain("10,7% do alvo da campanha (R$ 25.000,00)");
    expect(texto).toMatch(/^No dia: R\$ 340,00 \(meta R\$ [\d.]+,\d{2}\)$/m);
    expect(texto).toMatch(
      /^Semana 2 · 30\/11 a 06\/12: R\$ 340,00 de R\$ [\d.]+,\d{2} · \d+,\d%$/m,
    );
    expect(texto).toContain(
      "(% do alvo da célula (R$ 5.000,00 por célula) · bilhetes vendidos)",
    );
  });
});

describe("formatação em pt-BR", () => {
  it("inteiros e reais por texto, sem ponto flutuante", () => {
    expect(
      [0, 7, 999, 1000, 5280, 1234567].map((valor) => formatarInteiro(valor)),
    ).toEqual(["0", "7", "999", "1.000", "5.280", "1.234.567"]);
    expect(
      [0, 5, 99, 100, 114000, 123456789, -310].map((valor) =>
        formatarReais(valor),
      ),
    ).toEqual([
      "R$ 0,00",
      "R$ 0,05",
      "R$ 0,99",
      "R$ 1,00",
      "R$ 1.140,00",
      "R$ 1.234.567,89",
      "-R$ 3,10",
    ]);
    expect(() => formatarReais(1.5)).toThrow(RangeError);
  });

  it("percentuais com uma casa, truncados como no site (nunca '100%' antes da meta)", () => {
    expect(
      [0, 9, 93, 309, 809, 3916, 9999, 10_000, 12_000].map((bp) =>
        formatarPercentualBp(bp),
      ),
    ).toEqual([
      "0,0%",
      "0,0%",
      "0,9%",
      "3,0%",
      "8,0%",
      "39,1%",
      "99,9%",
      "100,0%",
      "120,0%",
    ]);
  });

  it("datas, dias da semana, hora no fuso e listas de nomes", () => {
    expect(
      [
        "2026-11-22",
        "2026-11-23",
        "2026-11-24",
        "2026-11-25",
        "2026-11-26",
        "2026-11-27",
        "2026-11-28",
      ].map(diaDaSemana),
    ).toEqual([
      "domingo",
      "segunda",
      "terça",
      "quarta",
      "quinta",
      "sexta",
      "sábado",
    ]);
    expect(intervaloDeDias("2026-11-23", "2026-11-29")).toBe("23 a 29/11");
    expect(intervaloDeDias("2026-11-30", "2026-12-06")).toBe("30/11 a 06/12");
    expect(horaNoFuso("2026-11-24T10:00:59.000Z", "America/Belem")).toBe(
      "07:00",
    );
    expect(horaNoFuso("2026-11-24T02:30:00.000Z", "America/Belem")).toBe(
      "23:30",
    );
    expect(juntarNomes([])).toBe("");
    expect(juntarNomes(["Ana"])).toBe("Ana");
    expect(juntarNomes(["Ana", "Bia"])).toBe("Ana e Bia");
    expect(juntarNomes(["Ana", "Bia", "Caio", "Davi"])).toBe(
      "Ana, Bia, Caio e Davi",
    );
    expect(escaparHtml(`<a href="x">'&'</a>`)).toBe(
      "&lt;a href=&quot;x&quot;&gt;&#39;&amp;&#39;&lt;/a&gt;",
    );
  });
});
