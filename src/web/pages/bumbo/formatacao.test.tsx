// RIFA-051 (P3.9): a prévia do Bumbo como no WhatsApp. O analisador (texto → trechos de texto, negrito e itálico) e o
// desenho, que gera elementos do React com o mesmo texto (textContent igual ao da API, caractere por caractere).
import { render } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { analisarWhatsApp, TextoDoWhatsApp, type Trecho } from "./formatacao";
import { INSTANTES, respostaDoBumbo } from "./teste-apoio";

const texto = (valor: string): Trecho => ({ tipo: "texto", texto: valor });
const negrito = (...filhos: Trecho[]): Trecho => ({
  tipo: "negrito",
  marca: "*",
  filhos,
});
const italico = (...filhos: Trecho[]): Trecho => ({
  tipo: "italico",
  marca: "_",
  filhos,
});

/** Desenha a mensagem num <pre> (como a tela) e devolve o elemento. */
function desenhar(mensagem: string) {
  const { container } = render(
    <pre>
      <TextoDoWhatsApp texto={mensagem} />
    </pre>,
  );
  const pre = container.querySelector("pre");
  if (!pre) throw new Error("sem o <pre>");
  return pre;
}

describe("analisarWhatsApp: *negrito* e _itálico_", () => {
  it("negrito e itálico colados no texto, com pontuação em volta", () => {
    expect(
      analisarWhatsApp("*Ontem (dia 11):* a meta do dia já estava coberta."),
    ).toEqual([
      negrito(texto("Ontem (dia 11):")),
      texto(" a meta do dia já estava coberta."),
    ]);
    expect(analisarWhatsApp("_Jovens_")).toEqual([italico(texto("Jovens"))]);
    expect(analisarWhatsApp("_Célula/Ágape_: ação!")).toEqual([
      italico(texto("Célula/Ágape")),
      texto(": ação!"),
    ]);
  });

  it("asteriscos e sublinhados soltos ficam como vieram", () => {
    for (const solto of [
      "2 * 3 = 6",
      "a*b*c",
      "nome_da_celula",
      "**",
      "* com espaço depois*",
      "*com espaço antes *",
      "*sem fechar",
      "fecha sem abrir*",
      "_ _",
      "*",
      "",
    ])
      expect(analisarWhatsApp(solto), solto).toEqual(
        solto === "" ? [] : [texto(solto)],
      );
  });

  it("a marca não atravessa a quebra de linha", () => {
    expect(analisarWhatsApp("*começa aqui\ne termina aqui*")).toEqual([
      texto("*começa aqui\ne termina aqui*"),
    ]);
    expect(analisarWhatsApp("*Um*\n\n_dois_")).toEqual([
      negrito(texto("Um")),
      texto("\n\n"),
      italico(texto("dois")),
    ]);
  });

  it("itálico dentro do negrito (e o contrário), um nível de cada", () => {
    expect(analisarWhatsApp("*Ranking · _Jovens_*")).toEqual([
      negrito(texto("Ranking · "), italico(texto("Jovens"))),
    ]);
    expect(analisarWhatsApp("_a *b* c_")).toEqual([
      italico(texto("a "), negrito(texto("b")), texto(" c")),
    ]);
    // Dentro do negrito, outro * não abre de novo: o negrito fecha no primeiro * que pode fechar.
    expect(analisarWhatsApp("*a *b* c*")).toEqual([
      negrito(texto("a *b")),
      texto(" c*"),
    ]);
  });

  it("uma linha com vários trechos e um % no meio", () => {
    expect(
      analisarWhatsApp("*Acumulado:* 79% da meta. _Bora!_ 100% + 5%"),
    ).toEqual([
      negrito(texto("Acumulado:")),
      texto(" 79% da meta. "),
      italico(texto("Bora!")),
      texto(" 100% + 5%"),
    ]);
  });
});

describe("TextoDoWhatsApp: o desenho com o mesmo texto", () => {
  it.each(Object.entries(INSTANTES))(
    "a mensagem de %s: o textContent é o texto da API, com o negrito e o itálico desenhados",
    (_nome, instante) => {
      const { texto: mensagem } = respostaDoBumbo(instante);
      const pre = desenhar(mensagem);
      expect(pre.textContent).toBe(mensagem);
      expect(pre.querySelectorAll("strong").length).toBeGreaterThan(0);
      expect(pre.innerHTML).not.toMatch(/<script|<style|on\w+=/i);
    },
  );

  it("as marcas ficam no texto, escondidas do leitor de tela; o resto é texto do React (nada de HTML)", () => {
    const mensagem =
      "*Rifa <b>Videira</b> & Kids* _<img src=x onerror=alert(1)>_";
    const pre = desenhar(mensagem);
    expect(pre.textContent).toBe(mensagem);
    expect(pre.querySelector("b, img")).toBeNull();
    const negritos = pre.querySelectorAll("strong");
    const italicos = pre.querySelectorAll("em");
    expect(negritos).toHaveLength(1);
    expect(italicos).toHaveLength(1);
    const marcas = pre.querySelectorAll(".bumbo__marca");
    expect([...marcas].map((marca) => marca.textContent)).toEqual([
      "*",
      "*",
      "_",
      "_",
    ]);
    for (const marca of marcas)
      expect(marca).toHaveAttribute("aria-hidden", "true");
  });
});
