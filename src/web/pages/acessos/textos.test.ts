// CA4 (RIFA-014): a mensagem do link da hierarquia (cumprimenta, diz para que é o link e avisa que é
// pessoal), o telefone do líder no formato do wa.me e a situação do acesso de cada alvo.
import { describe, expect, it } from "vitest";
import { ErroApi } from "../../lib/api";
import { alvosExemplo, link } from "./teste-apoio";
import {
  linkWhatsAppDoNumero,
  mensagemAoGerarLinks,
  mensagemHierarquia,
  precisaDeLink,
  situacaoDoAcesso,
  telefoneParaWhatsApp,
  textoDaSituacao,
} from "./textos";

const URL_FICTICIA =
  "https://rifa.example/acesso/TokenFicticioDeTeste_0123456789-abcdefghijk";

describe("mensagemHierarquia", () => {
  it("líder: cumprimenta pelo primeiro nome, diz que é para acompanhar a célula na rifa e que é pessoal", () => {
    expect(
      mensagemHierarquia({
        alvo: { tipo: "celula", nome: "Célula Ágape" },
        pessoaNome: "  Maria Aparecida Fictícia ",
        url: URL_FICTICIA,
      }),
    ).toBe(
      `Olá, Maria! Este é o seu link pessoal para acompanhar a sua célula (Célula Ágape) na campanha da rifa do Videira Kids: as vendas, a meta e a posição no ranking.\nO link é só seu: não repasse para ninguém, porque quem tiver o link entra como você.\n${URL_FICTICIA}`,
    );
  });

  it("discipulador e rede: o alvo certo; sem nome na hierarquia, só 'Olá!'", () => {
    const discipulador = mensagemHierarquia({
      alvo: { tipo: "discipulador", nome: "Davi Fictício" },
      pessoaNome: "Davi Fictício",
      url: URL_FICTICIA,
    });
    expect(discipulador).toMatch(
      /^Olá, Davi! Este é o seu link pessoal para acompanhar as suas células \(discipulador Davi Fictício\) na campanha da rifa do Videira Kids/,
    );
    const rede = mensagemHierarquia({
      alvo: { tipo: "rede", nome: "Rede Adulta Fictícia" },
      pessoaNome: null,
      url: URL_FICTICIA,
    });
    expect(rede).toMatch(
      /^Olá! Este é o seu link pessoal para acompanhar a sua rede \(Rede Adulta Fictícia\) na campanha da rifa do Videira Kids/,
    );
    for (const mensagem of [discipulador, rede]) {
      expect(mensagem).toContain("não repasse para ninguém");
      expect(mensagem.endsWith(`\n${URL_FICTICIA}`)).toBe(true);
      expect(mensagem).not.toMatch(/R\$/);
    }
  });
});

describe("telefoneParaWhatsApp e o wa.me", () => {
  it.each([
    ["(91) 98888-7777", "5591988887777"],
    ["91988887777", "5591988887777"],
    ["91 3222-1111", "559132221111"],
    ["091 98888-7777", "5591988887777"],
    ["55 (91) 9 8888-7777", "5591988887777"],
    ["+55 91 99999-0000", "5591999990000"],
    // DDD 55 (RS) sem o código do país: 11 dígitos, ganha o 55.
    ["(55) 99999-8888", "5555999998888"],
    ["+1 (555) 123-4567", "15551234567"],
  ])("%s → %s", (telefone, numero) => {
    expect(telefoneParaWhatsApp(telefone)).toBe(numero);
  });

  it.each([
    null,
    "98888-1234",
    "3222-1111",
    "sem telefone",
    "",
    "+55",
    "1234567890123456",
    "44 1234 5678 9012",
  ])("%j não vira número do WhatsApp (só copiar)", (telefone) => {
    expect(telefoneParaWhatsApp(telefone)).toBeNull();
  });

  it("o link abre a conversa do número com a mensagem codificada", () => {
    expect(linkWhatsAppDoNumero("5591988887777", "Olá! & até\nlogo")).toBe(
      "https://wa.me/5591988887777?text=Ol%C3%A1!%20%26%20at%C3%A9%0Alogo",
    );
  });
});

describe("situação do acesso de cada alvo", () => {
  const [agape, betel, canaa, dorcas, efeso] = alvosExemplo().lider;

  it("sem link, link válido (com o último uso), só revogados ou vencidos e desativado", () => {
    expect(situacaoDoAcesso(agape.usuario)).toEqual({ tipo: "sem_link" });
    expect(situacaoDoAcesso(betel.usuario)).toEqual({
      tipo: "valido",
      ultimoUso: "2026-11-11T12:00:00.000Z",
    });
    expect(situacaoDoAcesso(canaa.usuario)).toEqual({
      tipo: "sem_link_valido",
    });
    expect(situacaoDoAcesso(dorcas.usuario)).toEqual({ tipo: "desativado" });
    expect(textoDaSituacao(situacaoDoAcesso(betel.usuario))).toEqual({
      tom: "sucesso",
      rotulo: "Link válido",
      detalhe: "Último uso em 11/11/2026 09:00.",
    });
    expect(textoDaSituacao({ tipo: "valido", ultimoUso: null }).detalhe).toBe(
      "Ainda não usado.",
    );
  });

  it("com vários links válidos, o último uso é o mais recente", () => {
    const usuario = betel.usuario;
    if (!usuario) throw new Error("Betel tem usuário");
    expect(
      situacaoDoAcesso({
        ...usuario,
        links: [
          link(1, { ultimo_uso_em: "2026-11-12T10:00:00.000Z" }),
          link(2, { ultimo_uso_em: null }),
          link(3, { ultimo_uso_em: "2026-11-13T09:00:00.000Z" }),
          link(4, {
            ultimo_uso_em: "2026-11-20T09:00:00.000Z",
            situacao: "revogado",
          }),
        ],
      }),
    ).toEqual({ tipo: "valido", ultimoUso: "2026-11-13T09:00:00.000Z" });
  });

  it("o lote vai para quem não tem link válido, menos os desativados", () => {
    expect([agape, betel, canaa, dorcas, efeso].map(precisaDeLink)).toEqual([
      true,
      false,
      true,
      false,
      false,
    ]);
  });

  it("os 404 e 409 do lote em português", () => {
    expect(
      mensagemAoGerarLinks(
        new ErroApi({ codigo: "em_uso", mensagem: "x", status: 409 }),
      ),
    ).toMatch(/^Algum alvo tem o acesso desativado/);
    expect(
      mensagemAoGerarLinks(
        new ErroApi({ codigo: "nao_encontrado", mensagem: "x", status: 404 }),
      ),
    ).toMatch(/^A hierarquia mudou/);
  });
});
