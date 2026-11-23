import { useState } from "react";
import { Link, useSearchParams } from "react-router";
import type { RespostaPainelResumo } from "../../../shared/contracts/calculos";
import {
  Button,
  ComDica,
  EmptyState,
  ErrorState,
  PageHeader,
} from "../../components/ui";
import { ErroApi, ehFalhaDeConexao, mensagemDoErro } from "../../lib/api";
import { formatarHora } from "../../lib/formatadores";
import { useUsuarioConectado } from "../../lib/sessao";
import { DICA_DO_MENU } from "../coordenacao/textos";
import { contarRedes, useRedes } from "../../lib/redes";
import { AlertaWebhook } from "../pedidos/AlertaWebhook";
import { Arrecadado } from "./Arrecadado";
import { AvisosVendas } from "./AvisosVendas";
import { CartaoCampanha, CartaoHoje, CartaoPeriodo } from "./Cartoes";
import { CurvaDaCampanha } from "./CurvaDaCampanha";
import { EsqueletoDoPainel } from "./EsqueletoDoPainel";
import { FiltroEscopo } from "./FiltroEscopo";
import { Referencia } from "./Referencia";
import { RelatorioCampanha } from "./RelatorioCampanha";
import { DICAS, ROTULO_DO_ESCOPO, textoSemVendas } from "./textos";
import { useCelulasDoFiltro } from "./useCelulasDoFiltro";
import {
  INTERVALO_ATUALIZACAO_MS,
  usePainelResumo,
  type EstadoPainel,
} from "./usePainelResumo";
import {
  ESCOPO_CAMPANHA,
  escopoDosParams,
  paramsDoEscopo,
  type Escopo,
} from "./visao-geral-api";
import "./visao-geral.css";

const SEGUNDOS_ENTRE_ATUALIZACOES = INTERVALO_ATUALIZACAO_MS / 1000;

/** A mensagem da API como frase (com ponto final), para vir antes de outra. */
const comoFrase = (texto: string) =>
  /[.!?…]$/.test(texto.trim()) ? texto.trim() : `${texto.trim()}.`;

const ehNaoEncontrado = (erro: unknown) =>
  erro instanceof ErroApi &&
  erro.status === 404 &&
  erro.codigo === "nao_encontrado";

// Visão geral da coordenação (RIFA-009), pensada para o celular: em que dia e período a campanha está,
// quanto vender hoje, se está em dia ou abaixo (e quanto), para onde vai no ritmo atual e a curva
// esperado × realizado. O recorte (campanha, divisão, rede, discipulador ou célula) fica na URL. No fim, só para o
// admin, quanto entrou (o "Arrecadado", RIFA-087) e, para todos, o relatório da campanha para baixar (RIFA-038).
export function VisaoGeralPage() {
  const [params, setParams] = useSearchParams();
  const escopo = escopoDosParams(params);
  const { estado, atualizando, atualizarAgora, tentarDeNovo } =
    usePainelResumo(escopo);
  const celulas = useCelulasDoFiltro();
  const admin = useUsuarioConectado().papel === "admin";
  // As células trazem a hierarquia toda: com uma rede só, o filtro, os avisos e o relatório não citam a rede
  // (RIFA-065, D30). Contadas aqui, avisam o resto da tela (e do site) antes da pintura.
  useRedes(
    celulas.estado.tipo === "ok"
      ? contarRedes(celulas.estado.celulas.map((celula) => celula.rede_id))
      : null,
  );
  // Depois que a pessoa troca o filtro, a região viva diz o recorte que entrou (na carga inicial, não).
  const [trocouFiltro, setTrocouFiltro] = useState(false);

  function mudarEscopo(novo: Escopo) {
    setTrocouFiltro(true);
    setParams(paramsDoEscopo(novo), { replace: true });
  }

  function atualizar() {
    atualizarAgora();
    if (celulas.estado.tipo === "erro") celulas.recarregar();
  }

  const resumo =
    estado.tipo === "ok" || estado.tipo === "trocando" ? estado.resumo : null;
  const resumoAtual = estado.tipo === "ok" ? estado.resumo : null;

  return (
    <>
      <PageHeader titulo="Visão geral" ajuda={DICA_DO_MENU[""]} />
      {/* Alerta de webhook parado (RIFA-025): erros da Rifei, horas sem venda ou nenhuma venda ainda. */}
      <AlertaWebhook />
      <div className="visao-controles">
        <FiltroEscopo
          escopo={escopo}
          celulas={celulas.estado}
          nomeAtual={resumoAtual?.escopo.nome ?? null}
          aoMudar={mudarEscopo}
        />
        <div className="visao-atualizacao">
          <p>
            {atualizando
              ? "Atualizando…"
              : resumo &&
                `Atualizado às ${formatarHora(resumo.atualizado_em)}.`}{" "}
            Atualiza sozinho a cada {SEGUNDOS_ENTRE_ATUALIZACOES} s.
          </p>
          <ComDica texto={DICAS.atualizar}>
            <Button variante="secundario" onClick={atualizar}>
              Atualizar
            </Button>
          </ComDica>
        </div>
      </div>
      <p className="visao-falha" role="status">
        {estado.tipo === "ok" &&
          estado.falha !== null &&
          `A última atualização falhou: ${comoFrase(mensagemDoErro(estado.falha))} Os dados são das ${formatarHora(estado.resumo.atualizado_em)}; tentando de novo sozinho.`}
      </p>
      {/* Região viva fixa: um role="status" que já entra com o texto pode não ser lido. */}
      <p className="visualmente-oculto" role="status">
        {trocouFiltro && resumoAtual
          ? `Mostrando ${ROTULO_DO_ESCOPO[resumoAtual.escopo.tipo]}: ${resumoAtual.escopo.nome}.`
          : ""}
      </p>
      <Conteudo
        estado={estado}
        escopo={escopo}
        tentarDeNovo={tentarDeNovo}
        verCampanhaToda={() => mudarEscopo(ESCOPO_CAMPANHA)}
      />
      {/* Arrecadado (RIFA-087, no lugar do saldo da Efí): só o admin (a coordenação nem pede a rota, que lhe dá 403).
          Atualiza junto com o painel; é sempre da campanha toda, qualquer que seja o recorte. */}
      {admin && <Arrecadado sinal={resumo?.atualizado_em ?? null} />}
      {/* Relatório da campanha para baixar (RIFA-038): não depende do recorte nem do painel carregado. */}
      <RelatorioCampanha />
    </>
  );
}

type PropsConteudo = {
  estado: EstadoPainel;
  escopo: Escopo;
  tentarDeNovo: () => void;
  verCampanhaToda: () => void;
};

function Conteudo({
  estado,
  escopo,
  tentarDeNovo,
  verCampanhaToda,
}: PropsConteudo) {
  switch (estado.tipo) {
    case "carregando":
      return <EsqueletoDoPainel />;
    case "erro":
      if (!ehNaoEncontrado(estado.erro)) {
        return (
          <ErrorState
            mensagem={mensagemDoErro(estado.erro)}
            conexao={ehFalhaDeConexao(estado.erro)}
            aoTentarDeNovo={tentarDeNovo}
          />
        );
      }
      // 404 na campanha toda: não há campanha ativa. Num recorte: o item não existe (ou a campanha não
      // está ativa); a campanha toda diz qual dos dois.
      return escopo.tipo === "campanha" ? (
        <EmptyState
          titulo="Nenhuma campanha ativa"
          descricao={
            <>
              Ative a campanha em{" "}
              <Link to="/coordenacao/campanha">Campanha</Link> para acompanhar o
              ritmo das vendas aqui.
            </>
          }
        />
      ) : (
        <EmptyState
          titulo="Não encontramos este recorte"
          descricao={`${comoFrase(mensagemDoErro(estado.erro))} O item pode ter saído da hierarquia.`}
          acao={
            <ComDica texto={DICAS.verCampanhaToda}>
              <Button variante="secundario" onClick={verCampanhaToda}>
                Ver a campanha toda
              </Button>
            </ComDica>
          }
        />
      );
    case "ok":
    case "trocando":
      return (
        <Painel resumo={estado.resumo} trocando={estado.tipo === "trocando"} />
      );
  }
}

function Painel({
  resumo,
  trocando,
}: {
  resumo: RespostaPainelResumo;
  trocando: boolean;
}) {
  const { referencia, unidade } = resumo;
  const semVendas =
    resumo.vendas.pedidos_aprovados === 0 ? textoSemVendas(resumo) : null;
  return (
    // Trocando o filtro: o quadro anterior fica, esmaecido, até chegar o novo (sem pular a tela).
    <div
      className="visao-painel"
      aria-busy={trocando || undefined}
      data-trocando={trocando ? "" : undefined}
    >
      <Referencia resumo={resumo} />
      {semVendas && (
        <EmptyState titulo={semVendas.titulo} descricao={semVendas.descricao} />
      )}
      <div className="visao-cartoes">
        {resumo.hoje && (
          <CartaoHoje
            hoje={resumo.hoje}
            unidade={unidade}
            ultimoDia={referencia.dias_restantes === 1}
          />
        )}
        <CartaoCampanha resumo={resumo} />
        {resumo.periodo && referencia.periodo && (
          <CartaoPeriodo
            periodo={resumo.periodo}
            info={referencia.periodo}
            unidade={unidade}
          />
        )}
      </div>
      <AvisosVendas resumo={resumo} />
      <CurvaDaCampanha resumo={resumo} />
    </div>
  );
}
