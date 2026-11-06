import { Outlet } from "react-router";
import { AppShell } from "../../components/ui";
import { ITENS_NAVEGACAO_COORDENACAO } from "./telas";

// Moldura de todas as telas em /coordenacao: navegação + a tela atual (Outlet).
export function CoordenacaoLayout() {
  return (
    <AppShell area="Coordenação" itens={ITENS_NAVEGACAO_COORDENACAO}>
      <Outlet />
    </AppShell>
  );
}
