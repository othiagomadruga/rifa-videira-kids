import { useId, type ReactNode, type RefObject } from "react";
import type {
  AvisoReconciliacao,
  Divergencia,
  PedidoDesconsideradoNaConferencia,
  GrupoDivergencia,
  RespostaAnaliseAgregada,
  RespostaAnalisePorPedido,
  RespostaAnaliseReconciliacao,
  TipoRecuperacao,
} from "../../../shared/contracts";
import {
  Aviso,
  Badge,
  Button,
  Card,
  ComAjuda,
  ComDica,
  DataTable,
  Stat,
  type ColunaTabela,
} from "../../components/ui";
import { formatarData, formatarDataHora } from "../../lib/formatadores";
import { LIMITE_PEDIDOS_RECUPERAR } from "../../../shared/contracts/conferencia";
import {
  comMaiuscula,
  textoDoAfiliado,
  textoDoArquivo,
  textoDoSistema,
  textoDosTotais,
} from "./formatos";
import {
  AJUDA,
  DESCONSIDERADOS,
  DICAS,
  DIVERGENCIAS,
  MOTIVO_DESCONSIDERACAO,
  OBSERVACOES,
  PAGAMENTOS,
  plural,
  tomDoAviso,
} from "./textos";

type Props = {
  analise: RespostaAnaliseReconciliacao;
  /** Os avisos da leitura do arquivo (na tela) e os da comparação (da API), juntos. */
  avisos: readonly AvisoReconciliacao[];
  /** Vendas perdidas marcadas para recuperar e (só o admin) pagamentos não registrados marcados para registrar. */
  selecionados: ReadonlySet<string>;
  aoSelecionar: (codigos: string[], marcado: boolean) => void;
  aoRecuperar: (tipo: TipoRecuperacao) => void;
  /** O admin marca como pago o pagamento não registrado (RIFA-056); a coordenação só vê. */
  admin: boolean;
  /** Recebe o foco quando o resultado chega. */
  refTitulo: RefObject<HTMLSpanElement | null>;
  /** Aviso do último "Recuperar" (no topo do resultado). */
  aviso?: ReactNode;
};

// O resultado da conferência: o que se lê em 5 segundos (um aviso e os totais dos dois lados), os avisos
// do arquivo e, no modo por pedido, cada tipo de diferença com a explicação e os pedidos; no modo por
// totais, as tabelas por afiliado e por dia.
export function Resultado({
  analise,
  avisos,
  selecionados,
  aoSelecionar,
  aoRecuperar,
  admin,
  refTitulo,
  aviso,
}: Props) {
  return (
    <Card
      ajuda={AJUDA.resultado}
      titulo={
        <span ref={refTitulo} tabIndex={-1} className="conferencia-titulo-foco">
          Resultado da conferência
        </span>
      }
    >
      <div className="conferencia-bloco">
        {aviso}
        <p className="conferencia-suave">
          Conferido às {formatarDataHora(analise.conferido_em)} ·{" "}
          {plural(analise.arquivo.linhas, "linha lida", "linhas lidas")}
          {analise.arquivo.data_inicio && analise.arquivo.data_fim
            ? ` · arquivo de ${formatarData(analise.arquivo.data_inicio)} a ${formatarData(analise.arquivo.data_fim)}`
            : ""}
        </p>
        {analise.modo === "por_pedido" ? (
          <PorPedido
            analise={analise}
            avisos={avisos}
            selecionados={selecionados}
            aoSelecionar={aoSelecionar}
            aoRecuperar={aoRecuperar}
            admin={admin}
          />
        ) : (
          <Agregado analise={analise} avisos={avisos} />
        )}
      </div>
    </Card>
  );
}

function Avisos({ avisos }: { avisos: readonly AvisoReconciliacao[] }) {
  if (avisos.length === 0) return null;
  return (
    <div className="conferencia-avisos">
      <SubtituloComAjuda texto={AJUDA.avisos}>
        Avisos sobre o arquivo
      </SubtituloComAjuda>
      <ul className="conferencia-lista-simples">
        {avisos.map((item) => (
          <li key={item.codigo}>
            <Aviso tom={tomDoAviso(item.codigo)} anuncio="nenhum">
              <p>{item.mensagem}</p>
            </Aviso>
          </li>
        ))}
      </ul>
    </div>
  );
}

// ---------------------------------------------------------------------------------------------------
// Pedido a pedido
// ---------------------------------------------------------------------------------------------------

function PorPedido({
  analise,
  avisos,
  selecionados,
  aoSelecionar,
  aoRecuperar,
  admin,
}: {
  analise: RespostaAnalisePorPedido;
  avisos: readonly AvisoReconciliacao[];
  selecionados: ReadonlySet<string>;
  aoSelecionar: Props["aoSelecionar"];
  aoRecuperar: Props["aoRecuperar"];
  admin: boolean;
}) {
  const { resumo } = analise;
  const perdidas = analise.divergencias.find(
    (grupo) => grupo.tipo === "venda_perdida",
  );
  const naoRegistrados = analise.divergencias.find(
    (grupo) => grupo.tipo === "pagamento_nao_registrado",
  );
  const comCasos = analise.divergencias.filter((grupo) => grupo.quantidade > 0);
  const semCasos = analise.divergencias.filter(
    (grupo) => grupo.quantidade === 0,
  );

  let manchete: ReactNode;
  if (!analise.codigo.confere) {
    manchete = (
      <Aviso
        tom="perigo"
        anuncio="nenhum"
        titulo="A coluna escolhida como código do pedido não parece ser o código da Rifei"
      >
        <p>
          Só {analise.codigo.encontrados.toLocaleString("pt-BR")} de{" "}
          {plural(
            analise.codigo.pagos_no_arquivo,
            "pedido pago",
            "pedidos pagos",
          )}{" "}
          do arquivo existem no sistema. Por segurança, nada pode ser
          recuperado: em “Colunas do arquivo”, troque o{" "}
          <strong>Código do pedido</strong> pela coluna certa e confira de novo.
        </p>
        <p>
          Se a coluna está certa e o webhook parou, exporte um período que
          inclua dias com vendas já no sistema.
        </p>
      </Aviso>
    );
  } else if (resumo.com_divergencia === 0 && resumo.pedidos_no_arquivo > 0) {
    manchete = (
      <Aviso tom="sucesso" anuncio="nenhum" titulo="Tudo confere">
        <p>
          Os pedidos pagos do arquivo estão no sistema, com os mesmos valores.
        </p>
      </Aviso>
    );
  } else if (perdidas && perdidas.quantidade > 0) {
    manchete = (
      <Aviso
        tom="perigo"
        anuncio="nenhum"
        titulo={`${plural(perdidas.quantidade, "venda paga", "vendas pagas")} na Rifei ${perdidas.quantidade === 1 ? "não está" : "não estão"} no sistema`}
      >
        <p>
          {perdidas.quantidade === 1 ? "Ela não conta" : "Elas não contam"} no
          painel nem no ranking. Veja em “Vendas perdidas” e recupere.
        </p>
      </Aviso>
    );
  } else if (naoRegistrados && naoRegistrados.quantidade > 0) {
    // RIFA-056: o "Pedido novo" chegou e o "Pedido pago" não (o Pix manual, ou o webhook fora do ar no meio).
    const um = naoRegistrados.quantidade === 1;
    manchete = (
      <Aviso
        tom="perigo"
        anuncio="nenhum"
        titulo={`${plural(naoRegistrados.quantidade, "pedido pago", "pedidos pagos")} na Rifei ${um ? "está pendente ou expirado" : "estão pendentes ou expirados"} no sistema`}
      >
        <p>
          {um ? "Ele não conta" : "Eles não contam"} no painel nem no ranking.
          Veja em “Pagamento não registrado”
          {admin ? " e registre o pagamento." : "."}
        </p>
      </Aviso>
    );
  } else if (resumo.com_divergencia > 0) {
    manchete = (
      <Aviso
        tom="alerta"
        anuncio="nenhum"
        titulo={`${plural(resumo.com_divergencia, "pedido", "pedidos")} com diferença`}
      >
        <p>Nenhuma venda paga faltou. Veja abaixo o que é cada caso.</p>
      </Aviso>
    );
  }

  return (
    <>
      {manchete}
      {/* A cara única dos números (RIFA-051, P3.5): o chip do ícone no tom, no tamanho normal (o "R$ 99.999,99"
          cabe no cartão, conferencia-css.test.ts). */}
      <div className="grade conferencia-totais">
        <Stat
          rotulo="Pagos no arquivo"
          ajuda={AJUDA.pagosNoArquivo}
          valor={textoDosTotais(resumo.aprovados_no_arquivo)}
          icone="documento"
          tom="marca"
        />
        <Stat
          rotulo="Pagos no sistema"
          ajuda={AJUDA.pagosNoSistema}
          valor={textoDosTotais(resumo.aprovados_no_sistema)}
          icone="pedidos"
          tom="marca"
        />
        <Stat
          rotulo="Conferem"
          ajuda={AJUDA.conferem}
          valor={plural(resumo.conferem, "pedido", "pedidos")}
          icone="check"
          tom="sucesso"
        />
        <Stat
          rotulo="Com diferença"
          ajuda={AJUDA.comDiferenca}
          valor={plural(resumo.com_divergencia, "pedido", "pedidos")}
          icone={resumo.com_divergencia > 0 ? "alerta" : "check"}
          tom={resumo.com_divergencia > 0 ? "alerta" : "neutro"}
        />
      </div>
      {resumo.ausentes_fora_do_periodo > 0 && (
        <p className="conferencia-suave">
          {resumo.ausentes_fora_do_periodo === 1
            ? "1 pedido pago no sistema é de um dia que o arquivo não cobre: ele aparece em “Só no sistema”, mas não conta como diferença."
            : `${plural(resumo.ausentes_fora_do_periodo, "pedido pago", "pedidos pagos")} no sistema são de dias que o arquivo não cobre: eles aparecem em “Só no sistema”, mas não contam como diferença.`}
        </p>
      )}
      {/* A trava do código já está no aviso do topo. */}
      <Avisos
        avisos={avisos.filter((item) => item.codigo !== "codigo_nao_confere")}
      />
      {comCasos.map((grupo) => (
        <Grupo
          key={grupo.tipo}
          grupo={grupo}
          codigoConfere={analise.codigo.confere}
          selecionados={selecionados}
          aoSelecionar={aoSelecionar}
          aoRecuperar={aoRecuperar}
          admin={admin}
        />
      ))}
      {semCasos.length > 0 && (
        <p className="conferencia-suave">
          Sem nenhum caso:{" "}
          {semCasos.map((grupo) => DIVERGENCIAS[grupo.tipo].titulo).join(", ")}.
        </p>
      )}
      {analise.desconsiderados && analise.desconsiderados.quantidade > 0 && (
        <GrupoDesconsiderados grupo={analise.desconsiderados} />
      )}
    </>
  );
}

/**
 * Os pedidos do arquivo que o sistema tem desconsiderados (D20): num grupo à parte, depois das diferenças. Eles
 * existem no sistema e, de propósito, não contam: nunca aparecem como "faltando" nem como diferença.
 */
function GrupoDesconsiderados({
  grupo,
}: {
  grupo: NonNullable<RespostaAnalisePorPedido["desconsiderados"]>;
}) {
  const id = useId();
  return (
    <section className="conferencia-grupo" aria-labelledby={id}>
      <div className="conferencia-grupo__cabecalho">
        <SubtituloComAjuda id={id} texto={DESCONSIDERADOS.explicacao}>
          {DESCONSIDERADOS.titulo}
        </SubtituloComAjuda>
        <Badge tom="neutro">
          {plural(grupo.quantidade, "pedido", "pedidos")}
        </Badge>
      </div>
      <p>{DESCONSIDERADOS.explicacao}</p>
      <DataTable
        colunas={COLUNAS_DESCONSIDERADO}
        linhas={grupo.itens}
        chaveDaLinha={(item) => item.pedido_id}
        legenda={DESCONSIDERADOS.titulo}
      />
      {grupo.itens_omitidos > 0 && (
        <p className="conferencia-suave">
          Mostrando os primeiros {grupo.itens.length.toLocaleString("pt-BR")} de{" "}
          {plural(grupo.quantidade, "pedido", "pedidos")}.
        </p>
      )}
    </section>
  );
}

const COLUNAS_DESCONSIDERADO: ColunaTabela<PedidoDesconsideradoNaConferencia>[] =
  [
    {
      chave: "pedido",
      titulo: "Pedido",
      principal: true,
      celula: (item) => (
        <span className="conferencia-codigo">Pedido {item.pedido_id}</span>
      ),
    },
    {
      chave: "arquivo",
      titulo: "Na Rifei (arquivo)",
      celula: (item) => textoDoArquivo(item.arquivo),
    },
    {
      chave: "sistema",
      titulo: "No sistema",
      celula: (item) => textoDoSistema(item.sistema),
    },
    {
      chave: "desconsiderado",
      titulo: "Desconsiderado",
      celula: ({ desconsiderado }) =>
        `Desconsiderado (${MOTIVO_DESCONSIDERACAO[desconsiderado.motivo]}) em ${formatarDataHora(desconsiderado.em)}${
          desconsiderado.observacao
            ? `. Observação: ${desconsiderado.observacao}`
            : ""
        }.`,
    },
  ];

function totaisDoGrupo(grupo: GrupoDivergencia): string {
  // O lado do arquivo traz `sem_quantidade` e `sem_valor`: "R$ 120,00 (+1 sem valor)".
  const lado = (
    soma: GrupoDivergencia["arquivo"] | GrupoDivergencia["sistema"],
  ) => textoDosTotais({ pedidos_aprovados: null, ...soma });
  if (grupo.tipo === "venda_perdida")
    return `Na Rifei: ${lado(grupo.arquivo)}.`;
  if (grupo.tipo === "ausente_no_arquivo")
    return `No sistema: ${lado(grupo.sistema)}.`;
  return `Na Rifei: ${lado(grupo.arquivo)}. No sistema: ${lado(grupo.sistema)}.`;
}

function Grupo({
  grupo,
  codigoConfere,
  selecionados,
  aoSelecionar,
  aoRecuperar,
  admin,
}: {
  grupo: GrupoDivergencia;
  codigoConfere: boolean;
  selecionados: ReadonlySet<string>;
  aoSelecionar: Props["aoSelecionar"];
  aoRecuperar: Props["aoRecuperar"];
  admin: boolean;
}) {
  const id = useId();
  const textos = DIVERGENCIAS[grupo.tipo];
  // A venda perdida se recupera (admin e coordenação); o pagamento não registrado, só o admin marca como pago.
  const selecao: TipoRecuperacao | null =
    grupo.tipo === "venda_perdida" ||
    (grupo.tipo === "pagamento_nao_registrado" && admin)
      ? grupo.tipo
      : null;
  return (
    <section className="conferencia-grupo" aria-labelledby={id}>
      <div className="conferencia-grupo__cabecalho">
        <SubtituloComAjuda id={id} texto={textos.explicacao}>
          {textos.titulo}
        </SubtituloComAjuda>
        <Badge tom={textos.tom}>
          {plural(grupo.quantidade, "pedido", "pedidos")}
        </Badge>
      </div>
      <p>{textos.explicacao}</p>
      {grupo.tipo === "pagamento_nao_registrado" && (
        <p>{admin ? PAGAMENTOS.comoFunciona : PAGAMENTOS.soAdmin}</p>
      )}
      <p className="conferencia-suave">{totaisDoGrupo(grupo)}</p>
      {selecao !== null ? (
        <Selecao
          tipo={selecao}
          itens={grupo.itens}
          codigoConfere={codigoConfere}
          selecionados={selecionados}
          aoSelecionar={aoSelecionar}
          aoRecuperar={() => aoRecuperar(selecao)}
        />
      ) : (
        <DataTable
          colunas={COLUNAS_DIVERGENCIA}
          linhas={grupo.itens}
          chaveDaLinha={(item) => item.pedido_id}
          legenda={textos.titulo}
        />
      )}
      {grupo.itens_omitidos > 0 && (
        <p className="conferencia-suave">
          Mostrando os primeiros {grupo.itens.length.toLocaleString("pt-BR")} de{" "}
          {plural(grupo.quantidade, "pedido", "pedidos")}.
        </p>
      )}
    </section>
  );
}

const COLUNAS_DIVERGENCIA: ColunaTabela<Divergencia>[] = [
  {
    chave: "pedido",
    titulo: "Pedido",
    principal: true,
    celula: (item) => (
      <span className="conferencia-codigo">Pedido {item.pedido_id}</span>
    ),
  },
  {
    chave: "arquivo",
    titulo: "Na Rifei (arquivo)",
    celula: (item) =>
      item.arquivo ? textoDoArquivo(item.arquivo) : "Não está no arquivo",
  },
  {
    chave: "sistema",
    titulo: "No sistema",
    celula: (item) =>
      item.sistema ? textoDoSistema(item.sistema) : "Não está no sistema",
  },
  {
    chave: "observacao",
    titulo: "Observação",
    celula: (item) =>
      item.observacoes.length === 0
        ? "—"
        : item.observacoes.map((codigo) => OBSERVACOES[codigo]).join(" "),
  },
];

/** Os textos da seleção de cada grupo que se grava: a venda perdida (Recuperar) e o pagamento não registrado. */
type TextosDaSelecao = {
  legenda: string;
  marcarTodas: string;
  desmarcarTodas: string;
  dicaMarcarTodas: string;
  dicaDesmarcarTodas: string;
  dicaItem: string;
  dicaItemIndisponivel: string;
  /** O botão que abre a confirmação, com quantos estão marcados (0 = nenhum). */
  botao: (marcados: number) => string;
  dicaBotao: string;
  /** A frase acima do botão: por que está indisponível, ou o que acontece. */
  travado: string;
  nenhum: string;
  nadaMarcado: string;
  demais: string;
  pronto: string;
};

const LIMITE = LIMITE_PEDIDOS_RECUPERAR.toLocaleString("pt-BR");

const SELECAO: Record<TipoRecuperacao, TextosDaSelecao> = {
  venda_perdida: {
    legenda: "Vendas perdidas para recuperar",
    marcarTodas: "Marcar todas",
    desmarcarTodas: "Desmarcar todas",
    dicaMarcarTodas: DICAS.marcarTodas,
    dicaDesmarcarTodas: DICAS.desmarcarTodas,
    dicaItem: DICAS.vendaRecuperavel,
    dicaItemIndisponivel: DICAS.vendaNaoRecuperavel,
    botao: (marcados) =>
      marcados === 0
        ? "Recuperar"
        : `Recuperar ${plural(marcados, "venda", "vendas")}`,
    dicaBotao: DICAS.recuperar,
    travado:
      "Nada pode ser recuperado enquanto a coluna do código do pedido não conferir com o sistema.",
    nenhum:
      "Nenhuma destas vendas pode ser recuperada agora: veja o motivo em cada uma.",
    nadaMarcado: "Marque as vendas que quer recuperar.",
    demais: `Recupere até ${LIMITE} por vez.`,
    pronto:
      "Antes de gravar, o sistema mostra o que vai entrar. Pedido que já está no sistema nunca é mudado.",
  },
  pagamento_nao_registrado: {
    legenda: "Pedidos para marcar como pagos",
    marcarTodas: "Marcar todos",
    desmarcarTodas: "Desmarcar todos",
    dicaMarcarTodas: DICAS.marcarTodosPagamentos,
    dicaDesmarcarTodas: DICAS.desmarcarTodosPagamentos,
    dicaItem: DICAS.pagamentoRecuperavel,
    dicaItemIndisponivel: DICAS.pagamentoNaoRecuperavel,
    botao: (marcados) =>
      marcados === 0
        ? "Registrar pagamento"
        : `Registrar ${plural(marcados, "pagamento", "pagamentos")}`,
    dicaBotao: DICAS.registrarPagamentos,
    travado:
      "Nada pode ser marcado como pago enquanto a coluna do código do pedido não conferir com o sistema.",
    nenhum:
      "Nenhum destes pedidos pode ser marcado como pago agora: veja o motivo em cada um.",
    nadaMarcado: "Marque os pedidos que quer marcar como pagos.",
    demais: `Registre até ${LIMITE} por vez.`,
    pronto:
      "Antes de gravar, o sistema mostra o que vai mudar. Só o pedido pendente ou expirado muda; o que já está pago fica como está.",
  },
};

function Selecao({
  tipo,
  itens,
  codigoConfere,
  selecionados,
  aoSelecionar,
  aoRecuperar,
}: {
  tipo: TipoRecuperacao;
  itens: readonly Divergencia[];
  codigoConfere: boolean;
  selecionados: ReadonlySet<string>;
  aoSelecionar: Props["aoSelecionar"];
  aoRecuperar: () => void;
}) {
  const idDica = useId();
  const textos = SELECAO[tipo];
  const recuperaveis = itens
    .filter((item) => item.recuperavel)
    .map((item) => item.pedido_id);
  const marcadas = recuperaveis.filter((codigo) => selecionados.has(codigo));
  const demais = marcadas.length > LIMITE_PEDIDOS_RECUPERAR;
  // Nada marcado ou demais: o botão fica indisponível com aria-disabled (RIFA-045), no Tab e com a dica; a frase
  // acima dele diz por quê e o clique é barrado aqui. As caixas que não dá para marcar podem ficar disabled: o motivo
  // já está escrito na tela.
  const indisponivel = marcadas.length === 0 || demais;

  let dica: string;
  if (!codigoConfere) dica = textos.travado;
  else if (recuperaveis.length === 0) dica = textos.nenhum;
  else if (marcadas.length === 0) dica = textos.nadaMarcado;
  else if (demais) dica = textos.demais;
  else dica = textos.pronto;

  return (
    <fieldset className="conferencia-perdidas">
      <legend className="visualmente-oculto">{textos.legenda}</legend>
      {recuperaveis.length > 1 && (
        <div className="conferencia-acoes">
          <ComDica texto={textos.dicaMarcarTodas}>
            <Button
              variante="discreto"
              tamanho="pequeno"
              onClick={() => aoSelecionar(recuperaveis, true)}
            >
              {textos.marcarTodas}
            </Button>
          </ComDica>
          <ComDica texto={textos.dicaDesmarcarTodas}>
            <Button
              variante="discreto"
              tamanho="pequeno"
              onClick={() => aoSelecionar(recuperaveis, false)}
            >
              {textos.desmarcarTodas}
            </Button>
          </ComDica>
        </div>
      )}
      <ul className="conferencia-lista">
        {itens.map((item, indice) => (
          <li key={item.pedido_id}>
            {/* A dica fica na linha toda (caixa e textos); a caixa a tem no fim da descrição (`id` da dica). */}
            <ComDica
              id={`${idDica}-${indice}`}
              texto={
                item.recuperavel ? textos.dicaItem : textos.dicaItemIndisponivel
              }
            >
              <label
                className="conferencia-escolha"
                // A escolha de um pedido da lista, não um rótulo de campo (RIFA-066): a ajuda fica no título do grupo.
                data-sem-ajuda="escolha de um pedido"
                data-desabilitado={item.recuperavel ? undefined : ""}
              >
                <input
                  type="checkbox"
                  className="conferencia-escolha__caixa"
                  checked={item.recuperavel && selecionados.has(item.pedido_id)}
                  disabled={!item.recuperavel}
                  aria-describedby={`${idDica}-${indice}`}
                  onChange={(evento) =>
                    aoSelecionar([item.pedido_id], evento.currentTarget.checked)
                  }
                />
                <span className="conferencia-escolha__textos">
                  <span className="conferencia-codigo">
                    Pedido {item.pedido_id}
                  </span>
                  {tipo === "venda_perdida" ? (
                    item.arquivo && <span>{textoDoArquivo(item.arquivo)}</span>
                  ) : (
                    <>
                      {item.arquivo && (
                        <span>Na Rifei: {textoDoArquivo(item.arquivo)}</span>
                      )}
                      {item.sistema && (
                        <span>No sistema: {textoDoSistema(item.sistema)}</span>
                      )}
                    </>
                  )}
                  {item.observacoes.map((codigo) => (
                    <span
                      key={codigo}
                      className="conferencia-escolha__observacao"
                    >
                      {OBSERVACOES[codigo]}
                    </span>
                  ))}
                </span>
              </label>
            </ComDica>
          </li>
        ))}
      </ul>
      <p id={idDica} className="conferencia-suave">
        {dica}
      </p>
      <div className="conferencia-acoes">
        <ComDica
          texto={indisponivel ? DICAS.recuperarIndisponivel : textos.dicaBotao}
        >
          <Button
            aria-disabled={indisponivel || undefined}
            aria-describedby={idDica}
            onClick={() => {
              if (!indisponivel) aoRecuperar();
            }}
          >
            {textos.botao(marcadas.length)}
          </Button>
        </ComDica>
      </div>
    </fieldset>
  );
}

// ---------------------------------------------------------------------------------------------------
// Pelos totais
// ---------------------------------------------------------------------------------------------------

type LinhaAfiliado = NonNullable<
  RespostaAnaliseAgregada["por_afiliado"]
>[number];
type LinhaDia = NonNullable<RespostaAnaliseAgregada["por_dia"]>[number];

function situacao(confere: boolean) {
  return confere ? (
    <Badge tom="sucesso">Confere</Badge>
  ) : (
    <Badge tom="alerta">Diferente</Badge>
  );
}

const COLUNAS_AFILIADO: ColunaTabela<LinhaAfiliado>[] = [
  {
    chave: "afiliado",
    titulo: "Afiliado",
    principal: true,
    celula: (linha) =>
      linha.afiliado === "nao_reconhecido"
        ? "Afiliado não reconhecido"
        : comMaiuscula(
            textoDoAfiliado("gravado", linha.affiliate_id, linha.celula),
          ),
  },
  {
    chave: "arquivo",
    titulo: "Na Rifei (arquivo)",
    celula: (linha) => textoDosTotais(linha.arquivo),
  },
  {
    chave: "sistema",
    titulo: "No sistema",
    celula: (linha) => textoDosTotais(linha.sistema),
  },
  {
    chave: "situacao",
    titulo: "Situação",
    celula: (linha) => situacao(linha.confere),
  },
];

const COLUNAS_DIA: ColunaTabela<LinhaDia>[] = [
  {
    chave: "dia",
    titulo: "Dia",
    principal: true,
    celula: (linha) => formatarData(linha.data),
  },
  {
    chave: "arquivo",
    titulo: "Na Rifei (arquivo)",
    celula: (linha) => textoDosTotais(linha.arquivo),
  },
  {
    chave: "sistema",
    titulo: "No sistema",
    celula: (linha) => textoDosTotais(linha.sistema),
  },
  {
    chave: "situacao",
    titulo: "Situação",
    celula: (linha) => situacao(linha.confere),
  },
];

function Agregado({
  analise,
  avisos,
}: {
  analise: RespostaAnaliseAgregada;
  avisos: readonly AvisoReconciliacao[];
}) {
  const { total } = analise;
  return (
    <>
      {total.confere ? (
        <Aviso tom="sucesso" anuncio="nenhum" titulo="Os totais conferem">
          <p>
            Sem o código do pedido, a conferência compara só os totais. Para ver
            cada pedido, exporte de novo com o código.
          </p>
        </Aviso>
      ) : (
        <Aviso tom="alerta" anuncio="nenhum" titulo="Os totais não batem">
          <p>
            Sem o código do pedido, não dá para saber quais vendas faltam nem
            recuperá-las. Exporte de novo da Rifei com o código do pedido.
          </p>
        </Aviso>
      )}
      <div className="grade conferencia-totais">
        <Stat
          rotulo="Pagos no arquivo"
          ajuda={AJUDA.pagosNoArquivo}
          valor={textoDosTotais(total.arquivo)}
          icone="documento"
          tom="marca"
        />
        <Stat
          rotulo="Pagos no sistema"
          ajuda={AJUDA.pagosNoSistema}
          valor={textoDosTotais(total.sistema)}
          icone="pedidos"
          tom="marca"
        />
      </div>
      {analise.recorte && (
        <p className="conferencia-suave">
          O sistema conta só as vendas de{" "}
          {formatarData(analise.recorte.data_inicio)} a{" "}
          {formatarData(analise.recorte.data_fim)}, os dias do arquivo.
        </p>
      )}
      <Avisos avisos={avisos} />
      {analise.por_afiliado && (
        <section className="conferencia-grupo">
          <SubtituloComAjuda texto={AJUDA.porAfiliado}>
            Por afiliado
          </SubtituloComAjuda>
          <DataTable
            colunas={COLUNAS_AFILIADO}
            linhas={analise.por_afiliado}
            chaveDaLinha={(linha) =>
              `${linha.afiliado}-${linha.affiliate_id ?? ""}`
            }
            legenda="Totais por afiliado"
          />
        </section>
      )}
      {analise.por_dia && (
        <section className="conferencia-grupo">
          <SubtituloComAjuda texto={AJUDA.porDia}>Por dia</SubtituloComAjuda>
          <DataTable
            colunas={COLUNAS_DIA}
            linhas={analise.por_dia}
            chaveDaLinha={(linha) => linha.data}
            legenda="Totais por dia"
          />
        </section>
      )}
    </>
  );
}

/** Subtítulo (h3) de um grupo do resultado, com a ajuda (RIFA-066). */
function SubtituloComAjuda({
  id: idDeFora,
  texto,
  children,
}: {
  id?: string;
  texto: string;
  children: ReactNode;
}) {
  const idAutomatico = useId();
  const id = idDeFora ?? idAutomatico;
  return (
    <ComAjuda texto={texto} idDoTitulo={id}>
      <h3 id={id} className="conferencia-subtitulo">
        {children}
      </h3>
    </ComAjuda>
  );
}
