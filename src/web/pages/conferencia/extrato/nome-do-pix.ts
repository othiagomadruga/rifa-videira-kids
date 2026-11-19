// RIFA-076 (D36): o nome de quem mandou o Pix (o "REM: <nome>" do Bradesco na descrição) comparado com o nome de quem
// fez o pedido na Rifei (o `comprador.nome` da lista de pedidos, que a API manda só ao admin). Tudo no navegador.
//
// Comparação tolerante ao que o banco faz com o nome (corta, abrevia, tira acento, põe em maiúsculas):
// - os dois em maiúsculas, sem acento, só com as palavras de letras (números e datas do extrato saem), sem as
//   partículas DE, DA, DO, DOS, DAS e E;
// - o primeiro nome tem de ser igual;
// - cada outra palavra do REM tem de bater com uma palavra do nome do pedido, inteira ou como começo (o banco corta
//   "SILVA" em "SILV" ou abrevia em "S").
// Com só o primeiro nome no REM, basta ele (é o que o banco mostrou).

const PARTICULAS = new Set(["DE", "DA", "DO", "DOS", "DAS", "E"]);

/** As palavras de um nome, normalizadas. */
export function palavrasDoNome(texto: string): string[] {
  return texto
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toUpperCase()
    .split(/[^A-Z0-9]+/)
    .filter(
      (palavra) =>
        palavra !== "" && !/\d/.test(palavra) && !PARTICULAS.has(palavra),
    );
}

/** O nome depois do "REM:" na descrição do Pix (null sem o REM, ou sem nenhuma palavra de letras depois dele). */
export function remetenteDoPix(descricao: string): string[] | null {
  const achado = /\bREM\s*:\s*(.+)$/i.exec(descricao);
  if (!achado) return null;
  const palavras = palavrasDoNome(achado[1]);
  return palavras.length === 0 ? null : palavras;
}

/** O REM confere com o nome do pedido? */
export function nomesConferem(
  remetente: readonly string[],
  nomeDoPedido: string,
): boolean {
  const pedido = palavrasDoNome(nomeDoPedido);
  if (pedido.length === 0 || remetente[0] !== pedido[0]) return false;
  return remetente
    .slice(1)
    .every((parte) =>
      pedido.slice(1).some((palavra) => palavra.startsWith(parte)),
    );
}

/**
 * Como o nome do Pix fica diante do pedido: "confere", "difere" ou null (sem REM no Pix ou sem nome no pedido, o que
 * acontece com a coordenação e com os pedidos de antes da RIFA-076).
 */
export function comparacaoDoNome(
  descricao: string,
  nomeDoPedido: string | null | undefined,
): "confere" | "difere" | null {
  if (!nomeDoPedido) return null;
  const remetente = remetenteDoPix(descricao);
  if (remetente === null) return null;
  return nomesConferem(remetente, nomeDoPedido) ? "confere" : "difere";
}
