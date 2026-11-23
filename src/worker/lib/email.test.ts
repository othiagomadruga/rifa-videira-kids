// RIFA-086 (D40): o MIME montado à mão (multipart/alternative, UTF-8) e a leitura dos destinatários do segredo.
// Só endereços de exemplo (example.com, exemplo.com.br): nenhum e-mail real no repositório.
import { describe, expect, it } from "vitest";
import {
  LIMITE_DESTINATARIOS_RELATORIO_DIARIO,
  REMETENTE_RELATORIO_DIARIO,
} from "../../shared/contracts";
import {
  CRLF,
  codificarCabecalho,
  dataDoCabecalho,
  lerDestinatarios,
  montarMime,
  type MensagemEmail,
} from "./email";

const MENSAGEM: MensagemEmail = {
  remetente: REMETENTE_RELATORIO_DIARIO,
  para: "pastor@exemplo.com.br",
  assunto: "Projeto Videira Kids · resumo de terça, 24/11",
  texto: "PROJETO VIDEIRA KIDS\nCélulas: Ágape, Canaã e Éfeso · 1.140,00\n",
  html: `<!doctype html><html lang="pt-BR"><body><p>Células: Ágape · ${"x".repeat(300)}</p></body></html>`,
  data: new Date("2026-11-24T10:00:00.000Z"),
  id: "0f8fad5b-d9cb-469f-a165-70867728950e",
};

/** Decodifica um texto base64 (UTF-8). */
function decodificar(base64: string): string {
  const binario = atob(base64.replace(/\r\n/g, ""));
  return new TextDecoder().decode(
    Uint8Array.from(binario, (caractere) => caractere.charCodeAt(0)),
  );
}

/** Decodifica um cabeçalho com encoded-words do RFC 2047 (só a forma B, a que o montador usa). */
function decodificarCabecalho(valor: string): string {
  return valor
    .split(/\r\n /)
    .map((parte) => {
      const palavra = /^=\?UTF-8\?B\?([A-Za-z0-9+/=]+)\?=$/.exec(parte);
      return palavra ? decodificar(palavra[1]) : parte;
    })
    .join("");
}

/** Cabeçalhos (com as linhas dobradas juntadas por CRLF + espaço) e o corpo. */
function separar(mime: string) {
  const fim = mime.indexOf(`${CRLF}${CRLF}`);
  const cabecalhos = new Map<string, string>();
  let ultimo = "";
  for (const linha of mime.slice(0, fim).split(CRLF)) {
    if (linha.startsWith(" ")) {
      cabecalhos.set(ultimo, `${cabecalhos.get(ultimo)}${CRLF}${linha}`);
      continue;
    }
    const separador = linha.indexOf(": ");
    ultimo = linha.slice(0, separador);
    cabecalhos.set(ultimo, linha.slice(separador + 2));
  }
  return { cabecalhos, corpo: mime.slice(fim + 4) };
}

describe("montarMime", () => {
  const mime = montarMime(MENSAGEM);
  const { cabecalhos, corpo } = separar(mime);
  const fronteira = `=_rvk_${MENSAGEM.id}`;

  it("cabeçalhos: remetente com nome, um destinatário, assunto em UTF-8, data, Message-ID e multipart/alternative", () => {
    expect([...cabecalhos.keys()]).toEqual([
      "From",
      "To",
      "Subject",
      "Date",
      "Message-ID",
      "Auto-Submitted",
      "MIME-Version",
      "Content-Type",
    ]);
    expect(cabecalhos.get("From")).toBe(
      '"Projeto Videira Kids" <relatorio@projetokidsbelem.com.br>',
    );
    expect(cabecalhos.get("To")).toBe("<pastor@exemplo.com.br>");
    expect(cabecalhos.get("Subject")).toMatch(/^=\?UTF-8\?B\?/);
    expect(decodificarCabecalho(cabecalhos.get("Subject")!)).toBe(
      MENSAGEM.assunto,
    );
    expect(cabecalhos.get("Date")).toBe("Tue, 24 Nov 2026 10:00:00 +0000");
    expect(cabecalhos.get("Message-ID")).toBe(
      `<${MENSAGEM.id}@projetokidsbelem.com.br>`,
    );
    expect(cabecalhos.get("Auto-Submitted")).toBe("auto-generated");
    expect(cabecalhos.get("MIME-Version")).toBe("1.0");
    expect(cabecalhos.get("Content-Type")).toBe(
      `multipart/alternative;${CRLF} boundary="${fronteira}"`,
    );
  });

  it("duas partes, texto puro e depois HTML, ambas UTF-8 em base64, que voltam iguais ao original", () => {
    const partes = corpo.split(`--${fronteira}`);
    // Antes da 1ª fronteira, nada; depois da última ("--"), só o fim de linha.
    expect(partes[0]).toBe("");
    expect(partes.at(-1)).toBe(`--${CRLF}`);
    const [texto, html] = partes.slice(1, -1).map((parte) => {
      const { cabecalhos: daParte, corpo: conteudo } = separar(
        parte.replace(/^\r\n/, ""),
      );
      return { cabecalhos: Object.fromEntries(daParte), conteudo };
    });
    expect(texto.cabecalhos).toEqual({
      "Content-Type": "text/plain; charset=UTF-8",
      "Content-Transfer-Encoding": "base64",
    });
    expect(html.cabecalhos).toEqual({
      "Content-Type": "text/html; charset=UTF-8",
      "Content-Transfer-Encoding": "base64",
    });
    expect(decodificar(texto.conteudo.trimEnd())).toBe(MENSAGEM.texto);
    expect(decodificar(html.conteudo.trimEnd())).toBe(MENSAGEM.html);
  });

  it("só CRLF, nenhuma linha acima de 78 caracteres, nenhum byte fora do ASCII", () => {
    expect(mime.replace(/\r\n/g, "")).not.toMatch(/[\r\n]/);
    for (const linha of mime.split(CRLF))
      expect(linha.length).toBeLessThanOrEqual(78);
    expect(mime).toMatch(/^[\x20-\x7e\r\n]*$/);
    expect(mime.endsWith(`--${fronteira}--${CRLF}`)).toBe(true);
  });

  it("recusa destinatário que não é um endereço simples (nada de injetar cabeçalho)", () => {
    for (const para of [
      "pastor@exemplo.com.br\r\nBcc: outro@example.com",
      "Pastor <pastor@exemplo.com.br>",
      "pastor@exemplo",
      "",
    ])
      expect(() => montarMime({ ...MENSAGEM, para })).toThrow(RangeError);
    expect(() => montarMime({ ...MENSAGEM, id: "a b" })).toThrow(RangeError);
  });
});

describe("codificarCabecalho e dataDoCabecalho", () => {
  it("ASCII fica como está; com acento, encoded-words de até 75 caracteres, sem cortar caractere", () => {
    expect(codificarCabecalho("Resumo do dia")).toBe("Resumo do dia");
    const longo = `Projeto Videira Kids · resumo de sábado, 28/11 · ${"çãé😀".repeat(12)}`;
    const codificado = codificarCabecalho(longo);
    const palavras = codificado.split(`${CRLF} `);
    expect(palavras.length).toBeGreaterThan(2);
    for (const palavra of palavras) {
      expect(palavra).toMatch(/^=\?UTF-8\?B\?[A-Za-z0-9+/=]+\?=$/);
      expect(palavra.length).toBeLessThanOrEqual(68);
      // Cada palavra é UTF-8 válido sozinha (nenhum caractere cortado no meio).
      expect(decodificar(palavra.slice(10, -2))).not.toContain("�");
    }
    expect(decodificarCabecalho(codificado)).toBe(longo);
  });

  it("data no formato do RFC 5322, em UTC", () => {
    expect(dataDoCabecalho(new Date("2026-12-14T10:00:00.000Z"))).toBe(
      "Mon, 14 Dec 2026 10:00:00 +0000",
    );
  });
});

describe("lerDestinatarios (o segredo RELATORIO_EMAILS)", () => {
  it("separa por vírgula (ou ponto e vírgula), tira os espaços e os repetidos", () => {
    expect(
      lerDestinatarios(
        " pastor@exemplo.com.br, po@example.com ;PASTOR@exemplo.com.br,, ",
      ),
    ).toEqual({
      validos: ["pastor@exemplo.com.br", "po@example.com"],
      ignorados: 0,
    });
  });

  it("vazio ou ausente: nenhum destinatário", () => {
    for (const texto of [undefined, "", " , ;"])
      expect(lerDestinatarios(texto)).toEqual({ validos: [], ignorados: 0 });
  });

  it("ignora o que não é um endereço simples (nome, quebra de linha, sem domínio) e o que passa do limite", () => {
    expect(
      lerDestinatarios(
        [
          "Pastor <pastor@exemplo.com.br>",
          "po@example.com\r\nBcc: outro@example.com",
          "sem-arroba.example.com",
          "a@b",
          "certo@example.com",
        ].join(","),
      ),
    ).toEqual({ validos: ["certo@example.com"], ignorados: 4 });
    const muitos = Array.from(
      { length: LIMITE_DESTINATARIOS_RELATORIO_DIARIO + 2 },
      (_, indice) => `pessoa${indice}@example.com`,
    );
    const lidos = lerDestinatarios(muitos.join(","));
    expect(lidos.validos).toEqual(
      muitos.slice(0, LIMITE_DESTINATARIOS_RELATORIO_DIARIO),
    );
    expect(lidos.ignorados).toBe(2);
  });
});
