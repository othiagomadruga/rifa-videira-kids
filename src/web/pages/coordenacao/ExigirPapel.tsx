import type { ReactNode } from "react";
import type { Papel } from "../../../shared/contracts";
import { Aviso, PageHeader } from "../../components/ui";
import { ROTULO_PAPEL, useUsuarioConectado } from "../../lib/sessao";

type Props = {
  papeis: readonly Papel[];
  /** Título da tela (o mesmo do menu): vira o <h1> do aviso. */
  titulo: string;
  children: ReactNode;
};

// Tela só para alguns papéis (TELAS_COORDENACAO, `papeis`): quem não tem o papel vê "sem permissão" e a
// tela nem chega a ser montada (nada é pedido à API). A API recusa do mesmo jeito (403).
export function ExigirPapel({ papeis, titulo, children }: Props) {
  const usuario = useUsuarioConectado();
  if (papeis.includes(usuario.papel)) return children;

  const quem = papeis.map((papel) => ROTULO_PAPEL[papel]).join(" ou ");
  return (
    <>
      <PageHeader titulo={titulo} />
      <Aviso tom="alerta" titulo="Sem permissão para esta tela">
        <p>
          Esta tela é só para quem tem o papel {quem}. Se precisar de um link
          novo ou de mudar algum acesso, fale com um admin da coordenação.
        </p>
      </Aviso>
    </>
  );
}
