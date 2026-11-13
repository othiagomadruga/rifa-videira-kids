import type { ReactNode } from "react";

// A prévia do Bumbo como chega no WhatsApp (RIFA-051, P3.9): o *negrito* e o _itálico_ desenhados. Um analisador
// simples, que gera elementos do React (nunca HTML montado como texto), e o texto puro continua
// sendo o que se copia e o que vai para o wa.me (quem usa passa o texto da API, não o desenho).
//
// As regras são as do WhatsApp, no que a mensagem do Bumbo usa: a marca abre colada no texto (o caractere seguinte não
// é espaço) e fora de uma palavra (o anterior não é letra nem número); fecha colada no texto e fora de uma palavra; não
// atravessa a quebra de linha. Marca sem par (o "*" de "2 * 3", o "_" de "nome_da_celula") fica como veio. Dentro de
// um negrito pode haver itálico e vice-versa (um nível de cada).

export type Marca = "*" | "_";

export type Trecho =
  | { tipo: "texto"; texto: string }
  | { tipo: "negrito" | "italico"; marca: Marca; filhos: Trecho[] };

const TIPO_DA_MARCA = { "*": "negrito", _: "italico" } as const;
const MARCAS: readonly Marca[] = ["*", "_"];

const ehLetraOuNumero = (caractere: string | undefined) =>
  caractere !== undefined && /[\p{L}\p{N}]/u.test(caractere);
const ehEspacoOuFim = (caractere: string | undefined) =>
  caractere === undefined || /\s/.test(caractere);
const ehMarca = (
  caractere: string | undefined,
  marcas: readonly Marca[],
): caractere is Marca => marcas.some((marca) => marca === caractere);

/** Junta o texto ao último trecho, se ele também for texto (a saída fica sem trechos de texto vizinhos). */
function acrescentarTexto(trechos: Trecho[], texto: string) {
  if (texto === "") return;
  const ultimo = trechos.at(-1);
  if (ultimo?.tipo === "texto") ultimo.texto += texto;
  else trechos.push({ tipo: "texto", texto });
}

/** Onde a marca aberta em `inicio` fecha na linha, ou -1 (sem par). Precisa de ao menos um caractere dentro. */
function fechamento(linha: string, inicio: number, marca: Marca): number {
  for (let fim = inicio + 2; fim < linha.length; fim++) {
    if (
      linha[fim] === marca &&
      !ehEspacoOuFim(linha[fim - 1]) &&
      !ehLetraOuNumero(linha[fim + 1])
    )
      return fim;
  }
  return -1;
}

function analisarLinha(linha: string, marcas: readonly Marca[]): Trecho[] {
  const trechos: Trecho[] = [];
  let pendente = "";
  let posicao = 0;
  while (posicao < linha.length) {
    const caractere = linha[posicao];
    if (
      ehMarca(caractere, marcas) &&
      !ehLetraOuNumero(linha[posicao - 1]) &&
      !ehEspacoOuFim(linha[posicao + 1]) &&
      linha[posicao + 1] !== caractere
    ) {
      const fim = fechamento(linha, posicao, caractere);
      if (fim !== -1) {
        acrescentarTexto(trechos, pendente);
        pendente = "";
        trechos.push({
          tipo: TIPO_DA_MARCA[caractere],
          marca: caractere,
          filhos: analisarLinha(
            linha.slice(posicao + 1, fim),
            marcas.filter((outra) => outra !== caractere),
          ),
        });
        posicao = fim + 1;
        continue;
      }
    }
    pendente += caractere;
    posicao += 1;
  }
  acrescentarTexto(trechos, pendente);
  return trechos;
}

/** O texto da mensagem em trechos: texto, negrito e itálico (as quebras de linha ficam no texto). */
export function analisarWhatsApp(texto: string): Trecho[] {
  const trechos: Trecho[] = [];
  texto.split("\n").forEach((linha, indice) => {
    if (indice > 0) acrescentarTexto(trechos, "\n");
    for (const trecho of analisarLinha(linha, MARCAS)) {
      if (trecho.tipo === "texto") acrescentarTexto(trechos, trecho.texto);
      else trechos.push(trecho);
    }
  });
  return trechos;
}

function desenhar(trechos: readonly Trecho[], prefixo: string): ReactNode[] {
  return trechos.map((trecho, indice) => {
    if (trecho.tipo === "texto") return trecho.texto;
    const chave = `${prefixo}${indice}`;
    // A marca continua no texto (o textContent é o texto da API, caractere por caractere), escondida da vista e do
    // leitor de tela (bumbo.css): o WhatsApp também não a mostra.
    const marca = (
      <span className="bumbo__marca" aria-hidden="true">
        {trecho.marca}
      </span>
    );
    const filhos = desenhar(trecho.filhos, `${chave}-`);
    return trecho.tipo === "negrito" ? (
      <strong key={chave}>
        {marca}
        {filhos}
        {marca}
      </strong>
    ) : (
      <em key={chave}>
        {marca}
        {filhos}
        {marca}
      </em>
    );
  });
}

/** A mensagem com o negrito e o itálico do WhatsApp desenhados (o textContent continua igual ao texto). */
export function TextoDoWhatsApp({ texto }: { texto: string }) {
  return <>{desenhar(analisarWhatsApp(texto), "")}</>;
}
