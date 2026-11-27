import { useEffect, useRef, useState } from "react";
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

// O cartão "Avisos de venda no celular" (RIFA-095, D43): o botão "Receber avisos de venda" do ranking aberto e da
// /minha (líder, discipulador e rede). Pede a permissão, inscreve o aparelho no Web Push e mostra o estado ("Avisos
// ligados neste aparelho" + "Desligar"). Some quando o navegador não suporta, quando a API diz que as notificações
// estão desligadas (sem as chaves no servidor ou com a opção da campanha desligada) e quando a API não responde (é um
// extra: a tela continua igual). No iPhone fora do app da Tela de Início, a explicação no lugar do botão; com a
// permissão negada, como liberar.

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

type Props = {
  /** Onde o cartão está (só para contar as inscrições). */
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
  const ocupado = useRef(false);

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
      // A API ou o navegador falharam na conferência: o cartão some (a tela segue igual).
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
    } finally {
      ocupado.current = false;
    }
  }

  if (estado.tipo === "carregando" || estado.tipo === "oculto") return null;

  return (
    <section
      className="avisos-celular"
      aria-label={TEXTOS_AVISOS.titulo}
      data-estado={estado.tipo}
    >
      <span className="avisos-celular__icone">
        <Icone nome="celular" />
      </span>
      <div className="avisos-celular__texto" aria-live="polite">
        <Conteudo estado={estado} />
      </div>
      <Acao estado={estado} aoLigar={ligar} aoDesligar={desligar} />
    </section>
  );
}

function Conteudo({ estado }: { estado: Estado }) {
  switch (estado.tipo) {
    case "iphone":
      return (
        <>
          <p className="avisos-celular__titulo">{TEXTOS_AVISOS.titulo}</p>
          <p>{TEXTOS_AVISOS.iphone}</p>
        </>
      );
    case "negado":
      return (
        <>
          <p className="avisos-celular__titulo">{TEXTOS_AVISOS.negado}</p>
          <p>
            {estado.noIphone
              ? TEXTOS_AVISOS.negadoComoLiberarNoIphone
              : TEXTOS_AVISOS.negadoComoLiberar}
          </p>
        </>
      );
    case "ligado":
    case "desligando":
      return (
        <>
          <p className="avisos-celular__titulo">{TEXTOS_AVISOS.ligado}</p>
          <p>
            {estado.tipo === "ligado" && estado.erro
              ? estado.erro
              : TEXTOS_AVISOS.ligadoDetalhe}
          </p>
        </>
      );
    default:
      return (
        <>
          <p className="avisos-celular__titulo">{TEXTOS_AVISOS.titulo}</p>
          <p>
            {estado.tipo === "disponivel" && estado.erro
              ? estado.erro
              : TEXTOS_AVISOS.descricao}
          </p>
        </>
      );
  }
}

function Acao({
  estado,
  aoLigar,
  aoDesligar,
}: {
  estado: Estado;
  aoLigar: (chave: string) => void;
  aoDesligar: (chave: string) => void;
}) {
  switch (estado.tipo) {
    case "disponivel":
    case "ligando": {
      const ligando = estado.tipo === "ligando";
      return (
        <ComDica texto={ligando ? DICAS_AVISOS.ocupado : DICAS_AVISOS.ligar}>
          <Button
            className="avisos-celular__botao"
            aria-disabled={ligando || undefined}
            onClick={() => {
              if (!ligando) aoLigar(estado.chave);
            }}
          >
            {ligando ? TEXTOS_AVISOS.ligando : TEXTOS_AVISOS.ligar}
          </Button>
        </ComDica>
      );
    }
    case "ligado":
    case "desligando": {
      const desligando = estado.tipo === "desligando";
      return (
        <ComDica
          texto={desligando ? DICAS_AVISOS.ocupado : DICAS_AVISOS.desligar}
        >
          <Button
            variante="secundario"
            className="avisos-celular__botao"
            aria-disabled={desligando || undefined}
            onClick={() => {
              if (!desligando) aoDesligar(estado.chave);
            }}
          >
            {desligando ? TEXTOS_AVISOS.desligando : TEXTOS_AVISOS.desligar}
          </Button>
        </ComDica>
      );
    }
    default:
      return null;
  }
}
