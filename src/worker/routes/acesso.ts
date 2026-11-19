/**
 * Sessão da equipe (RIFA-007), montada em /api/sessao. Documentação: docs/acesso.md.
 *
 * - POST /api/sessao { token }: o link pessoal vira uma sessão (cookie `__Host-sessao`). Link inválido → 401.
 *   O mesmo link pode abrir outras sessões (outro aparelho, ou de novo) até expirar ou ser revogado, e
 *   nenhuma sessão dura mais que o link que a abriu. Link VÁLIDO de discipulador ou rede com o acesso do papel
 *   desligado na campanha (RIFA-029, D20) → 403 `acesso_desligado` com `{ papel }`, sem criar a sessão (o link
 *   continua valendo: entra quando a chave volta). A chave é lida na mesma consulta do link, na hora.
 * - GET /api/sessao: quem está conectado (401 sem sessão válida).
 * - POST /api/sessao/sair: encerra a sessão deste navegador e expira o cookie (204, mesmo sem sessão).
 * - POST /api/sessao/senha { celula, senha } (RIFA-064, D29): o login da célula com a senha padrão ("@" + nome
 *   normalizado + "1234"; src/shared/contracts/login-celula.ts) abre a sessão do líder da célula, como o link. A senha
 *   é derivada do nome da célula na hora e comparada em tempo constante: nunca é gravada nem vai para log ou trilha.
 *   Toda recusa (senha errada, célula que não existe, nome ambíguo, usuário desativado, chave desligada) é o MESMO
 *   401, sem dizer se a célula existe.
 * - POST /api/sessao/admin { usuario, senha } (RIFA-073, D33): o login do admin com o usuário e a senha que ele definiu
 *   em /api/admin/minha-senha abre a MESMA sessão do link do admin (sem link). A senha é conferida pelo PBKDF2
 *   (lib/senha.ts) mesmo quando o usuário não existe (o tempo não diz se ele existe), e toda recusa é o MESMO 401.
 *
 * Os POSTs são abertos (não exigem sessão), mas só da mesma origem do site (CSRF). No login (RIFA-013b),
 * depois da origem: o limite de tentativas por IP (429, lib/limite-requisicoes.ts) e o de tamanho do corpo,
 * conferido ANTES de ler ou validar o JSON (413, middleware/limite-corpo.ts).
 */
import { Hono, type Context } from "hono";
import {
  FORMATO_TOKEN_ACESSO,
  PAPEIS,
  VALIDADE_SESSAO_DIAS,
  corpoCriarSessaoSchema,
  corpoEntrarComSenhaSchema,
  corpoEntrarComoAdminSchema,
  normalizarUsuarioAdmin,
  formaDaSenhaDigitada,
  normalizarNomeCelula,
  senhaPadraoDaCelula,
  type RespostaSessao,
} from "../../shared/contracts";
import {
  apagarSessao,
  buscarLinkValido,
  buscarSessao,
  criarSessao,
} from "../db/acessos";
import { abrirSessaoDaCelula, lerCelulasParaLogin } from "../db/login-celula";
import { abrirSessaoDoAdmin, buscarCredencialAdmin } from "../db/senha-admin";
import { gerarSegredo, sha256Hex } from "../lib/cripto";
import { LIMITE_LOGIN, limitarRequisicoes } from "../lib/limite-requisicoes";
import { responderErro } from "../lib/respostas-erro";
import { SENHA_ADMIN_QUE_NUNCA_CONFERE, senhaConfere } from "../lib/senha";
import { textosIguaisEmTempoConstante } from "../lib/tempo-constante";
import {
  LIMITE_CORPO_SESSAO_BYTES,
  limitarCorpo,
} from "../middleware/limite-corpo";
import {
  apagarCookieSessao,
  exigirMesmaOrigem,
  exigirSessao,
  gravarCookieSessao,
  lerCookieSessao,
  mensagemAcessoDesligado,
  type AmbienteSessao,
} from "../middleware/sessao";
import { validarJson } from "../middleware/validacao";

const DIA_MS = 24 * 60 * 60 * 1000;

export const sessao = new Hono<AmbienteSessao>();

function respostaLinkInvalido(c: Context) {
  return responderErro(
    c,
    "nao_autenticado",
    "Link de acesso inválido, expirado ou revogado",
  );
}

sessao.post(
  "/",
  exigirMesmaOrigem,
  limitarRequisicoes(LIMITE_LOGIN),
  limitarCorpo(LIMITE_CORPO_SESSAO_BYTES),
  validarJson(corpoCriarSessaoSchema),
  async (c) => {
    c.header("Cache-Control", "no-store");
    const { token } = c.req.valid("json");
    if (!FORMATO_TOKEN_ACESSO.test(token)) return respostaLinkInvalido(c);

    const agora = new Date();
    const link = await buscarLinkValido(
      c.env.DB,
      await sha256Hex(token),
      agora.toISOString(),
    );
    if (link === null) return respostaLinkInvalido(c);
    const { papel } = link.usuario;
    if (!link.acessoLigado && (papel === "discipulador" || papel === "rede"))
      return responderErro(
        c,
        "acesso_desligado",
        mensagemAcessoDesligado(papel),
        { papel },
      );

    const idSessao = gerarSegredo();
    const anterior = lerCookieSessao(c);
    // Até o menor entre login + VALIDADE_SESSAO_DIAS e o fim do link (o banco aplica e devolve).
    const expiraEm = await criarSessao(c.env.DB, {
      idHash: await sha256Hex(idSessao),
      linkId: link.linkId,
      criadoEm: agora.toISOString(),
      expiraEm: new Date(
        agora.getTime() + VALIDADE_SESSAO_DIAS * DIA_MS,
      ).toISOString(),
      idHashAnterior: anterior === null ? null : await sha256Hex(anterior),
    });
    if (expiraEm === null) return respostaLinkInvalido(c);

    gravarCookieSessao(c, idSessao, expiraEm, agora);
    return c.json({ usuario: link.usuario } satisfies RespostaSessao, 200);
  },
);

/**
 * A recusa do login por senha (RIFA-064): a MESMA resposta para todo caso, sem dizer se a célula existe nem por que
 * não entrou (senha errada, célula que não existe, nome ambíguo, usuário desativado, chave desligada).
 */
function respostaSenhaRecusada(c: Context) {
  return responderErro(
    c,
    "nao_autenticado",
    "Não foi possível entrar com esta célula e esta senha",
  );
}

/**
 * Comparada com a senha digitada quando não há célula para comparar (nome que não é de célula, ambíguo ou sem senha
 * padrão): a comparação acontece do mesmo jeito, para o tempo da resposta não dizer se a célula existe. Nunca confere:
 * formaDaSenhaDigitada só devolve "@" seguido de [a-z0-9].
 */
const SENHA_QUE_NUNCA_CONFERE = "@ sem célula";

sessao.post(
  "/senha",
  exigirMesmaOrigem,
  limitarRequisicoes(LIMITE_LOGIN),
  limitarCorpo(LIMITE_CORPO_SESSAO_BYTES),
  validarJson(corpoEntrarComSenhaSchema),
  async (c) => {
    c.header("Cache-Control", "no-store");
    const { celula, senha } = c.req.valid("json");
    const { ligado, celulas } = await lerCelulasParaLogin(c.env.DB);
    const nome = normalizarNomeCelula(celula);
    const encontradas =
      nome === ""
        ? []
        : celulas.filter((outra) => normalizarNomeCelula(outra.nome) === nome);
    // Dois nomes de célula iguais depois da normalização: ambíguo, ninguém entra por eles (a coordenação vê o aviso).
    const alvo = encontradas.length === 1 ? encontradas[0] : null;
    const esperada = alvo === null ? null : senhaPadraoDaCelula(alvo.nome);
    const confere = await textosIguaisEmTempoConstante(
      formaDaSenhaDigitada(senha),
      esperada ?? SENHA_QUE_NUNCA_CONFERE,
    );
    if (!ligado || alvo === null || esperada === null || !confere)
      return respostaSenhaRecusada(c);

    const agora = new Date();
    const idSessao = gerarSegredo();
    const idHash = await sha256Hex(idSessao);
    const anterior = lerCookieSessao(c);
    const expiraEm = await abrirSessaoDaCelula(c.env.DB, {
      celulaId: alvo.id,
      idHash,
      criadoEm: agora.toISOString(),
      expiraEm: new Date(
        agora.getTime() + VALIDADE_SESSAO_DIAS * DIA_MS,
      ).toISOString(),
      idHashAnterior: anterior === null ? null : await sha256Hex(anterior),
    });
    // A chave desligada ou o usuário da célula desativado no meio (conferidos de novo dentro do lote).
    if (expiraEm === null) return respostaSenhaRecusada(c);
    // Quem entrou, como GET /api/sessao devolve (com o alvo lido da hierarquia na hora).
    const aberta = await buscarSessao(c.env.DB, idHash, agora.toISOString());
    if (aberta === null) return respostaSenhaRecusada(c);

    gravarCookieSessao(c, idSessao, expiraEm, agora);
    return c.json({ usuario: aberta.usuario } satisfies RespostaSessao, 200);
  },
);

/**
 * A recusa do login do admin (RIFA-073): a MESMA resposta para todo caso, sem dizer se o usuário existe nem por que não
 * entrou (usuário que não existe, senha errada, usuário desativado ou que não é mais admin, senha removida no meio).
 */
function respostaAdminRecusado(c: Context) {
  return responderErro(
    c,
    "nao_autenticado",
    "Não foi possível entrar com este usuário e esta senha",
  );
}

sessao.post(
  "/admin",
  exigirMesmaOrigem,
  limitarRequisicoes(LIMITE_LOGIN),
  limitarCorpo(LIMITE_CORPO_SESSAO_BYTES),
  validarJson(corpoEntrarComoAdminSchema),
  async (c) => {
    c.header("Cache-Control", "no-store");
    const { usuario, senha } = c.req.valid("json");
    const nome = normalizarUsuarioAdmin(usuario);
    const credencial =
      nome === "" ? null : await buscarCredencialAdmin(c.env.DB, nome);
    // O PBKDF2 roda sempre (com a senha fixa que nunca confere quando não há usuário): o tempo não diz se ele existe.
    const confere = await senhaConfere(
      senha,
      credencial ?? SENHA_ADMIN_QUE_NUNCA_CONFERE,
    );
    if (credencial === null || !confere) return respostaAdminRecusado(c);

    const agora = new Date();
    const idSessao = gerarSegredo();
    const idHash = await sha256Hex(idSessao);
    const anterior = lerCookieSessao(c);
    const expiraEm = await abrirSessaoDoAdmin(c.env.DB, {
      usuarioId: credencial.usuarioId,
      idHash,
      criadoEm: agora.toISOString(),
      expiraEm: new Date(
        agora.getTime() + VALIDADE_SESSAO_DIAS * DIA_MS,
      ).toISOString(),
      idHashAnterior: anterior === null ? null : await sha256Hex(anterior),
    });
    if (expiraEm === null) return respostaAdminRecusado(c);
    const aberta = await buscarSessao(c.env.DB, idHash, agora.toISOString());
    if (aberta === null) return respostaAdminRecusado(c);

    gravarCookieSessao(c, idSessao, expiraEm, agora);
    return c.json({ usuario: aberta.usuario } satisfies RespostaSessao, 200);
  },
);

sessao.get("/", exigirSessao(PAPEIS), (c) =>
  c.json({ usuario: c.var.usuario } satisfies RespostaSessao, 200),
);

sessao.post("/sair", exigirMesmaOrigem, async (c) => {
  const idSessao = lerCookieSessao(c);
  if (idSessao !== null)
    await apagarSessao(c.env.DB, await sha256Hex(idSessao));
  apagarCookieSessao(c);
  c.header("Cache-Control", "no-store");
  return c.body(null, 204);
});
