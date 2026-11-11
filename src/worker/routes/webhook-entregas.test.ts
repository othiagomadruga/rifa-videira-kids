// CA2 (RIFA-025, D16): GET /api/admin/webhook/entregas no app real, com entregas gravadas pelo PRÓPRIO webhook
// (POST /api/webhooks/rifei): ordem (id decrescente), cursor, filtros (resultado e pedido_id), o erro e os avisos
// reduzidos a campo, código e ocorrências, e nenhuma mensagem nem dado pessoal na resposta, mesmo com e-mail e
// telefone nos campos inválidos de um payload recusado e de um aceito com avisos. Toda resposta 200 passa pelo
// schema ESTRITO do contrato.
import { env, exports } from "cloudflare:workers";
import { beforeAll, describe, expect, it, onTestFinished } from "vitest";
import newOrderAfiliado from "../../../test/fixtures/rifei/new_order.afiliado.json";
import paidOrderAfiliado from "../../../test/fixtures/rifei/paid_order.afiliado.json";
import paidOrderOutraCampanha from "../../../test/fixtures/rifei/paid_order.outra_campanha.json";
import {
  LIMITE_CORPO_WEBHOOK_BYTES,
  ROTAS,
  respostaEntregasWebhookSchema,
  type EntregaWebhook,
  type RespostaEntregasWebhook,
} from "../../shared/contracts";
import { ORIGEM, cabecalhosDeSessao } from "../test/acesso-teste";

const db = env.DB;
const SLUG = newOrderAfiliado.slug;
/** Dados pessoais fictícios postos nos campos inválidos: nenhum pedaço deles pode sair. */
const EMAIL = "fulano.secreto@example.com";
const TELEFONE = "+55 (91) 98765-4321";
const TELEFONE_E164 = "+5591987654321";
const PESSOAIS = [
  "fulano",
  "secreto",
  "example.com",
  "98765",
  "4321",
  "Comprador Ficticio",
  "00000000000",
];

let coordenacao: Record<string, string>;
/** id de cada entrega gravada, pelo nome do caso. */
const evento: Record<string, number> = {};

async function enviar(corpo: string): Promise<number> {
  const res = await exports.default.fetch(`${ORIGEM}/api/webhooks/rifei`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${env.RIFEI_WEBHOOK_TOKEN}`,
    },
    body: corpo,
  });
  const resposta = (await res.json()) as {
    evento_id?: number;
    erro?: { detalhes: { evento_id: number } };
  };
  const id = resposta.evento_id ?? resposta.erro?.detalhes.evento_id;
  if (id === undefined) throw new Error(`entrega sem evento_id: ${res.status}`);
  return id;
}

async function chamar(consulta = "") {
  return exports.default.fetch(
    `${ORIGEM}${ROTAS.entregasWebhook.caminho}${consulta}`,
    { headers: coordenacao },
  );
}

async function listar(
  consulta = "",
): Promise<{ texto: string; corpo: RespostaEntregasWebhook }> {
  const res = await chamar(consulta);
  expect(res.status).toBe(200);
  const texto = await res.text();
  return {
    texto,
    corpo: respostaEntregasWebhookSchema.parse(JSON.parse(texto)),
  };
}

const ids = (corpo: RespostaEntregasWebhook) =>
  corpo.itens.map((item) => item.id);

beforeAll(async () => {
  coordenacao = await cabecalhosDeSessao("coordenacao");
  await db.batch(
    [
      "pedidos_suspeitos",
      "webhook_eventos",
      "pedidos",
      "afiliados",
      "campanhas",
    ].map((tabela) => db.prepare(`DELETE FROM ${tabela}`)),
  );
  await db
    .prepare(
      `INSERT INTO campanhas (nome, slug_rifei, ativa, data_inicio, preco_bilhete_centavos, meta_unidade,
         meta_regra, meta_valor, ranking_criterio)
       VALUES ('Campanha das entregas', ?1, 1, '2026-11-23', 2000, 'bilhetes', 'por_pessoa', 10, 'percentual_meta')`,
    )
    .bind(SLUG)
    .run();
  // Na ordem: cada uma ganha um id maior que a anterior.
  evento.novo = await enviar(JSON.stringify(newOrderAfiliado));
  evento.pago = await enviar(JSON.stringify(paidOrderAfiliado));
  evento.duplicado = await enviar(JSON.stringify(paidOrderAfiliado));
  evento.outraCampanha = await enviar(JSON.stringify(paidOrderOutraCampanha));
  evento.jsonInvalido = await enviar(`{"email": "${EMAIL}", `);
  // Recusado: e-mail e telefone em campos essenciais inválidos.
  evento.recusado = await enviar(
    JSON.stringify({
      ...newOrderAfiliado,
      id: "PEDTESTE0002",
      numbers_count: EMAIL,
      total: TELEFONE,
    }),
  );
  // Aceito com avisos: e-mail e telefone em campos tolerados (viram null, com aviso).
  evento.comAvisos = await enviar(
    JSON.stringify({
      ...newOrderAfiliado,
      id: "PEDTESTE0003",
      subtotal: EMAIL,
      payment_method: 98765,
      numbers: [101, TELEFONE_E164, 303, EMAIL],
      buyer: { ...newOrderAfiliado.buyer, email: 98_765_4321 },
    }),
  );
  evento.grande = await enviar(
    `{"email": "${EMAIL}", "x": "${"a".repeat(LIMITE_CORPO_WEBHOOK_BYTES)}"}`,
  );
});

describe("ordem e campos", () => {
  it("da mais nova para a mais antiga (id decrescente), com resultado, evento, pedido, slug como veio e transição", async () => {
    const { corpo } = await listar();
    expect(ids(corpo)).toEqual([
      evento.grande,
      evento.comAvisos,
      evento.recusado,
      evento.jsonInvalido,
      evento.outraCampanha,
      evento.duplicado,
      evento.pago,
      evento.novo,
    ]);
    expect(corpo.proximo).toBeNull();
    const porId = new Map(corpo.itens.map((item) => [item.id, item]));
    const resumo = (id: number) => {
      const item = porId.get(id)!;
      return [
        item.resultado,
        item.evento,
        item.pedido_id,
        item.slug,
        item.status_anterior,
        item.status_resultante,
      ];
    };
    expect(resumo(evento.novo)).toEqual([
      "processado",
      "new_order",
      "PEDTESTE0001",
      SLUG,
      null,
      "in_process",
    ]);
    expect(resumo(evento.pago)).toEqual([
      "processado",
      "paid_order",
      "PEDTESTE0001",
      SLUG,
      "in_process",
      "approved",
    ]);
    expect(resumo(evento.duplicado)).toEqual([
      "duplicado",
      "paid_order",
      "PEDTESTE0001",
      SLUG,
      "approved",
      "approved",
    ]);
    // Slug errado: aparece como veio, ignorado (D5).
    expect(resumo(evento.outraCampanha)).toEqual([
      "ignorado_outra_campanha",
      "paid_order",
      "PEDOUTRA0001",
      "outra-campanha-da-conta",
      null,
      null,
    ]);
    // Corpo nem lido como JSON: evento, pedido e slug nulos.
    expect(resumo(evento.jsonInvalido)).toEqual([
      "erro_validacao",
      null,
      null,
      null,
      null,
      null,
    ]);
    for (const item of corpo.itens)
      expect(item.recebido_em).toMatch(
        /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/,
      );
  });

  it("erro só em erro_validacao: o código da recusa e os problemas reduzidos; avisos vazios onde não há", async () => {
    const { corpo } = await listar();
    const porId = new Map(corpo.itens.map((item) => [item.id, item]));
    expect(porId.get(evento.jsonInvalido)?.erro).toEqual({
      codigo: "json_invalido",
      problemas: [{ campo: "", codigo: "json_invalido", ocorrencias: 1 }],
    });
    expect(porId.get(evento.grande)?.erro).toEqual({
      codigo: "corpo_muito_grande",
      problemas: [{ campo: "", codigo: "corpo_muito_grande", ocorrencias: 1 }],
    });
    const recusado = porId.get(evento.recusado)!;
    expect(recusado.erro?.codigo).toBe("payload_invalido");
    expect(
      recusado.erro?.problemas.map((problema) => problema.campo).sort(),
    ).toEqual(["numbers_count", "total"]);
    for (const problema of recusado.erro!.problemas)
      expect(problema).toEqual({
        campo: expect.any(String),
        codigo: expect.stringMatching(/^[a-z_]+$/),
        ocorrencias: 1,
      });
    expect(recusado.pedido_id).toBe("PEDTESTE0002");
    for (const id of [
      evento.novo,
      evento.pago,
      evento.duplicado,
      evento.outraCampanha,
    ])
      expect(porId.get(id)?.erro).toBeNull();
    for (const id of [evento.jsonInvalido, evento.recusado, evento.grande])
      expect(porId.get(id)?.avisos).toEqual([]);
  });

  it("avisos reduzidos: campo com '.' e '*' nas posições de lista, código e ocorrências somadas", async () => {
    const { corpo } = await listar();
    const avisos = corpo.itens.find(
      (item) => item.id === evento.comAvisos,
    )!.avisos;
    const porCampo = Object.fromEntries(
      avisos.map((aviso) => [
        `${aviso.campo}|${aviso.codigo}`,
        aviso.ocorrencias,
      ]),
    );
    // Dois itens de numbers inválidos (posições 1 e 3) viram UM aviso com 2 ocorrências.
    expect(porCampo).toMatchObject({
      "numbers.*|invalid_type": 2,
      "buyer.email|invalid_type": 1,
      "payment_method|invalid_type": 1,
    });
    expect(
      Object.keys(porCampo).some((chave) => chave.startsWith("subtotal|")),
    ).toBe(true);
    expect(
      corpo.itens.find((item) => item.id === evento.comAvisos)?.resultado,
    ).toBe("processado");
  });

  it("nenhuma mensagem nem dado pessoal: nem o e-mail e o telefone dos campos inválidos, nem o payload", async () => {
    const { texto } = await listar();
    for (const pessoal of PESSOAIS) expect(texto).not.toContain(pessoal);
    for (const campo of [
      "mensagem",
      "payload_redigido",
      "comprador",
      'buyer"',
      "Invalid input",
      "expected",
    ])
      expect(texto).not.toContain(campo);
    // O banco guardou as mensagens (é de lá que a redução tira os códigos).
    const gravado = await db
      .prepare("SELECT erro FROM webhook_eventos WHERE id = ?1")
      .bind(evento.recusado)
      .first<{ erro: string }>();
    expect(gravado?.erro).toContain("mensagem");
  });
});

describe("cursor e filtros", () => {
  it("cursor: com limite 3, percorre tudo sem repetir nem pular", async () => {
    const vistos: number[] = [];
    let antesDe: number | null = null;
    let paginas = 0;
    do {
      const sufixo: string = antesDe === null ? "" : `&antes_de=${antesDe}`;
      const { corpo } = await listar(`?limite=3${sufixo}`);
      vistos.push(...ids(corpo));
      antesDe = corpo.proximo;
      paginas += 1;
    } while (antesDe !== null && paginas < 10);
    expect(paginas).toBe(3);
    expect(vistos).toEqual(ids((await listar()).corpo));
  });

  it("o proximo é o id do último item; com limite exato, a última página diz null", async () => {
    const primeira = (await listar("?limite=4")).corpo;
    expect(primeira.proximo).toBe(primeira.itens.at(-1)?.id);
    const segunda = (await listar(`?limite=4&antes_de=${primeira.proximo}`))
      .corpo;
    expect(segunda.itens).toHaveLength(4);
    expect(segunda.proximo).toBeNull();
  });

  it("resultado: só as daquele resultado, com o cursor", async () => {
    const erros = (await listar("?resultado=erro_validacao")).corpo;
    expect(ids(erros)).toEqual([
      evento.grande,
      evento.recusado,
      evento.jsonInvalido,
    ]);
    const pagina = (
      await listar(
        `?resultado=erro_validacao&limite=1&antes_de=${evento.recusado}`,
      )
    ).corpo;
    expect(ids(pagina)).toEqual([evento.jsonInvalido]);
    expect(pagina.proximo).toBeNull();
    expect(ids((await listar("?resultado=ignorado_transicao")).corpo)).toEqual(
      [],
    );
  });

  it("pedido_id: as entregas daquele pedido (com os espaços das pontas tirados), também com resultado", async () => {
    expect(ids((await listar("?pedido_id=%20PEDTESTE0001%20")).corpo)).toEqual([
      evento.duplicado,
      evento.pago,
      evento.novo,
    ]);
    expect(
      ids((await listar("?pedido_id=PEDTESTE0001&resultado=processado")).corpo),
    ).toEqual([evento.pago, evento.novo]);
    expect(ids((await listar("?pedido_id=PEDTESTE")).corpo)).toEqual([]);
  });

  it.each([
    ["antes_de zero", "?antes_de=0"],
    ["antes_de não numérico", "?antes_de=abc"],
    ["resultado fora do domínio", "?resultado=ok"],
    ["limite acima do teto", "?limite=201"],
    ["pedido_id só de espaços", "?pedido_id=%20%20"],
  ])("%s: 400 requisicao_invalida", async (_caso, consulta) => {
    const res = await chamar(consulta);
    expect(res.status).toBe(400);
    expect(await res.json()).toMatchObject({
      erro: { codigo: "requisicao_invalida", mensagem: "Consulta inválida" },
    });
  });
});

describe("gravações fora do formato atual também saem reduzidas, sem quebrar o contrato", () => {
  it("posição numérica, parte estranha no caminho, código fora da forma, sem ocorrências e lista vazia", async () => {
    // As entregas gravadas aqui saem no fim: os outros testes contam as do beforeAll, em qualquer ordem.
    onTestFinished(async () => {
      await db
        .prepare("DELETE FROM webhook_eventos WHERE pedido_id = 'PED-FORMATO'")
        .run();
    });
    const inserir = (
      resultado: string,
      erro: string | null,
      avisos: string | null,
    ) =>
      db
        .prepare(
          `INSERT INTO webhook_eventos (recebido_em, evento, pedido_id, slug, resultado, status_anterior,
             status_resultante, payload_redigido, erro, avisos)
           VALUES ('2026-11-25T12:00:00.000Z', 'paid_order', 'PED-FORMATO', ?1, ?2, NULL, ?3, ?4, ?5, ?6)
           RETURNING id`,
        )
        .bind(
          SLUG,
          resultado,
          resultado === "erro_validacao" ? null : "approved",
          resultado === "erro_validacao" ? null : "{}",
          erro,
          avisos,
        )
        .first<{ id: number }>();
    const comAvisos = await inserir(
      "processado",
      null,
      JSON.stringify([
        { caminho: ["numbers", 3], codigo: "invalid_type", mensagem: EMAIL },
        {
          caminho: ["numbers", "*"],
          codigo: "invalid_type",
          mensagem: EMAIL,
          ocorrencias: 4,
        },
        { caminho: ["buyer", EMAIL], codigo: "invalid_type", ocorrencias: 1 },
        {
          caminho: ["total"],
          codigo: `Código com ${TELEFONE}`,
          ocorrencias: 2,
        },
        "texto solto",
        null,
      ]),
    );
    const erroVazio = await inserir("erro_validacao", "[]", null);
    const doisProblemas = await inserir(
      "erro_validacao",
      JSON.stringify([
        { caminho: [], codigo: "json_invalido", mensagem: "x", ocorrencias: 1 },
        {
          caminho: ["id"],
          codigo: "invalid_type",
          mensagem: "x",
          ocorrencias: 1,
        },
      ]),
      null,
    );
    const { corpo, texto } = await listar("?pedido_id=PED-FORMATO");
    const porId = new Map<number, EntregaWebhook>(
      corpo.itens.map((item) => [item.id, item]),
    );
    expect(porId.get(comAvisos!.id)?.avisos).toEqual([
      { campo: "numbers.*", codigo: "invalid_type", ocorrencias: 5 },
      { campo: "buyer.?", codigo: "invalid_type", ocorrencias: 1 },
      { campo: "total", codigo: "codigo_desconhecido", ocorrencias: 2 },
    ]);
    expect(porId.get(erroVazio!.id)?.erro).toEqual({
      codigo: "payload_invalido",
      problemas: [{ campo: "", codigo: "payload_invalido", ocorrencias: 1 }],
    });
    // json_invalido junto com outro problema não é a recusa do corpo: payload_invalido.
    expect(porId.get(doisProblemas!.id)?.erro?.codigo).toBe("payload_invalido");
    for (const pessoal of PESSOAIS) expect(texto).not.toContain(pessoal);
  });
});
