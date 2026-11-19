import type {
  CampoReconciliacao,
  ColunaArquivoReconciliacao,
  MapeamentoReconciliacao,
} from "../../../shared/contracts";
import { Button, Card, ComDica, Select } from "../../components/ui";
import { AJUDA, CAMPOS, DICAS } from "./textos";

type Props = {
  colunas: readonly ColunaArquivoReconciliacao[];
  mapeamento: MapeamentoReconciliacao;
  /** O mapeamento da última conferência veio da detecção automática. */
  detectado: boolean;
  /** A pessoa trocou alguma coluna desde a última conferência. */
  alterado: boolean;
  ocupado: boolean;
  aoMudar: (campo: CampoReconciliacao, indice: number | null) => void;
  aoConferir: () => void;
  aoDesfazer: () => void;
};

const CAMPOS_EM_ORDEM = Object.keys(CAMPOS) as CampoReconciliacao[];

// As colunas que a conferência usa: um campo por linha, cada um com a coluna do arquivo escolhida (ou "Não
// tem"). As colunas de dados pessoais não aparecem nas opções: a tela nunca as manda ao sistema.
export function Mapeamento({
  colunas,
  mapeamento,
  detectado,
  alterado,
  ocupado,
  aoMudar,
  aoConferir,
  aoDesfazer,
}: Props) {
  const usaveis = colunas.filter((coluna) => !coluna.dado_pessoal);
  const pessoais = colunas.filter((coluna) => coluna.dado_pessoal);
  const porPedido = mapeamento.pedido_id !== null;
  // Sem troca ou conferindo, o "Conferir com estas colunas" fica indisponível com aria-disabled (RIFA-045): continua
  // no Tab e a dica diz por quê; o clique é barrado aqui. Os selects podem ficar disabled: "Conferindo…" está à vista.
  const conferirIndisponivel = !alterado || ocupado;

  return (
    <Card titulo="Colunas do arquivo" ajuda={AJUDA.colunasDoArquivo}>
      <div className="conferencia-bloco">
        <p>
          {detectado && !alterado
            ? "O sistema reconheceu as colunas pelo nome. Confira cada campo e troque se estiver errado."
            : "Troque o que for preciso e confira de novo."}
        </p>
        <div className="conferencia-campos">
          {CAMPOS_EM_ORDEM.map((campo) => (
            <Select
              key={campo}
              rotulo={CAMPOS[campo].rotulo}
              ajuda={ocupado ? DICAS.colunaOcupada : AJUDA.coluna}
              dica={CAMPOS[campo].dica}
              value={mapeamento[campo] ?? ""}
              disabled={ocupado}
              onChange={(evento) =>
                aoMudar(
                  campo,
                  evento.currentTarget.value === ""
                    ? null
                    : Number(evento.currentTarget.value),
                )
              }
            >
              <option value="">{CAMPOS[campo].semColuna ?? "Não tem"}</option>
              {usaveis.map((coluna) => (
                <option key={coluna.indice} value={coluna.indice}>
                  {`${coluna.nome} (coluna ${coluna.indice + 1})`}
                </option>
              ))}
            </Select>
          ))}
        </div>
        {pessoais.length > 0 && (
          <p className="conferencia-suave">
            Ignoradas por terem dados pessoais (não saem do seu computador):{" "}
            {pessoais.map((coluna) => coluna.nome).join(", ")}.
          </p>
        )}
        <p className="conferencia-suave">
          {porPedido
            ? "Comparação pedido a pedido: dá para ver cada venda que faltou e recuperá-la."
            : "Sem o código do pedido, a comparação é pelos totais (por afiliado e por dia) e não dá para recuperar vendas."}
        </p>
        <div className="conferencia-acoes">
          <ComDica
            texto={
              ocupado
                ? DICAS.conferindo
                : alterado
                  ? DICAS.conferirColunas
                  : DICAS.conferirSemTroca
            }
          >
            <Button
              variante="secundario"
              aria-disabled={conferirIndisponivel || undefined}
              onClick={() => {
                if (!conferirIndisponivel) aoConferir();
              }}
            >
              {ocupado ? "Conferindo…" : "Conferir com estas colunas"}
            </Button>
          </ComDica>
          {alterado && !ocupado && (
            <ComDica texto={DICAS.desfazerTrocas}>
              <Button variante="discreto" onClick={aoDesfazer}>
                Desfazer as trocas
              </Button>
            </ComDica>
          )}
        </div>
      </div>
    </Card>
  );
}
