// Leitura do CSV da Rifei para a conferência (RIFA-012): detecção das colunas pelo nome (variações,
// acentos, inglês), colunas de dado pessoal, conferência do mapeamento, os valores de cada célula e o
// arquivo inteiro (separadores, BOM, limites e CSV malicioso). Os CSVs são fictícios.
import { describe, expect, it } from "vitest";
import {
  LIMITE_CARACTERES_CSV_RECONCILIACAO,
  LIMITE_COLUNAS_CSV_RECONCILIACAO,
  LIMITE_LINHAS_CSV_RECONCILIACAO,
  type CampoReconciliacao,
} from "../../shared/contracts";
import {
  CABECALHO_DO_CENARIO,
  MAPEAMENTO_DO_CENARIO,
  csvDoCenario,
  montarCsv,
  textosPessoaisEm,
} from "../test/conferencia-apoio";
import {
  INVALIDO,
  VAZIO,
  conferirMapeamento,
  detectarColunas,
  lerAfiliado,
  lerArquivoReconciliacao,
  lerCentavos,
  lerDataNoFuso,
  lerIdPedido,
  lerNumeros,
  lerQuantidade,
  lerStatus,
  mapeamentoVazio,
  pareceFormula,
} from "./conferencia-arquivo";

const FUSO = "America/Belem";

/** O campo (ou "pessoal") que a detecção dá para um nome de coluna sozinho no cabeçalho. */
function campoDe(nome: string): CampoReconciliacao | "pessoal" | null {
  const [coluna] = detectarColunas([nome]).colunas;
  return coluna.dado_pessoal ? "pessoal" : coluna.campo_detectado;
}

function falhaDe(texto: string) {
  const leitura = lerArquivoReconciliacao(texto, { fuso: FUSO });
  if (leitura.ok || leitura.tipo !== "arquivo")
    throw new Error("esperava falha do arquivo");
  return leitura.falha;
}

function lido(
  texto: string,
  mapeamento?: Parameters<typeof lerArquivoReconciliacao>[1]["mapeamento"],
) {
  const leitura = lerArquivoReconciliacao(texto, { fuso: FUSO, mapeamento });
  if (!leitura.ok)
    throw new Error(`esperava leitura: ${JSON.stringify(leitura)}`);
  return leitura;
}

describe("CA1: detecção das colunas pelo nome (variações, acentos e inglês)", () => {
  it.each<[string, CampoReconciliacao | "pessoal" | null]>([
    // Código do pedido
    ["Pedido", "pedido_id"],
    ["ID do Pedido", "pedido_id"],
    ["CÓDIGO DO PEDIDO", "pedido_id"],
    ["Nº do pedido", "pedido_id"],
    ["Número do Pedido", "pedido_id"],
    ["order_id", "pedido_id"],
    ["ID", "pedido_id"],
    ["Código", "pedido_id"],
    // Status
    ["Status", "status"],
    ["Situação", "status"],
    ["STATUS DO PAGAMENTO", "status"],
    ["Estado do pedido", "status"],
    // Quantidade e números dos bilhetes
    ["Quantidade de bilhetes", "qtd_bilhetes"],
    ["Qtd.", "qtd_bilhetes"],
    ["Qtde", "qtd_bilhetes"],
    ["Total de bilhetes", "qtd_bilhetes"],
    ["numbers_count", "qtd_bilhetes"],
    ["Bilhetes", "bilhetes"],
    ["Números", "bilhetes"],
    ["Cotas", "bilhetes"],
    ["Bilhetes premiados", null],
    ["lucky_numbers", null],
    // Valor
    ["Valor", "valor"],
    ["Valor total", "valor"],
    ["Total", "valor"],
    ["Valor pago", "valor"],
    ["R$", "valor"],
    ["amount", "valor"],
    ["Subtotal", "valor"],
    ["Desconto", null],
    ["Valor da taxa", null],
    // Afiliado
    ["Afiliado", "afiliado"],
    ["ID do afiliado", "afiliado"],
    ["Nome do afiliado", "afiliado"],
    ["Vendedor", "afiliado"],
    ["affiliate_id", "afiliado"],
    // Data
    ["Data", "data"],
    ["Data do pagamento", "data"],
    ["Data do pedido", "data"],
    ["Pago em", "data"],
    ["paid_at", "data"],
    ["created_at", "data"],
    ["Data de vencimento", null],
    // Dados pessoais do comprador: nunca lidos
    ["Nome", "pessoal"],
    ["Nome do comprador", "pessoal"],
    ["E-mail", "pessoal"],
    ["Email", "pessoal"],
    ["Telefone", "pessoal"],
    ["Celular / WhatsApp", "pessoal"],
    ["CPF", "pessoal"],
    ["Documento", "pessoal"],
    ["Data de nascimento", "pessoal"],
    ["Endereço", "pessoal"],
    ["CEP", "pessoal"],
    ["Cidade", "pessoal"],
    ["Estado", "pessoal"],
    ["Observação", "pessoal"],
    ["buyer_name", "pessoal"],
    // Contato do comprador ou do afiliado (revisão): nunca vira código nem afiliado
    ["Contato", "pessoal"],
    ["Whats", "pessoal"],
    ["Participante", "pessoal"],
    ["Pagador", "pessoal"],
    ["Contato do pedido", "pessoal"],
    ["Telefone do afiliado", "pessoal"],
    ["E-mail do vendedor", "pessoal"],
    ["Cliente indicado", "pessoal"],
    // O código do pedido só num nome que é só o código
    ["Número do pedido na Rifei", "pedido_id"],
    ["Order number", "pedido_id"],
    ["Responsável pelo pedido", null],
    ["Link do pedido", null],
    // Sem campo
    ["Forma de pagamento", null],
    ["Cupom", null],
    ["", null],
  ])("%j → %s", (nome, esperado) => {
    expect(campoDe(nome)).toBe(esperado);
  });

  it("“Número” sozinho é o número do endereço quando o arquivo tem endereço (dado pessoal)", () => {
    const comEndereco = detectarColunas([
      "Pedido",
      "Endereço",
      "Número",
      "Bairro",
    ]);
    expect(comEndereco.colunas[2]).toMatchObject({
      nome: "Número",
      dado_pessoal: true,
    });
    const semEndereco = detectarColunas(["Pedido", "Número"]);
    expect(semEndereco.colunas[1]).toMatchObject({
      dado_pessoal: false,
      campo_detectado: null,
    });
  });

  it("escolhe a coluna mais forte de cada campo: data do pagamento, id do afiliado, total sobre subtotal", () => {
    const { mapeamento, colunas } = detectarColunas([
      "Data do pedido",
      "Subtotal",
      "Afiliado",
      "Data do pagamento",
      "ID do afiliado",
      "Total",
      "Pedido",
    ]);
    expect(mapeamento).toEqual({
      pedido_id: 6,
      status: null,
      qtd_bilhetes: null,
      bilhetes: null,
      valor: 5,
      afiliado: 4,
      data: 3,
    });
    // As outras continuam com o campo indicado (a tela oferece as duas).
    expect(colunas.map((coluna) => coluna.campo_detectado)).toEqual([
      "data",
      "valor",
      "afiliado",
      "data",
      "afiliado",
      "valor",
      "pedido_id",
    ]);
  });

  it("o cabeçalho do cenário (com colunas pessoais e uma desconhecida) dá o mapeamento esperado", () => {
    const { mapeamento, colunas } = detectarColunas(CABECALHO_DO_CENARIO);
    expect(mapeamento).toEqual(MAPEAMENTO_DO_CENARIO);
    expect(
      colunas
        .filter((coluna) => coluna.dado_pessoal)
        .map((coluna) => coluna.nome),
    ).toEqual(["Nome", "E-mail", "Telefone", "CPF", "Observação interna"]);
  });

  it("nome vazio vira “Coluna N” e nome longo é resumido em 40 caracteres", () => {
    const { colunas } = detectarColunas(["", `Pedido ${"x".repeat(80)}`]);
    expect(colunas[0].nome).toBe("Coluna 1");
    expect(colunas[1].nome).toHaveLength(40);
  });
});

describe("CA1: mapeamento conferido pela coordenação", () => {
  const { colunas } = detectarColunas(CABECALHO_DO_CENARIO);

  it("aceita o detectado e qualquer troca entre colunas que não são pessoais", () => {
    expect(conferirMapeamento(MAPEAMENTO_DO_CENARIO, colunas)).toEqual([]);
    expect(
      conferirMapeamento(
        { ...mapeamentoVazio(), pedido_id: 0, data: 10 },
        colunas,
      ),
    ).toEqual([]);
  });

  it("recusa coluna inexistente, coluna pessoal e a mesma coluna em dois campos", () => {
    expect(
      conferirMapeamento(
        { ...MAPEAMENTO_DO_CENARIO, valor: 30, afiliado: 2, data: 0 },
        colunas,
      ),
    ).toEqual([
      {
        caminho: ["mapeamento", "valor"],
        codigo: "coluna_inexistente",
        mensagem: expect.any(String),
      },
      {
        caminho: ["mapeamento", "afiliado"],
        codigo: "coluna_pessoal",
        mensagem: 'A coluna "E-mail" tem dados pessoais e não pode ser usada',
      },
      {
        caminho: ["mapeamento", "data"],
        codigo: "coluna_repetida",
        mensagem: expect.any(String),
      },
    ]);
  });
});

describe("valores das células", () => {
  it.each<[string, number | typeof VAZIO | typeof INVALIDO]>([
    ["R$ 1.234,56", 123456],
    ["R$ 20,00", 2000],
    ["R$20", 2000],
    ["20,5", 2050],
    ["20.00", 2000],
    ["1,234.56", 123456],
    ["1.234", 123400],
    ["0,05", 5],
    [" 1.000.000,00 ", 100000000],
    ["", VAZIO],
    ["-", VAZIO],
    ["-20,00", INVALIDO],
    ["1,234", 123400],
    ["20,0055", INVALIDO],
    ["=1+1", INVALIDO],
    ["+20", INVALIDO],
    ["vinte reais", INVALIDO],
    ["R$ 10.000.000,01", INVALIDO],
  ])("valor %j → %s (centavos exatos, sem float)", (texto, esperado) => {
    expect(lerCentavos(texto)).toBe(esperado);
  });

  it.each<[string, number | typeof VAZIO | typeof INVALIDO]>([
    ["3", 3],
    [" 12 ", 12],
    ["12,0", 12],
    ["1.000", 1000],
    ["0", 0],
    ["", VAZIO],
    ["2,5", INVALIDO],
    ["três", INVALIDO],
    ["=2*2", INVALIDO],
    ["1000001", INVALIDO],
  ])("quantidade %j → %s", (texto, esperado) => {
    expect(lerQuantidade(texto)).toBe(esperado);
  });

  it("números dos bilhetes: dígitos com separadores; texto com letras é ilegível", () => {
    expect(lerNumeros("001, 002, 003")).toEqual([1, 2, 3]);
    expect(lerNumeros("[10; 20 | 30]")).toEqual([10, 20, 30]);
    expect(lerNumeros("")).toBe(VAZIO);
    expect(lerNumeros("bilhete 1")).toBe(INVALIDO);
    expect(lerNumeros("1".repeat(13))).toBe(INVALIDO);
    expect(lerNumeros("1, ".repeat(70_000))).toBe(INVALIDO);
  });

  it.each<[string, string]>([
    ["Pago", "aprovado"],
    ["PAGO", "aprovado"],
    ["approved", "aprovado"],
    ["Pagamento aprovado", "aprovado"],
    ["Confirmado", "aprovado"],
    ["Não pago", "pendente"],
    ["Pagamento pendente", "pendente"],
    ["Aguardando pagamento", "pendente"],
    ["in_process", "pendente"],
    ["Reservado", "pendente"],
    ["Expirado", "expirado"],
    ["expired", "expirado"],
    ["Cancelado", "cancelado"],
    ["Estornado", "cancelado"],
    ["Reembolsado", "cancelado"],
    ["Em disputa", "desconhecido"],
    ["=1+1", "desconhecido"],
    ["", VAZIO],
  ])("status %j → %s", (texto, esperado) => {
    expect(lerStatus(texto)).toBe(esperado);
  });

  it("data: formato brasileiro, ISO e ISO com fuso, no fuso da campanha; datas impossíveis são ilegíveis", () => {
    // Belém é UTC−3: 23/11/2026 22:30 local = 24/11 01:30Z, mas o dia é 23/11.
    expect(lerDataNoFuso("23/11/2026 22:30", FUSO)).toEqual({
      dia: "2026-11-23",
      instante: Date.parse("2026-11-24T01:30:00.000Z"),
    });
    expect(lerDataNoFuso("23/11/26 às 14h05", FUSO)).toEqual({
      dia: "2026-11-23",
      instante: Date.parse("2026-11-23T17:05:00.000Z"),
    });
    expect(lerDataNoFuso("23/11/2026", FUSO)).toEqual({
      dia: "2026-11-23",
      instante: null,
    });
    expect(lerDataNoFuso("2026-11-23 08:00:10", FUSO)).toEqual({
      dia: "2026-11-23",
      instante: Date.parse("2026-11-23T11:00:10.000Z"),
    });
    // Com fuso explícito: vale o instante, e o dia é o local da campanha.
    expect(lerDataNoFuso("2026-11-24T01:30:00.000Z", FUSO)).toEqual({
      dia: "2026-11-23",
      instante: Date.parse("2026-11-24T01:30:00.000Z"),
    });
    expect(lerDataNoFuso("2026-11-23T14:35:10-0300", FUSO)).toEqual({
      dia: "2026-11-23",
      instante: Date.parse("2026-11-23T17:35:10.000Z"),
    });
    for (const invalida of [
      "31/02/2026",
      "11/23/2026",
      "23/11/2026 25:00",
      "ontem",
      "46349",
      "=HOJE()",
    ])
      expect(lerDataNoFuso(invalida, FUSO)).toBe(INVALIDO);
    expect(lerDataNoFuso("", FUSO)).toBe(VAZIO);
  });

  it("afiliado: número, #número, usuário (para o rótulo), vazio e fórmula", () => {
    expect(lerAfiliado("1042")).toEqual({ tipo: "numero", id: 1042 });
    expect(lerAfiliado("#1042")).toEqual({ tipo: "numero", id: 1042 });
    expect(lerAfiliado("@Líder.Betel ")).toEqual({
      tipo: "texto",
      chave: "lider.betel",
    });
    for (const vazio of ["", "-", "0", "Nenhum", "Sem afiliado"])
      expect(lerAfiliado(vazio)).toEqual({ tipo: "vazio" });
    expect(lerAfiliado("=1+1")).toEqual({ tipo: "invalido" });
    expect(lerAfiliado("x".repeat(121))).toEqual({ tipo: "invalido" });
  });

  it("código do pedido: letras, números e . _ : / # -; nunca fórmula, e-mail, telefone com + ou espaço", () => {
    for (const valido of [
      "XXXXXXXXXXX",
      "PEDTESTE0001",
      "a1b2-c3d4",
      "2026/123",
      "ped#1",
    ])
      expect(lerIdPedido(valido)).toBe(valido);
    for (const invalido of [
      "=HYPERLINK(1)",
      "+5591988880001",
      "-123",
      "@x",
      "maria@example.com",
      "Maria Silva",
      "pedido_ç",
    ])
      expect(lerIdPedido(invalido)).toBe(INVALIDO);
    expect(lerIdPedido("  ")).toBe(VAZIO);
    expect(pareceFormula("=cmd|' /C calc'!A0")).toBe(true);
    expect(pareceFormula("-20")).toBe(false);
  });
});

describe("CA5: o arquivo inteiro em várias formas", () => {
  it("vírgula, ponto e vírgula, BOM e LF dão as mesmas linhas", () => {
    const formas = [
      csvDoCenario(),
      csvDoCenario(undefined, { separador: ";" }),
      csvDoCenario(undefined, { separador: ";", bom: true }),
      csvDoCenario(undefined, { fimDeLinha: "\n", bom: true }),
    ].map((texto) => lido(texto));
    for (const forma of formas.slice(1)) {
      expect(forma.mapeamento).toEqual(formas[0].mapeamento);
      expect(forma.linhas).toEqual(formas[0].linhas);
    }
    expect(formas[0].linhas).toHaveLength(17);
    expect(formas[0].colunas[0].nome).toBe("Pedido");
  });

  it("linhas em branco são ignoradas e colunas extras não atrapalham", () => {
    const texto =
      'Pedido,Status,Valor,Coluna nova da Rifei\r\n\r\nP1,Pago,"R$ 20,00",x\r\n,,,\r\nP2,Pago,10,y\r\n';
    const leitura = lido(texto);
    expect(
      leitura.linhas.map((linha) => [linha.linha, linha.id, linha.centavos]),
    ).toEqual([
      [3, "P1", 2000],
      [5, "P2", 1000],
    ]);
  });

  it("sem mapeamento usa o detectado; com mapeamento, lê só as colunas escolhidas", () => {
    const texto = csvDoCenario();
    expect(lido(texto).detectado).toBe(true);
    const soCodigo = lido(texto, { ...mapeamentoVazio(), pedido_id: 0 });
    expect(soCodigo.detectado).toBe(false);
    expect(soCodigo.linhas[0]).toEqual({
      linha: 2,
      id: "R-0001",
      status: null,
      qtd: null,
      numeros: null,
      centavos: null,
      afiliado: null,
      data: null,
    });
  });

  it("mapeamento com coluna pessoal é recusado antes de ler qualquer linha", () => {
    const leitura = lerArquivoReconciliacao(csvDoCenario(), {
      fuso: FUSO,
      mapeamento: { ...MAPEAMENTO_DO_CENARIO, afiliado: 1 },
    });
    expect(leitura).toEqual({
      ok: false,
      tipo: "mapeamento",
      problemas: [
        expect.objectContaining({
          codigo: "coluna_pessoal",
          caminho: ["mapeamento", "afiliado"],
        }),
      ],
    });
  });

  it("D1: nada pessoal sai da leitura (nem nas linhas, nem nas colunas, nem nos problemas)", () => {
    const leitura = lido(csvDoCenario());
    expect(textosPessoaisEm(JSON.stringify(leitura))).toEqual([]);
  });
});

describe("CA3: limites e CSV malicioso", () => {
  it("vazio, só linhas em branco ou primeira linha de dados: sem_cabecalho", () => {
    expect(falhaDe("\r\n ,, \r\n").detalhes).toEqual({
      motivo: "sem_cabecalho",
    });
    for (const comDados of [
      "R-1,Maria Ficticia,maria@example.com\r\n",
      "R-1;Pago;3;R$ 60,00\r\n",
      "Pedido,23/11/2026\r\n",
      "Pedido,+5591988880001\r\n",
    ])
      expect(falhaDe(comDados)).toEqual({
        ok: false,
        mensagem: expect.stringContaining("não parece um cabeçalho"),
        detalhes: { motivo: "sem_cabecalho" },
      });
  });

  it("aspas abertas: aspas_abertas com a linha, sem citar o conteúdo", () => {
    const falha = falhaDe(
      'Pedido,Nome\r\nP1,"Maria Ficticia Souza\r\nP2,Ana\r\n',
    );
    expect(falha.detalhes).toEqual({ motivo: "aspas_abertas", linha: 2 });
    expect(textosPessoaisEm(falha.mensagem)).toEqual([]);
  });

  it("fora de UTF-8: codificacao_invalida com a linha", () => {
    const falha = falhaDe(
      `Pedido,Status\r\nP1,Pago\r\nP2,N${String.fromCharCode(0xfffd)}o pago\r\n`,
    );
    expect(falha.detalhes).toEqual({
      motivo: "codificacao_invalida",
      linha: 3,
    });
  });

  it("mais linhas que o limite: linhas_demais; texto acima do limite: arquivo_grande", () => {
    const linhas = "P,Pago\n".repeat(LIMITE_LINHAS_CSV_RECONCILIACAO + 1);
    expect(falhaDe(`Pedido,Status\n${linhas}`).detalhes).toEqual({
      motivo: "linhas_demais",
      limite: LIMITE_LINHAS_CSV_RECONCILIACAO,
      total_linhas: LIMITE_LINHAS_CSV_RECONCILIACAO + 1,
    });
    expect(
      falhaDe("x".repeat(LIMITE_CARACTERES_CSV_RECONCILIACAO + 1)).detalhes,
    ).toEqual({
      motivo: "arquivo_grande",
      limite_caracteres: LIMITE_CARACTERES_CSV_RECONCILIACAO,
    });
  });

  it("colunas demais são ignoradas (com contagem); linha gigante numa coluna pessoal ou nos bilhetes não quebra", () => {
    const cabecalho = [
      "Pedido",
      "Nome",
      "Bilhetes",
      ...Array.from({ length: 250 }, (_, i) => `Extra ${i}`),
    ];
    const gigante = "Maria Ficticia Souza ".repeat(50_000);
    const texto = montarCsv([
      cabecalho,
      [
        "P1",
        gigante,
        "1, ".repeat(70_000),
        ...Array.from({ length: 250 }, () => ""),
      ],
      ["P2", "Ana", "7, 8", ...Array.from({ length: 300 }, () => "z")],
    ]);
    const leitura = lido(texto);
    expect(leitura.colunas).toHaveLength(LIMITE_COLUNAS_CSV_RECONCILIACAO);
    expect(leitura.colunasDemais).toBe(
      cabecalho.length - LIMITE_COLUNAS_CSV_RECONCILIACAO,
    );
    expect(leitura.linhas.map((linha) => linha.numeros)).toEqual([
      INVALIDO,
      [7, 8],
    ]);
    expect(leitura.problemas.numerosInvalidos).toBe(1);
    expect(textosPessoaisEm(JSON.stringify(leitura))).toEqual([]);
  });

  it("fórmulas (=, +, -, @) nas colunas mapeadas viram valor ilegível e são contadas", () => {
    const texto = montarCsv([
      ["Pedido", "Status", "Quantidade", "Valor", "Afiliado", "Data"],
      [
        "=cmd|' /C calc'!A0",
        "=1+1",
        "=2*2",
        "+20",
        '=HYPERLINK("x")',
        "-HOJE()",
      ],
      ["P2", "Pago", "1", "20,00", "101", "23/11/2026"],
    ]);
    const leitura = lido(texto);
    expect(leitura.linhas[0]).toMatchObject({
      id: INVALIDO,
      status: "desconhecido",
      qtd: INVALIDO,
      centavos: INVALIDO,
      afiliado: { tipo: "invalido" },
      data: INVALIDO,
    });
    expect(leitura.problemas).toMatchObject({
      idInvalido: 1,
      quantidadeInvalida: 1,
      valorInvalido: 1,
      dataInvalida: 1,
      formulas: 6,
    });
    expect(leitura.linhas[1]).toMatchObject({
      id: "P2",
      status: "aprovado",
      qtd: 1,
      centavos: 2000,
    });
  });
});
