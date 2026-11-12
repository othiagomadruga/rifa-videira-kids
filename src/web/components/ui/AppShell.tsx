import { useEffect, useId, useRef, useState, type ReactNode } from "react";
import { NavLink } from "react-router";
import { Button } from "./Button";
import { ComDica } from "./Dica";
import { Marca } from "./Marca";
import "./AppShell.css";

export type ItemNavegacao = {
  /** Caminho absoluto da tela, ex.: "/coordenacao/pedidos". */
  para: string;
  rotulo: string;
  /** Só fica "atual" no caminho exato (use na tela inicial da área). */
  exato?: boolean;
  /** Dica do link (RIFA-045): o que a tela faz. */
  dica?: ReactNode;
};

/** Dicas dos botões da moldura (RIFA-045). */
export const DICA_BOTAO_MENU =
  "Mostra ou esconde a lista das telas da coordenação.";
export const DICA_BOTAO_SAIR =
  "Encerra o seu acesso neste aparelho. Para voltar, abra de novo o seu link pessoal.";

/** Quem está conectado: nome e botão "Sair" no fim do menu. */
export type ContaAppShell = {
  nome: string;
  /** Linha abaixo do nome (ex.: o papel). */
  detalhe?: string;
  aoSair: () => void;
  /** Saindo: o botão fica desabilitado e mostra "Saindo…". */
  saindo?: boolean;
  /** Falha ao sair, abaixo do botão (role="alert"). */
  erro?: string | null;
};

type Props = {
  /** Nome da área: aparece ao lado da marca e dá nome à navegação. */
  area: string;
  itens: readonly ItemNavegacao[];
  conta?: ContaAppShell;
  children: ReactNode;
};

// Layout da coordenação: barra lateral no computador (a partir de 64rem) e menu
// compacto (botão "Menu") no celular. O link da tela atual ganha aria-current="page".
// Aberto, o menu fecha com o próprio botão, com Esc (o foco volta ao botão), com
// toque fora da barra e quando o foco sai dela (inclusive com Tab para fora da
// página); escolher uma tela fecha e leva o foco ao conteúdo. O painel do menu tem
// a navegação e, no fim, a conta (nome de quem está conectado e "Sair").
export function AppShell({ area, itens, conta, children }: Props) {
  const [menuAberto, setMenuAberto] = useState(false);
  const idPainel = useId();
  // Área do menu: a barra do topo (com o botão) e a navegação.
  const refAreaMenu = useRef<HTMLDivElement>(null);
  const refBotaoMenu = useRef<HTMLButtonElement>(null);
  const refConteudo = useRef<HTMLElement>(null);

  useEffect(() => {
    const areaMenu = refAreaMenu.current;
    if (!menuAberto || !areaMenu) return;

    let conferenciaDoTab: ReturnType<typeof setTimeout> | undefined;

    const aoTeclar = (evento: KeyboardEvent) => {
      if (evento.key === "Escape") {
        setMenuAberto(false);
        refBotaoMenu.current?.focus();
      } else if (evento.key === "Tab") {
        // O navegador move o foco depois do keydown: confere logo em seguida. Cobre
        // o Tab que sai da página (sem próximo elemento), em que o focusout vem sem
        // destino.
        clearTimeout(conferenciaDoTab);
        conferenciaDoTab = setTimeout(() => {
          if (!areaMenu.contains(document.activeElement)) setMenuAberto(false);
        }, 0);
      }
    };
    const fecharComToqueFora = (evento: PointerEvent) => {
      if (
        !(evento.target instanceof Node) ||
        !areaMenu.contains(evento.target)
      ) {
        setMenuAberto(false);
      }
    };
    // Foco foi para um elemento fora do menu. Sem destino (troca de janela, toque
    // em parte do menu que não recebe foco) não fecha.
    const fecharQuandoOFocoSai = (evento: FocusEvent) => {
      const destino = evento.relatedTarget;
      if (destino instanceof Node && !areaMenu.contains(destino)) {
        setMenuAberto(false);
      }
    };

    document.addEventListener("keydown", aoTeclar);
    document.addEventListener("pointerdown", fecharComToqueFora);
    areaMenu.addEventListener("focusout", fecharQuandoOFocoSai);
    return () => {
      clearTimeout(conferenciaDoTab);
      document.removeEventListener("keydown", aoTeclar);
      document.removeEventListener("pointerdown", fecharComToqueFora);
      areaMenu.removeEventListener("focusout", fecharQuandoOFocoSai);
    };
  }, [menuAberto]);

  // Escolheu uma tela no menu do celular: fecha e leva o foco ao conteúdo (o <main>
  // continua o mesmo entre as telas, só o que está dentro dele muda).
  function aoEscolherTela() {
    if (!menuAberto) return;
    setMenuAberto(false);
    refConteudo.current?.focus();
  }

  return (
    <div
      className="ui-app-shell"
      data-menu-aberto={menuAberto ? "" : undefined}
    >
      <a className="ui-app-shell__pular" href="#conteudo">
        Pular para o conteúdo
      </a>
      <div className="ui-app-shell__lateral" ref={refAreaMenu}>
        <header className="ui-app-shell__topo">
          <Marca complemento={area} />
          <ComDica texto={DICA_BOTAO_MENU}>
            <button
              ref={refBotaoMenu}
              type="button"
              className="ui-app-shell__botao-menu"
              aria-expanded={menuAberto}
              aria-controls={idPainel}
              onClick={() => setMenuAberto((aberto) => !aberto)}
            >
              <IconeMenu aberto={menuAberto} />
              Menu
            </button>
          </ComDica>
        </header>
        <div id={idPainel} className="ui-app-shell__painel">
          <nav className="ui-app-shell__nav" aria-label={area}>
            <ul className="ui-app-shell__lista">
              {itens.map((item) => (
                <li key={item.para}>
                  <ComDica texto={item.dica}>
                    <NavLink
                      to={item.para}
                      end={item.exato}
                      className="ui-app-shell__link"
                      onClick={aoEscolherTela}
                    >
                      {item.rotulo}
                    </NavLink>
                  </ComDica>
                </li>
              ))}
            </ul>
          </nav>
          {conta && <Conta {...conta} />}
        </div>
      </div>
      <main
        id="conteudo"
        ref={refConteudo}
        className="ui-app-shell__conteudo"
        tabIndex={-1}
      >
        <div className="ui-app-shell__pagina">{children}</div>
      </main>
    </div>
  );
}

function Conta({ nome, detalhe, aoSair, saindo = false, erro }: ContaAppShell) {
  return (
    <div className="ui-app-shell__conta">
      <p className="ui-app-shell__usuario">
        <span className="visualmente-oculto">Conectado como </span>
        <span className="ui-app-shell__nome">{nome}</span>
        {detalhe && (
          <>
            {" "}
            <span className="ui-app-shell__detalhe">{detalhe}</span>
          </>
        )}
      </p>
      <ComDica texto={DICA_BOTAO_SAIR}>
        <Button
          variante="secundario"
          larguraTotal
          disabled={saindo}
          onClick={aoSair}
        >
          {saindo ? "Saindo…" : "Sair"}
        </Button>
      </ComDica>
      {erro && (
        <p className="ui-app-shell__erro" role="alert">
          {erro}
        </p>
      )}
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
