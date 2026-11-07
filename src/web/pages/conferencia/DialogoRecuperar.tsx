import { useEffect, useState } from "react";
import type {
  MapeamentoReconciliacao,
  RespostaRecuperarReconciliacao,
} from "../../../shared/contracts";
import { Aviso, Button, Dialogo, Loading } from "../../components/ui";
import { mensagemDoErro } from "../../lib/api";
import { formatarDataHora, formatarMoeda } from "../../lib/formatadores";
import { recuperar } from "./conferencia-api";
import { textoDoAfiliado, textoDosTotais } from "./formatos";
import { MOTIVOS, ORIGEM_DA_DATA, plural, tomDoAviso } from "./textos";

type Props = {
  csv: string;
  mapeamento: MapeamentoReconciliacao;
  pedidos: readonly string[];
  aoFechar: () => void;
  /** Gravou (ou tentou e nada entrou): a tela mostra o resultado e confere de novo. */
  aoGravar: (resposta: RespostaRecuperarReconciliacao) => void;
};

type Estado =
  | { tipo: "carregando" }
  | { tipo: "previa"; previa: RespostaRecuperarReconciliacao }
  | { tipo: "erro"; mensagem: string };

// Confirmação do "Recuperar": ao abrir, pede à API a prévia (simular: true), que já confere o banco de
// agora (um pedido que chegou pelo webhook depois da conferência aparece como "já está no sistema"). Só o
// botão "Gravar" grava, num lote só e sem sobrescrever nada.
export function DialogoRecuperar({
  csv,
  mapeamento,
  pedidos,
  aoFechar,
  aoGravar,
}: Props) {
  const [estado, setEstado] = useState<Estado>({ tipo: "carregando" });
  const [gravando, setGravando] = useState(false);
  const [erroAoGravar, setErroAoGravar] = useState<string | null>(null);

  useEffect(() => {
    const controle = new AbortController();
    recuperar(csv, mapeamento, pedidos, true, { signal: controle.signal }).then(
      (previa) => setEstado({ tipo: "previa", previa }),
      (erro: unknown) => {
        if (!controle.signal.aborted)
          setEstado({ tipo: "erro", mensagem: mensagemDoErro(erro) });
      },
    );
    return () => controle.abort();
  }, [csv, mapeamento, pedidos]);

  async function gravar() {
    if (estado.tipo !== "previa" || gravando) return;
    setGravando(true);
    setErroAoGravar(null);
    try {
      aoGravar(
        await recuperar(
          csv,
          mapeamento,
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
      titulo={`Recuperar ${plural(pedidos.length, "venda", "vendas")}?`}
      descricao="Confira o que vai entrar no sistema. Pedido que já está no sistema nunca é mudado."
      aoFechar={() => {
        if (!gravando) aoFechar();
      }}
      rodape={
        <>
          <Button variante="secundario" disabled={gravando} onClick={aoFechar}>
            {aGravar > 0 ? "Cancelar" : "Fechar"}
          </Button>
          {aGravar > 0 && (
            <Button disabled={gravando} onClick={() => void gravar()}>
              {gravando
                ? "Gravando…"
                : `Gravar ${plural(aGravar, "venda", "vendas")}`}
            </Button>
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
      {estado.tipo === "previa" && <Previa previa={estado.previa} />}
      {erroAoGravar && (
        <Aviso tom="perigo" titulo="Nada foi gravado">
          <p>{erroAoGravar}</p>
        </Aviso>
      )}
    </Dialogo>
  );
}

function Previa({ previa }: { previa: RespostaRecuperarReconciliacao }) {
  const { recuperados, nao_recuperados: naoRecuperados } = previa;
  return (
    <div className="conferencia-bloco">
      {recuperados.length > 0 ? (
        <p>
          <strong>
            Vão entrar {plural(recuperados.length, "venda", "vendas")}:{" "}
            {textoDosTotais(previa.totais)}.
          </strong>{" "}
          Elas passam a contar no painel e no ranking, como pagas.
        </p>
      ) : (
        <Aviso tom="alerta" anuncio="nenhum" titulo="Nada a gravar">
          <p>Nenhuma das vendas escolhidas pode ser recuperada agora.</p>
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
                {pedido.afiliado === "nao_reconhecido"
                  ? "sem afiliado (o do arquivo não foi reconhecido)"
                  : textoDoAfiliado(
                      pedido.afiliado,
                      pedido.affiliate_id,
                      pedido.celula,
                    )}
              </span>
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
            {plural(naoRecuperados.length, "venda fica", "vendas ficam")} de
            fora:
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
