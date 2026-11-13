import { Suspense, lazy } from "react";
import { useUsuarioConectado } from "../../lib/sessao";
import { Cabecalho, EsqueletoDaVisao } from "./Cabecalho";

// Visão individual (RIFA-014, RF08, D12): o líder vê a célula; o discipulador, ele e as células dele; a rede,
// ela, os discipuladores e as células. Celular primeiro (360 px, legível ao sol): o % da meta e a meta de
// hoje em destaque, a situação, o período atual, a curva, a posição com os vizinhos e os primeiros da
// divisão e, para discipulador e rede, a equipe. Nunca dinheiro: a rota não devolve valores e esta pasta
// não os formata (guarda-minha.test.ts). Atualiza sozinha a cada minuto, com a aba visível.
//
// O conteúdo vem num pacote à parte, carregado só aqui (como a configuração da Campanha): o pacote principal
// também serve as telas públicas e a coordenação, que nunca abrem esta tela. Enquanto ele chega, o
// cabeçalho (da sessão) e o esqueleto dos cartões de cima (o mesmo de quando os números estão chegando: nada muda
// de desenho entre um e outro).
const VisaoIndividual = lazy(() =>
  import("./VisaoIndividual").then((modulo) => ({
    default: modulo.VisaoIndividual,
  })),
);

export function MinhaPage() {
  const usuario = useUsuarioConectado();
  return (
    <Suspense
      fallback={
        <>
          <Cabecalho alvo={usuario.alvo ?? null} nome={usuario.nome} />
          <EsqueletoDaVisao />
        </>
      }
    >
      <VisaoIndividual />
    </Suspense>
  );
}
