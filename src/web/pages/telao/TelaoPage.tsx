import { Marca } from "../../components/ui";
import { tituloDaAba } from "../../tema/marca";
import "./telao.css";

// Modo telão (culto, 1920×1080, lido a ~8 m): tela cheia, sem navegação, tema
// escuro de alto contraste e sem rolagem. Tela pública: nunca mostra valores em
// dinheiro (regra em docs/frontend.md, conferida em rotas.test.tsx).
export function TelaoPage() {
  return (
    <div className="telao" data-tema="telao">
      <title>{tituloDaAba("Telão")}</title>
      <header className="telao__topo">
        <Marca />
      </header>
      <main className="telao__conteudo">
        <h1 className="telao__titulo">Telão</h1>
        <p className="telao__aviso">Em construção (RIFA-011)</p>
      </main>
    </div>
  );
}
