import { useState } from "react";
import { Outlet } from "react-router";
import {
  Button,
  ComDica,
  ErrorState,
  Loading,
  Marca,
} from "../../components/ui";
import { ehFalhaDeConexao, mensagemDoErro } from "../../lib/api";
import { ROTULO_PAPEL, useGuardaDaArea, useSessao } from "../../lib/sessao";
import { DICAS_DA_MOLDURA } from "./textos-moldura";
import "./minha-moldura.css";

type Saida = { saindo: boolean; erro: string | null };

/**
 * O complemento da marca enquanto a sessão não chega: um espaço que não quebra, para a linha do papel ("Líder") já
 * ocupar o lugar dela (RIFA-051, CLS: antes, a marca crescia de uma para duas linhas quando a sessão chegava e
 * empurrava a tela para baixo). O leitor de tela não lê um espaço.
 */
export const COMPLEMENTO_RESERVADO = "\u00a0";

// Moldura da visão individual (/minha), só com sessão de líder, discipulador ou rede (guarda): a marca com o
// papel, o botão "Sair" e a tela (Outlet), sem menu: esses papéis só têm esta tela. Sem sessão (ao abrir ou
// por um 401 no meio do uso), vai para /entrar e guarda a tela, como na coordenação; admin e coordenação vão
// para a área deles (/coordenacao). O topo tem a altura final desde o primeiro quadro (a linha do papel reservada
// e a barra com a altura do "Sair", minha-moldura.css): nada pula quando a sessão chega.
export function MinhaLayout() {
  const { estado, verificar, sair } = useSessao();
  const usuario = useGuardaDaArea("hierarquia");
  const [saida, setSaida] = useState<Saida>({ saindo: false, erro: null });

  async function sairDoSistema() {
    // Saindo, o botão fica com aria-disabled (RIFA-045: continua no Tab, com a dica dizendo por quê): barra aqui.
    if (saida.saindo) return;
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
            complemento={
              usuario ? ROTULO_PAPEL[usuario.papel] : COMPLEMENTO_RESERVADO
            }
          />
          {usuario && (
            <ComDica
              texto={
                saida.saindo ? DICAS_DA_MOLDURA.saindo : DICAS_DA_MOLDURA.sair
              }
            >
              <Button
                variante="secundario"
                aria-disabled={saida.saindo || undefined}
                onClick={() => void sairDoSistema()}
              >
                {saida.saindo ? "Saindo…" : "Sair"}
              </Button>
            </ComDica>
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
              conexao={ehFalhaDeConexao(estado.erro)}
            />
          ) : (
            <Loading texto="Conferindo o seu acesso…" />
          )}
        </div>
      </main>
    </div>
  );
}
