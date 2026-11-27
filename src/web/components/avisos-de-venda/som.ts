// O "plim" dos avisos de venda (RIFA-094, D42): um som curto por aviso, gerado com a Web Audio API (dois tons
// senoidais, agudo e baixo), sem arquivo de áudio (a CSP do site não muda). Os navegadores só deixam tocar depois de um
// gesto da pessoa na página (toque, clique ou tecla): o contexto de áudio só é criado DENTRO de um gesto
// (`desbloquearSom`), e antes disso `tocarPlim` não faz nada (nenhum erro nem aviso no console).
//
// A escolha "Som das vendas" (ligado/desligado) fica guardada no aparelho (localStorage, com try/catch: numa janela
// anônima ou com o armazenamento bloqueado, vale só enquanto a página está aberta). Padrão: ligado.
import { useSyncExternalStore } from "react";

/** A chave da escolha no localStorage ("1" ligado, "0" desligado). */
export const CHAVE_SOM_DAS_VENDAS = "rifa-videira-kids:som-das-vendas";

/** Os dois tons do plim (Hz), a duração (s) e o volume máximo (0 a 1): curto, agudo e moderado. */
export const PLIM = {
  tons: [
    { frequencia: 1318.5, inicio: 0 },
    { frequencia: 1975.5, inicio: 0.08 },
  ],
  duracaoDoTom: 0.17,
  volume: 0.14,
} as const;

type ConstrutorDeAudio = new () => AudioContext;

let contexto: AudioContext | null = null;
/** A escolha quando o localStorage não deixa gravar (null = vale a do aparelho). */
let escolhaNaMemoria: boolean | null = null;
const ouvintes = new Set<() => void>();

function construtorDeAudio(): ConstrutorDeAudio | null {
  if (typeof window === "undefined") return null;
  const janela = window as unknown as {
    AudioContext?: ConstrutorDeAudio;
    webkitAudioContext?: ConstrutorDeAudio;
  };
  return janela.AudioContext ?? janela.webkitAudioContext ?? null;
}

/**
 * Num gesto da pessoa (toque, clique, tecla): cria o contexto de áudio, se ainda não existe, ou o retoma (o celular o
 * suspende quando a aba vai para o fundo). Fora de um gesto, o navegador o deixaria suspenso: só se chama daqui. A
 * promessa termina quando o contexto já pode tocar (ou não vai poder: sem Web Audio, ou o navegador recusou).
 */
export function desbloquearSom(): Promise<void> {
  const Construtor = construtorDeAudio();
  if (Construtor === null) return Promise.resolve();
  try {
    contexto ??= new Construtor();
    if (contexto.state === "suspended")
      return contexto.resume().catch(() => undefined);
  } catch {
    contexto = null;
  }
  return Promise.resolve();
}

/** O áudio já foi liberado por um gesto (o contexto está tocando). */
export function somDesbloqueado(): boolean {
  return contexto?.state === "running";
}

/**
 * Toca o plim, se o áudio já foi liberado. Devolve se tocou. Cada tom tem o seu envelope (ataque de 10 ms e queda
 * exponencial), para não estalar.
 */
export function tocarPlim(): boolean {
  if (contexto === null || contexto.state !== "running") return false;
  try {
    const agora = contexto.currentTime;
    for (const { frequencia, inicio } of PLIM.tons) {
      const comeco = agora + inicio;
      const fim = comeco + PLIM.duracaoDoTom;
      const tom = contexto.createOscillator();
      const volume = contexto.createGain();
      tom.type = "sine";
      tom.frequency.setValueAtTime(frequencia, comeco);
      volume.gain.setValueAtTime(0.0001, comeco);
      volume.gain.exponentialRampToValueAtTime(PLIM.volume, comeco + 0.01);
      volume.gain.exponentialRampToValueAtTime(0.0001, fim);
      tom.connect(volume);
      volume.connect(contexto.destination);
      tom.start(comeco);
      tom.stop(fim + 0.02);
    }
    return true;
  } catch {
    return false;
  }
}

/** A escolha guardada: ligado, a não ser que a pessoa tenha desligado. */
export function somDasVendasLigado(): boolean {
  if (escolhaNaMemoria !== null) return escolhaNaMemoria;
  try {
    return window.localStorage.getItem(CHAVE_SOM_DAS_VENDAS) !== "0";
  } catch {
    return true;
  }
}

/** Guarda a escolha no aparelho (ou só na memória, se o localStorage não deixar) e avisa quem mostra o botão. */
export function escolherSomDasVendas(ligado: boolean): void {
  try {
    window.localStorage.setItem(CHAVE_SOM_DAS_VENDAS, ligado ? "1" : "0");
    escolhaNaMemoria = null;
  } catch {
    escolhaNaMemoria = ligado;
  }
  for (const ouvinte of ouvintes) ouvinte();
}

function ouvir(ouvinte: () => void): () => void {
  ouvintes.add(ouvinte);
  return () => ouvintes.delete(ouvinte);
}

/** A escolha do som, a mesma em toda a página (o botão e os avisos). */
export function useSomDasVendas(): boolean {
  return useSyncExternalStore(ouvir, somDasVendasLigado, () => true);
}

/** Só para os testes: volta ao começo (sem contexto de áudio, sem escolha na memória). */
export function esquecerSomDasVendas(): void {
  contexto = null;
  escolhaNaMemoria = null;
}
