// Chamadas da aba "Conexão com a Rifei" de Acessos (RIFA-070, D32; só admin): o estado da conexão (nunca o token),
// colar (o Worker testa na Rifei e guarda cifrado), testar e apagar. Do contrato vêm só os TIPOS (o catálogo poria o
// zod no pacote); os caminhos são cópias, conferidas por ConexaoRifei.test.tsx.
//
// O token colado só passa por aqui no corpo do PUT: a tela o esquece logo depois (nunca em storage, URL ou log).
import type {
  CorpoSalvarConexaoRifei,
  EstadoConexaoRifei,
  ROTAS_CONEXAO_RIFEI,
  RespostaTesteConexaoRifei,
} from "../../../shared/contracts/api";
import { formatarData, formatarHora } from "../../lib/formatadores";
import { api } from "../../lib/api";

export type { EstadoConexaoRifei, RespostaTesteConexaoRifei };

type Rotas = typeof ROTAS_CONEXAO_RIFEI;

export const CAMINHO_CONEXAO_RIFEI: Rotas["obterConexaoRifei"]["caminho"] =
  "/api/admin/rifei/conexao";
export const CAMINHO_TESTAR_CONEXAO_RIFEI: Rotas["testarConexaoRifei"]["caminho"] =
  "/api/admin/rifei/conexao/testar";

type Opcoes = { signal?: AbortSignal };

export function obterConexaoRifei(
  opcoes: Opcoes = {},
): Promise<EstadoConexaoRifei> {
  return api.get<EstadoConexaoRifei>(CAMINHO_CONEXAO_RIFEI, opcoes);
}

export function salvarConexaoRifei(
  token: string,
  opcoes: Opcoes = {},
): Promise<RespostaTesteConexaoRifei> {
  const corpo: CorpoSalvarConexaoRifei = { token };
  return api.put<RespostaTesteConexaoRifei>(
    CAMINHO_CONEXAO_RIFEI,
    corpo,
    opcoes,
  );
}

export function testarConexaoRifei(
  opcoes: Opcoes = {},
): Promise<RespostaTesteConexaoRifei> {
  return api.post<RespostaTesteConexaoRifei>(
    CAMINHO_TESTAR_CONEXAO_RIFEI,
    {},
    opcoes,
  );
}

export function apagarConexaoRifei(
  opcoes: Opcoes = {},
): Promise<EstadoConexaoRifei> {
  return api.delete<EstadoConexaoRifei>(CAMINHO_CONEXAO_RIFEI, opcoes);
}

/** A situação em uma frase, com o tom: o que o pastor precisa saber antes de marcar pagos. */
export function situacaoDaConexao(estado: EstadoConexaoRifei): {
  tom: "sucesso" | "perigo" | "alerta" | "info";
  texto: string;
} {
  if (estado.origem === null)
    return {
      tom: "alerta",
      texto:
        "Sem conexão com a Rifei: cole o token em Acessos → Conexão com a Rifei.",
    };
  if (estado.origem === "tela" && !estado.token_legivel)
    return {
      tom: "perigo",
      texto:
        "O token salvo não pode mais ser lido: cole um novo em Acessos → Conexão com a Rifei.",
    };
  if (estado.recusado_em !== null)
    return {
      tom: "perigo",
      texto: `A Rifei recusou o token (${formatarData(estado.recusado_em)} às ${formatarHora(estado.recusado_em)}): cole um novo em Acessos → Conexão com a Rifei.`,
    };
  if (estado.origem === "segredo")
    return {
      tom: "info",
      texto: "Conectado pelo segredo do servidor (sem teste registrado).",
    };
  if (estado.testado_em === null)
    return { tom: "info", texto: "Conectado: ainda não testado." };
  return {
    tom: "sucesso",
    texto: `Conectado: testado ${formatarData(estado.testado_em)} às ${formatarHora(estado.testado_em)}.`,
  };
}
