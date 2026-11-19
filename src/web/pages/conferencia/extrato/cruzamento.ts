// O cruzamento do extrato com os pedidos (RIFA-059, D26), NO NAVEGADOR: cada Pix recebido com no máximo um pedido, e
// cada pedido com no máximo um Pix. Os graus:
// - "Certo": a descrição ou o FITID do Pix trazem o número de um pedido (no Pix manual da Rifei, o identificador da
//   transação é o número do pedido). O pedaço só de algarismos precisa de 8 ou mais: o extrato tem números do banco
//   (o documento, a agência e a conta, a data) que bateriam por acaso com um número de pedido curto;
// - "Provável": sem o número, só um pedido serve: o mesmo valor, reservado antes do Pix e dentro da janela (padrão
//   24 h); o pedido já pago só serve se foi pago depois do Pix (quem marca na Rifei marca depois de ver o Pix);
// - "Ambíguo": mais de um pedido serve; a pessoa escolhe olhando a Rifei;
// - "Pix sem pedido": nenhum pedido serve (Pix fora da campanha, valor errado, Pix em dobro).
// O pedido casado que já está pago no sistema é "já contado"; o pendente ou expirado vai para a lista de marcar na Rifei.
//
// O algoritmo (guloso e estável):
// 1. A ordem: os Pix do mais antigo ao mais novo (no empate, a ordem no extrato); os pedidos pela reserva (no empate,
//    pelo número).
// 2. Os Certos primeiro: cada Pix, na ordem, fica com o pedido do número que ele traz. O número de um pedido que já
//    ficou com um Pix anterior deixa o Pix sem pedido (Pix em dobro?).
// 3. Depois, pelo valor, em voltas até nada mudar: cada Pix ainda sem par, do mais antigo ao mais novo, olha os pedidos
//    livres que servem; se só um serve, fica com ele (Provável). Assim, quando dois Pix disputam o mesmo e único pedido,
//    o mais antigo fica com ele; e um Pix que tinha dois candidatos vira Provável quando o outro candidato fica com um
//    Pix que só tinha ele.
// 4. O que sobra: com 2 ou mais pedidos livres que servem, Ambíguo (se todos já estão pagos, não há o que marcar: vai
//    para "já contados"); com nenhum, Pix sem pedido.
// O desconsiderado pelo admin (D20) nunca serve: o número dele no Pix deixa o Pix sem pedido, com o motivo.
//
// RIFA-076 (D36), o nome: com o nome de quem fez o pedido (só o admin o recebe) e o "REM: <nome>" no Pix
// (nome-do-pix.ts), o passo 3 desempata: quando nenhum Pix tem um pedido só, o Pix com 2 ou mais candidatos cujo REM
// confere com o nome de exatamente um deles fica com ele (Provável), e as voltas recomeçam. Todo casamento leva
// `nome` ("confere", "difere" ou null), para a tela mostrar e o admin conferir antes de marcar.
import type { Pix } from "./lancamentos";
import { comparacaoDoNome } from "./nome-do-pix";

export type StatusDoPedido = "in_process" | "approved" | "expired";

/** O que o cruzamento usa de cada pedido (da lista de pedidos da campanha ativa). */
export interface PedidoDoCruzamento {
  id: string;
  status: StatusDoPedido;
  qtd_bilhetes: number;
  total_centavos: number;
  celula_nome: string | null;
  /** Quando foi reservado (o criado_em da Rifei; sem ele, quando chegou ao sistema), em ms. */
  reserva: number;
  aprovado_em: number | null;
  desconsiderado: boolean;
  /** RIFA-076 (D36): o nome de quem fez o pedido (só para o admin; ausente ou null para os outros). */
  comprador_nome?: string | null;
}

export type Grau = "certo" | "provavel";

/** Folga para a diferença entre o relógio do banco e o da Rifei. */
export const FOLGA_DO_RELOGIO_MS = 5 * 60_000;
/** Os números de pedido mais curtos que isto não contam como "Certo" (seriam achados por acaso no texto). */
export const MINIMO_CARACTERES_DO_NUMERO = 4;
/**
 * O pedaço só de algarismos precisa de mais: o documento do banco (7 algarismos no Bradesco), a agência, a conta e a
 * data aparecem em todo lançamento e bateriam por acaso com um número de pedido curto, e o "Certo" não confere o valor
 * nem a hora. Com o número da Rifei curto e só de algarismos, o Pix cai no "Provável" (pelo valor e pela hora).
 */
export const MINIMO_ALGARISMOS_DO_NUMERO = 8;

export interface Casamento {
  pix: Pix;
  pedido: PedidoDoCruzamento;
  grau: Grau;
  /** Só no Certo: o valor do Pix é outro que o do pedido (pago a menos ou a mais). */
  valorDiferente: boolean;
  /**
   * RIFA-076 (D36): o "REM:" do Pix diante do nome do pedido: "confere", "difere" ou null (sem REM ou sem nome).
   * Ponto para a tela (RIFA-070/074): mostrar `pedido.comprador_nome` e este selo ao lado do número do pedido.
   */
  nome: "confere" | "difere" | null;
}

export interface PixAmbiguo {
  pix: Pix;
  /** Os pedidos livres que servem, do reservado mais cedo ao mais tarde. */
  candidatos: PedidoDoCruzamento[];
}

export type MotivoSemPedido =
  /** Nenhum pedido com este valor na janela. */
  | "nenhum"
  /** Os pedidos que serviam ficaram com outros Pix do extrato. */
  | "ja_casados"
  /** O número do pedido no Pix é de um pedido que ficou com outro Pix (Certo). */
  | "pedido_repetido"
  /** O número do pedido no Pix é de um pedido desconsiderado pelo admin. */
  | "desconsiderado";

export interface PixSemPedido {
  pix: Pix;
  motivo: MotivoSemPedido;
  /** Os pedidos do motivo (o repetido, o desconsiderado ou os que ficaram com outros Pix). */
  pedidos: string[];
}

export interface JaContado {
  pix: Pix;
  /** Um pedido (Certo ou Provável) ou, sem grau, um destes pedidos já pagos (todos os candidatos). */
  pedidos: PedidoDoCruzamento[];
  grau: Grau | null;
}

export interface ResultadoDoCruzamento {
  /** Os pendentes e expirados que o extrato confirma: para marcar como pagos na Rifei. */
  paraMarcar: Casamento[];
  ambiguos: PixAmbiguo[];
  semPedido: PixSemPedido[];
  jaContados: JaContado[];
}

/** O pedaço pode ser um número de pedido: 4 ou mais caracteres; só de algarismos, 8 ou mais. */
const podeSerNumero = (pedaco: string) =>
  pedaco.length >=
  (/^\d+$/.test(pedaco)
    ? MINIMO_ALGARISMOS_DO_NUMERO
    : MINIMO_CARACTERES_DO_NUMERO);

/** Os textos do Pix em pedaços que podem ser um número de pedido ("PIX-ABC123" dá "PIX-ABC123", "PIX" e "ABC123"). */
function pedacosDoPix(pix: Pix): string[] {
  const pedacos = new Set<string>();
  for (const texto of [pix.descricao, ...pix.identificadores])
    for (const palavra of texto.split(/[\s,;|()[\]{}<>"'*·]+/)) {
      const limpa = palavra.replace(/^[.:/#_-]+|[.:/#_-]+$/g, "");
      if (podeSerNumero(limpa)) pedacos.add(limpa.toUpperCase());
      for (const parte of limpa.split(/[.:/#_-]+/))
        if (podeSerNumero(parte)) pedacos.add(parte.toUpperCase());
    }
  return [...pedacos];
}

const porReserva = (a: PedidoDoCruzamento, b: PedidoDoCruzamento) =>
  a.reserva - b.reserva || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0);

/** O pedido serve para o Pix pelo valor e pela hora? */
export function serve(
  pix: Pix,
  pedido: PedidoDoCruzamento,
  janelaMs: number,
): boolean {
  if (pedido.desconsiderado || pedido.total_centavos !== pix.centavos)
    return false;
  // O Pix vem depois da reserva, dentro da janela (o Pix sem hora pode ser de qualquer hora do dia).
  if (pix.fim < pedido.reserva - FOLGA_DO_RELOGIO_MS) return false;
  if (pix.inicio > pedido.reserva + janelaMs) return false;
  // O pedido já pago foi pago por um Pix que chegou antes da aprovação.
  if (
    pedido.status === "approved" &&
    pedido.aprovado_em !== null &&
    pix.inicio > pedido.aprovado_em + FOLGA_DO_RELOGIO_MS
  )
    return false;
  return true;
}

export function cruzar(
  pixDoExtrato: readonly Pix[],
  pedidos: readonly PedidoDoCruzamento[],
  opcoes: { janelaMs: number },
): ResultadoDoCruzamento {
  const ordem = [...pixDoExtrato].sort(
    (a, b) => a.inicio - b.inicio || a.ordem - b.ordem,
  );
  const porNumero = new Map<string, PedidoDoCruzamento>();
  for (const pedido of pedidos) porNumero.set(pedido.id.toUpperCase(), pedido);
  const porValor = new Map<number, PedidoDoCruzamento[]>();
  for (const pedido of [...pedidos].sort(porReserva)) {
    const lista = porValor.get(pedido.total_centavos) ?? [];
    lista.push(pedido);
    porValor.set(pedido.total_centavos, lista);
  }
  /** pedido → o Pix que ficou com ele. */
  const casados = new Map<string, Pix>();
  const casamentos = new Map<
    string,
    { pedido: PedidoDoCruzamento; grau: Grau }
  >();
  const semPedido = new Map<string, PixSemPedido>();

  // 2. Os Certos.
  for (const pix of ordem) {
    const achados = pedacosDoPix(pix)
      .map((pedaco) => porNumero.get(pedaco))
      .filter((pedido) => pedido !== undefined);
    if (achados.length === 0) continue;
    const livre = achados.find(
      (pedido) => !pedido.desconsiderado && !casados.has(pedido.id),
    );
    if (livre) {
      casados.set(livre.id, pix);
      casamentos.set(pix.chave, { pedido: livre, grau: "certo" });
      continue;
    }
    const desconsiderado = achados.find((pedido) => pedido.desconsiderado);
    semPedido.set(pix.chave, {
      pix,
      motivo: desconsiderado ? "desconsiderado" : "pedido_repetido",
      pedidos: [(desconsiderado ?? achados[0]).id],
    });
  }

  // 3. Pelo valor, em voltas, enquanto algum Pix tem um pedido só.
  const livresQueServem = (pix: Pix) =>
    (porValor.get(pix.centavos) ?? []).filter(
      (pedido) =>
        !casados.has(pedido.id) && serve(pix, pedido, opcoes.janelaMs),
    );
  let pendentes = ordem.filter(
    (pix) => !casamentos.has(pix.chave) && !semPedido.has(pix.chave),
  );
  let mudou = true;
  while (mudou) {
    mudou = false;
    for (const pix of pendentes) {
      const candidatos = livresQueServem(pix);
      if (candidatos.length !== 1) continue;
      casados.set(candidatos[0].id, pix);
      casamentos.set(pix.chave, { pedido: candidatos[0], grau: "provavel" });
      mudou = true;
    }
    pendentes = pendentes.filter((pix) => !casamentos.has(pix.chave));
    if (mudou) continue;
    // RIFA-076 (D36): ninguém tem um pedido só; o nome desempata um Pix (o mais antigo) e as voltas recomeçam.
    for (const pix of pendentes) {
      const peloNome = livresQueServem(pix).filter(
        (pedido) =>
          comparacaoDoNome(pix.descricao, pedido.comprador_nome) === "confere",
      );
      if (peloNome.length !== 1) continue;
      casados.set(peloNome[0].id, pix);
      casamentos.set(pix.chave, { pedido: peloNome[0], grau: "provavel" });
      pendentes = pendentes.filter((outro) => outro !== pix);
      mudou = true;
      break;
    }
  }

  // 4. O que sobra.
  const resultado: ResultadoDoCruzamento = {
    paraMarcar: [],
    ambiguos: [],
    semPedido: [],
    jaContados: [],
  };
  for (const pix of ordem) {
    const casamento = casamentos.get(pix.chave);
    if (casamento) {
      const { pedido, grau } = casamento;
      if (pedido.status === "approved")
        resultado.jaContados.push({ pix, pedidos: [pedido], grau });
      else
        resultado.paraMarcar.push({
          pix,
          pedido,
          grau,
          valorDiferente: pedido.total_centavos !== pix.centavos,
          nome: comparacaoDoNome(pix.descricao, pedido.comprador_nome),
        });
      continue;
    }
    const sem = semPedido.get(pix.chave);
    if (sem) {
      resultado.semPedido.push(sem);
      continue;
    }
    const candidatos = livresQueServem(pix);
    if (candidatos.length >= 2) {
      if (candidatos.every((pedido) => pedido.status === "approved"))
        resultado.jaContados.push({ pix, pedidos: candidatos, grau: null });
      else resultado.ambiguos.push({ pix, candidatos });
      continue;
    }
    const tomados = (porValor.get(pix.centavos) ?? []).filter(
      (pedido) =>
        casados.has(pedido.id) &&
        casados.get(pedido.id) !== pix &&
        serve(pix, pedido, opcoes.janelaMs),
    );
    resultado.semPedido.push({
      pix,
      motivo: tomados.length > 0 ? "ja_casados" : "nenhum",
      pedidos: tomados.map((pedido) => pedido.id),
    });
  }
  return resultado;
}

/** Os números dos pedidos para marcar na Rifei, um por linha, na ordem dos Pix. */
export function numerosParaCopiar(resultado: ResultadoDoCruzamento): string {
  return resultado.paraMarcar
    .map((casamento) => casamento.pedido.id)
    .join("\n");
}
