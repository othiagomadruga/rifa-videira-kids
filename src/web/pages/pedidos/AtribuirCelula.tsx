// Atribuir à mão a célula de uma venda sem célula pelo afiliado (RIFA-088, D41; só admin). A venda que chegou sem link
// de célula (sem afiliado, ou afiliado ainda não vinculado) passa a contar na célula escolhida em todo o sistema; o
// diálogo também troca a célula escolhida e tira a escolha ("Remover atribuição"). A célula do afiliado sempre vale:
// se o afiliado ganhou célula enquanto isso, a API responde 409 e o diálogo diz isso.
import { useEffect, useRef, useState, type RefObject } from "react";
import type { ItemPedido } from "../../../shared/contracts";
import { Aviso, Button, ComDica, Dialogo, Select } from "../../components/ui";
import { ErroApi, mensagemDoErro } from "../../lib/api";
import { formatarMoeda } from "../../lib/formatadores";
import {
  atribuirCelulaDoPedido,
  ehPedidoJaTemCelula,
  type CelulaDoFiltro,
} from "./pedidos-api";
import { AJUDA, DICAS, ROTULO_STATUS, bilhetes } from "./textos";

/** As células agrupadas por rede, já em ordem de nome (celulasPorRede, da lista). */
export type GruposDeCelulas = { rede: string; celulas: CelulaDoFiltro[] }[];

type Falha = { texto: string; jaTemCelula: boolean };

function falhaDe(erro: unknown): Falha {
  if (ehPedidoJaTemCelula(erro))
    return {
      texto:
        "Esta venda já tem célula pelo link do afiliado, e essa vale: não dá para escolher outra à mão. Recarregue a lista.",
      jaTemCelula: true,
    };
  if (erro instanceof ErroApi && erro.status === 404)
    return {
      texto:
        "Este pedido não é da campanha ativa (ou a campanha mudou). Recarregue a lista.",
      jaTemCelula: false,
    };
  if (erro instanceof ErroApi && erro.codigo === "referencia_invalida")
    return {
      texto:
        "Essa célula não existe mais (foi excluída na Hierarquia). Recarregue a página e escolha outra.",
      jaTemCelula: false,
    };
  return { texto: mensagemDoErro(erro), jaTemCelula: false };
}

type Props = {
  pedido: ItemPedido;
  /** null enquanto as células carregam (ou se falharam). */
  grupos: GruposDeCelulas | null;
  aoFechar: () => void;
  /** Deu certo: o pedido como a API devolveu (com a célula efetiva). */
  aoConcluir: (pedido: ItemPedido) => void;
  /** Recebe o foco ao fechar. */
  focoAoFechar: RefObject<HTMLElement | null>;
};

export function DialogoAtribuirCelula({
  pedido,
  grupos,
  aoFechar,
  aoConcluir,
  focoAoFechar,
}: Props) {
  const atribuida = pedido.celula_origem === "manual" ? pedido.celula_id : null;
  const [escolhida, setEscolhida] = useState<string>(
    atribuida === null ? "" : String(atribuida),
  );
  const [erroCampo, setErroCampo] = useState<string | undefined>();
  const [falha, setFalha] = useState<Falha | null>(null);
  const [enviando, setEnviando] = useState<"atribuir" | "remover" | null>(null);
  const emAndamento = useRef(false);
  const refCampo = useRef<HTMLSelectElement>(null);
  const refEntendi = useRef<HTMLButtonElement>(null);
  const refAcao = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (falha) (falha.jaTemCelula ? refEntendi : refAcao).current?.focus();
  }, [falha]);

  async function enviar(celulaId: number | null) {
    if (emAndamento.current) return;
    emAndamento.current = true;
    setEnviando(celulaId === null ? "remover" : "atribuir");
    setFalha(null);
    try {
      aoConcluir(await atribuirCelulaDoPedido(pedido.id, celulaId));
    } catch (erro) {
      setFalha(falhaDe(erro));
    } finally {
      emAndamento.current = false;
      setEnviando(null);
    }
  }

  function aoAtribuir() {
    if (enviando) return;
    const id = Number(escolhida);
    if (escolhida === "" || !Number.isInteger(id)) {
      setErroCampo("Escolha a célula.");
      refCampo.current?.focus();
      return;
    }
    if (id === atribuida) {
      aoFechar();
      return;
    }
    void enviar(id);
  }

  const ocupado = enviando !== null;
  const titulo =
    atribuida === null
      ? `Atribuir o pedido ${pedido.id} a uma célula`
      : `Trocar a célula do pedido ${pedido.id}`;

  return (
    <Dialogo
      aberto
      titulo={titulo}
      descricao="A venda chegou sem link de célula. Escolha a célula em que ela passa a contar: metas, rankings, painel do líder, telão e relatórios. Fica registrado na Trilha."
      aoFechar={() => {
        if (!ocupado) aoFechar();
      }}
      aoEnviar={(evento) => {
        evento.preventDefault();
        aoAtribuir();
      }}
      focoAoFechar={focoAoFechar}
      rodape={
        <>
          <ComDica
            texto={
              ocupado
                ? DICAS.atribuindo
                : falha?.jaTemCelula
                  ? DICAS.entendiAtribuir
                  : DICAS.cancelarAtribuir
            }
          >
            <Button
              ref={refEntendi}
              variante="secundario"
              aria-disabled={ocupado || undefined}
              onClick={() => {
                if (!ocupado) aoFechar();
              }}
            >
              {falha?.jaTemCelula ? "Entendi" : "Cancelar"}
            </Button>
          </ComDica>
          {!falha?.jaTemCelula && atribuida !== null && (
            <ComDica
              texto={ocupado ? DICAS.atribuindo : DICAS.removerAtribuicao}
            >
              <Button
                variante="secundario"
                aria-disabled={ocupado || undefined}
                onClick={() => {
                  if (!ocupado) void enviar(null);
                }}
              >
                {enviando === "remover" ? "Removendo…" : "Remover atribuição"}
              </Button>
            </ComDica>
          )}
          {!falha?.jaTemCelula && (
            <ComDica
              texto={ocupado ? DICAS.atribuindo : DICAS.confirmarAtribuir}
            >
              {/* Enviando: o envio é barrado no aoAtribuir (o clique, o Enter e o espaço nele e o Enter no campo). */}
              <Button
                ref={refAcao}
                type="submit"
                aria-disabled={ocupado || grupos === null || undefined}
              >
                {enviando === "atribuir" ? "Atribuindo…" : "Atribuir"}
              </Button>
            </ComDica>
          )}
        </>
      }
    >
      <div className="pedidos-dialogo">
        <p className="pedidos-suave">
          {`${ROTULO_STATUS[pedido.status]} · ${bilhetes(pedido.qtd_bilhetes)} · ${formatarMoeda(pedido.total_centavos)}`}
          {pedido.affiliate_id !== null &&
            ` · afiliado ${pedido.affiliate_id} sem célula`}
        </p>
        {grupos === null ? (
          <p className="pedidos-suave" role="status">
            Carregando as células…
          </p>
        ) : (
          <Select
            ajuda={AJUDA.celulaAtribuida}
            ref={refCampo}
            rotulo="Célula"
            value={escolhida}
            erro={erroCampo}
            required
            onChange={(evento) => {
              setEscolhida(evento.target.value);
              setErroCampo(undefined);
            }}
          >
            <option value="">Escolha…</option>
            {grupos.map((grupo) => (
              <optgroup key={grupo.rede} label={grupo.rede}>
                {grupo.celulas.map((celula) => (
                  <option key={celula.id} value={String(celula.id)}>
                    {celula.nome}
                  </option>
                ))}
              </optgroup>
            ))}
          </Select>
        )}
        {falha && (
          <Aviso tom="perigo" titulo="Não foi possível mudar a célula">
            <p>{falha.texto}</p>
          </Aviso>
        )}
      </div>
    </Dialogo>
  );
}
