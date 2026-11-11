// Desconsiderar pedido e desfazer (RIFA-028, D20; só admin, com a chave `pedidos.desconsiderar` ligada na
// Campanha). O pedido sai de TODAS as contas e continua na lista, com o selo; desfazer o devolve às contas. Os
// diálogos mandam o pedido à API e devolvem o pedido como a lista mostra (o selo e os totais mudam na hora).
import {
  useEffect,
  useRef,
  useState,
  type FormEvent,
  type RefObject,
} from "react";
import { Link } from "react-router";
import type {
  ItemPedido,
  MotivoDesconsideracao,
} from "../../../shared/contracts";
import { Aviso, Button, Dialogo, Select, Textarea } from "../../components/ui";
import { ErroApi, mensagemDoErro } from "../../lib/api";
import { formatarDataHora, formatarMoeda } from "../../lib/formatadores";
import {
  LIMITE_OBSERVACAO,
  MOTIVOS_DESCONSIDERACAO,
  desconsiderarPedido,
  ehAcaoDesligada,
  observacaoTemContato,
  reconsiderarPedido,
} from "./pedidos-api";
import {
  ROTULO_MOTIVO,
  ROTULO_STATUS,
  bilhetes,
  seloDesconsiderado,
} from "./textos";

/** Onde se liga a chave (a tela Campanha, no campo da chave). */
export const CAMINHO_CHAVE_NA_CAMPANHA =
  "/coordenacao/campanha#campanha-pedidos-desconsiderar";

export const MENSAGEM_OBSERVACAO_COM_CONTATO =
  "Tire o e-mail, o telefone ou o documento: a observação não pode ter dado pessoal do comprador (nem “@”, nem 8 números seguidos).";

/** A falha da ação em português: a chave desligada, o pedido fora da campanha ou a mensagem da API. */
function mensagemDaFalha(erro: unknown): string {
  if (ehAcaoDesligada(erro))
    return "A chave “Permitir desconsiderar pedidos” foi desligada na Campanha: ligue de novo para desconsiderar ou desfazer.";
  if (erro instanceof ErroApi && erro.status === 404)
    return "Este pedido não é da campanha ativa (ou a campanha mudou). Recarregue a lista.";
  return mensagemDoErro(erro);
}

/** A falha da ação: o texto e se foi a chave desligada (aí, tentar de novo daria o mesmo 409). */
type Falha = { texto: string; desligada: boolean };

function falhaDe(erro: unknown): Falha {
  return { texto: mensagemDaFalha(erro), desligada: ehAcaoDesligada(erro) };
}

/**
 * Depois de uma falha, o foco fica no diálogo: o botão que o tinha estava desabilitado enquanto enviava. Com a chave
 * desligada, vai para "Entendi" (a ação some); senão, para o botão da ação, para tentar de novo.
 */
function useFocoAposFalha(falha: Falha | null) {
  const refEntendi = useRef<HTMLButtonElement>(null);
  const refAcao = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    if (falha) (falha.desligada ? refEntendi : refAcao).current?.focus();
  }, [falha]);
  return { refEntendi, refAcao };
}

/** O 400 da API sobre a observação (o contrato confere o "@" e os 8 dígitos também lá). */
function erroDaObservacaoNaApi(erro: unknown): string | null {
  if (!(erro instanceof ErroApi) || erro.status !== 400) return null;
  const detalhes: unknown[] = Array.isArray(erro.detalhes) ? erro.detalhes : [];
  return detalhes.some((detalhe) => {
    const caminho = (detalhe as { caminho?: unknown } | null)?.caminho;
    return Array.isArray(caminho) && caminho[0] === "observacao";
  })
    ? MENSAGEM_OBSERVACAO_COM_CONTATO
    : null;
}

type PropsAcao = {
  pedido: ItemPedido;
  aoFechar: () => void;
  /** Deu certo: o pedido como a API devolveu. */
  aoConcluir: (pedido: ItemPedido) => void;
  /** A API disse que a chave está desligada (409 `acao_desligada`): as ações saem da lista. */
  aoDesligada: () => void;
  /** Recebe o foco ao fechar (o botão que abriu troca de nome com o selo). */
  focoAoFechar: RefObject<HTMLElement | null>;
};

/** O pedido em uma linha: "Aprovado · 2 bilhetes · R$ 40,00". */
function resumoDoPedido(pedido: ItemPedido): string {
  return `${ROTULO_STATUS[pedido.status]} · ${bilhetes(pedido.qtd_bilhetes)} · ${formatarMoeda(pedido.total_centavos)}`;
}

export function DialogoDesconsiderar({
  pedido,
  aoFechar,
  aoConcluir,
  aoDesligada,
  focoAoFechar,
}: PropsAcao) {
  const [motivo, setMotivo] = useState<MotivoDesconsideracao | "">("");
  const [observacao, setObservacao] = useState("");
  const [erros, setErros] = useState<{
    motivo?: string;
    observacao?: string;
  }>({});
  const [falha, setFalha] = useState<Falha | null>(null);
  const [enviando, setEnviando] = useState(false);
  const emAndamento = useRef(false);
  const { refEntendi, refAcao } = useFocoAposFalha(falha);
  const refMotivo = useRef<HTMLSelectElement>(null);
  const refObservacao = useRef<HTMLTextAreaElement>(null);

  async function aoEnviar(evento: FormEvent<HTMLFormElement>) {
    evento.preventDefault();
    if (emAndamento.current) return;
    const novos: typeof erros = {};
    if (motivo === "") novos.motivo = "Escolha o motivo.";
    if (observacaoTemContato(observacao))
      novos.observacao = MENSAGEM_OBSERVACAO_COM_CONTATO;
    setErros(novos);
    setFalha(null);
    if (novos.motivo || novos.observacao) {
      (novos.motivo ? refMotivo : refObservacao).current?.focus();
      return;
    }
    if (motivo === "") return;
    emAndamento.current = true;
    setEnviando(true);
    try {
      const atualizado = await desconsiderarPedido({
        pedido_id: pedido.id,
        motivo,
        observacao: observacao.trim() === "" ? null : observacao.trim(),
      });
      aoConcluir(atualizado);
    } catch (erro) {
      const daObservacao = erroDaObservacaoNaApi(erro);
      if (daObservacao) {
        setErros({ observacao: daObservacao });
        refObservacao.current?.focus();
      } else {
        setFalha(falhaDe(erro));
      }
      if (ehAcaoDesligada(erro)) aoDesligada();
    } finally {
      emAndamento.current = false;
      setEnviando(false);
    }
  }

  return (
    <Dialogo
      aberto
      titulo={`Desconsiderar o pedido ${pedido.id}?`}
      descricao="Ele sai de todas as contas (metas, rankings, painel, telão e ranking público) e continua nesta lista, com o selo. Dá para desfazer."
      aoFechar={() => {
        if (!enviando) aoFechar();
      }}
      aoEnviar={(evento) => void aoEnviar(evento)}
      focoAoFechar={focoAoFechar}
      rodape={
        <>
          <Button
            ref={refEntendi}
            variante="secundario"
            onClick={aoFechar}
            disabled={enviando}
          >
            {falha?.desligada ? "Entendi" : "Cancelar"}
          </Button>
          {!falha?.desligada && (
            <Button
              ref={refAcao}
              type="submit"
              variante="perigo"
              disabled={enviando}
            >
              {enviando ? "Desconsiderando…" : "Desconsiderar"}
            </Button>
          )}
        </>
      }
    >
      <div className="pedidos-dialogo">
        <p className="pedidos-suave">{resumoDoPedido(pedido)}</p>
        <Select
          ref={refMotivo}
          rotulo="Motivo"
          value={motivo}
          erro={erros.motivo}
          required
          onChange={(evento) => {
            setMotivo(
              MOTIVOS_DESCONSIDERACAO.find(
                (opcao) => opcao === evento.target.value,
              ) ?? "",
            );
            setErros((atuais) => ({ ...atuais, motivo: undefined }));
          }}
        >
          <option value="">Escolha…</option>
          {MOTIVOS_DESCONSIDERACAO.map((opcao) => (
            <option key={opcao} value={opcao}>
              {ROTULO_MOTIVO[opcao]}
            </option>
          ))}
        </Select>
        <Textarea
          ref={refObservacao}
          rotulo="Observação (opcional)"
          dica={`Até ${LIMITE_OBSERVACAO} caracteres. Não escreva nome, telefone, e-mail nem documento do comprador.`}
          value={observacao}
          maxLength={LIMITE_OBSERVACAO}
          rows={3}
          erro={erros.observacao}
          onChange={(evento) => {
            setObservacao(evento.target.value);
            setErros((atuais) => ({ ...atuais, observacao: undefined }));
          }}
        />
        {falha && (
          <Aviso tom="perigo" titulo="Não foi possível desconsiderar">
            <p>{falha.texto}</p>
          </Aviso>
        )}
      </div>
    </Dialogo>
  );
}

export function DialogoDesfazer({
  pedido,
  aoFechar,
  aoConcluir,
  aoDesligada,
  focoAoFechar,
}: PropsAcao) {
  const [falha, setFalha] = useState<Falha | null>(null);
  const [enviando, setEnviando] = useState(false);
  const emAndamento = useRef(false);
  const { refEntendi, refAcao } = useFocoAposFalha(falha);
  const { desconsiderado } = pedido;

  async function confirmar() {
    if (emAndamento.current) return;
    emAndamento.current = true;
    setEnviando(true);
    setFalha(null);
    try {
      aoConcluir(await reconsiderarPedido(pedido.id));
    } catch (erro) {
      setFalha(falhaDe(erro));
      if (ehAcaoDesligada(erro)) aoDesligada();
    } finally {
      emAndamento.current = false;
      setEnviando(false);
    }
  }

  return (
    <Dialogo
      aberto
      papel="alertdialog"
      titulo={`Desfazer: o pedido ${pedido.id} volta a contar?`}
      descricao="Ele volta a todas as contas: metas, rankings, painel, telão e ranking público."
      aoFechar={() => {
        if (!enviando) aoFechar();
      }}
      focoAoFechar={focoAoFechar}
      rodape={
        <>
          <Button
            ref={refEntendi}
            variante="secundario"
            onClick={aoFechar}
            disabled={enviando}
          >
            {falha?.desligada ? "Entendi" : "Cancelar"}
          </Button>
          {!falha?.desligada && (
            <Button
              ref={refAcao}
              disabled={enviando}
              onClick={() => void confirmar()}
            >
              {enviando ? "Desfazendo…" : "Desfazer"}
            </Button>
          )}
        </>
      }
    >
      <div className="pedidos-dialogo">
        <p className="pedidos-suave">{resumoDoPedido(pedido)}</p>
        {desconsiderado && (
          <p>
            {seloDesconsiderado(desconsiderado.motivo)} em{" "}
            {formatarDataHora(desconsiderado.em)}
            {desconsiderado.observacao &&
              `. Observação: ${desconsiderado.observacao}`}
            .
          </p>
        )}
        {falha && (
          <Aviso tom="perigo" titulo="Não foi possível desfazer">
            <p>{falha.texto}</p>
          </Aviso>
        )}
      </div>
    </Dialogo>
  );
}

/** Para o admin, com a chave desligada: o que fazer para desconsiderar (a chave fica na Campanha). */
export function AvisoChaveDesligada() {
  return (
    <Aviso
      tom="info"
      titulo="Desconsiderar pedidos está desligado"
      anuncio="nenhum"
    >
      <p>
        Para tirar das contas um pedido de teste, fraude ou estorno, ligue
        “Permitir desconsiderar pedidos” na{" "}
        <Link to={CAMINHO_CHAVE_NA_CAMPANHA}>tela Campanha</Link>. Os pedidos já
        desconsiderados continuam fora das contas.
      </p>
    </Aviso>
  );
}
