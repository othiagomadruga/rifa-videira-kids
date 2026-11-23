// Sessão no site (RIFA-007; papéis da hierarquia na RIFA-014): quem está conectado, entrar pelo link pessoal
// e sair. O cookie da sessão é HttpOnly: o site não o lê, pergunta a GET /api/sessao (docs/acesso.md).
// O ProvedorSessao fica na raiz das rotas (rotas.tsx). Cada área com sessão tem a sua guarda
// (useGuardaDaArea): a coordenação (/coordenacao, CoordenacaoLayout) e a visão individual de líderes,
// discipuladores e redes (/minha, MinhaLayout). As telas /acesso e /entrar usam useSessao(); as telas
// atrás de uma guarda, useUsuarioConectado().
// Do contrato vêm só os TIPOS (os valores poriam o zod no pacote do site): os caminhos e papéis abaixo são
// cópias, conferidas por pages/acessos/acessos-contrato.test.ts e pages/minha/minha-contrato.test.ts.
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
import { useLocation, useNavigate } from "react-router";
import type {
  Papel,
  PapelHierarquia,
  RespostaSessao,
  UsuarioSessao,
} from "../../shared/contracts";
import { ErroApi, aoReceber401, api } from "./api";

/**
 * ROTAS_ACESSO.entrar e obterSessao (POST e GET /api/sessao), sair, entrarComSenha (RIFA-064: o login da célula com
 * a senha padrão), entrarComoDiscipulador (RIFA-082: o login do discipulador com a senha padrão) e entrarComoAdmin
 * (RIFA-073: o login do admin com usuário e senha) (.caminho).
 */
export const CAMINHOS_SESSAO = {
  sessao: "/api/sessao",
  sair: "/api/sessao/sair",
  senha: "/api/sessao/senha",
  discipulador: "/api/sessao/discipulador",
  admin: "/api/sessao/admin",
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
  /**
   * RIFA-064 (D29): entra com o nome da célula e a senha padrão (POST /api/sessao/senha): a sessão do líder da
   * célula. 401: célula ou senha que não conferem (a API não diz qual).
   */
  entrarComSenha: (celula: string, senha: string) => Promise<UsuarioSessao>;
  /**
   * RIFA-082 (D37): entra com o nome do discipulador e a senha padrão (POST /api/sessao/discipulador): a sessão do
   * discipulador. 401: nome ou senha que não conferem (a API não diz qual).
   */
  entrarComoDiscipulador: (
    discipulador: string,
    senha: string,
  ) => Promise<UsuarioSessao>;
  /**
   * RIFA-073 (D33): entra com o usuário e a senha do admin (POST /api/sessao/admin): a mesma sessão do link do admin.
   * 401: usuário ou senha que não conferem (a API não diz qual).
   */
  entrarComoAdmin: (usuario: string, senha: string) => Promise<UsuarioSessao>;
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

  const entrarComSenha = useCallback(async (celula: string, senha: string) => {
    const { usuario } = await api.post<RespostaSessao>(CAMINHOS_SESSAO.senha, {
      celula,
      senha,
    });
    versao.current += 1;
    setEstado({ situacao: "conectada", usuario });
    return usuario;
  }, []);

  const entrarComoDiscipulador = useCallback(
    async (discipulador: string, senha: string) => {
      const { usuario } = await api.post<RespostaSessao>(
        CAMINHOS_SESSAO.discipulador,
        { discipulador, senha },
      );
      versao.current += 1;
      setEstado({ situacao: "conectada", usuario });
      return usuario;
    },
    [],
  );

  const entrarComoAdmin = useCallback(
    async (usuario: string, senha: string) => {
      const { usuario: conectado } = await api.post<RespostaSessao>(
        CAMINHOS_SESSAO.admin,
        { usuario, senha },
      );
      versao.current += 1;
      setEstado({ situacao: "conectada", usuario: conectado });
      return conectado;
    },
    [],
  );

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
    () => ({
      estado,
      verificar,
      entrar,
      entrarComSenha,
      entrarComoDiscipulador,
      entrarComoAdmin,
      sair,
    }),
    [
      estado,
      verificar,
      entrar,
      entrarComSenha,
      entrarComoDiscipulador,
      entrarComoAdmin,
      sair,
    ],
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

/** Quem está conectado. Só nas telas atrás de uma guarda (useGuardaDaArea), onde a sessão sempre existe. */
export function useUsuarioConectado(): UsuarioSessao {
  const { estado } = useSessao();
  if (estado.situacao !== "conectada") {
    throw new Error(
      "Tela sem sessão: use dentro da guarda da área (CoordenacaoLayout ou MinhaLayout).",
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
// Áreas do site por papel (RIFA-014, D12)
// ---------------------------------------------------------------------------------------------------
// Admin e coordenação usam /coordenacao; líder, discipulador e rede usam só /minha (a visão individual).
// Endereço da outra área leva à área do papel (a API recusa do mesmo jeito, com 403).

export type AreaDoSite = "coordenacao" | "hierarquia";

/** Tela inicial de cada área. */
export const INICIO_DA_AREA: Record<AreaDoSite, string> = {
  coordenacao: "/coordenacao",
  hierarquia: "/minha",
};

/** PAPEIS_HIERARQUIA do contrato (cópia; os outros papéis são os da coordenação). */
export const PAPEIS_DA_HIERARQUIA: readonly PapelHierarquia[] = [
  "lider",
  "discipulador",
  "rede",
];

export function ehPapelDaHierarquia(papel: Papel): papel is PapelHierarquia {
  return (PAPEIS_DA_HIERARQUIA as readonly Papel[]).includes(papel);
}

export function areaDoPapel(papel: Papel): AreaDoSite {
  return ehPapelDaHierarquia(papel) ? "hierarquia" : "coordenacao";
}

/** /minha para líder, discipulador e rede; /coordenacao para admin e coordenação. */
export function inicioDoPapel(papel: Papel): string {
  return INICIO_DA_AREA[areaDoPapel(papel)];
}

/**
 * Para onde ir depois de entrar: o destino guardado (ou o `state.de` de /entrar) só vale se for um caminho
 * seguro da área do papel; senão, a tela inicial da área dele.
 */
export function destinoDoPapel(destino: unknown, papel: Papel): string {
  const seguro = destinoSeguro(destino);
  const area = areaDoPapel(papel);
  return seguro !== null && areaDoCaminho(seguro) === area
    ? seguro
    : INICIO_DA_AREA[area];
}

/** A área de um caminho que já passou por destinoSeguro. */
function areaDoCaminho(caminho: string): AreaDoSite {
  return caminho.startsWith(INICIO_DA_AREA.hierarquia)
    ? "hierarquia"
    : "coordenacao";
}

/**
 * Guarda de uma área com sessão (CoordenacaoLayout e MinhaLayout):
 * - sessão ainda desconhecida: pergunta a GET /api/sessao;
 * - sem sessão (ao abrir, por um 401 no meio do uso ou depois de "Sair"): vai para /entrar e, menos depois de
 *   sair, guarda a tela pedida, para voltar a ela depois de entrar;
 * - sessão de um papel da outra área: vai para a tela inicial da área dele (com replace).
 * Devolve quem está conectado quando o papel é desta área; senão, null (a guarda mostra o carregando ou o erro).
 */
export function useGuardaDaArea(area: AreaDoSite): UsuarioSessao | null {
  const { estado, verificar } = useSessao();
  const navigate = useNavigate();
  const { pathname, search } = useLocation();
  const { situacao } = estado;
  const motivo = estado.situacao === "desconectada" ? estado.motivo : null;
  const usuario = estado.situacao === "conectada" ? estado.usuario : null;
  const areaDoUsuario = usuario ? areaDoPapel(usuario.papel) : null;

  useEffect(() => {
    if (situacao === "desconhecida") verificar();
  }, [situacao, verificar]);

  useEffect(() => {
    if (motivo === null) return;
    const destino: EstadoNavegacaoEntrar = { motivo };
    if (motivo !== "saiu") {
      destino.de = `${pathname}${search}`;
      guardarDestino(destino.de);
    }
    void navigate("/entrar", { replace: true, state: destino });
  }, [motivo, pathname, search, navigate]);

  useEffect(() => {
    if (areaDoUsuario !== null && areaDoUsuario !== area) {
      void navigate(INICIO_DA_AREA[areaDoUsuario], { replace: true });
    }
  }, [areaDoUsuario, area, navigate]);

  return areaDoUsuario === area ? usuario : null;
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
  /** Tela pedida (só caminhos das áreas com sessão: /coordenacao... e /minha...). */
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

/**
 * Só caminhos das áreas com sessão: a coordenação ("/coordenacao", "/coordenacao/pedidos?x=1") e a visão
 * individual ("/minha", "/minha?periodo=campanha"); o resto vira null. A área do papel é conferida à parte
 * (destinoDoPapel).
 */
export function destinoSeguro(valor: unknown): string | null {
  if (typeof valor !== "string" || valor.includes("//")) return null;
  return /^\/(?:coordenacao|minha)(?:\/[\w/-]*)?(?:\?[^#\\]*)?$/.test(valor)
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
    // Armazenamento indisponível (ex.: bloqueado no navegador): depois de entrar, vai para o início da área.
  }
}

/** Lê e apaga o destino guardado. Vencido, fora das áreas com sessão ou ilegível: null. */
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
