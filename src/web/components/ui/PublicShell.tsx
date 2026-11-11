import type { ReactNode } from "react";
import { MARCA } from "../../tema/marca";
import { Marca } from "./Marca";
import "./PublicShell.css";

// Layout das telas abertas (ranking público, entrar, acesso, status, 404): a marca da Videira no topo, o
// conteúdo centralizado, sem navegação, e no rodapé o selo discreto do Kids (a campanha é para o espaço
// Videira Kids). Atrás de tudo, o fundo ambiente: brilhos da marca em movimento lento (só sem
// prefers-reduced-motion; PublicShell.css).
export function PublicShell({ children }: { children: ReactNode }) {
  const { kids } = MARCA;
  return (
    <div className="ui-public-shell">
      <div className="ui-public-shell__ambiente" aria-hidden="true" />
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
      <footer className="ui-public-shell__rodape">
        <div className="ui-public-shell__limite ui-public-shell__kids">
          {/* O texto ao lado já diz o nome: a imagem é decorativa (alt vazio). */}
          <img
            className="ui-public-shell__selo-kids"
            src={kids.src}
            alt=""
            width={kids.largura}
            height={kids.altura}
            loading="lazy"
            decoding="async"
          />
          <p>{kids.frase}</p>
        </div>
      </footer>
    </div>
  );
}
