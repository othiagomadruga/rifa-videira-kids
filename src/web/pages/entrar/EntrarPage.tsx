import { useEffect, useRef, useState, type FormEvent } from "react";
import { useLocation, useNavigate } from "react-router";
import {
  Aviso,
  Button,
  Card,
  ComDica,
  IconeDaTela,
  Input,
  Loading,
  PageHeader,
  ComAjuda,
} from "../../components/ui";
import { ErroApi, mensagemDoErro } from "../../lib/api";
import {
  destinoDoPapel,
  esquecerDestino,
  lerEstadoEntrar,
  useSessao,
} from "../../lib/sessao";
import { DICAS, TEXTOS } from "./textos";
import "./entrar.css";
import { ajudaAberta } from "../ranking-publico/ajuda-sob-demanda";

type Envio =
  | { tipo: "pronto" }
  | { tipo: "entrando" }
  /** 401: célula ou senha que não conferem (a API não diz qual, nem se a célula existe). */
  | { tipo: "recusada" }
  /** 429: o limite de tentativas por minuto. */
  | { tipo: "muitas" }
  /** Sem resposta ou outra falha: dá para tentar de novo. */
  | { tipo: "falha"; erro: unknown };

type Faltas = { celula: boolean; senha: boolean };

// Login da célula (RIFA-064, D29): o nome da célula e a senha padrão abrem a sessão do líder dela, e a tela vai para a
// /minha (o efeito de baixo, quando a sessão chega). O nome e a senha só vão no corpo do POST, nunca na URL, no título
// ou num log. Campos vazios nem vão à API.
function EntrarComCelula() {
  const { entrarComSenha } = useSessao();
  const [celula, setCelula] = useState("");
  const [senha, setSenha] = useState("");
  const [faltas, setFaltas] = useState<Faltas>({ celula: false, senha: false });
  const [envio, setEnvio] = useState<Envio>({ tipo: "pronto" });
  const refResultado = useRef<HTMLDivElement>(null);
  const refCelula = useRef<HTMLInputElement>(null);
  const refSenha = useRef<HTMLInputElement>(null);
  // Trava síncrona contra o toque duplo (o estado só muda no próximo render).
  const enviando = useRef(false);
  const entrando = envio.tipo === "entrando";

  // Recusado ou com falha: o foco vai para a mensagem, que o leitor de tela lê.
  useEffect(() => {
    if (envio.tipo !== "pronto" && envio.tipo !== "entrando")
      refResultado.current?.focus();
  }, [envio]);

  async function aoEnviar(evento: FormEvent<HTMLFormElement>) {
    evento.preventDefault();
    if (enviando.current) return;
    const novasFaltas = {
      celula: celula.trim() === "",
      senha: senha.trim() === "",
    };
    setFaltas(novasFaltas);
    if (novasFaltas.celula || novasFaltas.senha) {
      (novasFaltas.celula ? refCelula : refSenha).current?.focus();
      return;
    }
    enviando.current = true;
    setEnvio({ tipo: "entrando" });
    try {
      await entrarComSenha(celula, senha);
    } catch (erro) {
      enviando.current = false;
      setEnvio(
        erro instanceof ErroApi && erro.status === 401
          ? { tipo: "recusada" }
          : erro instanceof ErroApi && erro.status === 429
            ? { tipo: "muitas" }
            : { tipo: "falha", erro },
      );
    }
  }

  return (
    <Card>
      <form className="entrar-formulario" noValidate onSubmit={aoEnviar}>
        <IconeDaTela nome="celula" />
        <ComAjuda
          texto={ajudaAberta("entrarComCelula")}
          idDoTitulo="entrar-celula"
        >
          <h2 id="entrar-celula" className="entrar-titulo">
            {TEXTOS.tituloSenha}
          </h2>
        </ComAjuda>
        <p>{TEXTOS.explicacaoSenha}</p>
        <Input
          ajuda={DICAS.celula}
          ref={refCelula}
          rotulo={TEXTOS.rotuloCelula}
          name="celula"
          autoComplete="username"
          autoCapitalize="words"
          spellCheck={false}
          maxLength={200}
          value={celula}
          erro={faltas.celula ? TEXTOS.faltaCelula : undefined}
          onChange={(evento) => {
            setCelula(evento.target.value);
            if (faltas.celula) setFaltas({ ...faltas, celula: false });
          }}
        />

        <Input
          ajuda={DICAS.senha}
          ref={refSenha}
          rotulo={TEXTOS.rotuloSenha}
          name="senha"
          type="password"
          autoComplete="current-password"
          autoCapitalize="none"
          spellCheck={false}
          maxLength={200}
          value={senha}
          erro={faltas.senha ? TEXTOS.faltaSenha : undefined}
          onChange={(evento) => {
            setSenha(evento.target.value);
            if (faltas.senha) setFaltas({ ...faltas, senha: false });
          }}
        />

        <div ref={refResultado} tabIndex={-1} className="entrar-resultado">
          {envio.tipo === "recusada" && (
            <Aviso tom="perigo" titulo={TEXTOS.recusada}>
              <p>{TEXTOS.recusadaDetalhe}</p>
            </Aviso>
          )}
          {envio.tipo === "muitas" && (
            <Aviso tom="alerta" titulo={TEXTOS.muitasTentativas}>
              <p>{TEXTOS.muitasTentativasDetalhe}</p>
            </Aviso>
          )}
          {envio.tipo === "falha" && (
            <Aviso tom="perigo" titulo={TEXTOS.falha}>
              <p>
                {mensagemDoErro(envio.erro)} Confira a internet e toque em
                Entrar de novo.
              </p>
            </Aviso>
          )}
        </div>
        {/* Entrando: aria-disabled (RIFA-045), no Tab e com a dica dizendo por quê; aoEnviar barra o segundo envio. */}
        <ComDica texto={entrando ? DICAS.entrando : DICAS.entrar}>
          <Button
            type="submit"
            larguraTotal
            aria-disabled={entrando || undefined}
          >
            {entrando ? "Entrando…" : "Entrar"}
          </Button>
        </ComDica>
      </form>
    </Card>
  );
}

// Como entrar (sem sessão): a célula com o nome e a senha padrão (RIFA-064) ou o link pessoal que chega no WhatsApp,
// sem senha. Quem já tem sessão vai direto para a área do papel (/coordenacao ou /minha), ou para a tela que tinha
// pedido, quando veio da guarda e a tela é da área dele.
export function EntrarPage() {
  const { estado, verificar } = useSessao();
  const navigate = useNavigate();
  const { de, motivo } = lerEstadoEntrar(useLocation().state);
  const { situacao } = estado;
  const papel = estado.situacao === "conectada" ? estado.usuario.papel : null;

  useEffect(() => {
    if (situacao === "desconhecida") verificar();
  }, [situacao, verificar]);

  useEffect(() => {
    if (papel === null) return;
    esquecerDestino();
    void navigate(destinoDoPapel(de, papel), { replace: true });
  }, [papel, de, navigate]);

  const conferindo =
    situacao === "desconhecida" ||
    situacao === "verificando" ||
    situacao === "conectada";

  return (
    <>
      <PageHeader
        titulo="Entrar"
        ajuda={ajudaAberta("entrar")}
        descricao="Coordenação, líderes e discipuladores da Rifa Videira Kids."
      />
      {conferindo ? (
        <Loading texto="Conferindo o seu acesso…" />
      ) : (
        <>
          {motivo === "saiu" && (
            <Aviso tom="sucesso" titulo="Você saiu do sistema neste aparelho.">
              <p>
                Para entrar de novo, use o nome da célula e a senha ou abra o
                seu link pessoal.
              </p>
            </Aviso>
          )}
          {motivo === "expirou" && (
            <Aviso tom="info" titulo="Sua sessão terminou.">
              <p>
                Para continuar, entre de novo com a sua célula ou pelo seu link
                pessoal.
              </p>
            </Aviso>
          )}
          <EntrarComCelula />
          <Card>
            <div className="entrar-explicacao">
              {/* O ícone do link no topo do cartão (RIFA-050), acima do título. */}
              <IconeDaTela nome="link" />
              <ComAjuda
                texto={ajudaAberta("comoEntrar")}
                idDoTitulo="entrar-como"
              >
                <h2 id="entrar-como" className="entrar-titulo">
                  Como entrar pelo link
                </h2>
              </ComAjuda>
              <p>
                Coordenação e discipuladores (e o líder que recebeu um) entram
                pelo <strong>link pessoal</strong>, sem senha. O link chega pelo{" "}
                <strong>WhatsApp</strong>, mandado pela coordenação.
              </p>
              <ol className="entrar-passos">
                <li>Abra a conversa do WhatsApp em que você recebeu o link.</li>
                <li>
                  Toque no link e, na página que abrir, toque em{" "}
                  <strong>Entrar</strong>.
                </li>
              </ol>
              {de && (
                <p>Depois de entrar, você volta para a tela em que estava.</p>
              )}
              <p>
                Não achou o link ou ele não funciona mais? Peça um link novo à
                coordenação.
              </p>
              <p className="entrar-nota">
                O link é só seu: não repasse. Quem tiver o link entra como você.
              </p>
            </div>
          </Card>
        </>
      )}
    </>
  );
}
