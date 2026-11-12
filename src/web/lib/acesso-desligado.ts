// O 403 `acesso_desligado` (RIFA-029, D20): a coordenação desligou na Campanha o acesso de discipuladores (ou de
// redes). Vem do `POST /api/sessao` (link válido, mas a sessão não é criada) e de todo `/api/minha/*` (a sessão
// continua). Não é link inválido: o link e a sessão voltam a valer quando a chave volta. A página de acesso
// (/acesso) e a visão individual (/minha) mostram o mesmo texto.
import type { PapelComChaveDeAcesso } from "../../shared/contracts/regras";
import { ErroApi } from "./api";

/** Quem perdeu o acesso, no plural, como a frase pede. */
const PAPEL_NO_PLURAL: Record<PapelComChaveDeAcesso, string> = {
  discipulador: "discipuladores",
  rede: "redes",
};

/** 403 `acesso_desligado`. */
export function ehAcessoDesligado(erro: unknown): erro is ErroApi {
  return (
    erro instanceof ErroApi &&
    erro.status === 403 &&
    erro.codigo === "acesso_desligado"
  );
}

/** O papel dos `detalhes` do 403 (`{ papel }`); null se não veio ou é outro. */
function papelDoErro(erro: ErroApi): PapelComChaveDeAcesso | null {
  const papel = (erro.detalhes as { papel?: unknown } | null | undefined)
    ?.papel;
  return papel === "discipulador" || papel === "rede" ? papel : null;
}

/** "A coordenação desligou o acesso de discipuladores por enquanto." (ou de redes). */
export function textoAcessoDesligado(erro: ErroApi): string {
  const papel = papelDoErro(erro);
  return papel
    ? `A coordenação desligou o acesso de ${PAPEL_NO_PLURAL[papel]} por enquanto.`
    : "A coordenação desligou este acesso por enquanto.";
}
