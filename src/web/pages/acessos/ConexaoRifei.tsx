import { useEffect, useRef, useState, type FormEvent } from "react";
import {
  Aviso,
  Button,
  Card,
  ComAjuda,
  ComDica,
  Dialogo,
  ErrorState,
  Input,
  Loading,
} from "../../components/ui";
import { ehFalhaDeConexao, mensagemDoErro } from "../../lib/api";
import { formatarData, formatarDataHora } from "../../lib/formatadores";
import {
  apagarConexaoRifei,
  obterConexaoRifei,
  salvarConexaoRifei,
  situacaoDaConexao,
  testarConexaoRifei,
  type EstadoConexaoRifei,
} from "./conexao-rifei-api";
import "./acessos-webhook.css";

// Aba "Conexão com a Rifei" de Acessos (RIFA-070, D32; só admin). O pastor cola aqui o token do login na Rifei, sem
// terminal: o sistema testa na Rifei (acha a campanha pelo slug) e guarda o token cifrado no servidor. A tela nunca
// recebe o token de volta: mostra só desde quando, os 4 últimos caracteres, o último teste e a recusa da Rifei. O
// token digitado fica só no campo até salvar (nunca em storage, URL ou log) e o campo se esvazia ao salvar.

type Carga = { estado: EstadoConexaoRifei | null; erro: unknown };
type Ocupado = "salvando" | "testando" | "apagando" | null;
type Mensagem = { tom: "sucesso" | "perigo"; texto: string };

/** Ajuda dos títulos e do campo (RIFA-066, D31): o que é, para que serve e um exemplo. A aba é `lazy`: o texto fica aqui. */
const AJUDA = {
  token:
    "O token que a Rifei dá à conta da campanha, para o sistema marcar pedidos pagos e ler os afiliados por você. Ex.: um texto longo copiado no passo 2.",
  colar:
    "Onde se cola (ou se troca) o token da Rifei. Serve para o sistema agir na Rifei pela campanha, sem ninguém entrar lá. Troque quando a Rifei derrubar o token.",
  comoPegar:
    "O passo a passo, no computador, para copiar o token na Rifei. Ex.: numa janela anônima, sem clicar em Sair no fim.",
  situacao:
    "Se o sistema está conectado à Rifei agora: se há token, desde quando e se o teste passou. Serve para saber, antes de marcar pagos, se a conexão funciona.",
} as const;

const DICAS = {
  token:
    "O texto longo copiado no passo 2. Ele fica guardado cifrado no servidor e nunca aparece de novo nesta tela.",
  salvar:
    "O sistema testa o token na Rifei (procura a campanha) e só guarda se a Rifei aceitar.",
  testar: "Pergunta à Rifei se o token ainda vale, sem mudar nada.",
  apagar:
    "Apaga o token guardado: o sistema para de marcar pagos na Rifei até você colar outro.",
  ocupado: "Espere a Rifei responder.",
  cancelar: "Fecha sem apagar nada.",
};

export function ConexaoRifei() {
  const [carga, setCarga] = useState<Carga>({ estado: null, erro: null });
  const [versao, setVersao] = useState(0);
  const [token, setToken] = useState("");
  const [ocupado, setOcupado] = useState<Ocupado>(null);
  const [mensagem, setMensagem] = useState<Mensagem | null>(null);
  const [confirmarApagar, setConfirmarApagar] = useState(false);
  const [anuncio, setAnuncio] = useState("");
  const emAndamento = useRef(false);
  const saida = useRef<AbortController | null>(null);

  useEffect(() => {
    const controle = new AbortController();
    saida.current = controle;
    return () => controle.abort();
  }, []);

  useEffect(() => {
    const controle = new AbortController();
    obterConexaoRifei({ signal: controle.signal }).then(
      (estado) => setCarga({ estado, erro: null }),
      (erro: unknown) => {
        if (!controle.signal.aborted)
          setCarga((atual) => ({ estado: atual.estado, erro }));
      },
    );
    return () => controle.abort();
  }, [versao]);

  /** Roda uma ação (uma por vez); em erro, mostra a mensagem e recarrega o estado (a recusa fica gravada). */
  async function executar(
    tipo: NonNullable<Ocupado>,
    acao: (sinal?: AbortSignal) => Promise<EstadoConexaoRifei>,
    sucesso: string,
  ) {
    if (emAndamento.current) return;
    emAndamento.current = true;
    const sinal = saida.current?.signal;
    setOcupado(tipo);
    setMensagem(null);
    try {
      const estado = await acao(sinal);
      if (sinal?.aborted) return;
      setCarga({ estado, erro: null });
      setMensagem({ tom: "sucesso", texto: sucesso });
      setAnuncio(sucesso);
    } catch (erro) {
      if (sinal?.aborted) return;
      const texto = mensagemDoErro(erro);
      setMensagem({ tom: "perigo", texto });
      setAnuncio(texto);
      setVersao((atual) => atual + 1);
    } finally {
      emAndamento.current = false;
      if (!sinal?.aborted) setOcupado(null);
    }
  }

  function salvar(evento: FormEvent) {
    evento.preventDefault();
    if (token.trim() === "" || ocupado) return;
    const colado = token;
    void executar(
      "salvando",
      async (signal) => {
        const resposta = await salvarConexaoRifei(colado, { signal });
        setToken("");
        return resposta.estado;
      },
      "Conectado: a Rifei aceitou o token e achou a campanha.",
    );
  }

  const { estado, erro } = carga;
  const semChave = estado !== null && !estado.chave_configurada;

  return (
    <div className="acessos-webhook">
      <p className="acessos-suave">
        Com a conexão, o sistema marca os pedidos como pagos na Rifei por você
        (Conferência → Extrato do banco). Ela usa o seu login na Rifei: cole o
        token aqui uma vez e troque quando a Rifei recusar.
      </p>
      <p className="visualmente-oculto" role="status">
        {anuncio}
      </p>
      {!estado && erro === null && (
        <Loading texto="Carregando a conexão com a Rifei…" />
      )}
      {!estado && erro !== null && (
        <ErrorState
          titulo="Não foi possível carregar a conexão com a Rifei."
          mensagem={mensagemDoErro(erro)}
          conexao={ehFalhaDeConexao(erro)}
          aoTentarDeNovo={() => {
            setCarga({ estado: null, erro: null });
            setVersao((atual) => atual + 1);
          }}
        />
      )}
      {estado && (
        <>
          <Situacao
            estado={estado}
            ocupado={ocupado}
            aoTestar={() =>
              void executar(
                "testando",
                async (signal) => (await testarConexaoRifei({ signal })).estado,
                "Conectado: a Rifei aceitou o token e achou a campanha.",
              )
            }
            aoApagar={() => setConfirmarApagar(true)}
          />
          {mensagem && (
            <Aviso
              tom={mensagem.tom}
              titulo={mensagem.tom === "sucesso" ? undefined : "Não deu certo"}
              anuncio="nenhum"
            >
              <p>{mensagem.texto}</p>
            </Aviso>
          )}
          <Card
            titulo={
              estado.origem === "tela" ? "Trocar o token" : "Colar o token"
            }
            ajuda={AJUDA.colar}
          >
            <form className="acessos-webhook__corpo" onSubmit={salvar}>
              {semChave && (
                <Aviso tom="perigo" anuncio="nenhum">
                  <p>
                    Falta a chave RIFEI_CHAVE_CIFRA no servidor: sem ela o token
                    não pode ser guardado. Peça ao suporte do sistema.
                  </p>
                </Aviso>
              )}
              <div className="acessos-webhook__passos">
                <ComAjuda
                  texto={AJUDA.comoPegar}
                  idDoTitulo="conexao-rifei-como-pegar"
                >
                  <h3
                    id="conexao-rifei-como-pegar"
                    className="acessos-webhook__subtitulo"
                  >
                    Como pegar o token na Rifei (no computador)
                  </h3>
                </ComAjuda>
                <ol>
                  <li>
                    Abra uma <strong>janela anônima</strong> do navegador
                    (Ctrl+Shift+N), entre em <strong>app.rifei.com.br</strong>{" "}
                    com a conta da campanha e faça o "não sou um robô".
                  </li>
                  <li>
                    Aperte <strong>F12</strong>, clique em{" "}
                    <strong>Console</strong>, cole a linha abaixo e aperte
                    Enter. O token vai para a área de transferência (não cole em
                    WhatsApp, e-mail ou chat):
                    <code className="acessos-webhook__codigo">
                      copy(decodeURIComponent(document.cookie.match(/auth_token=([^;]+)/)[1]))
                    </code>
                  </li>
                  <li>
                    Volte a esta tela, cole no campo abaixo e toque em{" "}
                    <strong>Salvar e testar</strong>.
                  </li>
                  <li>
                    <strong>Feche a janela anônima sem clicar em "Sair"</strong>
                    : o "Sair" da Rifei derruba o token.
                  </li>
                </ol>
              </div>
              <Input
                ajuda={AJUDA.token}
                rotulo="Token da Rifei"
                dica="Cole o texto inteiro, sem espaços."
                type="password"
                value={token}
                onChange={(evento) => setToken(evento.target.value)}
                autoComplete="off"
                autoCapitalize="off"
                spellCheck={false}
                disabled={semChave}
              />

              <div className="acessos-webhook__acao">
                <ComDica
                  texto={ocupado === "salvando" ? DICAS.ocupado : DICAS.salvar}
                >
                  <Button
                    type="submit"
                    aria-disabled={
                      ocupado !== null || token.trim() === "" || semChave
                        ? true
                        : undefined
                    }
                  >
                    {ocupado === "salvando" ? "Testando…" : "Salvar e testar"}
                  </Button>
                </ComDica>
              </div>
            </form>
          </Card>
        </>
      )}
      {confirmarApagar && (
        <Dialogo
          aberto
          papel="alertdialog"
          titulo="Apagar o token da Rifei?"
          descricao="O sistema para de marcar pagos na Rifei até você colar outro."
          aoFechar={() => {
            if (!ocupado) setConfirmarApagar(false);
          }}
          dicaFechar={DICAS.cancelar}
          rodape={
            <>
              <ComDica texto={DICAS.cancelar}>
                <Button
                  variante="secundario"
                  aria-disabled={ocupado ? true : undefined}
                  onClick={() => {
                    if (!ocupado) setConfirmarApagar(false);
                  }}
                >
                  Cancelar
                </Button>
              </ComDica>
              <ComDica texto={ocupado ? DICAS.ocupado : DICAS.apagar}>
                <Button
                  variante="perigo"
                  aria-disabled={ocupado ? true : undefined}
                  onClick={() =>
                    void executar(
                      "apagando",
                      (signal) => apagarConexaoRifei({ signal }),
                      "Token apagado.",
                    ).then(() => setConfirmarApagar(false))
                  }
                >
                  {ocupado === "apagando" ? "Apagando…" : "Apagar o token"}
                </Button>
              </ComDica>
            </>
          }
        >
          <p>
            Para marcar de novo pelo sistema, será preciso pegar outro token na
            Rifei e colar aqui.
          </p>
        </Dialogo>
      )}
    </div>
  );
}

/** A situação em uma frase e os dados que a tela pode mostrar (nunca o token). */
function Situacao({
  estado,
  ocupado,
  aoTestar,
  aoApagar,
}: {
  estado: EstadoConexaoRifei;
  ocupado: Ocupado;
  aoTestar: () => void;
  aoApagar: () => void;
}) {
  const situacao = situacaoDaConexao(estado);
  return (
    <Card titulo="Situação" ajuda={AJUDA.situacao}>
      <div className="acessos-webhook__corpo">
        <Aviso tom={situacao.tom} anuncio="nenhum">
          <p>{situacao.texto}</p>
        </Aviso>
        {estado.origem === "tela" && estado.conectado_em && estado.final && (
          <dl className="acessos-dados">
            <div>
              <dt>Conectado desde</dt>
              <dd>
                {formatarData(estado.conectado_em)}, termina em …{estado.final}
              </dd>
            </div>
            {estado.testado_em && (
              <div>
                <dt>Último teste ok</dt>
                <dd>{formatarDataHora(estado.testado_em)}</dd>
              </div>
            )}
            {estado.expira_em && (
              <div>
                <dt>O token vale até</dt>
                <dd>{formatarDataHora(estado.expira_em)}</dd>
              </div>
            )}
          </dl>
        )}
        {estado.origem !== null && (
          <div className="acessos-webhook__acao">
            <ComDica texto={ocupado ? DICAS.ocupado : DICAS.testar}>
              <Button
                variante="secundario"
                aria-disabled={ocupado ? true : undefined}
                onClick={() => {
                  if (!ocupado) aoTestar();
                }}
              >
                {ocupado === "testando" ? "Testando…" : "Testar conexão"}
              </Button>
            </ComDica>
            {estado.origem === "tela" && (
              <ComDica texto={ocupado ? DICAS.ocupado : DICAS.apagar}>
                <Button
                  variante="secundario"
                  aria-disabled={ocupado ? true : undefined}
                  onClick={() => {
                    if (!ocupado) aoApagar();
                  }}
                >
                  Apagar o token
                </Button>
              </ComDica>
            )}
          </div>
        )}
      </div>
    </Card>
  );
}
