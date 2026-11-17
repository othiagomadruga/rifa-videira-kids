import { Suspense, lazy } from "react";
import { Loading, PageHeader } from "../../components/ui";
import { DICA_DO_MENU } from "../coordenacao/textos";

// A conferência pelo CSV (RIFA-012) lê o arquivo no navegador: o leitor do CSV, o resultado, o "Recuperar"
// e o estilo dela vêm num pacote à parte, carregado só aqui (como a configuração da Campanha). O pacote
// principal também serve as telas públicas (ranking e telão), que nunca abrem esta tela. Enquanto ele
// chega, o cabeçalho e o carregando.
const ConferenciaPeloCsv = lazy(() =>
  import("./ConferenciaPeloCsv").then((modulo) => ({
    default: modulo.ConferenciaPeloCsv,
  })),
);

// O extrato do banco (RIFA-059, Pix manual) vem noutro pacote à parte, com o próprio leitor e o próprio estilo. Os
// dois ficam no mesmo Suspense: a página aparece de uma vez, sem a conferência pelo CSV pular para baixo.
const ExtratoDoBanco = lazy(() =>
  import("./extrato/ExtratoDoBanco").then((modulo) => ({
    default: modulo.ExtratoDoBanco,
  })),
);

export function ConferenciaPage() {
  return (
    <>
      <PageHeader
        titulo="Conferência"
        ajuda={DICA_DO_MENU.conferencia}
        descricao="Confira os Pix do extrato do banco e compare as vendas da Rifei com as do sistema."
      />
      <Suspense fallback={<Loading texto="Carregando a conferência…" />}>
        <div className="pilha">
          <ExtratoDoBanco />
          <ConferenciaPeloCsv />
        </div>
      </Suspense>
    </>
  );
}
