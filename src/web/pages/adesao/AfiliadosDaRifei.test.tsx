// RIFA-070 (D28): o cartão "Afiliados na Rifei" da Adesão (só o admin), com a API falsa: nada é lido sozinho; ler
// mostra o vínculo e a sugestão pelo e-mail; sincronizar avisa a Adesão para atualizar; os convites das células sem
// afiliado saem com o WhatsApp do líder; sem a configuração, a tela manda usar o painel da Rifei. Dados fictícios.
import { fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  ROTAS_RIFEI_API,
  respostaAfiliadosRifeiSchema,
  respostaConvitesRifeiSchema,
} from "../../../shared/contracts/api";
import { respostaJson } from "../../test/renderizar";
import {
  CAMINHO_AFILIADOS_RIFEI,
  CAMINHO_CONVITES_RIFEI,
  CAMINHO_SINCRONIZAR_RIFEI,
  mensagemDoConvite,
  telefoneParaWhatsApp,
} from "./afiliados-rifei-api";
import { AfiliadosDaRifei } from "./AfiliadosDaRifei";

const AFILIADOS = respostaAfiliadosRifeiSchema.parse({
  afiliados: [
    {
      affiliate_id: 101,
      codigo: "lider1",
      nome: "Líder Ficticio Um",
      email: "lider1@exemplo.com",
      celula: {
        celula_id: 1,
        celula_nome: "Célula Ágape",
        lider_nome: "Líder Ficticio Um",
      },
      sugestao: null,
    },
    {
      affiliate_id: 3003,
      codigo: "lider3",
      nome: "Líder Ficticio Tres",
      email: "lider3@exemplo.com",
      celula: null,
      sugestao: {
        celula_id: 3,
        celula_nome: "Célula Canaã",
        lider_nome: "Líder Ficticio Tres",
      },
    },
  ],
  celulas_sem_afiliado: [
    {
      celula_id: 3,
      celula_nome: "Célula Canaã",
      lider_nome: "Líder Ficticio Tres",
      tem_email: true,
    },
    {
      celula_id: 4,
      celula_nome: "Célula Dorcas",
      lider_nome: "Líder Ficticio Quatro",
      tem_email: false,
    },
  ],
  sincronizacao: null,
});

const CONVITES = respostaConvitesRifeiSchema.parse({
  convites: [
    {
      celula_id: 3,
      celula_nome: "Célula Canaã",
      lider_nome: "Líder Ficticio Tres",
      lider_telefone: "(91) 98888-0003",
      link: "https://rifei.com.br/u/conta/afiliados/registrar?convite=c1",
    },
  ],
  falhas: [{ celula_id: 4, mensagem: "Limite de convites atingido" }],
});

function apiFalsa(resposta: (caminho: string, metodo: string) => Response) {
  const chamadas: { metodo: string; caminho: string; corpo?: string }[] = [];
  const fetch = vi.fn(
    async (entrada: RequestInfo | URL, init?: RequestInit) => {
      const caminho = new URL(String(entrada), "http://localhost").pathname;
      const metodo = init?.method ?? "GET";
      chamadas.push({
        metodo,
        caminho,
        corpo: init?.body as string | undefined,
      });
      return resposta(caminho, metodo);
    },
  );
  vi.stubGlobal("fetch", fetch);
  return chamadas;
}

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("RIFA-070: Afiliados na Rifei (Adesão)", () => {
  it("os caminhos são as cópias do contrato", () => {
    expect(CAMINHO_AFILIADOS_RIFEI).toBe(
      ROTAS_RIFEI_API.afiliadosRifei.caminho,
    );
    expect(CAMINHO_SINCRONIZAR_RIFEI).toBe(
      ROTAS_RIFEI_API.sincronizarAfiliadosRifei.caminho,
    );
    expect(CAMINHO_CONVITES_RIFEI).toBe(ROTAS_RIFEI_API.convitesRifei.caminho);
  });

  it("nada é lido sozinho; ler mostra o vínculo e a sugestão pelo e-mail", async () => {
    const chamadas = apiFalsa(() => respostaJson(AFILIADOS));
    render(<AfiliadosDaRifei aoMudar={() => {}} />);
    expect(chamadas).toEqual([]);
    fireEvent.click(
      screen.getByRole("button", { name: "Ler os afiliados da Rifei" }),
    );
    const tabela = await screen.findByRole("table");
    expect(within(tabela).getByText("Célula Ágape")).toBeInTheDocument();
    expect(within(tabela).getByText("Pelo e-mail")).toBeInTheDocument();
    expect(
      screen.getByText(/1 afiliado tem o e-mail de um líder/),
    ).toBeInTheDocument();
    expect(chamadas).toEqual([
      { metodo: "GET", caminho: CAMINHO_AFILIADOS_RIFEI, corpo: undefined },
    ]);
  });

  it("sincronizar avisa a Adesão para atualizar e mostra o que mudou", async () => {
    apiFalsa(() =>
      respostaJson({
        ...AFILIADOS,
        sincronizacao: { vinculados: 1, codigos_gravados: 2 },
      }),
    );
    const aoMudar = vi.fn();
    render(<AfiliadosDaRifei aoMudar={aoMudar} />);
    fireEvent.click(
      screen.getByRole("button", { name: "Sincronizar com a Rifei" }),
    );
    expect(
      await screen.findByText(
        /1 afiliado ligado à célula pelo e-mail do líder e 2 códigos gravados/,
      ),
    ).toBeInTheDocument();
    expect(aoMudar).toHaveBeenCalledTimes(1);
  });

  it("os convites das células sem afiliado, com o WhatsApp do líder e as falhas", async () => {
    const chamadas = apiFalsa((caminho) =>
      caminho === CAMINHO_CONVITES_RIFEI
        ? respostaJson(CONVITES, 201)
        : respostaJson(AFILIADOS),
    );
    render(<AfiliadosDaRifei aoMudar={() => {}} />);
    fireEvent.click(
      screen.getByRole("button", { name: "Ler os afiliados da Rifei" }),
    );
    fireEvent.click(
      await screen.findByRole("button", {
        name: "Gerar os 2 convites das células sem afiliado",
      }),
    );
    const whatsapp = await screen.findByRole("link", {
      name: "Enviar no WhatsApp",
    });
    expect(whatsapp.getAttribute("href")).toMatch(
      /^https:\/\/wa\.me\/5591988880003\?text=/,
    );
    expect(decodeURIComponent(whatsapp.getAttribute("href") ?? "")).toContain(
      "https://rifei.com.br/u/conta/afiliados/registrar?convite=c1",
    );
    expect(
      screen.getByText(/1 convite não foi gerado: Limite de convites atingido/),
    ).toBeInTheDocument();
    expect(chamadas.at(-1)).toEqual({
      metodo: "POST",
      caminho: CAMINHO_CONVITES_RIFEI,
      corpo: JSON.stringify({ celulas: [3, 4] }),
    });
  });

  it("sem a configuração no servidor (503): manda usar o painel da Rifei", async () => {
    apiFalsa(() =>
      respostaJson(
        { erro: { codigo: "nao_configurado", mensagem: "Falta o segredo" } },
        503,
      ),
    );
    render(<AfiliadosDaRifei aoMudar={() => {}} />);
    fireEvent.click(
      screen.getByRole("button", { name: "Ler os afiliados da Rifei" }),
    );
    expect(
      await screen.findByText(/ainda não está ligada no servidor/),
    ).toBeInTheDocument();
  });

  it("o telefone no formato do wa.me e a mensagem do convite", () => {
    expect(telefoneParaWhatsApp("(91) 98888-0003")).toBe("5591988880003");
    expect(telefoneParaWhatsApp("+55 91 98888-0003")).toBe("5591988880003");
    expect(telefoneParaWhatsApp("123")).toBeNull();
    expect(telefoneParaWhatsApp(null)).toBeNull();
    expect(
      mensagemDoConvite(
        "Maria da Silva",
        "Célula Betel",
        "https://rifei.com.br/x",
      ),
    ).toMatch(/^Olá, Maria! .*Célula Betel.*https:\/\/rifei\.com\.br\/x$/);
  });
});
