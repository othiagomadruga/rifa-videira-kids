import { Link } from "react-router";
import { Aviso, classesBotao } from "../../components/ui";
import { textoDoAlerta } from "./alerta-webhook";
import { useEstadoWebhook } from "./useEstadoWebhook";
import "./alerta-webhook.css";

// Alerta de webhook parado (RIFA-025, D16), no topo da Visão geral e da tela Pedidos. Lê o estado do webhook a
// cada 5 min com a aba visível. Os avisos (erros, sem vendas há horas, nunca recebeu) entram numa região viva
// fixa, que existe desde o começo (um role="status" que já entra com o texto pode não ser lido); no "ok", só uma
// linha discreta, fora da região viva (ela mudaria a cada consulta e seria ruído). Falha ao consultar: a tela
// segue normal, com uma linha discreta, e a próxima rodada tenta de novo.
export function AlertaWebhook() {
  const { estado, falha } = useEstadoWebhook();
  const texto = estado ? textoDoAlerta(estado) : null;

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
                <Link
                  to={texto.link.para}
                  className={classesBotao({ variante: "secundario" })}
                >
                  {texto.link.texto}
                </Link>
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
          <span aria-hidden="true" className="alerta-webhook-linha__ponto" />
          <span>{texto.texto}</span>
        </p>
      )}
      {estado === null && falha !== null && (
        <p className="alerta-webhook-linha">
          Não foi possível conferir agora se as vendas estão chegando pela
          Rifei; o sistema tenta de novo em alguns minutos.
        </p>
      )}
    </>
  );
}
