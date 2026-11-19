// RIFA-030: o resumo "Regras da campanha", no topo da tela Campanha. Mostra, em linguagem simples, cada decisão
// do PO e o valor que está valendo (o da campanha salva), destaca o que falta preencher e leva ao campo.
import type { MouseEvent } from "react";
import {
  ACESSO_PADRAO,
  MENSAGENS_PADRAO,
  PEDIDOS_PADRAO,
  PUBLICO_PADRAO,
  RANKING_POR_DIVISAO_PADRAO,
  problemasDoModelo,
  type Campanha,
  type TipoMensagem,
} from "../../../shared/contracts";
import { Aviso, Badge, Card } from "../../components/ui";
import {
  formatarData,
  formatarMoeda,
  formatarNumero,
} from "../../lib/formatadores";
import { textoPercentual } from "./formulario";
import { mensagensVisiveis } from "./RegrasDoAdmin";
import { TEXTO_CRITERIO } from "./textos";

/** Uma linha do resumo: o nome da decisão, o valor (null = falta preencher) e o campo que a muda. */
export type ItemResumo = {
  nome: string;
  valor: string | null;
  /** O valor é o padrão, que vale enquanto a campanha não for salva. */
  padrao?: boolean;
  /** O id do campo que muda esta decisão. */
  campo: string;
};

type Ids = {
  idDoCampo: (chave: string) => string;
  /** O campo do percentual do 1º período (ou o botão do modelo, sem períodos no formulário). */
  idDosPercentuais: string;
};

/** "10, 7 e 7". */
function juntar(itens: readonly string[]): string {
  if (itens.length <= 1) return itens.join("");
  return `${itens.slice(0, -1).join(", ")} e ${itens.at(-1)}`;
}

function textoDosBilhetes(quantidade: number): string {
  return quantidade === 1
    ? "1 bilhete"
    : `${formatarNumero(quantidade)} bilhetes`;
}

function textoDaMeta(meta: Campanha["meta"]): string {
  const valor =
    meta.unidade === "centavos"
      ? formatarMoeda(meta.valor)
      : textoDosBilhetes(meta.valor);
  const unidade =
    meta.unidade === "centavos"
      ? "Em valor arrecadado"
      : "Em bilhetes vendidos";
  switch (meta.regra) {
    case "por_pessoa":
      return `${unidade}: ${valor} por pessoa da célula.`;
    case "total_proporcional":
      return `${unidade}: ${valor} no total, divididos entre as células pelo número de pessoas.`;
    case "fixa_por_celula":
      return `${unidade}: ${valor} para cada célula, de qualquer tamanho.`;
  }
}

function textoDoPublico(publico: Campanha["publico"]): string {
  const posicoes =
    publico.limite_ranking === null
      ? "Todas as posições do ranking"
      : publico.limite_ranking === 1
        ? "Só o 1º lugar do ranking"
        : `As ${formatarNumero(publico.limite_ranking)} primeiras posições do ranking`;
  return `${posicoes}, ${publico.mostra_percentual_meta ? "com" : "sem"} o percentual da meta. Nunca valores em R$.`;
}

/** As mensagens que a tela mostra (com uma rede só, sem a da rede: D30), editadas e com problema. */
function textoDasMensagens(
  mensagens: Campanha["mensagens"],
  tipos: readonly TipoMensagem[],
): string {
  const editadas = tipos.filter(
    (tipo) => mensagens[tipo] !== MENSAGENS_PADRAO[tipo],
  ).length;
  const comProblema = tipos.filter(
    (tipo) => problemasDoModelo(tipo, mensagens[tipo]).length > 0,
  ).length;
  const base =
    editadas === 0
      ? `As ${tipos.length} com o texto padrão.`
      : editadas === 1
        ? "1 editada; as outras com o texto padrão."
        : `${editadas} editadas${editadas < tipos.length ? "; as outras com o texto padrão" : ""}.`;
  return comProblema === 0
    ? base
    : `${base} ${comProblema === 1 ? "1 tem problema" : `${comProblema} têm problema`}: até corrigir, a tela Acessos usa o texto padrão.`;
}

/** As linhas do resumo, na ordem das decisões do PO. Com uma rede só (RIFA-065, D30), sem o acesso das redes. */
export function itensDoResumo(
  campanha: Campanha | null,
  { idDoCampo, idDosPercentuais }: Ids,
  redeUnica = false,
): ItemResumo[] {
  const pedidos = campanha?.pedidos ?? PEDIDOS_PADRAO;
  const acesso = campanha?.acesso ?? ACESSO_PADRAO;
  const padrao = campanha === null;
  return [
    {
      nome: "Datas e períodos",
      valor: campanha
        ? `${formatarData(campanha.data_inicio)} a ${formatarData(campanha.data_fim)}: ${formatarNumero(
            campanha.periodos.reduce((total, p) => total + p.dias, 0),
          )} dias em ${campanha.periodos.length === 1 ? "1 período" : `${campanha.periodos.length} períodos`} (${juntar(
            campanha.periodos.map((p) => String(p.dias)),
          )} dias).`
        : null,
      campo: idDoCampo("data_inicio"),
    },
    {
      nome: "Preço do bilhete",
      valor: campanha ? formatarMoeda(campanha.preco_bilhete_centavos) : null,
      campo: idDoCampo("preco_bilhete_centavos"),
    },
    {
      nome: "Meta",
      valor: campanha ? textoDaMeta(campanha.meta) : null,
      campo: idDoCampo(campanha ? "meta.valor" : "meta.unidade"),
    },
    {
      nome: "Percentuais dos períodos",
      valor: campanha
        ? `${juntar(
            campanha.periodos.map(
              (p) => `${p.nome}: ${textoPercentual(p.percentual_bp)}`,
            ),
          )}${
            campanha.soma_percentuais_bp === 10_000
              ? "."
              : ` (a soma dá ${textoPercentual(campanha.soma_percentuais_bp)}: o sistema divide cada um pela soma).`
          }`
        : null,
      campo: idDosPercentuais,
    },
    {
      nome: "Critério do ranking",
      valor: campanha
        ? `${TEXTO_CRITERIO[campanha.ranking.criterio].opcao}.`
        : null,
      campo: idDoCampo("ranking.criterio"),
    },
    {
      nome: "Ranking por divisão",
      valor:
        (campanha?.ranking.por_divisao ?? RANKING_POR_DIVISAO_PADRAO)
          ? "Separado: Jovens e Adultos disputam cada um o seu ranking."
          : "Um ranking só, com todas as células juntas.",
      padrao,
      campo: idDoCampo("ranking.por_divisao"),
    },
    {
      nome: "O que o público vê",
      valor: textoDoPublico(campanha?.publico ?? PUBLICO_PADRAO),
      padrao,
      campo: idDoCampo("publico.limite_ranking"),
    },
    {
      nome: "Desconsiderar pedidos",
      valor: pedidos.desconsiderar
        ? "Ligado: o admin pode tirar das contas um pedido de teste, fraude ou estorno."
        : "Desligado: ninguém desconsidera nem desfaz agora.",
      padrao,
      campo: idDoCampo("pedidos.desconsiderar"),
    },
    {
      nome: "Acesso de discipuladores",
      valor: acesso.discipuladores
        ? "Ligado: entram pelo link pessoal."
        : "Desligado: não entram nem recebem link novo.",
      padrao,
      campo: idDoCampo("acesso.discipuladores"),
    },
    ...(redeUnica
      ? []
      : [
          {
            nome: "Acesso de redes",
            valor: acesso.redes
              ? "Ligado: entram pelo link pessoal."
              : "Desligado: não entram nem recebem link novo.",
            padrao,
            campo: idDoCampo("acesso.redes"),
          },
        ]),
    {
      nome: "Login das células com senha",
      valor: acesso.celulas_senha
        ? "Ligado: cada célula entra com o nome e a senha padrão."
        : "Desligado: só pelo link pessoal.",
      padrao,
      campo: idDoCampo("acesso.celulas_senha"),
    },
    {
      nome: "Mensagens do link pessoal",
      valor: textoDasMensagens(
        campanha?.mensagens ?? MENSAGENS_PADRAO,
        mensagensVisiveis(redeUnica),
      ),
      padrao,
      campo: idDoCampo("mensagens.link_coordenacao"),
    },
  ];
}

function irAoCampo(evento: MouseEvent<HTMLAnchorElement>, id: string) {
  evento.preventDefault();
  document.getElementById(id)?.focus();
}

type Props = Ids & {
  /** A campanha salva (o que está valendo); null = ainda não configurada. */
  campanha: Campanha | null;
  /** Uma rede só (D30): sem a linha do acesso das redes. */
  redeUnica?: boolean;
};

export function ResumoRegras({ campanha, redeUnica = false, ...ids }: Props) {
  const itens = itensDoResumo(campanha, ids, redeUnica);
  const faltam = itens.filter((item) => item.valor === null);
  return (
    <Card titulo="Regras da campanha">
      <div className="campanha-regras">
        <p className="campanha-texto-suave">
          O que está valendo agora, em resumo. Toque no nome para ir ao campo e
          mudar.
        </p>
        {faltam.length > 0 && (
          <Aviso
            tom="alerta"
            anuncio="nenhum"
            titulo={
              faltam.length === 1
                ? "Falta preencher 1 item"
                : `Falta preencher ${faltam.length} itens`
            }
          >
            <p>
              {campanha === null
                ? "Ainda não há campanha: preencha e ative abaixo. Até lá, as vendas da Rifei não contam."
                : "Preencha e salve abaixo."}
            </p>
          </Aviso>
        )}
        <dl className="campanha-regras__lista">
          {itens.map((item) => (
            <div
              key={item.nome}
              className="campanha-regra"
              data-falta={item.valor === null ? "" : undefined}
            >
              <dt className="campanha-regra__nome">
                <a
                  href={`#${item.campo}`}
                  onClick={(evento) => irAoCampo(evento, item.campo)}
                >
                  {item.nome}
                </a>
              </dt>
              <dd className="campanha-regra__valor">
                {item.valor === null ? (
                  <Badge tom="alerta">Falta preencher</Badge>
                ) : (
                  <>
                    {item.valor}
                    {item.padrao && (
                      <span className="campanha-texto-suave"> (padrão)</span>
                    )}
                  </>
                )}
              </dd>
            </div>
          ))}
        </dl>
      </div>
    </Card>
  );
}
