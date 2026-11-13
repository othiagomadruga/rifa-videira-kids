import { Link, useLocation } from "react-router";
import { classesBotao, ComDica, PageHeader } from "../../components/ui";
import { IconeDaTela } from "../entrar/IconeDaTela";
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
      {/* A bússola acima do título (RIFA-050): a pessoa se perdeu. */}
      <IconeDaTela nome="bussola" />
      <PageHeader
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
