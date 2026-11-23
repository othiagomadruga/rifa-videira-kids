// POST /api/admin/hierarquia/importar: CA2 (regras da importação), CA3 (CSV de 36 células) e CA4 (modelo).
import { env } from "cloudflare:workers";
import { beforeEach, describe, expect, it } from "vitest";
import modeloCsv from "../../../docs/modelos/hierarquia-modelo.csv?raw";
import {
  COLUNAS_CSV_HIERARQUIA,
  LIMITE_CARACTERES_CSV_HIERARQUIA,
  LIMITE_LINHAS_CSV_HIERARQUIA,
  detalhesCsvInvalidoSchema,
  respostaImportarHierarquiaSchema,
  type RespostaImportarHierarquia,
} from "../../shared/contracts";
import {
  chamar,
  conforme,
  criarCelula,
  criarDiscipulador,
  criarRede,
  esperarErro,
  limparHierarquia,
  listarCelulas,
  listarDiscipuladores,
  listarRedes,
  nomes,
} from "../test/hierarquia-apoio";

const IMPORTAR = "/api/admin/hierarquia/importar";

async function importar(csv: string, simular?: boolean, db?: D1Database) {
  return chamar(
    "POST",
    IMPORTAR,
    simular === undefined ? { csv } : { csv, simular },
    { db },
  );
}

async function importarComSucesso(csv: string, simular?: boolean) {
  const resposta = await importar(csv, simular);
  expect(resposta.status).toBe(200);
  return conforme(respostaImportarHierarquiaSchema, resposta.corpo);
}

const zero = { redes: 0, discipuladores: 0, celulas: 0 };

function relatorio(
  parcial: Partial<RespostaImportarHierarquia>,
): RespostaImportarHierarquia {
  return {
    aplicado: true,
    simulado: false,
    total_linhas: 0,
    criados: zero,
    atualizados: zero,
    inalterados: zero,
    erros: [],
    avisos: [],
    ...parcial,
  };
}

/** O exemplo de docs/api.md. */
const EXEMPLO_DO_CONTRATO = [
  "rede,divisao,rede_responsavel,discipulador,celula,qtd_pessoas,lider_nome,lider_email,lider_telefone",
  "Rede Jovem Ficticia,jovens,Obreiro Ficticio,Discipulador Ficticio A,Célula Ficticia 01,12,Lider Ficticio 01,lider01@example.com,(91) 90000-0001",
  "Rede Jovem Ficticia,jovens,Obreiro Ficticio,Discipulador Ficticio A,Célula Ficticia 02,9,Lider Ficticio 02,,",
  "Rede Adulta Ficticia,adultos,,Discipulador Ficticio B,Célula Ficticia 03,15,Lider Ficticio 03,lider03@example.com,",
].join("\n");

/** Escreve um CSV como uma planilha exporta: aspas só onde precisa, com "" para aspas. */
function montarCsv(linhas: string[][], separador: "," | ";"): string {
  const campo = (valor: string) =>
    valor.includes(separador) || /["\r\n]/.test(valor)
      ? `"${valor.replaceAll('"', '""')}"`
      : valor;
  return linhas.map((linha) => linha.map(campo).join(separador)).join("\r\n");
}

beforeEach(limparHierarquia);

describe("CA2: importação da hierarquia", () => {
  it("cria a hierarquia do exemplo do contrato num banco vazio", async () => {
    expect(await importarComSucesso(EXEMPLO_DO_CONTRATO)).toEqual(
      relatorio({
        total_linhas: 3,
        criados: { redes: 2, discipuladores: 2, celulas: 3 },
      }),
    );

    expect(await listarRedes()).toEqual([
      expect.objectContaining({
        nome: "Rede Adulta Ficticia",
        divisao: "adultos",
        responsavel_nome: null,
      }),
      expect.objectContaining({
        nome: "Rede Jovem Ficticia",
        divisao: "jovens",
        responsavel_nome: "Obreiro Ficticio",
      }),
    ]);
    expect(
      (await listarCelulas()).map(
        ({ nome, discipulador_nome, rede_nome, divisao, ...lider }) => ({
          nome,
          discipulador_nome,
          rede_nome,
          divisao,
          qtd_pessoas: lider.qtd_pessoas,
          lider_nome: lider.lider_nome,
          lider_email: lider.lider_email,
          lider_telefone: lider.lider_telefone,
        }),
      ),
    ).toEqual([
      {
        nome: "Célula Ficticia 01",
        discipulador_nome: "Discipulador Ficticio A",
        rede_nome: "Rede Jovem Ficticia",
        divisao: "jovens",
        qtd_pessoas: 12,
        lider_nome: "Lider Ficticio 01",
        lider_email: "lider01@example.com",
        lider_telefone: "(91) 90000-0001",
      },
      {
        nome: "Célula Ficticia 02",
        discipulador_nome: "Discipulador Ficticio A",
        rede_nome: "Rede Jovem Ficticia",
        divisao: "jovens",
        qtd_pessoas: 9,
        lider_nome: "Lider Ficticio 02",
        lider_email: null,
        lider_telefone: null,
      },
      {
        nome: "Célula Ficticia 03",
        discipulador_nome: "Discipulador Ficticio B",
        rede_nome: "Rede Adulta Ficticia",
        divisao: "adultos",
        qtd_pessoas: 15,
        lider_nome: "Lider Ficticio 03",
        lider_email: "lider03@example.com",
        lider_telefone: null,
      },
    ]);
  });

  it("importar de novo o mesmo arquivo deixa tudo inalterado e não regrava nada", async () => {
    await importarComSucesso(EXEMPLO_DO_CONTRATO);
    const antes = await listarCelulas();

    expect(await importarComSucesso(EXEMPLO_DO_CONTRATO)).toEqual(
      relatorio({
        total_linhas: 3,
        inalterados: { redes: 2, discipuladores: 2, celulas: 3 },
      }),
    );
    expect(await listarCelulas()).toEqual(antes);
  });

  it("RIFA-085: a importação não mexe no grupo próprio da célula (nem no do discipulador), mesmo quando atualiza a célula", async () => {
    await importarComSucesso(EXEMPLO_DO_CONTRATO);
    const [celula01] = await listarCelulas();
    const [discipuladorA] = await listarDiscipuladores();
    expect(celula01.nome).toBe("Célula Ficticia 01");
    await env.DB.batch([
      env.DB.prepare("UPDATE celulas SET grupo_id = 4 WHERE id = ?1").bind(
        celula01.id,
      ),
      env.DB.prepare(
        "UPDATE discipuladores SET grupo_id = 3 WHERE id = ?1",
      ).bind(discipuladorA.id),
    ]);

    // qtd_pessoas 12 → 14: a célula é atualizada pela planilha, que não tem coluna de grupo.
    const alterado = EXEMPLO_DO_CONTRATO.replace(
      "Célula Ficticia 01,12,",
      "Célula Ficticia 01,14,",
    );
    expect(await importarComSucesso(alterado)).toMatchObject({
      atualizados: { redes: 0, discipuladores: 0, celulas: 1 },
    });
    expect(
      (await listarCelulas()).map((celula) => [
        celula.nome,
        celula.qtd_pessoas,
        celula.grupo_id,
        celula.grupo_efetivo_nome,
      ]),
    ).toEqual([
      ["Célula Ficticia 01", 14, 4, "Adolescentes"],
      ["Célula Ficticia 02", 9, null, "Jovens"],
      ["Célula Ficticia 03", 15, null, null],
    ]);
  });

  it("atualiza pela chave de nome (maiúsculas não importam), move entidades e nunca apaga", async () => {
    await importarComSucesso(EXEMPLO_DO_CONTRATO);
    const [discipuladorA] = await listarDiscipuladores();
    expect(discipuladorA.nome).toBe("Discipulador Ficticio A");
    const foraDoArquivo = await criarCelula(
      discipuladorA.id,
      "Célula Fora da Planilha",
    );

    // A grafia da primeira linha de cada entidade é a que vale; as outras só precisam bater na chave.
    const alterado = [
      "rede,divisao,rede_responsavel,discipulador,celula,qtd_pessoas,lider_nome,lider_email,lider_telefone",
      // qtd_pessoas 12 → 14
      "Rede Jovem Ficticia,jovens,Obreiro Ficticio,Discipulador Ficticio A,Célula Ficticia 01,14,Lider Ficticio 01,lider01@example.com,(91) 90000-0001",
      // a célula muda de discipulador e as maiúsculas do nome; o discipulador B muda de rede
      "rede jovem ficticia,jovens,Obreiro Ficticio,Discipulador Ficticio B,CÉLULA FICTICIA 02,9,Lider Ficticio 02,,",
      "REDE JOVEM FICTICIA,jovens,Obreiro Ficticio,DISCIPULADOR FICTICIO B,Célula Ficticia 03,15,Lider Ficticio 03,lider03@example.com,",
    ].join("\n");

    expect(await importarComSucesso(alterado)).toEqual(
      relatorio({
        total_linhas: 3,
        atualizados: { redes: 0, discipuladores: 1, celulas: 2 },
        inalterados: { redes: 1, discipuladores: 1, celulas: 1 },
      }),
    );

    // A rede adulta saiu do arquivo, mas não foi apagada; a célula de fora também não.
    expect(nomes(await listarRedes())).toEqual([
      "Rede Adulta Ficticia",
      "Rede Jovem Ficticia",
    ]);
    expect(
      (await listarDiscipuladores()).map((d) => [d.nome, d.rede_nome]),
    ).toEqual([
      ["Discipulador Ficticio A", "Rede Jovem Ficticia"],
      ["Discipulador Ficticio B", "Rede Jovem Ficticia"],
    ]);
    expect(
      Object.fromEntries(
        (await listarCelulas()).map((c) => [
          c.nome,
          [c.discipulador_nome, c.divisao, c.qtd_pessoas],
        ]),
      ),
    ).toEqual({
      "Célula Ficticia 01": ["Discipulador Ficticio A", "jovens", 14],
      "CÉLULA FICTICIA 02": ["Discipulador Ficticio B", "jovens", 9],
      "Célula Ficticia 03": ["Discipulador Ficticio B", "jovens", 15],
      "Célula Fora da Planilha": ["Discipulador Ficticio A", "jovens", 10],
    });
    expect(
      (await listarCelulas()).find((c) => c.id === foraDoArquivo.id),
    ).toEqual(foraDoArquivo);
  });

  it("coluna opcional fora do cabeçalho mantém o valor; presente e vazia apaga", async () => {
    await importarComSucesso(EXEMPLO_DO_CONTRATO);

    // Sem rede_responsavel, lider_email e lider_telefone: os valores atuais ficam.
    const semOpcionais = [
      "rede,divisao,discipulador,celula,qtd_pessoas,lider_nome",
      "Rede Jovem Ficticia,jovens,Discipulador Ficticio A,Célula Ficticia 01,30,Lider Ficticio 01",
    ].join("\n");
    expect(await importarComSucesso(semOpcionais)).toEqual(
      relatorio({
        total_linhas: 1,
        atualizados: { redes: 0, discipuladores: 0, celulas: 1 },
        inalterados: { redes: 1, discipuladores: 1, celulas: 0 },
      }),
    );
    expect((await listarCelulas())[0]).toMatchObject({
      nome: "Célula Ficticia 01",
      qtd_pessoas: 30,
      lider_email: "lider01@example.com",
      lider_telefone: "(91) 90000-0001",
    });
    expect((await listarRedes())[1]).toMatchObject({
      nome: "Rede Jovem Ficticia",
      responsavel_nome: "Obreiro Ficticio",
    });

    // Com as colunas presentes e vazias: os valores são apagados.
    const opcionaisVazios = [
      "rede,divisao,rede_responsavel,discipulador,celula,qtd_pessoas,lider_nome,lider_email",
      "Rede Jovem Ficticia,jovens,,Discipulador Ficticio A,Célula Ficticia 01,30,Lider Ficticio 01,",
    ].join("\n");
    expect(await importarComSucesso(opcionaisVazios)).toEqual(
      relatorio({
        total_linhas: 1,
        atualizados: { redes: 1, discipuladores: 0, celulas: 1 },
        inalterados: { redes: 0, discipuladores: 1, celulas: 0 },
      }),
    );
    expect((await listarCelulas())[0]).toMatchObject({
      lider_email: null,
      lider_telefone: "(91) 90000-0001",
    });
    expect((await listarRedes())[1].responsavel_nome).toBeNull();
  });

  it("o responsável da rede pode vir em qualquer linha dela: as linhas vazias não o apagam", async () => {
    const csv = [
      "rede;divisao;rede_responsavel;discipulador;celula;qtd_pessoas;lider_nome",
      "Rede Adulta;adultos;;Discipulador A;Célula 01;8;Líder 01",
      "Rede Adulta;adultos;Pastor Ficticio;Discipulador A;Célula 02;8;Líder 02",
      "Rede Adulta;adultos;;Discipulador A;Célula 03;8;Líder 03",
    ].join("\n");

    expect(await importarComSucesso(csv)).toMatchObject({
      aplicado: true,
      erros: [],
      criados: { redes: 1, discipuladores: 1, celulas: 3 },
    });
    expect((await listarRedes())[0].responsavel_nome).toBe("Pastor Ficticio");
  });

  it("simular não grava nada e devolve o mesmo relatório da importação de verdade", async () => {
    const simulado = await importarComSucesso(EXEMPLO_DO_CONTRATO, true);

    expect(simulado).toEqual(
      relatorio({
        aplicado: false,
        simulado: true,
        total_linhas: 3,
        criados: { redes: 2, discipuladores: 2, celulas: 3 },
      }),
    );
    expect(await listarRedes()).toEqual([]);
    expect(await listarDiscipuladores()).toEqual([]);
    expect(await listarCelulas()).toEqual([]);

    const real = await importarComSucesso(EXEMPLO_DO_CONTRATO, false);
    expect({ ...real, aplicado: false, simulado: true }).toEqual(simulado);
    expect(real).toMatchObject({ aplicado: true, simulado: false });
  });

  it("erro por linha (linha, coluna, mensagem) e nada é gravado: o caso do contrato", async () => {
    const comErro = [
      "rede,divisao,rede_responsavel,discipulador,celula,qtd_pessoas,lider_nome,lider_email,lider_telefone",
      "Rede Jovem Ficticia,jovens,Obreiro Ficticio,Discipulador Ficticio A,Célula Ficticia 01,12,Lider Ficticio 01,lider01@example.com,(91) 90000-0001",
      "Rede Jovem Ficticia,jovens,Obreiro Ficticio,Discipulador Ficticio A,Célula Ficticia 02,9,Lider Ficticio 02,,",
      'Rede Adulta Ficticia,adultos,,Discipulador Ficticio B,Célula Ficticia 03,"12,5",Lider Ficticio 03,lider03@example.com,',
    ].join("\n");

    expect(await importarComSucesso(comErro)).toEqual(
      relatorio({
        aplicado: false,
        total_linhas: 3,
        criados: { redes: 1, discipuladores: 1, celulas: 2 },
        erros: [
          {
            linha: 4,
            coluna: "qtd_pessoas",
            mensagem: "Use um número inteiro",
          },
        ],
      }),
    );
    expect(await listarRedes()).toEqual([]);
    expect(await listarCelulas()).toEqual([]);
  });

  it("explica cada problema em português, um erro por coluna, na ordem das linhas", async () => {
    const longo = "x".repeat(121);
    const csv = [
      "rede;divisao;discipulador;celula;qtd_pessoas;lider_nome;lider_email;lider_telefone",
      "Rede A;jovens;Disc A;;10;Líder;;",
      "Rede A;kids;Disc A;Célula 03;10;Líder;;",
      "Rede A;jovens;Disc A;Célula 04;0;Líder;;",
      "Rede A;jovens;Disc A;Célula 05;1001;Líder;;",
      "Rede A;jovens;Disc A;Célula 06;dez;Líder;sem-arroba;",
      `Rede A;jovens;Disc A;Célula 07;10;${longo};;${"9".repeat(41)}`,
      ";jovens;Disc A;Célula 08;10; ;;",
      "Rede A;Jovens;Disc A;Célula 09;10;Líder;;",
    ].join("\r\n");

    expect(await importarComSucesso(csv)).toEqual(
      relatorio({
        aplicado: false,
        total_linhas: 8,
        criados: { redes: 1, discipuladores: 1, celulas: 1 },
        erros: [
          { linha: 2, coluna: "celula", mensagem: "Preencha esta coluna" },
          {
            linha: 3,
            coluna: "divisao",
            mensagem: 'Use "jovens" ou "adultos"',
          },
          {
            linha: 4,
            coluna: "qtd_pessoas",
            mensagem: "Use um número a partir de 1",
          },
          {
            linha: 5,
            coluna: "qtd_pessoas",
            mensagem: "Use um número até 1000",
          },
          {
            linha: 6,
            coluna: "qtd_pessoas",
            mensagem: "Use um número inteiro",
          },
          { linha: 6, coluna: "lider_email", mensagem: "E-mail inválido" },
          {
            linha: 7,
            coluna: "lider_nome",
            mensagem: "Use no máximo 120 caracteres",
          },
          {
            linha: 7,
            coluna: "lider_telefone",
            mensagem: "Use no máximo 40 caracteres",
          },
          { linha: 8, coluna: "rede", mensagem: "Preencha esta coluna" },
          { linha: 8, coluna: "lider_nome", mensagem: "Preencha esta coluna" },
        ],
      }),
    );
    expect(await listarCelulas()).toEqual([]);
  });

  it("o arquivo precisa ser coerente: a linha que contradiz uma anterior é erro", async () => {
    const csv = [
      "rede,divisao,rede_responsavel,discipulador,celula,qtd_pessoas,lider_nome",
      "Rede A,jovens,,Discipulador X,Célula 1,8,Líder 1",
      "rede a,adultos,,Discipulador Z,Célula 2,8,Líder 2",
      "Rede B,adultos,,discipulador x,Célula 3,8,Líder 3",
      "Rede A,jovens,,Discipulador Y,CÉLULA 1,8,Líder 4",
      "Rede A,jovens,Pastor Um,Discipulador Y,Célula 5,8,Líder 5",
      "Rede A,jovens,Pastor Dois,Discipulador Y,Célula 6,8,Líder 6",
      "Rede A,jovens,,Discipulador Y,Célula 7,8,Líder 7",
    ].join("\n");

    expect(await importarComSucesso(csv)).toEqual(
      relatorio({
        aplicado: false,
        total_linhas: 7,
        criados: { redes: 1, discipuladores: 2, celulas: 3 },
        erros: [
          {
            linha: 3,
            coluna: "divisao",
            mensagem:
              'A rede "Rede A" já aparece na linha 2 com a divisão "jovens"',
          },
          {
            linha: 4,
            coluna: "discipulador",
            mensagem:
              'O discipulador "Discipulador X" já aparece na linha 2 na rede "Rede A" (um discipulador fica numa rede só; se forem pessoas diferentes, diferencie os nomes)',
          },
          {
            linha: 5,
            coluna: null,
            mensagem:
              'A célula "Célula 1" já aparece na linha 2 com dados diferentes (discipulador, lider_nome): deixe uma linha só ou, se forem células diferentes, diferencie os nomes',
          },
          {
            linha: 7,
            coluna: "rede_responsavel",
            mensagem:
              'A rede "Rede A" já aparece na linha 6 com o responsável "Pastor Um"',
          },
        ],
      }),
    );
    expect(await listarRedes()).toEqual([]);
  });

  it("linha de célula repetida com os mesmos dados é tolerada e conta uma vez; com dados diferentes é erro", async () => {
    const cabecalho =
      "rede;divisao;rede_responsavel;discipulador;celula;qtd_pessoas;lider_nome;lider_email;lider_telefone";
    const celula01 =
      "Rede A;jovens;Pastor Um;Discipulador A;Célula 01;12;Líder 01;lider01@example.com;(91) 90000-0001";
    const celula02 = "Rede A;jovens;;Discipulador A;Célula 02;9;Líder 02;;";
    const repetidas = [
      cabecalho,
      celula01,
      celula02,
      // A linha 2 de novo, só com espaços nas pontas e maiúsculas diferentes.
      " REDE A ;Jovens;PASTOR UM;discipulador a; CÉLULA 01 ; 12 ;LÍDER 01;Lider01@Example.com;(91) 90000-0001",
      celula02,
    ].join("\r\n");

    expect(await importarComSucesso(repetidas)).toEqual(
      relatorio({
        total_linhas: 4,
        criados: { redes: 1, discipuladores: 1, celulas: 2 },
        avisos: [
          {
            tipo: "linha_repetida",
            linha: 4,
            mensagem:
              "Linha igual à linha 2: foi ignorada (a célula conta uma vez)",
          },
          {
            tipo: "linha_repetida",
            linha: 5,
            mensagem:
              "Linha igual à linha 3: foi ignorada (a célula conta uma vez)",
          },
        ],
      }),
    );
    // Vale a grafia da primeira linha de cada célula.
    expect(
      (await listarCelulas()).map((c) => [
        c.nome,
        c.qtd_pessoas,
        c.lider_nome,
        c.lider_email,
      ]),
    ).toEqual([
      ["Célula 01", 12, "Líder 01", "lider01@example.com"],
      ["Célula 02", 9, "Líder 02", null],
    ]);

    // Repetida com algum dado diferente: erro na linha repetida, citando as colunas, e nada é gravado.
    await limparHierarquia();
    const divergente = [
      cabecalho,
      celula01,
      "Rede A;jovens;Pastor Um;Discipulador A;célula 01;13;Líder 01;;(91) 90000-0001",
    ].join("\r\n");
    expect(await importarComSucesso(divergente)).toEqual(
      relatorio({
        aplicado: false,
        total_linhas: 2,
        criados: { redes: 1, discipuladores: 1, celulas: 1 },
        erros: [
          {
            linha: 3,
            coluna: null,
            mensagem:
              'A célula "Célula 01" já aparece na linha 2 com dados diferentes (qtd_pessoas, lider_email): deixe uma linha só ou, se forem células diferentes, diferencie os nomes',
          },
        ],
      }),
    );
    expect(await listarCelulas()).toEqual([]);
  });

  it("é atômico também no banco: se a gravação falha no meio, nada do arquivo fica", async () => {
    const rede = await criarRede({
      nome: "Rede Existente",
      divisao: "adultos",
    });
    const discipulador = await criarDiscipulador(
      rede.id,
      "Discipulador Existente",
    );
    let lotes = 0;
    const dbComCorrida = new Proxy(env.DB, {
      get(alvo, propriedade) {
        if (propriedade === "batch")
          return async (instrucoes: D1PreparedStatement[]) => {
            lotes++;
            // Entre a leitura (1º lote) e a gravação (2º lote), outra requisição cria uma célula
            // com um nome do arquivo: a última instrução do lote falha (UNIQUE).
            if (lotes === 2)
              await alvo
                .prepare(
                  `INSERT INTO celulas (discipulador_id, nome, qtd_pessoas, lider_nome)
                   VALUES (?, 'Célula Nova', 5, 'Outro Líder')`,
                )
                .bind(discipulador.id)
                .run();
            return alvo.batch(instrucoes);
          };
        const valor: unknown = Reflect.get(alvo, propriedade);
        return typeof valor === "function" ? valor.bind(alvo) : valor;
      },
    });
    const csv = [
      "rede,divisao,discipulador,celula,qtd_pessoas,lider_nome",
      "Rede Nova,jovens,Discipulador Novo,Célula Nova,8,Líder Novo",
      "Rede Existente,adultos,Discipulador Existente,Célula Outra,8,Líder Outro",
    ].join("\n");

    const resposta = await importar(csv, false, dbComCorrida);

    expect(lotes).toBe(2);
    esperarErro(resposta, 409, "nome_duplicado");
    // As instruções anteriores do lote (rede e discipulador novos) foram desfeitas.
    expect(nomes(await listarRedes())).toEqual(["Rede Existente"]);
    expect(nomes(await listarDiscipuladores())).toEqual([
      "Discipulador Existente",
    ]);
    expect((await listarCelulas()).map((c) => [c.nome, c.lider_nome])).toEqual([
      ["Célula Nova", "Outro Líder"],
    ]);
  });

  it(`aceita até ${LIMITE_LINHAS_CSV_HIERARQUIA} linhas de dados e recusa uma a mais (400 csv_invalido)`, async () => {
    const linha = (i: number) =>
      [
        `Rede Limite ${i % 4}`,
        i % 4 < 2 ? "jovens" : "adultos",
        `Discipulador Limite ${i % 40}`,
        `Célula Limite ${i}`,
        String(1 + (i % 1000)),
        `Líder ${i}`,
      ].join(",");
    const csv = (quantidade: number) =>
      [
        "rede,divisao,discipulador,celula,qtd_pessoas,lider_nome",
        ...Array.from({ length: quantidade }, (_, i) => linha(i)),
      ].join("\n");

    const acima = esperarErro(
      await importar(csv(LIMITE_LINHAS_CSV_HIERARQUIA + 1)),
      400,
      "csv_invalido",
    );
    expect(acima).toEqual({
      codigo: "csv_invalido",
      mensagem:
        "O arquivo tem 2001 linhas de dados; o limite é 2000. Divida em mais de um arquivo.",
      detalhes: { motivo: "linhas_demais", limite: 2000, total_linhas: 2001 },
    });
    expect(await listarRedes()).toEqual([]);

    expect(await importarComSucesso(csv(LIMITE_LINHAS_CSV_HIERARQUIA))).toEqual(
      relatorio({
        total_linhas: 2000,
        criados: { redes: 4, discipuladores: 40, celulas: 2000 },
      }),
    );
    const total = await env.DB.prepare(
      "SELECT count(*) AS celulas FROM celulas",
    ).first<{ celulas: number }>();
    expect(total).toEqual({ celulas: 2000 });
  });

  it("400 csv_invalido com detalhes no formato do contrato: sem cabeçalho, colunas faltando, coluna repetida, aspas abertas, fora de UTF-8", async () => {
    const casos: [string, unknown, string][] = [
      [
        "\r\n \r\n",
        { motivo: "sem_cabecalho" },
        "O arquivo está vazio: a primeira linha precisa ser o cabeçalho com os nomes das colunas",
      ],
      [
        "rede;divisao;celula;observacao\nRede A;jovens;Célula 1;x\n",
        {
          motivo: "colunas_faltando",
          colunas: ["discipulador", "qtd_pessoas", "lider_nome"],
        },
        "Faltam colunas obrigatórias no cabeçalho (linha 1): discipulador, qtd_pessoas, lider_nome",
      ],
      [
        "rede;divisao;discipulador;celula;qtd_pessoas;lider_nome;REDE\n",
        { motivo: "coluna_repetida", coluna: "rede" },
        'A coluna "rede" aparece mais de uma vez no cabeçalho',
      ],
      [
        'rede,divisao,discipulador,celula,qtd_pessoas,lider_nome\nRede A,jovens,Disc,"Célula 1,8,Líder\n',
        { motivo: "aspas_abertas", linha: 2 },
        "As aspas abertas na linha 2 não foram fechadas",
      ],
      [
        "rede,divisao,discipulador,celula,qtd_pessoas,lider_nome\nRede A,jovens,Disc,C\uFFFDlula 1,8,L\uFFFDder\n",
        { motivo: "codificacao_invalida", linha: 2 },
        'O arquivo não está em UTF-8 (caractere inválido na linha 2). No Excel, salve como "CSV UTF-8"; no Google Planilhas, use Arquivo > Fazer download > CSV.',
      ],
    ];
    for (const [csv, detalhes, mensagem] of casos) {
      const erro = esperarErro(await importar(csv), 400, "csv_invalido");
      expect(erro).toEqual({ codigo: "csv_invalido", mensagem, detalhes });
      expect(detalhesCsvInvalidoSchema.parse(erro.detalhes)).toEqual(detalhes);
    }
    expect(await listarRedes()).toEqual([]);
  });

  it("coluna obrigatória com outro nome no cabeçalho: a mensagem sugere o nome certo", async () => {
    const erro = esperarErro(
      await importar(
        "rede;divisao;discipulador;celula;Quantidade de pessoas;Nome do líder;Observações\nRede A;jovens;Disc;Célula 1;8;Líder;x\n",
      ),
      400,
      "csv_invalido",
    );

    expect(erro).toEqual({
      codigo: "csv_invalido",
      mensagem:
        'Faltam colunas obrigatórias no cabeçalho (linha 1): qtd_pessoas, lider_nome. Talvez estejam com outro nome: "Quantidade de pessoas" (use "qtd_pessoas"), "Nome do líder" (use "lider_nome")',
      detalhes: {
        motivo: "colunas_faltando",
        colunas: ["qtd_pessoas", "lider_nome"],
      },
    });
  });

  it("csv vazio ou acima de 1 MB: 400 csv_invalido com mensagem em português", async () => {
    const vazio = esperarErro(
      await chamar("POST", IMPORTAR, { csv: "" }),
      400,
      "csv_invalido",
    );
    expect(vazio).toEqual({
      codigo: "csv_invalido",
      mensagem:
        "O arquivo está vazio: a primeira linha precisa ser o cabeçalho com os nomes das colunas",
      detalhes: { motivo: "sem_cabecalho" },
    });

    const grande = esperarErro(
      await chamar("POST", IMPORTAR, {
        csv: "x".repeat(LIMITE_CARACTERES_CSV_HIERARQUIA + 1),
        simular: true,
      }),
      400,
      "csv_invalido",
    );
    expect(grande).toEqual({
      codigo: "csv_invalido",
      mensagem:
        "O arquivo passa de 1 MB: divida a planilha em arquivos menores e importe um de cada vez.",
      detalhes: {
        motivo: "arquivo_grande",
        limite_caracteres: LIMITE_CARACTERES_CSV_HIERARQUIA,
      },
    });
    expect(await listarRedes()).toEqual([]);
  });

  it("400 requisicao_invalida (mensagens em português) ou json_invalido quando o corpo foge do schema", async () => {
    const semCsv = esperarErro(
      await chamar("POST", IMPORTAR, { simular: true }),
      400,
      "requisicao_invalida",
    );
    expect(semCsv.detalhes).toEqual([
      {
        caminho: ["csv"],
        codigo: "invalid_type",
        mensagem: "Campo obrigatório",
      },
    ]);
    const simularTexto = esperarErro(
      await chamar("POST", IMPORTAR, {
        csv: EXEMPLO_DO_CONTRATO,
        simular: "sim",
      }),
      400,
      "requisicao_invalida",
    );
    expect(simularTexto.detalhes).toEqual([
      {
        caminho: ["simular"],
        codigo: "invalid_type",
        mensagem: "Use true ou false",
      },
    ]);
    esperarErro(
      await chamar("POST", IMPORTAR, undefined, {
        corpoBruto: EXEMPLO_DO_CONTRATO,
        contentType: "text/csv",
      }),
      400,
      "json_invalido",
    );
    expect(await listarRedes()).toEqual([]);
  });
});

describe("CA3: planilha fictícia de 36 células (redes de jovens e adultos)", () => {
  const REDES = [
    ["Rede Jovem Norte", "jovens", "Pastor Fictício Álvaro"],
    ["Rede Jovem Sul", "jovens", ""],
    ["Rede Adulta Leste", "adultos", "Obreira Fictícia Conceição"],
    ["Rede Adulta Oeste", "adultos", ""],
  ] as const;

  /** 9 células por rede (18 de jovens e 18 de adultos), 2 discipuladores por rede. */
  const LINHAS = Array.from({ length: 36 }, (_, i) => {
    const [rede, divisao, responsavel] = REDES[Math.floor(i / 9)];
    const numero = String(i + 1).padStart(2, "0");
    return [
      rede,
      divisao,
      responsavel,
      `Discipulador ${rede.replace("Rede ", "")} ${i % 9 < 5 ? "A" : "B"}`,
      `Célula Fictícia ${numero}`,
      String(5 + (i % 11)),
      `Líder Fictício ${numero}`,
      i % 3 === 0 ? `lider${numero}@example.com` : "",
      i % 4 === 0 ? `(91) 90000-00${numero}` : "",
    ];
  });
  // Casos difíceis: separador dentro de aspas, aspas escapadas, vírgula no telefone, acentos.
  LINHAS[0][4] = "Célula Esperança; Centro";
  LINHAS[1][6] = 'Maria "Tia Ma" Souza';
  LINHAS[2][8] = "(91) 90000-0003, ramal 2";
  LINHAS[20][4] = "Célula Ação e Graça";
  LINHAS[20][6] = "João da Conceição";

  const PONTO_E_VIRGULA =
    "\uFEFF" +
    montarCsv([[...COLUNAS_CSV_HIERARQUIA], ...LINHAS], ";") +
    "\r\n\r\n;;;;;;;;\r\n   \r\n";
  const VIRGULA =
    montarCsv([[...COLUNAS_CSV_HIERARQUIA], ...LINHAS], ",").replaceAll(
      "\r\n",
      "\n",
    ) + "\n\n";

  it("o arquivo de teste tem as características do CA3", () => {
    expect(PONTO_E_VIRGULA.startsWith("\uFEFFrede;divisao;")).toBe(true);
    expect(PONTO_E_VIRGULA).toContain('"Célula Esperança; Centro"');
    expect(PONTO_E_VIRGULA).toContain('"Maria ""Tia Ma"" Souza"');
    expect(PONTO_E_VIRGULA).toMatch(/\r\n\r\n;;;;;;;;\r\n {3}\r\n$/);
    expect(VIRGULA).toContain('"(91) 90000-0003, ramal 2"');
    expect(VIRGULA).not.toContain("\r");
  });

  it("importa com ponto e vírgula, BOM, CRLF, aspas, acentos e linhas em branco no fim", async () => {
    expect(await importarComSucesso(PONTO_E_VIRGULA)).toEqual(
      relatorio({
        total_linhas: 36,
        criados: { redes: 4, discipuladores: 8, celulas: 36 },
      }),
    );

    const celulas = await listarCelulas();
    expect(celulas).toHaveLength(36);
    expect(await listarCelulas("?divisao=jovens")).toHaveLength(18);
    expect(await listarCelulas("?divisao=adultos")).toHaveLength(18);
    expect(celulas.reduce((soma, c) => soma + c.qtd_pessoas, 0)).toBe(
      LINHAS.reduce((soma, linha) => soma + Number(linha[5]), 0),
    );
    const porNome = new Map(celulas.map((c) => [c.nome, c]));
    expect(porNome.get("Célula Esperança; Centro")).toMatchObject({
      rede_nome: "Rede Jovem Norte",
      discipulador_nome: "Discipulador Jovem Norte A",
      lider_email: "lider01@example.com",
      lider_telefone: "(91) 90000-0001",
    });
    expect(porNome.get("Célula Fictícia 02")?.lider_nome).toBe(
      'Maria "Tia Ma" Souza',
    );
    expect(porNome.get("Célula Fictícia 03")?.lider_telefone).toBe(
      "(91) 90000-0003, ramal 2",
    );
    expect(porNome.get("Célula Ação e Graça")).toMatchObject({
      lider_nome: "João da Conceição",
      rede_nome: "Rede Adulta Leste",
      divisao: "adultos",
    });
    expect(
      (await listarRedes()).map((r) => [r.nome, r.divisao, r.responsavel_nome]),
    ).toEqual([
      ["Rede Adulta Leste", "adultos", "Obreira Fictícia Conceição"],
      ["Rede Adulta Oeste", "adultos", null],
      ["Rede Jovem Norte", "jovens", "Pastor Fictício Álvaro"],
      ["Rede Jovem Sul", "jovens", null],
    ]);
  });

  it("a mesma planilha exportada com vírgula (LF, sem BOM) é lida igual: tudo inalterado", async () => {
    await importarComSucesso(PONTO_E_VIRGULA);

    expect(await importarComSucesso(VIRGULA)).toEqual(
      relatorio({
        total_linhas: 36,
        inalterados: { redes: 4, discipuladores: 8, celulas: 36 },
      }),
    );
  });

  it("aceita cabeçalho com maiúsculas e acentos e avisa as colunas desconhecidas, sugerindo a certa quando é parecida", async () => {
    const csv = [
      "REDE;Divisão;Discipulador;Célula;Qtd_Pessoas;Líder_Nome;Telefone do líder;E-mail;Observações;;",
      "Rede Jovem Norte;Jovens;Discipulador A;Célula 01;12;Líder 01;(91) 90000-0001;lider@example.com;liga às 19h;;",
    ].join("\r\n");

    expect(await importarComSucesso(csv)).toEqual(
      relatorio({
        total_linhas: 1,
        criados: { redes: 1, discipuladores: 1, celulas: 1 },
        avisos: [
          {
            tipo: "coluna_ignorada",
            linha: 1,
            mensagem:
              'Coluna "Telefone do líder" ignorada: não é uma coluna do modelo. Você quis dizer "lider_telefone"?',
          },
          {
            tipo: "coluna_ignorada",
            linha: 1,
            mensagem:
              'Coluna "E-mail" ignorada: não é uma coluna do modelo. Você quis dizer "lider_email"?',
          },
          {
            tipo: "coluna_ignorada",
            linha: 1,
            mensagem:
              'Coluna "Observações" ignorada: não é uma coluna do modelo',
          },
        ],
      }),
    );
    // Coluna ignorada não grava nada: telefone e e-mail ficam vazios.
    expect((await listarCelulas())[0]).toMatchObject({
      nome: "Célula 01",
      divisao: "jovens",
      lider_email: null,
      lider_telefone: null,
    });
  });
});

describe("nomes com espaços em sequência (inclusive espaço não separável e tab)", () => {
  it("na planilha, são o mesmo nome e são gravados com um espaço só", async () => {
    const csv = [
      "rede;divisao;rede_responsavel;discipulador;celula;qtd_pessoas;lider_nome;lider_telefone",
      "Rede  Jovem;jovens;Pastor   Fulano;Discipulador\tA;Célula   01;10;Líder  Um;(91)  90000-0001",
      "Rede\u00A0Jovem;jovens;;Discipulador A;Célula 02;10;Líder Dois;",
      " rede jovem ;jovens;Pastor\u00A0Fulano;discipulador  a;CÉLULA\u00A001;10;Líder Um;(91) 90000-0001",
    ].join("\r\n");

    expect(await importarComSucesso(csv)).toEqual(
      relatorio({
        total_linhas: 3,
        criados: { redes: 1, discipuladores: 1, celulas: 2 },
        avisos: [
          {
            tipo: "linha_repetida",
            linha: 4,
            mensagem:
              "Linha igual à linha 2: foi ignorada (a célula conta uma vez)",
          },
        ],
      }),
    );
    expect(
      (await listarRedes()).map((r) => [r.nome, r.responsavel_nome]),
    ).toEqual([["Rede Jovem", "Pastor Fulano"]]);
    expect(nomes(await listarDiscipuladores())).toEqual(["Discipulador A"]);
    expect(
      (await listarCelulas()).map((c) => [
        c.nome,
        c.lider_nome,
        c.lider_telefone,
      ]),
    ).toEqual([
      ["Célula 01", "Líder Um", "(91) 90000-0001"],
      ["Célula 02", "Líder Dois", null],
    ]);
  });

  it("o que já está gravado com um espaço só é encontrado e fica inalterado", async () => {
    const rede = await criarRede({ nome: "Rede Norte" });
    const discipulador = await criarDiscipulador(rede.id, "Discipulador B");
    await criarCelula(discipulador.id, "Célula 03");
    const csv = [
      "rede;divisao;discipulador;celula;qtd_pessoas;lider_nome",
      "Rede   Norte;jovens;Discipulador\u00A0\u00A0B;Célula\t03;10;Líder  da  Célula 03",
    ].join("\n");

    expect(await importarComSucesso(csv)).toEqual(
      relatorio({
        total_linhas: 1,
        inalterados: { redes: 1, discipuladores: 1, celulas: 1 },
      }),
    );
  });

  it("nome gravado antes com espaços duplos é encontrado e passa a ter um espaço só", async () => {
    await env.DB.prepare(
      "INSERT INTO redes (nome, divisao) VALUES ('Rede  Antiga', 'adultos')",
    ).run();
    const csv = [
      "rede;divisao;discipulador;celula;qtd_pessoas;lider_nome",
      "Rede Antiga;adultos;Discipulador C;Célula 04;10;Líder",
    ].join("\n");

    expect(await importarComSucesso(csv)).toEqual(
      relatorio({
        total_linhas: 1,
        criados: { redes: 0, discipuladores: 1, celulas: 1 },
        atualizados: { redes: 1, discipuladores: 0, celulas: 0 },
      }),
    );
    expect(nomes(await listarRedes())).toEqual(["Rede Antiga"]);
  });
});

describe("CA4: modelo para a igreja preencher", () => {
  it("docs/modelos/hierarquia-modelo.csv tem as colunas do contrato e importa sem erro", async () => {
    const [cabecalho] = modeloCsv.replace(/^\uFEFF/, "").split(/\r?\n/);
    expect(cabecalho.split(";")).toEqual([...COLUNAS_CSV_HIERARQUIA]);

    expect(await importarComSucesso(modeloCsv)).toEqual(
      relatorio({
        total_linhas: 2,
        criados: { redes: 2, discipuladores: 2, celulas: 2 },
      }),
    );
    expect(
      (await listarCelulas()).map((c) => [
        c.nome,
        c.divisao,
        c.lider_nome,
        c.lider_email,
        c.lider_telefone,
      ]),
    ).toEqual([
      [
        "Célula Exemplo 01",
        "jovens",
        "Líder Exemplo 01",
        "lider01@example.com",
        "(91) 90000-0001",
      ],
      ["Célula Exemplo 02", "adultos", "Líder Exemplo 02", null, null],
    ]);
  });
});
