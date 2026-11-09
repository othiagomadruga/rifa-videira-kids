import { useId, type ReactNode, type RefObject } from "react";
import type {
  AvisoReconciliacao,
  Divergencia,
  GrupoDivergencia,
  RespostaAnaliseAgregada,
  RespostaAnalisePorPedido,
  RespostaAnaliseReconciliacao,
} from "../../../shared/contracts";
import {
  Aviso,
  Badge,
  Button,
  Card,
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
import { DIVERGENCIAS, OBSERVACOES, plural, tomDoAviso } from "./textos";

type Props = {
  analise: RespostaAnaliseReconciliacao;
  /** Os avisos da leitura do arquivo (na tela) e os da comparação (da API), juntos. */
  avisos: readonly AvisoReconciliacao[];
  /** Vendas perdidas marcadas para recuperar. */
  selecionados: ReadonlySet<string>;
  aoSelecionar: (codigos: string[], marcado: boolean) => void;
  aoRecuperar: () => void;
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
  refTitulo,
  aviso,
}: Props) {
  return (
    <Card
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
      <h3 className="conferencia-subtitulo">Avisos sobre o arquivo</h3>
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
}: {
  analise: RespostaAnalisePorPedido;
  avisos: readonly AvisoReconciliacao[];
  selecionados: ReadonlySet<string>;
  aoSelecionar: Props["aoSelecionar"];
  aoRecuperar: () => void;
}) {
  const { resumo } = analise;
  const perdidas = analise.divergencias.find(
    (grupo) => grupo.tipo === "venda_perdida",
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
      <div className="grade conferencia-totais">
        <Stat
          rotulo="Pagos no arquivo"
          valor={textoDosTotais(resumo.aprovados_no_arquivo)}
        />
        <Stat
          rotulo="Pagos no sistema"
          valor={textoDosTotais(resumo.aprovados_no_sistema)}
        />
        <Stat
          rotulo="Conferem"
          valor={plural(resumo.conferem, "pedido", "pedidos")}
        />
        <Stat
          rotulo="Com diferença"
          valor={plural(resumo.com_divergencia, "pedido", "pedidos")}
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
        />
      ))}
      {semCasos.length > 0 && (
        <p className="conferencia-suave">
          Sem nenhum caso:{" "}
          {semCasos.map((grupo) => DIVERGENCIAS[grupo.tipo].titulo).join(", ")}.
        </p>
      )}
    </>
  );
}

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
}: {
  grupo: GrupoDivergencia;
  codigoConfere: boolean;
  selecionados: ReadonlySet<string>;
  aoSelecionar: Props["aoSelecionar"];
  aoRecuperar: () => void;
}) {
  const id = useId();
  const textos = DIVERGENCIAS[grupo.tipo];
  return (
    <section className="conferencia-grupo" aria-labelledby={id}>
      <div className="conferencia-grupo__cabecalho">
        <h3 id={id} className="conferencia-subtitulo">
          {textos.titulo}
        </h3>
        <Badge tom={textos.tom}>
          {plural(grupo.quantidade, "pedido", "pedidos")}
        </Badge>
      </div>
      <p>{textos.explicacao}</p>
      <p className="conferencia-suave">{totaisDoGrupo(grupo)}</p>
      {grupo.tipo === "venda_perdida" ? (
        <VendasPerdidas
          itens={grupo.itens}
          codigoConfere={codigoConfere}
          selecionados={selecionados}
          aoSelecionar={aoSelecionar}
          aoRecuperar={aoRecuperar}
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

function VendasPerdidas({
  itens,
  codigoConfere,
  selecionados,
  aoSelecionar,
  aoRecuperar,
}: {
  itens: readonly Divergencia[];
  codigoConfere: boolean;
  selecionados: ReadonlySet<string>;
  aoSelecionar: Props["aoSelecionar"];
  aoRecuperar: () => void;
}) {
  const idDica = useId();
  const recuperaveis = itens
    .filter((item) => item.recuperavel)
    .map((item) => item.pedido_id);
  const marcadas = recuperaveis.filter((codigo) => selecionados.has(codigo));
  const demais = marcadas.length > LIMITE_PEDIDOS_RECUPERAR;

  let dica: string;
  if (!codigoConfere)
    dica =
      "Nada pode ser recuperado enquanto a coluna do código do pedido não conferir com o sistema.";
  else if (recuperaveis.length === 0)
    dica =
      "Nenhuma destas vendas pode ser recuperada agora: veja o motivo em cada uma.";
  else if (marcadas.length === 0) dica = "Marque as vendas que quer recuperar.";
  else if (demais)
    dica = `Recupere até ${LIMITE_PEDIDOS_RECUPERAR.toLocaleString("pt-BR")} por vez.`;
  else
    dica =
      "Antes de gravar, o sistema mostra o que vai entrar. Pedido que já está no sistema nunca é mudado.";

  return (
    <fieldset className="conferencia-perdidas">
      <legend className="visualmente-oculto">
        Vendas perdidas para recuperar
      </legend>
      {recuperaveis.length > 1 && (
        <div className="conferencia-acoes">
          <Button
            variante="discreto"
            tamanho="pequeno"
            onClick={() => aoSelecionar(recuperaveis, true)}
          >
            Marcar todas
          </Button>
          <Button
            variante="discreto"
            tamanho="pequeno"
            onClick={() => aoSelecionar(recuperaveis, false)}
          >
            Desmarcar todas
          </Button>
        </div>
      )}
      <ul className="conferencia-lista">
        {itens.map((item) => (
          <li key={item.pedido_id}>
            <label
              className="conferencia-escolha"
              data-desabilitado={item.recuperavel ? undefined : ""}
            >
              <input
                type="checkbox"
                className="conferencia-escolha__caixa"
                checked={item.recuperavel && selecionados.has(item.pedido_id)}
                disabled={!item.recuperavel}
                onChange={(evento) =>
                  aoSelecionar([item.pedido_id], evento.currentTarget.checked)
                }
              />
              <span className="conferencia-escolha__textos">
                <span className="conferencia-codigo">
                  Pedido {item.pedido_id}
                </span>
                {item.arquivo && <span>{textoDoArquivo(item.arquivo)}</span>}
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
          </li>
        ))}
      </ul>
      <p id={idDica} className="conferencia-suave">
        {dica}
      </p>
      <div className="conferencia-acoes">
        <Button
          disabled={marcadas.length === 0 || demais}
          aria-describedby={idDica}
          onClick={aoRecuperar}
        >
          {marcadas.length === 0
            ? "Recuperar"
            : `Recuperar ${plural(marcadas.length, "venda", "vendas")}`}
        </Button>
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
        <Stat rotulo="Pagos no arquivo" valor={textoDosTotais(total.arquivo)} />
        <Stat rotulo="Pagos no sistema" valor={textoDosTotais(total.sistema)} />
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
          <h3 className="conferencia-subtitulo">Por afiliado</h3>
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
          <h3 className="conferencia-subtitulo">Por dia</h3>
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
