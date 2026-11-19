import { Suspense, lazy, useState } from "react";
import { Link } from "react-router";
import {
  Button,
  ComDica,
  EmptyState,
  ErrorState,
  Loading,
  PageHeader,
} from "../../components/ui";
import { ehFalhaDeConexao, mensagemDoErro } from "../../lib/api";
import { useUsuarioConectado } from "../../lib/sessao";
import {
  removerAfiliado,
  salvarVinculo,
  type AfiliadoResumo,
  type PainelAdesao,
} from "./adesao-api";
import { formatarHoraComSegundos } from "./formatos";
import { AfiliadosDaRifei } from "./AfiliadosDaRifei";
import { DICAS } from "./textos";
import { QuemFalta } from "./QuemFalta";
import { ResumoAdesao } from "./ResumoAdesao";
import { SemCelula } from "./SemCelula";
import { TodasAsCelulas } from "./TodasAsCelulas";
import { INTERVALO_ATUALIZACAO_MS, usePainelAdesao } from "./usePainelAdesao";
import { useTelaLarga } from "./useTelaLarga";
import type {
  AoRemoverAfiliado,
  AoSalvarVinculo,
  AvisoDeSucesso,
} from "./vinculo";
import "./adesao.css";

// Os links de vendas e o QR code de cada célula (RIFA-046, D24) vêm num pacote à parte, com o próprio CSS: o gerador
// de QR code (`qr`) nunca entra no pacote inicial do site.
const LinksDeVendas = lazy(() =>
  import("./LinksDeVendas").then((modulo) => ({
    default: modulo.LinksDeVendas,
  })),
);

const SEGUNDOS_ENTRE_ATUALIZACOES = INTERVALO_ATUALIZACAO_MS / 1000;

/** Órfão vinculado nesta tela e quando (Date.now() da resposta do PUT). */
type VinculadoAgora = { affiliateId: number; em: number };

/**
 * A fila sem os órfãos que acabaram de ser vinculados aqui: eles somem na hora e só voltam a valer os
 * dados da API quando chegar uma consulta terminada depois do vínculo (o "Atualizar" que vem em seguida).
 */
function filaSemOsVinculadosAgora(
  painel: PainelAdesao,
  vinculados: VinculadoAgora[],
): AfiliadoResumo[] {
  return painel.orfaos.filter(
    (orfao) =>
      !vinculados.some(
        (vinculado) =>
          vinculado.affiliateId === orfao.affiliate_id &&
          painel.obtidoEm < vinculado.em,
      ),
  );
}

// Painel da reunião de cadastro dos líderes, pensado para o celular: quem já virou afiliado na Rifei,
// a fila de códigos sem célula (para vincular), quem falta (para chamar o líder ali mesmo) e, no fim, o link
// de vendas e o QR code de cada célula (RIFA-046).
export function AdesaoPage() {
  const { estado, atualizando, atualizarAgora, tentarDeNovo } =
    usePainelAdesao();
  const telaLarga = useTelaLarga();
  // Último vínculo salvo: aparece perto de onde a pessoa estava e é anunciado pela região viva abaixo.
  const [aviso, setAviso] = useState<AvisoDeSucesso | null>(null);
  const [vinculadosAgora, setVinculadosAgora] = useState<VinculadoAgora[]>([]);
  // Remover afiliado de teste (RIFA-031): só o admin.
  const admin = useUsuarioConectado().papel === "admin";

  /** O afiliado saiu da fila nesta tela: some na hora, até a próxima consulta. */
  function tirarDaFila(affiliateId: number) {
    const em = Date.now();
    const obtidoEm = estado.tipo === "ok" ? estado.painel.obtidoEm : 0;
    // Os de antes da última consulta já não escondem nada: saem da lista.
    setVinculadosAgora((lista) => [
      ...lista.filter(
        (item) => item.affiliateId !== affiliateId && item.em > obtidoEm,
      ),
      { affiliateId, em },
    ]);
  }

  const aoRemover: AoRemoverAfiliado = async ({
    affiliateId,
    sucesso,
    local,
  }) => {
    await removerAfiliado(affiliateId);
    tirarDaFila(affiliateId);
    setAviso({ texto: sucesso, local });
    atualizarAgora();
  };

  const aoSalvar: AoSalvarVinculo = async ({
    affiliateId,
    celulaId,
    sucesso,
    local,
  }) => {
    await salvarVinculo(affiliateId, celulaId);
    if (celulaId !== null) tirarDaFila(affiliateId);
    setAviso({ texto: sucesso, local });
    atualizarAgora();
  };

  return (
    <>
      <PageHeader
        titulo="Adesão"
        descricao="Quem já virou afiliado na Rifei e quem falta."
      />
      {estado.tipo === "carregando" && (
        <Loading texto="Carregando a adesão das células…" />
      )}
      {estado.tipo === "erro" && (
        <ErrorState
          mensagem={mensagemDoErro(estado.erro)}
          conexao={ehFalhaDeConexao(estado.erro)}
          aoTentarDeNovo={tentarDeNovo}
        />
      )}
      {estado.tipo === "ok" && (
        <>
          <div className="adesao-status">
            <div className="adesao-status__linha">
              <p>
                {atualizando
                  ? "Atualizando…"
                  : `Atualizado às ${formatarHoraComSegundos(estado.painel.obtidoEm)}.`}{" "}
                Atualiza sozinho a cada {SEGUNDOS_ENTRE_ATUALIZACOES} s.
              </p>
              <ComDica texto={DICAS.atualizarAgora}>
                <Button variante="secundario" onClick={atualizarAgora}>
                  Atualizar agora
                </Button>
              </ComDica>
            </div>
            <p className="adesao-status__falha" role="status">
              {estado.falha !== null &&
                `A última atualização falhou: ${mensagemDoErro(estado.falha)} Os dados são das ${formatarHoraComSegundos(estado.painel.obtidoEm)}; tentando de novo sozinho.`}
            </p>
            {/* Região viva fixa: um role="status" que já entra com o texto pode não ser lido. */}
            <p className="visualmente-oculto" role="status">
              {aviso?.texto}
            </p>
          </div>
          <Painel
            painel={estado.painel}
            orfaos={filaSemOsVinculadosAgora(estado.painel, vinculadosAgora)}
            telaLarga={telaLarga}
            aviso={aviso}
            aoSalvar={aoSalvar}
            aoRemover={admin ? aoRemover : null}
          />
          <Suspense
            fallback={<Loading texto="Carregando os links de vendas…" />}
          >
            <LinksDeVendas celulas={estado.painel.adesao.itens} />
          </Suspense>
          {/* RIFA-070 (D32): afiliados e convites pela API da Rifei, só o admin. */}
          {admin && <AfiliadosDaRifei aoMudar={atualizarAgora} />}
        </>
      )}
    </>
  );
}

type PropsPainel = {
  painel: PainelAdesao;
  /** A fila de órfãos que a tela mostra. */
  orfaos: AfiliadoResumo[];
  telaLarga: boolean;
  aviso: AvisoDeSucesso | null;
  aoSalvar: AoSalvarVinculo;
  /** Só para o admin: remover afiliado de teste. */
  aoRemover: AoRemoverAfiliado | null;
};

// As seções seguem a mesma ordem no celular e no computador (resumo, "Sem célula", "Quem falta" e todas
// as células): a fila de órfãos fica logo abaixo do resumo, e nada muda de lugar a cada atualização (mover
// uma seção no DOM tiraria o foco de quem está nela).
function Painel({
  painel,
  orfaos,
  telaLarga,
  aviso,
  aoSalvar,
  aoRemover,
}: PropsPainel) {
  const { adesao, obtidoEm } = painel;
  const semCelula = (
    <SemCelula
      orfaos={orfaos}
      celulas={adesao.itens}
      agora={obtidoEm}
      aviso={aviso}
      aoSalvar={aoSalvar}
      aoRemover={aoRemover}
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
      <ResumoAdesao
        resumo={adesao.resumo}
        afiliadosSemCelula={orfaos.length}
        compacto={!telaLarga}
      />
      <div className="adesao-colunas">
        {semCelula}
        <QuemFalta celulas={adesao.itens} />
      </div>
      <TodasAsCelulas
        celulas={adesao.itens}
        orfaos={orfaos}
        aviso={aviso}
        aoSalvar={aoSalvar}
        aoRemover={aoRemover}
      />
    </>
  );
}
