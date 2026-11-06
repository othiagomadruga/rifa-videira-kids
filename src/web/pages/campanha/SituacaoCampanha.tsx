import {
  diasEntre,
  faseDaCampanha,
  hojeNoFuso,
  type Campanha,
  type FaseCampanha,
} from "../../../shared/contracts";
import { Badge, Card, type TomBadge } from "../../components/ui";
import { formatarData } from "../../lib/formatadores";

const BADGE_DA_FASE: Record<FaseCampanha, { tom: TomBadge; texto: string }> = {
  antes: { tom: "info", texto: "Antes do início" },
  durante: { tom: "sucesso", texto: "Em andamento" },
  encerrada: { tom: "neutro", texto: "Encerrada" },
};

type Props = {
  /** null = ainda não configurada (nenhuma campanha ativa). */
  campanha: Campanha | null;
};

/** Se há campanha ativa (e, com isso, se as vendas da Rifei contam) e em que fase ela está. */
export function SituacaoCampanha({ campanha }: Props) {
  if (!campanha) {
    return (
      <Card titulo="Situação">
        <div className="campanha-situacao">
          <p>
            <Badge tom="alerta">Não ativada</Badge>
          </p>
          <p>
            Ainda não há campanha ativa. Até você ativar, o sistema ignora as
            vendas que chegam da Rifei.
          </p>
        </div>
      </Card>
    );
  }

  const hoje = hojeNoFuso(campanha.fuso_horario);
  const fase = faseDaCampanha(hoje, campanha.data_inicio, campanha.data_fim);
  const badge = BADGE_DA_FASE[fase];
  return (
    <Card titulo="Situação">
      <div className="campanha-situacao">
        <p className="campanha-situacao__selos">
          <Badge tom="sucesso">Ativa</Badge>
          <Badge tom={badge.tom}>{badge.texto}</Badge>
        </p>
        <p>
          As vendas da Rifei com o slug <strong>{campanha.slug_rifei}</strong>{" "}
          contam para esta campanha.
        </p>
        <p>{textoDaFase(fase, hoje, campanha)}</p>
      </div>
    </Card>
  );
}

function textoDaFase(fase: FaseCampanha, hoje: string, campanha: Campanha) {
  const inicio = formatarData(campanha.data_inicio);
  const fim = formatarData(campanha.data_fim);
  if (fase === "antes") {
    const faltam = diasEntre(hoje, campanha.data_inicio);
    const quando = faltam === 1 ? "amanhã" : `faltam ${faltam} dias`;
    return `As vendas começam em ${inicio} (${quando}) e vão até ${fim}.`;
  }
  if (fase === "durante") {
    const dia = diasEntre(campanha.data_inicio, hoje) + 1;
    const total = diasEntre(campanha.data_inicio, campanha.data_fim) + 1;
    return `Dia ${dia} de ${total}. As vendas vão até ${fim}.`;
  }
  return `A campanha terminou em ${fim}.`;
}
