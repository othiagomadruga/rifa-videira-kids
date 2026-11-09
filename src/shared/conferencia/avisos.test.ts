// Avisos da conferência (RIFA-012): as mensagens saem iguais no navegador e no Worker (sem Intl), na ordem
// do contrato, sem repetir código quando a tela junta os da leitura com os da API.
import { describe, expect, it } from "vitest";
import { CODIGOS_AVISO_RECONCILIACAO } from "../contracts/conferencia";
import {
  Avisos,
  formatarCentavos,
  formatarInteiro,
  juntarAvisos,
} from "./avisos";

describe("avisos", () => {
  it("números e centavos no formato brasileiro, sem Intl", () => {
    expect(formatarInteiro(0)).toBe("0");
    expect(formatarInteiro(1234567)).toBe("1.234.567");
    expect(formatarCentavos(2000)).toBe("R$ 20,00");
    expect(formatarCentavos(123456)).toBe("R$ 1.234,56");
    expect(formatarCentavos(5)).toBe("R$ 0,05");
  });

  it("toda mensagem existe e nenhuma fica vazia", () => {
    const avisos = new Avisos();
    for (const codigo of CODIGOS_AVISO_RECONCILIACAO)
      avisos.contar(codigo, 2, "pedido", {
        nomes: ["Coluna A"],
        preco: 2000,
        pagos: 7,
        encontrados: 0,
      });
    const lista = avisos.lista();
    expect(lista.map((aviso) => aviso.codigo)).toEqual([
      ...CODIGOS_AVISO_RECONCILIACAO,
    ]);
    for (const aviso of lista)
      expect(aviso.mensagem.length).toBeGreaterThan(20);
  });

  it("a trava do código e a regra do valor explicam com números e o preço da campanha", () => {
    const avisos = new Avisos();
    avisos.marcar("codigo_nao_confere", {
      nomes: ["Número"],
      pagos: 7,
      encontrados: 0,
    });
    avisos.contar("valor_ambiguo", 1, "pedido", { preco: 2000 });
    avisos.contar("valor_por_bilhete", 3, "pedido", { preco: 2000 });
    const [codigo, porBilhete, ambiguo] = avisos.lista();
    expect(codigo.mensagem).toBe(
      "A coluna escolhida como código do pedido (Número) não parece ser o código da Rifei: só 0 de 7 pedidos pagos do arquivo existem no sistema. Nada foi marcado para recuperar: troque a coluna do código do pedido e confira de novo. Se a coluna está certa e o webhook parou, exporte um período que inclua dias com vendas já no sistema.",
    );
    expect(porBilhete.mensagem).toContain("R$ 20,00");
    expect(porBilhete.mensagem).toContain("vezes o número de linhas");
    expect(ambiguo.mensagem).toContain("não pode ser recuperado");
  });

  it("juntarAvisos põe na ordem do contrato e não repete um código", () => {
    const daLeitura = new Avisos();
    daLeitura.marcar("colunas_pessoais_ignoradas", { nomes: ["Nome"] });
    daLeitura.contar("sem_id", 2);
    const daApi = new Avisos();
    daApi.marcar("sem_coluna_status");
    daApi.contar("sem_id", 5);
    const juntos = juntarAvisos(daLeitura.lista(), daApi.lista());
    expect(juntos.map((aviso) => [aviso.codigo, aviso.quantidade])).toEqual([
      ["sem_coluna_status", null],
      ["colunas_pessoais_ignoradas", null],
      ["sem_id", 2],
    ]);
  });
});
