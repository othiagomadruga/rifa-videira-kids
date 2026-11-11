// Remover afiliado de teste (RIFA-031, D20; só admin): confirmação num diálogo de alerta. A API só remove o
// afiliado sem pedido que conte (todos desconsiderados, ou nenhum); senão, 409 `afiliado_com_pedidos` com quantos e
// quais pedidos ainda contam: o diálogo mostra a lista, cada um com o link para a busca na tela Pedidos, e diz para
// desconsiderar antes.
import { useRef, useState, type RefObject } from "react";
import { Link } from "react-router";
import { Aviso, Button, Dialogo } from "../../components/ui";
import { ErroApi, mensagemDoErro } from "../../lib/api";
import {
  linkDoPedido,
  pedidosQueContam,
  type PedidosQueContam,
} from "./adesao-api";
import { quantidade } from "./formatos";

type Falha =
  | { tipo: "com_pedidos"; pedidos: PedidosQueContam }
  | { tipo: "outra"; texto: string };

type Props = {
  affiliateId: number;
  /** Onde ele está vinculado (null = sem célula). */
  celulaNome: string | null;
  /** Remove (a API) e avisa na tela; lança o erro se falhar. */
  aoRemover: () => Promise<void>;
  aoFechar: () => void;
  /** Recebe o foco ao fechar (o botão que abriu sai da tela junto com o afiliado). */
  focoAoFechar?: RefObject<HTMLElement | null>;
};

export function DialogoRemoverAfiliado({
  affiliateId,
  celulaNome,
  aoRemover,
  aoFechar,
  focoAoFechar,
}: Props) {
  const [removendo, setRemovendo] = useState(false);
  const [falha, setFalha] = useState<Falha | null>(null);
  const emAndamento = useRef(false);

  async function confirmar() {
    if (emAndamento.current) return;
    emAndamento.current = true;
    setRemovendo(true);
    setFalha(null);
    try {
      await aoRemover();
    } catch (erro) {
      const pedidos = pedidosQueContam(erro);
      setFalha(
        pedidos
          ? { tipo: "com_pedidos", pedidos }
          : {
              tipo: "outra",
              texto:
                erro instanceof ErroApi && erro.status === 404
                  ? "Este afiliado não existe mais: a lista vai ser atualizada."
                  : mensagemDoErro(erro),
            },
      );
      emAndamento.current = false;
      setRemovendo(false);
    }
  }

  const comPedidos = falha?.tipo === "com_pedidos" ? falha.pedidos : null;

  return (
    <Dialogo
      aberto
      papel="alertdialog"
      titulo={`Remover o afiliado ${affiliateId}?`}
      descricao="Use só para um afiliado de teste: ele sai do sistema, e os pedidos desconsiderados dele ficam sem afiliado."
      aoFechar={() => {
        if (!removendo) aoFechar();
      }}
      focoAoFechar={focoAoFechar}
      rodape={
        <>
          <Button variante="secundario" onClick={aoFechar} disabled={removendo}>
            {comPedidos ? "Entendi" : "Cancelar"}
          </Button>
          {!comPedidos && (
            <Button
              variante="perigo"
              disabled={removendo}
              onClick={() => void confirmar()}
            >
              {removendo ? "Removendo…" : "Remover afiliado"}
            </Button>
          )}
        </>
      }
    >
      <div className="adesao-remover">
        <p>
          {celulaNome
            ? `Ele está na ${celulaNome}. `
            : "Ele está sem célula. "}
          Só dá para remover se nenhum pedido dele conta. Se a Rifei mandar
          outra venda com este código, ele volta como sem célula.
        </p>
        {comPedidos && (
          <Aviso
            tom="perigo"
            titulo={`O afiliado ${affiliateId} tem ${quantidade(
              comPedidos.quantidade,
              "pedido que ainda conta",
              "pedidos que ainda contam",
            )}`}
          >
            <p>
              Desconsidere{" "}
              {comPedidos.quantidade === 1 ? "esse pedido" : "esses pedidos"} na
              tela Pedidos antes de remover (o admin, com “Permitir
              desconsiderar pedidos” ligado na Campanha):
            </p>
            <ul className="adesao-remover__pedidos">
              {comPedidos.ids.map((id) => (
                <li key={id}>
                  <Link to={linkDoPedido(id)}>Pedido {id}</Link>
                </li>
              ))}
            </ul>
            {comPedidos.quantidade > comPedidos.ids.length && (
              <p>
                E mais{" "}
                {quantidade(
                  comPedidos.quantidade - comPedidos.ids.length,
                  "pedido",
                  "pedidos",
                )}
                .
              </p>
            )}
            <p>
              Um pedido de outra campanha não sai daqui: nesse caso, o afiliado
              não é de teste e fica.
            </p>
          </Aviso>
        )}
        {falha?.tipo === "outra" && (
          <Aviso tom="perigo" titulo="Não foi possível remover">
            <p>{falha.texto}</p>
          </Aviso>
        )}
      </div>
    </Dialogo>
  );
}
