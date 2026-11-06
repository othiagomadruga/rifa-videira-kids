import { useEffect, useRef, useState } from "react";
import {
  Abas,
  Aviso,
  Button,
  ErrorState,
  Loading,
  PageHeader,
  Stat,
  idDaAba,
} from "../../components/ui";
import { mensagemDoErro } from "../../lib/api";
import { formatarNumero } from "../../lib/formatadores";
import {
  DialogoCelula,
  DialogoDiscipulador,
  DialogoExcluir,
  DialogoRede,
  type AlvoExclusao,
} from "./Dialogos";
import { carregarHierarquia, type Hierarquia } from "./hierarquia-api";
import { ImportarPlanilha } from "./ImportarPlanilha";
import { TabelaCelulas, TabelaDiscipuladores, TabelaRedes } from "./Tabelas";
import type { Entidade } from "./textos";
import "./hierarquia.css";

const ID_ABAS = "hierarquia";
type IdAba = "celulas" | "discipuladores" | "redes" | "importar";

/** O que está sendo editado ou excluído: a entidade e o registro. */
type Alvo = AlvoExclusao;

/** Dados carregados e o erro da última carga (com dados, o erro é de uma recarga). */
type Carga = { dados: Hierarquia | null; erro: unknown };

const ROTULO_ENTIDADE: Record<
  Entidade,
  { nome: string; salvo: string; excluido: string }
> = {
  celula: { nome: "Célula", salvo: "salva", excluido: "excluída" },
  discipulador: { nome: "Discipulador", salvo: "salvo", excluido: "excluído" },
  rede: { nome: "Rede", salvo: "salva", excluido: "excluída" },
};

// Hierarquia da igreja (rede → discipulador → célula): resumo, tabelas para conferir e corrigir
// (editar e excluir) e a importação da planilha. As listas são pequenas (36 células): os filtros
// rodam no navegador e, depois de cada mudança, as três listas são lidas de novo.
export function HierarquiaPage() {
  const [carga, setCarga] = useState<Carga>({ dados: null, erro: null });
  const [versao, setVersao] = useState(0);
  const [aba, setAba] = useState<IdAba>("celulas");
  const [edicao, setEdicao] = useState<Alvo | null>(null);
  const [exclusao, setExclusao] = useState<Alvo | null>(null);
  const [aviso, setAviso] = useState<string | null>(null);
  // Depois de excluir, a linha some: o foco vai para a aba atual em vez de voltar ao botão.
  const refFocoAposExcluir = useRef<HTMLElement | null>(null);

  useEffect(() => {
    const controle = new AbortController();
    carregarHierarquia({ signal: controle.signal }).then(
      (dados) => setCarga({ dados, erro: null }),
      (erro: unknown) => {
        if (!controle.signal.aborted) {
          setCarga((atual) => ({ dados: atual.dados, erro }));
        }
      },
    );
    return () => controle.abort();
  }, [versao]);

  function recarregar() {
    setVersao((atual) => atual + 1);
  }

  function tentarDeNovo() {
    setCarga({ dados: null, erro: null });
    recarregar();
  }

  function irParaAba(destino: IdAba) {
    setAba(destino);
    document.getElementById(idDaAba(ID_ABAS, destino))?.focus();
  }

  function aoSalvar(alvo: Alvo, nome: string) {
    const rotulo = ROTULO_ENTIDADE[alvo.entidade];
    setEdicao(null);
    setAviso(`${rotulo.nome} “${nome}” ${rotulo.salvo}.`);
    recarregar();
  }

  function pedirExclusao(alvo: Alvo) {
    refFocoAposExcluir.current = null;
    setExclusao(alvo);
  }

  function aoExcluir(alvo: Alvo) {
    const rotulo = ROTULO_ENTIDADE[alvo.entidade];
    refFocoAposExcluir.current = document.getElementById(idDaAba(ID_ABAS, aba));
    setExclusao(null);
    setAviso(`${rotulo.nome} “${alvo.item.nome}” ${rotulo.excluido}.`);
    recarregar();
  }

  const { dados, erro } = carga;

  return (
    <>
      <PageHeader
        titulo="Hierarquia"
        descricao="Redes, discipuladores e células da campanha, com o número de pessoas de cada célula."
      />
      {/* Região viva fixa: anuncia o resultado de salvar e de excluir. */}
      <p className="visualmente-oculto" role="status">
        {aviso ?? ""}
      </p>
      {!dados && erro === null && <Loading texto="Carregando a hierarquia…" />}
      {!dados && erro !== null && (
        <ErrorState
          titulo="Não foi possível carregar a hierarquia."
          mensagem={mensagemDoErro(erro)}
          aoTentarDeNovo={tentarDeNovo}
        />
      )}
      {dados && (
        <>
          {erro !== null && (
            <Aviso
              tom="perigo"
              titulo="Não foi possível atualizar as tabelas"
              acao={
                <Button variante="secundario" onClick={recarregar}>
                  Tentar de novo
                </Button>
              }
            >
              <p>{mensagemDoErro(erro)}</p>
            </Aviso>
          )}
          {aviso && (
            <Aviso
              tom="sucesso"
              anuncio="nenhum"
              aoFechar={() => setAviso(null)}
            >
              <p>{aviso}</p>
            </Aviso>
          )}
          <Resumo dados={dados} />
          <Abas<IdAba>
            id={ID_ABAS}
            rotulo="Partes da hierarquia"
            abaAtiva={aba}
            aoMudar={setAba}
            abas={[
              {
                id: "celulas",
                rotulo: "Células",
                conteudo: (
                  <TabelaCelulas
                    celulas={dados.celulas}
                    redes={dados.redes}
                    aoEditar={(item) => setEdicao({ entidade: "celula", item })}
                    aoExcluir={(item) =>
                      pedirExclusao({ entidade: "celula", item })
                    }
                    aoIrParaImportar={() => irParaAba("importar")}
                  />
                ),
              },
              {
                id: "discipuladores",
                rotulo: "Discipuladores",
                conteudo: (
                  <TabelaDiscipuladores
                    discipuladores={dados.discipuladores}
                    celulas={dados.celulas}
                    aoEditar={(item) =>
                      setEdicao({ entidade: "discipulador", item })
                    }
                    aoExcluir={(item) =>
                      pedirExclusao({ entidade: "discipulador", item })
                    }
                  />
                ),
              },
              {
                id: "redes",
                rotulo: "Redes",
                conteudo: (
                  <TabelaRedes
                    redes={dados.redes}
                    discipuladores={dados.discipuladores}
                    celulas={dados.celulas}
                    aoEditar={(item) => setEdicao({ entidade: "rede", item })}
                    aoExcluir={(item) =>
                      pedirExclusao({ entidade: "rede", item })
                    }
                  />
                ),
              },
              {
                id: "importar",
                rotulo: "Importar planilha",
                conteudo: (
                  <ImportarPlanilha
                    aoImportar={recarregar}
                    aoVerCelulas={() => irParaAba("celulas")}
                  />
                ),
              },
            ]}
          />
          {edicao?.entidade === "celula" && (
            <DialogoCelula
              item={edicao.item}
              discipuladores={dados.discipuladores}
              aoFechar={() => setEdicao(null)}
              aoSalvar={(salva) => aoSalvar(edicao, salva.nome)}
              aoDesatualizar={recarregar}
            />
          )}
          {edicao?.entidade === "discipulador" && (
            <DialogoDiscipulador
              item={edicao.item}
              redes={dados.redes}
              aoFechar={() => setEdicao(null)}
              aoSalvar={(salvo) => aoSalvar(edicao, salvo.nome)}
              aoDesatualizar={recarregar}
            />
          )}
          {edicao?.entidade === "rede" && (
            <DialogoRede
              item={edicao.item}
              aoFechar={() => setEdicao(null)}
              aoSalvar={(salva) => aoSalvar(edicao, salva.nome)}
              aoDesatualizar={recarregar}
            />
          )}
          {exclusao && (
            <DialogoExcluir
              alvo={exclusao}
              aoFechar={() => setExclusao(null)}
              aoExcluir={() => aoExcluir(exclusao)}
              aoDesatualizar={recarregar}
              focoAoFechar={refFocoAposExcluir}
            />
          )}
        </>
      )}
    </>
  );
}

function Resumo({ dados }: { dados: Hierarquia }) {
  const pessoas = dados.celulas.reduce(
    (total, celula) => total + celula.qtd_pessoas,
    0,
  );
  return (
    <section aria-label="Resumo" className="grade hierarquia-resumo">
      <Stat rotulo="Redes" valor={formatarNumero(dados.redes.length)} />
      <Stat
        rotulo="Discipuladores"
        valor={formatarNumero(dados.discipuladores.length)}
      />
      <Stat rotulo="Células" valor={formatarNumero(dados.celulas.length)} />
      <Stat rotulo="Total de pessoas" valor={formatarNumero(pessoas)} />
    </section>
  );
}
