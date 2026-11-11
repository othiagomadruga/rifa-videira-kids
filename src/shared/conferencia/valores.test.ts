// Valores das células do CSV da Rifei na conferência (RIFA-012), lidos no navegador: valor em centavos
// (sem float), quantidade, contagem dos números dos bilhetes, status, data no fuso da campanha (com o
// formatador guardado), afiliado e código do pedido. Os textos são de exports fictícios.
import { describe, expect, it } from "vitest";
import {
  INVALIDO,
  VAZIO,
  chaveDoAfiliado,
  contarNumeros,
  criarLeitorDeData,
  lerAfiliado,
  lerCentavos,
  lerIdPedido,
  lerQuantidade,
  lerStatus,
  pareceFormula,
} from "./valores";

const FUSO = "America/Belem";
const lerData = criarLeitorDeData(FUSO);

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

  it("números dos bilhetes: só a contagem (sem repetição) sai daqui; texto com letras é ilegível", () => {
    expect(contarNumeros("001, 002, 003")).toBe(3);
    expect(contarNumeros("[10; 20 | 30]")).toBe(3);
    expect(contarNumeros("7, 7, 8")).toBe(2);
    expect(contarNumeros("")).toBe(VAZIO);
    expect(contarNumeros("bilhete 1")).toBe(INVALIDO);
    expect(contarNumeros("1".repeat(13))).toBe(INVALIDO);
    expect(contarNumeros("1, ".repeat(70_000))).toBe(INVALIDO);
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
    expect(lerData("23/11/2026 22:30")).toEqual({
      dia: "2026-11-23",
      instante: Date.parse("2026-11-24T01:30:00.000Z"),
    });
    expect(lerData("23/11/26 às 14h05")).toEqual({
      dia: "2026-11-23",
      instante: Date.parse("2026-11-23T17:05:00.000Z"),
    });
    expect(lerData("23/11/2026")).toEqual({
      dia: "2026-11-23",
      instante: null,
    });
    expect(lerData("2026-11-23 08:00:10")).toEqual({
      dia: "2026-11-23",
      instante: Date.parse("2026-11-23T11:00:10.000Z"),
    });
    // Com fuso explícito: vale o instante, e o dia é o local da campanha.
    expect(lerData("2026-11-24T01:30:00.000Z")).toEqual({
      dia: "2026-11-23",
      instante: Date.parse("2026-11-24T01:30:00.000Z"),
    });
    expect(lerData("2026-11-23T14:35:10-0300")).toEqual({
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
      expect(lerData(invalida)).toBe(INVALIDO);
    expect(lerData("")).toBe(VAZIO);
  });

  it("afiliado, como vai no corpo: número, #número, usuário normalizado (para o rótulo), vazio e fórmula", () => {
    expect(lerAfiliado("1042")).toBe(1042);
    expect(lerAfiliado("#1042")).toBe(1042);
    expect(lerAfiliado("@Líder.Betel ")).toBe("lider.betel");
    expect(chaveDoAfiliado("  Líder   Betel ")).toBe("lider betel");
    for (const vazio of ["", "-", "0", "Nenhum", "Sem afiliado"])
      expect(lerAfiliado(vazio)).toBeNull();
    expect(lerAfiliado("=1+1")).toBe(false);
    expect(lerAfiliado("x".repeat(121))).toBe(false);
    expect(lerAfiliado("9".repeat(16))).toBe(false);
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

describe("datas: o leitor de cada fuso guarda o formatador e os textos lidos", () => {
  it("o mesmo texto dá o mesmo resultado (do guardado), e o dia de um instante sai sem criar formatador", () => {
    const leitor = criarLeitorDeData(FUSO);
    const primeira = leitor("27/11/2026 10:00");
    expect(leitor("27/11/2026 10:00")).toBe(primeira);
    expect(primeira).toEqual({
      dia: "2026-11-27",
      instante: Date.parse("2026-11-27T13:00:00.000Z"),
    });
    expect(leitor.diaDoInstante(Date.parse("2026-11-28T02:59:59.999Z"))).toBe(
      "2026-11-27",
    );
    expect(leitor.diaDoInstante(Date.parse("2026-11-28T03:00:00.000Z"))).toBe(
      "2026-11-28",
    );
  });

  it("fuso com horário de verão: a hora local vira o instante certo dos dois lados da troca", () => {
    const novaYork = criarLeitorDeData("America/New_York");
    // 2026-11-01 é o fim do horário de verão nos EUA (às 2h volta para 1h): antes, UTC−4; depois, UTC−5.
    expect(novaYork("31/10/2026 12:00")).toEqual({
      dia: "2026-10-31",
      instante: Date.parse("2026-10-31T16:00:00.000Z"),
    });
    expect(novaYork("02/11/2026 12:00")).toEqual({
      dia: "2026-11-02",
      instante: Date.parse("2026-11-02T17:00:00.000Z"),
    });
  });

  it("7 mil datas em poucos milissegundos (sem um Intl.DateTimeFormat por célula)", () => {
    const leitor = criarLeitorDeData(FUSO);
    const textos = Array.from(
      { length: 7_000 },
      (_, i) =>
        `${String(1 + (i % 28)).padStart(2, "0")}/11/2026 ${String(i % 24).padStart(2, "0")}:${String(i % 60).padStart(2, "0")}`,
    );
    const inicio = performance.now();
    for (const texto of textos) leitor(texto);
    expect(performance.now() - inicio).toBeLessThan(500);
  });
});
