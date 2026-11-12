import {
  useEffect,
  useRef,
  useState,
  type FormEvent,
  type ReactNode,
  type Ref,
} from "react";
import { flushSync } from "react-dom";
import { useLocation } from "react-router";
import {
  CRITERIOS_RANKING,
  MENSAGENS_PADRAO,
  REGRAS_META,
  UNIDADES_META,
  diaDoCalendario,
  type Campanha,
  type CriterioRanking,
  type RegraMeta,
  type TipoMensagem,
  type UnidadeMeta,
} from "../../../shared/contracts";
import { Button, Card, Input, Select } from "../../components/ui";
import { ErroApi, mensagemDoErro } from "../../lib/api";
import { formatarMoeda } from "../../lib/formatadores";
import { salvarCampanha } from "./campanha-api";
import {
  EditorPeriodos,
  campoNoContrato,
  type CampoPeriodo,
} from "./EditorPeriodos";
import {
  ID_MODELO_SANTO_ANDRE,
  LIMITE_PERIODOS,
  detalhesDoErro,
  errosDosDetalhes,
  formularioDaCampanha,
  formularioVazio,
  lerInteiro,
  lerReais,
  montarCorpo,
  ordenarChavesDeErro,
  percentuaisDoFormulario,
  periodoVazio,
  periodosDoModeloSantoAndre,
  previaDoCalendario,
  rotuloDoCampo,
  slugDoLink,
  type CorpoCampanha,
  type ErrosFormulario,
  type Formulario,
} from "./formulario";
import {
  CAMINHO_DA_CHAVE,
  ChavesDaCampanha,
  MensagensDoLink,
  type ChaveDoFormulario,
} from "./RegrasDoAdmin";
import { ResumoRegras } from "./ResumoRegras";
import { SituacaoCampanha } from "./SituacaoCampanha";
import { TEXTO_CRITERIO, TEXTO_REGRA, TEXTO_UNIDADE } from "./textos";

type Confirmacao =
  | { tipo: "ativar"; corpo: CorpoCampanha }
  | { tipo: "trocar_slug"; corpo: CorpoCampanha; slugAnterior: string };

type Props = {
  /** null = ainda não configurada: o primeiro salvamento ativa a campanha. */
  campanhaInicial: Campanha | null;
};

export function FormularioCampanha({ campanhaInicial }: Props) {
  const [salva, setSalva] = useState(campanhaInicial);
  const [formulario, setFormulario] = useState<Formulario>(() =>
    campanhaInicial ? formularioDaCampanha(campanhaInicial) : formularioVazio(),
  );
  const [erros, setErros] = useState<ErrosFormulario>({});
  const [erroGeral, setErroGeral] = useState<string | null>(null);
  const [sucesso, setSucesso] = useState<string | null>(null);
  const [avisoModelo, setAvisoModelo] = useState<string | null>(null);
  const [confirmacao, setConfirmacao] = useState<Confirmacao | null>(null);
  const [salvando, setSalvando] = useState(false);
  const { hash } = useLocation();
  const refResumoErros = useRef<HTMLDivElement>(null);
  const refVoltar = useRef<HTMLButtonElement>(null);
  const refSalvar = useRef<HTMLButtonElement>(null);

  const previa = previaDoCalendario(formulario);
  const percentuais = percentuaisDoFormulario(formulario);
  const chavesComErro = ordenarChavesDeErro(Object.keys(erros));

  function idDoCampo(chave: string): string {
    const periodo = /^periodos\.(\d+)\.(\w+)$/.exec(chave);
    if (periodo) {
      const linha = formulario.periodos[Number(periodo[1])];
      return linha
        ? `campanha-${linha.chave}-${periodo[2]}`
        : "campanha-periodos";
    }
    return `campanha-${chave.replaceAll(".", "-")}`;
  }

  // Um link para um campo (ex.: "#campanha-pedidos-desconsiderar", do aviso da tela Pedidos) leva o foco a ele: o
  // navegador não faz isso sozinho, porque o formulário só aparece depois de a campanha carregar.
  useEffect(() => {
    if (hash.length > 1) document.getElementById(hash.slice(1))?.focus();
  }, [hash]);

  /** Qualquer edição fecha a confirmação e as mensagens, e tira os erros dos campos mexidos. */
  function aposEditar(saiDosErros: (chave: string) => boolean) {
    setConfirmacao(null);
    setSucesso(null);
    setErroGeral(null);
    setErros((atuais) =>
      Object.fromEntries(
        Object.entries(atuais).filter(([chave]) => !saiDosErros(chave)),
      ),
    );
  }

  function alterar(mudanca: Partial<Formulario>, chaveDeErro: string) {
    setFormulario((atual) => ({ ...atual, ...mudanca }));
    aposEditar((chave) => chave === chaveDeErro);
  }

  function alterarPeriodo(indice: number, campo: CampoPeriodo, valor: string) {
    setFormulario((atual) => ({
      ...atual,
      periodos: atual.periodos.map((periodo, posicao) =>
        posicao === indice ? { ...periodo, [campo]: valor } : periodo,
      ),
    }));
    const chaveDoCampo = `periodos.${indice}.${campoNoContrato(campo)}`;
    aposEditar((chave) => chave === chaveDoCampo || chave === "periodos");
  }

  function trocarPeriodos(
    mudar: (atuais: Formulario["periodos"]) => Formulario["periodos"],
  ) {
    setFormulario((atual) => ({ ...atual, periodos: mudar(atual.periodos) }));
    // As linhas mudaram de posição: os erros por índice não valem mais.
    aposEditar(
      (chave) => chave === "periodos" || chave.startsWith("periodos."),
    );
  }

  function alterarChave(chave: ChaveDoFormulario, ligada: boolean) {
    alterar({ [chave]: ligada }, CAMINHO_DA_CHAVE[chave]);
  }

  function alterarMensagem(tipo: TipoMensagem, texto: string) {
    setFormulario((atual) => ({
      ...atual,
      mensagens: { ...atual.mensagens, [tipo]: texto },
    }));
    aposEditar((chave) => chave === `mensagens.${tipo}`);
  }

  function usarModeloSantoAndre() {
    trocarPeriodos(() => periodosDoModeloSantoAndre());
    setAvisoModelo(
      "Períodos preenchidos com o modelo de Santo André. Preço e meta continuam como estavam.",
    );
  }

  function mostrarErros(novos: ErrosFormulario, geral: string | null) {
    flushSync(() => {
      setErros(novos);
      setErroGeral(geral);
      setSucesso(null);
    });
    refResumoErros.current?.focus();
  }

  function aoEnviar(evento: FormEvent<HTMLFormElement>) {
    evento.preventDefault();
    if (salvando) return;
    const montagem = montarCorpo(formulario);
    if (!montagem.ok) {
      mostrarErros(montagem.erros, null);
      return;
    }
    const { corpo } = montagem;
    if (!salva) {
      pedirConfirmacao({ tipo: "ativar", corpo });
    } else if (corpo.slug_rifei !== salva.slug_rifei) {
      pedirConfirmacao({
        tipo: "trocar_slug",
        corpo,
        slugAnterior: salva.slug_rifei,
      });
    } else {
      void gravar(corpo, "salvar");
    }
  }

  function pedirConfirmacao(pedido: Confirmacao) {
    flushSync(() => {
      setErros({});
      setErroGeral(null);
      setSucesso(null);
      setConfirmacao(pedido);
    });
    refVoltar.current?.focus();
  }

  function cancelarConfirmacao() {
    flushSync(() => setConfirmacao(null));
    refSalvar.current?.focus();
  }

  async function gravar(
    corpo: CorpoCampanha,
    motivo: Confirmacao["tipo"] | "salvar",
  ) {
    setSalvando(true);
    try {
      const campanha = await salvarCampanha(corpo);
      flushSync(() => {
        setSalva(campanha);
        setFormulario(formularioDaCampanha(campanha));
        setConfirmacao(null);
        setErros({});
        setErroGeral(null);
        setAvisoModelo(null);
        setSucesso(textoDoSucesso(motivo, campanha.slug_rifei));
        setSalvando(false);
      });
      refSalvar.current?.focus();
    } catch (erro) {
      const errosDaApi = errosDosDetalhes(
        erro instanceof ErroApi ? detalhesDoErro(erro.detalhes) : [],
      );
      const semCampo = Object.keys(errosDaApi).length === 0;
      flushSync(() => {
        setConfirmacao(null);
        setSalvando(false);
      });
      mostrarErros(
        errosDaApi,
        semCampo ? `Não foi possível salvar. ${mensagemDoErro(erro)}` : null,
      );
    }
  }

  const precoCentavos = lerReais(formulario.preco);
  const metaEmReais = formulario.meta_unidade === "centavos";
  const metaLida = metaEmReais
    ? lerReais(formulario.meta_valor)
    : lerInteiro(formulario.meta_valor);
  const regra = formulario.meta_regra
    ? TEXTO_REGRA[formulario.meta_regra]
    : null;
  const sugestaoDeSlug = slugDoLink(formulario.slug_rifei);

  return (
    <>
      <SituacaoCampanha campanha={salva} />
      <ResumoRegras
        campanha={salva}
        idDoCampo={idDoCampo}
        idDosPercentuais={
          formulario.periodos.length > 0
            ? idDoCampo("periodos.0.percentual_bp")
            : ID_MODELO_SANTO_ANDRE
        }
      />

      <form noValidate onSubmit={aoEnviar}>
        {/* Enquanto salva, nada se edita: a resposta da API substitui o formulário. */}
        <fieldset className="campanha-formulario" disabled={salvando}>
          <Card titulo="Identificação">
            <div className="campanha-campos">
              <Input
                id={idDoCampo("nome")}
                rotulo="Nome da campanha"
                dica="Como a coordenação chama a campanha. Ex.: Rifa Videira Kids."
                value={formulario.nome}
                autoComplete="off"
                erro={erros.nome}
                onChange={(evento) =>
                  alterar({ nome: evento.target.value }, "nome")
                }
              />
              <div className="campanha-campo-com-sugestao">
                <Input
                  id={idDoCampo("slug_rifei")}
                  rotulo="Slug da campanha na Rifei"
                  dica={
                    <>
                      É o identificador da campanha no endereço dela na Rifei.
                      Abra a campanha na Rifei e copie a parte final do link,
                      depois da última barra: num link que termina em{" "}
                      <code>/videira-kids</code>, o slug é{" "}
                      <code>videira-kids</code>. Copie exatamente: só as vendas
                      com este slug contam para a campanha.
                    </>
                  }
                  value={formulario.slug_rifei}
                  autoComplete="off"
                  autoCapitalize="none"
                  spellCheck={false}
                  erro={erros.slug_rifei}
                  onChange={(evento) =>
                    alterar({ slug_rifei: evento.target.value }, "slug_rifei")
                  }
                />
                {sugestaoDeSlug && (
                  <div className="campanha-sugestao">
                    <p>
                      Isto parece um link. O slug é só a parte final:{" "}
                      <code>{sugestaoDeSlug}</code>.
                    </p>
                    <Button
                      variante="secundario"
                      onClick={() =>
                        alterar({ slug_rifei: sugestaoDeSlug }, "slug_rifei")
                      }
                    >
                      Usar só o slug
                    </Button>
                  </div>
                )}
              </div>
            </div>
          </Card>

          <Card titulo="Datas e períodos">
            <div className="campanha-campos">
              <div className="grade">
                <Input
                  id={idDoCampo("data_inicio")}
                  type="date"
                  rotulo="Data de início"
                  dica="Primeiro dia de vendas."
                  value={formulario.data_inicio}
                  erro={erros.data_inicio}
                  onChange={(evento) =>
                    alterar({ data_inicio: evento.target.value }, "data_inicio")
                  }
                />
                <Input
                  id={idDoCampo("fuso_horario")}
                  rotulo="Fuso horário"
                  dica="Quando cada dia começa e termina. Padrão: America/Belem."
                  value={formulario.fuso_horario}
                  autoComplete="off"
                  autoCapitalize="none"
                  spellCheck={false}
                  erro={erros.fuso_horario}
                  onChange={(evento) =>
                    alterar(
                      { fuso_horario: evento.target.value },
                      "fuso_horario",
                    )
                  }
                />
              </div>
              <EditorPeriodos
                periodos={formulario.periodos}
                previa={previa}
                percentuais={percentuais}
                temDataInicio={diaDoCalendario(formulario.data_inicio) !== null}
                erros={erros}
                idDoCampo={idDoCampo}
                aviso={avisoModelo}
                aoAlterar={alterarPeriodo}
                aoAdicionar={() =>
                  trocarPeriodos((atuais) =>
                    atuais.length >= LIMITE_PERIODOS
                      ? atuais
                      : [...atuais, periodoVazio(atuais.length + 1)],
                  )
                }
                aoRemover={(indice) =>
                  trocarPeriodos((atuais) =>
                    atuais.filter((_periodo, posicao) => posicao !== indice),
                  )
                }
                aoUsarModelo={usarModeloSantoAndre}
              />
            </div>
          </Card>

          <Card titulo="Bilhete e meta">
            <div className="campanha-campos">
              <Input
                id={idDoCampo("preco_bilhete_centavos")}
                rotulo="Preço do bilhete (R$)"
                dica={
                  precoCentavos !== null && precoCentavos > 0
                    ? `Cada bilhete custa ${formatarMoeda(precoCentavos)}.`
                    : "Em reais. Ex.: 20,00."
                }
                value={formulario.preco}
                inputMode="decimal"
                autoComplete="off"
                erro={erros.preco_bilhete_centavos}
                onChange={(evento) =>
                  alterar(
                    { preco: evento.target.value },
                    "preco_bilhete_centavos",
                  )
                }
              />
              <div className="grade">
                <Select
                  id={idDoCampo("meta.unidade")}
                  rotulo="Unidade da meta"
                  dica="Em que a meta é medida."
                  value={formulario.meta_unidade}
                  erro={erros["meta.unidade"]}
                  onChange={(evento) =>
                    alterar(
                      { meta_unidade: evento.target.value as UnidadeMeta | "" },
                      "meta.unidade",
                    )
                  }
                >
                  <option value="">Escolha…</option>
                  {UNIDADES_META.map((unidade) => (
                    <option key={unidade} value={unidade}>
                      {TEXTO_UNIDADE[unidade]}
                    </option>
                  ))}
                </Select>
                <Select
                  id={idDoCampo("meta.regra")}
                  rotulo="Regra da meta"
                  dica={regra?.explicacao ?? "Como sai a meta de cada célula."}
                  value={formulario.meta_regra}
                  erro={erros["meta.regra"]}
                  onChange={(evento) =>
                    alterar(
                      { meta_regra: evento.target.value as RegraMeta | "" },
                      "meta.regra",
                    )
                  }
                >
                  <option value="">Escolha…</option>
                  {REGRAS_META.map((opcao) => (
                    <option key={opcao} value={opcao}>
                      {TEXTO_REGRA[opcao].opcao}
                    </option>
                  ))}
                </Select>
              </div>
              <Input
                id={idDoCampo("meta.valor")}
                rotulo={`${regra?.campo ?? "Valor da meta"}${
                  formulario.meta_unidade === "bilhetes"
                    ? " (bilhetes)"
                    : metaEmReais
                      ? " (R$)"
                      : ""
                }`}
                dica={dicaDaMeta(formulario.meta_unidade, metaLida)}
                value={formulario.meta_valor}
                inputMode={metaEmReais ? "decimal" : "numeric"}
                autoComplete="off"
                erro={erros["meta.valor"]}
                onChange={(evento) =>
                  alterar({ meta_valor: evento.target.value }, "meta.valor")
                }
              />
            </div>
          </Card>

          <Card titulo="Ranking e público">
            <div className="campanha-campos">
              <Select
                id={idDoCampo("ranking.criterio")}
                rotulo="Critério do ranking"
                dica={
                  formulario.ranking_criterio
                    ? TEXTO_CRITERIO[formulario.ranking_criterio].explicacao
                    : "Como as células são ordenadas nos rankings."
                }
                value={formulario.ranking_criterio}
                erro={erros["ranking.criterio"]}
                onChange={(evento) =>
                  alterar(
                    {
                      ranking_criterio: evento.target.value as
                        CriterioRanking | "",
                    },
                    "ranking.criterio",
                  )
                }
              >
                <option value="">Escolha…</option>
                {CRITERIOS_RANKING.map((criterio) => (
                  <option key={criterio} value={criterio}>
                    {TEXTO_CRITERIO[criterio].opcao}
                  </option>
                ))}
              </Select>

              <div className="campanha-publico">
                <h3 className="campanha-subtitulo">O que o público vê</h3>
                <p className="campanha-texto-suave">
                  No telão e no ranking aberto (grupo do WhatsApp), o público vê
                  a posição e o nome de cada célula. Valores em R$ nunca
                  aparecem para o público, com qualquer configuração.
                </p>
                <label
                  className="campanha-opcao"
                  htmlFor={idDoCampo("publico.mostra_percentual_meta")}
                >
                  <input
                    id={idDoCampo("publico.mostra_percentual_meta")}
                    type="checkbox"
                    checked={formulario.publico_mostra_percentual_meta}
                    onChange={(evento) =>
                      alterar(
                        {
                          publico_mostra_percentual_meta: evento.target.checked,
                        },
                        "publico.mostra_percentual_meta",
                      )
                    }
                  />
                  <span>Mostrar também o percentual da meta atingido</span>
                </label>
                <Input
                  id={idDoCampo("publico.limite_ranking")}
                  rotulo="Quantas posições o público vê"
                  dica="Padrão: 3. Deixe em branco para mostrar todas. Quem empata na última posição também aparece."
                  value={formulario.publico_limite_ranking}
                  inputMode="numeric"
                  autoComplete="off"
                  erro={erros["publico.limite_ranking"]}
                  onChange={(evento) =>
                    alterar(
                      { publico_limite_ranking: evento.target.value },
                      "publico.limite_ranking",
                    )
                  }
                />
              </div>
            </div>
          </Card>

          <ChavesDaCampanha
            formulario={formulario}
            idDoCampo={idDoCampo}
            aoAlterar={alterarChave}
          />

          <MensagensDoLink
            mensagens={formulario.mensagens}
            erros={erros}
            idDoCampo={idDoCampo}
            aoAlterar={alterarMensagem}
            aoVoltarAoPadrao={(tipo) =>
              alterarMensagem(tipo, MENSAGENS_PADRAO[tipo])
            }
          />

          <div className="campanha-acoes">
            {(chavesComErro.length > 0 || erroGeral) && (
              <div
                ref={refResumoErros}
                className="campanha-erros"
                role="alert"
                tabIndex={-1}
              >
                <p className="campanha-erros__titulo">
                  {erroGeral ?? "Não foi possível salvar. Confira:"}
                </p>
                {chavesComErro.length > 0 && (
                  <ul>
                    {chavesComErro.map((chave) => (
                      <li key={chave}>
                        <a
                          href={`#${idDoCampo(chave)}`}
                          onClick={(evento) => {
                            evento.preventDefault();
                            document.getElementById(idDoCampo(chave))?.focus();
                          }}
                        >
                          {rotuloDoCampo(chave)}
                        </a>
                        : {erros[chave]}
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            )}

            {sucesso && (
              <p role="status" className="campanha-sucesso">
                {sucesso}
              </p>
            )}

            {confirmacao ? (
              <PainelConfirmacao
                confirmacao={confirmacao}
                salvando={salvando}
                refVoltar={refVoltar}
                aoConfirmar={() =>
                  void gravar(confirmacao.corpo, confirmacao.tipo)
                }
                aoVoltar={cancelarConfirmacao}
              />
            ) : (
              <div>
                <Button ref={refSalvar} type="submit" disabled={salvando}>
                  {salvando
                    ? "Salvando…"
                    : salva
                      ? "Salvar alterações"
                      : "Ativar a campanha"}
                </Button>
              </div>
            )}
          </div>
        </fieldset>
      </form>
    </>
  );
}

function dicaDaMeta(
  unidade: UnidadeMeta | "",
  valor: number | null,
): ReactNode {
  if (unidade === "centavos") {
    return valor !== null && valor > 0
      ? `Meta de ${formatarMoeda(valor)}.`
      : "Em reais. Ex.: 1.000,00.";
  }
  if (unidade === "bilhetes") return "Número inteiro de bilhetes.";
  return "Escolha antes a unidade da meta.";
}

function textoDoSucesso(motivo: Confirmacao["tipo"] | "salvar", slug: string) {
  if (motivo === "ativar") {
    return `Campanha ativada. A partir de agora, as vendas da Rifei com o slug ${slug} contam para ela.`;
  }
  if (motivo === "trocar_slug") {
    return `Alterações salvas. Agora contam as vendas da Rifei com o slug ${slug}.`;
  }
  return "Alterações salvas.";
}

type PropsConfirmacao = {
  confirmacao: Confirmacao;
  salvando: boolean;
  refVoltar: Ref<HTMLButtonElement>;
  aoConfirmar: () => void;
  aoVoltar: () => void;
};

/** Confirmação explícita antes de mudar quais vendas da Rifei contam (ativar ou trocar o slug). */
function PainelConfirmacao({
  confirmacao,
  salvando,
  refVoltar,
  aoConfirmar,
  aoVoltar,
}: PropsConfirmacao) {
  const ativar = confirmacao.tipo === "ativar";
  const slug = confirmacao.corpo.slug_rifei;
  return (
    <div
      className="campanha-confirmacao"
      role="alertdialog"
      aria-labelledby="campanha-confirmacao-titulo"
      aria-describedby="campanha-confirmacao-texto"
    >
      <h2
        id="campanha-confirmacao-titulo"
        className="campanha-confirmacao__titulo"
      >
        {ativar ? "Ativar a campanha?" : "Trocar o slug da campanha?"}
      </h2>
      <div
        id="campanha-confirmacao-texto"
        className="campanha-confirmacao__texto"
      >
        {confirmacao.tipo === "ativar" ? (
          <p>
            A partir de agora, as vendas da Rifei com o slug{" "}
            <strong>{slug}</strong> passam a contar para esta campanha: entram
            no painel, nas metas e nos rankings. Vendas com outro slug continuam
            sendo ignoradas.
          </p>
        ) : (
          <p>
            A partir de agora, só as vendas da Rifei com o slug{" "}
            <strong>{slug}</strong> passam a contar. As que chegarem com o slug{" "}
            <strong>{confirmacao.slugAnterior}</strong> passam a ser ignoradas.
          </p>
        )}
        <p>Confira se o slug é igual ao do link da campanha na Rifei.</p>
      </div>
      <div className="campanha-confirmacao__botoes">
        <Button onClick={aoConfirmar} disabled={salvando}>
          {salvando
            ? "Salvando…"
            : ativar
              ? "Sim, ativar a campanha"
              : "Sim, trocar o slug"}
        </Button>
        <Button
          ref={refVoltar}
          variante="secundario"
          onClick={aoVoltar}
          disabled={salvando}
        >
          Voltar e revisar
        </Button>
      </div>
    </div>
  );
}
