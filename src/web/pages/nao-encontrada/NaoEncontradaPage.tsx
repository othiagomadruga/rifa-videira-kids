import { Link, useLocation } from "react-router";
import { classesBotao, ComDica, PageHeader } from "../../components/ui";
import { dicaVoltarAoInicio } from "./textos";

type Props = {
  /** Para onde o botão leva: "/" nas telas abertas, "/coordenacao" na coordenação. */
  inicio?: string;
};

// 404 do site (o Worker devolve o index.html para qualquer rota; o React decide).
export function NaoEncontradaPage({ inicio = "/" }: Props) {
  const { pathname } = useLocation();
  return (
    <>
      {/* A bússola ao lado do título (RIFA-050; no PageHeader desde a RIFA-053): a pessoa se perdeu. */}
      <PageHeader
        icone="bussola"
        titulo="Página não encontrada"
        descricao={
          <>
            Não existe nada no endereço <code>{pathname}</code>.
          </>
        }
      />
      <div>
        <ComDica texto={dicaVoltarAoInicio(inicio)}>
          <Link
            to={inicio}
            className={classesBotao({ variante: "secundario" })}
          >
            Voltar ao início
          </Link>
        </ComDica>
      </div>
    </>
  );
}
