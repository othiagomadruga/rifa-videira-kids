import { useEffect, useMemo, useRef, useState } from "react";
import {
  Aviso,
  Button,
  Card,
  ComDica,
  Input,
  Loading,
  Select,
  SeletorArquivo,
  Textarea,
} from "../../../components/ui";
import { mensagemDoErro } from "../../../lib/api";
import { carregarFusoDaCampanha } from "../conferencia-api";
import {
  CAMPOS_CSV,
  lancamentosDoCsv,
  type CampoCsv,
  type MapeamentoCsv,
} from "./csv";
import { cruzar } from "./cruzamento";
import { buscarPedidosDesde, type PedidosBuscados } from "./extrato-api";
import { juntarArquivos, type ParteLida } from "./juntar";
import {
  criarRelogio,
  filtrarPix,
  palavrasDoPix,
  primeiroInstante,
  PALAVRAS_PADRAO,
  type ContextoDeLeitura,
  type ExtratoLido,
  type FalhaDoExtrato,
} from "./lancamentos";
import {
  lerArquivoDoExtrato,
  lerExtrato,
  type EntradaDoExtrato,
  type LeituraDoExtrato,
} from "./leitura";
import { ArquivosLidos, type ResumoDoArquivo } from "./ArquivosLidos";
import { ResultadoDoExtrato } from "./ResultadoDoExtrato";
import {
  CAMPOS,
  COLUNAS_CSV,
  DICAS,
  FALHAS,
  JANELA_PADRAO_HORAS,
  JANELAS_HORAS,
  LER_TEXTO,
  PASSOS,
  PRIVACIDADE,
  TITULO,
  VARIOS_ARQUIVOS,
  plural,
  rotuloDaJanela,
} from "./textos";
import "./extrato.css";

const HORA_MS = 3_600_000;
/** A busca dos pedidos cobre a maior janela: trocar a janela na tela não busca de novo. */
const MAIOR_JANELA_MS = Math.max(...JANELAS_HORAS) * HORA_MS;

type Falha = { titulo: string; mensagem: string };

/** O agora da leitura (o ano que falta em "16/11"), lido só ao ler o extrato, nunca ao desenhar. */
const agora = () => Date.now();

/** O extrato lido nesta tela (só na memória): a leitura, o contexto e de onde veio. */
type Lido = {
  leitura: Extract<LeituraDoExtrato, { ok: true }>;
  contexto: ContextoDeLeitura;
  /** Cada extrato lido é uma versão: os pedidos buscados para uma versão antiga não servem. */
  versao: number;
};

type Busca =
  | { tipo: "carregando" }
  | { tipo: "ok"; buscados: PedidosBuscados }
  | { tipo: "erro"; erro: unknown };

// Seção "Extrato do banco (Pix manual)" da Conferência (RIFA-059, D26). Quem cuida do dinheiro escolhe o PDF (RIFA-068)
// ou o OFX baixado do banco (ou cola a tabela do extrato), a tela lê o extrato AQUI, busca a lista de pedidos da
// campanha ativa (só leitura) e mostra quais pedidos o extrato confirma e ainda precisam ser marcados como pagos na
// Rifei. Nada do extrato vai para o servidor, para o localStorage ou para o log; nada do sistema muda. Num pacote à
// parte (lazy); o leitor de PDF, noutro, baixado só quando a pessoa escolhe um PDF.
export function ExtratoDoBanco() {
  const [arquivos, setArquivos] = useState<File[]>([]);
  /** Com vários arquivos (RIFA-074): o resultado da leitura de cada um. */
  const [porArquivo, setPorArquivo] = useState<ResumoDoArquivo[] | null>(null);
  const [colado, setColado] = useState("");
  const [janelaHoras, setJanelaHoras] = useState<number>(JANELA_PADRAO_HORAS);
  const [palavras, setPalavras] = useState(PALAVRAS_PADRAO);
  const [lendo, setLendo] = useState(false);
  const [falha, setFalha] = useState<Falha | null>(null);
  const [lido, setLido] = useState<Lido | null>(null);
  const [mapeamento, setMapeamento] = useState<MapeamentoCsv | null>(null);
  const [busca, setBusca] = useState<Busca | null>(null);
  const [anuncio, setAnuncio] = useState("");
  const versao = useRef(0);
  /** O que a busca em andamento (ou a última) cobre. */
  const cobertura = useRef<{
    versao: number;
    desde: number;
    falhou: boolean;
  } | null>(null);
  const controle = useRef<AbortController | null>(null);
  const fuso = useRef<string | null | undefined>(undefined);
  const focarDepois = useRef<"resultado" | "falha" | null>(null);
  const refTitulo = useRef<HTMLSpanElement>(null);
  const refFalha = useRef<HTMLDivElement>(null);

  useEffect(() => () => controle.current?.abort(), []);

  useEffect(() => {
    const pedido = focarDepois.current;
    if (!pedido) return;
    if (pedido === "falha" && falha) refFalha.current?.focus();
    else if (pedido === "resultado" && busca?.tipo === "ok")
      refTitulo.current?.focus();
    else return;
    focarDepois.current = null;
  }, [falha, busca]);

  const relogio = useMemo(
    () => (lido ? criarRelogio(lido.contexto) : null),
    [lido],
  );
  /** O extrato com os lançamentos (no CSV, pelo mapeamento escolhido). */
  const extrato: ExtratoLido | FalhaDoExtrato | null = useMemo(() => {
    if (!lido) return null;
    if (lido.leitura.tipo === "lido") return lido.leitura.extrato;
    return mapeamento
      ? lancamentosDoCsv(lido.leitura.csv, mapeamento, lido.contexto)
      : null;
  }, [lido, mapeamento]);

  /** Busca os pedidos desde o primeiro crédito menos a maior janela (se a busca da versão já não cobre). */
  async function garantirPedidos(
    atual: Lido,
    comExtrato: ExtratoLido | FalhaDoExtrato | null,
  ) {
    if (!comExtrato?.ok) return;
    const primeiro = primeiroInstante(comExtrato, criarRelogio(atual.contexto));
    if (primeiro === null) {
      setBusca({ tipo: "ok", buscados: { pedidos: [], cortada: false } });
      return;
    }
    const desde = primeiro - MAIOR_JANELA_MS;
    const ja = cobertura.current;
    if (ja && ja.versao === atual.versao && ja.desde <= desde && !ja.falhou)
      return;
    // O foco vai ao resultado na primeira busca do extrato (e depois de "Tentar de novo", que some); a busca a mais de
    // uma troca de coluna do CSV deixa o foco na coluna.
    const levarOFoco = !ja || ja.versao !== atual.versao || ja.falhou;
    controle.current?.abort();
    const meu = new AbortController();
    controle.current = meu;
    cobertura.current = { versao: atual.versao, desde, falhou: false };
    setBusca({ tipo: "carregando" });
    try {
      const buscados = await buscarPedidosDesde(desde, { signal: meu.signal });
      if (meu.signal.aborted) return;
      if (levarOFoco) focarDepois.current = "resultado";
      setBusca({ tipo: "ok", buscados });
    } catch (erro) {
      if (meu.signal.aborted) return;
      cobertura.current = { versao: atual.versao, desde, falhou: true };
      setBusca({ tipo: "erro", erro });
    }
  }

  /** Começa uma leitura nova: esquece a anterior (a busca, o resultado, a falha). Devolve a versão dela. */
  function comecar(): number {
    const minha = ++versao.current;
    controle.current?.abort();
    cobertura.current = null;
    setLendo(true);
    setFalha(null);
    setLido(null);
    setMapeamento(null);
    setBusca(null);
    setAnuncio("");
    return minha;
  }

  function falharNa(minha: number, motivo: Falha) {
    if (minha !== versao.current) return;
    focarDepois.current = "falha";
    setFalha(motivo);
    setLendo(false);
  }

  /** O fuso da campanha (buscado uma vez) e o agora; null se falhou (a falha já está na tela) ou ficou velha. */
  async function contextoDaLeitura(
    minha: number,
  ): Promise<ContextoDeLeitura | null> {
    try {
      if (fuso.current === undefined)
        fuso.current = await carregarFusoDaCampanha();
    } catch (erro) {
      falharNa(minha, {
        titulo: FALHAS.campanha,
        mensagem: mensagemDoErro(erro),
      });
      return null;
    }
    if (minha !== versao.current) return null;
    if (fuso.current === null) {
      falharNa(minha, FALHAS.semCampanha);
      return null;
    }
    return { fuso: fuso.current, agora: agora() };
  }

  async function ler(entrada: EntradaDoExtrato, minha = comecar()) {
    const falhar = (motivo: Falha) => falharNa(minha, motivo);
    const contexto = await contextoDaLeitura(minha);
    if (contexto === null) return;
    const leitura = lerExtrato(entrada, contexto);
    if (!leitura.ok) {
      falhar(leitura);
      return;
    }
    const atual: Lido = { leitura, contexto, versao: minha };
    const detectado =
      leitura.tipo === "csv" ? leitura.csv.mapeamentoDetectado : null;
    setLido(atual);
    setMapeamento(detectado);
    setLendo(false);
    const comExtrato =
      leitura.tipo === "lido"
        ? leitura.extrato
        : detectado && lancamentosDoCsv(leitura.csv, detectado, contexto);
    await garantirPedidos(atual, comExtrato);
  }

  async function escolher(novos: File[]) {
    setArquivos(novos);
    setPorArquivo(null);
    if (novos.length > 1) {
      await escolherVarios(novos);
      return;
    }
    // O PDF leva um instante (o leitor é baixado na primeira vez): a tela já mostra "Lendo o extrato…".
    const minha = comecar();
    const lidoDoArquivo = await lerArquivoDoExtrato(novos[0]);
    if (minha !== versao.current) return;
    if (!lidoDoArquivo.ok) {
      falharNa(minha, lidoDoArquivo);
      return;
    }
    await ler(lidoDoArquivo.entrada);
  }

  /**
   * Vários arquivos de uma vez (RIFA-074, D34): extratos e comprovantes de Pix misturados. Cada um é lido e tem o
   * seu resultado na tela; os que deram certo viram um extrato só (o mesmo Pix em dois arquivos conta uma vez) e vão
   * para o mesmo cruzamento. O CSV sem as colunas reconhecidas precisa ser escolhido sozinho (para indicar as colunas).
   */
  async function escolherVarios(novos: File[]) {
    const minha = comecar();
    const lidosDosArquivos: Awaited<ReturnType<typeof lerArquivoDoExtrato>>[] =
      [];
    for (const novo of novos)
      lidosDosArquivos.push(await lerArquivoDoExtrato(novo));
    if (minha !== versao.current) return;
    const contexto = await contextoDaLeitura(minha);
    if (contexto === null) return;
    const partes: ParteLida[] = [];
    const resumos: ResumoDoArquivo[] = [];
    novos.forEach((novo, indice) => {
      const lidoDoArquivo = lidosDosArquivos[indice];
      const leitura = lidoDoArquivo.ok
        ? lerExtrato(lidoDoArquivo.entrada, contexto)
        : lidoDoArquivo;
      let extrato: ExtratoLido | FalhaDoExtrato;
      if (!leitura.ok) extrato = leitura;
      else if (leitura.tipo === "lido") extrato = leitura.extrato;
      else
        extrato = leitura.csv.mapeamentoDetectado
          ? lancamentosDoCsv(
              leitura.csv,
              leitura.csv.mapeamentoDetectado,
              contexto,
            )
          : VARIOS_ARQUIVOS.csvSozinho;
      if (!extrato.ok) {
        resumos.push({ nome: novo.name, tipo: "falha", falha: extrato });
        return;
      }
      partes.push({ extrato });
      resumos.push({
        nome: novo.name,
        tipo: "lido",
        extrato,
        repetidos: 0,
      });
    });
    const juntado = juntarArquivos(partes);
    let parte = 0;
    for (const resumo of resumos)
      if (resumo.tipo === "lido") resumo.repetidos = juntado.repetidos[parte++];
    setPorArquivo(resumos);
    if (partes.length === 0) {
      falharNa(minha, VARIOS_ARQUIVOS.nenhum);
      return;
    }
    const atual: Lido = {
      leitura: { ok: true, tipo: "lido", extrato: juntado.extrato },
      contexto,
      versao: minha,
    };
    setLido(atual);
    setLendo(false);
    await garantirPedidos(atual, juntado.extrato);
  }

  function mudarColuna(campo: CampoCsv, valor: string) {
    if (!lido || lido.leitura.tipo !== "csv" || !mapeamento) return;
    const novo: MapeamentoCsv = {
      ...mapeamento,
      [campo]: valor === "" ? null : Number(valor),
    };
    setMapeamento(novo);
    void garantirPedidos(
      lido,
      lancamentosDoCsv(lido.leitura.csv, novo, lido.contexto),
    );
  }

  const listaDePalavras = useMemo(() => palavrasDoPix(palavras), [palavras]);
  const filtrado = useMemo(
    () =>
      extrato?.ok && relogio
        ? filtrarPix(extrato, listaDePalavras, relogio)
        : null,
    [extrato, relogio, listaDePalavras],
  );
  const resultado = useMemo(
    () =>
      filtrado && busca?.tipo === "ok"
        ? cruzar(filtrado.pix, busca.buscados.pedidos, {
            janelaMs: janelaHoras * HORA_MS,
          })
        : null,
    [filtrado, busca, janelaHoras],
  );

  // O resultado de cada leitura é anunciado uma vez (trocar a janela ou as palavras muda os números na tela).
  const anunciado = useRef<number | null>(null);
  useEffect(() => {
    if (!resultado || !lido || anunciado.current === lido.versao) return;
    anunciado.current = lido.versao;
    setAnuncio(
      `Extrato comparado: ${plural(resultado.paraMarcar.length, "pedido para marcar", "pedidos para marcar")} na Rifei, ${plural(resultado.ambiguos.length, "ambíguo", "ambíguos")}.`,
    );
  }, [resultado, lido]);

  const vazio = colado.trim() === "";
  const dicaLerTexto = lendo
    ? DICAS.lerTextoOcupado
    : vazio
      ? DICAS.lerTextoVazio
      : DICAS.lerTexto;
  const csv = lido?.leitura.tipo === "csv" ? lido.leitura.csv : null;

  return (
    <div className="pilha extrato">
      <p className="visualmente-oculto" role="status">
        {anuncio}
      </p>
      <Card titulo={TITULO}>
        <div className="extrato-bloco">
          <ol className="extrato-passos">
            {PASSOS.map((passo) => (
              <li key={passo}>{passo}</li>
            ))}
          </ol>
          <Aviso tom="info" anuncio="nenhum" titulo={PRIVACIDADE.titulo}>
            <p>{PRIVACIDADE.texto}</p>
          </Aviso>
          <SeletorArquivo
            rotulo={CAMPOS.arquivo.rotulo}
            dica={CAMPOS.arquivo.dica}
            aceitar=".pdf,.ofx,.qfx,.csv,.txt,application/pdf,application/x-ofx,text/csv,text/plain,image/*"
            arquivo={arquivos[0] ?? null}
            aoEscolher={(novo) => void escolher([novo])}
            aoEscolherVarios={(novos) => void escolher(novos)}
            textoArquivo={
              arquivos.length > 1
                ? VARIOS_ARQUIVOS.escolhidos(arquivos.length)
                : undefined
            }
            desabilitado={lendo}
            dicaEscolher={
              lendo ? DICAS.escolherArquivoOcupado : DICAS.escolherArquivo
            }
          />
          <div className="extrato-colar">
            <ComDica texto={DICAS.texto}>
              <Textarea
                rotulo={CAMPOS.texto.rotulo}
                dica={CAMPOS.texto.dica}
                rows={5}
                value={colado}
                onChange={(evento) => setColado(evento.target.value)}
                autoComplete="off"
                spellCheck={false}
                translate="no"
              />
            </ComDica>
            <div className="extrato-acoes">
              <ComDica texto={dicaLerTexto}>
                <Button
                  variante="secundario"
                  aria-disabled={lendo || vazio || undefined}
                  onClick={() => {
                    if (!lendo && !vazio) {
                      setPorArquivo(null);
                      void ler({ tipo: "texto", texto: colado });
                    }
                  }}
                >
                  {LER_TEXTO}
                </Button>
              </ComDica>
            </div>
          </div>
          <div className="extrato-opcoes">
            <ComDica texto={DICAS.janela}>
              <Select
                rotulo={CAMPOS.janela.rotulo}
                dica={CAMPOS.janela.dica}
                value={String(janelaHoras)}
                onChange={(evento) =>
                  setJanelaHoras(Number(evento.target.value))
                }
              >
                {JANELAS_HORAS.map((horas) => (
                  <option key={horas} value={horas}>
                    {rotuloDaJanela(horas)}
                  </option>
                ))}
              </Select>
            </ComDica>
            <ComDica texto={DICAS.palavras}>
              <Input
                rotulo={CAMPOS.palavras.rotulo}
                dica={CAMPOS.palavras.dica}
                value={palavras}
                maxLength={200}
                onChange={(evento) => setPalavras(evento.target.value)}
                autoComplete="off"
                spellCheck={false}
              />
            </ComDica>
          </div>
          {porArquivo && <ArquivosLidos arquivos={porArquivo} />}
          {lendo && <Loading texto="Lendo o extrato…" />}
          {falha && (
            <div ref={refFalha} tabIndex={-1} className="extrato-foco">
              <Aviso tom="perigo" titulo={falha.titulo}>
                <p>{falha.mensagem}</p>
              </Aviso>
            </div>
          )}
        </div>
      </Card>

      {csv && mapeamento && (
        <Card titulo={COLUNAS_CSV.titulo}>
          <div className="extrato-bloco">
            <p className="extrato-suave">{COLUNAS_CSV.explicacao}</p>
            <div className="extrato-campos">
              {CAMPOS_CSV.map((campo) => (
                <ComDica key={campo} texto={DICAS.coluna}>
                  <Select
                    rotulo={COLUNAS_CSV.campos[campo]}
                    value={
                      mapeamento[campo] === null
                        ? ""
                        : String(mapeamento[campo])
                    }
                    onChange={(evento) =>
                      mudarColuna(campo, evento.target.value)
                    }
                  >
                    <option value="">{COLUNAS_CSV.semColuna}</option>
                    {csv.colunas.map((nome, indice) => (
                      <option key={`${indice}-${nome}`} value={indice}>
                        {nome}
                      </option>
                    ))}
                  </Select>
                </ComDica>
              ))}
            </div>
            {extrato && !extrato.ok && (
              <Aviso tom="alerta" anuncio="nenhum" titulo={extrato.titulo}>
                <p>{extrato.mensagem}</p>
              </Aviso>
            )}
          </div>
        </Card>
      )}

      {lido && extrato?.ok && filtrado && (
        <ResultadoDoExtrato
          origem={
            lido.leitura.tipo === "csv" ? "csv" : lido.leitura.extrato.formato
          }
          extrato={extrato}
          ignorados={filtrado.ignorados}
          totalDePix={filtrado.pix.length}
          busca={busca}
          resultado={resultado}
          refTitulo={refTitulo}
          aoTentarDeNovo={() => void garantirPedidos(lido, extrato)}
          aoAnunciar={setAnuncio}
        />
      )}
    </div>
  );
}
