// RIFA-086 (D40): o handler `scheduled` (o cron das 7h) com o binding de e-mail SIMULADO: um e-mail por destinatário,
// com o dia de ontem; sem o binding ou sem destinatário, só um aviso; fora da campanha, nada. Nenhum envio real e só
// endereços de exemplo. Cenário do painel (test/painel-apoio.ts): campanha de 23/11 a 13/12/2026 em Belém.
import { env } from "cloudflare:workers";
import {
  afterAll,
  afterEach,
  beforeAll,
  describe,
  expect,
  it,
  vi,
} from "vitest";
import { CRON_RELATORIO_DIARIO } from "../shared/contracts";
import { scheduled, tratarAgendado } from "./agendado";
import worker from "./index";
import type { CriarMensagem } from "./lib/relatorio-diario-envio";
import { limparBanco, semearCenario } from "./test/painel-apoio";

const DESTINATARIOS = "pastor@exemplo.com.br, po@example.com";

/** O binding EMAIL falso e o que cada envio levou (o MIME vem da fábrica injetada). */
function emailFalso(falhar: (para: string) => boolean = () => false) {
  const enviados: { de: string; para: string; mime: string }[] = [];
  const criarMensagem: CriarMensagem = (de, para, mime) =>
    ({ from: de, to: para, mime }) as unknown as ReturnType<CriarMensagem>;
  const send = vi.fn(async (mensagem: unknown) => {
    const { from, to, mime } = mensagem as {
      from: string;
      to: string;
      mime: string;
    };
    if (falhar(to)) throw new Error(`recusado: ${to}`);
    enviados.push({ de: from, para: to, mime });
    return { messageId: `id-${enviados.length}` };
  });
  return {
    binding: { send } as unknown as SendEmail,
    send,
    enviados,
    criarMensagem,
  };
}

/** O disparo do cron às 10:00 UTC (07:00 em Belém) de `dia`. */
const disparo = (dia: string, cron = CRON_RELATORIO_DIARIO) => ({
  cron,
  scheduledTime: Date.parse(`${dia}T10:00:00.000Z`),
});

/** O assunto decodificado de um MIME (as encoded-words do montador). */
function assuntoDo(mime: string): string {
  const linhas = mime.split("\r\n");
  const inicio = linhas.findIndex((linha) => linha.startsWith("Subject: "));
  const palavras = [linhas[inicio].slice("Subject: ".length)];
  for (const linha of linhas.slice(inicio + 1)) {
    if (!linha.startsWith(" ")) break;
    palavras.push(linha.trim());
  }
  return palavras
    .map((palavra) => {
      const base64 = /^=\?UTF-8\?B\?(.+)\?=$/.exec(palavra)![1];
      return new TextDecoder().decode(
        Uint8Array.from(atob(base64), (caractere) => caractere.charCodeAt(0)),
      );
    })
    .join("");
}

beforeAll(async () => {
  await semearCenario();
});

afterAll(async () => {
  await limparBanco();
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("scheduled: o relatório diário das 7h", () => {
  it("o Worker exporta o handler `scheduled` junto com o app", () => {
    expect(worker.scheduled).toBe(scheduled);
    expect(typeof worker.fetch).toBe("function");
  });

  it("envia um e-mail por destinatário, do remetente do projeto, com o dia de ontem", async () => {
    const email = emailFalso();
    vi.spyOn(console, "log").mockImplementation(() => {});

    await tratarAgendado(
      disparo("2026-11-24"),
      { ...env, EMAIL: email.binding, RELATORIO_EMAILS: DESTINATARIOS },
      { criarMensagem: email.criarMensagem },
    );

    expect(email.send).toHaveBeenCalledTimes(2);
    expect(email.enviados.map(({ de, para }) => ({ de, para }))).toEqual([
      {
        de: "relatorio@projetokidsbelem.com.br",
        para: "pastor@exemplo.com.br",
      },
      { de: "relatorio@projetokidsbelem.com.br", para: "po@example.com" },
    ]);
    for (const { para, mime } of email.enviados) {
      // Cada e-mail só com o próprio destinatário.
      expect(mime).toContain(`\r\nTo: <${para}>\r\n`);
      expect(mime.match(/@exemplo\.com\.br|@example\.com/g)).toEqual([
        para.slice(para.indexOf("@")),
      ]);
      expect(assuntoDo(mime)).toBe(
        "Projeto Videira Kids · resumo de segunda, 23/11",
      );
      expect(mime).toContain("Content-Type: multipart/alternative;");
    }
    // Message-ID diferente em cada um.
    const ids = email.enviados.map(
      ({ mime }) => /\r\nMessage-ID: (<[^>]+>)\r\n/.exec(mime)![1],
    );
    expect(new Set(ids).size).toBe(2);
  });

  it("sem o binding EMAIL: só um aviso no log, sem quebrar e sem ler o banco", async () => {
    const aviso = vi.spyOn(console, "warn").mockImplementation(() => {});
    const prepare = vi.spyOn(env.DB, "prepare");

    await expect(
      tratarAgendado(disparo("2026-11-24"), {
        ...env,
        EMAIL: undefined,
        RELATORIO_EMAILS: DESTINATARIOS,
      }),
    ).resolves.toBeUndefined();

    expect(aviso).toHaveBeenCalledWith(
      "Relatório diário: binding EMAIL não configurado; nada enviado",
    );
    expect(prepare).not.toHaveBeenCalled();
  });

  it("sem destinatário válido no segredo: só um aviso, nenhum envio (e o endereço inválido não vai para o log)", async () => {
    const email = emailFalso();
    const aviso = vi.spyOn(console, "warn").mockImplementation(() => {});

    for (const RELATORIO_EMAILS of [undefined, "", "Pastor <nao-e-endereco>"])
      await tratarAgendado(
        disparo("2026-11-24"),
        { ...env, EMAIL: email.binding, RELATORIO_EMAILS },
        { criarMensagem: email.criarMensagem },
      );

    expect(email.send).not.toHaveBeenCalled();
    expect(JSON.stringify(aviso.mock.calls)).toContain(
      "sem destinatário válido",
    );
    expect(JSON.stringify(aviso.mock.calls)).not.toContain("nao-e-endereco");
  });

  it("fora da campanha não envia: no 1º dia (ontem é a véspera) e dois dias depois do fim; no dia seguinte ao último, envia o último", async () => {
    vi.spyOn(console, "log").mockImplementation(() => {});
    for (const [dia, envios] of [
      ["2026-11-23", 0],
      ["2026-12-15", 0],
      ["2026-12-14", 1],
    ] as const) {
      const email = emailFalso();
      await tratarAgendado(
        disparo(dia),
        { ...env, EMAIL: email.binding, RELATORIO_EMAILS: "po@example.com" },
        { criarMensagem: email.criarMensagem },
      );
      expect({ dia, envios: email.send.mock.calls.length }).toEqual({
        dia,
        envios,
      });
      if (envios > 0)
        expect(assuntoDo(email.enviados[0].mime)).toBe(
          "Projeto Videira Kids · resumo de domingo, 13/12",
        );
    }
  });

  it("a falha de um destinatário não impede os outros, e o log não cita o endereço", async () => {
    const email = emailFalso((para) => para.startsWith("pastor@"));
    const aviso = vi.spyOn(console, "warn").mockImplementation(() => {});
    const log = vi.spyOn(console, "log").mockImplementation(() => {});

    await tratarAgendado(
      disparo("2026-11-24"),
      { ...env, EMAIL: email.binding, RELATORIO_EMAILS: DESTINATARIOS },
      { criarMensagem: email.criarMensagem },
    );

    expect(email.enviados.map(({ para }) => para)).toEqual(["po@example.com"]);
    expect(aviso).toHaveBeenCalledWith("Relatório diário: falha no envio", {
      destinatario: 1,
      erro: "Error",
    });
    expect(log).toHaveBeenCalledWith("Relatório diário enviado", {
      situacao: "enviado",
      data: "2026-11-23",
      destinatarios: 2,
      enviados: 1,
      falhas: 1,
    });
    const registrado = JSON.stringify([...aviso.mock.calls, ...log.mock.calls]);
    expect(registrado).not.toMatch(/@exemplo\.com\.br|@example\.com/);
  });

  it("outro cron: nada é feito", async () => {
    const email = emailFalso();
    vi.spyOn(console, "warn").mockImplementation(() => {});

    await tratarAgendado(
      disparo("2026-11-24", "0 11 * * *"),
      { ...env, EMAIL: email.binding, RELATORIO_EMAILS: DESTINATARIOS },
      { criarMensagem: email.criarMensagem },
    );

    expect(email.send).not.toHaveBeenCalled();
  });
});
