import {
  useCallback,
  useEffect,
  useId,
  useLayoutEffect,
  useRef,
  useState,
  type RefObject,
} from "react";
import type { OrigemInscricaoPush } from "../../../shared/contracts/notificacoes";
import { Button, ComDica, Icone } from "../ui";
import { apiNotificacoes, type ApiNotificacoes } from "./notificacoes-api";
import {
  ehAparelhoApple,
  pushDaJanela,
  type InscricaoDoNavegador,
  type PushDoNavegador,
} from "./navegador";
import { DICAS_AVISOS, TEXTOS_AVISOS } from "./textos";
import "./avisos-no-celular.css";

// O botão "Avisos no celular" (RIFA-095, D43; compacto desde a RIFA-096): no ranking aberto e na /minha (líder,
// discipulador e rede), na mesma linha do "Som das vendas" (as ações do cabeçalho da tela), do mesmo tamanho e estilo.
// Pede a permissão, inscreve o aparelho no Web Push e alterna: "Avisos no celular" → "Avisos ligados" (aria-pressed,
// como o botão do som); ligado, o toque desliga. Some quando o navegador não suporta, quando a API diz que as
// notificações estão desligadas (sem as chaves no servidor ou com a opção da campanha desligada) e quando a API não
// responde (é um extra: a tela continua igual). Nenhum texto fixo na página: no iPhone fora do app da Tela de Início,
// com a permissão negada ou numa falha, o toque (ou a falha) abre um balão pequeno ancorado no botão, com uma frase.

/** Uma vez por dia, no máximo, o aparelho já inscrito manda a inscrição de novo (refaz a que o servidor apagou). */
export const INTERVALO_SINCRONIA_MS = 24 * 60 * 60 * 1000;
export const CHAVE_SINCRONIA = "videira-kids:avisos-de-venda:sincronizado-em";

type Estado =
  | { tipo: "carregando" }
  | { tipo: "oculto" }
  | { tipo: "iphone" }
  | { tipo: "negado"; noIphone: boolean }
  | { tipo: "disponivel"; chave: string; erro: string | null }
  | { tipo: "ligando"; chave: string }
  | { tipo: "ligado"; chave: string; erro: string | null }
  | { tipo: "desligando"; chave: string };

/** Os estados com o botão na tela. */
type EstadoVisivel = Exclude<Estado, { tipo: "carregando" | "oculto" }>;

type Props = {
  /** Onde o botão está (só para contar as inscrições). */
  origem: OrigemInscricaoPush;
  /** Para os testes: o navegador e a API falsos. */
  navegador?: PushDoNavegador;
  api?: ApiNotificacoes;
  agora?: () => number;
};

function lerSincronia(): number | null {
  try {
    const valor = window.localStorage.getItem(CHAVE_SINCRONIA);
    return valor === null ? null : Number(valor);
  } catch {
    return null;
  }
}

function gravarSincronia(instante: number): void {
  try {
    window.localStorage.setItem(CHAVE_SINCRONIA, String(instante));
  } catch {
    // Sem storage (janela privada): só sincroniza de novo na próxima vez.
  }
}

export function AvisosNoCelular({
  origem,
  navegador,
  api = apiNotificacoes,
  agora = Date.now,
}: Props) {
  const [push] = useState<PushDoNavegador>(() => navegador ?? pushDaJanela());
  const [estado, setEstado] = useState<Estado>({ tipo: "carregando" });
  const [balaoAberto, setBalaoAberto] = useState(false);
  const ocupado = useRef(false);
  const refAncora = useRef<HTMLSpanElement>(null);
  const refBotao = useRef<HTMLButtonElement>(null);
  const idBalao = useId();

  useEffect(() => {
    let vivo = true;
    const mudar = (novo: Estado) => {
      if (vivo) setEstado(novo);
    };
    async function conferir() {
      const suporte = push.suporte();
      if (suporte === "sem_suporte") return mudar({ tipo: "oculto" });
      const { ligadas, chave_publica } = await api.estado();
      if (!ligadas || chave_publica === null) return mudar({ tipo: "oculto" });
      if (suporte === "iphone_fora_do_app") return mudar({ tipo: "iphone" });
      if (push.permissao() === "denied")
        return mudar({
          tipo: "negado",
          noIphone: ehAparelhoApple(window.navigator),
        });
      const atual =
        push.permissao() === "granted" ? await push.inscricaoAtual() : null;
      // Feita com outra chave VAPID (o servidor trocou a chave): não recebe mais; o botão volta para ativar de novo.
      const daChaveAtual =
        atual !== null &&
        (atual.chave == null || atual.chave === chave_publica);
      if (atual === null || !daChaveAtual) {
        mudar({ tipo: "disponivel", chave: chave_publica, erro: null });
        // O service worker já fica registrado: o toque no botão não espera por ele.
        void push.registrar().catch(() => undefined);
        return;
      }
      mudar({ tipo: "ligado", chave: chave_publica, erro: null });
      const ultima = lerSincronia();
      if (ultima === null || agora() - ultima >= INTERVALO_SINCRONIA_MS) {
        await api.inscrever(
          { endpoint: atual.endpoint, p256dh: atual.p256dh, auth: atual.auth },
          origem,
        );
        gravarSincronia(agora());
      }
    }
    conferir().catch(() => {
      // A API ou o navegador falharam na conferência: o botão some (a tela segue igual).
      setEstado((antes) =>
        antes.tipo === "carregando" ? { tipo: "oculto" } : antes,
      );
    });
    return () => {
      vivo = false;
    };
  }, [push, api, origem, agora]);

  async function ligar(chave: string) {
    if (ocupado.current) return;
    ocupado.current = true;
    setEstado({ tipo: "ligando", chave });
    try {
      // A permissão primeiro, ainda dentro do toque (o Safari exige).
      const permissao = await push.pedirPermissao();
      if (permissao === "denied") {
        setEstado({
          tipo: "negado",
          noIphone: ehAparelhoApple(window.navigator),
        });
        setBalaoAberto(true);
        return;
      }
      if (permissao !== "granted") {
        setEstado({ tipo: "disponivel", chave, erro: null });
        return;
      }
      const inscricao: InscricaoDoNavegador = await push.inscrever(chave);
      await api.inscrever(inscricao, origem);
      gravarSincronia(agora());
      setEstado({ tipo: "ligado", chave, erro: null });
    } catch {
      setEstado({ tipo: "disponivel", chave, erro: TEXTOS_AVISOS.falhouLigar });
      setBalaoAberto(true);
    } finally {
      ocupado.current = false;
    }
  }

  async function desligar(chave: string) {
    if (ocupado.current) return;
    ocupado.current = true;
    setEstado({ tipo: "desligando", chave });
    try {
      const endpoint = await push.cancelar();
      // O aparelho já saiu: se a API falhar agora, o servidor apaga a inscrição no próximo envio (410).
      if (endpoint !== null)
        await api.cancelar(endpoint).catch(() => undefined);
      setEstado({ tipo: "disponivel", chave, erro: null });
    } catch {
      setEstado({ tipo: "ligado", chave, erro: TEXTOS_AVISOS.falhouDesligar });
      setBalaoAberto(true);
    } finally {
      ocupado.current = false;
    }
  }

  // O X e o Esc devolvem o foco ao botão; o toque fora, não (o foco vai para onde a pessoa tocou).
  const fecharBalao = useCallback(
    ({ devolverFoco }: { devolverFoco: boolean }) => {
      setBalaoAberto(false);
      if (devolverFoco) refBotao.current?.focus();
    },
    [],
  );

  if (estado.tipo === "carregando" || estado.tipo === "oculto") return null;

  const textoDoBalao = explicacao(estado);
  const balaoVisivel = balaoAberto && textoDoBalao !== null;

  function tocar() {
    switch (estado.tipo) {
      case "iphone":
      case "negado":
        setBalaoAberto((aberto) => !aberto);
        return;
      case "disponivel":
        setBalaoAberto(false);
        void ligar(estado.chave);
        return;
      case "ligado":
        setBalaoAberto(false);
        void desligar(estado.chave);
        return;
      default:
        // Ligando ou desligando: o toque não faz nada (o botão está com aria-disabled).
        return;
    }
  }

  const ocupadoAgora =
    estado.tipo === "ligando" || estado.tipo === "desligando";
  const alterna = estado.tipo === "disponivel" || estado.tipo === "ligado";
  const explica = estado.tipo === "iphone" || estado.tipo === "negado";
  const ligadoAgora = estado.tipo === "ligado" || estado.tipo === "desligando";

  return (
    <span className="avisos-celular" ref={refAncora} data-estado={estado.tipo}>
      <ComDica texto={DICAS_AVISOS[dicaDoEstado(estado)]}>
        <Button
          ref={refBotao}
          variante="secundario"
          tamanho="pequeno"
          className="avisos-celular__botao"
          aria-pressed={alterna || ocupadoAgora ? ligadoAgora : undefined}
          aria-disabled={ocupadoAgora || undefined}
          aria-haspopup={explica ? "dialog" : undefined}
          aria-expanded={explica ? balaoVisivel : undefined}
          aria-controls={balaoVisivel ? idBalao : undefined}
          onClick={tocar}
        >
          <Icone nome="celular" />
          {rotuloDoEstado(estado)}
        </Button>
      </ComDica>
      {balaoVisivel && (
        <Balao
          id={idBalao}
          texto={textoDoBalao}
          ancora={refAncora}
          aoFechar={fecharBalao}
        />
      )}
    </span>
  );
}

/** O texto do botão: "Avisos no celular"; ligado, "Avisos ligados"; no meio do caminho, "Ligando…" ou "Desligando…". */
function rotuloDoEstado(estado: EstadoVisivel): string {
  switch (estado.tipo) {
    case "ligando":
      return TEXTOS_AVISOS.ligando;
    case "ligado":
      return TEXTOS_AVISOS.ligado;
    case "desligando":
      return TEXTOS_AVISOS.desligando;
    default:
      return TEXTOS_AVISOS.rotulo;
  }
}

function dicaDoEstado(estado: EstadoVisivel): keyof typeof DICAS_AVISOS {
  switch (estado.tipo) {
    case "iphone":
      return "iphone";
    case "negado":
      return "negado";
    case "ligado":
      return "desligar";
    case "disponivel":
      return "ligar";
    default:
      return "ocupado";
  }
}

/** O que o balão explica neste estado (null: nada a explicar, o balão não abre). */
function explicacao(estado: EstadoVisivel): string | null {
  switch (estado.tipo) {
    case "iphone":
      return TEXTOS_AVISOS.iphone;
    case "negado":
      return estado.noIphone
        ? TEXTOS_AVISOS.negadoNoIphone
        : TEXTOS_AVISOS.negado;
    case "disponivel":
    case "ligado":
      return estado.erro;
    default:
      return null;
  }
}

/**
 * O balão pequeno, ancorado embaixo do botão (o lado esquerdo vem do JS, pelo CSSOM, para ficar sempre dentro da tela;
 * a seta aponta para o meio do botão). Um diálogo não modal: ao abrir, o foco vai para o X; o X e o Esc fecham e
 * devolvem o foco ao botão; um toque fora fecha sem mexer no foco. O Esc que fecha uma dica aberta (Dica.tsx, na
 * captura) não chega até aqui: o balão fecha no Esc seguinte.
 */
function Balao({
  id,
  texto,
  ancora,
  aoFechar,
}: {
  id: string;
  texto: string;
  ancora: RefObject<HTMLSpanElement | null>;
  aoFechar: (opcoes: { devolverFoco: boolean }) => void;
}) {
  const refBalao = useRef<HTMLDivElement>(null);
  const refFechar = useRef<HTMLButtonElement>(null);
  const idTexto = useId();

  useLayoutEffect(() => {
    const posicionar = () => {
      const balao = refBalao.current;
      const alvo = ancora.current;
      if (balao && alvo) posicionarBalao(alvo, balao);
    };
    posicionar();
    window.addEventListener("resize", posicionar);
    return () => window.removeEventListener("resize", posicionar);
  }, [ancora, texto]);

  useEffect(() => {
    refFechar.current?.focus();
  }, []);

  useEffect(() => {
    const aoTeclar = (evento: KeyboardEvent) => {
      if (evento.key !== "Escape" || evento.isComposing) return;
      aoFechar({ devolverFoco: true });
    };
    const aoTocarFora = (evento: PointerEvent) => {
      const alvo = evento.target;
      if (alvo instanceof Node && ancora.current?.contains(alvo)) return;
      aoFechar({ devolverFoco: false });
    };
    document.addEventListener("keydown", aoTeclar);
    document.addEventListener("pointerdown", aoTocarFora, true);
    return () => {
      document.removeEventListener("keydown", aoTeclar);
      document.removeEventListener("pointerdown", aoTocarFora, true);
    };
  }, [ancora, aoFechar]);

  return (
    <div
      ref={refBalao}
      id={id}
      className="avisos-celular__balao"
      role="dialog"
      aria-label={TEXTOS_AVISOS.titulo}
      aria-describedby={idTexto}
    >
      <p id={idTexto} className="avisos-celular__explicacao">
        {texto}
      </p>
      <ComDica texto={DICAS_AVISOS.fechar}>
        <button
          ref={refFechar}
          type="button"
          className="avisos-celular__fechar"
          aria-label={TEXTOS_AVISOS.fechar}
          onClick={() => aoFechar({ devolverFoco: true })}
        >
          <Icone nome="fechar" />
        </button>
      </ComDica>
    </div>
  );
}

/** Distância mínima entre o balão e a borda da tela, em px. */
const MARGEM_DA_TELA_PX = 8;

/**
 * Centra o balão embaixo do botão e o empurra para dentro da tela (no celular, o botão pode estar perto de qualquer
 * borda); a seta (--balao-seta) continua no meio do botão.
 */
export function posicionarBalao(alvo: HTMLElement, balao: HTMLElement): void {
  const caixa = alvo.getBoundingClientRect();
  const largura = balao.offsetWidth;
  const larguraDaTela =
    document.documentElement.clientWidth || window.innerWidth;
  let esquerda = (caixa.width - largura) / 2;
  const minimo = MARGEM_DA_TELA_PX - caixa.left;
  const maximo = larguraDaTela - MARGEM_DA_TELA_PX - largura - caixa.left;
  esquerda = Math.max(minimo, Math.min(esquerda, maximo));
  balao.style.setProperty("left", `${Math.round(esquerda)}px`);
  balao.style.setProperty(
    "--balao-seta",
    `${Math.round(caixa.width / 2 - esquerda)}px`,
  );
}
