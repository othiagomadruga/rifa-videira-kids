import { Suspense, lazy } from "react";
import { Loading, PageHeader } from "../../components/ui";
import { DICA_DO_MENU } from "../coordenacao/textos";

// Trilha de auditoria (RIFA-024, só admin: o menu e a rota pedem o papel em telas.ts). A lista vem num pacote
// à parte, carregado só aqui (como a configuração da Campanha e a /minha), com o próprio CSS.
const TrilhaDeAuditoria = lazy(() =>
  import("./TrilhaDeAuditoria").then((modulo) => ({
    default: modulo.TrilhaDeAuditoria,
  })),
);

export function TrilhaPage() {
  return (
    <>
      <PageHeader
        titulo="Trilha"
        ajuda={DICA_DO_MENU.trilha}
        descricao="Quem mudou o quê na campanha, nos vínculos de afiliado, na hierarquia e nos acessos, do mais novo para o mais antigo."
      />
      <Suspense fallback={<Loading texto="Carregando a trilha…" />}>
        <TrilhaDeAuditoria />
      </Suspense>
    </>
  );
}
