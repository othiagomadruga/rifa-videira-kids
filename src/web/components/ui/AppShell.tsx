import { useId, useState, type ReactNode } from "react";
import { NavLink } from "react-router";
import { Marca } from "./Marca";
import "./AppShell.css";

export type ItemNavegacao = {
  /** Caminho absoluto da tela, ex.: "/coordenacao/pedidos". */
  para: string;
  rotulo: string;
  /** Só fica "atual" no caminho exato (use na tela inicial da área). */
  exato?: boolean;
};

type Props = {
  /** Nome da área: aparece ao lado da marca e dá nome à navegação. */
  area: string;
  itens: readonly ItemNavegacao[];
  children: ReactNode;
};

// Layout da coordenação: barra lateral no computador (a partir de 64rem) e menu
// compacto (botão "Menu") no celular. O link da tela atual ganha aria-current="page".
export function AppShell({ area, itens, children }: Props) {
  const [menuAberto, setMenuAberto] = useState(false);
  const idNavegacao = useId();

  return (
    <div
      className="ui-app-shell"
      data-menu-aberto={menuAberto ? "" : undefined}
    >
      <a className="ui-app-shell__pular" href="#conteudo">
        Pular para o conteúdo
      </a>
      <div className="ui-app-shell__lateral">
        <header className="ui-app-shell__topo">
          <Marca complemento={area} />
          <button
            type="button"
            className="ui-app-shell__botao-menu"
            aria-expanded={menuAberto}
            aria-controls={idNavegacao}
            onClick={() => setMenuAberto((aberto) => !aberto)}
          >
            <IconeMenu aberto={menuAberto} />
            Menu
          </button>
        </header>
        <nav id={idNavegacao} className="ui-app-shell__nav" aria-label={area}>
          <ul className="ui-app-shell__lista">
            {itens.map((item) => (
              <li key={item.para}>
                <NavLink
                  to={item.para}
                  end={item.exato}
                  className="ui-app-shell__link"
                  onClick={() => setMenuAberto(false)}
                >
                  {item.rotulo}
                </NavLink>
              </li>
            ))}
          </ul>
        </nav>
      </div>
      <main id="conteudo" className="ui-app-shell__conteudo" tabIndex={-1}>
        <div className="ui-app-shell__pagina">{children}</div>
      </main>
    </div>
  );
}

function IconeMenu({ aberto }: { aberto: boolean }) {
  return (
    <svg
      className="ui-app-shell__icone"
      width="20"
      height="20"
      viewBox="0 0 20 20"
      aria-hidden="true"
      focusable="false"
    >
      <path
        d={aberto ? "M5 5l10 10M15 5L5 15" : "M3 5.5h14M3 10h14M3 14.5h14"}
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        fill="none"
      />
    </svg>
  );
}
