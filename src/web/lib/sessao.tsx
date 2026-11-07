// Sessão da coordenação no site (RIFA-007): quem está conectado, entrar pelo link pessoal e sair.
// O cookie da sessão é HttpOnly: o site não o lê, pergunta a GET /api/sessao (docs/acesso.md).
// O ProvedorSessao fica na raiz das rotas (rotas.tsx). A guarda da coordenação (CoordenacaoLayout) e as
// telas /acesso e /entrar usam useSessao(); as telas da coordenação, useUsuarioConectado().
// Do contrato vêm só os TIPOS (os valores poriam o zod no pacote do site): os caminhos abaixo são cópias,
// conferidas por pages/acessos/acessos-contrato.test.ts.
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import type {
  Papel,
  RespostaSessao,
  UsuarioSessao,
} from "../../shared/contracts";
import { ErroApi, aoReceber401, api } from "./api";

/** ROTAS_ACESSO.entrar e obterSessao (POST e GET /api/sessao) e sair (.caminho). */
export const CAMINHOS_SESSAO = {
  sessao: "/api/sessao",
  sair: "/api/sessao/sair",
} as const;

/** Nome do papel para mostrar na tela. */
export const ROTULO_PAPEL: Record<Papel, string> = {
  admin: "Admin",
  coordenacao: "Coordenação",
  lider: "Líder",
  discipulador: "Discipulador",
  rede: "Rede",
};

/**
 * Por que não há sessão: `sem_sessao` (ao abrir, a API respondeu 401), `expirou` (um 401 no meio do uso)
 * ou `saiu` (a pessoa tocou em Sair).
 */
export type MotivoSemSessao = "sem_sessao" | "expirou" | "saiu";

export type EstadoSessao =
  /** Ainda não perguntou à API (quem precisa da sessão chama `verificar`). */
  | { situacao: "desconhecida" }
  | { situacao: "verificando" }
  | { situacao: "conectada"; usuario: UsuarioSessao }
  | { situacao: "desconectada"; motivo: MotivoSemSessao }
  /** A consulta falhou sem resposta da sessão (sem conexão, 500...): dá para tentar de novo. */
  | { situacao: "erro"; erro: unknown };

export type ValorSessao = {
  estado: EstadoSessao;
  /** Pergunta à API quem está conectado (GET /api/sessao). Ignorado se já houver uma consulta em andamento. */
  verificar: () => void;
  /** Troca o token do link pessoal por uma sessão (POST /api/sessao). 401: link inválido. */
  entrar: (token: string) => Promise<UsuarioSessao>;
  /** Encerra a sessão deste aparelho (POST /api/sessao/sair). */
  sair: () => Promise<void>;
};

const ContextoSessao = createContext<ValorSessao | null>(null);

/**
 * Sessão já conhecida ao abrir o site, sem perguntar à API. Só os testes usam (test/renderizar.tsx):
 * sem valor, o site pergunta a GET /api/sessao, como no navegador.
 */
export const SessaoInicial = createContext<UsuarioSessao | null>(null);

export function ProvedorSessao({ children }: { children: ReactNode }) {
  const inicial = useContext(SessaoInicial);
  const [estado, setEstado] = useState<EstadoSessao>(() =>
    inicial
      ? { situacao: "conectada", usuario: inicial }
      : { situacao: "desconhecida" },
  );
  // Entrar, sair e um 401 mudam a sessão: a resposta de uma consulta que já estava a caminho é ignorada.
  const versao = useRef(0);
  const consultando = useRef(false);

  const verificar = useCallback(() => {
    if (consultando.current) return;
    consultando.current = true;
    const versaoDaConsulta = versao.current;
    setEstado({ situacao: "verificando" });
    api
      .get<RespostaSessao>(CAMINHOS_SESSAO.sessao)
      .then(
        ({ usuario }) => {
          if (versao.current === versaoDaConsulta) {
            setEstado({ situacao: "conectada", usuario });
          }
        },
        (erro: unknown) => {
          if (versao.current !== versaoDaConsulta) return;
          setEstado(
            erro instanceof ErroApi && erro.status === 401
              ? { situacao: "desconectada", motivo: "sem_sessao" }
              : { situacao: "erro", erro },
          );
        },
      )
      .finally(() => {
        consultando.current = false;
      });
  }, []);

  const entrar = useCallback(async (token: string) => {
    const { usuario } = await api.post<RespostaSessao>(CAMINHOS_SESSAO.sessao, {
      token,
    });
    versao.current += 1;
    setEstado({ situacao: "conectada", usuario });
    return usuario;
  }, []);

  const sair = useCallback(async () => {
    await api.post(CAMINHOS_SESSAO.sair);
    versao.current += 1;
    esquecerDestino();
    setEstado({ situacao: "desconectada", motivo: "saiu" });
  }, []);

  // 401 de qualquer outra rota da API (gancho do lib/api.ts): a sessão acabou no meio do uso. As rotas da
  // própria sessão tratam o 401 delas (GET: sem sessão; POST: link inválido, a sessão atual continua).
  useEffect(
    () =>
      aoReceber401((caminho) => {
        if (ehCaminhoDaSessao(caminho)) return;
        versao.current += 1;
        setEstado((atual) =>
          atual.situacao === "conectada"
            ? { situacao: "desconectada", motivo: "expirou" }
            : atual,
        );
      }),
    [],
  );

  const valor = useMemo(
    () => ({ estado, verificar, entrar, sair }),
    [estado, verificar, entrar, sair],
  );
  return <ContextoSessao value={valor}>{children}</ContextoSessao>;
}

export function useSessao(): ValorSessao {
  const valor = useContext(ContextoSessao);
  if (!valor) {
    throw new Error("useSessao precisa do ProvedorSessao (veja rotas.tsx).");
  }
  return valor;
}

/** Quem está conectado. Só nas telas atrás da guarda da coordenação, onde a sessão sempre existe. */
export function useUsuarioConectado(): UsuarioSessao {
  const { estado } = useSessao();
  if (estado.situacao !== "conectada") {
    throw new Error(
      "Tela da coordenação sem sessão: use dentro da guarda (CoordenacaoLayout).",
    );
  }
  return estado.usuario;
}

function ehCaminhoDaSessao(caminho: string): boolean {
  const { pathname } = new URL(caminho, window.location.origin);
  return (
    pathname === CAMINHOS_SESSAO.sessao ||
    pathname.startsWith(`${CAMINHOS_SESSAO.sessao}/`)
  );
}

// ---------------------------------------------------------------------------------------------------
// Para onde voltar depois de entrar
// ---------------------------------------------------------------------------------------------------
// Sem sessão, a guarda manda para /entrar e guarda a tela pedida. A pessoa então abre o link pessoal
// no WhatsApp, que costuma abrir outra aba: por isso o destino fica no localStorage (só o caminho, sem
// dado pessoal), vale por uma hora e é apagado ao ser usado e ao sair.

const CHAVE_DESTINO = "rifa-videira-kids:voltar-para";
export const VALIDADE_DESTINO_MS = 60 * 60 * 1000;

/** O que a guarda manda para /entrar no `state` da navegação. */
export type EstadoNavegacaoEntrar = {
  /** Tela pedida (só caminhos da coordenação). */
  de?: string;
  motivo?: MotivoSemSessao;
};

const MOTIVOS: readonly MotivoSemSessao[] = ["sem_sessao", "expirou", "saiu"];

/** Lê o `state` de /entrar (vem do histórico do navegador: confere tudo). */
export function lerEstadoEntrar(state: unknown): EstadoNavegacaoEntrar {
  if (typeof state !== "object" || state === null) return {};
  const { de, motivo } = state as { de?: unknown; motivo?: unknown };
  const lido: EstadoNavegacaoEntrar = {};
  const destino = destinoSeguro(de);
  if (destino !== null) lido.de = destino;
  const motivoValido = MOTIVOS.find((item) => item === motivo);
  if (motivoValido) lido.motivo = motivoValido;
  return lido;
}

/** Só caminhos da área da coordenação ("/coordenacao", "/coordenacao/pedidos?x=1"); o resto vira null. */
export function destinoSeguro(valor: unknown): string | null {
  if (typeof valor !== "string" || valor.includes("//")) return null;
  return /^\/coordenacao(?:\/[\w/-]*)?(?:\?[^#\\]*)?$/.test(valor)
    ? valor
    : null;
}

export function guardarDestino(caminho: string): void {
  if (destinoSeguro(caminho) === null) return;
  try {
    localStorage.setItem(
      CHAVE_DESTINO,
      JSON.stringify({ caminho, ate: Date.now() + VALIDADE_DESTINO_MS }),
    );
  } catch {
    // Armazenamento indisponível (ex.: bloqueado no navegador): depois de entrar, vai para a Visão geral.
  }
}

/** Lê e apaga o destino guardado. Vencido, fora da coordenação ou ilegível: null. */
export function retirarDestino(): string | null {
  try {
    const texto = localStorage.getItem(CHAVE_DESTINO);
    localStorage.removeItem(CHAVE_DESTINO);
    if (texto === null) return null;
    const lido: unknown = JSON.parse(texto);
    if (typeof lido !== "object" || lido === null) return null;
    const { caminho, ate } = lido as { caminho?: unknown; ate?: unknown };
    return typeof ate === "number" && ate > Date.now()
      ? destinoSeguro(caminho)
      : null;
  } catch {
    return null;
  }
}

export function esquecerDestino(): void {
  try {
    localStorage.removeItem(CHAVE_DESTINO);
  } catch {
    // Armazenamento indisponível: não havia o que apagar.
  }
}
