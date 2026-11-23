/**
 * Leitura e envio do relatório diário por e-mail (RIFA-086 e RIFA-087, D40). Junta a leitura do painel (db/painel.ts,
 * com os grupos de db/grupos.ts no MESMO lote: duas idas ao D1), os números e o e-mail (lib/relatorio-diario.ts) e o
 * MIME (lib/email.ts), e envia pelo binding `EMAIL` (send_email da Cloudflare). Nada é perguntado à Efí nem à Rifei.
 *
 * - Dois tipos: `manha` (o e-mail das 7h) e `tarde` (a parcial das 17h). Dia de referência: o pedido (prévia e envio do
 *   admin) ou, sem ele, ONTEM no fuso da campanha na manhã (o dia anterior fechado) e HOJE na tarde (até a hora do
 *   envio, o "agora"). A tarde só vale para hoje (400 `parcial_so_de_hoje`). Fora da campanha, nada sai (400
 *   `fora_da_campanha` nas rotas, conferido ANTES do cálculo, para qualquer data que exista; só um log no cron).
 * - Um e-mail por destinatário (o segredo `RELATORIO_EMAILS`): ninguém vê o endereço do outro, e uma falha não derruba
 *   os demais. Os logs levam só contagens, nunca um endereço.
 * - Sem o binding `EMAIL` ou sem destinatário válido, o cron só avisa no log (não falha) e a rota do admin responde 503
 *   `nao_configurado`.
 */
import { EmailMessage } from "cloudflare:email";
import {
  REMETENTE_RELATORIO_DIARIO,
  hojeNoFuso,
  referenciaDaCampanha,
  somarDias,
  type DetalheValidacao,
  type TipoRelatorioDiario,
} from "../../shared/contracts";
import { comandosDosGrupos, gruposDoRanking } from "../db/grupos";
import { lerEntradaDoCalculo, type Relogio } from "../db/painel";
import { lerDestinatarios, montarMime } from "./email";
import {
  dadosDoRelatorioDiario,
  montarRelatorioDiario,
  type EnvioDoRelatorio,
} from "./relatorio-diario";

/** O e-mail do dia, pronto para enviar ou mostrar. */
export interface EmailDoDia {
  assunto: string;
  html: string;
  texto: string;
}

export type LeituraRelatorioDiario =
  | { ok: true; tipo: TipoRelatorioDiario; data: string; email: EmailDoDia }
  | {
      ok: false;
      codigo: "nao_encontrado" | "requisicao_invalida";
      mensagem: string;
      detalhes?: DetalheValidacao[];
    };

const FORA_DA_CAMPANHA: DetalheValidacao = {
  caminho: ["data"],
  codigo: "fora_da_campanha",
  mensagem:
    "O dia de referência fica fora das datas da campanha (o e-mail desse dia não sai)",
};

const PARCIAL_SO_DE_HOJE: DetalheValidacao = {
  caminho: ["data"],
  codigo: "parcial_so_de_hoje",
  mensagem: "A parcial da tarde é só do dia de hoje (até agora)",
};

const consultaInvalida = (
  detalhe: DetalheValidacao,
): LeituraRelatorioDiario => ({
  ok: false,
  codigo: "requisicao_invalida",
  mensagem: "Consulta inválida",
  detalhes: [detalhe],
});

/** O que pedir: o tipo (manha ou tarde) e, opcional, o dia de referência. */
export interface PedidoRelatorioDiario {
  tipo: TipoRelatorioDiario;
  data?: string;
}

/**
 * O e-mail do `tipo` de `data` (ausente = ontem na manhã; hoje na tarde, no fuso da campanha). Sem campanha ativa,
 * 404; `data` depois de hoje (a leitura do painel confere), fora da campanha ou, na tarde, outro dia que não hoje, 400.
 */
export async function lerRelatorioDiario(
  env: Cloudflare.Env,
  relogio: Relogio,
  { tipo, data }: PedidoRelatorioDiario,
): Promise<LeituraRelatorioDiario> {
  const lido = await lerEntradaDoCalculo(
    env.DB,
    relogio,
    data === undefined ? {} : { data },
    comandosDosGrupos,
  );
  if (!lido.ok) return lido;
  const { campanha } = lido.entrada;
  const hoje = hojeNoFuso(campanha.fuso_horario, lido.agora);
  const referencia = data ?? (tipo === "tarde" ? hoje : somarDias(hoje, -1));
  if (tipo === "tarde" && referencia !== hoje)
    return consultaInvalida(PARCIAL_SO_DE_HOJE);
  // Fora da campanha, antes do cálculo: só aritmética de calendário, que vale para qualquer data que exista (uma data
  // absurda, como 0001-01-01, quebraria o fuso dos montadores e viraria 500).
  if (referenciaDaCampanha(campanha, referencia).fase !== "durante")
    return consultaInvalida(FORA_DA_CAMPANHA);
  const envio: EnvioDoRelatorio =
    tipo === "tarde" ? { tipo, ate: lido.agora } : { tipo };
  const dados = dadosDoRelatorioDiario(
    lido.entrada,
    gruposDoRanking(lido.extras[0]),
    referencia,
    envio,
  );
  if (dados === null) return consultaInvalida(FORA_DA_CAMPANHA);
  return {
    ok: true,
    tipo,
    data: referencia,
    email: montarRelatorioDiario(dados),
  };
}

/** Cria a mensagem do binding (injetável nos testes, que leem o MIME). */
export type CriarMensagem = (
  de: string,
  para: string,
  mime: string,
) => EmailMessage;

const criarMensagemDoBinding: CriarMensagem = (de, para, mime) =>
  new EmailMessage(de, para, mime);

export interface OpcoesEnvio {
  criarMensagem?: CriarMensagem;
  /** Identificador de cada mensagem (Message-ID e fronteira do MIME). Padrão: um UUID. */
  gerarId?: () => string;
}

/** Envia o e-mail a cada destinatário, um por vez; a falha de um não para os outros. */
export async function enviarAosDestinatarios(
  binding: SendEmail,
  destinatarios: readonly string[],
  email: EmailDoDia,
  agora: Date,
  opcoes: OpcoesEnvio = {},
): Promise<{ enviados: number; falhas: number }> {
  const criarMensagem = opcoes.criarMensagem ?? criarMensagemDoBinding;
  const gerarId = opcoes.gerarId ?? (() => crypto.randomUUID());
  let enviados = 0;
  let falhas = 0;
  for (const [indice, para] of destinatarios.entries()) {
    try {
      const mime = montarMime({
        remetente: REMETENTE_RELATORIO_DIARIO,
        para,
        assunto: email.assunto,
        texto: email.texto,
        html: email.html,
        data: agora,
        id: gerarId(),
      });
      await binding.send(
        criarMensagem(REMETENTE_RELATORIO_DIARIO.email, para, mime),
      );
      enviados += 1;
    } catch (erro) {
      falhas += 1;
      // Sem o endereço e sem a mensagem do erro (que pode citá-lo): só a posição na lista e o tipo.
      console.warn("Relatório diário: falha no envio", {
        destinatario: indice + 1,
        erro: erro instanceof Error ? erro.name : "desconhecido",
      });
    }
  }
  return { enviados, falhas };
}

/** O que o cron fez (para o log e os testes). */
export type ResultadoDoCron =
  | {
      situacao:
        | "sem_binding"
        | "sem_destinatarios"
        | "sem_campanha"
        | "fora_da_campanha";
    }
  | {
      situacao: "enviado";
      tipo: TipoRelatorioDiario;
      data: string;
      destinatarios: number;
      enviados: number;
      falhas: number;
    };

/**
 * O envio de um cron (`scheduled` do index.ts): na manhã, o dia de ontem; na tarde, hoje até `agora`; para os
 * destinatários do segredo. Nunca falha por falta de configuração (só avisa no log); um erro do banco sobe, e a
 * Cloudflare o mostra no evento do cron.
 */
export async function executarRelatorioDiario(
  env: Cloudflare.Env,
  agora: Date,
  tipo: TipoRelatorioDiario,
  opcoes: OpcoesEnvio = {},
): Promise<ResultadoDoCron> {
  if (!env.EMAIL) {
    console.warn(
      "Relatório diário: binding EMAIL não configurado; nada enviado",
    );
    return { situacao: "sem_binding" };
  }
  const { validos, ignorados } = lerDestinatarios(env.RELATORIO_EMAILS);
  if (ignorados > 0)
    console.warn("Relatório diário: destinatários ignorados", { ignorados });
  if (validos.length === 0) {
    console.warn(
      "Relatório diário: segredo RELATORIO_EMAILS sem destinatário válido; nada enviado",
    );
    return { situacao: "sem_destinatarios" };
  }
  const leitura = await lerRelatorioDiario(env, () => agora, { tipo });
  if (!leitura.ok) {
    const situacao =
      leitura.codigo === "nao_encontrado" ? "sem_campanha" : "fora_da_campanha";
    console.log(`Relatório diário (${tipo}): ${situacao}; nada enviado`);
    return { situacao };
  }
  const { enviados, falhas } = await enviarAosDestinatarios(
    env.EMAIL,
    validos,
    leitura.email,
    agora,
    opcoes,
  );
  const resultado = {
    situacao: "enviado",
    tipo,
    data: leitura.data,
    destinatarios: validos.length,
    enviados,
    falhas,
  } as const;
  console.log("Relatório diário enviado", resultado);
  return resultado;
}
