// As regras da campanha que a tela Acessos segue (D20): o acesso de discipuladores e de redes (desligado, não se
// gera nem se manda link do papel) e os modelos das mensagens do link pessoal (RIFA-032). Lidas de
// GET /api/admin/campanha ao abrir a tela; sem campanha (404) ou numa falha, valem os padrões do contrato (a API
// recusa com 409 `acao_desligada` o que estiver desligado, e a tela trata).
//
// Os padrões, as chaves e o preenchimento das mensagens vêm de regras.ts, o módulo do contrato sem zod (como
// calculos.ts); de api.ts, só tipos. O caminho é uma cópia, conferida por acessos-contrato.test.ts.
import { useEffect, useState } from "react";
import type { Campanha, PapelHierarquia } from "../../../shared/contracts";
import type { ROTAS } from "../../../shared/contracts/api";
import {
  ACESSO_PADRAO,
  CHAVE_DE_ACESSO_DO_PAPEL,
  MENSAGENS_PADRAO,
  acessoDoPapelLigado,
  problemasDoModelo,
  type ChaveDeAcesso,
  type TipoMensagem,
} from "../../../shared/contracts/regras";
import { ErroApi, api } from "../../lib/api";

export const CAMINHO_CAMPANHA: (typeof ROTAS)["obterCampanha"]["caminho"] =
  "/api/admin/campanha";

/** Onde se liga o acesso: a tela Campanha. */
export const CAMINHO_TELA_CAMPANHA = "/coordenacao/campanha";

export type Mensagens = Record<TipoMensagem, string>;

export type RegrasDosAcessos = {
  acesso: Record<ChaveDeAcesso, boolean>;
  mensagens: Mensagens;
};

export const REGRAS_PADRAO: RegrasDosAcessos = {
  acesso: { ...ACESSO_PADRAO },
  mensagens: { ...MENSAGENS_PADRAO },
};

/** As regras da campanha ativa; sem campanha (404), os padrões. */
export async function carregarRegras(
  opcoes: { signal?: AbortSignal } = {},
): Promise<RegrasDosAcessos> {
  try {
    const campanha = await api.get<Partial<Campanha>>(CAMINHO_CAMPANHA, opcoes);
    return {
      acesso: { ...ACESSO_PADRAO, ...campanha.acesso },
      mensagens: { ...MENSAGENS_PADRAO, ...campanha.mensagens },
    };
  } catch (erro) {
    if (erro instanceof ErroApi && erro.status === 404) return REGRAS_PADRAO;
    throw erro;
  }
}

/**
 * Um `{link}` colado no texto de antes (ex.: "https://outro.site/?u={link}"): o link pessoal viraria o fim de um
 * endereço de outro site. O WhatsApp de quem envia busca a prévia desse endereço ao montar a mensagem, e o token do
 * link sairia para esse site mesmo que ninguém toque nele (RIFA-041). Só vale o `{link}` no começo ou depois de
 * espaço, tabulação ou quebra de linha, como nos padrões. Desde a RIFA-042 o contrato também recusa esse modelo
 * (`problemasDoModelo`: a API não grava e a Campanha avisa) e só o admin edita as mensagens; esta trava continua
 * para um modelo gravado antes, independente do contrato.
 */
const LINK_COLADO = /[^ \t\r\n]\{link\}/;

/**
 * O modelo que a mensagem usa: o da campanha, ou o padrão do tipo se o gravado tiver problema (D20: nunca mandar
 * mensagem sem o link; RIFA-042: nem com o `{link}` colado ou outro endereço) ou o `{link}` colado no texto de antes
 * (LINK_COLADO).
 */
export function modeloDaMensagem(
  tipo: TipoMensagem,
  mensagens: Mensagens,
): string {
  const modelo = mensagens[tipo];
  return problemasDoModelo(tipo, modelo).length === 0 &&
    !LINK_COLADO.test(modelo)
    ? modelo
    : MENSAGENS_PADRAO[tipo];
}

/** O papel pode receber link agora? O líder não tem chave. */
export function acessoLigado(
  regras: RegrasDosAcessos,
  papel: PapelHierarquia,
): boolean {
  return acessoDoPapelLigado(regras.acesso, papel);
}

/** O nome do acesso de cada papel com chave, nos avisos ("o acesso dos discipuladores"). */
export const ACESSO_DO_PAPEL: Record<"discipulador" | "rede", string> = {
  discipulador: "o acesso dos discipuladores",
  rede: "o acesso das redes",
};

/** 409 `acao_desligada`: a chave do papel foi desligada na Campanha (com a tela aberta). */
export function ehAcaoDesligada(erro: unknown): boolean {
  return (
    erro instanceof ErroApi &&
    erro.status === 409 &&
    erro.codigo === "acao_desligada"
  );
}

/**
 * Lê as regras ao abrir a tela. `desligar(papel)` marca o acesso do papel como desligado depois de um 409
 * `acao_desligada` (desligaram na Campanha com a tela aberta).
 */
export function useRegrasDosAcessos() {
  const [regras, setRegras] = useState<RegrasDosAcessos>(REGRAS_PADRAO);
  useEffect(() => {
    const controle = new AbortController();
    carregarRegras({ signal: controle.signal }).then(
      (lidas) => {
        if (!controle.signal.aborted) setRegras(lidas);
      },
      // Falha ao ler: ficam os padrões; a API recusa com 409 o que estiver desligado.
      () => undefined,
    );
    return () => controle.abort();
  }, []);

  function desligar(papel: PapelHierarquia) {
    if (papel === "lider") return;
    const chave = CHAVE_DE_ACESSO_DO_PAPEL[papel];
    setRegras((atuais) => ({
      ...atuais,
      acesso: { ...atuais.acesso, [chave]: false },
    }));
  }

  return { regras, desligar };
}
