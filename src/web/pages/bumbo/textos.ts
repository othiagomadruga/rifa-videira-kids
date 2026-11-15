// Textos e datas da tela do bumbo (sem React): os dias do seletor, a referência da mensagem, o link do
// WhatsApp e os avisos de cada fase. Datas pelos formatadores (fuso de Belém) e só datas do calendário
// ("YYYY-MM-DD"), que se comparam como texto. Nada de valores em dinheiro: a mensagem já vem pronta.
import type {
  ReferenciaCampanha,
  RespostaBumbo,
} from "../../../shared/contracts/calculos";
import {
  FUSO_HORARIO,
  LOCALIDADE,
  formatarData,
  paraData,
} from "../../lib/formatadores";
import { DIAS_DEPOIS_DO_FIM } from "./bumbo-api";

const MS_POR_DIA = 86_400_000;

/** "2026-11-30" + 1 → "2026-12-01" (data do calendário, sem fuso). */
export function somarDias(data: string, dias: number): string {
  const [ano, mes, dia] = data.split("-").map(Number);
  return new Date(Date.UTC(ano, mes - 1, dia) + dias * MS_POR_DIA)
    .toISOString()
    .slice(0, 10);
}

/** Dias de `de` até `ate` (negativo se `ate` vem antes). */
export function diasEntre(de: string, ate: string): number {
  return Math.round(
    (Date.parse(`${ate}T00:00:00Z`) - Date.parse(`${de}T00:00:00Z`)) /
      MS_POR_DIA,
  );
}

/** O que a tela sabe da campanha pelas respostas: 1º e último dia de vendas e o "hoje" do servidor. */
export type DatasDaCampanha = { inicio: string; fim: string; hoje: string };

/** Último dia que a API aceita no `data`: o dia seguinte ao último dia de vendas. */
export const ultimoDiaDoBumbo = (fim: string) =>
  somarDias(fim, DIAS_DEPOIS_DO_FIM);

const formatoDiaDaSemana = new Intl.DateTimeFormat(LOCALIDADE, {
  weekday: "long",
  timeZone: FUSO_HORARIO,
});

/** "2026-12-01" → "Terça"; sábado e domingo ficam como são ("Sábado"). */
export function diaDaSemana(data: string): string {
  const nome = formatoDiaDaSemana.format(paraData(data)).replace(/-feira$/, "");
  return nome.charAt(0).toUpperCase() + nome.slice(1);
}

/** "2026-12-01" → "01/12". */
export const diaEMes = (data: string) => formatarData(data).slice(0, 5);

/** O dia na campanha: "dia 9", "dia seguinte ao fim", "antes do início" ou "campanha encerrada". */
function diaNaCampanha(data: string, { inicio, fim }: DatasDaCampanha): string {
  if (data < inicio) return "antes do início";
  if (data <= fim) return `dia ${diasEntre(inicio, data) + 1}`;
  if (data === somarDias(fim, 1)) return "dia seguinte ao fim";
  return "campanha encerrada";
}

/** Rótulo de um dia no seletor: "Terça, 01/12 (hoje) · dia 9", "Segunda, 30/11 (ontem) · dia 8". */
export function rotuloDoDia(data: string, datas: DatasDaCampanha): string {
  const quando =
    data === datas.hoje
      ? " (hoje)"
      : data === somarDias(datas.hoje, -1)
        ? " (ontem)"
        : "";
  return `${diaDaSemana(data)}, ${diaEMes(data)}${quando} · ${diaNaCampanha(data, datas)}`;
}

/** Um dia do seletor. `valor` vazio é hoje: a consulta vai sem `data`. */
export type OpcaoDoDia = { valor: string; data: string; rotulo: string };

/**
 * Os dias que o seletor oferece: hoje (o padrão) e, do mais recente ao 1º dia, os da janela que a API
 * aceita (do 1º dia da campanha ao dia seguinte ao último, nunca depois de hoje). Antes do início, só
 * hoje; depois do fim, hoje e a janela inteira.
 */
export function opcoesDoSeletor(datas: DatasDaCampanha): OpcaoDoDia[] {
  const { inicio, fim, hoje } = datas;
  const opcoes: OpcaoDoDia[] = [
    { valor: "", data: hoje, rotulo: rotuloDoDia(hoje, datas) },
  ];
  const ultimo = ultimoDiaDoBumbo(fim);
  const maisRecente = hoje < ultimo ? hoje : ultimo;
  for (let data = maisRecente; data >= inicio; data = somarDias(data, -1)) {
    if (data !== hoje)
      opcoes.push({ valor: data, data, rotulo: rotuloDoDia(data, datas) });
  }
  return opcoes;
}

/** A referência da mensagem: a data ("Terça, 01/12/2026 (hoje)") e onde a campanha estava nela. */
export function textoDaReferencia(
  referencia: ReferenciaCampanha,
  hoje: string | null,
): { data: string; fase: string } {
  const data = `${diaDaSemana(referencia.data)}, ${formatarData(referencia.data)}${
    referencia.data === hoje ? " (hoje)" : ""
  }`;
  if (referencia.fase === "antes") {
    const faltam = referencia.dias_para_inicio ?? 1;
    return {
      data,
      fase:
        faltam === 1
          ? "A campanha começa amanhã"
          : `Faltam ${faltam} dias para começar`,
    };
  }
  if (referencia.fase === "encerrada")
    return { data, fase: "Campanha encerrada" };
  return {
    data,
    fase: `Dia ${referencia.dia_campanha ?? 1} de ${referencia.duracao_dias}`,
  };
}

/** wa.me sem número: o WhatsApp abre com a mensagem pronta e a pessoa escolhe o grupo. */
export function linkWhatsApp(texto: string): string {
  return `https://wa.me/?text=${encodeURIComponent(texto)}`;
}

/**
 * O texto tem a parte do ranking e ninguém nela: cada divisão diz "ainda sem vendas" e nenhuma linha
 * traz uma posição ("1º Célula ..."). É como o montador do contrato escreve (montarBumbo, em
 * calculos.ts); o teste da tela confere com o texto que ele monta.
 */
export function rankingSemVendas(texto: string): boolean {
  const linhas = texto.split("\n").map((linha) => linha.trim());
  return (
    linhas.some((linha) => /ainda sem vendas\.$/i.test(linha)) &&
    !linhas.some((linha) => /^\d+º\s/.test(linha))
  );
}

export type AvisoDaMensagem = { titulo: string; texto: string };

/** O que explicar ao lado da mensagem, conforme a fase e o que ela traz (ou nada). */
export function avisoDaMensagem({
  referencia,
  texto,
}: RespostaBumbo): AvisoDaMensagem | null {
  if (referencia.fase === "antes")
    return {
      titulo: `A campanha começa em ${formatarData(referencia.data_inicio)}.`,
      texto:
        "Até lá, a mensagem é a contagem regressiva. A partir do 1º dia, dá para escolher aqui a mensagem de outro dia.",
    };
  if (referencia.fase === "durante" && referencia.dia_campanha === 1)
    return {
      titulo: "1º dia de vendas: a mensagem é a da largada.",
      texto:
        "A partir de amanhã, ela traz a venda do dia anterior, o acumulado e o ranking.",
    };
  if (rankingSemVendas(texto))
    return {
      titulo: "Ainda sem vendas no ranking.",
      texto:
        "Nenhuma célula vendeu no período até o dia anterior: a mensagem sai sem as posições.",
    };
  return null;
}

// ---------------------------------------------------------------------------------------------------
// Dicas (RIFA-045): a explicação que aparece com o mouse parado (ou o foco do teclado) em cada botão e campo da
// tela. Dizem para que serve e o que acontece, sem repetir o rótulo.
// ---------------------------------------------------------------------------------------------------

/**
 * A nota embaixo da prévia (RIFA-053): a prévia já mostra o negrito e o itálico desenhados, então a nota não fala mais
 * de *asteriscos* e _sublinhados_, que não aparecem nela.
 */
export const NOTA_DA_PREVIA =
  "A prévia mostra a mensagem como ela chega no grupo: o negrito e o itálico aparecem como no WhatsApp.";
/** A nota de antes, só quando a cópia falha e a prévia vira o texto puro (aí os * e _ aparecem). */
export const NOTA_DO_TEXTO_PURO =
  "No WhatsApp, o que está entre *asteriscos* sai em negrito, e entre _sublinhados_, em itálico.";

export const DICAS = {
  dia: "Mostra a mensagem de outro dia da campanha, para conferir ou mandar de novo. Hoje vem escolhido.",
  enviarNoWhatsApp:
    "Abre o WhatsApp com a mensagem já escrita. Lá você escolhe o grupo dos líderes e envia.",
  copiar:
    "Copia a mensagem para colar no grupo. Se o aparelho não deixar, ela fica selecionada para copiar à mão.",
  configurarCampanha:
    "Abre a tela Campanha, onde ela é configurada. Depois disso, a mensagem do dia aparece aqui.",
} as const;
