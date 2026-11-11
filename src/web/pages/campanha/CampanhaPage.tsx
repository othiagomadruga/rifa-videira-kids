import { Suspense, lazy } from "react";
import { Loading, PageHeader } from "../../components/ui";

// A configuração valida com os schemas do contrato (zod, cerca de 29 kB gzip). Carregada só aqui,
// ela fica fora do pacote principal, que também serve as telas públicas (ranking e telão).
const ConfiguracaoCampanha = lazy(() =>
  import("./ConfiguracaoCampanha").then((modulo) => ({
    default: modulo.ConfiguracaoCampanha,
  })),
);

export function CampanhaPage() {
  return (
    <>
      <PageHeader
        titulo="Campanha"
        descricao="Nome, slug da Rifei, datas e períodos, preço, meta, o que o público vê, as regras de pedidos e acessos e as mensagens do link pessoal."
      />
      <Suspense fallback={<Loading texto="Carregando a campanha…" />}>
        <ConfiguracaoCampanha />
      </Suspense>
    </>
  );
}
