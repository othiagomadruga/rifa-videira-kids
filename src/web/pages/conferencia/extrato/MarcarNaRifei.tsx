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

/** Um pedido da lista "Para marcar": o número e uma linha que o descreve (célula, bilhetes, valor). */
export type PedidoParaMarcar = { id: string; descricao: string };

type Props = {
  /** Os pedidos de "Para marcar como pago na Rifei", na ordem da lista. */
  pedidos: readonly PedidoParaMarcar[];
  aoAnunciar: (texto: string) => void;
  /** Busca os pedidos de novo (a venda marcada passa a contar quando o webhook chega). */
  aoBuscarDeNovo: () => void;
};

export type EstadoDaMarcacao =
  | { tipo: "parado" }
  | { tipo: "confirmando"; ids: string[] }
  | { tipo: "marcando"; ids: string[] }
  | {
      tipo: "feito";
      total: number;
      marcados: number;
      itens: ItemMarcarPagosRifei[];
    }
  | { tipo: "erro"; mensagem: string; semConfiguracao: boolean };

/**
 * A marcação na Rifei (RIFA-070, D32), da confirmação ao resultado, usada pela lista selecionada e pelo "Marcar à
 * mão": confirmar(ids) abre a confirmação; o resultado vem por pedido.
 */
export function useMarcacaoNaRifei(aoAnunciar: (texto: string) => void) {
  const [estado, setEstado] = useState<EstadoDaMarcacao>({ tipo: "parado" });

  async function marcar(ids: string[]) {
    setEstado({ tipo: "marcando", ids });
    try {
      const resposta = await marcarPagosNaRifei(ids);
      setEstado({
        tipo: "feito",
        total: ids.length,
        marcados: resposta.marcados,
        itens: resposta.itens,
      });
      aoAnunciar(TEXTOS.resultadoTitulo(resposta.marcados, ids.length));
    } catch (erro) {
      // Sem token nenhum: a tela orienta a colar o token (ou usar o caminho manual). O token ilegível ou recusado
      // traz a própria mensagem ("cole um novo").
      const semConfiguracao =
        erro instanceof ErroApi &&
        erro.codigo === "nao_configurado" &&
        !/cole um novo/.test(erro.mensagem);
      const mensagem = semConfiguracao
        ? TEXTOS.semConfiguracao
        : mensagemDoErro(erro);
      setEstado({ tipo: "erro", mensagem, semConfiguracao });
      aoAnunciar(mensagem);
    }
  }

  return {
    estado,
    confirmar: (ids: string[]) => setEstado({ tipo: "confirmando", ids }),
    cancelar: () => {
      if (estado.tipo !== "marcando") setEstado({ tipo: "parado" });
    },
    marcar,
  };
}

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

const MARCADOS = new Set(["marcado", "restaurado_e_marcado"]);

/** A confirmação com os números e, depois, o resultado de cada pedido (ou o erro) e o "Atualizar". */
export function MarcacaoNaRifei({
  marcacao,
  aoBuscarDeNovo,
}: {
  marcacao: ReturnType<typeof useMarcacaoNaRifei>;
  aoBuscarDeNovo: () => void;
}) {
  const { estado } = marcacao;
  const marcando = estado.tipo === "marcando";
  return (
    <>
      {(estado.tipo === "confirmando" || estado.tipo === "marcando") && (
        <Dialogo
          aberto
          papel="alertdialog"
          titulo={TEXTOS.titulo(estado.ids.length)}
          descricao={TEXTOS.descricao}
          aoFechar={marcacao.cancelar}
          dicaFechar={marcando ? TEXTOS.dicaMarcando : TEXTOS.dicaCancelar}
          rodape={
            <>
              <ComDica
                texto={marcando ? TEXTOS.dicaMarcando : TEXTOS.dicaCancelar}
              >
                <Button
                  variante="secundario"
                  aria-disabled={marcando || undefined}
                  onClick={marcacao.cancelar}
                >
                  {TEXTOS.cancelar}
                </Button>
              </ComDica>
              <ComDica texto={marcando ? TEXTOS.dicaMarcando : TEXTOS.dica}>
                <Button
                  aria-disabled={marcando || undefined}
                  onClick={() => {
                    if (!marcando) void marcacao.marcar(estado.ids);
                  }}
                >
                  {marcando ? TEXTOS.marcando : TEXTOS.confirmar}
                </Button>
              </ComDica>
            </>
          }
        >
          <p className="extrato-codigos">{estado.ids.join(", ")}</p>
        </Dialogo>
      )}

      {estado.tipo === "feito" && (
        <>
          <Aviso
            tom={
              estado.itens.every((item) => MARCADOS.has(item.resultado))
                ? "sucesso"
                : "alerta"
            }
            titulo={TEXTOS.resultadoTitulo(estado.marcados, estado.total)}
            anuncio="nenhum"
          >
            <p>{TEXTOS.resultadoTexto}</p>
            <ComDica texto={TEXTOS.dicaBuscarDeNovo}>
              <Button variante="secundario" onClick={aoBuscarDeNovo}>
                {TEXTOS.buscarDeNovo}
              </Button>
            </ComDica>
          </Aviso>
          <DataTable
            colunas={COLUNAS}
            linhas={estado.itens}
            chaveDaLinha={(item) => item.pedido_id}
            legenda={TEXTOS.legendaResultado}
          />
        </>
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
    </>
  );
}

// "Marcar como pago na Rifei" da lista "Para marcar" (RIFA-070, D32), só o admin: uma caixa por pedido (todas
// marcadas ao abrir), "Selecionar todos" e o botão com a quantidade escolhida; confirma mostrando os números, manda ao
// sistema (que marca na Rifei pela API do painel) e mostra o resultado de cada pedido. O "Copiar os números" continua
// ao lado, para o caminho manual. Marcando, os botões ficam indisponíveis com aria-disabled (RIFA-045).
export function MarcarNaRifei({ pedidos, aoAnunciar, aoBuscarDeNovo }: Props) {
  // Guarda os DESMARCADOS: um pedido novo na lista (depois de Atualizar) já vem marcado.
  const [desmarcados, setDesmarcados] = useState<ReadonlySet<string>>(
    () => new Set(),
  );
  const marcacao = useMarcacaoNaRifei(aoAnunciar);
  const ocupado = marcacao.estado.tipo === "marcando";
  const selecionados = pedidos
    .map((pedido) => pedido.id)
    .filter((id) => !desmarcados.has(id));
  const todos = selecionados.length === pedidos.length;

  function alternar(id: string, marcado: boolean) {
    setDesmarcados((atual) => {
      const novo = new Set(atual);
      if (marcado) novo.delete(id);
      else novo.add(id);
      return novo;
    });
  }

  return (
    <div className="extrato-bloco">
      <fieldset className="extrato-selecao">
        <legend className="extrato-selecao__legenda">{TEXTOS.legenda}</legend>
        <div className="extrato-acoes">
          <ComDica texto={TEXTOS.dicaSelecionarTodos}>
            <Button
              variante="secundario"
              tamanho="pequeno"
              onClick={() =>
                setDesmarcados(
                  todos
                    ? new Set(pedidos.map((pedido) => pedido.id))
                    : new Set(),
                )
              }
            >
              {todos ? TEXTOS.desmarcarTodos : TEXTOS.selecionarTodos}
            </Button>
          </ComDica>
        </div>
        <ul className="extrato-selecao__lista">
          {pedidos.map((pedido) => (
            <li key={pedido.id}>
              <label className="extrato-escolha">
                <input
                  type="checkbox"
                  className="extrato-escolha__caixa"
                  checked={!desmarcados.has(pedido.id)}
                  onChange={(evento) =>
                    alternar(pedido.id, evento.currentTarget.checked)
                  }
                />
                <span className="extrato-escolha__textos">
                  <span className="extrato-codigo">Pedido {pedido.id}</span>
                  <span className="extrato-suave">{pedido.descricao}</span>
                </span>
              </label>
            </li>
          ))}
        </ul>
      </fieldset>
      <div className="extrato-acoes">
        <ComDica
          texto={
            selecionados.length === 0
              ? TEXTOS.dicaNenhum
              : ocupado
                ? TEXTOS.dicaMarcando
                : TEXTOS.dica
          }
        >
          <Button
            aria-disabled={selecionados.length === 0 || ocupado || undefined}
            onClick={() => {
              if (selecionados.length > 0 && !ocupado)
                marcacao.confirmar(selecionados);
            }}
          >
            {TEXTOS.botao(selecionados.length)}
          </Button>
        </ComDica>
      </div>
      <MarcacaoNaRifei marcacao={marcacao} aoBuscarDeNovo={aoBuscarDeNovo} />
    </div>
  );
}
