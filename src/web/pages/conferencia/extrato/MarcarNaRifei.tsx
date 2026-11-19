import { useState } from "react";
import {
  Aviso,
  Button,
  ComDica,
  DataTable,
  Dialogo,
  type ColunaTabela,
} from "../../../components/ui";
import { ErroApi, mensagemDoErro } from "../../../lib/api";
import {
  marcarPagosNaRifei,
  type ItemMarcarPagosRifei,
} from "./marcar-na-rifei-api";
import { MARCAR_NA_RIFEI as TEXTOS } from "./textos";

type Props = {
  /** Os números dos pedidos de "Para marcar como pago na Rifei", na ordem da lista. */
  pedidos: readonly string[];
  aoAnunciar: (texto: string) => void;
  /** Busca os pedidos de novo (a venda marcada passa a contar quando o webhook chega). */
  aoBuscarDeNovo: () => void;
};

type Estado =
  | { tipo: "parado" }
  | { tipo: "confirmando" }
  | { tipo: "marcando" }
  | { tipo: "feito"; marcados: number; itens: ItemMarcarPagosRifei[] }
  | { tipo: "erro"; mensagem: string; semConfiguracao: boolean };

const MARCADOS = new Set(["marcado", "restaurado_e_marcado"]);

const COLUNAS: ColunaTabela<ItemMarcarPagosRifei>[] = [
  {
    chave: "pedido",
    titulo: "Pedido",
    principal: true,
    celula: ({ pedido_id }) => (
      <span className="extrato-codigo">{pedido_id}</span>
    ),
  },
  {
    chave: "resultado",
    titulo: "O que aconteceu",
    celula: ({ resultado, mensagem }) => (
      <span className="extrato-pix">
        <span>{TEXTOS.resultados[resultado]}</span>
        {mensagem && <span className="extrato-suave">{mensagem}</span>}
      </span>
    ),
  },
];

// "Marcar como pago na Rifei" (RIFA-070, D32), só o admin: confirma, manda os números ao sistema (que marca na Rifei
// pela API do painel) e mostra o resultado de cada pedido. O "Copiar os números" continua ao lado, para o caminho
// manual. Marcando, os botões ficam indisponíveis com aria-disabled (RIFA-045), como no "Recuperar".
export function MarcarNaRifei({ pedidos, aoAnunciar, aoBuscarDeNovo }: Props) {
  const [estado, setEstado] = useState<Estado>({ tipo: "parado" });
  const marcando = estado.tipo === "marcando";

  async function marcar() {
    if (marcando) return;
    setEstado({ tipo: "marcando" });
    try {
      const resposta = await marcarPagosNaRifei(pedidos);
      setEstado({
        tipo: "feito",
        marcados: resposta.marcados,
        itens: resposta.itens,
      });
      aoAnunciar(TEXTOS.resultadoTitulo(resposta.marcados, pedidos.length));
    } catch (erro) {
      const semConfiguracao =
        erro instanceof ErroApi && erro.codigo === "nao_configurado";
      const mensagem = semConfiguracao
        ? TEXTOS.semConfiguracao
        : mensagemDoErro(erro);
      setEstado({ tipo: "erro", mensagem, semConfiguracao });
      aoAnunciar(mensagem);
    }
  }

  const naoMarcados =
    estado.tipo === "feito"
      ? estado.itens.filter((item) => !MARCADOS.has(item.resultado))
      : [];

  return (
    <div className="extrato-bloco">
      <div className="extrato-acoes">
        <ComDica texto={TEXTOS.dica}>
          <Button onClick={() => setEstado({ tipo: "confirmando" })}>
            {TEXTOS.botao(pedidos.length)}
          </Button>
        </ComDica>
      </div>

      {(estado.tipo === "confirmando" || marcando) && (
        <Dialogo
          aberto
          papel="alertdialog"
          titulo={TEXTOS.titulo(pedidos.length)}
          descricao={TEXTOS.descricao}
          aoFechar={() => {
            if (!marcando) setEstado({ tipo: "parado" });
          }}
          dicaFechar={marcando ? TEXTOS.dicaMarcando : TEXTOS.dicaCancelar}
          rodape={
            <>
              <ComDica
                texto={marcando ? TEXTOS.dicaMarcando : TEXTOS.dicaCancelar}
              >
                <Button
                  variante="secundario"
                  aria-disabled={marcando || undefined}
                  onClick={() => {
                    if (!marcando) setEstado({ tipo: "parado" });
                  }}
                >
                  {TEXTOS.cancelar}
                </Button>
              </ComDica>
              <ComDica texto={marcando ? TEXTOS.dicaMarcando : TEXTOS.dica}>
                <Button
                  aria-disabled={marcando || undefined}
                  onClick={() => void marcar()}
                >
                  {marcando ? TEXTOS.marcando : TEXTOS.confirmar}
                </Button>
              </ComDica>
            </>
          }
        >
          <p className="extrato-codigos">{pedidos.join(", ")}</p>
        </Dialogo>
      )}

      {estado.tipo === "feito" && (
        <Aviso
          tom={naoMarcados.length === 0 ? "sucesso" : "alerta"}
          titulo={TEXTOS.resultadoTitulo(estado.marcados, pedidos.length)}
          anuncio="nenhum"
        >
          <p>{TEXTOS.resultadoTexto}</p>
          <ComDica texto={TEXTOS.dicaBuscarDeNovo}>
            <Button variante="secundario" onClick={aoBuscarDeNovo}>
              {TEXTOS.buscarDeNovo}
            </Button>
          </ComDica>
        </Aviso>
      )}
      {naoMarcados.length > 0 && (
        <DataTable
          colunas={COLUNAS}
          linhas={naoMarcados}
          chaveDaLinha={(item) => item.pedido_id}
          legenda={TEXTOS.naoMarcados}
        />
      )}
      {estado.tipo === "erro" && (
        <Aviso
          tom={estado.semConfiguracao ? "info" : "perigo"}
          titulo={estado.semConfiguracao ? undefined : TEXTOS.falhou}
          anuncio="nenhum"
        >
          <p>{estado.mensagem}</p>
        </Aviso>
      )}
    </div>
  );
}
