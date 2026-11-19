import { Suspense, lazy } from "react";
import { Loading, PageHeader } from "../../components/ui";
import { DICA_DO_MENU } from "../coordenacao/textos";
import { useBuscarRedes } from "../../lib/redes";

// A configuração valida com os schemas do contrato (zod, cerca de 29 kB gzip). Carregada só aqui,
// ela fica fora do pacote principal, que também serve as telas públicas (ranking e telão).
const ConfiguracaoCampanha = lazy(() =>
  import("./ConfiguracaoCampanha").then((modulo) => ({
    default: modulo.ConfiguracaoCampanha,
  })),
);

export function CampanhaPage() {
  // Com uma rede só, a Campanha não mostra o acesso nem a mensagem das redes (RIFA-065, D30). A tela não recebe a
  // hierarquia: sem saber quantas redes há, pergunta à API junto com a campanha.
  useBuscarRedes();
  return (
    <>
      <PageHeader
        titulo="Campanha"
        ajuda={DICA_DO_MENU.campanha}
        descricao="Nome, slug da Rifei, datas e períodos, preço, meta, o que o público vê, as regras de pedidos e acessos e as mensagens do link pessoal."
      />
      <Suspense fallback={<Loading texto="Carregando a campanha…" />}>
        <ConfiguracaoCampanha />
      </Suspense>
    </>
  );
}
