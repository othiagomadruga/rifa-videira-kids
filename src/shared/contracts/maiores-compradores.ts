/**
 * Maiores compradores (RIFA-083, D38): o ranking de quem mais comprou, para o admin (GET /api/admin/maiores-compradores,
 * com telefone e R$) e para o discipulador (GET /api/minha/maiores-compradores, só das células dele, sem telefone e sem
 * R$, D12). Regras puras, sem zod, para o Worker e os testes; os schemas e o catálogo (ROTAS_MAIORES_COMPRADORES)
 * ficam em api.ts.
 *
 * Uma regra só para as duas rotas (`classificarMaioresCompradores`):
 * - conta só pedido aprovado, da campanha ativa, sem desconsideração (D20), com o dia local de `aprovado_em` dentro da
 *   janela pedida (R6, como o ranking; a leitura do banco filtra, esta função recebe só o que conta);
 * - junta por comprador como a D36: pelo telefone; sem telefone, pelo nome normalizado (`chaveDoNome`); sem os dois,
 *   o pedido fica de fora. O nome é o do pedido aprovado mais recente que tem nome;
 * - ordena por bilhetes (desc), total pago (desc) e a primeira compra da janela (a mais antiga primeiro: quem chegou
 *   primeiro); empate perfeito nos três = a mesma posição (1, 1, 3), e entre eles a ordem do nome em português;
 * - devolve no máximo `limite` (1 a 50, padrão 10).
 */
// Só os tipos (apagados na compilação): api.ts importa os limites daqui, e este import não cria ciclo.
import type { ItemMaiorComprador, ItemMeuMaiorComprador } from "./api";
import { chaveDoNome, formatarTelefoneBr, numeroWhatsApp } from "./compradores";

/** Quantos a rota devolve sem `limite`. */
export const LIMITE_MAIORES_COMPRADORES_PADRAO = 10;
/** O maior `limite` aceito na consulta. */
export const LIMITE_MAIORES_COMPRADORES_MAXIMO = 50;

/** Um pedido que conta (aprovado, da janela, sem desconsideração), como a leitura do banco o entrega. */
export interface PedidoDoMaiorComprador {
  nome: string | null;
  /** E.164 (ex.: "+5591988887777"), como gravado pela D36. */
  telefone: string | null;
  qtd_bilhetes: number;
  total_centavos: number;
  /** A célula do afiliado do pedido; null = sem afiliado ou afiliado não vinculado. */
  celula_nome: string | null;
  /** Instante ISO UTC da aprovação. */
  aprovado_em: string;
}

/** Um comprador no ranking (com tudo: cada rota escolhe o que mostra). */
export interface MaiorComprador {
  /** Empate perfeito (bilhetes, total e primeira compra) divide a posição: 1, 1, 3. */
  posicao: number;
  /** O nome do pedido mais recente que tem nome; null quando nenhum pedido dele tem nome. */
  nome: string | null;
  /** E.164; null quando o comprador foi juntado pelo nome. */
  telefone: string | null;
  bilhetes: number;
  total_centavos: number;
  pedidos: number;
  /** As células dos pedidos dele (sem repetir), em ordem de português. */
  celulas: string[];
  /** Algum pedido dele sem célula (sem afiliado ou afiliado não vinculado). */
  sem_celula: boolean;
  /** A célula com mais bilhetes dele (empate: a primeira em português); null se nenhum pedido tem célula. */
  celula_principal: string | null;
  /** A primeira compra (aprovação) dele na janela, instante ISO UTC. */
  primeira: string;
}

const COMPARAR_PT = new Intl.Collator("pt-BR", { sensitivity: "base" });

/** A chave do comprador (a da D36): o telefone; sem ele, o nome normalizado; sem os dois, null (fica de fora). */
export function chaveDoComprador(
  pedido: Pick<PedidoDoMaiorComprador, "nome" | "telefone">,
): string | null {
  if (pedido.telefone !== null) return `t:${pedido.telefone}`;
  if (pedido.nome === null) return null;
  const nome = chaveDoNome(pedido.nome);
  return nome === "" ? null : `n:${nome}`;
}

type Grupo = Omit<
  MaiorComprador,
  "posicao" | "celulas" | "celula_principal"
> & {
  chave: string;
  nomeEm: string;
  porCelula: Map<string, number>;
};

/** A célula com mais bilhetes; empate, a primeira em português. */
function celulaPrincipal(
  porCelula: ReadonlyMap<string, number>,
): string | null {
  let melhor: [string, number] | null = null;
  for (const [celula, bilhetes] of porCelula) {
    if (
      melhor === null ||
      bilhetes > melhor[1] ||
      (bilhetes === melhor[1] && COMPARAR_PT.compare(celula, melhor[0]) < 0)
    )
      melhor = [celula, bilhetes];
  }
  return melhor === null ? null : melhor[0];
}

/** Os mesmos bilhetes, o mesmo total e a mesma primeira compra: a mesma posição. */
function empatePerfeito(
  a: Pick<MaiorComprador, "bilhetes" | "total_centavos" | "primeira">,
  b: Pick<MaiorComprador, "bilhetes" | "total_centavos" | "primeira">,
): boolean {
  return (
    a.bilhetes === b.bilhetes &&
    a.total_centavos === b.total_centavos &&
    a.primeira === b.primeira
  );
}

/**
 * O ranking dos maiores compradores dos `pedidos` (só os que contam: a leitura já filtrou status, campanha, janela,
 * desconsideração e, na rota do discipulador, as células dele). No máximo `limite` itens, já com a posição.
 */
export function classificarMaioresCompradores(
  pedidos: readonly PedidoDoMaiorComprador[],
  limite: number = LIMITE_MAIORES_COMPRADORES_PADRAO,
): MaiorComprador[] {
  const grupos = new Map<string, Grupo>();
  for (const pedido of pedidos) {
    const chave = chaveDoComprador(pedido);
    if (chave === null) continue;
    let grupo = grupos.get(chave);
    if (!grupo) {
      grupo = {
        chave,
        nome: null,
        nomeEm: "",
        telefone: pedido.telefone,
        bilhetes: 0,
        total_centavos: 0,
        pedidos: 0,
        sem_celula: false,
        primeira: pedido.aprovado_em,
        porCelula: new Map(),
      };
      grupos.set(chave, grupo);
    }
    if (pedido.nome !== null && pedido.aprovado_em >= grupo.nomeEm) {
      grupo.nome = pedido.nome;
      grupo.nomeEm = pedido.aprovado_em;
    }
    grupo.bilhetes += pedido.qtd_bilhetes;
    grupo.total_centavos += pedido.total_centavos;
    grupo.pedidos += 1;
    if (pedido.aprovado_em < grupo.primeira)
      grupo.primeira = pedido.aprovado_em;
    if (pedido.celula_nome === null) grupo.sem_celula = true;
    else
      grupo.porCelula.set(
        pedido.celula_nome,
        (grupo.porCelula.get(pedido.celula_nome) ?? 0) + pedido.qtd_bilhetes,
      );
  }

  const ordenados = [...grupos.values()].sort(
    (a, b) =>
      b.bilhetes - a.bilhetes ||
      b.total_centavos - a.total_centavos ||
      (a.primeira < b.primeira ? -1 : a.primeira > b.primeira ? 1 : 0) ||
      COMPARAR_PT.compare(a.nome ?? "", b.nome ?? "") ||
      (a.chave < b.chave ? -1 : a.chave > b.chave ? 1 : 0),
  );

  const itens: MaiorComprador[] = [];
  for (const [indice, grupo] of ordenados.entries()) {
    if (indice >= limite) break;
    const anterior = itens[indice - 1];
    itens.push({
      posicao:
        anterior !== undefined && empatePerfeito(anterior, grupo)
          ? anterior.posicao
          : indice + 1,
      nome: grupo.nome,
      telefone: grupo.telefone,
      bilhetes: grupo.bilhetes,
      total_centavos: grupo.total_centavos,
      pedidos: grupo.pedidos,
      celulas: [...grupo.porCelula.keys()].sort(COMPARAR_PT.compare),
      sem_celula: grupo.sem_celula,
      celula_principal: celulaPrincipal(grupo.porCelula),
      primeira: grupo.primeira,
    });
  }
  return itens;
}

/** O item do admin (D36: telefone e R$ só para ele): o telefone legível, como no CSV, e o número do WhatsApp. */
export function itemMaiorCompradorAdmin(
  comprador: MaiorComprador,
): ItemMaiorComprador {
  return {
    posicao: comprador.posicao,
    nome: comprador.nome,
    telefone:
      comprador.telefone === null
        ? null
        : formatarTelefoneBr(comprador.telefone),
    whatsapp: numeroWhatsApp(comprador.telefone),
    bilhetes: comprador.bilhetes,
    total_centavos: comprador.total_centavos,
    pedidos: comprador.pedidos,
    celulas: comprador.celulas,
    sem_celula: comprador.sem_celula,
  };
}

/** O item do discipulador (D12 e D38): o nome, os bilhetes e a célula (a dele com mais bilhetes); sem telefone e sem R$. */
export function itemMeuMaiorComprador(
  comprador: MaiorComprador,
): ItemMeuMaiorComprador {
  return {
    posicao: comprador.posicao,
    nome: comprador.nome,
    bilhetes: comprador.bilhetes,
    celula: comprador.celula_principal,
  };
}
