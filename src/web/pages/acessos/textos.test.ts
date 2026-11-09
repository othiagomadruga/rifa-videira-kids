// CA4 (RIFA-014): a mensagem do link da hierarquia (cumprimenta, diz para que é o link e avisa que é
// pessoal), o telefone do líder no formato do wa.me e a situação do acesso de cada alvo.
import { describe, expect, it } from "vitest";
import { ErroApi } from "../../lib/api";
import { alvosExemplo, link } from "./teste-apoio";
import {
  avisoDeOutraPessoa,
  linkWhatsAppDoNumero,
  mensagemAoGerarLinks,
  mensagemHierarquia,
  motivoSemWhatsApp,
  precisaDeLink,
  situacaoDoAcesso,
  telefoneParaWhatsApp,
  textoDaSituacao,
  textoDosAparelhos,
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
    ["+55 (91) 3222-1111", "559132221111"],
    ["+5591988887777", "5591988887777"],
    // DDD 55 (RS) sem o código do país: 11 dígitos, ganha o 55.
    ["(55) 99999-8888", "5555999998888"],
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
    // Com "+", só o +55: outro código de país não monta o wa.me.
    "+1 (555) 123-4567",
    "+44 20 7946 0958",
    "+351 912 345 678",
    // +55 sem DDD.
    "+55 98888-7777",
    "1234567890123456",
    "44 1234 5678 9012",
  ])("%j não vira número do WhatsApp (só copiar)", (telefone) => {
    expect(telefoneParaWhatsApp(telefone)).toBeNull();
  });

  it("sem WhatsApp, a tela explica por quê e mostra o número para conferir", () => {
    expect(motivoSemWhatsApp(null)).toBe(
      "Sem telefone na hierarquia: copie a mensagem e mande por fora.",
    );
    expect(motivoSemWhatsApp("+1 (555) 123-4567")).toBe(
      "O telefone +1 (555) 123-4567 não é do Brasil (+55): confira o número, copie a mensagem e mande por fora.",
    );
    expect(motivoSemWhatsApp("98888-1234")).toBe(
      "O telefone 98888-1234 não está num formato que o WhatsApp abre: confira o número, copie a mensagem e mande por fora.",
    );
    // +55 sem DDD: é do Brasil, mas está fora do formato.
    expect(motivoSemWhatsApp("+55 98888-7777")).toMatch(
      /^O telefone \+55 98888-7777 não está num formato/,
    );
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

  it("o último link foi para outra pessoa: 'troque o acesso' com link válido; sem ele ou desativado, 'gere um link novo'", () => {
    // Éfeso: o último link foi para Lia, a hierarquia diz Rute, e o link é válido (a linha tem "Trocar acesso").
    expect(avisoDeOutraPessoa(efeso)).toBe(
      "O último link foi para Lia Fictícia: se a pessoa mudou, troque o acesso.",
    );
    const outraPessoa = (item: typeof canaa) => {
      if (!item.usuario) throw new Error("o exemplo tem usuário");
      return { ...item, usuario: { ...item.usuario, nome: "Antiga Fictícia" } };
    };
    // Canaã (só revogados ou vencidos) e Dorcas (desativada): sem "Trocar acesso" na linha.
    for (const item of [outraPessoa(canaa), outraPessoa(dorcas)]) {
      expect(avisoDeOutraPessoa(item)).toBe(
        "O último link foi para Antiga Fictícia: se a pessoa mudou, gere um link novo.",
      );
    }
    // O link é da pessoa da hierarquia, ou ainda não há usuário: nada a avisar.
    expect(avisoDeOutraPessoa(betel)).toBeNull();
    expect(avisoDeOutraPessoa(agape)).toBeNull();
    // Rede sem responsável: o nome do usuário é o do alvo (a API faz assim).
    expect(
      avisoDeOutraPessoa({
        ...agape,
        pessoa_nome: null,
        usuario: {
          id: 1,
          nome: agape.alvo.nome,
          ativo: true,
          sessoes_ativas: 0,
          links: [link(9)],
        },
      }),
    ).toBeNull();
  });

  it("os aparelhos conectados, no singular e no plural", () => {
    expect(textoDosAparelhos(0)).toBe("Nenhum aparelho conectado");
    expect(textoDosAparelhos(1)).toBe("1 aparelho conectado");
    expect(textoDosAparelhos(1200)).toBe("1.200 aparelhos conectados");
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
