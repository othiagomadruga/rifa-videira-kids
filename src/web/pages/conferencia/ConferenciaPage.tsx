import { Suspense, lazy } from "react";
import { Loading, PageHeader } from "../../components/ui";

// A conferência pelo CSV (RIFA-012) lê o arquivo no navegador: o leitor do CSV, o resultado, o "Recuperar"
// e o estilo dela vêm num pacote à parte, carregado só aqui (como a configuração da Campanha). O pacote
// principal também serve as telas públicas (ranking e telão), que nunca abrem esta tela. Enquanto ele
// chega, o cabeçalho e o carregando.
const ConferenciaPeloCsv = lazy(() =>
  import("./ConferenciaPeloCsv").then((modulo) => ({
    default: modulo.ConferenciaPeloCsv,
  })),
);

export function ConferenciaPage() {
  return (
    <>
      <PageHeader
        titulo="Conferência"
        descricao="Compare as vendas da Rifei com as do sistema e recupere as que se perderam."
      />
      <Suspense fallback={<Loading texto="Carregando a conferência…" />}>
        <ConferenciaPeloCsv />
      </Suspense>
    </>
  );
}
