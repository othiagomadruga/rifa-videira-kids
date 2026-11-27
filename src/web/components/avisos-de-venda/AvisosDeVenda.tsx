// Os avisos de venda (RIFA-094, D42), no ranking aberto e na /minha: a pilha de avisos ("A célula X vendeu N
// bilhetes!") e o botão "Som das vendas". A tela monta <AvisosDeVenda> (que consulta e mostra a pilha) e mostra o
// <BotaoSomDasVendas> perto do título quando `aoSaberSeLigados` diz que os avisos estão ligados na campanha. O estado
// dos avisos fica dentro do <AvisosDeVenda>: cada aviso que entra ou sai não desenha a tela de novo.
//
// - A pilha é uma região viva educada (role="log", aria-live="polite": uma sequência de mensagens em que as antigas
//   saem; o "status" fica para o carregando de cada tela): o leitor de tela lê cada aviso que entra, sem roubar o foco.
//   Nada nela é clicável (pointer-events: none no CSS): o toque passa para o que está embaixo.
// - Computador: no canto de baixo à direita, até 4, o mais novo embaixo. Celular (até 37,5rem): descendo do topo, até
//   3, numa versão compacta. As animações só sem prefers-reduced-motion (avisos-de-venda.css).
// - O botão do som: ligado por padrão, mas o navegador só toca depois de um gesto na página. Enquanto o áudio não foi
//   liberado, o primeiro toque no botão libera e toca um plim de teste (não desliga); depois, alterna.
import { createContext, useEffect } from "react";
import { Button, ComDica, Icone } from "../ui";
import {
  desbloquearSom,
  escolherSomDasVendas,
  somDesbloqueado,
  tocarPlim,
  useSomDasVendas,
} from "./som";
import {
  DICAS_SOM,
  LINHA_DO_AVISO,
  ROTULO_SOM,
  inicioDaFrase,
  textoDosBilhetes,
} from "./textos";
import { useAvisosDeVenda, type AvisoDeVenda } from "./useAvisosDeVenda";
import "./avisos-de-venda.css";

type PropsAvisos = {
  /** false: não consulta nem mostra nada (ex.: a /minha antes de a sessão chegar). Padrão: true. */
  ativo?: boolean;
  /** Avisa a tela quando os avisos ficam ligados ou desligados na campanha (para mostrar o botão do som). */
  aoSaberSeLigados?: (ligados: boolean) => void;
};

export function AvisosDeVenda({ ativo = true, aoSaberSeLigados }: PropsAvisos) {
  const { ligados, avisos } = useAvisosDeVenda({ ativo });
  useEffect(() => {
    aoSaberSeLigados?.(ligados);
  }, [ligados, aoSaberSeLigados]);
  return <PilhaDeAvisos avisos={avisos} />;
}

export function PilhaDeAvisos({ avisos }: { avisos: AvisoDeVenda[] }) {
  return (
    <div className="avisos-de-venda" role="log" aria-live="polite">
      {avisos.map((aviso) => (
        <Aviso key={aviso.k} {...aviso} />
      ))}
    </div>
  );
}

function Aviso({ celula, bilhetes, saindo }: AvisoDeVenda) {
  return (
    <div
      className="aviso-de-venda"
      data-aviso-de-venda=""
      data-saindo={saindo ? "" : undefined}
    >
      <span className="aviso-de-venda__icone" aria-hidden="true">
        <Icone nome="bilhetes" />
      </span>
      <p className="aviso-de-venda__textos">
        <span className="aviso-de-venda__frase">
          {inicioDaFrase(celula)} <strong>{celula}</strong> vendeu{" "}
          <strong>{textoDosBilhetes(bilhetes)}</strong>!
        </span>{" "}
        <span className="aviso-de-venda__quando">{LINHA_DO_AVISO}</span>
      </p>
    </div>
  );
}

/**
 * Os avisos estão ligados (para uma tela mais funda mostrar o botão do som): a moldura da /minha fornece, o cabeçalho
 * dela lê. Fora de um provedor, false.
 */
export const AvisosLigados = createContext(false);

/** O botão "Som das vendas" (ligado/desligado, guardado no aparelho). */
export function BotaoSomDasVendas() {
  const ligado = useSomDasVendas();

  function alternar() {
    if (!ligado) {
      escolherSomDasVendas(true);
      void desbloquearSom().then(tocarPlim);
      return;
    }
    // Ligado, mas o navegador ainda não deixou tocar: o primeiro toque libera e toca um plim de teste.
    if (!somDesbloqueado()) {
      void desbloquearSom().then(tocarPlim);
      return;
    }
    escolherSomDasVendas(false);
  }

  return (
    <ComDica texto={ligado ? DICAS_SOM.ligado : DICAS_SOM.desligado}>
      <Button
        variante="secundario"
        tamanho="pequeno"
        className="som-das-vendas"
        data-som-das-vendas=""
        aria-pressed={ligado}
        onClick={alternar}
      >
        <Icone nome={ligado ? "sino" : "sino-mudo"} />
        {ROTULO_SOM}
      </Button>
    </ComDica>
  );
}
