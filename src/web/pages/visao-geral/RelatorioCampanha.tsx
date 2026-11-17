import { useEffect, useId, useRef, useState } from "react";
import { Link } from "react-router";
import {
  TIPOS_RELATORIO,
  type TipoRelatorio,
} from "../../../shared/contracts/relatorio";
import {
  Aviso,
  Button,
  Card,
  ComAjuda,
  ComDica,
  Icone,
} from "../../components/ui";
import { ErroApi, mensagemDoErro } from "../../lib/api";
import { ajuda } from "../ajuda-sob-demanda";
import { DICAS, TEXTOS_TIPO_RELATORIO } from "./textos";
import { baixarRelatorio } from "./visao-geral-api";

type Resultado =
  | { tipo: "nada" }
  | { tipo: "baixado"; nome: string }
  | { tipo: "erro"; erro: unknown };

const NADA: Resultado = { tipo: "nada" };

const TITULO_SEM_CAMPANHA = "A campanha ainda não foi configurada";
const TITULO_FALHA = "Não foi possível baixar o relatório";

const ehSemCampanha = (erro: unknown) =>
  erro instanceof ErroApi &&
  erro.status === 404 &&
  erro.codigo === "nao_encontrado";

/** Vale tentar de novo: sem resposta (conexão, tempo esgotado) ou falha do servidor (5xx). */
const podeTentarDeNovo = (erro: unknown) =>
  !(erro instanceof ErroApi) || erro.status === null || erro.status >= 500;

/** O que a região viva diz de uma falha (o mesmo texto do aviso na tela). */
function anuncioDaFalha(erro: unknown): string {
  return ehSemCampanha(erro)
    ? `${TITULO_SEM_CAMPANHA}. Cadastre a campanha em Campanha para baixar o relatório.`
    : `${TITULO_FALHA}. ${mensagemDoErro(erro)}`;
}

// Relatório da campanha (RIFA-038, D23), no fim da Visão geral: a coordenação escolhe o tipo e baixa a planilha
// (CSV para o Excel em português) com os números de agora; depois do fim, o resultado final. Um download por vez
// (trava síncrona e o botão com aria-disabled, que continua focável e não perde o foco); o resultado e as falhas
// vão numa região viva fixa. O 401 fica com a sessão, que leva para /entrar.
export function RelatorioCampanha() {
  const id = useId();
  const [tipo, setTipo] = useState<TipoRelatorio>(TIPOS_RELATORIO[0]);
  const [baixando, setBaixando] = useState(false);
  const [resultado, setResultado] = useState<Resultado>(NADA);
  const [anuncio, setAnuncio] = useState("");
  // Trava síncrona: um download por vez, mesmo com clique duplo (o estado só muda no próximo render).
  const emAndamento = useRef(false);
  // Cancela o download em andamento quando a tela sai (nada baixa nem muda depois).
  const saida = useRef<AbortController | null>(null);
  const refBotao = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    const controle = new AbortController();
    saida.current = controle;
    return () => controle.abort();
  }, []);

  function escolher(novo: TipoRelatorio) {
    setTipo(novo);
    if (!emAndamento.current) setResultado(NADA);
  }

  async function baixar() {
    if (emAndamento.current) return;
    emAndamento.current = true;
    const sinal = saida.current?.signal;
    const escolhido = tipo;
    setBaixando(true);
    setResultado(NADA);
    setAnuncio(
      `Baixando o relatório: ${TEXTOS_TIPO_RELATORIO[escolhido].rotulo}…`,
    );
    try {
      const nome = await baixarRelatorio(escolhido, { signal: sinal });
      if (sinal?.aborted) return;
      setResultado({ tipo: "baixado", nome });
      setAnuncio(`Relatório baixado: ${nome}.`);
    } catch (erro) {
      if (sinal?.aborted) return;
      if (erro instanceof ErroApi && erro.status === 401) {
        // A sessão terminou: a guarda leva para /entrar (gancho de 401 do lib/api.ts).
        setAnuncio("");
        return;
      }
      setResultado({ tipo: "erro", erro });
      setAnuncio(anuncioDaFalha(erro));
    } finally {
      emAndamento.current = false;
      if (!sinal?.aborted) setBaixando(false);
    }
  }

  /** "Tentar de novo" sai da tela ao recomeçar: o foco vai antes para "Baixar relatório", que fica. */
  function tentarDeNovo() {
    refBotao.current?.focus();
    void baixar();
  }

  return (
    <Card
      titulo="Relatório da campanha"
      icone="documento"
      ajuda={ajuda("relatorio")}
      className="visao-relatorio"
    >
      <div className="visao-relatorio__corpo">
        <p className="visao-relatorio__intro">
          Baixe uma planilha com os números de agora para guardar, prestar
          contas ou mostrar o resultado. Depois do fim da campanha, é o
          resultado final.
        </p>
        {/* O "?" da ajuda fica dentro da legenda (a primeira filha do fieldset): o nome do grupo vem só do texto. */}
        <fieldset
          className="visao-relatorio__tipos"
          aria-labelledby={`${id}-legenda`}
        >
          <legend className="visao-relatorio__legenda">
            <ComAjuda texto={ajuda("oQueBaixar")} idDoTitulo={`${id}-legenda`}>
              <span id={`${id}-legenda`}>O que baixar</span>
            </ComAjuda>
          </legend>
          <div className="visao-relatorio__opcoes">
            {TIPOS_RELATORIO.map((opcao) => {
              const { rotulo, descricao } = TEXTOS_TIPO_RELATORIO[opcao];
              const idRotulo = `${id}-${opcao}`;
              const idDescricao = `${id}-${opcao}-descricao`;
              const idDica = `${id}-${opcao}-dica`;
              // A dica fica no cartão todo (rádio e textos); o rádio a tem no fim da descrição (`id` da dica).
              return (
                <ComDica
                  key={opcao}
                  id={idDica}
                  texto={DICAS.tipoRelatorio[opcao]}
                >
                  <label className="visao-relatorio__opcao">
                    <input
                      type="radio"
                      name={`${id}-tipo`}
                      value={opcao}
                      checked={tipo === opcao}
                      onChange={() => escolher(opcao)}
                      aria-labelledby={idRotulo}
                      aria-describedby={`${idDescricao} ${idDica}`}
                    />
                    <span className="visao-relatorio__opcao-textos">
                      <span
                        id={idRotulo}
                        className="visao-relatorio__opcao-nome"
                      >
                        {rotulo}
                      </span>
                      <span
                        id={idDescricao}
                        className="visao-relatorio__opcao-descricao"
                      >
                        {descricao}
                      </span>
                    </span>
                  </label>
                </ComDica>
              );
            })}
          </div>
        </fieldset>
        <div className="visao-relatorio__acoes">
          <ComDica texto={baixando ? DICAS.baixando : DICAS.baixarRelatorio}>
            <Button
              ref={refBotao}
              onClick={() => void baixar()}
              aria-disabled={baixando || undefined}
            >
              <Icone nome="baixar" />
              {baixando ? "Baixando…" : "Baixar relatório"}
            </Button>
          </ComDica>
          {resultado.tipo === "baixado" && (
            <p className="visao-relatorio__baixado">
              <Icone nome="check" /> Baixado:{" "}
              <span className="visao-relatorio__arquivo">{resultado.nome}</span>
              . Fica na pasta de downloads do aparelho.
            </p>
          )}
        </div>
        {resultado.tipo === "erro" &&
          (ehSemCampanha(resultado.erro) ? (
            <Aviso tom="alerta" anuncio="nenhum" titulo={TITULO_SEM_CAMPANHA}>
              Cadastre a campanha em{" "}
              <Link to="/coordenacao/campanha">Campanha</Link> para baixar o
              relatório.
            </Aviso>
          ) : (
            <Aviso
              tom="perigo"
              anuncio="nenhum"
              titulo={TITULO_FALHA}
              acao={
                podeTentarDeNovo(resultado.erro) && (
                  <ComDica texto={DICAS.tentarBaixarDeNovo}>
                    <Button variante="secundario" onClick={tentarDeNovo}>
                      Tentar de novo
                    </Button>
                  </ComDica>
                )
              }
            >
              {mensagemDoErro(resultado.erro)}
            </Aviso>
          ))}
        <div className="visao-relatorio__como-abrir">
          <p className="visao-relatorio__como-abrir-titulo">Como abrir</p>
          <ul>
            <li>
              <strong>Excel:</strong> dois cliques no arquivo.
            </li>
            <li>
              <strong>Google Planilhas:</strong>{" "}
              <Caminho passos={["Arquivo", "Importar", "Fazer upload"]} />. Em
              “Tipo de separador”, escolha “Personalizado” e digite ; (ponto e
              vírgula).
            </li>
          </ul>
        </div>
        {/* Região viva fixa: um role="status" que já entra com o texto pode não ser lido. */}
        <p className="visualmente-oculto" role="status">
          {anuncio}
        </p>
      </div>
    </Card>
  );
}

/** Um caminho de menu: as setas são só visuais; o leitor de tela ouve "Arquivo, Importar, Fazer upload". */
function Caminho({ passos }: { passos: readonly string[] }) {
  return passos.map((passo, indice) => (
    <span key={passo}>
      {indice > 0 && (
        <>
          <span aria-hidden="true"> → </span>
          <span className="visualmente-oculto">, </span>
        </>
      )}
      {passo}
    </span>
  ));
}
