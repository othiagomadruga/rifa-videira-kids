import { useState } from "react";
import { Outlet } from "react-router";
import {
  AppShell,
  ErrorState,
  Loading,
  PublicShell,
} from "../../components/ui";
import { mensagemDoErro } from "../../lib/api";
import { ROTULO_PAPEL, useGuardaDaArea, useSessao } from "../../lib/sessao";
import { itensDaNavegacao } from "./telas";

type Saida = { saindo: boolean; erro: string | null };

// Moldura de todas as telas em /coordenacao, só com sessão de admin ou coordenação (guarda): menu conforme o
// papel, nome de quem está conectado com o botão "Sair" e a tela atual (Outlet). Sem sessão (ao abrir ou por
// um 401 no meio do uso), vai para /entrar e guarda a tela pedida, para voltar a ela depois de entrar. Líder,
// discipulador e rede vão para a área deles (/minha).
export function CoordenacaoLayout() {
  const { estado, verificar, sair } = useSessao();
  const usuario = useGuardaDaArea("coordenacao");
  const [saida, setSaida] = useState<Saida>({ saindo: false, erro: null });

  async function sairDoSistema() {
    // Saindo, o "Sair" fica com aria-disabled (continua no Tab, com a dica dizendo por quê): o AppShell barra o
    // clique, e aqui também, por garantia.
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

  if (usuario) {
    return (
      <AppShell
        area="Coordenação"
        itens={itensDaNavegacao(usuario.papel)}
        conta={{
          nome: usuario.nome,
          detalhe: ROTULO_PAPEL[usuario.papel],
          aoSair: () => void sairDoSistema(),
          ...saida,
        }}
      >
        <Outlet />
      </AppShell>
    );
  }

  return (
    <PublicShell>
      {estado.situacao === "erro" ? (
        <ErrorState
          titulo="Não foi possível conferir o seu acesso."
          mensagem={mensagemDoErro(estado.erro)}
          aoTentarDeNovo={verificar}
        />
      ) : (
        <Loading texto="Conferindo o seu acesso…" />
      )}
    </PublicShell>
  );
}
