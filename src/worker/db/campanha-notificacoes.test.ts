// RIFA-095 (D43): a opção "Enviar notificações de venda" da campanha (`notificacoes.vendas`, coluna da 0022). O PUT
// sem o grupo mantém o gravado (no primeiro, o padrão: ligada), com o grupo grava; a resposta traz sempre a opção; a
// trilha diz o antes e o depois.
import { env } from "cloudflare:workers";
import { beforeEach, describe, expect, it } from "vitest";
import { campanhaEntradaSchema } from "../../shared/contracts";
import { DADOS_CAMPANHA, limparBanco } from "../test/painel-apoio";
import {
  buscarCampanhaAtiva,
  montarCampanha,
  resumirMudancaDaCampanha,
  salvarCampanhaAtiva,
  type DadosCampanha,
} from "./campanha";

const db = env.DB;

async function salvar(dados: DadosCampanha) {
  const resultado = await salvarCampanhaAtiva(db, dados);
  if (!resultado.ok) throw new Error(resultado.mensagem);
  return resultado.campanha;
}

const comOpcao = (vendas: boolean): DadosCampanha =>
  campanhaEntradaSchema.parse({ ...DADOS_CAMPANHA, notificacoes: { vendas } });

beforeEach(async () => {
  await limparBanco(db);
});

describe("notificacoes.vendas na campanha", () => {
  it("nasce ligada sem o grupo; com o grupo grava; ausente mantém o gravado", async () => {
    expect((await salvar(DADOS_CAMPANHA)).notificacoes).toEqual({
      vendas: true,
    });
    expect((await salvar(comOpcao(false))).notificacoes).toEqual({
      vendas: false,
    });
    // Uma aba antiga do site (sem o grupo) não religa.
    expect((await salvar(DADOS_CAMPANHA)).notificacoes).toEqual({
      vendas: false,
    });
    const gravada = await buscarCampanhaAtiva(db);
    expect(gravada?.notificacoes_vendas).toBe(0);
    expect(montarCampanha(gravada!).notificacoes).toEqual({ vendas: false });
    expect((await salvar(comOpcao(true))).notificacoes).toEqual({
      vendas: true,
    });
  });

  it("o primeiro PUT já desligado grava desligado", async () => {
    expect((await salvar(comOpcao(false))).notificacoes).toEqual({
      vendas: false,
    });
  });

  it("a linha lida sem a coluna (antes da 0022) fica com o padrão", async () => {
    await salvar(DADOS_CAMPANHA);
    const gravada = await buscarCampanhaAtiva(db);
    const semColuna = { ...gravada! } as Partial<typeof gravada>;
    delete semColuna!.notificacoes_vendas;
    expect(
      montarCampanha(semColuna as NonNullable<typeof gravada>).notificacoes,
    ).toEqual({ vendas: true });
  });

  it("a trilha: o antes e o depois quando muda; nada quando o grupo vem igual ou ausente; na criação, só desligada", async () => {
    await salvar(DADOS_CAMPANHA);
    const antes = (await buscarCampanhaAtiva(db))!;
    expect(resumirMudancaDaCampanha(antes, comOpcao(false))).toBe(
      "Alterado: notificacoes.vendas: ligado → desligado",
    );
    expect(resumirMudancaDaCampanha(antes, comOpcao(true))).toBe(
      "Configuração salva sem mudanças",
    );
    expect(resumirMudancaDaCampanha(antes, DADOS_CAMPANHA)).toBe(
      "Configuração salva sem mudanças",
    );
    expect(resumirMudancaDaCampanha(null, comOpcao(false))).toMatch(
      /, notificacoes\.vendas: desligado$/,
    );
    expect(resumirMudancaDaCampanha(null, comOpcao(true))).not.toContain(
      "notificacoes",
    );
  });
});
