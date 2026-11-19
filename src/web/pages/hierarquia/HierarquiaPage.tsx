import { useEffect, useRef, useState } from "react";
import {
  Abas,
  Aviso,
  Button,
  ComDica,
  ErrorState,
  Loading,
  PageHeader,
  Stat,
  idDaAba,
} from "../../components/ui";
import { ehFalhaDeConexao, mensagemDoErro } from "../../lib/api";
import { formatarNumero } from "../../lib/formatadores";
import { useRedes } from "../../lib/redes";
import {
  DialogoCelula,
  DialogoDiscipulador,
  DialogoExcluir,
  DialogoRede,
  type AlvoExclusao,
} from "./Dialogos";
import { carregarHierarquia, type Hierarquia } from "./hierarquia-api";
import { ImportarPlanilha } from "./ImportarPlanilha";
import { LoginDasCelulas } from "./LoginDasCelulas";
import { TabelaCelulas, TabelaDiscipuladores, TabelaRedes } from "./Tabelas";
import { DICAS, DICAS_REDE_UNICA, type Entidade } from "./textos";
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
// rodam no navegador e, depois de cada mudança, as três listas são lidas de novo. Com uma rede só (RIFA-065, D30),
// a rede some da tela (o número, a aba, as colunas, o filtro e o campo do discipulador); a planilha continua com ela.
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
  // A lista das redes diz se a rede é única; antes dela, o que o site já sabia (D30).
  const redes = useRedes(dados ? dados.redes.length : null);
  const redeUnica = redes.unica;
  // Sem a aba Redes (uma rede só), quem estava nela volta para as células.
  const abaAtiva = redeUnica && aba === "redes" ? "celulas" : aba;

  return (
    <>
      <PageHeader
        titulo="Hierarquia"
        descricao={
          redes.citar
            ? "Redes, discipuladores e células da campanha, com o número de pessoas de cada célula."
            : "Discipuladores e células da campanha, com o número de pessoas de cada célula."
        }
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
          conexao={ehFalhaDeConexao(erro)}
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
                <ComDica texto={DICAS.tentarDeNovo}>
                  <Button variante="secundario" onClick={recarregar}>
                    Tentar de novo
                  </Button>
                </ComDica>
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
          <Resumo dados={dados} redeUnica={redeUnica} />
          {/* RIFA-064 (D29): o aviso das células que não entram pela senha e a senha de cada uma, para repassar. */}
          <LoginDasCelulas celulas={dados.celulas} />
          <Abas<IdAba>
            id={ID_ABAS}
            rotulo="Partes da hierarquia"
            abaAtiva={abaAtiva}
            aoMudar={setAba}
            abas={[
              {
                id: "celulas",
                rotulo: "Células",
                dica: redeUnica
                  ? DICAS_REDE_UNICA.abaCelulas
                  : DICAS.abaCelulas,
                conteudo: (
                  <TabelaCelulas
                    celulas={dados.celulas}
                    redes={dados.redes}
                    redeUnica={redeUnica}
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
                dica: redeUnica
                  ? DICAS_REDE_UNICA.abaDiscipuladores
                  : DICAS.abaDiscipuladores,
                conteudo: (
                  <TabelaDiscipuladores
                    discipuladores={dados.discipuladores}
                    celulas={dados.celulas}
                    redeUnica={redeUnica}
                    aoEditar={(item) =>
                      setEdicao({ entidade: "discipulador", item })
                    }
                    aoExcluir={(item) =>
                      pedirExclusao({ entidade: "discipulador", item })
                    }
                  />
                ),
              },
              // Com uma rede só, sem a aba das redes (D30).
              ...(redeUnica
                ? []
                : [
                    {
                      id: "redes" as const,
                      rotulo: "Redes",
                      dica: DICAS.abaRedes,
                      conteudo: (
                        <TabelaRedes
                          redes={dados.redes}
                          discipuladores={dados.discipuladores}
                          celulas={dados.celulas}
                          aoEditar={(item) =>
                            setEdicao({ entidade: "rede", item })
                          }
                          aoExcluir={(item) =>
                            pedirExclusao({ entidade: "rede", item })
                          }
                        />
                      ),
                    },
                  ]),
              {
                id: "importar",
                rotulo: "Importar planilha",
                dica: redeUnica
                  ? DICAS_REDE_UNICA.abaImportar
                  : DICAS.abaImportar,
                conteudo: (
                  <ImportarPlanilha
                    redeUnica={redeUnica}
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
              redeUnica={redeUnica}
              aoFechar={() => setEdicao(null)}
              aoSalvar={(salva) => aoSalvar(edicao, salva.nome)}
              aoDesatualizar={recarregar}
            />
          )}
          {edicao?.entidade === "discipulador" && (
            <DialogoDiscipulador
              item={edicao.item}
              redes={dados.redes}
              redeUnica={redeUnica}
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

function Resumo({
  dados,
  redeUnica,
}: {
  dados: Hierarquia;
  /** Uma rede só (D30): sem o número de redes. */
  redeUnica: boolean;
}) {
  const pessoas = dados.celulas.reduce(
    (total, celula) => total + celula.qtd_pessoas,
    0,
  );
  return (
    // Os números com a cara única do Stat (RIFA-051, P3.5): o chip do ícone diz o que é cada um, no roxo da marca.
    <section aria-label="Resumo" className="grade hierarquia-resumo">
      {!redeUnica && (
        <Stat
          rotulo="Redes"
          valor={formatarNumero(dados.redes.length)}
          icone="hierarquia"
          tom="marca"
        />
      )}
      <Stat
        rotulo="Discipuladores"
        valor={formatarNumero(dados.discipuladores.length)}
        icone="adesao"
        tom="marca"
      />
      <Stat
        rotulo="Células"
        valor={formatarNumero(dados.celulas.length)}
        icone="celula"
        tom="marca"
      />
      <Stat
        rotulo="Total de pessoas"
        valor={formatarNumero(pessoas)}
        icone="pessoas"
        tom="marca"
      />
    </section>
  );
}
