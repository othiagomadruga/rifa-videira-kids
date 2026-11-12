import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { Navigate, useNavigate, useParams } from "react-router";
import { Aviso, Button, Card, ComDica, PageHeader } from "../../components/ui";
import {
  ehAcessoDesligado,
  textoAcessoDesligado,
} from "../../lib/acesso-desligado";
import { ErroApi, mensagemDoErro } from "../../lib/api";
import { destinoDoPapel, retirarDestino, useSessao } from "../../lib/sessao";
import { DICAS } from "./textos";
import "./acesso.css";

/** PREFIXO_LINK_ACESSO sem a barra final: o endereço que fica no lugar do link (cópia do contrato). */
export const CAMINHO_ACESSO = "/acesso";
/** FORMATO_TOKEN_ACESSO: 43 caracteres base64url (cópia; veja acessos/acessos-contrato.test.ts). */
export const FORMATO_TOKEN = /^[A-Za-z0-9_-]{43}$/;

type Estado =
  | { tipo: "pronto" }
  | { tipo: "entrando" }
  /** 401: link inexistente, vencido, revogado ou de alguém desativado. */
  | { tipo: "invalido" }
  /**
   * 403 `acesso_desligado` (D20): o link vale, mas a coordenação desligou o acesso do papel na Campanha. Não é link
   * inválido: o "Entrar" continua, para quando o acesso voltar.
   */
  | { tipo: "desligado"; texto: string }
  /** Sem resposta ou outra falha: dá para tocar em Entrar de novo. */
  | { tipo: "falha"; erro: unknown };

// Página do link pessoal (/acesso/<token>) da coordenação e de líderes, discipuladores e redes. O token fica
// só na memória desta tela: ao abrir, sai da barra de endereço e do histórico (a entrada vira /acesso), e não
// vai para título, log nem outro lugar. A sessão só nasce no toque em "Entrar" (POST /api/sessao): o preview
// de link do WhatsApp abre a URL, mas não toca no botão. Depois de entrar, cada papel vai para a sua área
// (/coordenacao ou /minha; o destino guardado só vale se for da área do papel). Sem token (ex.: /acesso
// recarregado), vai para /entrar.
export function AcessoPage() {
  const textoDaUrl = useParams()["*"] ?? "";
  // Lido uma vez, ao abrir; logo depois o endereço já não tem o token.
  const [token] = useState(() => textoDaUrl.replace(/\/$/, ""));
  const [estado, setEstado] = useState<Estado>({ tipo: "pronto" });
  const navigate = useNavigate();
  const { entrar } = useSessao();
  const refResultado = useRef<HTMLDivElement>(null);
  // Trava síncrona contra toque duplo (o estado só muda no próximo render).
  const enviando = useRef(false);

  // Antes de a página aparecer: troca a entrada do histórico /acesso/<token> por /acesso.
  useLayoutEffect(() => {
    if (textoDaUrl !== "") void navigate(CAMINHO_ACESSO, { replace: true });
  }, [textoDaUrl, navigate]);

  // Falhou ao entrar: o foco vai para a mensagem (com o link inválido, o botão some).
  useEffect(() => {
    if (
      estado.tipo === "invalido" ||
      estado.tipo === "desligado" ||
      estado.tipo === "falha"
    ) {
      refResultado.current?.focus();
    }
  }, [estado.tipo]);

  if (token === "") return <Navigate to="/entrar" replace />;

  async function aoEntrar() {
    if (enviando.current) return;
    enviando.current = true;
    setEstado({ tipo: "entrando" });
    try {
      const usuario = await entrar(token);
      void navigate(destinoDoPapel(retirarDestino(), usuario.papel), {
        replace: true,
      });
    } catch (erro) {
      enviando.current = false;
      setEstado(
        erro instanceof ErroApi && erro.status === 401
          ? { tipo: "invalido" }
          : ehAcessoDesligado(erro)
            ? { tipo: "desligado", texto: textoAcessoDesligado(erro) }
            : { tipo: "falha", erro },
      );
    }
  }

  const linkCompleto = FORMATO_TOKEN.test(token);
  const podeEntrar = linkCompleto && estado.tipo !== "invalido";
  const entrando = estado.tipo === "entrando";

  return (
    <div className="acesso">
      <PageHeader
        titulo="Entrar no sistema da Rifa Videira Kids"
        descricao="Pelo seu link pessoal, sem senha."
      />
      <Card>
        <div className="acesso-cartao">
          {podeEntrar && (
            <p>
              Toque em <strong>Entrar</strong> para continuar. Depois disso,
              este aparelho fica conectado e você não precisa abrir o link toda
              vez.
            </p>
          )}
          <div ref={refResultado} tabIndex={-1} className="acesso-resultado">
            {!linkCompleto && (
              <Aviso tom="perigo" titulo="Este link está incompleto.">
                <p>
                  Abra de novo a mensagem do WhatsApp e toque no link inteiro.
                  Se não der certo, peça um link novo à coordenação.
                </p>
              </Aviso>
            )}
            {estado.tipo === "invalido" && (
              <Aviso
                tom="perigo"
                titulo="Este link não vale mais: peça um link novo à coordenação."
              >
                <p>
                  Ele pode ter vencido ou sido revogado, ou o acesso pode ter
                  sido desativado.
                </p>
              </Aviso>
            )}
            {estado.tipo === "desligado" && (
              <Aviso tom="alerta" titulo={estado.texto}>
                <p>
                  O seu link continua valendo: quando a coordenação ligar o
                  acesso de novo, toque em Entrar.
                </p>
              </Aviso>
            )}
            {estado.tipo === "falha" && (
              <Aviso tom="perigo" titulo="Não foi possível entrar agora.">
                <p>
                  {mensagemDoErro(estado.erro)} Confira a internet e toque em
                  Entrar de novo.
                </p>
              </Aviso>
            )}
          </div>
          {podeEntrar && (
            <ComDica texto={entrando ? DICAS.entrando : DICAS.entrar}>
              <Button
                larguraTotal
                disabled={entrando}
                onClick={() => void aoEntrar()}
              >
                {entrando ? "Entrando…" : "Entrar"}
              </Button>
            </ComDica>
          )}
          <p className="acesso-nota">
            O link é só seu: não repasse. Quem tiver o link entra como você.
          </p>
        </div>
      </Card>
    </div>
  );
}
