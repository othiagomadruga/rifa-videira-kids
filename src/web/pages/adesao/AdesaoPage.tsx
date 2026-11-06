import { useState } from "react";
import { Link } from "react-router";
import {
  Button,
  EmptyState,
  ErrorState,
  Loading,
  PageHeader,
} from "../../components/ui";
import { mensagemDoErro } from "../../lib/api";
import { salvarVinculo, type PainelAdesao } from "./adesao-api";
import { formatarHoraComSegundos } from "./formatos";
import { QuemFalta } from "./QuemFalta";
import { ResumoAdesao } from "./ResumoAdesao";
import { SemCelula } from "./SemCelula";
import { TodasAsCelulas, type AoSalvarVinculo } from "./TodasAsCelulas";
import { INTERVALO_ATUALIZACAO_MS, usePainelAdesao } from "./usePainelAdesao";
import "./adesao.css";

const SEGUNDOS_ENTRE_ATUALIZACOES = INTERVALO_ATUALIZACAO_MS / 1000;

// Painel da reunião de cadastro dos líderes, pensado para o celular: quem já virou afiliado na Rifei,
// a fila de códigos sem célula (para vincular) e quem falta (para chamar o líder ali mesmo).
export function AdesaoPage() {
  const { estado, atualizando, atualizarAgora, tentarDeNovo } =
    usePainelAdesao();
  // Último vínculo salvo, anunciado aos leitores de tela (role="status").
  const [aviso, setAviso] = useState("");

  const aoSalvar: AoSalvarVinculo = async (affiliateId, celulaId, sucesso) => {
    await salvarVinculo(affiliateId, celulaId);
    setAviso(sucesso);
    atualizarAgora();
  };

  return (
    <>
      <PageHeader
        titulo="Adesão"
        descricao="Quem já virou afiliado na Rifei e quem falta. Ligue cada afiliado à célula do líder."
        acoes={
          estado.tipo === "ok" && (
            <Button variante="secundario" onClick={atualizarAgora}>
              Atualizar agora
            </Button>
          )
        }
      />
      {estado.tipo === "carregando" && (
        <Loading texto="Carregando a adesão das células…" />
      )}
      {estado.tipo === "erro" && (
        <ErrorState
          mensagem={mensagemDoErro(estado.erro)}
          aoTentarDeNovo={tentarDeNovo}
        />
      )}
      {estado.tipo === "ok" && (
        <>
          <div className="adesao-status">
            <p>
              {atualizando
                ? "Atualizando…"
                : `Atualizado às ${formatarHoraComSegundos(estado.painel.obtidoEm)}.`}{" "}
              Atualiza sozinho a cada {SEGUNDOS_ENTRE_ATUALIZACOES} segundos.
            </p>
            <p className="adesao-status__falha" role="status">
              {estado.falha !== null &&
                `A última atualização falhou: ${mensagemDoErro(estado.falha)} Os dados são das ${formatarHoraComSegundos(estado.painel.obtidoEm)}; tentando de novo sozinho.`}
            </p>
            <p className="adesao-aviso" role="status">
              {aviso}
            </p>
          </div>
          <Painel painel={estado.painel} aoSalvar={aoSalvar} />
        </>
      )}
    </>
  );
}

function Painel({
  painel: { adesao, orfaos, obtidoEm },
  aoSalvar,
}: {
  painel: PainelAdesao;
  aoSalvar: AoSalvarVinculo;
}) {
  const semCelula = (
    <SemCelula
      orfaos={orfaos}
      celulas={adesao.itens}
      agora={obtidoEm}
      aoSalvar={aoSalvar}
    />
  );

  if (adesao.itens.length === 0) {
    return (
      <>
        <EmptyState
          titulo="Nenhuma célula cadastrada."
          descricao={
            <>
              Importe a planilha das células em{" "}
              <Link to="/coordenacao/hierarquia">Hierarquia</Link> para
              acompanhar a adesão.
            </>
          }
        />
        {semCelula}
      </>
    );
  }

  return (
    <>
      <ResumoAdesao resumo={adesao.resumo} afiliadosSemCelula={orfaos.length} />
      <div className="adesao-colunas">
        {semCelula}
        <QuemFalta celulas={adesao.itens} />
      </div>
      <TodasAsCelulas
        celulas={adesao.itens}
        orfaos={orfaos}
        aoSalvar={aoSalvar}
      />
    </>
  );
}
