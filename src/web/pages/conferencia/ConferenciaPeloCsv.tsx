import { useEffect, useRef, useState } from "react";
import type {
  AvisoReconciliacao,
  CampoReconciliacao,
  CorpoConferencia,
  MapeamentoReconciliacao,
  RespostaAnaliseReconciliacao,
  RespostaRecuperarReconciliacao,
} from "../../../shared/contracts";
import { juntarAvisos } from "../../../shared/conferencia/avisos";
import {
  corpoGrandeDemais,
  lerArquivoConferencia,
  montarCorpo,
  type ArquivoConferencia,
} from "../../../shared/conferencia/leitura";
import { Aviso, Card, Loading, SeletorArquivo } from "../../components/ui";
import { ErroApi, mensagemDoErro } from "../../lib/api";
import { lerArquivo, sha256DoTexto } from "./arquivo";
import { analisar, carregarFusoDaCampanha } from "./conferencia-api";
import { DialogoRecuperar } from "./DialogoRecuperar";
import { Historico } from "./Historico";
import { Mapeamento } from "./Mapeamento";
import { Resultado } from "./Resultado";
import { CAMPOS, DICAS, plural } from "./textos";
import "./conferencia.css";

const CAMPOS_EM_ORDEM = Object.keys(CAMPOS) as CampoReconciliacao[];

type Falha = { titulo: string; mensagem: string; itens: string[] };

/** O arquivo lido na tela: as colunas e as linhas (só na memória), o SHA-256 e a codificação. */
type Lido = {
  arquivo: ArquivoConferencia;
  sha256: string;
  codificacao: "utf-8" | "windows-1252";
};

/** A última conferência: a resposta, o corpo enviado (o "Recuperar" usa o mesmo) e os avisos da leitura. */
type Conferida = {
  analise: RespostaAnaliseReconciliacao;
  corpo: CorpoConferencia;
  mapeamento: MapeamentoReconciliacao;
  avisos: AvisoReconciliacao[];
};

const mesmoMapeamento = (
  a: MapeamentoReconciliacao,
  b: MapeamentoReconciliacao,
) => CAMPOS_EM_ORDEM.every((campo) => a[campo] === b[campo]);

/** As vendas perdidas que dá para recuperar (modo por pedido; com a trava do código, nenhuma). */
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
  if (!analise.codigo.confere)
    return "Conferência pronta: a coluna escolhida como código do pedido não parece ser o código da Rifei.";
  const perdidas =
    analise.divergencias.find((grupo) => grupo.tipo === "venda_perdida")
      ?.quantidade ?? 0;
  if (analise.resumo.com_divergencia === 0)
    return "Conferência pronta: tudo confere.";
  return `Conferência pronta: ${plural(analise.resumo.com_divergencia, "pedido", "pedidos")} com diferença, ${plural(perdidas, "venda perdida", "vendas perdidas")}.`;
}

const SEM_CAMPANHA: Falha = {
  titulo: "Não dá para conferir ainda",
  mensagem:
    "A campanha ainda não foi configurada: configure-a antes de conferir.",
  itens: [],
};

const PEDIDOS_DEMAIS: Falha = {
  titulo: "O arquivo tem pedidos demais para conferir de uma vez",
  mensagem:
    "Exporte da Rifei um período menor (por exemplo, metade dos dias) e confira cada parte. Com a opção “Um bilhete por linha” desmarcada, cabem mais pedidos.",
  itens: [],
};

function falhaDaConferencia(erro: unknown): Falha {
  if (erro instanceof ErroApi) {
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
    if (erro.codigo === "nao_encontrado") return SEM_CAMPANHA;
    if (erro.codigo === "corpo_muito_grande") return PEDIDOS_DEMAIS;
  }
  return {
    titulo: "Não foi possível conferir",
    mensagem: mensagemDoErro(erro),
    itens: [],
  };
}

// Conferência pelo CSV da Rifei (RIFA-012): a coordenação escolhe o arquivo "Exportar Pedidos", a tela o lê
// AQUI (colunas, linhas, datas no fuso da campanha) e manda ao sistema só as colunas mapeadas que não são
// de dado pessoal; a coordenação confere as colunas, vê as diferenças entre a Rifei e o sistema e recupera
// as vendas que se perderam. O texto do arquivo fica só na memória desta tela. O cabeçalho fica em
// ConferenciaPage, que carrega este módulo num pacote à parte.
export function ConferenciaPeloCsv() {
  const [arquivo, setArquivo] = useState<File | null>(null);
  const [lido, setLido] = useState<Lido | null>(null);
  /** O mapeamento na tela (pode ter trocas ainda não conferidas). */
  const [mapeamento, setMapeamento] = useState<MapeamentoReconciliacao | null>(
    null,
  );
  const [conferida, setConferida] = useState<Conferida | null>(null);
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
  /** O fuso da campanha ativa (as datas do arquivo são lidas nele); null = sem campanha. */
  const fuso = useRef<string | null | undefined>(undefined);
  const focarDepois = useRef<"resultado" | "falha" | null>(null);
  const refTitulo = useRef<HTMLSpanElement>(null);
  const refFalha = useRef<HTMLDivElement>(null);

  useEffect(() => () => controle.current?.abort(), []);

  useEffect(() => {
    const pedido = focarDepois.current;
    if (!pedido) return;
    focarDepois.current = null;
    (pedido === "resultado" ? refTitulo : refFalha).current?.focus();
  }, [conferida, falha]);

  /** Monta o corpo na tela e confere com o sistema; o corpo enviado fica guardado para o "Recuperar". */
  async function conferir(atual: Lido, comMapeamento: MapeamentoReconciliacao) {
    const minha = ++sequencia.current;
    controle.current?.abort();
    const meu = new AbortController();
    controle.current = meu;
    setOcupado("conferindo");
    setFalha(null);
    setMapeamento(comMapeamento);
    const falhar = (motivo: Falha) => {
      focarDepois.current = "falha";
      setFalha(motivo);
    };
    try {
      if (fuso.current === undefined)
        fuso.current = await carregarFusoDaCampanha({ signal: meu.signal });
      if (minha !== sequencia.current) return;
      if (fuso.current === null) {
        falhar(SEM_CAMPANHA);
        return;
      }
      const montagem = montarCorpo(atual.arquivo, comMapeamento, {
        fuso: fuso.current,
        arquivoSha256: atual.sha256,
      });
      if (!montagem.ok) {
        falhar({
          titulo: "Estas colunas não servem",
          mensagem: "Troque as colunas apontadas e confira de novo.",
          itens: montagem.problemas.map((problema) => problema.mensagem),
        });
        return;
      }
      if (corpoGrandeDemais(JSON.stringify(montagem.corpo))) {
        falhar(PEDIDOS_DEMAIS);
        return;
      }
      const resposta = await analisar(montagem.corpo, { signal: meu.signal });
      if (minha !== sequencia.current) return;
      focarDepois.current = "resultado";
      setConferida({
        analise: resposta,
        corpo: montagem.corpo,
        mapeamento: comMapeamento,
        avisos: montagem.avisos,
      });
      setSelecionados(new Set(recuperaveisDe(resposta)));
      setAnuncio(anuncioDaAnalise(resposta));
    } catch (erro) {
      if (meu.signal.aborted || minha !== sequencia.current) return;
      falhar(falhaDaConferencia(erro));
    } finally {
      if (minha === sequencia.current) setOcupado(null);
    }
  }

  async function escolher(novo: File) {
    const minha = ++sequencia.current;
    controle.current?.abort();
    setArquivo(novo);
    setLido(null);
    setConferida(null);
    setMapeamento(null);
    setFalha(null);
    setRecuperacao(null);
    setSelecionados(new Set());
    setAnuncio("");
    setOcupado("lendo");
    // Um problema do arquivo (vazio, grande, sem cabeçalho...) aparece no lugar da conferência, com o foco.
    const problema = (titulo: string, mensagem: string) => {
      focarDepois.current = "falha";
      setFalha({ titulo, mensagem, itens: [] });
      setOcupado(null);
    };
    const decodificado = await lerArquivo(novo);
    if (minha !== sequencia.current) return;
    if (decodificado.tipo !== "ok") {
      problema(decodificado.titulo, decodificado.mensagem);
      return;
    }
    const leitura = lerArquivoConferencia(decodificado.texto);
    if (!leitura.ok) {
      problema(leitura.titulo, leitura.mensagem);
      return;
    }
    const sha256 = await sha256DoTexto(decodificado.texto);
    if (minha !== sequencia.current) return;
    const atual: Lido = {
      arquivo: leitura,
      sha256,
      codificacao: decodificado.codificacao,
    };
    setLido(atual);
    await conferir(atual, leitura.mapeamentoDetectado);
  }

  /** Depois de recuperar: confere de novo com o mesmo corpo (as recuperadas saem das vendas perdidas). */
  async function conferirDeNovo(anterior: Conferida) {
    const minha = ++sequencia.current;
    try {
      const resposta = await analisar(anterior.corpo);
      if (minha !== sequencia.current) return;
      setConferida({ ...anterior, analise: resposta });
      setSelecionados(new Set(recuperaveisDe(resposta)));
    } catch (erro) {
      if (minha === sequencia.current) setFalha(falhaDaConferencia(erro));
    }
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
    if (!conferida) return;
    const escolhidas = recuperaveisDe(conferida.analise).filter((codigo) =>
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
    if (conferida) void conferirDeNovo(conferida);
  }

  const alterado =
    mapeamento !== null &&
    (conferida === null || !mesmoMapeamento(mapeamento, conferida.mapeamento));
  const detectado =
    lido !== null &&
    conferida !== null &&
    mesmoMapeamento(conferida.mapeamento, lido.arquivo.mapeamentoDetectado);

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
                antes. A tela reconhece as colunas e compara com as vendas
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
              titulo="Os dados dos compradores não saem do seu computador"
            >
              <p>
                O arquivo é lido aqui, no navegador. Nome, e-mail e telefone são
                ignorados: para o sistema vão só o código, o status, a
                quantidade, o valor, o afiliado e a data de cada pedido.
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
              dicaEscolher={
                ocupado !== null
                  ? DICAS.escolherArquivoOcupado
                  : DICAS.escolherArquivo
              }
            />
            {ocupado === "lendo" && <Loading texto="Lendo o arquivo…" />}
            {ocupado === "conferindo" && (
              <Loading texto="Conferindo com as vendas do sistema…" />
            )}
            {lido?.codificacao === "windows-1252" && (
              <Aviso tom="info" anuncio="nenhum">
                <p>
                  O arquivo não estava em UTF-8 e foi lido como no Excel
                  (Windows-1252). Confira se os acentos aparecem certos nos
                  nomes das colunas.
                </p>
              </Aviso>
            )}
            {!conferida && avisoDaFalha}
          </div>
        </Card>

        {lido && mapeamento && (
          <Mapeamento
            colunas={lido.arquivo.colunas}
            mapeamento={mapeamento}
            detectado={detectado}
            alterado={alterado}
            ocupado={ocupado !== null}
            aoMudar={(campo, indice) =>
              setMapeamento((atual) =>
                atual ? { ...atual, [campo]: indice } : atual,
              )
            }
            aoConferir={() => void conferir(lido, mapeamento)}
            aoDesfazer={() =>
              setMapeamento(
                conferida?.mapeamento ?? lido.arquivo.mapeamentoDetectado,
              )
            }
          />
        )}
        {conferida && avisoDaFalha}

        {conferida && (
          <Resultado
            analise={conferida.analise}
            avisos={juntarAvisos(conferida.avisos, conferida.analise.avisos)}
            selecionados={selecionados}
            aoSelecionar={selecionar}
            aoRecuperar={abrirRecuperar}
            refTitulo={refTitulo}
            aviso={avisoDaRecuperacao}
          />
        )}

        <Historico versao={versaoHistorico} />
      </div>

      {aRecuperar && conferida && (
        <DialogoRecuperar
          corpo={conferida.corpo}
          pedidos={aRecuperar}
          aoFechar={() => setARecuperar(null)}
          aoGravar={aoGravar}
        />
      )}
    </>
  );
}
