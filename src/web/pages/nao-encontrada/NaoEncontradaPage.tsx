import { Link, useLocation } from "react-router";
import { classesBotao, PageHeader } from "../../components/ui";

type Props = {
  /** Para onde o botão leva: "/" nas telas abertas, "/coordenacao" na coordenação. */
  inicio?: string;
};

// 404 do site (o Worker devolve o index.html para qualquer rota; o React decide).
export function NaoEncontradaPage({ inicio = "/" }: Props) {
  const { pathname } = useLocation();
  return (
    <>
      <PageHeader
        titulo="Página não encontrada"
        descricao={
          <>
            Não existe nada no endereço <code>{pathname}</code>.
          </>
        }
      />
      <div>
        <Link to={inicio} className={classesBotao({ variante: "secundario" })}>
          Voltar ao início
        </Link>
      </div>
    </>
  );
}
