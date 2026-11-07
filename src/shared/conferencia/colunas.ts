/**
 * Colunas do CSV "Exportar Pedidos" da Rifei na conferência (RIFA-012; docs/integracao-rifei.md, seção
 * 10): o campo que cada nome indica (com as variações em português e em inglês), as colunas de dado
 * pessoal, o mapeamento detectado e a conferência de um mapeamento escolhido na tela.
 *
 * Módulo puro e sem zod: roda no navegador (que lê o arquivo) e no Worker (que confere de novo, pelo nome,
 * que nenhuma coluna mapeada é de dado pessoal). Só lê nomes de coluna, nunca valores.
 *
 * As colunas reais do export da Rifei ainda não estão confirmadas (integracao-rifei.md, seção 9, item 9):
 * a detecção é por palavras do nome, e a coordenação confere e ajusta o mapeamento na tela.
 */
import {
  CAMPOS_RECONCILIACAO,
  LIMITE_COLUNAS_CSV_RECONCILIACAO,
  type CampoReconciliacao,
  type ColunaArquivoReconciliacao,
  type MapeamentoReconciliacao,
  type ProblemaDoCorpo,
} from "../contracts/conferencia";
import { normalizarNomeDeColuna, resumirNomeDeColuna } from "../csv";

/** Conjunto de palavras escritas num texto só, separadas por espaço. */
export const conjunto = (palavras: string) => new Set(palavras.split(" "));

const DO_AFILIADO = conjunto(
  "afiliado afiliada afiliados afiliadas affiliate affiliates vendedor vendedora revendedor revendedora promotor promotora indicacao indicado indicada indicador indicadora parceiro parceira embaixador embaixadora referral",
);
const DE_IDENTIFICADOR = conjunto(
  "id codigo cod numero num nro n no identificador code ref referencia",
);
const DE_CONTEXTO_DO_STATUS = conjunto("pedido pagamento compra order payment");
/** Dado pessoal do comprador (ou da compra dele): a coluna nunca é lida. */
const DE_DADO_PESSOAL = conjunto(
  "nome name email mail telefone fone tel celular whatsapp whats wpp zap zapzap phone mobile contato contatos cpf cnpj documento document rg identidade nascimento birth birthday aniversario idade endereco address logradouro rua bairro cidade city municipio cep zipcode zip uf estado state pais country complemento comprador compradora cliente buyer customer participante pagador titular sobrenome genero sexo instagram facebook observacao observacoes obs observation mensagem comentario comentarios ip",
);
/** Com uma destas colunas no arquivo, "Número" sozinho é o número do endereço (dado pessoal). */
const DO_ENDERECO = conjunto(
  "endereco address logradouro rua bairro cep zipcode complemento",
);
const SO_NUMERO = conjunto("numero num nro n no number");
const DE_DATA = conjunto("data date dia datahora datetime timestamp");
/** "Pago em", "Criado em", "paid_at"... */
const ANTES_DE_EM = conjunto(
  "pago paga aprovado aprovada confirmado confirmada criado criada feito realizado comprado",
);
const ANTES_DE_AT = conjunto("created paid approved confirmed");
const DO_PAGAMENTO = conjunto(
  "pagamento pago paga aprovacao aprovado aprovada confirmacao confirmado confirmada paid approved approval payment confirmed",
);
/** Datas que não são da venda: a coluna fica sem campo. */
const DE_DATA_IGNORADA = conjunto(
  "vencimento expiracao expira expirado expirada expired expires validade reserva atualizacao atualizado updated alteracao cancelamento sorteio",
);
const DE_QUANTIDADE = conjunto("quantidade qtd qtde quant quantity qty count");
const DE_BILHETE = conjunto(
  "bilhete bilhetes cota cotas numeros numbers ticket tickets titulo titulos",
);
const TOTAL_OU_NUMERO = conjunto("total numero num n no nro");
/** Bilhetes premiados são só uma parte dos comprados: a coluna fica sem campo. */
const DO_PREMIO = conjunto(
  "premiado premiados premiada premiadas premio premios lucky sorteado sorteados",
);
const DE_VALOR = conjunto(
  "valor total preco price amount value montante quantia arrecadado receita r brl",
);
const DO_VALOR_PAGO = conjunto("total pago paga final");
/** Não é o valor pago (antes do desconto, unitário, líquido de taxas): só se não houver outro. */
const DE_VALOR_FRACO = conjunto(
  "subtotal preco price unitario bruto original liquido",
);
const DE_VALOR_IGNORADO = conjunto(
  "desconto descontos discount taxa taxas tarifa fee frete cupom coupon comissao juros",
);
const DO_PEDIDO = conjunto("pedido pedidos order compra venda");
/** Palavras de um nome que é só o código do pedido ("ID do pedido", "Nº da compra", "order_id"). */
const SO_CODIGO_DO_PEDIDO = conjunto(
  "pedido pedidos order compra venda id codigo cod code numero num nro n no nr number identificador identificacao ref referencia rifei do da de o a na em of",
);
const DA_TRANSACAO = conjunto("transacao transaction txid gateway");
const SO_IDENTIFICADOR = conjunto(
  "id codigo cod code identificador referencia ref",
);

interface Classificacao {
  campo: CampoReconciliacao | null;
  /** Preferência entre colunas do mesmo campo (a maior vence; 0 = a coluna fica sem campo). */
  pontos: number;
  pessoal: boolean;
}

const SEM_CAMPO: Classificacao = { campo: null, pontos: 0, pessoal: false };
const PESSOAL: Classificacao = { campo: null, pontos: 0, pessoal: true };

function palavrasDoNome(nome: string): Set<string> {
  return new Set(
    normalizarNomeDeColuna(nome)
      .split(/[^a-z0-9]+/)
      .filter((palavra) => palavra !== ""),
  );
}

/**
 * O campo que o nome da coluna indica. A ordem das regras importa: "Data do pedido" é data, e não código;
 * "Nome do afiliado" é afiliado, e não dado pessoal; "Total de bilhetes" é quantidade, e não valor.
 */
function classificarNome(palavras: ReadonlySet<string>): Classificacao {
  const tem = (alvo: ReadonlySet<string>) =>
    [...palavras].some((palavra) => alvo.has(palavra));
  const so = (alvo: ReadonlySet<string>) =>
    palavras.size > 0 && [...palavras].every((palavra) => alvo.has(palavra));

  if (tem(DO_AFILIADO)) {
    // Telefone, e-mail ou CPF do afiliado (ou "Cliente indicado") é dado pessoal: um telefone só com
    // dígitos passaria por affiliate_id e iria para a resposta e o banco. "Nome do afiliado" é o afiliado.
    const contato = [...palavras].some(
      (palavra) =>
        DE_DADO_PESSOAL.has(palavra) &&
        palavra !== "nome" &&
        palavra !== "name",
    );
    if (contato) return PESSOAL;
    return {
      campo: "afiliado",
      pontos: tem(DE_IDENTIFICADOR) ? 3 : 2,
      pessoal: false,
    };
  }
  if (
    palavras.has("status") ||
    palavras.has("situacao") ||
    (palavras.has("estado") && tem(DE_CONTEXTO_DO_STATUS))
  ) {
    return {
      campo: "status",
      pontos: tem(DE_CONTEXTO_DO_STATUS) ? 3 : 2,
      pessoal: false,
    };
  }
  if (tem(DE_DADO_PESSOAL)) return PESSOAL;
  if (
    tem(DE_DATA) ||
    (palavras.has("em") && tem(ANTES_DE_EM)) ||
    (palavras.has("at") && tem(ANTES_DE_AT))
  ) {
    if (tem(DE_DATA_IGNORADA)) return SEM_CAMPO;
    return { campo: "data", pontos: tem(DO_PAGAMENTO) ? 3 : 2, pessoal: false };
  }
  if (tem(DE_QUANTIDADE) || (tem(TOTAL_OU_NUMERO) && tem(DE_BILHETE))) {
    if (tem(DO_PREMIO)) return SEM_CAMPO;
    return {
      campo: "qtd_bilhetes",
      pontos: tem(DE_BILHETE) ? 3 : 2,
      pessoal: false,
    };
  }
  if (tem(DE_BILHETE)) {
    return tem(DO_PREMIO)
      ? SEM_CAMPO
      : { campo: "bilhetes", pontos: 2, pessoal: false };
  }
  if (tem(DE_VALOR) || tem(DE_VALOR_FRACO)) {
    if (tem(DE_VALOR_IGNORADO)) return SEM_CAMPO;
    return {
      campo: "valor",
      pontos: tem(DE_VALOR_FRACO) ? 1 : tem(DO_VALOR_PAGO) ? 3 : 2,
      pessoal: false,
    };
  }
  // Só um nome que é só o código ("Contato do pedido" e "Link do pedido" não são): fica sem campo.
  if (tem(DO_PEDIDO))
    return so(SO_CODIGO_DO_PEDIDO)
      ? { campo: "pedido_id", pontos: 3, pessoal: false }
      : SEM_CAMPO;
  if (tem(DA_TRANSACAO) && tem(DE_IDENTIFICADOR))
    return { campo: "pedido_id", pontos: 1, pessoal: false };
  if (so(SO_IDENTIFICADOR))
    return { campo: "pedido_id", pontos: 2, pessoal: false };
  return SEM_CAMPO;
}

/**
 * O nome, sozinho, indica dado pessoal (nome, e-mail, telefone do comprador; contato do afiliado...)?
 * O Worker usa isto para recusar um corpo com uma coluna dessas mapeada, mesmo que o navegador deixe.
 */
export function ehNomeDeColunaPessoal(nome: string): boolean {
  return classificarNome(palavrasDoNome(nome)).pessoal;
}

/** Mapeamento vazio: nenhum campo tem coluna. */
export function mapeamentoVazio(): MapeamentoReconciliacao {
  return {
    pedido_id: null,
    status: null,
    qtd_bilhetes: null,
    bilhetes: null,
    valor: null,
    afiliado: null,
    data: null,
  };
}

export interface DeteccaoColunas {
  colunas: ColunaArquivoReconciliacao[];
  /** Para cada campo, a coluna de maior preferência (no empate, a primeira). */
  mapeamento: MapeamentoReconciliacao;
  /** Colunas do cabeçalho além de LIMITE_COLUNAS_CSV_RECONCILIACAO (ignoradas). */
  colunasDemais: number;
}

/**
 * As colunas do cabeçalho (até LIMITE_COLUNAS_CSV_RECONCILIACAO): nome resumido, o campo que o nome
 * indica e se é dado pessoal; e o mapeamento detectado.
 */
export function detectarColunas(cabecalho: readonly string[]): DeteccaoColunas {
  const lidas = cabecalho.slice(0, LIMITE_COLUNAS_CSV_RECONCILIACAO);
  const palavras = lidas.map(palavrasDoNome);
  const temEndereco = palavras.some((doNome) =>
    [...doNome].some((palavra) => DO_ENDERECO.has(palavra)),
  );
  const classificacoes = palavras.map((doNome) => {
    // "Número" sozinho, num arquivo com endereço, é o número da casa do comprador.
    if (
      temEndereco &&
      doNome.size > 0 &&
      [...doNome].every((palavra) => SO_NUMERO.has(palavra))
    )
      return PESSOAL;
    return classificarNome(doNome);
  });

  const colunas = lidas.map((nome, indice): ColunaArquivoReconciliacao => ({
    indice,
    nome: resumirNomeDeColuna(nome) || `Coluna ${indice + 1}`,
    campo_detectado:
      classificacoes[indice].pontos > 0 ? classificacoes[indice].campo : null,
    dado_pessoal: classificacoes[indice].pessoal,
  }));

  const mapeamento = mapeamentoVazio();
  for (const campo of CAMPOS_RECONCILIACAO) {
    let melhor: number | null = null;
    for (const [indice, classificacao] of classificacoes.entries()) {
      if (classificacao.campo !== campo || classificacao.pontos === 0) continue;
      if (
        melhor === null ||
        classificacao.pontos > classificacoes[melhor].pontos
      )
        melhor = indice;
    }
    mapeamento[campo] = melhor;
  }
  return {
    colunas,
    mapeamento,
    colunasDemais: Math.max(
      0,
      cabecalho.length - LIMITE_COLUNAS_CSV_RECONCILIACAO,
    ),
  };
}

/** Problemas de um mapeamento escolhido na tela, com o campo em `caminho` (lista vazia = serve). */
export function conferirMapeamento(
  mapeamento: MapeamentoReconciliacao,
  colunas: readonly ColunaArquivoReconciliacao[],
): ProblemaDoCorpo[] {
  const problemas: ProblemaDoCorpo[] = [];
  const usadas = new Map<number, CampoReconciliacao>();
  for (const campo of CAMPOS_RECONCILIACAO) {
    const indice = mapeamento[campo];
    if (indice === null) continue;
    const caminho = ["mapeamento", campo];
    const coluna = colunas[indice];
    if (coluna === undefined) {
      problemas.push({
        caminho,
        codigo: "coluna_inexistente",
        mensagem: `O arquivo não tem a coluna ${indice + 1}`,
      });
      continue;
    }
    if (coluna.dado_pessoal) {
      problemas.push({
        caminho,
        codigo: "coluna_pessoal",
        mensagem: `A coluna "${coluna.nome}" tem dados pessoais e não pode ser usada`,
      });
      continue;
    }
    const outro = usadas.get(indice);
    if (outro !== undefined) {
      problemas.push({
        caminho,
        codigo: "coluna_repetida",
        mensagem: `A coluna "${coluna.nome}" já foi escolhida para outro campo (${outro})`,
      });
      continue;
    }
    usadas.set(indice, campo);
  }
  return problemas;
}

/** Um nome de cabeçalho que é, na verdade, um dado (a primeira linha não é o cabeçalho). */
const PARECE_DADO = [
  /@/,
  /^\+?[\d\s().-]{8,}$/,
  /^-?\d+(?:[.,]\d+)*$/,
  /^\d{1,2}[/.-]\d{1,2}[/.-]\d{2,4}/,
  /^\d{4}-\d{2}-\d{2}/,
  /^r\$\s*\d/i,
];

export function pareceDado(nome: string): boolean {
  const limpo = nome.trim();
  return limpo !== "" && PARECE_DADO.some((padrao) => padrao.test(limpo));
}
