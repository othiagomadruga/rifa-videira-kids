import { useEffect, useRef, useState, type RefObject } from "react";
import type {
  CredencialWebhook,
  EstadoTokenWebhook,
} from "../../../shared/contracts";
import {
  Aviso,
  Badge,
  Button,
  Card,
  ComDica,
  Dialogo,
  ErrorState,
  Loading,
  Textarea,
  type TomBadge,
} from "../../components/ui";
import { ehFalhaDeConexao, mensagemDoErro } from "../../lib/api";
import { formatarDataHora } from "../../lib/formatadores";
import {
  credencialEmUso,
  gerarTokenWebhook,
  obterEstadoToken,
} from "./webhook-api";
import { DICAS } from "./textos";
import "./acessos-webhook.css";

// Aba "Webhook da Rifei" de Acessos (RIFA-039, D21; só admin, como a tela). Mostra qual credencial autentica o
// webhook (o token gerado aqui, o segredo do Worker ou nenhuma), desde quando e o último uso, a URL para colar na
// Rifei e o botão que gera um token novo. O token só existe na resposta do POST: fica só no estado desta aba (nunca
// em storage, URL, histórico ou log), aparece uma vez com "Copiar" e some quando a tela sai (ou ao gerar outro).
// Carregada à parte (lazy), com o próprio CSS, quando o admin abre a aba.

/** Estado carregado e o erro da última carga (com estado, o erro é de uma recarga). */
type Carga = { estado: EstadoTokenWebhook | null; erro: unknown };
/** O token que acabou de ser gerado; `geracao` muda a cada um (leva o foco ao campo de novo). */
type TokenMostrado = { token: string; geracao: number };
type Copia = { campo: "token" | "url"; resultado: "copiado" | "falhou" };

const CREDENCIAL: Record<
  CredencialWebhook | "nenhuma",
  { rotulo: string; tom: TomBadge }
> = {
  tela: { rotulo: "Token gerado no site", tom: "sucesso" },
  segredo: { rotulo: "Segredo do Worker", tom: "info" },
  nenhuma: { rotulo: "Nenhuma", tom: "perigo" },
};

const TEXTO_COPIA: Record<
  Copia["campo"],
  Record<Copia["resultado"], string>
> = {
  token: {
    copiado: "Token copiado. Cole no campo Token do webhook na Rifei.",
    falhou:
      "Não deu para copiar sozinho: o token ficou selecionado no campo. Copie pelo menu do celular.",
  },
  url: {
    copiado: "URL copiada. Cole no campo URL do webhook na Rifei.",
    falhou:
      "Não deu para copiar sozinho: a URL ficou selecionada no campo. Copie pelo menu do celular.",
  },
};

const ANUNCIO_GERADO =
  "Token do webhook gerado. Ele só aparece agora: copie e cole na Rifei.";

const ID_TOKEN = "acessos-webhook-token";
const ID_AVISO_TOKEN = "acessos-webhook-token-aviso";

export function WebhookRifei() {
  const [carga, setCarga] = useState<Carga>({ estado: null, erro: null });
  const [versao, setVersao] = useState(0);
  const [gerando, setGerando] = useState(false);
  /** A confirmação aberta: a credencial que deixa de valer se gerar. */
  const [confirmacao, setConfirmacao] = useState<CredencialWebhook | null>(
    null,
  );
  const [erroAoGerar, setErroAoGerar] = useState<string | null>(null);
  const [mostrado, setMostrado] = useState<TokenMostrado | null>(null);
  const [copia, setCopia] = useState<Copia | null>(null);
  const [anuncio, setAnuncio] = useState("");
  // Trava síncrona: um POST por vez, mesmo com toque duplo (o estado só muda no próximo render).
  const emAndamento = useRef(false);
  // Cancela o que estiver em andamento quando a tela sai (o token de uma resposta atrasada não aparece).
  const saida = useRef<AbortController | null>(null);
  const refToken = useRef<HTMLTextAreaElement>(null);
  const refCopiarToken = useRef<HTMLButtonElement>(null);
  const refUrl = useRef<HTMLTextAreaElement>(null);
  // Quantos tokens esta aba gerou: um GET que saiu antes de uma geração não troca o estado novo pelo velho.
  const geracoes = useRef(0);

  useEffect(() => {
    const controle = new AbortController();
    saida.current = controle;
    return () => controle.abort();
  }, []);

  useEffect(() => {
    const controle = new AbortController();
    const antes = geracoes.current;
    obterEstadoToken({ signal: controle.signal }).then(
      (estado) => {
        if (geracoes.current === antes) setCarga({ estado, erro: null });
      },
      (erro: unknown) => {
        if (!controle.signal.aborted && geracoes.current === antes)
          setCarga((atual) => ({ estado: atual.estado, erro }));
      },
    );
    return () => controle.abort();
  }, [versao]);

  // "Copiar token" recebe o foco, como o "Copiar link" do link de acesso: o leitor de tela lê o botão e, como
  // descrição, o aviso "Este token só aparece agora" (o token em si não é lido sozinho). A descrição garante o
  // aviso também depois da confirmação, quando a região viva muda ainda sob o `inert` do diálogo.
  useEffect(() => {
    if (mostrado) refCopiarToken.current?.focus();
  }, [mostrado]);

  function recarregar() {
    setVersao((atual) => atual + 1);
  }

  function tentarDeNovo() {
    setCarga({ estado: null, erro: null });
    recarregar();
  }

  /** "Gerar token do webhook": com credencial vigente, pede a confirmação antes de qualquer POST. */
  function pedirGeracao() {
    if (emAndamento.current) return;
    setErroAoGerar(null);
    const vigente = carga.estado?.vigente ?? null;
    if (vigente) setConfirmacao(vigente);
    else void gerar(false);
  }

  async function gerar(substituir: boolean) {
    if (emAndamento.current) return;
    emAndamento.current = true;
    const sinal = saida.current?.signal;
    setGerando(true);
    setErroAoGerar(null);
    try {
      const resposta = await gerarTokenWebhook(substituir, { signal: sinal });
      if (sinal?.aborted) return;
      geracoes.current += 1;
      setCarga({ estado: resposta.estado, erro: null });
      setMostrado((atual) => ({
        token: resposta.token,
        geracao: (atual?.geracao ?? 0) + 1,
      }));
      setCopia(null);
      setConfirmacao(null);
      setAnuncio(ANUNCIO_GERADO);
    } catch (falha) {
      if (sinal?.aborted) return;
      const emUso = substituir ? null : credencialEmUso(falha);
      if (emUso) {
        // Outra aba (ou outra pessoa) gerou no meio: o estado está velho. Recarrega e pede a confirmação.
        setConfirmacao(emUso);
        recarregar();
      } else {
        setErroAoGerar(mensagemDoErro(falha));
      }
    } finally {
      emAndamento.current = false;
      if (!sinal?.aborted) setGerando(false);
    }
  }

  async function copiar(campo: Copia["campo"], texto: string) {
    const elemento = campo === "token" ? refToken.current : refUrl.current;
    let resultado: Copia["resultado"] = "copiado";
    try {
      await navigator.clipboard.writeText(texto);
    } catch {
      elemento?.focus();
      elemento?.select();
      resultado = "falhou";
    }
    setCopia({ campo, resultado });
    setAnuncio(TEXTO_COPIA[campo][resultado]);
  }

  const { estado, erro } = carga;

  return (
    <div className="acessos-webhook">
      <p className="acessos-suave">
        A Rifei avisa o sistema de cada venda pelo webhook. O token prova que o
        aviso veio da Rifei: gere aqui e cole direto na Rifei, sem mandar por
        WhatsApp, e-mail ou chat.
      </p>
      {/* Região viva fixa: anuncia o token gerado e o resultado de copiar. */}
      <p className="visualmente-oculto" role="status">
        {anuncio}
      </p>
      {!estado && erro === null && (
        <Loading texto="Carregando o token do webhook…" />
      )}
      {!estado && erro !== null && (
        <ErrorState
          titulo="Não foi possível carregar o token do webhook."
          mensagem={mensagemDoErro(erro)}
          conexao={ehFalhaDeConexao(erro)}
          aoTentarDeNovo={tentarDeNovo}
        />
      )}
      {estado && erro !== null && (
        <Aviso
          tom="perigo"
          titulo="Não foi possível atualizar a situação do webhook"
          acao={
            <ComDica texto={DICAS.tentarDeNovoLista}>
              <Button variante="secundario" onClick={recarregar}>
                Tentar de novo
              </Button>
            </ComDica>
          }
        >
          <p>{mensagemDoErro(erro)}</p>
        </Aviso>
      )}
      {estado && (
        <>
          <Situacao estado={estado} />
          <Card titulo="Colar na Rifei" className="acessos-webhook__rifei">
            <div className="acessos-webhook__corpo">
              <div className="acessos-webhook__campo">
                <ComDica texto={DICAS.campoUrl}>
                  <Textarea
                    ref={refUrl}
                    rotulo="URL do webhook"
                    dica="Vai no campo URL do webhook na Rifei."
                    value={estado.url}
                    readOnly
                    rows={2}
                    spellCheck={false}
                    className="acessos-url"
                    onFocus={(evento) => evento.currentTarget.select()}
                  />
                </ComDica>
                <ComDica texto={DICAS.copiarUrl}>
                  <Button
                    variante="secundario"
                    onClick={() => void copiar("url", estado.url)}
                  >
                    Copiar URL
                  </Button>
                </ComDica>
                {copia?.campo === "url" && (
                  <p className="acessos-copia">
                    {TEXTO_COPIA.url[copia.resultado]}
                  </p>
                )}
              </div>
              {mostrado ? (
                <TokenGerado
                  token={mostrado.token}
                  refToken={refToken}
                  refCopiar={refCopiarToken}
                  copia={copia?.campo === "token" ? copia.resultado : null}
                  aoCopiar={() => void copiar("token", mostrado.token)}
                />
              ) : (
                <p className="acessos-suave">
                  Deixe a Rifei aberta: o token aparece uma vez só, logo depois
                  de gerar, para você copiar e colar lá.
                </p>
              )}
              {erroAoGerar && !confirmacao && (
                <Aviso tom="perigo" titulo="Não foi possível gerar o token">
                  <p>{erroAoGerar}</p>
                </Aviso>
              )}
              <div className="acessos-webhook__acao">
                <ComDica
                  texto={
                    gerando
                      ? DICAS.gerandoToken
                      : estado.vigente
                        ? DICAS.gerarTokenComVigente
                        : DICAS.gerarToken
                  }
                >
                  <Button
                    variante={mostrado ? "secundario" : "primario"}
                    aria-disabled={gerando || undefined}
                    onClick={pedirGeracao}
                  >
                    {gerando && !confirmacao
                      ? "Gerando…"
                      : "Gerar token do webhook"}
                  </Button>
                </ComDica>
              </div>
            </div>
          </Card>
        </>
      )}
      {confirmacao && (
        <ConfirmarTroca
          vigente={confirmacao}
          gerando={gerando}
          erro={erroAoGerar}
          aoCancelar={() => {
            if (emAndamento.current) return;
            setConfirmacao(null);
            setErroAoGerar(null);
          }}
          aoConfirmar={() => void gerar(true)}
        />
      )}
    </div>
  );
}

/** Qual credencial vale, desde quando e o último uso, com a explicação de cada caso. */
function Situacao({ estado }: { estado: EstadoTokenWebhook }) {
  const credencial = CREDENCIAL[estado.vigente ?? "nenhuma"];
  return (
    <Card titulo="Situação">
      <div className="acessos-webhook__corpo">
        <dl className="acessos-dados">
          <div>
            <dt>Credencial que vale</dt>
            <dd>
              <Badge tom={credencial.tom}>{credencial.rotulo}</Badge>
            </dd>
          </div>
          {estado.vigente === "tela" && estado.gerado_em && (
            <div>
              <dt>Gerado em</dt>
              <dd>{formatarDataHora(estado.gerado_em)}</dd>
            </div>
          )}
          {estado.vigente === "segredo" && (
            <div>
              <dt>Desde</dt>
              <dd>sem registro (gravado pelo terminal)</dd>
            </div>
          )}
          {estado.vigente !== null && (
            <div>
              <dt>Último uso</dt>
              <dd>
                {estado.ultimo_uso_em
                  ? formatarDataHora(estado.ultimo_uso_em)
                  : "ainda não usado"}
              </dd>
            </div>
          )}
        </dl>
        <ExplicacaoDaSituacao estado={estado} />
      </div>
    </Card>
  );
}

function ExplicacaoDaSituacao({ estado }: { estado: EstadoTokenWebhook }) {
  if (estado.vigente === null)
    return (
      <Aviso
        tom="perigo"
        titulo="A Rifei não consegue entregar as vendas"
        anuncio="nenhum"
      >
        <p>
          Sem token, o sistema recusa todo aviso de venda da Rifei. Gere o token
          abaixo e cole na Rifei, junto com a URL.
        </p>
      </Aviso>
    );
  const semUso = estado.ultimo_uso_em === null;
  if (estado.vigente === "segredo")
    return (
      <p className="acessos-suave">
        Vale o segredo do Worker, gravado pelo terminal (wrangler).
        {semUso && " Nenhuma venda chegou com ele ainda."} Gerar um token aqui
        faz o segredo parar de valer.
      </p>
    );
  return (
    <p className="acessos-suave">
      Vale o token gerado neste site.
      {semUso &&
        " A Rifei ainda não mandou nenhuma venda com ele: se você já colou o token na Rifei e já houve um pedido, o token de lá não é este. Gere outro e cole de novo."}
      {estado.segredo_configurado &&
        " O segredo do Worker também existe, mas não vale enquanto houver um token gerado aqui."}
    </p>
  );
}

/** O token, uma vez só: o campo (só leitura), "Copiar token" e o passo a passo da Rifei. */
function TokenGerado({
  token,
  refToken,
  refCopiar,
  copia,
  aoCopiar,
}: {
  token: string;
  refToken: RefObject<HTMLTextAreaElement | null>;
  refCopiar: RefObject<HTMLButtonElement | null>;
  copia: Copia["resultado"] | null;
  aoCopiar: () => void;
}) {
  return (
    <div className="acessos-webhook__token">
      <Aviso
        id={ID_AVISO_TOKEN}
        tom="alerta"
        titulo="Este token só aparece agora."
        anuncio="nenhum"
      >
        <p>
          Copie e cole na Rifei antes de sair desta tela: depois, só gerando
          outro. Não guarde cópia nem mande para ninguém.
        </p>
      </Aviso>
      <div className="acessos-webhook__campo">
        <ComDica texto={DICAS.campoToken}>
          <Textarea
            ref={refToken}
            id={ID_TOKEN}
            rotulo="Token do webhook"
            dica="Vai no campo Token do webhook na Rifei."
            value={token}
            readOnly
            rows={3}
            spellCheck={false}
            autoCapitalize="off"
            autoComplete="off"
            translate="no"
            className="acessos-url"
            onFocus={(evento) => evento.currentTarget.select()}
          />
        </ComDica>
        <ComDica texto={DICAS.copiarToken}>
          <Button
            ref={refCopiar}
            aria-describedby={ID_AVISO_TOKEN}
            onClick={aoCopiar}
          >
            Copiar token
          </Button>
        </ComDica>
        {copia && <p className="acessos-copia">{TEXTO_COPIA.token[copia]}</p>}
      </div>
      <div className="acessos-webhook__passos">
        <h3 className="acessos-webhook__subtitulo">Como colar na Rifei</h3>
        <ol>
          <li>
            Na Rifei, toque no ícone do usuário e em{" "}
            <strong>Integrações</strong>.
          </li>
          <li>
            Role até <strong>Outro</strong> e toque em{" "}
            <strong>Adicionar</strong> no webhook (ou edite o que já existe).
          </li>
          <li>
            Cole a <strong>URL</strong> e o <strong>Token</strong> desta tela e
            marque os três eventos: Novo pedido, Pedido pago e Pedido expirado.
          </li>
          <li>
            Toque em <strong>Adicionar</strong> (ou salve). Depois da primeira
            venda, o último uso aparece aqui em Situação.
          </li>
        </ol>
      </div>
    </div>
  );
}

/** A confirmação da troca: a credencial vigente para de valer na hora e as vendas param até colar o novo. */
function ConfirmarTroca({
  vigente,
  gerando,
  erro,
  aoCancelar,
  aoConfirmar,
}: {
  vigente: CredencialWebhook;
  gerando: boolean;
  erro: string | null;
  aoCancelar: () => void;
  aoConfirmar: () => void;
}) {
  return (
    <Dialogo
      aberto
      papel="alertdialog"
      titulo={
        vigente === "tela"
          ? "Gerar um token novo?"
          : "Trocar o segredo do Worker por um token do site?"
      }
      descricao={
        vigente === "tela"
          ? "O token atual para de valer na hora."
          : "O segredo do Worker para de valer na hora."
      }
      aoFechar={aoCancelar}
      dicaFechar={DICAS.cancelarTroca}
      rodape={
        <>
          <ComDica texto={gerando ? DICAS.gerandoToken : DICAS.cancelarTroca}>
            <Button
              variante="secundario"
              aria-disabled={gerando || undefined}
              onClick={aoCancelar}
            >
              Cancelar
            </Button>
          </ComDica>
          <ComDica texto={gerando ? DICAS.gerandoToken : DICAS.confirmarTroca}>
            <Button
              variante="perigo"
              aria-disabled={gerando || undefined}
              onClick={aoConfirmar}
            >
              {gerando ? "Gerando…" : "Gerar token novo"}
            </Button>
          </ComDica>
        </>
      }
    >
      <div className="acessos-formulario">
        <p>
          As vendas param de chegar ao sistema até você colar o token novo na
          Rifei: as que chegarem nesse meio-tempo se perdem (dá para recuperar
          pela Conferência). Deixe a Rifei aberta e faça a troca fora do horário
          de pico.
        </p>
        {erro && (
          <Aviso tom="perigo" titulo="Não foi possível gerar o token">
            <p>{erro}</p>
          </Aviso>
        )}
      </div>
    </Dialogo>
  );
}
