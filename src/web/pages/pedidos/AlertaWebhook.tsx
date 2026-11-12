import { Link, useLocation } from "react-router";
import { Aviso, ComDica, classesBotao } from "../../components/ui";
import {
  CAMINHO_TELA_PEDIDOS,
  horaDaConferencia,
  textoDoAlerta,
} from "./alerta-webhook";
import { useEstadoWebhook } from "./useEstadoWebhook";
import "./alerta-webhook.css";

const TENTA_DE_NOVO = "o sistema tenta de novo em alguns minutos.";

// Alerta de webhook parado (RIFA-025, D16), no topo da Visão geral e da tela Pedidos. Lê o estado do webhook a
// cada 5 min com a aba visível (guardado entre as telas). Os avisos (erros, sem vendas há horas, nunca recebeu)
// entram numa região viva fixa, que existe desde o começo (um role="status" que já entra com o texto pode não ser
// lido); no "ok", só uma linha discreta com a hora da conferência, fora da região viva (ela mudaria a cada
// consulta e seria ruído). Falha ao consultar: a tela segue normal; a linha discreta diz que a conferência falhou
// (e de quando é o que está na tela), e a próxima rodada tenta de novo.
export function AlertaWebhook() {
  const { estado, falha } = useEstadoWebhook();
  const { pathname, search } = useLocation();
  // Na própria tela Pedidos, o link das entregas com erro mantém os filtros dos pedidos.
  const naTelaPedidos =
    pathname.replace(/\/+$/, "") === CAMINHO_TELA_PEDIDOS
      ? new URLSearchParams(search)
      : null;
  const texto = estado ? textoDoAlerta(estado, naTelaPedidos) : null;
  const falhou = falha !== null;

  return (
    <>
      <div className="alerta-webhook" role="status">
        {texto?.tipo === "aviso" && (
          <Aviso
            tom={texto.tom}
            titulo={texto.titulo}
            anuncio="nenhum"
            acao={
              texto.link && (
                <ComDica texto={texto.link.dica}>
                  <Link
                    to={texto.link.para}
                    className={classesBotao({ variante: "secundario" })}
                  >
                    {texto.link.texto}
                  </Link>
                </ComDica>
              )
            }
          >
            {texto.paragrafos.map((paragrafo) => (
              <p key={paragrafo}>{paragrafo}</p>
            ))}
          </Aviso>
        )}
      </div>
      {texto?.tipo === "linha" && (
        <p className="alerta-webhook-linha">
          <span
            aria-hidden="true"
            className={`alerta-webhook-linha__ponto${falhou ? " alerta-webhook-linha__ponto--falha" : ""}`}
          />
          <span>
            {texto.texto}
            {falhou && ` A conferência seguinte falhou; ${TENTA_DE_NOVO}`}
          </span>
        </p>
      )}
      {estado !== null && texto?.tipo !== "linha" && falhou && (
        <p className="alerta-webhook-linha">
          {texto?.tipo === "aviso"
            ? `Este aviso é da conferência das ${horaDaConferencia(estado)}; a seguinte falhou e ${TENTA_DE_NOVO}`
            : `Conferido às ${horaDaConferencia(estado)}; a conferência seguinte falhou e ${TENTA_DE_NOVO}`}
        </p>
      )}
      {estado === null && falhou && (
        <p className="alerta-webhook-linha">
          Não foi possível conferir agora se as vendas estão chegando pela
          Rifei; {TENTA_DE_NOVO}
        </p>
      )}
    </>
  );
}
