import {
  useEffect,
  useId,
  useRef,
  useState,
  type ReactNode,
  type RefObject,
} from "react";
import type { RespostaImportarHierarquia } from "../../../shared/contracts";
import {
  Aviso,
  Button,
  Card,
  ComAjuda,
  ComDica,
  DataTable,
  SeletorArquivo,
  classesBotao,
  type ColunaTabela,
  type TextoDeAjuda,
} from "../../components/ui";
import { formatarNumero } from "../../lib/formatadores";
import { ajuda } from "../ajuda-sob-demanda";
import { CAMINHO_MODELO_CSV, importarPlanilha } from "./hierarquia-api";
import {
  COLUNAS_DA_PLANILHA,
  lerPlanilha,
  mensagemDaImportacao,
  type LeituraPlanilha,
} from "./planilha";
import { DICAS, plural } from "./textos";

/** Quantos erros a tabela mostra (o resto é contado num aviso). */
export const LIMITE_ERROS_NA_TELA = 200;

type Props = {
  /**
   * Uma rede só (RIFA-065, D30): os textos falam dos discipuladores e das células, e o relatório não tem a linha das
   * redes quando nada muda nelas. A planilha continua com a coluna `rede` (o mesmo nome em todas as linhas).
   */
  redeUnica?: boolean;
  /** A importação gravou (aplicado): recarregue as tabelas. */
  aoImportar: (resultado: RespostaImportarHierarquia) => void;
  /** Botão "Ver células" do resultado. */
  aoVerCelulas: () => void;
};

type Etapa = "conferir" | "importar";

// Importação em dois passos: "Conferir" chama a API com simular=true e mostra o relatório (contagens e
// erros por linha, sem gravar nada); "Importar" (simular=false) só fica disponível depois de uma
// conferência sem erros do mesmo arquivo. Escolher outro arquivo recomeça.
export function ImportarPlanilha({
  redeUnica = false,
  aoImportar,
  aoVerCelulas,
}: Props) {
  const [arquivo, setArquivo] = useState<File | null>(null);
  const [leitura, setLeitura] = useState<LeituraPlanilha | null>(null);
  const [conferencia, setConferencia] =
    useState<RespostaImportarHierarquia | null>(null);
  const [importacao, setImportacao] =
    useState<RespostaImportarHierarquia | null>(null);
  const [ocupado, setOcupado] = useState<
    "lendo" | "conferindo" | "importando" | null
  >(null);
  const [falha, setFalha] = useState<{
    etapa: Etapa;
    mensagem: string;
  } | null>(null);
  // Cada arquivo escolhido é uma tentativa: respostas de uma tentativa antiga são ignoradas.
  const tentativa = useRef(0);
  const controle = useRef<AbortController | null>(null);
  // O resultado que acabou de chegar recebe o foco (o botão que o pediu fica indisponível).
  const focarDepois = useRef<"conferencia" | "importacao" | "falha" | null>(
    null,
  );
  const refConferencia = useRef<HTMLElement>(null);
  const refImportacao = useRef<HTMLElement>(null);
  const refFalha = useRef<HTMLDivElement>(null);
  const idDicaImportar = useId();

  useEffect(() => () => controle.current?.abort(), []);

  useEffect(() => {
    const alvos = {
      conferencia: refConferencia,
      importacao: refImportacao,
      falha: refFalha,
    };
    const pedido = focarDepois.current;
    if (!pedido) return;
    focarDepois.current = null;
    alvos[pedido].current?.focus();
  }, [conferencia, importacao, falha]);

  async function escolher(novo: File) {
    const minha = ++tentativa.current;
    controle.current?.abort();
    setArquivo(novo);
    setLeitura(null);
    setConferencia(null);
    setImportacao(null);
    setFalha(null);
    setOcupado("lendo");
    const lida = await lerPlanilha(novo);
    if (minha !== tentativa.current) return;
    setLeitura(lida);
    setOcupado(null);
  }

  async function enviar(etapa: Etapa) {
    if (leitura?.tipo !== "ok" || ocupado) return;
    const simular = etapa === "conferir";
    const minha = tentativa.current;
    const meuControle = new AbortController();
    controle.current = meuControle;
    setOcupado(simular ? "conferindo" : "importando");
    setFalha(null);
    try {
      const resposta = await importarPlanilha(leitura.csv, simular, {
        signal: meuControle.signal,
      });
      if (minha !== tentativa.current) return;
      if (simular) {
        focarDepois.current = "conferencia";
        setConferencia(resposta);
        setImportacao(null);
      } else {
        focarDepois.current = "importacao";
        setImportacao(resposta);
        setConferencia(null);
        if (resposta.aplicado) aoImportar(resposta);
      }
    } catch (erro) {
      if (meuControle.signal.aborted || minha !== tentativa.current) return;
      focarDepois.current = "falha";
      setFalha({ etapa, mensagem: mensagemDaImportacao(erro) });
    } finally {
      if (minha === tentativa.current) setOcupado(null);
    }
  }

  const podeConferir = leitura?.tipo === "ok" && ocupado === null;
  const seletorOcupado = ocupado === "conferindo" || ocupado === "importando";
  const conferidaSemErros =
    conferencia !== null &&
    conferencia.erros.length === 0 &&
    conferencia.total_linhas > 0;
  const podeImportar = conferidaSemErros && ocupado === null;
  // Conferir e Importar indisponíveis ficam com aria-disabled (RIFA-045): continuam no Tab e a dica diz por quê; o
  // clique (e o Enter e o espaço) é barrado aqui. O seletor de arquivo pode ficar disabled: o motivo está à vista.

  let dicaImportar: string;
  if (ocupado === "importando") dicaImportar = "Importando a planilha…";
  else if (importacao?.aplicado)
    dicaImportar =
      "Planilha importada. Para importar outra, escolha o arquivo de novo.";
  else if (!conferencia) dicaImportar = "Primeiro confira a planilha.";
  else if (conferencia.erros.length > 0)
    dicaImportar = "Corrija os erros da planilha e confira de novo.";
  else if (conferencia.total_linhas === 0)
    dicaImportar = "A planilha não tem linhas de dados.";
  else
    dicaImportar =
      "Grava o que a conferência mostrou: cria o que é novo e atualiza o que mudou. Nada é apagado.";

  return (
    <Card titulo="Importar a planilha das células" ajuda={ajuda("importar")}>
      <div className="hierarquia-importar">
        <p>
          {redeUnica
            ? "Cadastra de uma vez os discipuladores e as células."
            : "Cadastra de uma vez as redes, os discipuladores e as células."}{" "}
          Primeiro o sistema confere a planilha e mostra o que vai mudar; só
          depois você importa.
        </p>
        <ol className="hierarquia-passos">
          <li className="hierarquia-passo">
            <TituloDoPasso numero={1} ajuda={ajuda("passoModelo")}>
              Baixe o modelo
            </TituloDoPasso>
            <p>
              Preencha uma linha por célula. A linha 1 é o cabeçalho: não mude
              os nomes das colunas.
            </p>
            <div>
              <ComDica texto={DICAS.baixarModelo}>
                <a
                  className={classesBotao({ variante: "secundario" })}
                  href={CAMINHO_MODELO_CSV}
                  download="hierarquia-modelo.csv"
                >
                  Baixar modelo
                </a>
              </ComDica>
            </div>
            <details className="hierarquia-detalhes">
              <ComDica texto={DICAS.colunasDaPlanilha}>
                <summary>O que vai em cada coluna</summary>
              </ComDica>
              <dl className="hierarquia-colunas">
                {Object.entries(COLUNAS_DA_PLANILHA).map(([coluna, info]) => (
                  <div key={coluna} className="hierarquia-colunas__item">
                    <dt>
                      <code>{coluna}</code>
                      {info.obrigatoria ? " (obrigatória)" : " (opcional)"}
                    </dt>
                    <dd>{info.conteudo}</dd>
                  </div>
                ))}
              </dl>
              <p>
                A importação nunca apaga: o que não está no arquivo continua
                como está. Uma coluna opcional deixada em branco apaga o valor
                já cadastrado.
              </p>
            </details>
          </li>

          <li className="hierarquia-passo">
            <TituloDoPasso numero={2} ajuda={ajuda("passoArquivo")}>
              Escolha o arquivo
            </TituloDoPasso>
            <SeletorArquivo
              rotulo="Planilha em CSV"
              ajuda={ajuda("planilha")}
              dica="No Excel, salve em Arquivo > Salvar como > “CSV UTF-8 (delimitado por vírgulas)”."
              aceitar=".csv,text/csv"
              arquivo={arquivo}
              aoEscolher={(novo) => void escolher(novo)}
              desabilitado={seletorOcupado}
              dicaEscolher={
                seletorOcupado
                  ? DICAS.escolherPlanilhaOcupado
                  : DICAS.escolherPlanilha
              }
            />
            {ocupado === "lendo" && (
              <p className="hierarquia-suave">Lendo o arquivo…</p>
            )}
            {leitura?.tipo === "problema" && (
              <Aviso tom="alerta" titulo={leitura.titulo}>
                <p>{leitura.mensagem}</p>
              </Aviso>
            )}
          </li>

          <li className="hierarquia-passo">
            <TituloDoPasso numero={3} ajuda={ajuda("passoConferir")}>
              Confira
            </TituloDoPasso>
            <p>
              O sistema lê a planilha e mostra quantos{" "}
              {redeUnica
                ? "discipuladores e células"
                : "redes, discipuladores e células"}{" "}
              serão criados ou atualizados, e os erros de cada linha. Nada é
              gravado.
            </p>
            <div>
              <ComDica
                texto={
                  podeConferir ? DICAS.conferir : DICAS.conferirIndisponivel
                }
              >
                <Button
                  variante="secundario"
                  aria-disabled={!podeConferir || undefined}
                  onClick={() => {
                    if (podeConferir) void enviar("conferir");
                  }}
                >
                  {ocupado === "conferindo" ? "Conferindo…" : "Conferir"}
                </Button>
              </ComDica>
            </div>
            {falha?.etapa === "conferir" && (
              <FalhaDaImportacao
                refAviso={refFalha}
                titulo="Não foi possível conferir a planilha"
                mensagem={falha.mensagem}
              />
            )}
            {conferencia && (
              <Relatorio
                resposta={conferencia}
                redeUnica={redeUnica}
                refSecao={refConferencia}
                titulo="Resultado da conferência"
              />
            )}
          </li>

          <li className="hierarquia-passo">
            <TituloDoPasso numero={4} ajuda={ajuda("passoImportar")}>
              Importe
            </TituloDoPasso>
            <p id={idDicaImportar}>{dicaImportar}</p>
            <div>
              <ComDica texto={DICAS.importar}>
                <Button
                  aria-disabled={!podeImportar || undefined}
                  aria-describedby={idDicaImportar}
                  onClick={() => {
                    if (podeImportar) void enviar("importar");
                  }}
                >
                  {ocupado === "importando" ? "Importando…" : "Importar"}
                </Button>
              </ComDica>
            </div>
            {falha?.etapa === "importar" && (
              <FalhaDaImportacao
                refAviso={refFalha}
                titulo="Não foi possível importar a planilha"
                mensagem={falha.mensagem}
              />
            )}
            {importacao && (
              <Relatorio
                resposta={importacao}
                redeUnica={redeUnica}
                refSecao={refImportacao}
                titulo="Resultado da importação"
                aoVerCelulas={aoVerCelulas}
              />
            )}
          </li>
        </ol>
      </div>
    </Card>
  );
}

/** "1 Baixe o modelo": o número fica no título (os itens da lista são grade, sem marcador). */
function TituloDoPasso({
  numero,
  ajuda: texto,
  children,
}: {
  numero: number;
  ajuda: TextoDeAjuda;
  children: ReactNode;
}) {
  const id = useId();
  return (
    <ComAjuda texto={texto} idDoTitulo={id}>
      <h3 id={id} className="hierarquia-passo__titulo">
        <span className="hierarquia-passo__numero">{numero}</span> {children}
      </h3>
    </ComAjuda>
  );
}

function FalhaDaImportacao({
  refAviso,
  titulo,
  mensagem,
}: {
  refAviso: RefObject<HTMLDivElement | null>;
  titulo: string;
  mensagem: string;
}) {
  return (
    <div ref={refAviso} tabIndex={-1}>
      <Aviso tom="perigo" titulo={titulo}>
        <p>{mensagem}</p>
      </Aviso>
    </div>
  );
}

type LinhaContagem = {
  tipo: string;
  criados: number;
  atualizados: number;
  inalterados: number;
};

type ErroLinha = RespostaImportarHierarquia["erros"][number];

const COLUNAS_CONTAGEM: ColunaTabela<LinhaContagem>[] = [
  { chave: "tipo", titulo: "Tipo", principal: true, celula: (l) => l.tipo },
  {
    chave: "criados",
    titulo: "Criados",
    alinhamento: "fim",
    celula: (l) => formatarNumero(l.criados),
  },
  {
    chave: "atualizados",
    titulo: "Atualizados",
    alinhamento: "fim",
    celula: (l) => formatarNumero(l.atualizados),
  },
  {
    chave: "inalterados",
    titulo: "Inalterados",
    alinhamento: "fim",
    celula: (l) => formatarNumero(l.inalterados),
  },
];

const COLUNAS_ERROS: ColunaTabela<ErroLinha>[] = [
  {
    chave: "linha",
    titulo: "Linha",
    principal: true,
    celula: (erro) => (
      <span className="hierarquia-sem-quebra">
        Linha {erro.linha.toLocaleString("pt-BR")}
      </span>
    ),
  },
  {
    chave: "coluna",
    titulo: "Coluna",
    celula: (erro) => (
      <span className="hierarquia-sem-quebra">
        {erro.coluna ? <code>{erro.coluna}</code> : "Linha inteira"}
      </span>
    ),
  },
  { chave: "mensagem", titulo: "Mensagem", celula: (erro) => erro.mensagem },
];

function Relatorio({
  resposta,
  redeUnica,
  refSecao,
  titulo,
  aoVerCelulas,
}: {
  resposta: RespostaImportarHierarquia;
  /** Uma rede só (D30): a linha das redes só aparece se a planilha cria ou muda uma rede. */
  redeUnica: boolean;
  refSecao: RefObject<HTMLElement | null>;
  titulo: string;
  aoVerCelulas?: () => void;
}) {
  const idTitulo = useId();
  const idResumo = useId();
  const { erros } = resposta;
  const mudaRede = resposta.criados.redes > 0 || resposta.atualizados.redes > 0;
  const contagens: LinhaContagem[] = (
    [
      ...(redeUnica && !mudaRede ? [] : [["Redes", "redes"] as const]),
      ["Discipuladores", "discipuladores"],
      ["Células", "celulas"],
    ] as const
  ).map(([tipo, chave]) => ({
    tipo,
    criados: resposta.criados[chave],
    atualizados: resposta.atualizados[chave],
    inalterados: resposta.inalterados[chave],
  }));

  // O título visível fica fora da tabela (a legenda da tabela é só para o leitor de tela).
  const legendaContagem = resposta.aplicado
    ? "O que foi gravado"
    : "O que a importação vai fazer";

  let resumo: ReactNode;
  if (erros.length > 0) {
    resumo = (
      <Aviso
        tom="perigo"
        anuncio="nenhum"
        titulo={`A planilha tem ${plural(erros.length, "erro", "erros")}`}
      >
        <p>
          Nada foi gravado. Corrija as linhas abaixo na planilha, salve como CSV
          UTF-8 e escolha o arquivo de novo.
        </p>
      </Aviso>
    );
  } else if (resposta.aplicado) {
    resumo = (
      <Aviso
        tom="sucesso"
        anuncio="nenhum"
        titulo="Planilha importada"
        acao={
          aoVerCelulas && (
            <ComDica texto={DICAS.verCelulas}>
              <Button variante="secundario" onClick={aoVerCelulas}>
                Ver células
              </Button>
            </ComDica>
          )
        }
      >
        <p>As tabelas da hierarquia já mostram os dados novos.</p>
      </Aviso>
    );
  } else if (resposta.total_linhas === 0) {
    resumo = (
      <Aviso tom="alerta" anuncio="nenhum" titulo="Nenhuma linha de dados">
        <p>A planilha só tem o cabeçalho. Preencha uma linha por célula.</p>
      </Aviso>
    );
  } else {
    resumo = (
      <Aviso tom="sucesso" anuncio="nenhum" titulo="Nenhum erro encontrado">
        <p>Confira os números abaixo e use o botão Importar para gravar.</p>
      </Aviso>
    );
  }

  return (
    <section
      ref={refSecao}
      tabIndex={-1}
      className="hierarquia-relatorio"
      aria-labelledby={idTitulo}
      aria-describedby={idResumo}
    >
      <h4 id={idTitulo} className="hierarquia-relatorio__titulo">
        {titulo}
      </h4>
      <div id={idResumo}>{resumo}</div>
      <p className="hierarquia-suave">
        {plural(resposta.total_linhas, "linha lida", "linhas lidas")}
        {erros.length > 0 && ". As contagens consideram só as linhas sem erro"}.
      </p>
      <div className="hierarquia-bloco">
        <h5 className="hierarquia-bloco__titulo">{legendaContagem}</h5>
        <DataTable
          colunas={COLUNAS_CONTAGEM}
          linhas={contagens}
          chaveDaLinha={(linha) => linha.tipo}
          legenda={legendaContagem}
        />
      </div>
      {erros.length > 0 && (
        <>
          <div className="hierarquia-bloco">
            <h5 className="hierarquia-bloco__titulo">Erros por linha</h5>
            <p className="hierarquia-suave">
              A linha 1 é o cabeçalho: os números são os mesmos da planilha.
            </p>
            <DataTable
              colunas={COLUNAS_ERROS}
              linhas={erros.slice(0, LIMITE_ERROS_NA_TELA)}
              chaveDaLinha={(erro, indice) =>
                `${erro.linha}-${erro.coluna ?? ""}-${indice}`
              }
              legenda="Erros por linha"
            />
          </div>
          {erros.length > LIMITE_ERROS_NA_TELA && (
            <p className="hierarquia-suave">
              Mostrando os primeiros{" "}
              {LIMITE_ERROS_NA_TELA.toLocaleString("pt-BR")} de{" "}
              {plural(erros.length, "erro", "erros")}.
            </p>
          )}
        </>
      )}
    </section>
  );
}
