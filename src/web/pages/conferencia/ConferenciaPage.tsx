import { useEffect, useRef, useState } from "react";
import type {
  CampoReconciliacao,
  MapeamentoReconciliacao,
  RespostaAnaliseReconciliacao,
  RespostaRecuperarReconciliacao,
} from "../../../shared/contracts";
import {
  Aviso,
  Card,
  Loading,
  PageHeader,
  SeletorArquivo,
} from "../../components/ui";
import { ErroApi, mensagemDoErro } from "../../lib/api";
import { lerArquivo, type LeituraArquivo } from "./arquivo";
import { analisar } from "./conferencia-api";
import { DialogoRecuperar } from "./DialogoRecuperar";
import { Historico } from "./Historico";
import { Mapeamento } from "./Mapeamento";
import { Resultado } from "./Resultado";
import { CAMPOS, plural } from "./textos";
import "./conferencia.css";

const CAMPOS_EM_ORDEM = Object.keys(CAMPOS) as CampoReconciliacao[];

type Falha = { titulo: string; mensagem: string; itens: string[] };

/** As vendas perdidas que dá para recuperar (modo por pedido). */
function recuperaveisDe(analise: RespostaAnaliseReconciliacao): string[] {
  if (analise.modo !== "por_pedido") return [];
  const perdidas = analise.divergencias.find(
    (grupo) => grupo.tipo === "venda_perdida",
  );
  return (perdidas?.itens ?? [])
    .filter((item) => item.recuperavel)
    .map((item) => item.pedido_id);
}

/** O que o leitor de tela ouve quando a conferência chega. */
function anuncioDaAnalise(analise: RespostaAnaliseReconciliacao): string {
  if (analise.modo === "agregado")
    return analise.total.confere
      ? "Conferência pronta: os totais conferem."
      : "Conferência pronta: os totais não batem.";
  const perdidas =
    analise.divergencias.find((grupo) => grupo.tipo === "venda_perdida")
      ?.quantidade ?? 0;
  if (analise.resumo.com_divergencia === 0)
    return "Conferência pronta: tudo confere.";
  return `Conferência pronta: ${plural(analise.resumo.com_divergencia, "pedido", "pedidos")} com diferença, ${plural(perdidas, "venda perdida", "vendas perdidas")}.`;
}

function falhaDaConferencia(erro: unknown): Falha {
  if (erro instanceof ErroApi) {
    if (erro.codigo === "csv_invalido")
      return {
        titulo: "Não foi possível ler o arquivo",
        mensagem: erro.mensagem,
        itens: [],
      };
    if (erro.codigo === "requisicao_invalida" && Array.isArray(erro.detalhes))
      return {
        titulo: "Estas colunas não servem",
        mensagem: erro.mensagem,
        itens: erro.detalhes.flatMap((detalhe: unknown) =>
          typeof detalhe === "object" &&
          detalhe !== null &&
          "mensagem" in detalhe &&
          typeof detalhe.mensagem === "string"
            ? [detalhe.mensagem]
            : [],
        ),
      };
    if (erro.codigo === "nao_encontrado")
      return {
        titulo: "Não dá para conferir ainda",
        mensagem: erro.mensagem,
        itens: [],
      };
  }
  return {
    titulo: "Não foi possível conferir",
    mensagem: mensagemDoErro(erro),
    itens: [],
  };
}

// Conferência pelo CSV da Rifei (RIFA-012): a coordenação sobe o arquivo "Exportar Pedidos", confere as
// colunas que o sistema reconheceu, vê as diferenças entre a Rifei e o sistema e recupera as vendas que se
// perderam. O texto do arquivo fica só na memória desta tela (sai ao escolher outro arquivo ou ao sair).
export function ConferenciaPage() {
  const [arquivo, setArquivo] = useState<File | null>(null);
  const [leitura, setLeitura] = useState<LeituraArquivo | null>(null);
  const [analise, setAnalise] = useState<RespostaAnaliseReconciliacao | null>(
    null,
  );
  /** O mapeamento na tela (pode ter trocas ainda não conferidas). */
  const [mapeamento, setMapeamento] = useState<MapeamentoReconciliacao | null>(
    null,
  );
  const [ocupado, setOcupado] = useState<"lendo" | "conferindo" | null>(null);
  const [falha, setFalha] = useState<Falha | null>(null);
  const [selecionados, setSelecionados] = useState<ReadonlySet<string>>(
    () => new Set(),
  );
  const [aRecuperar, setARecuperar] = useState<string[] | null>(null);
  const [recuperacao, setRecuperacao] =
    useState<RespostaRecuperarReconciliacao | null>(null);
  const [versaoHistorico, setVersaoHistorico] = useState(0);
  const [anuncio, setAnuncio] = useState("");
  // Cada arquivo escolhido e cada conferência é uma tentativa: respostas de uma antiga são ignoradas.
  const sequencia = useRef(0);
  const controle = useRef<AbortController | null>(null);
  const focarDepois = useRef<"resultado" | "falha" | null>(null);
  const refTitulo = useRef<HTMLSpanElement>(null);
  const refFalha = useRef<HTMLDivElement>(null);

  useEffect(() => () => controle.current?.abort(), []);

  useEffect(() => {
    const pedido = focarDepois.current;
    if (!pedido) return;
    focarDepois.current = null;
    (pedido === "resultado" ? refTitulo : refFalha).current?.focus();
  }, [analise, falha]);

  const csv = leitura?.tipo === "ok" ? leitura.csv : null;

  async function conferir(
    texto: string,
    comMapeamento: MapeamentoReconciliacao | null,
    focar = true,
  ) {
    const minha = ++sequencia.current;
    controle.current?.abort();
    const meu = new AbortController();
    controle.current = meu;
    setOcupado("conferindo");
    setFalha(null);
    try {
      const resposta = await analisar(texto, comMapeamento, {
        signal: meu.signal,
      });
      if (minha !== sequencia.current) return;
      if (focar) focarDepois.current = "resultado";
      setAnalise(resposta);
      setMapeamento(resposta.mapeamento);
      setSelecionados(new Set(recuperaveisDe(resposta)));
      setAnuncio(anuncioDaAnalise(resposta));
    } catch (erro) {
      if (meu.signal.aborted || minha !== sequencia.current) return;
      focarDepois.current = "falha";
      setFalha(falhaDaConferencia(erro));
    } finally {
      if (minha === sequencia.current) setOcupado(null);
    }
  }

  async function escolher(novo: File) {
    const minha = ++sequencia.current;
    controle.current?.abort();
    setArquivo(novo);
    setLeitura(null);
    setAnalise(null);
    setMapeamento(null);
    setFalha(null);
    setRecuperacao(null);
    setSelecionados(new Set());
    setAnuncio("");
    setOcupado("lendo");
    const lida = await lerArquivo(novo);
    if (minha !== sequencia.current) return;
    setLeitura(lida);
    if (lida.tipo !== "ok") {
      setOcupado(null);
      return;
    }
    await conferir(lida.csv, null);
  }

  function selecionar(codigos: string[], marcado: boolean) {
    setSelecionados((atual) => {
      const novo = new Set(atual);
      for (const codigo of codigos) {
        if (marcado) novo.add(codigo);
        else novo.delete(codigo);
      }
      return novo;
    });
  }

  function abrirRecuperar() {
    if (!analise) return;
    const escolhidas = recuperaveisDe(analise).filter((codigo) =>
      selecionados.has(codigo),
    );
    if (escolhidas.length > 0) setARecuperar(escolhidas);
  }

  function aoGravar(resposta: RespostaRecuperarReconciliacao) {
    setARecuperar(null);
    setRecuperacao(resposta);
    setVersaoHistorico((versao) => versao + 1);
    setAnuncio(
      resposta.aplicado
        ? `${plural(resposta.recuperados.length, "venda recuperada", "vendas recuperadas")}: já contam no painel e no ranking.`
        : "Nada foi gravado: as vendas escolhidas já estavam no sistema.",
    );
    // Confere de novo com as mesmas colunas: as recuperadas saem das vendas perdidas.
    if (csv && analise) void conferir(csv, analise.mapeamento, false);
  }

  const alterado =
    analise !== null &&
    mapeamento !== null &&
    CAMPOS_EM_ORDEM.some(
      (campo) => mapeamento[campo] !== analise.mapeamento[campo],
    );

  const avisoDaRecuperacao =
    recuperacao &&
    (recuperacao.aplicado ? (
      <Aviso
        tom="sucesso"
        anuncio="nenhum"
        titulo={plural(
          recuperacao.recuperados.length,
          "venda recuperada",
          "vendas recuperadas",
        )}
        aoFechar={() => setRecuperacao(null)}
      >
        <p>
          {plural(recuperacao.totais.bilhetes, "bilhete", "bilhetes")} já contam
          no painel e no ranking. A conferência abaixo já foi refeita.
        </p>
        {recuperacao.nao_recuperados.length > 0 && (
          <p>
            {plural(
              recuperacao.nao_recuperados.length,
              "venda ficou",
              "vendas ficaram",
            )}{" "}
            de fora: já estavam no sistema.
          </p>
        )}
      </Aviso>
    ) : (
      <Aviso
        tom="alerta"
        anuncio="nenhum"
        titulo="Nada foi gravado"
        aoFechar={() => setRecuperacao(null)}
      >
        <p>As vendas escolhidas já estavam no sistema.</p>
      </Aviso>
    ));

  const avisoDaFalha = falha && (
    <div ref={refFalha} tabIndex={-1} className="conferencia-foco">
      <Aviso tom="perigo" titulo={falha.titulo}>
        <p>{falha.mensagem}</p>
        {falha.itens.length > 0 && (
          <ul>
            {falha.itens.map((item) => (
              <li key={item}>{item}</li>
            ))}
          </ul>
        )}
      </Aviso>
    </div>
  );

  return (
    <>
      <PageHeader
        titulo="Conferência"
        descricao="Compare as vendas da Rifei com as do sistema e recupere as que se perderam."
      />
      <p className="visualmente-oculto" role="status">
        {anuncio}
      </p>
      <div className="pilha conferencia">
        <Card titulo="Como conferir">
          <div className="conferencia-bloco">
            <ol className="conferencia-passos">
              <li>
                Na Rifei, abra os pedidos da campanha, toque em ⋮ e em{" "}
                <strong>Exportar Pedidos</strong>. Inclua o código do pedido, o
                status, a quantidade de bilhetes, o valor, o afiliado e a data
                do pagamento. Deixe “Um bilhete por linha” desmarcado.
              </li>
              <li>
                Escolha aqui o arquivo baixado, sem abrir e salvar no Excel
                antes. O sistema reconhece as colunas e compara com as vendas
                gravadas.
              </li>
              <li>
                Veja as diferenças. Uma venda paga na Rifei que não chegou ao
                sistema pode ser recuperada: ela passa a contar no painel e no
                ranking.
              </li>
            </ol>
            <Aviso
              tom="info"
              anuncio="nenhum"
              titulo="Os dados dos compradores não ficam no sistema"
            >
              <p>
                Nome, e-mail e telefone são ignorados. O arquivo é lido,
                comparado e descartado: nada dele fica guardado.
              </p>
            </Aviso>
          </div>
        </Card>

        <Card titulo="Arquivo da Rifei">
          <div className="conferencia-bloco">
            <SeletorArquivo
              rotulo="Arquivo exportado da Rifei (CSV)"
              dica="O arquivo que a Rifei baixa em “Exportar Pedidos”."
              aceitar=".csv,text/csv"
              arquivo={arquivo}
              aoEscolher={(novo) => void escolher(novo)}
              desabilitado={ocupado !== null}
            />
            {ocupado === "lendo" && <Loading texto="Lendo o arquivo…" />}
            {ocupado === "conferindo" && (
              <Loading texto="Conferindo com as vendas do sistema…" />
            )}
            {leitura?.tipo === "problema" && (
              <Aviso tom="alerta" titulo={leitura.titulo}>
                <p>{leitura.mensagem}</p>
              </Aviso>
            )}
            {leitura?.tipo === "ok" &&
              leitura.codificacao === "windows-1252" && (
                <Aviso tom="info" anuncio="nenhum">
                  <p>
                    O arquivo não estava em UTF-8 e foi lido como no Excel
                    (Windows-1252). Confira se os acentos aparecem certos nos
                    nomes das colunas.
                  </p>
                </Aviso>
              )}
            {!analise && avisoDaFalha}
          </div>
        </Card>

        {analise && mapeamento && (
          <Mapeamento
            colunas={analise.colunas}
            mapeamento={mapeamento}
            detectado={analise.mapeamento_detectado}
            alterado={alterado}
            ocupado={ocupado !== null}
            aoMudar={(campo, indice) =>
              setMapeamento((atual) =>
                atual ? { ...atual, [campo]: indice } : atual,
              )
            }
            aoConferir={() => {
              if (csv) void conferir(csv, mapeamento);
            }}
            aoDesfazer={() => setMapeamento(analise.mapeamento)}
          />
        )}
        {analise && avisoDaFalha}

        {analise && (
          <Resultado
            analise={analise}
            selecionados={selecionados}
            aoSelecionar={selecionar}
            aoRecuperar={abrirRecuperar}
            refTitulo={refTitulo}
            aviso={avisoDaRecuperacao}
          />
        )}

        <Historico versao={versaoHistorico} />
      </div>

      {aRecuperar && csv && analise && (
        <DialogoRecuperar
          csv={csv}
          mapeamento={analise.mapeamento}
          pedidos={aRecuperar}
          aoFechar={() => setARecuperar(null)}
          aoGravar={aoGravar}
        />
      )}
    </>
  );
}
