// Sprint 6 (D20), CA4: a tela Acessos segue as regras da campanha, pela rota de verdade e com a API falsa
// (teste-apoio.ts, que lê as regras de GET /api/admin/campanha e recusa com 409 `acao_desligada` o link de um papel
// desligado):
// - com o acesso de discipuladores (ou de redes) desligado, gerar e trocar o link desse papel fica indisponível, e o
//   aviso diz que foi desligado na Campanha; o 409 (desligaram com a tela aberta) é explicado;
// - as mensagens saem do modelo da campanha (RIFA-032), e um modelo gravado com problema dá lugar ao padrão.
import {
  act,
  fireEvent,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  MENSAGENS_PADRAO,
  preencherMensagem,
} from "../../../shared/contracts/regras";
import { ADMIN_DE_TESTE, renderizarRota } from "../../test/renderizar";
import { ID_AVISO_DESLIGADO } from "./AcessosHierarquia";
import { criarApiFalsa, type ApiFalsa } from "./teste-apoio";
import { mensagemHierarquia } from "./textos";

const ROTA_LINKS = "/api/admin/acessos-hierarquia/links";

function acionar(elemento: HTMLElement) {
  act(() => elemento.focus());
  fireEvent.click(elemento);
}

/** Abre /coordenacao/acessos como admin e espera a lista da coordenação (e as regras da campanha). */
async function abrirTela(api: ApiFalsa) {
  vi.stubGlobal("fetch", api.fetch);
  renderizarRota("/coordenacao/acessos", { usuario: ADMIN_DE_TESTE });
  await screen.findByRole("heading", { level: 2, name: "Admin de Teste" });
  await waitFor(() =>
    expect(api.chamadasA("GET", "/api/admin/campanha")).toHaveLength(1),
  );
}

/** Troca para a aba da hierarquia (abre nos líderes). */
async function abrirAba() {
  acionar(screen.getByRole("tab", { name: "Líderes, discipuladores e redes" }));
  await screen.findByRole("table", { name: "Acessos: Líderes de célula" });
}

/** Escolhe o papel e espera a lista dele. */
async function trocarPapel(rotulo: string) {
  fireEvent.change(screen.getByRole("combobox", { name: "Papel" }), {
    target: {
      value:
        { Discipuladores: "discipulador", Redes: "rede" }[rotulo] ?? "lider",
    },
  });
  return screen.findByRole("table", { name: `Acessos: ${rotulo}` });
}

/** Abre a aba e escolhe o papel. */
async function abrirPapel(rotulo: string) {
  await abrirAba();
  return trocarPapel(rotulo);
}

const anuncio = () =>
  screen
    .getAllByRole("status")
    .filter((elemento) => elemento.classList.contains("visualmente-oculto"))
    .map((elemento) => elemento.textContent)
    .join(" | ");

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("CA4: o acesso de um papel desligado na Campanha", () => {
  it("discipuladores desligados: aviso com o caminho da Campanha, e gerar e trocar o link ficam indisponíveis", async () => {
    const api = criarApiFalsa();
    api.regras.campanha = {
      acesso: { discipuladores: false, redes: true, celulas_senha: true },
      mensagens: { ...MENSAGENS_PADRAO },
    };
    await abrirTela(api);

    await abrirPapel("Discipuladores");

    const aviso = document.getElementById(ID_AVISO_DESLIGADO);
    expect(aviso).toHaveTextContent(
      "O acesso dos discipuladores está desligado na Campanha.",
    );
    expect(aviso).toHaveTextContent(
      "Por enquanto, os discipuladores não entram no sistema e não dá para gerar nem mandar links para eles. Nada foi revogado: quando o acesso dos discipuladores for religado na tela Campanha, os links já mandados voltam a valer.",
    );
    expect(
      within(aviso as HTMLElement).getByRole("link", { name: "tela Campanha" }),
    ).toHaveAttribute("href", "/coordenacao/campanha");

    const lote = screen.getByRole("button", {
      name: /^Gerar links para quem ainda não tem/,
    });
    const novoLink = screen.getByRole("button", {
      name: "Novo link para Davi Fictício",
    });
    const trocar = screen.getByRole("button", {
      name: "Trocar acesso de Elias Fictício",
    });
    for (const botao of [lote, novoLink, trocar]) {
      expect(botao).toHaveAttribute("aria-disabled", "true");
      expect(botao).toHaveAccessibleDescription(
        /O acesso dos discipuladores está desligado na Campanha\./,
      );
      acionar(botao);
    }
    // Nada vai para a API, nem a confirmação da troca abre; desativar e revogar continuam.
    expect(screen.queryByRole("alertdialog")).not.toBeInTheDocument();
    expect(api.chamadasA("POST", ROTA_LINKS)).toEqual([]);
    expect(
      screen.getByRole("button", { name: /^Revogar link de Elias Fictício/ }),
    ).not.toHaveAttribute("aria-disabled");
    expect(
      screen.getByRole("button", {
        name: "Desativar acesso de Elias Fictício",
      }),
    ).not.toHaveAttribute("aria-disabled");

    // Os líderes não têm chave: continuam com tudo.
    await trocarPapel("Líderes de célula");
    expect(document.getElementById(ID_AVISO_DESLIGADO)).toBeNull();
    expect(
      screen.getByRole("button", { name: "Novo link para Célula Ágape" }),
    ).not.toHaveAttribute("aria-disabled");
  });

  it("409 acao_desligada (desligaram as redes com a tela aberta): explica e deixa a geração indisponível", async () => {
    const api = criarApiFalsa();
    api.regras.campanha = {
      acesso: { discipuladores: true, redes: true, celulas_senha: true },
      mensagens: { ...MENSAGENS_PADRAO },
    };
    await abrirTela(api);
    await abrirPapel("Redes");
    expect(document.getElementById(ID_AVISO_DESLIGADO)).toBeNull();
    api.regras.campanha.acesso.redes = false;

    acionar(
      screen.getByRole("button", {
        name: /^Gerar links para quem ainda não tem/,
      }),
    );

    await waitFor(() =>
      expect(anuncio()).toContain(
        "Não foi possível gerar os links: O acesso das redes foi desligado na Campanha: não dá para gerar links agora.",
      ),
    );
    expect(api.chamadasA("POST", ROTA_LINKS)).toHaveLength(1);
    expect(document.getElementById(ID_AVISO_DESLIGADO)).toHaveTextContent(
      "O acesso das redes está desligado na Campanha.",
    );
    expect(
      screen.getByRole("button", {
        name: /^Gerar links para quem ainda não tem/,
      }),
    ).toHaveAttribute("aria-disabled", "true");
  });
});

describe("CA4: as mensagens saem do modelo da campanha", () => {
  it("líder: o modelo da campanha, preenchido (copiar e WhatsApp); o modelo com problema dá lugar ao padrão", async () => {
    const modeloLider = "{saudacao} A {alvo} já pode acompanhar a rifa: {link}";
    const api = criarApiFalsa();
    api.regras.campanha = {
      acesso: { discipuladores: true, redes: true, celulas_senha: true },
      mensagens: {
        ...MENSAGENS_PADRAO,
        link_lider: modeloLider,
        // Gravado sem o {link} (fora das regras): a tela usa o padrão, para nunca mandar mensagem sem o link.
        link_rede: "Oi, rede!",
      },
    };
    await abrirTela(api);
    await abrirPapel("Líderes de célula");

    acionar(
      screen.getByRole("button", { name: "Novo link para Célula Ágape" }),
    );

    const dialogo = await screen.findByRole("dialog", {
      name: "Link de acesso: Célula Ágape",
    });
    const [url] = api.urlsEmitidas;
    const esperada = preencherMensagem(modeloLider, {
      pessoaNome: "Maria Fictícia",
      alvoNome: "Célula Ágape",
      url,
    });
    expect(esperada).toBe(
      `Olá, Maria! A Célula Ágape já pode acompanhar a rifa: ${url}`,
    );
    expect(
      within(dialogo).getByRole("textbox", {
        name: "Mensagem para Maria Fictícia",
      }),
    ).toHaveValue(esperada);
    expect(
      within(dialogo).getByRole("link", {
        name: "Abrir no WhatsApp de Maria Fictícia",
      }),
    ).toHaveAttribute(
      "href",
      `https://wa.me/5591988887777?text=${encodeURIComponent(esperada)}`,
    );
    fireEvent.click(within(dialogo).getByRole("button", { name: "Pronto" }));
    fireEvent.click(
      await screen.findByRole("button", { name: "Fechar mesmo assim" }),
    );
    await waitFor(() =>
      expect(screen.queryByRole("dialog")).not.toBeInTheDocument(),
    );

    await abrirPapel("Redes");
    acionar(
      screen.getByRole("button", {
        name: "Novo link para Rede Jovem Fictícia",
      }),
    );
    const daRede = await screen.findByRole("dialog", {
      name: "Link de acesso: Rede Jovem Fictícia",
    });
    expect(
      within(daRede).getByRole("textbox", {
        name: "Mensagem para Pastor Fictício",
      }),
    ).toHaveValue(
      mensagemHierarquia({
        alvo: { tipo: "rede", nome: "Rede Jovem Fictícia" },
        pessoaNome: "Pastor Fictício",
        url: api.urlsEmitidas[1],
      }),
    );
  });

  it("coordenação: o 'Enviar pelo WhatsApp' leva o modelo da coordenação, preenchido", async () => {
    const modelo =
      "{saudacao} Seu acesso à coordenação da rifa ({nome}):\n{link}";
    const api = criarApiFalsa();
    api.regras.campanha = {
      acesso: { discipuladores: true, redes: true, celulas_senha: true },
      mensagens: { ...MENSAGENS_PADRAO, link_coordenacao: modelo },
    };
    await abrirTela(api);

    acionar(
      screen.getByRole("button", {
        name: "Gerar link novo para Felipe Coordenador",
      }),
    );

    const dialogo = await screen.findByRole("dialog", {
      name: "Link de acesso de Felipe Coordenador",
    });
    const url = api.urlsEmitidas.at(-1) ?? "";
    expect(
      within(dialogo).getByRole("link", { name: "Enviar pelo WhatsApp" }),
    ).toHaveAttribute(
      "href",
      `https://wa.me/?text=${encodeURIComponent(`Olá, Felipe! Seu acesso à coordenação da rifa (Felipe):\n${url}`)}`,
    );
  });
});
