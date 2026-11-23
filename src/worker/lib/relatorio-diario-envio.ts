/**
 * Leitura e envio do relatório diário por e-mail (RIFA-086, D40). Junta a leitura do painel (db/painel.ts, com os
 * grupos de db/grupos.ts no MESMO lote: duas idas ao D1), o saldo da Efí (lib/efi.ts), os números e o e-mail
 * (lib/relatorio-diario.ts) e o MIME (lib/email.ts), e envia pelo binding `EMAIL` (send_email da Cloudflare).
 *
 * - Dia de referência: o pedido (prévia e envio do admin) ou, sem ele, ONTEM no fuso da campanha (o e-mail das 7h leva
 *   o dia anterior fechado). Fora da campanha, nada sai (400 `fora_da_campanha` nas rotas; só um log no cron).
 * - Um e-mail por destinatário (o segredo `RELATORIO_EMAILS`): ninguém vê o endereço do outro, e uma falha não derruba
 *   os demais. Os logs levam só contagens, nunca um endereço.
 * - Sem o binding `EMAIL` ou sem destinatário válido, o cron só avisa no log (não falha) e a rota do admin responde 503
 *   `nao_configurado`.
 */
import { EmailMessage } from "cloudflare:email";
import {
  REMETENTE_RELATORIO_DIARIO,
  hojeNoFuso,
  somarDias,
  type DetalheValidacao,
} from "../../shared/contracts";
import { comandosDosGrupos, gruposDoRanking } from "../db/grupos";
import { lerEntradaDoCalculo, type Relogio } from "../db/painel";
import { consultarSaldoEfi, type OpcoesEfi } from "./efi";
import { lerDestinatarios, montarMime } from "./email";
import {
  dadosDoRelatorioDiario,
  montarRelatorioDiario,
} from "./relatorio-diario";

/** O e-mail do dia, pronto para enviar ou mostrar. */
export interface EmailDoDia {
  assunto: string;
  html: string;
  texto: string;
}

export type LeituraRelatorioDiario =
  | { ok: true; data: string; email: EmailDoDia }
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

/**
 * O e-mail de `data` (ausente = ontem no fuso da campanha). Sem campanha ativa, 404; `data` depois de hoje (a
 * leitura do painel confere) ou fora da campanha, 400.
 */
export async function lerRelatorioDiario(
  env: Cloudflare.Env,
  relogio: Relogio,
  data?: string,
  opcoesEfi: OpcoesEfi = {},
): Promise<LeituraRelatorioDiario> {
  const lido = await lerEntradaDoCalculo(
    env.DB,
    relogio,
    data === undefined ? {} : { data },
    comandosDosGrupos,
  );
  if (!lido.ok) return lido;
  const referencia =
    data ??
    somarDias(hojeNoFuso(lido.entrada.campanha.fuso_horario, lido.agora), -1);
  const saldo = await consultarSaldoEfi(env, opcoesEfi);
  const dados = dadosDoRelatorioDiario(
    lido.entrada,
    gruposDoRanking(lido.extras[0]),
    referencia,
    saldo,
  );
  if (dados === null)
    return {
      ok: false,
      codigo: "requisicao_invalida",
      mensagem: "Consulta inválida",
      detalhes: [FORA_DA_CAMPANHA],
    };
  return { ok: true, data: referencia, email: montarRelatorioDiario(dados) };
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
  efi?: OpcoesEfi;
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
      data: string;
      destinatarios: number;
      enviados: number;
      falhas: number;
    };

/**
 * O envio do cron das 7h (`scheduled` do index.ts): o dia de ontem, para os destinatários do segredo. Nunca falha por
 * falta de configuração (só avisa no log); um erro do banco sobe, e a Cloudflare o mostra no evento do cron.
 */
export async function executarRelatorioDiario(
  env: Cloudflare.Env,
  agora: Date,
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
  const leitura = await lerRelatorioDiario(
    env,
    () => agora,
    undefined,
    opcoes.efi,
  );
  if (!leitura.ok) {
    const situacao =
      leitura.codigo === "nao_encontrado" ? "sem_campanha" : "fora_da_campanha";
    console.log(`Relatório diário: ${situacao}; nada enviado`);
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
    data: leitura.data,
    destinatarios: validos.length,
    enviados,
    falhas,
  } as const;
  console.log("Relatório diário enviado", resultado);
  return resultado;
}
