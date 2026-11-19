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
  type NomeIcone,
} from "../../components/ui";
import { ErroApi, mensagemDoErro } from "../../lib/api";
import {
  destinoDoPapel,
  esquecerDestino,
  lerEstadoEntrar,
  useSessao,
} from "../../lib/sessao";
import {
  DICAS,
  DICAS_ADMIN,
  TEXTOS,
  TEXTOS_ADMIN,
  type DicasFormulario,
  type TextosFormulario,
} from "./textos";
import "./entrar.css";
import { ajudaAberta } from "../ranking-publico/ajuda-sob-demanda";

type Envio =
  | { tipo: "pronto" }
  | { tipo: "entrando" }
  /** 401: os dados não conferem (a API não diz qual, nem se a célula ou o usuário existe). */
  | { tipo: "recusada" }
  /** 429: o limite de tentativas por minuto. */
  | { tipo: "muitas" }
  /** Sem resposta ou outra falha: dá para tentar de novo. */
  | { tipo: "falha"; erro: unknown };

type Faltas = { nome: boolean; senha: boolean };

/** O que muda entre o login da célula (RIFA-064) e o do admin (RIFA-073): os textos, o ícone e a chamada à API. */
type ConfigFormulario = {
  icone: NomeIcone;
  textos: TextosFormulario;
  dicas: DicasFormulario;
  /** A ajuda do título do formulário (RIFA-066). */
  ajudaDoTitulo: "entrarComCelula" | "entrarComoAdmin";
  /** O campo do nome (a célula ou o usuário). */
  campoNome: {
    name: string;
    autoCapitalize: "words" | "none";
  };
  entrarCom: (nome: string, senha: string) => Promise<unknown>;
};

// Login com nome e senha: a célula (RIFA-064, D29) abre a sessão do líder dela; o admin (RIFA-073, D33), a sessão do
// admin. A tela vai para a área do papel pelo efeito de EntrarPage, quando a sessão chega. O nome e a senha só vão no
// corpo do POST, nunca na URL, no título ou num log. Campos vazios nem vão à API.
function FormularioDeEntrada({
  icone,
  textos,
  dicas,
  ajudaDoTitulo,
  campoNome,
  entrarCom,
}: ConfigFormulario) {
  const [nome, setNome] = useState("");
  const [senha, setSenha] = useState("");
  const [faltas, setFaltas] = useState<Faltas>({ nome: false, senha: false });
  const [envio, setEnvio] = useState<Envio>({ tipo: "pronto" });
  const refResultado = useRef<HTMLDivElement>(null);
  const refNome = useRef<HTMLInputElement>(null);
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
      nome: nome.trim() === "",
      senha: senha.trim() === "",
    };
    setFaltas(novasFaltas);
    if (novasFaltas.nome || novasFaltas.senha) {
      (novasFaltas.nome ? refNome : refSenha).current?.focus();
      return;
    }
    enviando.current = true;
    setEnvio({ tipo: "entrando" });
    try {
      await entrarCom(nome, senha);
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
    <form className="entrar-formulario" noValidate onSubmit={aoEnviar}>
      <IconeDaTela nome={icone} />
      <ComAjuda
        texto={ajudaAberta(ajudaDoTitulo)}
        idDoTitulo="entrar-formulario"
      >
        <h2 id="entrar-formulario" className="entrar-titulo">
          {textos.tituloSenha}
        </h2>
      </ComAjuda>
      <p>{textos.explicacaoSenha}</p>
      <Input
        ajuda={dicas.nome}
        ref={refNome}
        rotulo={textos.rotuloNome}
        name={campoNome.name}
        autoComplete="username"
        autoCapitalize={campoNome.autoCapitalize}
        spellCheck={false}
        maxLength={200}
        value={nome}
        erro={faltas.nome ? textos.faltaNome : undefined}
        onChange={(evento) => {
          setNome(evento.target.value);
          if (faltas.nome) setFaltas({ ...faltas, nome: false });
        }}
      />

      <Input
        ajuda={dicas.senha}
        ref={refSenha}
        rotulo={textos.rotuloSenha}
        name="senha"
        type="password"
        autoComplete="current-password"
        autoCapitalize="none"
        spellCheck={false}
        maxLength={200}
        value={senha}
        erro={faltas.senha ? textos.faltaSenha : undefined}
        onChange={(evento) => {
          setSenha(evento.target.value);
          if (faltas.senha) setFaltas({ ...faltas, senha: false });
        }}
      />

      <div ref={refResultado} tabIndex={-1} className="entrar-resultado">
        {envio.tipo === "recusada" && (
          <Aviso tom="perigo" titulo={textos.recusada}>
            <p>{textos.recusadaDetalhe}</p>
          </Aviso>
        )}
        {envio.tipo === "muitas" && (
          <Aviso tom="alerta" titulo={textos.muitasTentativas}>
            <p>{textos.muitasTentativasDetalhe}</p>
          </Aviso>
        )}
        {envio.tipo === "falha" && (
          <Aviso tom="perigo" titulo={textos.falha}>
            <p>
              {mensagemDoErro(envio.erro)} Confira a internet e toque em Entrar
              de novo.
            </p>
          </Aviso>
        )}
      </div>
      {/* Entrando: aria-disabled (RIFA-045), no Tab e com a dica dizendo por quê; aoEnviar barra o segundo envio. */}
      <ComDica texto={entrando ? dicas.entrando : dicas.entrar}>
        <Button
          type="submit"
          larguraTotal
          aria-disabled={entrando || undefined}
        >
          {entrando ? "Entrando…" : "Entrar"}
        </Button>
      </ComDica>
    </form>
  );
}

type Modo = "celula" | "admin";

// O cartão do login com senha: a célula (o padrão) ou, com "Sou administrador", o admin (RIFA-073). Trocar de modo
// começa o formulário do zero (nada do que foi digitado num vai para o outro).
function EntrarComSenha() {
  const { entrarComSenha, entrarComoAdmin } = useSessao();
  const [modo, setModo] = useState<Modo>("celula");
  const refTroca = useRef<HTMLButtonElement>(null);
  const trocou = useRef(false);

  // Depois de trocar, o foco volta ao botão de troca (o formulário de antes sumiu com o foco).
  useEffect(() => {
    if (trocou.current) refTroca.current?.focus();
  }, [modo]);

  const config: ConfigFormulario =
    modo === "celula"
      ? {
          icone: "celula",
          textos: TEXTOS,
          dicas: DICAS,
          ajudaDoTitulo: "entrarComCelula",
          campoNome: { name: "celula", autoCapitalize: "words" },
          entrarCom: entrarComSenha,
        }
      : {
          icone: "chave",
          textos: TEXTOS_ADMIN,
          dicas: DICAS_ADMIN,
          ajudaDoTitulo: "entrarComoAdmin",
          campoNome: { name: "usuario", autoCapitalize: "none" },
          entrarCom: entrarComoAdmin,
        };

  return (
    <Card>
      <div className="entrar-cartao-senha">
        <FormularioDeEntrada key={modo} {...config} />
        <ComDica
          texto={modo === "celula" ? DICAS.souAdmin : DICAS_ADMIN.souCelula}
        >
          <Button
            ref={refTroca}
            variante="discreto"
            larguraTotal
            onClick={() => {
              trocou.current = true;
              setModo(modo === "celula" ? "admin" : "celula");
            }}
          >
            {modo === "celula" ? TEXTOS.souAdmin : TEXTOS_ADMIN.souCelula}
          </Button>
        </ComDica>
      </div>
    </Card>
  );
}

// Como entrar (sem sessão): a célula com o nome e a senha padrão (RIFA-064), o admin com usuário e senha (RIFA-073) ou
// o link pessoal que chega no WhatsApp,
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
          <EntrarComSenha />
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
