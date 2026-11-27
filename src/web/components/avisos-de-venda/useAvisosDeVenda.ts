// Os avisos de venda (RIFA-094, D42): consulta GET /api/publico/vendas-recentes e põe na tela um aviso por compra nova
// ("A célula X vendeu N bilhetes!"), no ranking aberto e na /minha (líder, discipulador e rede).
//
// - Consulta a cada INTERVALO_CONSULTA_MS, contados do fim da anterior, só com a aba visível (com ela escondida, para;
//   ao voltar, consulta na hora), como o ranking aberto.
// - A PRIMEIRA resposta com os avisos ligados só marca as vendas como vistas: quem abre a página não vê o passado. Nas
//   seguintes, cada venda nova (pela chave opaca `k`) vira um aviso, da mais antiga para a mais nova.
// - Fila: os avisos entram um de cada vez, com INTERVALO_ENTRE_AVISOS_MS entre eles; cada um fica TEMPO_NA_TELA_MS e
//   sai sozinho (TEMPO_DE_SAIDA_MS de animação). Visíveis ao mesmo tempo: até VISIVEIS_NO_COMPUTADOR, ou
//   VISIVEIS_NO_CELULAR numa tela estreita (CONSULTA_DO_CELULAR). Esperando, no máximo LIMITE_DA_FILA (os mais
//   antigos saem).
// - Cada aviso toca o plim (som.ts) quando aparece, se o "Som das vendas" está ligado e a aba está visível; como entram
//   um de cada vez, dois plins nunca tocam juntos. O som só toca depois de um gesto da pessoa na página: este hook
//   escuta os toques, cliques e teclas e libera o áudio no primeiro (o botão do som faz o mesmo).
// - `ligados: false` (a opção da campanha desligada ou nenhuma campanha): nada na tela, a fila esvazia e a próxima
//   resposta com os avisos ligados volta a ser a "primeira".
import { useEffect, useRef, useState } from "react";
import type { ItemVendaRecente } from "../../../shared/contracts/api";
import { carregarVendasRecentes } from "./avisos-de-venda-api";
import { desbloquearSom, tocarPlim, useSomDasVendas } from "./som";

/** De quanto em quanto tempo consulta as vendas, com a aba visível. */
export const INTERVALO_CONSULTA_MS = 15_000;
/** O intervalo entre dois avisos que chegam juntos. */
export const INTERVALO_ENTRE_AVISOS_MS = 800;
/** Quanto tempo cada aviso fica na tela. */
export const TEMPO_NA_TELA_MS = 5_000;
/** A animação de saída (o CSS usa a mesma duração, --duracao-media). */
export const TEMPO_DE_SAIDA_MS = 250;
/** Avisos esperando a vez, no máximo (os mais antigos saem). */
export const LIMITE_DA_FILA = 12;
/** Visíveis ao mesmo tempo. */
export const VISIVEIS_NO_COMPUTADOR = 4;
export const VISIVEIS_NO_CELULAR = 3;
/** A tela estreita, a mesma do CSS (avisos-de-venda.css). */
export const CONSULTA_DO_CELULAR = "(max-width: 37.5rem)";
/** Quantas chaves já vistas guardar (cada venda só fica 3 minutos na resposta). */
const LIMITE_DE_CHAVES_VISTAS = 500;
/** Os eventos de um gesto da pessoa (o áudio só começa depois de um). */
const EVENTOS_DE_GESTO = [
  "pointerdown",
  "pointerup",
  "touchend",
  "keydown",
  "click",
] as const;

export type AvisoDeVenda = {
  k: string;
  celula: string;
  bilhetes: number;
  /** Na animação de saída. */
  saindo: boolean;
};

function abaVisivel(): boolean {
  return document.visibilityState !== "hidden";
}

function telaDeCelular(): MediaQueryList | null {
  return typeof window.matchMedia === "function"
    ? window.matchMedia(CONSULTA_DO_CELULAR)
    : null;
}

/** O navegador já viu um gesto da pessoa? Sem a API (navegador antigo, testes), deixa tentar. */
function houveGesto(): boolean {
  const ativacao = (
    navigator as Navigator & {
      userActivation?: { hasBeenActive: boolean; isActive: boolean };
    }
  ).userActivation;
  return ativacao ? ativacao.isActive || ativacao.hasBeenActive : true;
}

export function useAvisosDeVenda({ ativo = true }: { ativo?: boolean } = {}): {
  /** Os avisos estão ligados na campanha (a última resposta): só aí a tela mostra o botão do som. */
  ligados: boolean;
  /** Os avisos na tela, do mais antigo (em cima) para o mais novo. */
  avisos: AvisoDeVenda[];
} {
  const [ligados, setLigados] = useState(false);
  const [avisos, setAvisos] = useState<AvisoDeVenda[]>([]);
  const [visivel, setVisivel] = useState(abaVisivel);
  const [rodada, setRodada] = useState(0);
  const somLigado = useSomDasVendas();

  // O agendador da fila trabalha com refs (os temporizadores leem o valor de agora, não o do render).
  const naTela = useRef<AvisoDeVenda[]>([]);
  const fila = useRef<ItemVendaRecente[]>([]);
  const vistas = useRef<Set<string> | null>(null);
  const esperando = useRef(false);
  const celular = useRef(false);
  const som = useRef(somLigado);
  const temporizadores = useRef(new Set<ReturnType<typeof setTimeout>>());
  const agendador = useRef<{
    enfileirar(novas: ItemVendaRecente[]): void;
    esvaziar(): void;
  } | null>(null);

  useEffect(() => {
    som.current = somLigado;
  }, [somLigado]);

  // O agendador: criado uma vez, desfeito na saída da tela (nenhum temporizador fica para trás).
  useEffect(() => {
    const pendentes = temporizadores.current;
    const agendar = (acao: () => void, ms: number) => {
      const id = setTimeout(() => {
        pendentes.delete(id);
        acao();
      }, ms);
      pendentes.add(id);
    };
    const mostrar = (lista: AvisoDeVenda[]) => {
      naTela.current = lista;
      setAvisos(lista);
    };
    const remover = (k: string) => {
      mostrar(naTela.current.filter((aviso) => aviso.k !== k));
      tentarEntrar();
    };
    const sair = (k: string) => {
      mostrar(
        naTela.current.map((aviso) =>
          aviso.k === k ? { ...aviso, saindo: true } : aviso,
        ),
      );
      agendar(() => remover(k), TEMPO_DE_SAIDA_MS);
    };
    function tentarEntrar() {
      if (esperando.current || fila.current.length === 0) return;
      const maximo = celular.current
        ? VISIVEIS_NO_CELULAR
        : VISIVEIS_NO_COMPUTADOR;
      if (naTela.current.length >= maximo) return;
      const venda = fila.current.shift()!;
      mostrar([
        ...naTela.current,
        {
          k: venda.k,
          celula: venda.celula,
          bilhetes: venda.bilhetes,
          saindo: false,
        },
      ]);
      if (som.current && abaVisivel()) tocarPlim();
      esperando.current = true;
      agendar(() => {
        esperando.current = false;
        tentarEntrar();
      }, INTERVALO_ENTRE_AVISOS_MS);
      agendar(() => sair(venda.k), TEMPO_NA_TELA_MS);
    }
    agendador.current = {
      enfileirar(novas) {
        fila.current.push(...novas);
        fila.current.splice(
          0,
          Math.max(0, fila.current.length - LIMITE_DA_FILA),
        );
        tentarEntrar();
      },
      esvaziar() {
        fila.current = [];
      },
    };
    return () => {
      for (const id of pendentes) clearTimeout(id);
      pendentes.clear();
      agendador.current = null;
    };
  }, []);

  // Tela de celular (o limite de visíveis).
  useEffect(() => {
    const consulta = telaDeCelular();
    if (consulta === null) return;
    celular.current = consulta.matches;
    const aoMudar = () => {
      celular.current = consulta.matches;
    };
    consulta.addEventListener("change", aoMudar);
    return () => consulta.removeEventListener("change", aoMudar);
  }, []);

  // A aba: escondida, para de consultar; ao voltar, consulta na hora.
  useEffect(() => {
    function aoMudarVisibilidade() {
      const agoraVisivel = abaVisivel();
      setVisivel(agoraVisivel);
      if (agoraVisivel) setRodada((n) => n + 1);
    }
    document.addEventListener("visibilitychange", aoMudarVisibilidade);
    return () =>
      document.removeEventListener("visibilitychange", aoMudarVisibilidade);
  }, []);

  // O primeiro gesto da pessoa na página libera o áudio (fora o toque no botão do som, que decide sozinho).
  useEffect(() => {
    if (!ligados || !somLigado) return;
    const aoGesto = (evento: Event) => {
      const alvo = evento.target;
      if (alvo instanceof Element && alvo.closest("[data-som-das-vendas]"))
        return;
      if (houveGesto()) void desbloquearSom();
    };
    for (const tipo of EVENTOS_DE_GESTO)
      document.addEventListener(tipo, aoGesto, {
        capture: true,
        passive: true,
      });
    return () => {
      for (const tipo of EVENTOS_DE_GESTO)
        document.removeEventListener(tipo, aoGesto, { capture: true });
    };
  }, [ligados, somLigado]);

  // A consulta (só ativa e com a aba visível).
  useEffect(() => {
    if (!visivel || !ativo) return;
    const controle = new AbortController();
    let proxima: ReturnType<typeof setTimeout> | undefined;
    const agendarProxima = () => {
      proxima = setTimeout(
        () => setRodada((n) => n + 1),
        INTERVALO_CONSULTA_MS,
      );
    };
    carregarVendasRecentes({ signal: controle.signal }).then(
      (resposta) => {
        if (controle.signal.aborted) return;
        setLigados(resposta.ligados);
        if (!resposta.ligados) {
          vistas.current = null;
          agendador.current?.esvaziar();
        } else if (vistas.current === null) {
          vistas.current = new Set(resposta.itens.map(({ k }) => k));
        } else {
          const conhecidas = vistas.current;
          // Da mais antiga para a mais nova (a resposta vem da mais nova para a mais antiga).
          const novas = resposta.itens
            .filter(({ k }) => !conhecidas.has(k))
            .reverse();
          for (const { k } of novas) conhecidas.add(k);
          for (const k of conhecidas) {
            if (conhecidas.size <= LIMITE_DE_CHAVES_VISTAS) break;
            conhecidas.delete(k);
          }
          if (novas.length > 0) agendador.current?.enfileirar(novas);
        }
        agendarProxima();
      },
      () => {
        // Uma falha não aparece: a próxima consulta tenta de novo.
        if (controle.signal.aborted) return;
        agendarProxima();
      },
    );
    return () => {
      controle.abort();
      clearTimeout(proxima);
    };
  }, [rodada, visivel, ativo]);

  return { ligados, avisos };
}
