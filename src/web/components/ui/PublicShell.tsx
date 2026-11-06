import type { ReactNode } from "react";
import { Marca } from "./Marca";
import "./PublicShell.css";

// Layout das telas abertas (ranking público, entrar, status, 404): marca no topo
// e conteúdo centralizado, sem navegação.
export function PublicShell({ children }: { children: ReactNode }) {
  return (
    <div className="ui-public-shell">
      <header className="ui-public-shell__topo">
        <div className="ui-public-shell__limite">
          <Marca />
        </div>
      </header>
      <main id="conteudo" className="ui-public-shell__conteudo">
        <div className="ui-public-shell__limite ui-public-shell__pagina">
          {children}
        </div>
      </main>
    </div>
  );
}
