import { useCallback, useEffect, useRef, useState } from "react";

/** Uma página de uma lista com cursor: `proximo` null = não há mais. */
export type Pagina<Item, Cursor> = { itens: Item[]; proximo: Cursor | null };

/** Como carregar e mostrar uma lista por páginas. Use uma constante do módulo (o objeto não pode mudar). */
export type ConfigPaginas<Item, Cursor, P extends Pagina<Item, Cursor>> = {
  carregar: (
    consulta: string,
    cursor: Cursor | null,
    signal: AbortSignal,
  ) => Promise<P>;
  /** Identifica o item: um item repetido entre páginas não entra duas vezes. */
  idDoItem: (item: Item) => string | number;
  /** O id do elemento que recebe o foco quando o item chega com "Carregar mais". */
  idDoFoco: (item: Item) => string;
  /** O id do elemento que recebe o foco se a página seguinte vier vazia (o botão some). */
  idDoFim: string;
  /** O anúncio do que o "Carregar mais" trouxe. */
  anunciarMais: (novos: number, fim: boolean) => string;
  /** O anúncio da primeira página depois de trocar o filtro (na carga inicial, nada). */
  anunciarPrimeira: (pagina: P) => string;
  /** A falha do "Carregar mais" diz que o cursor não vale mais: a lista recomeça da primeira página. */
  cursorInvalido: (erro: unknown) => boolean;
};

export type EstadoPaginas<Item, Cursor, P> =
  | { tipo: "carregando" }
  | { tipo: "erro"; erro: unknown }
  | {
      tipo: "ok";
      /** A primeira página como veio (os totais, quando a rota manda, só vêm nela). */
      primeira: P;
      itens: Item[];
      proximo: Cursor | null;
      /** Índice do primeiro item da última página que chegou com "Carregar mais" (eles entram com movimento). */
      inicioDaUltima: number | null;
    };

type ComConsulta<T> = T & { consulta: string };

/**
 * Lista por páginas com cursor, como a Trilha: a primeira página carrega ao abrir e de novo quando a consulta
 * (os filtros, em texto) muda; "Carregar mais" pede a seguinte com o `proximo` da anterior, acrescenta no fim sem
 * repetir nenhum item, leva o foco ao primeiro item novo e anuncia numa região viva (`anuncio`). Trocar a
 * consulta cancela o que estiver em andamento; ao sair da tela, também. Nada se recarrega sozinho (a primeira
 * página dos pedidos é cara, por causa dos totais): só ao abrir, ao trocar o filtro, no "Tentar de novo" e quando
 * o cursor não vale mais (aí a lista recomeça da primeira página).
 */
export function usePaginas<Item, Cursor, P extends Pagina<Item, Cursor>>(
  consulta: string,
  config: ConfigPaginas<Item, Cursor, P>,
) {
  const [estado, setEstado] = useState<
    ComConsulta<EstadoPaginas<Item, Cursor, P>>
  >({ consulta, tipo: "carregando" });
  const [mais, setMais] = useState<
    ComConsulta<{ carregando: boolean; erro: unknown }>
  >({ consulta, carregando: false, erro: null });
  const [tentativa, setTentativa] = useState(0);
  const [anuncio, setAnuncio] = useState("");
  // Trava síncrona do "Carregar mais" (dois toques rápidos pedem a mesma página uma vez só).
  const carregandoMais = useRef(false);
  const controleMais = useRef<AbortController | null>(null);
  // Elemento que recebe o foco quando a página nova aparecer na tela.
  const focoPendente = useRef<string | null>(null);
  // A primeira carga da tela não é anunciada; as cargas depois de trocar o filtro, sim.
  const jaCarregou = useRef(false);
  // A lista recomeçou da primeira página porque o cursor não valia mais (o foco vai para o primeiro item).
  const recomecou = useRef(false);

  useEffect(() => {
    // A consulta mudou: o "Carregar mais" da anterior não vale mais.
    controleMais.current?.abort();
    controleMais.current = null;
    carregandoMais.current = false;
    const controle = new AbortController();
    config.carregar(consulta, null, controle.signal).then(
      (pagina) => {
        if (controle.signal.aborted) return;
        setEstado({
          consulta,
          tipo: "ok",
          primeira: pagina,
          itens: pagina.itens,
          proximo: pagina.proximo,
          inicioDaUltima: null,
        });
        if (recomecou.current) {
          recomecou.current = false;
          focoPendente.current =
            pagina.itens.length > 0
              ? config.idDoFoco(pagina.itens[0])
              : config.idDoFim;
          setAnuncio(
            "A lista recomeçou do início: o ponto da página seguinte não valia mais.",
          );
        } else if (jaCarregou.current) {
          setAnuncio(config.anunciarPrimeira(pagina));
        }
        jaCarregou.current = true;
      },
      (erro: unknown) => {
        if (!controle.signal.aborted)
          setEstado({ consulta, tipo: "erro", erro });
      },
    );
    return () => controle.abort();
  }, [consulta, tentativa, config]);

  // Ao sair da tela, cancela o "Carregar mais" em andamento.
  useEffect(() => () => controleMais.current?.abort(), []);

  useEffect(() => {
    if (focoPendente.current === null) return;
    const alvo = document.getElementById(focoPendente.current);
    focoPendente.current = null;
    if (!alvo) return;
    // O item novo vai para o meio da tela (o foco sozinho o deixaria colado na borda de baixo). O jsdom não tem
    // scrollIntoView.
    alvo.focus({ preventScroll: true });
    alvo.scrollIntoView?.({ block: "center" });
  }, [estado]);

  const atual: EstadoPaginas<Item, Cursor, P> =
    estado.consulta === consulta ? estado : { tipo: "carregando" };
  const maisAtual =
    mais.consulta === consulta ? mais : { carregando: false, erro: null };

  const tentarDeNovo = useCallback(() => {
    setEstado({ consulta, tipo: "carregando" });
    setTentativa((n) => n + 1);
  }, [consulta]);

  async function carregarMais() {
    if (
      estado.consulta !== consulta ||
      estado.tipo !== "ok" ||
      estado.proximo === null ||
      carregandoMais.current
    )
      return;
    const { itens, proximo } = estado;
    carregandoMais.current = true;
    const controle = new AbortController();
    controleMais.current = controle;
    setMais({ consulta, carregando: true, erro: null });
    try {
      const pagina = await config.carregar(consulta, proximo, controle.signal);
      if (controle.signal.aborted) return;
      const vistos = new Set(itens.map(config.idDoItem));
      const novos = pagina.itens.filter(
        (item) => !vistos.has(config.idDoItem(item)),
      );
      focoPendente.current =
        novos.length > 0 ? config.idDoFoco(novos[0]) : config.idDoFim;
      setEstado({
        ...estado,
        itens: [...itens, ...novos],
        proximo: pagina.proximo,
        inicioDaUltima: itens.length,
      });
      setMais({ consulta, carregando: false, erro: null });
      setAnuncio(config.anunciarMais(novos.length, pagina.proximo === null));
    } catch (erro) {
      if (controle.signal.aborted) return;
      if (config.cursorInvalido(erro)) {
        // O cursor não vale mais (ex.: mudou numa publicação): recomeça da primeira página, uma vez.
        recomecou.current = true;
        setMais({ consulta, carregando: false, erro: null });
        setEstado({ consulta, tipo: "carregando" });
        setTentativa((n) => n + 1);
        return;
      }
      setMais({ consulta, carregando: false, erro });
    } finally {
      if (controleMais.current === controle) {
        controleMais.current = null;
        carregandoMais.current = false;
      }
    }
  }

  return {
    estado: atual,
    mais: maisAtual,
    anuncio,
    carregarMais,
    tentarDeNovo,
  };
}
