import { useEffect, useState } from "react";
import { Outlet, useLocation, useNavigate } from "react-router";
import {
  AppShell,
  ErrorState,
  Loading,
  PublicShell,
} from "../../components/ui";
import { mensagemDoErro } from "../../lib/api";
import {
  ROTULO_PAPEL,
  guardarDestino,
  useSessao,
  type EstadoNavegacaoEntrar,
} from "../../lib/sessao";
import { itensDaNavegacao } from "./telas";

type Saida = { saindo: boolean; erro: string | null };

// Moldura de todas as telas em /coordenacao, só com sessão (guarda): menu conforme o papel, nome de quem
// está conectado com o botão "Sair" e a tela atual (Outlet). Sem sessão (ao abrir ou por um 401 no meio
// do uso), vai para /entrar e guarda a tela pedida, para voltar a ela depois de entrar.
export function CoordenacaoLayout() {
  const { estado, verificar, sair } = useSessao();
  const navigate = useNavigate();
  const { pathname, search } = useLocation();
  const [saida, setSaida] = useState<Saida>({ saindo: false, erro: null });
  const { situacao } = estado;
  const motivo = estado.situacao === "desconectada" ? estado.motivo : null;

  useEffect(() => {
    if (situacao === "desconhecida") verificar();
  }, [situacao, verificar]);

  useEffect(() => {
    if (motivo === null) return;
    const destino: EstadoNavegacaoEntrar = { motivo };
    if (motivo !== "saiu") {
      destino.de = `${pathname}${search}`;
      guardarDestino(destino.de);
    }
    void navigate("/entrar", { replace: true, state: destino });
  }, [motivo, pathname, search, navigate]);

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

  if (estado.situacao === "conectada") {
    const { usuario } = estado;
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
