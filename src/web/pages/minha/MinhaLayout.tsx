import { useState } from "react";
import { Outlet } from "react-router";
import { Button, ErrorState, Loading, Marca } from "../../components/ui";
import { mensagemDoErro } from "../../lib/api";
import { ROTULO_PAPEL, useGuardaDaArea, useSessao } from "../../lib/sessao";
import "./minha.css";

type Saida = { saindo: boolean; erro: string | null };

// Moldura da visão individual (/minha), só com sessão de líder, discipulador ou rede (guarda): a marca com o
// papel, o botão "Sair" e a tela (Outlet), sem menu: esses papéis só têm esta tela. Sem sessão (ao abrir ou
// por um 401 no meio do uso), vai para /entrar e guarda a tela, como na coordenação; admin e coordenação vão
// para a área deles (/coordenacao).
export function MinhaLayout() {
  const { estado, verificar, sair } = useSessao();
  const usuario = useGuardaDaArea("hierarquia");
  const [saida, setSaida] = useState<Saida>({ saindo: false, erro: null });

  async function sairDoSistema() {
    setSaida({ saindo: true, erro: null });
    try {
      await sair();
    } catch (erro) {
      setSaida({
        saindo: false,
        erro: `Não foi possível sair: ${mensagemDoErro(erro)}`,
      });
    }
  }

  return (
    <div className="minha-moldura">
      <header className="minha-moldura__topo">
        <div className="minha-moldura__limite minha-moldura__barra">
          <Marca
            complemento={usuario ? ROTULO_PAPEL[usuario.papel] : undefined}
          />
          {usuario && (
            <Button
              variante="secundario"
              disabled={saida.saindo}
              onClick={() => void sairDoSistema()}
            >
              {saida.saindo ? "Saindo…" : "Sair"}
            </Button>
          )}
        </div>
        {saida.erro && (
          <div className="minha-moldura__limite">
            <p className="minha-moldura__erro" role="alert">
              {saida.erro}
            </p>
          </div>
        )}
      </header>
      <main id="conteudo" className="minha-moldura__conteudo">
        <div className="minha-moldura__limite minha-moldura__pagina">
          {usuario ? (
            <Outlet />
          ) : estado.situacao === "erro" ? (
            <ErrorState
              titulo="Não foi possível conferir o seu acesso."
              mensagem={mensagemDoErro(estado.erro)}
              aoTentarDeNovo={verificar}
            />
          ) : (
            <Loading texto="Conferindo o seu acesso…" />
          )}
        </div>
      </main>
    </div>
  );
}
