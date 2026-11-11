// Desempenho da conferência pelo CSV (RIFA-012). A conferência exige o Workers Paid (D19): passa dos 10 ms de
// CPU por requisição do plano gratuito, e o Paid dá segundos. No workerd, com 1, 3 e 7 mil pedidos no banco e
// no arquivo, mede por rota o tempo total da requisição, o tempo esperando o D1 e a diferença (o trabalho do
// Worker: ler e conferir o corpo, juntar os pedidos, comparar e montar o JSON). O corpo é o que o navegador
// manda (corpoDe: a mesma leitura da tela). Os números saem no log; o limite do teste é folgado e não é o do
// plano: pega regressão grosseira, como a leitura do CSV no Worker, que gastava 300 ms com 7 mil pedidos.
import { env } from "cloudflare:workers";
import { beforeAll, describe, expect, it } from "vitest";
import {
  LIMITE_CORPO_CONFERENCIA_BYTES,
  respostaAnaliseReconciliacaoSchema,
  respostaRecuperarReconciliacaoSchema,
  type CorpoConferencia,
  type UsuarioSessao,
} from "../../shared/contracts";
import {
  criarAppDaConferencia,
  criarPessoaDaCoordenacao,
  corpoDe,
  montarCsv,
  semearConferencia,
} from "../test/conferencia-apoio";
import { bancoQueConta } from "../test/painel-apoio";

/**
 * Folgado de propósito: a máquina do CI varia; o medido sai no log (de 8 a 11 ms com 7 mil pedidos na integração
 * com a main). Não é o limite do plano (no Workers Paid são segundos): é a trava contra regressão grosseira, como
 * voltar a ler o CSV no Worker.
 */
const LIMITE_WORKER_MS = 30;
/** Pedidos do arquivo que não estão no banco (vendas perdidas). */
const PERDIDOS = 50;
const AFILIADOS = [101, 102, 103, 104, 105];

let pessoa: UsuarioSessao;
const app = criarAppDaConferencia(() => pessoa);

/** Grava `quantidade` pedidos aprovados na campanha ativa (P-000001...), espalhados em 7 dias. */
async function semearPedidos(quantidade: number) {
  await env.DB.prepare(
    `WITH RECURSIVE n(i) AS (SELECT 1 UNION ALL SELECT i + 1 FROM n WHERE i < ?1)
     INSERT INTO pedidos (id, campanha_id, affiliate_id, status, qtd_bilhetes, total_centavos, aprovado_em)
     SELECT printf('P-%06d', i), (SELECT id FROM campanhas WHERE ativa = 1), 101 + i % 5, 'approved',
       1 + i % 4, (1 + i % 4) * 2000,
       strftime('%Y-%m-%dT%H:%M:%fZ', '2026-11-24T12:00:00Z', '+' || (i % 7) || ' days',
         '+' || (i % 600) || ' minutes')
     FROM n`,
  )
    .bind(quantidade)
    .run();
}

/** O arquivo da Rifei com os mesmos pedidos (mais os perdidos), com nome, e-mail e telefone. */
function csvDe(quantidade: number, umBilhetePorLinha = false): string {
  const linhas: string[][] = [
    [
      "Pedido",
      "Nome",
      "E-mail",
      "Telefone",
      "Status",
      "Quantidade",
      "Valor",
      "Afiliado",
      "Data do pagamento",
    ],
  ];
  for (let i = 1; i <= quantidade + PERDIDOS; i++) {
    const qtd = 1 + (i % 4);
    const instante = new Date(
      Date.parse("2026-11-24T12:00:00Z") +
        (i % 7) * 86_400_000 +
        (i % 600) * 60_000,
    );
    // A hora de Belém (UTC−3), como a Rifei escreve.
    const local = new Date(instante.getTime() - 3 * 3_600_000);
    const data = `${String(local.getUTCDate()).padStart(2, "0")}/${String(local.getUTCMonth() + 1).padStart(2, "0")}/${local.getUTCFullYear()} ${String(local.getUTCHours()).padStart(2, "0")}:${String(local.getUTCMinutes()).padStart(2, "0")}`;
    const codigo =
      i <= quantidade ? `P-${String(i).padStart(6, "0")}` : `L-${i}`;
    const linha = (valor: string) => [
      codigo,
      `Pessoa Ficticia ${i}`,
      `pessoa${i}@example.com`,
      `+55919${String(i).padStart(8, "0")}`,
      "Pago",
      umBilhetePorLinha ? "1" : String(qtd),
      valor,
      String(AFILIADOS[i % 5]),
      data,
    ];
    if (umBilhetePorLinha)
      for (let bilhete = 0; bilhete < qtd; bilhete++)
        linhas.push(linha("R$ 20,00"));
    else linhas.push(linha(`R$ ${qtd * 20},00`));
  }
  return montarCsv(linhas);
}

const mediana = (valores: number[]) =>
  [...valores].sort((a, b) => a - b)[Math.floor(valores.length / 2)];
const ms = (valor: number) => valor.toFixed(1).padStart(5);

/** Mede uma rota: 1 rodada de aquecimento e 5 medidas; devolve a mediana do Worker (total − D1). */
async function medir(
  caminho: string,
  corpo: object,
  validar: (corpo: unknown) => void,
): Promise<{ total: number; banco: number; worker: number }> {
  const texto = JSON.stringify(corpo);
  // Como o navegador manda (o fetch com texto põe o Content-Length).
  const tamanho = String(new TextEncoder().encode(texto).length);
  const totais: number[] = [];
  const bancos: number[] = [];
  for (let rodada = 0; rodada < 6; rodada++) {
    const { db, contagem } = bancoQueConta();
    const inicio = performance.now();
    const res = await app.request(
      caminho,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Content-Length": tamanho,
        },
        body: texto,
      },
      { ...env, DB: db },
    );
    const resposta: unknown = await res.json();
    const total = performance.now() - inicio;
    expect({ caminho, status: res.status }).toEqual({ caminho, status: 200 });
    validar(resposta);
    if (rodada > 0) {
      totais.push(total);
      bancos.push(contagem.ms);
    }
  }
  return {
    total: mediana(totais),
    banco: mediana(bancos),
    worker: mediana(totais.map((total, indice) => total - bancos[indice])),
  };
}

const analise = (corpo: unknown) =>
  respostaAnaliseReconciliacaoSchema.parse(corpo);
const recuperacao = (corpo: unknown) =>
  respostaRecuperarReconciliacaoSchema.parse(corpo);

const perdidos = (quantidade: number) =>
  Array.from(
    { length: PERDIDOS },
    (_, indice) => `L-${quantidade + indice + 1}`,
  );

describe("desempenho da conferência no workerd (CPU do Worker por requisição)", () => {
  beforeAll(async () => {
    pessoa = await criarPessoaDaCoordenacao("Coordenadora Ficticia de Carga");
  });

  for (const quantidade of [1_000, 3_000, 7_000]) {
    it(`${quantidade.toLocaleString("pt-BR")} pedidos: /analisar e /recuperar abaixo do limite`, async () => {
      await semearConferencia([]);
      await semearPedidos(quantidade);
      const { corpo } = await corpoDe(csvDe(quantidade));
      const bytes = new TextEncoder().encode(JSON.stringify(corpo)).length;
      expect(bytes).toBeLessThan(LIMITE_CORPO_CONFERENCIA_BYTES);

      const analisar = await medir(
        "/api/admin/reconciliacao/analisar",
        corpo,
        (resposta) => {
          const lida = analise(resposta);
          expect(lida.modo === "por_pedido" && lida.resumo.conferem).toBe(
            quantidade,
          );
        },
      );
      const simular = await medir(
        "/api/admin/reconciliacao/recuperar",
        { ...corpo, pedidos: perdidos(quantidade), simular: true },
        (resposta) =>
          expect(recuperacao(resposta).recuperados).toHaveLength(PERDIDOS),
      );
      // A gravação mede uma vez só (depois dela, os pedidos já existem).
      const { db, contagem } = bancoQueConta();
      const inicio = performance.now();
      const gravacao = JSON.stringify({
        ...corpo,
        pedidos: perdidos(quantidade),
        simular: false,
      } satisfies CorpoConferencia & { pedidos: string[]; simular: boolean });
      const res = await app.request(
        "/api/admin/reconciliacao/recuperar",
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "Content-Length": String(new TextEncoder().encode(gravacao).length),
          },
          body: gravacao,
        },
        { ...env, DB: db },
      );
      const gravado = recuperacao(await res.json());
      const gravar = performance.now() - inicio - contagem.ms;
      expect(gravado.recuperados).toHaveLength(PERDIDOS);

      console.log(
        [
          `Conferência: ${quantidade.toLocaleString("pt-BR")} pedidos no banco, ${(quantidade + PERDIDOS).toLocaleString("pt-BR")} no arquivo (corpo de ${(bytes / 1024).toFixed(0)} KB)`,
          `  /analisar           total ${ms(analisar.total)} ms | D1 ${ms(analisar.banco)} ms | Worker ${ms(analisar.worker)} ms`,
          `  /recuperar simular  total ${ms(simular.total)} ms | D1 ${ms(simular.banco)} ms | Worker ${ms(simular.worker)} ms`,
          `  /recuperar gravar   Worker ${ms(gravar)} ms (uma vez)`,
        ].join("\n"),
      );
      expect(analisar.worker).toBeLessThan(LIMITE_WORKER_MS);
      expect(simular.worker).toBeLessThan(LIMITE_WORKER_MS);
      expect(gravar).toBeLessThan(LIMITE_WORKER_MS);
    });
  }

  it("um bilhete por linha (7 mil pedidos, 17.500 linhas): as linhas iguais viram uma posição e a CPU fica igual", async () => {
    const quantidade = 7_000;
    await semearConferencia([]);
    await semearPedidos(quantidade);
    const { corpo } = await corpoDe(csvDe(quantidade, true));
    expect(corpo.linhas).toBeGreaterThan(17_000);
    expect(corpo.vezes.length).toBe(quantidade + PERDIDOS);

    const analisar = await medir(
      "/api/admin/reconciliacao/analisar",
      corpo,
      (resposta) => {
        const lida = analise(resposta);
        expect(lida.modo === "por_pedido" && lida.resumo.conferem).toBe(
          quantidade,
        );
      },
    );
    console.log(
      `Conferência, um bilhete por linha: ${corpo.linhas.toLocaleString("pt-BR")} linhas, ${corpo.vezes.length.toLocaleString("pt-BR")} posições | /analisar Worker ${ms(analisar.worker)} ms (D1 ${ms(analisar.banco)} ms)`,
    );
    expect(analisar.worker).toBeLessThan(LIMITE_WORKER_MS);
  });
});
