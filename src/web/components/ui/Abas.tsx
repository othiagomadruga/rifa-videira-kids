import { useId, type KeyboardEvent, type ReactNode } from "react";
import { ComDica } from "./Dica";
import "./Abas.css";

export type Aba<Id extends string = string> = {
  /** Identificador da aba (vai nos ids do botão e do painel). */
  id: Id;
  rotulo: ReactNode;
  conteudo: ReactNode;
  /** Dica do botão da aba (RIFA-045): o que a aba mostra e o que se faz nela. */
  dica?: ReactNode;
};

type Props<Id extends string> = {
  /** Nome do conjunto de abas para leitores de tela (aria-label da lista). */
  rotulo: string;
  abas: readonly Aba<Id>[];
  /** Aba aberta: quem usa controla (pode trocar de aba por fora, ex.: um botão "Importar"). */
  abaAtiva: Id;
  aoMudar: (id: Id) => void;
  /** Base dos ids. Com ela, `idDaAba(base, id)` dá o id do botão da aba (ex.: para levar o foco até ele). */
  id?: string;
};

/** Id do botão da aba `aba` num `<Abas id={base}>`. */
export function idDaAba(base: string, aba: string): string {
  return `${base}-aba-${aba}`;
}

function idDoPainel(base: string, aba: string): string {
  return `${base}-painel-${aba}`;
}

// Abas no padrão WAI-ARIA: role tablist/tab/tabpanel, só a aba atual entra no Tab (tabindex itinerante),
// setas esquerda/direita (dão a volta), Home e End trocam de aba e levam o foco junto. Todos os painéis
// ficam montados (os inativos com `hidden`), então o que foi digitado numa aba não se perde ao trocar.
export function Abas<Id extends string>({
  rotulo,
  abas,
  abaAtiva,
  aoMudar,
  id,
}: Props<Id>) {
  const idAutomatico = useId();
  const base = id ?? idAutomatico;

  function aoTeclar(evento: KeyboardEvent<HTMLDivElement>) {
    const atual = abas.findIndex((aba) => aba.id === abaAtiva);
    const ultima = abas.length - 1;
    const destinos: Record<string, number> = {
      ArrowRight: atual >= ultima ? 0 : atual + 1,
      ArrowLeft: atual <= 0 ? ultima : atual - 1,
      Home: 0,
      End: ultima,
    };
    const destino = abas[destinos[evento.key] ?? -1];
    if (!destino) return;
    evento.preventDefault();
    aoMudar(destino.id);
    document.getElementById(idDaAba(base, destino.id))?.focus();
  }

  return (
    <div className="ui-abas">
      <div
        role="tablist"
        aria-label={rotulo}
        className="ui-abas__lista"
        onKeyDown={aoTeclar}
      >
        {abas.map((aba) => {
          const ativa = aba.id === abaAtiva;
          return (
            <ComDica key={aba.id} texto={aba.dica}>
              <button
                type="button"
                role="tab"
                id={idDaAba(base, aba.id)}
                className="ui-abas__aba"
                aria-selected={ativa}
                aria-controls={idDoPainel(base, aba.id)}
                tabIndex={ativa ? 0 : -1}
                onClick={() => aoMudar(aba.id)}
              >
                {aba.rotulo}
              </button>
            </ComDica>
          );
        })}
      </div>
      {abas.map((aba) => (
        <div
          key={aba.id}
          role="tabpanel"
          id={idDoPainel(base, aba.id)}
          aria-labelledby={idDaAba(base, aba.id)}
          className="ui-abas__painel"
          hidden={aba.id !== abaAtiva}
          tabIndex={0}
        >
          {aba.conteudo}
        </div>
      ))}
    </div>
  );
}
