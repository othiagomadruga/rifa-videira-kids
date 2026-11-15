import { useEffect, useState } from "react";
import type {
  CorpoConferencia,
  PedidoRecuperado,
  RespostaRecuperarReconciliacao,
  TipoRecuperacao,
} from "../../../shared/contracts";
import { Aviso, Button, ComDica, Dialogo, Loading } from "../../components/ui";
import { mensagemDoErro } from "../../lib/api";
import { formatarDataHora, formatarMoeda } from "../../lib/formatadores";
import { recuperar } from "./conferencia-api";
import { textoDoAfiliado, textoDosTotais } from "./formatos";
import { DICAS, MOTIVOS, ORIGEM_DA_DATA, plural, tomDoAviso } from "./textos";

type Props = {
  /** De qual grupo saiu a confirmação: Recuperar (venda perdida) ou Registrar pagamento (RIFA-056, só o admin). */
  tipo: TipoRecuperacao;
  /** O mesmo corpo da conferência (as colunas mapeadas, sem os dados pessoais). */
  corpo: CorpoConferencia;
  pedidos: readonly string[];
  aoFechar: () => void;
  /** Gravou (ou tentou e nada entrou): a tela mostra o resultado e confere de novo. */
  aoGravar: (resposta: RespostaRecuperarReconciliacao) => void;
};

type Estado =
  | { tipo: "carregando" }
  | { tipo: "previa"; previa: RespostaRecuperarReconciliacao }
  | { tipo: "erro"; mensagem: string };

// Confirmação do "Recuperar" (e do "Registrar pagamento", RIFA-056: a mesma rota): ao abrir, pede à API a prévia
// (simular: true), que já confere o banco de agora (um pedido que chegou pelo webhook depois da conferência aparece
// como "já está no sistema"). Só o botão "Gravar" grava, num lote só e sem sobrescrever nada (o pagamento registrado
// só muda o status e a data do pagamento do pedido pendente ou expirado). Gravando, Cancelar e Gravar ficam indisponíveis com
// aria-disabled (RIFA-045), não disabled: o foco fica no botão (dentro do diálogo), o Tab continua passando por eles
// com a dica e o clique, o Esc e o × são ignorados até a gravação terminar.
/** Os textos de cada confirmação. */
const TEXTOS: Record<
  TipoRecuperacao,
  {
    titulo: (n: number) => string;
    descricao: string;
    gravar: (n: number) => string;
    dicaCancelar: string;
    dicaGravar: string;
    dicaGravando: string;
    nadaAGravar: string;
    deFora: (n: number) => string;
  }
> = {
  venda_perdida: {
    titulo: (n) => `Recuperar ${plural(n, "venda", "vendas")}?`,
    descricao:
      "Confira o que vai entrar no sistema. Pedido que já está no sistema nunca é mudado.",
    gravar: (n) => `Gravar ${plural(n, "venda", "vendas")}`,
    dicaCancelar: DICAS.cancelarRecuperar,
    dicaGravar: DICAS.gravar,
    dicaGravando: DICAS.gravando,
    nadaAGravar: "Nenhuma das vendas escolhidas pode ser recuperada agora.",
    deFora: (n) => `${plural(n, "venda fica", "vendas ficam")} de fora:`,
  },
  pagamento_nao_registrado: {
    titulo: (n) => `Registrar ${plural(n, "pagamento", "pagamentos")}?`,
    descricao:
      "Confira os pedidos que vão passar a pagos. Só muda o pedido pendente ou expirado: ele ganha a data do pagamento do arquivo, e o resto dele fica como está.",
    gravar: (n) => `Gravar ${plural(n, "pagamento", "pagamentos")}`,
    dicaCancelar: DICAS.cancelarPagamentos,
    dicaGravar: DICAS.gravarPagamentos,
    dicaGravando: DICAS.gravandoPagamentos,
    nadaAGravar:
      "Nenhum dos pedidos escolhidos pode ser marcado como pago agora.",
    deFora: (n) => `${plural(n, "pedido fica", "pedidos ficam")} de fora:`,
  },
};

export function DialogoRecuperar({
  tipo,
  corpo,
  pedidos,
  aoFechar,
  aoGravar,
}: Props) {
  const textos = TEXTOS[tipo];
  const [estado, setEstado] = useState<Estado>({ tipo: "carregando" });
  const [gravando, setGravando] = useState(false);
  const [erroAoGravar, setErroAoGravar] = useState<string | null>(null);

  useEffect(() => {
    const controle = new AbortController();
    recuperar(corpo, pedidos, true, { signal: controle.signal }).then(
      (previa) => setEstado({ tipo: "previa", previa }),
      (erro: unknown) => {
        if (!controle.signal.aborted)
          setEstado({ tipo: "erro", mensagem: mensagemDoErro(erro) });
      },
    );
    return () => controle.abort();
  }, [corpo, pedidos]);

  async function gravar() {
    if (estado.tipo !== "previa" || gravando) return;
    setGravando(true);
    setErroAoGravar(null);
    try {
      aoGravar(
        await recuperar(
          corpo,
          estado.previa.recuperados.map((pedido) => pedido.pedido_id),
          false,
        ),
      );
    } catch (erro) {
      setErroAoGravar(mensagemDoErro(erro));
      setGravando(false);
    }
  }

  const aGravar =
    estado.tipo === "previa" ? estado.previa.recuperados.length : 0;

  return (
    <Dialogo
      aberto
      papel="alertdialog"
      titulo={textos.titulo(pedidos.length)}
      descricao={textos.descricao}
      aoFechar={() => {
        if (!gravando) aoFechar();
      }}
      dicaFechar={
        gravando
          ? textos.dicaGravando
          : aGravar > 0
            ? textos.dicaCancelar
            : DICAS.fecharRecuperar
      }
      rodape={
        <>
          <ComDica
            texto={
              gravando
                ? textos.dicaGravando
                : aGravar > 0
                  ? textos.dicaCancelar
                  : DICAS.fecharRecuperar
            }
          >
            <Button
              variante="secundario"
              aria-disabled={gravando || undefined}
              onClick={() => {
                if (!gravando) aoFechar();
              }}
            >
              {aGravar > 0 ? "Cancelar" : "Fechar"}
            </Button>
          </ComDica>
          {aGravar > 0 && (
            <ComDica texto={gravando ? textos.dicaGravando : textos.dicaGravar}>
              <Button
                aria-disabled={gravando || undefined}
                onClick={() => {
                  if (!gravando) void gravar();
                }}
              >
                {gravando ? "Gravando…" : textos.gravar(aGravar)}
              </Button>
            </ComDica>
          )}
        </>
      }
    >
      {estado.tipo === "carregando" && (
        <Loading texto="Conferindo o que vai ser gravado…" />
      )}
      {estado.tipo === "erro" && (
        <Aviso tom="perigo" titulo="Não foi possível preparar a recuperação">
          <p>{estado.mensagem}</p>
        </Aviso>
      )}
      {estado.tipo === "previa" && (
        <Previa previa={estado.previa} textos={textos} />
      )}
      {erroAoGravar && (
        <Aviso tom="perigo" titulo="Nada foi gravado">
          <p>{erroAoGravar}</p>
        </Aviso>
      )}
    </Dialogo>
  );
}

/** "Vão entrar 2 vendas: …" e "Vão passar a pagos 2 pedidos: …", pelo que a prévia de fato vai fazer. */
function frasesDaPrevia(recuperados: readonly PedidoRecuperado[]): string[] {
  const somar = (lista: readonly PedidoRecuperado[]) =>
    textoDosTotais({
      pedidos_aprovados: lista.length,
      bilhetes: lista.reduce((soma, pedido) => soma + pedido.qtd_bilhetes, 0),
      total_centavos: lista.reduce(
        (soma, pedido) => soma + pedido.total_centavos,
        0,
      ),
    });
  const vendas = recuperados.filter(
    (pedido) => pedido.tipo === "venda_perdida",
  );
  const pagamentos = recuperados.filter(
    (pedido) => pedido.tipo === "pagamento_nao_registrado",
  );
  return [
    vendas.length > 0
      ? `Vão entrar ${plural(vendas.length, "venda", "vendas")}: ${somar(vendas)}.`
      : null,
    pagamentos.length > 0
      ? `Vão passar a pagos ${plural(pagamentos.length, "pedido", "pedidos")}: ${somar(pagamentos)}.`
      : null,
  ].filter((frase) => frase !== null);
}

function Previa({
  previa,
  textos,
}: {
  previa: RespostaRecuperarReconciliacao;
  textos: (typeof TEXTOS)[TipoRecuperacao];
}) {
  const { recuperados, nao_recuperados: naoRecuperados } = previa;
  return (
    <div className="conferencia-bloco">
      {recuperados.length > 0 ? (
        <p>
          <strong>{frasesDaPrevia(recuperados).join(" ")}</strong>{" "}
          {recuperados.length === 1
            ? "Passa a contar no painel e no ranking, como paga."
            : "Elas passam a contar no painel e no ranking, como pagas."}
        </p>
      ) : (
        <Aviso tom="alerta" anuncio="nenhum" titulo="Nada a gravar">
          <p>{textos.nadaAGravar}</p>
        </Aviso>
      )}
      {recuperados.length > 0 && (
        <ul className="conferencia-lista-simples conferencia-previa">
          {recuperados.map((pedido) => (
            <li key={pedido.pedido_id}>
              <span className="conferencia-codigo">
                Pedido {pedido.pedido_id}
              </span>
              <span>
                {plural(pedido.qtd_bilhetes, "bilhete", "bilhetes")} ·{" "}
                {formatarMoeda(pedido.total_centavos)} ·{" "}
                {pedido.tipo === "pagamento_nao_registrado"
                  ? textoDoAfiliado(
                      "gravado",
                      pedido.affiliate_id,
                      pedido.celula,
                    )
                  : pedido.afiliado === "nao_reconhecido"
                    ? "sem afiliado (o do arquivo não foi reconhecido)"
                    : textoDoAfiliado(
                        pedido.afiliado,
                        pedido.affiliate_id,
                        pedido.celula,
                      )}
              </span>
              {pedido.tipo === "pagamento_nao_registrado" && (
                <span>Pendente ou expirado no sistema: passa a pago.</span>
              )}
              <span className="conferencia-suave">
                {formatarDataHora(pedido.aprovado_em)} (
                {ORIGEM_DA_DATA[pedido.origem_data]})
              </span>
            </li>
          ))}
        </ul>
      )}
      {naoRecuperados.length > 0 && (
        <>
          <p className="conferencia-subtitulo">
            {textos.deFora(naoRecuperados.length)}
          </p>
          <ul className="conferencia-lista-simples conferencia-previa">
            {naoRecuperados.map((item) => (
              <li key={item.pedido_id}>
                <span className="conferencia-codigo">
                  Pedido {item.pedido_id}
                </span>
                <span>{MOTIVOS[item.motivo] ?? item.motivo}</span>
              </li>
            ))}
          </ul>
        </>
      )}
      {previa.avisos.map((aviso) => (
        <Aviso
          key={aviso.codigo}
          tom={tomDoAviso(aviso.codigo)}
          anuncio="nenhum"
        >
          <p>{aviso.mensagem}</p>
        </Aviso>
      ))}
    </div>
  );
}
