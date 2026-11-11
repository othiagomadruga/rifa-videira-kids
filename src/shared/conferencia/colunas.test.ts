// Colunas do CSV da Rifei na conferência (RIFA-012), lidas no navegador: detecção pelo nome (variações,
// acentos, inglês), colunas de dado pessoal (também conferidas pelo Worker, pelo nome) e a conferência do
// mapeamento escolhido na tela. Os nomes de coluna são os de exports fictícios.
import { describe, expect, it } from "vitest";
import type { CampoReconciliacao } from "../contracts/conferencia";
import {
  conferirMapeamento,
  detectarColunas,
  ehNomeDeColunaPessoal,
  mapeamentoVazio,
  pareceDado,
} from "./colunas";
import { CABECALHO_DO_CENARIO, MAPEAMENTO_DO_CENARIO } from "./teste-csv";

/** O campo (ou "pessoal") que a detecção dá para um nome de coluna sozinho no cabeçalho. */
function campoDe(nome: string): CampoReconciliacao | "pessoal" | null {
  const [coluna] = detectarColunas([nome]).colunas;
  return coluna.dado_pessoal ? "pessoal" : coluna.campo_detectado;
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

describe("D1: o Worker confere o nome das colunas mapeadas", () => {
  it.each<[string, boolean]>([
    ["Nome", true],
    ["E-mail do comprador", true],
    ["Telefone do afiliado", true],
    ["Contato do pedido", true],
    ["CPF", true],
    ["Pedido", false],
    ["Afiliado", false],
    ["Nome do afiliado", false],
    ["Valor pago", false],
    ["Data do pagamento", false],
  ])("%j pessoal? %s", (nome, pessoal) => {
    expect(ehNomeDeColunaPessoal(nome)).toBe(pessoal);
  });

  it("primeira linha com cara de dado (e-mail, telefone, número, data, valor) não é cabeçalho", () => {
    for (const dado of [
      "maria@example.com",
      "+55 91 98888-0001",
      "1042",
      "23/11/2026",
      "2026-11-23",
      "R$ 20,00",
    ])
      expect(pareceDado(dado)).toBe(true);
    for (const nome of ["Pedido", "Data do pagamento", "Valor (R$)", ""])
      expect(pareceDado(nome)).toBe(false);
  });

  it("colunas além do limite ficam de fora, contadas", () => {
    const deteccao = detectarColunas(
      Array.from({ length: 205 }, (_, i) => `Extra ${i}`),
    );
    expect(deteccao.colunas).toHaveLength(200);
    expect(deteccao.colunasDemais).toBe(5);
  });
});
