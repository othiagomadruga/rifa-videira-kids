import { useRef, useState, type FormEvent } from "react";
import type { RespostaBuscarPedidoRifei } from "../../../../shared/contracts/api";
import {
  Aviso,
  Badge,
  Button,
  Card,
  ComDica,
  Input,
} from "../../../components/ui";
import { mensagemDoErro } from "../../../lib/api";
import { formatarMoeda } from "../../../lib/formatadores";
import { buscarPedidoParaMarcar } from "./marcar-na-rifei-api";
import { MarcacaoNaRifei, useMarcacaoNaRifei } from "./MarcarNaRifei";
import { MARCAR_A_MAO as TEXTOS, STATUS, plural } from "./textos";
import { AJUDA as AJUDA_DO_EXTRATO } from "./textos";

type Achado = RespostaBuscarPedidoRifei["pedidos"][number];
type Busca =
  | { tipo: "parada" }
  | { tipo: "buscando" }
  | { tipo: "achou"; numero: string; pedidos: Achado[] }
  | { tipo: "erro"; mensagem: string };

const TOM_STATUS = {
  in_process: "neutro",
  expired: "alerta",
  approved: "sucesso",
} as const;

// "Marcar um pedido à mão" (RIFA-070, D32), só o admin: para o Pix que o extrato não achou ou um comprovante. O admin
// digita o número do pedido ou de um bilhete; o sistema acha o pedido na campanha e mostra o que a tela de Pedidos já
// mostra (célula, quantidade, valor, situação; nada do comprador). Com confirmação, marca como pago na Rifei.
export function MarcarAMao({
  aoAnunciar,
  aoMarcar,
}: {
  aoAnunciar: (texto: string) => void;
  /** Depois de marcar, "Atualizar" (busca o pedido de novo e, se houver extrato, a comparação). */
  aoMarcar?: () => void;
}) {
  const [numero, setNumero] = useState("");
  const [busca, setBusca] = useState<Busca>({ tipo: "parada" });
  const marcacao = useMarcacaoNaRifei(aoAnunciar);
  const ultimo = useRef("");

  async function procurar(texto: string) {
    if (texto.trim() === "") return;
    ultimo.current = texto.trim();
    setBusca({ tipo: "buscando" });
    try {
      const resposta = await buscarPedidoParaMarcar(texto);
      setBusca({
        tipo: "achou",
        numero: texto.trim(),
        pedidos: resposta.pedidos,
      });
      aoAnunciar(
        resposta.pedidos.length === 0
          ? TEXTOS.naoAchou(texto.trim())
          : plural(resposta.pedidos.length, "pedido achado", "pedidos achados"),
      );
    } catch (erro) {
      const mensagem = mensagemDoErro(erro);
      setBusca({ tipo: "erro", mensagem });
      aoAnunciar(mensagem);
    }
  }

  function enviar(evento: FormEvent) {
    evento.preventDefault();
    if (busca.tipo !== "buscando") void procurar(numero);
  }

  return (
    <Card titulo={TEXTOS.titulo} ajuda={AJUDA_DO_EXTRATO.marcarAMao}>
      <div className="extrato-bloco">
        <p className="extrato-suave">{TEXTOS.explicacao}</p>
        <form className="extrato-busca" onSubmit={enviar}>
          <Input
            ajuda={AJUDA_DO_EXTRATO.numeroAMao}
            rotulo={TEXTOS.rotulo}
            value={numero}
            maxLength={128}
            onChange={(evento) => setNumero(evento.target.value)}
            autoComplete="off"
            spellCheck={false}
            inputMode="text"
          />

          <ComDica texto={TEXTOS.dicaBuscar}>
            <Button
              type="submit"
              variante="secundario"
              aria-disabled={
                busca.tipo === "buscando" || numero.trim() === "" || undefined
              }
            >
              {busca.tipo === "buscando" ? TEXTOS.buscando : TEXTOS.buscar}
            </Button>
          </ComDica>
        </form>

        {busca.tipo === "erro" && (
          <Aviso tom="perigo" anuncio="nenhum">
            <p>{busca.mensagem}</p>
          </Aviso>
        )}
        {busca.tipo === "achou" && busca.pedidos.length === 0 && (
          <Aviso
            tom="alerta"
            titulo={TEXTOS.naoAchou(busca.numero)}
            anuncio="nenhum"
          >
            <p>{TEXTOS.oQueConferir}</p>
          </Aviso>
        )}
        {busca.tipo === "achou" &&
          busca.pedidos.map(({ achado_por, pedido }) => (
            <div key={pedido.id} className="extrato-achado">
              <p>
                <span className="extrato-codigo">Pedido {pedido.id}</span>{" "}
                <Badge tom={TOM_STATUS[pedido.status]}>
                  {STATUS[pedido.status]}
                </Badge>{" "}
                {achado_por === "bilhete" && (
                  <Badge tom="info">{TEXTOS.achadoPeloBilhete}</Badge>
                )}
              </p>
              <p>
                {pedido.celula_nome ?? "Sem célula"} ·{" "}
                {plural(pedido.qtd_bilhetes, "bilhete", "bilhetes")} ·{" "}
                {formatarMoeda(pedido.total_centavos)}
              </p>
              {pedido.desconsiderado ? (
                <p className="extrato-atencao">{TEXTOS.desconsiderado}</p>
              ) : pedido.status === "approved" ? (
                <Aviso tom="sucesso" anuncio="nenhum">
                  <p>{TEXTOS.jaPago}</p>
                </Aviso>
              ) : (
                <div className="extrato-acoes">
                  <ComDica texto={TEXTOS.dicaMarcar}>
                    <Button
                      aria-disabled={
                        marcacao.estado.tipo === "marcando" || undefined
                      }
                      onClick={() => {
                        if (marcacao.estado.tipo !== "marcando")
                          marcacao.confirmar([pedido.id]);
                      }}
                    >
                      {TEXTOS.marcar}
                    </Button>
                  </ComDica>
                </div>
              )}
            </div>
          ))}
        <MarcacaoNaRifei
          marcacao={marcacao}
          aoBuscarDeNovo={() => {
            void procurar(ultimo.current);
            aoMarcar?.();
          }}
        />
      </div>
    </Card>
  );
}
