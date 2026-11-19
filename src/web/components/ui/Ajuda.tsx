import {
  useEffect,
  useId,
  useLayoutEffect,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { ComDica } from "./Dica";
import { Icone } from "./Icone";
import "./Ajuda.css";

// Ajuda (RIFA-066, D31): a explicação de um título de seção, de um rótulo de campo, do título da tela, do rótulo de um
// número (Stat) e do cabeçalho de uma coluna. O PO passou o mouse em "Períodos" e nada apareceu: agora o próprio
// título (ou rótulo) mostra a explicação com o mouse parado, e o "?" ao lado dele mostra também no foco do teclado e
// no toque (o celular não tem mouse). Uso: <ComAjuda texto={AJUDA.periodos} idDoTitulo={id}><h3 id={id}>...</h3>
// </ComAjuda>; o Card, os campos, o PageHeader, o Stat e a DataTable já fazem isso com a prop `ajuda`.
//
// - É a mesma dica dos botões (`ComDica`, Dica.tsx), no modo `fixarNoBotao`: aparece com o mouse parado no título ou
//   no "?" (600 ms), na hora com o foco do teclado no "?", e o clique ou o toque no "?" abre e deixa fixa até outro
//   toque nele, um toque fora, Esc ou o foco sair. Uma por vez, Esc fecha só a dica, sempre dentro da tela.
// - Acessível: o "?" é um botão com o nome "Ajuda: <título>" (o aria-label sai do texto do título, com as partes só
//   para o leitor de tela; não é aria-labelledby, que faria o "?" passar por mais um campo com aquele rótulo) e,
//   aberta, a explicação (role="tooltip") no aria-describedby dele. O título e o rótulo não mudam de nome: o botão
//   fica ao lado deles, fora do <h2> e do <label>.
// - `texto` vazio: o título fica como está, sem o "?". `semBotao`: só o mouse no título (o telão, que não tem
//   controles).
// - Textos de telas que carregam junto com o site (as que não são `lazy`) vêm sob demanda (`ajudasSobDemanda`), num
//   pedaço à parte que chega logo depois da tela: o JS inicial não leva os textos. Enquanto chega, "Carregando…".

/** Uma explicação que chega depois, num pedaço à parte (veja `ajudasSobDemanda`). */
export type AjudaSobDemanda = { readonly carregar: () => Promise<ReactNode> };
/** O texto de uma ajuda: pronto (das telas `lazy`, que já estão no pedaço delas) ou sob demanda. */
export type TextoDeAjuda = ReactNode | AjudaSobDemanda;

/** O que a ajuda mostra enquanto o texto sob demanda não chegou. */
export const CARREGANDO_A_AJUDA = "Carregando a explicação…";
const AJUDA_NAO_CHEGOU = "Explicação indisponível agora.";

function ehSobDemanda(texto: TextoDeAjuda): texto is AjudaSobDemanda {
  return typeof texto === "object" && texto !== null && "carregar" in texto;
}

/**
 * Os textos de ajuda de uma tela, sob demanda: `const ajuda = ajudasSobDemanda(() => import("./ajuda"))` no topo do
 * arquivo e `ajuda={ajuda("periodos")}` no componente. O módulo exporta `AJUDA`; ele só carrega
 * quando a primeira ajuda da tela aparece, uma vez (se falhar, tenta de novo na próxima). Cada chave dá sempre o mesmo
 * objeto (o componente não carrega de novo a cada renderização).
 */
export function ajudasSobDemanda<T extends Record<string, ReactNode>>(
  carregar: () => Promise<{ AJUDA: T }>,
): (chave: keyof T & string) => AjudaSobDemanda {
  let textos: Promise<T> | undefined;
  const porChave = new Map<string, AjudaSobDemanda>();
  return (chave) => {
    let ajuda = porChave.get(chave);
    if (!ajuda) {
      ajuda = {
        carregar: () => {
          textos ??= carregar().then(
            (modulo) => modulo.AJUDA,
            (erro: unknown) => {
              textos = undefined;
              throw erro;
            },
          );
          return textos.then((lidos) => lidos[chave]);
        },
      };
      porChave.set(chave, ajuda);
    }
    return ajuda;
  };
}

/**
 * O texto pronto, ou o que chegou de um sob demanda (pede ao montar, logo depois de a tela aparecer). Cada título
 * tem sempre a mesma chave: não há troca de texto sob demanda a cuidar.
 */
export function useTextoDaAjuda(texto: TextoDeAjuda): ReactNode {
  const [lido, setLido] = useState<ReactNode>();
  useEffect(() => {
    if (ehSobDemanda(texto))
      texto.carregar().then(setLido, () => setLido(AJUDA_NAO_CHEGOU));
  }, [texto]);
  return ehSobDemanda(texto) ? (lido ?? CARREGANDO_A_AJUDA) : texto;
}

/** Há ajuda (texto não vazio)? */
export function temAjuda(texto: TextoDeAjuda | undefined): boolean {
  return (
    texto !== undefined && texto !== null && texto !== "" && texto !== false
  );
}

/**
 * O "?": um botão "Ajuda: <o texto do título>" (o nome sai do título, que pode mudar, como "Quem falta (3)", e ter
 * partes só para o leitor de tela), com a explicação (`id`) no aria-describedby quando aberta.
 */
export function BotaoDeAjuda({
  id,
  idDoTitulo,
}: {
  id: string;
  idDoTitulo: string;
}) {
  const ref = useRef<HTMLButtonElement>(null);
  useLayoutEffect(() => {
    const titulo = document.getElementById(idDoTitulo)?.textContent ?? "";
    ref.current?.setAttribute(
      "aria-label",
      `Ajuda: ${titulo.replace(/\s+/g, " ").trim()}`,
    );
  });
  return (
    <button
      ref={ref}
      type="button"
      className="ui-ajuda__botao"
      data-ajuda-botao=""
      aria-describedby={id}
    >
      <Icone nome="ajuda" />
    </button>
  );
}

type Props = {
  /** O que é, para que serve na campanha e, quando há algo a escolher, um exemplo (2 ou 3 frases curtas). */
  texto: TextoDeAjuda | undefined;
  /** Id do título ou do rótulo (o filho): o nome do botão é "Ajuda: " e o texto dele. */
  idDoTitulo: string;
  /** O título ou o rótulo (h1, h2, h3, a caixa de marcar com o texto, o rótulo do Stat, o texto da coluna). */
  children: ReactNode;
  /** Sem o "?": só o mouse no título abre (o telão, que não tem controles). */
  semBotao?: boolean;
  /**
   * Id da explicação, quando o controle de dentro do filho também a leva na descrição: a caixa de marcar dentro do
   * `<label>` (o mesmo id no `aria-describedby` dela, como no `ComDica`).
   */
  id?: string;
};

/** O título (ou rótulo) com a explicação ao passar o mouse e o "?" ao lado. Veja o comentário do topo. */
export function ComAjuda({
  texto,
  idDoTitulo,
  children,
  semBotao,
  id: idDeFora,
}: Props) {
  const idAutomatico = useId();
  const id = idDeFora ?? `${idAutomatico}ajuda`;
  const lido = useTextoDaAjuda(texto);
  if (!temAjuda(texto)) return children;
  return (
    <ComDica texto={lido} id={id} fixarNoBotao>
      <div className="ui-ajuda" data-ajuda={id}>
        {children}
        {!semBotao && <BotaoDeAjuda id={id} idDoTitulo={idDoTitulo} />}
      </div>
    </ComDica>
  );
}
