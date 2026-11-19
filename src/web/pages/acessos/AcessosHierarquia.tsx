import { useEffect, useRef, useState } from "react";
import { Link } from "react-router";
import type {
  ItemAcessoHierarquia,
  LinkAcesso,
  LinkGeradoHierarquia,
  PapelHierarquia,
} from "../../../shared/contracts";
import {
  Aviso,
  Badge,
  Button,
  ComDica,
  DataTable,
  EmptyState,
  ErrorState,
  Loading,
  Select,
  type ColunaTabela,
} from "../../components/ui";
import { NOMES_DIVISAO } from "../../../shared/contracts/calculos";
import { ehFalhaDeConexao, mensagemDoErro } from "../../lib/api";
import { useRedes } from "../../lib/redes";
import { formatarDataHora, formatarNumero } from "../../lib/formatadores";
import {
  LIMITE_ALVOS_POR_LOTE,
  PAPEIS_DO_SELETOR,
  definirAtivo,
  gerarLinksHierarquia,
  listarAlvos,
} from "./acessos-api";
import { DialogoDesativar, DialogoRevogar } from "./Dialogos";
import { DialogoLinksGerados, DialogoTrocarAcesso } from "./DialogosHierarquia";
import {
  ACESSO_DO_PAPEL,
  CAMINHO_TELA_CAMPANHA,
  acessoLigado,
  ehAcaoDesligada,
  type RegrasDosAcessos,
} from "./regras";
import {
  DICAS,
  ALVO_DO_PAPEL,
  PAPEL_NO_PLURAL,
  avisoDeOutraPessoa,
  mensagemAoGerarLinks,
  precisaDeLink,
  situacaoDoAcesso,
  textoAcessoDesligado,
  textoDaSituacao,
  textoDosAparelhos,
} from "./textos";
import "./acessos-hierarquia.css";

/** Alvos carregados do papel e o erro da última carga (com dados, o erro é de uma recarga). */
type Carga = {
  papel: PapelHierarquia;
  dados: ItemAcessoHierarquia[] | null;
  erro: unknown;
};
/** Ação direta em andamento: o lote ("lote") ou a linha de um alvo (o id dele). */
type Ocupado = { chave: "lote" | number; acao: "gerando" | "reativando" };
type Resultado = { tom: "sucesso" | "perigo"; texto: string };

/** Ids dos botões de cada linha (para devolver o foco depois de revogar um link). */
export const idBotaoNovoLink = (alvoId: number) =>
  `acessos-hierarquia-novo-${alvoId}`;
export const idBotaoAtivoDoAlvo = (alvoId: number) =>
  `acessos-hierarquia-ativo-${alvoId}`;
/** O aviso do acesso desligado: descreve os botões de gerar link, que ficam indisponíveis. */
export const ID_AVISO_DESLIGADO = "acessos-hierarquia-desligado";

type Props = {
  /** As regras da campanha (D20): o acesso de cada papel e os modelos das mensagens. */
  regras: RegrasDosAcessos;
  /** Um 409 `acao_desligada` disse que o acesso do papel foi desligado (com a tela aberta). */
  aoDesligar: (papel: PapelHierarquia) => void;
};

// Acessos de líderes, discipuladores e redes (só admin, RIFA-014): todos os alvos do papel escolhido, com a
// pessoa que deve receber o link, o telefone (líder), a situação do acesso e os aparelhos conectados. Gera os
// links de quem ainda não tem num lote só, um link novo por linha e "Trocar acesso" (revoga os anteriores:
// o aparelho antigo sai). Os links aparecem uma vez só, num diálogo, com "Copiar mensagem" e "Abrir no
// WhatsApp", e são esquecidos ao fechar. Desativar, reativar e revogar usam as rotas que a tela já tem. Com uma rede
// só (RIFA-065, D30), o papel Rede sai do seletor: não se oferece criar acesso de rede.
export function AcessosHierarquia({ regras, aoDesligar }: Props) {
  const redeUnica = useRedes().unica;
  const [escolhido, setPapel] = useState<PapelHierarquia>("lider");
  // A rede ficou única com o papel Rede escolhido: volta para os líderes.
  const papel: PapelHierarquia =
    redeUnica && escolhido === "rede" ? "lider" : escolhido;
  const papeis = redeUnica
    ? PAPEIS_DO_SELETOR.filter((opcao) => opcao !== "rede")
    : PAPEIS_DO_SELETOR;
  const [carga, setCarga] = useState<Carga>({
    papel,
    dados: null,
    erro: null,
  });
  const [versao, setVersao] = useState(0);
  /** Os links que acabaram de ser gerados: a URL só existe aqui, até fechar o diálogo. */
  const [gerados, setGerados] = useState<LinkGeradoHierarquia[] | null>(null);
  const [troca, setTroca] = useState<ItemAcessoHierarquia | null>(null);
  const [revogacao, setRevogacao] = useState<{
    item: ItemAcessoHierarquia;
    link: LinkAcesso;
  } | null>(null);
  const [desativacao, setDesativacao] = useState<ItemAcessoHierarquia | null>(
    null,
  );
  const [ocupado, setOcupado] = useState<Ocupado | null>(null);
  const [resultado, setResultado] = useState<Resultado | null>(null);
  // Trava síncrona das ações diretas (gerar links e reativar).
  const acaoEmAndamento = useRef(false);
  // Depois de revogar, o botão do link some: o foco vai para outro botão da mesma linha.
  const refFocoAposRevogar = useRef<HTMLElement | null>(null);

  useEffect(() => {
    const controle = new AbortController();
    listarAlvos(papel, { signal: controle.signal }).then(
      (dados) => setCarga({ papel, dados, erro: null }),
      (erro: unknown) => {
        if (controle.signal.aborted) return;
        setCarga((atual) => ({
          papel,
          dados: atual.papel === papel ? atual.dados : null,
          erro,
        }));
      },
    );
    return () => controle.abort();
  }, [papel, versao]);

  function recarregar() {
    setVersao((atual) => atual + 1);
  }

  function tentarDeNovo() {
    setCarga({ papel, dados: null, erro: null });
    recarregar();
  }

  function avisar(tom: Resultado["tom"], texto: string) {
    setResultado({ tom, texto });
  }

  // A lista de outro papel não aparece enquanto a do papel escolhido carrega.
  const dados = carga.papel === papel ? carga.dados : null;
  const erro = carga.papel === papel ? carga.erro : null;
  const semLink = dados?.filter(precisaDeLink) ?? [];
  const lote = semLink.slice(0, LIMITE_ALVOS_POR_LOTE);
  // D20: com o acesso do papel desligado na Campanha, não se gera nem se manda link dele.
  const ligado = acessoLigado(regras, papel);

  async function gerar(
    chave: Ocupado["chave"],
    ids: number[],
    oQue: string,
  ): Promise<void> {
    if (acaoEmAndamento.current || ids.length === 0 || !ligado) return;
    acaoEmAndamento.current = true;
    setOcupado({ chave, acao: "gerando" });
    try {
      const itens = await gerarLinksHierarquia(papel, ids);
      setGerados(itens);
      avisar(
        "sucesso",
        itens.length === 1
          ? `Link novo de ${itens[0].alvo.nome} gerado.`
          : `${formatarNumero(itens.length)} links gerados.`,
      );
    } catch (falha) {
      if (ehAcaoDesligada(falha)) aoDesligar(papel);
      avisar(
        "perigo",
        `Não foi possível gerar ${oQue}: ${mensagemAoGerarLinks(falha, papel)}`,
      );
    } finally {
      acaoEmAndamento.current = false;
      setOcupado(null);
      recarregar();
    }
  }

  async function reativar(item: ItemAcessoHierarquia) {
    const { usuario } = item;
    if (!usuario || acaoEmAndamento.current) return;
    acaoEmAndamento.current = true;
    setOcupado({ chave: item.alvo.id, acao: "reativando" });
    try {
      await definirAtivo(usuario.id, true);
      avisar("sucesso", `Acesso de ${item.alvo.nome} reativado.`);
    } catch (falha) {
      avisar(
        "perigo",
        `Não foi possível reativar o acesso de ${item.alvo.nome}: ${mensagemDoErro(falha)}`,
      );
    } finally {
      acaoEmAndamento.current = false;
      setOcupado(null);
      recarregar();
    }
  }

  function aoTrocar(item: ItemAcessoHierarquia, itens: LinkGeradoHierarquia[]) {
    setTroca(null);
    setGerados(itens);
    avisar(
      "sucesso",
      `Acesso de ${item.alvo.nome} trocado: os links anteriores pararam de funcionar.`,
    );
    recarregar();
  }

  function pedirRevogacao(item: ItemAcessoHierarquia, link: LinkAcesso) {
    refFocoAposRevogar.current = null;
    setRevogacao({ item, link });
  }

  function aoRevogar(item: ItemAcessoHierarquia) {
    refFocoAposRevogar.current =
      document.getElementById(idBotaoNovoLink(item.alvo.id)) ??
      document.getElementById(idBotaoAtivoDoAlvo(item.alvo.id));
    setRevogacao(null);
    avisar("sucesso", `Link de ${item.alvo.nome} revogado.`);
    recarregar();
  }

  function aoDesativar(item: ItemAcessoHierarquia) {
    setDesativacao(null);
    avisar("sucesso", `Acesso de ${item.alvo.nome} desativado.`);
    recarregar();
  }

  const colunas: ColunaTabela<ItemAcessoHierarquia>[] = [
    {
      chave: "alvo",
      titulo: ALVO_DO_PAPEL[papel],
      principal: true,
      celula: (item) => (
        <>
          {item.alvo.nome}{" "}
          <span className="acessos-suave acessos-divisao">
            {NOMES_DIVISAO[item.alvo.divisao]}
          </span>
        </>
      ),
    },
    {
      chave: "pessoa",
      titulo: "Pessoa",
      celula: (item) => <Pessoa item={item} />,
    },
    ...(papel === "lider"
      ? [
          {
            chave: "telefone",
            titulo: "Telefone",
            celula: (item: ItemAcessoHierarquia) =>
              item.telefone === null ? (
                <span className="acessos-suave">Sem telefone</span>
              ) : (
                <span className="acessos-telefone">{item.telefone}</span>
              ),
          },
        ]
      : []),
    {
      // A situação do acesso e os aparelhos conectados (as sessões abertas pelos links do alvo).
      chave: "situacao",
      titulo: "Situação",
      celula: (item) => <Situacao item={item} />,
    },
    {
      chave: "acoes",
      titulo: "Ações",
      celula: (item) => (
        <AcoesDoAlvo
          item={item}
          ocupado={ocupado}
          ligado={ligado}
          aoNovoLink={() =>
            void gerar(
              item.alvo.id,
              [item.alvo.id],
              `o link de ${item.alvo.nome}`,
            )
          }
          aoTrocar={() => setTroca(item)}
          aoRevogar={(link) => pedirRevogacao(item, link)}
          aoDesativar={() => setDesativacao(item)}
          aoReativar={() => void reativar(item)}
        />
      ),
    },
  ];

  return (
    <div className="acessos-hierarquia">
      <p className="acessos-suave">
        {redeUnica
          ? "Cada célula e cada discipulador tem um acesso preso a ele:"
          : "Cada célula, discipulador e rede tem um acesso preso a ela:"}{" "}
        quem entra pelo link vê só a própria visão, sem valores em dinheiro. O
        link vai para a pessoa da hierarquia e só aparece na hora em que é
        gerado.
      </p>
      <div className="acessos-hierarquia__controles">
        <div className="acessos-hierarquia__papel">
          <ComDica
            texto={
              redeUnica
                ? DICAS.papelDaHierarquiaRedeUnica
                : DICAS.papelDaHierarquia
            }
          >
            <Select
              rotulo="Papel"
              value={papel}
              onChange={(evento) => {
                setPapel(evento.currentTarget.value as PapelHierarquia);
                setResultado(null);
              }}
            >
              {papeis.map((opcao) => (
                <option key={opcao} value={opcao}>
                  {PAPEL_NO_PLURAL[opcao]}
                </option>
              ))}
            </Select>
          </ComDica>
        </div>
        <div className="acessos-hierarquia__lote">
          <ComDica
            texto={
              !ligado
                ? DICAS.loteIndisponivel.desligado
                : ocupado !== null
                  ? DICAS.loteIndisponivel.ocupado
                  : lote.length === 0
                    ? DICAS.loteIndisponivel.ninguem
                    : DICAS.gerarLote
            }
          >
            <Button
              onClick={() =>
                void gerar(
                  "lote",
                  lote.map((item) => item.alvo.id),
                  "os links",
                )
              }
              aria-disabled={
                lote.length === 0 || ocupado !== null || !ligado || undefined
              }
              aria-describedby={ligado ? undefined : ID_AVISO_DESLIGADO}
            >
              {ocupado?.chave === "lote"
                ? "Gerando…"
                : `Gerar links para quem ainda não tem (${formatarNumero(lote.length)})`}
            </Button>
          </ComDica>
          {dados && ligado && (
            <p className="acessos-suave">
              {semLink.length === 0
                ? "Todos os ativos já têm link válido."
                : semLink.length > LIMITE_ALVOS_POR_LOTE
                  ? `Vão os primeiros ${formatarNumero(LIMITE_ALVOS_POR_LOTE)}; toque de novo para os outros.`
                  : "Quem está sem link válido. Os desativados ficam de fora: reative antes."}
            </p>
          )}
        </div>
      </div>
      {!ligado && papel !== "lider" && (
        <div id={ID_AVISO_DESLIGADO}>
          <Aviso
            tom="alerta"
            titulo={textoAcessoDesligado(papel)}
            anuncio="nenhum"
          >
            <p>
              Por enquanto,{" "}
              {papel === "rede" ? "as redes" : "os discipuladores"} não entram
              no sistema e não dá para gerar nem mandar links para{" "}
              {papel === "rede" ? "elas" : "eles"}. Nada foi revogado: quando{" "}
              {ACESSO_DO_PAPEL[papel]} for religado na{" "}
              <Link to={CAMINHO_TELA_CAMPANHA}>tela Campanha</Link>, os links já
              mandados voltam a valer.
            </p>
          </Aviso>
        </div>
      )}
      {/* Região viva fixa: anuncia o resultado de cada ação. */}
      <p className="visualmente-oculto" role="status">
        {resultado?.texto ?? ""}
      </p>
      {resultado && (
        <Aviso
          tom={resultado.tom}
          anuncio="nenhum"
          aoFechar={() => setResultado(null)}
        >
          <p>{resultado.texto}</p>
        </Aviso>
      )}
      {!dados && erro === null && <Loading texto="Carregando os acessos…" />}
      {!dados && erro !== null && (
        <ErrorState
          titulo="Não foi possível carregar os acessos."
          mensagem={mensagemDoErro(erro)}
          conexao={ehFalhaDeConexao(erro)}
          aoTentarDeNovo={tentarDeNovo}
        />
      )}
      {dados && erro !== null && (
        <Aviso
          tom="perigo"
          titulo="Não foi possível atualizar a lista"
          acao={
            <ComDica texto={DICAS.tentarDeNovoLista}>
              <Button variante="secundario" onClick={recarregar}>
                Tentar de novo
              </Button>
            </ComDica>
          }
        >
          <p>{mensagemDoErro(erro)}</p>
        </Aviso>
      )}
      {dados && (
        <DataTable
          colunas={colunas}
          linhas={dados}
          chaveDaLinha={(item) => item.alvo.id}
          legenda={`Acessos: ${PAPEL_NO_PLURAL[papel]}`}
          vazio={
            <EmptyState
              titulo="Nenhum alvo na hierarquia ainda."
              descricao="Cadastre ou importe a hierarquia na tela Hierarquia antes de gerar os links."
            />
          }
        />
      )}
      {gerados && (
        <DialogoLinksGerados
          itens={gerados}
          mensagens={regras.mensagens}
          aoFechar={() => setGerados(null)}
        />
      )}
      {troca && (
        <DialogoTrocarAcesso
          papel={papel}
          item={troca}
          aoFechar={() => setTroca(null)}
          aoConcluir={(itens) => aoTrocar(troca, itens)}
          aoDesatualizar={recarregar}
          aoDesligada={() => aoDesligar(papel)}
        />
      )}
      {revogacao && revogacao.item.usuario && (
        <DialogoRevogar
          pessoa={revogacao.item.usuario}
          link={revogacao.link}
          aoFechar={() => setRevogacao(null)}
          aoConcluir={() => aoRevogar(revogacao.item)}
          aoDesatualizar={recarregar}
          focoAoFechar={refFocoAposRevogar}
        />
      )}
      {desativacao && desativacao.usuario && (
        <DialogoDesativar
          pessoa={{
            id: desativacao.usuario.id,
            nome: desativacao.usuario.nome,
            papel,
          }}
          aSiMesmo={false}
          aoFechar={() => setDesativacao(null)}
          aoConcluir={() => aoDesativar(desativacao)}
          aoDesatualizar={recarregar}
        />
      )}
    </div>
  );
}

// O conteúdo de cada célula da tabela vai num só bloco (.acessos-celula): no celular, a célula vira uma
// linha "rótulo: valor" e o valor precisa ser um item só, senão as partes ficam espremidas lado a lado.

/** A pessoa que deve receber o link; se o último link foi para outra pessoa, avisa o que fazer. */
function Pessoa({ item }: { item: ItemAcessoHierarquia }) {
  const aviso = avisoDeOutraPessoa(item);
  return (
    <div className="acessos-celula">
      {item.pessoa_nome ?? (
        <span className="acessos-suave">Sem responsável na hierarquia</span>
      )}
      {aviso && (
        <>
          {" "}
          <span className="acessos-suave acessos-nota-linha">{aviso}</span>
        </>
      )}
    </div>
  );
}

/** A situação do acesso (selo e detalhe) e os aparelhos conectados, quando o alvo já tem usuário. */
function Situacao({ item }: { item: ItemAcessoHierarquia }) {
  const { tom, rotulo, detalhe } = textoDaSituacao(
    situacaoDoAcesso(item.usuario),
  );
  return (
    <div className="acessos-celula">
      <Badge tom={tom}>{rotulo}</Badge>
      {detalhe && (
        <>
          {" "}
          <span className="acessos-suave acessos-nota-linha">{detalhe}</span>
        </>
      )}
      {item.usuario && (
        <>
          {" "}
          <span className="acessos-nota-linha">
            {textoDosAparelhos(item.usuario.sessoes_ativas)}
          </span>
        </>
      )}
    </div>
  );
}

function AcoesDoAlvo({
  item,
  ocupado,
  ligado,
  aoNovoLink,
  aoTrocar,
  aoRevogar,
  aoDesativar,
  aoReativar,
}: {
  item: ItemAcessoHierarquia;
  ocupado: Ocupado | null;
  /** O acesso do papel está ligado na Campanha (D20); desligado, gerar e trocar ficam indisponíveis. */
  ligado: boolean;
  aoNovoLink: () => void;
  aoTrocar: () => void;
  aoRevogar: (link: LinkAcesso) => void;
  aoDesativar: () => void;
  aoReativar: () => void;
}) {
  const { alvo, usuario } = item;
  const situacao = situacaoDoAcesso(usuario);
  const acaoAqui = ocupado?.chave === alvo.id ? ocupado.acao : null;
  const validos =
    situacao.tipo === "valido" && usuario
      ? usuario.links.filter((link) => link.situacao === "valido")
      : [];
  // Enquanto uma ação está em andamento, as da linha ficam indisponíveis (aria-disabled, continuam focáveis)
  // e o toque não faz nada: nem chama a API nem abre confirmação.
  const ocupada = ocupado !== null || undefined;
  const seDisponivel = (acao: () => void) => (): void => {
    if (ocupado === null) acao();
  };
  // Gerar e trocar o link: também indisponíveis com o acesso do papel desligado (o aviso no topo explica).
  const semLink = ocupada ?? (!ligado || undefined);
  const seLigado = (acao: () => void) => (): void => {
    if (ocupado === null && ligado) acao();
  };
  const descricaoSemLink = ligado ? undefined : ID_AVISO_DESLIGADO;
  return (
    <div className="acessos-acoes-linha">
      {situacao.tipo !== "desativado" && (
        <ComDica
          texto={
            ocupada
              ? DICAS.ocupado
              : ligado
                ? DICAS.novoLink
                : DICAS.semLinkDesligado
          }
        >
          <Button
            id={idBotaoNovoLink(alvo.id)}
            variante="secundario"
            onClick={seLigado(aoNovoLink)}
            aria-disabled={semLink}
            aria-describedby={descricaoSemLink}
          >
            {acaoAqui === "gerando" ? "Gerando…" : "Novo link"}{" "}
            <span className="visualmente-oculto">para {alvo.nome}</span>
          </Button>
        </ComDica>
      )}
      {situacao.tipo === "valido" && (
        <ComDica
          texto={
            ocupada
              ? DICAS.ocupado
              : ligado
                ? DICAS.trocarAcesso
                : DICAS.semLinkDesligado
          }
        >
          <Button
            variante="secundario"
            onClick={seLigado(aoTrocar)}
            aria-disabled={semLink}
            aria-describedby={descricaoSemLink}
          >
            Trocar acesso{" "}
            <span className="visualmente-oculto">de {alvo.nome}</span>
          </Button>
        </ComDica>
      )}
      {validos.map((link) => (
        <ComDica texto={ocupada ? DICAS.ocupado : DICAS.revogarLink}>
          <Button
            key={link.id}
            variante="secundario"
            onClick={seDisponivel(() => aoRevogar(link))}
            aria-disabled={ocupada}
          >
            Revogar link{" "}
            <span className="visualmente-oculto">
              de {alvo.nome} criado em {formatarDataHora(link.criado_em)}
            </span>
          </Button>
        </ComDica>
      ))}
      {usuario && (
        <ComDica
          texto={
            ocupada
              ? DICAS.ocupado
              : usuario.ativo
                ? DICAS.desativarAcesso
                : DICAS.reativarAcesso
          }
        >
          <Button
            id={idBotaoAtivoDoAlvo(alvo.id)}
            variante="secundario"
            onClick={seDisponivel(usuario.ativo ? aoDesativar : aoReativar)}
            aria-disabled={ocupada}
          >
            {usuario.ativo
              ? "Desativar acesso"
              : acaoAqui === "reativando"
                ? "Reativando…"
                : "Reativar acesso"}{" "}
            <span className="visualmente-oculto">de {alvo.nome}</span>
          </Button>
        </ComDica>
      )}
    </div>
  );
}
