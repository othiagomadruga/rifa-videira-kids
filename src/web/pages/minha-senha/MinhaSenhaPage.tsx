import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type FormEvent,
} from "react";
import type { RespostaSenhaAdmin } from "../../../shared/contracts";
import {
  FORMATO_USUARIO_ADMIN,
  MAXIMO_USUARIO_ADMIN,
  MENSAGEM_PROBLEMA_SENHA_ADMIN,
  MENSAGEM_USUARIO_ADMIN_INVALIDO,
  normalizarUsuarioAdmin,
  problemaDaSenhaAdmin,
} from "../../../shared/contracts/senha-admin";
import {
  Aviso,
  Button,
  Card,
  ComDica,
  Dialogo,
  ErrorState,
  Input,
  Loading,
  PageHeader,
} from "../../components/ui";
import { ErroApi, ehFalhaDeConexao, mensagemDoErro } from "../../lib/api";
import { formatarDataHora } from "../../lib/formatadores";
import {
  lerMinhaSenha,
  removerMinhaSenha,
  salvarMinhaSenha,
} from "./minha-senha-api";
import { DICAS, TEXTOS } from "./textos";
import "./minha-senha.css";

type Carga =
  | { tipo: "carregando" }
  | { tipo: "erro"; erro: unknown }
  | { tipo: "pronta"; senha: RespostaSenhaAdmin };

type Resultado =
  | { tipo: "nenhum" }
  | { tipo: "salva"; criada: boolean }
  | { tipo: "removida" }
  | { tipo: "falha"; erro: unknown };

type Erros = { usuario?: string; senha?: string; confirmacao?: string };

/** O que impede o envio (as mesmas regras da API: senha-admin.ts do contrato), por campo. */
function conferir(usuario: string, senha: string, confirmacao: string): Erros {
  const erros: Erros = {};
  const login = normalizarUsuarioAdmin(usuario);
  if (login === "") erros.usuario = TEXTOS.faltaUsuario;
  else if (
    login.length > MAXIMO_USUARIO_ADMIN ||
    !FORMATO_USUARIO_ADMIN.test(login)
  )
    erros.usuario = `${MENSAGEM_USUARIO_ADMIN_INVALIDO}.`;
  const problema = problemaDaSenhaAdmin(senha, login);
  if (problema !== null)
    erros.senha = `${MENSAGEM_PROBLEMA_SENHA_ADMIN[problema]}.`;
  else if (confirmacao !== senha)
    erros.confirmacao = TEXTOS.confirmacaoDiferente;
  return erros;
}

// Minha senha (RIFA-073, D33; só admin): o usuário e a senha com que o próprio admin entra em /entrar ("Sou
// administrador"), além do link pessoal. A senha só vai no corpo do PUT; a tela nunca a mostra de volta e limpa os
// campos depois de salvar. Remover pede confirmação (derruba as sessões abertas pela senha, talvez esta).
export function MinhaSenhaPage() {
  const [carga, setCarga] = useState<Carga>({ tipo: "carregando" });
  const [usuario, setUsuario] = useState("");
  const [senha, setSenha] = useState("");
  const [confirmacao, setConfirmacao] = useState("");
  const [erros, setErros] = useState<Erros>({});
  const [salvando, setSalvando] = useState(false);
  const [resultado, setResultado] = useState<Resultado>({ tipo: "nenhum" });
  const [confirmandoRemocao, setConfirmandoRemocao] = useState(false);
  const [removendo, setRemovendo] = useState(false);
  const refResultado = useRef<HTMLDivElement>(null);
  const refUsuario = useRef<HTMLInputElement>(null);
  const refSenha = useRef<HTMLInputElement>(null);
  const refConfirmacao = useRef<HTMLInputElement>(null);
  const enviando = useRef(false);

  const carregar = useCallback((signal?: AbortSignal) => {
    setCarga({ tipo: "carregando" });
    lerMinhaSenha(signal).then(
      (senhaAtual) => {
        setCarga({ tipo: "pronta", senha: senhaAtual });
        setUsuario(senhaAtual.usuario ?? "");
      },
      (erro: unknown) => {
        if (signal?.aborted) return;
        setCarga({ tipo: "erro", erro });
      },
    );
  }, []);

  useEffect(() => {
    const controle = new AbortController();
    carregar(controle.signal);
    return () => controle.abort();
  }, [carregar]);

  useEffect(() => {
    if (resultado.tipo !== "nenhum") refResultado.current?.focus();
  }, [resultado]);

  async function aoSalvar(evento: FormEvent<HTMLFormElement>) {
    evento.preventDefault();
    if (enviando.current || carga.tipo !== "pronta") return;
    const encontrados = conferir(usuario, senha, confirmacao);
    setErros(encontrados);
    if (encontrados.usuario || encontrados.senha || encontrados.confirmacao) {
      (encontrados.usuario
        ? refUsuario
        : encontrados.senha
          ? refSenha
          : refConfirmacao
      ).current?.focus();
      return;
    }
    enviando.current = true;
    setSalvando(true);
    setResultado({ tipo: "nenhum" });
    try {
      const salva = await salvarMinhaSenha(usuario, senha);
      const criada = !carga.senha.definida;
      setCarga({ tipo: "pronta", senha: salva });
      setUsuario(salva.usuario ?? "");
      setSenha("");
      setConfirmacao("");
      setResultado({ tipo: "salva", criada });
    } catch (erro) {
      if (erro instanceof ErroApi && erro.codigo === "em_uso") {
        setErros({ usuario: TEXTOS.emUso });
        refUsuario.current?.focus();
      } else setResultado({ tipo: "falha", erro });
    } finally {
      enviando.current = false;
      setSalvando(false);
    }
  }

  async function aoRemover() {
    if (removendo) return;
    setRemovendo(true);
    try {
      await removerMinhaSenha();
      setConfirmandoRemocao(false);
      setCarga({
        tipo: "pronta",
        senha: { definida: false, usuario: null, atualizada_em: null },
      });
      setSenha("");
      setConfirmacao("");
      setResultado({ tipo: "removida" });
    } catch (erro) {
      setConfirmandoRemocao(false);
      setResultado({ tipo: "falha", erro });
    } finally {
      setRemovendo(false);
    }
  }

  return (
    <>
      <PageHeader titulo={TEXTOS.titulo} descricao={TEXTOS.descricao} />
      {carga.tipo === "carregando" && <Loading texto="Carregando…" />}
      {carga.tipo === "erro" && (
        <ErrorState
          titulo="Não foi possível abrir a sua senha."
          mensagem={mensagemDoErro(carga.erro)}
          conexao={ehFalhaDeConexao(carga.erro)}
          aoTentarDeNovo={() => carregar()}
        />
      )}
      {carga.tipo === "pronta" && (
        <div className="minha-senha">
          {carga.senha.definida ? (
            <Aviso tom="sucesso" titulo={TEXTOS.comSenha} anuncio="nenhum">
              <p>
                Usuário: <strong>{carga.senha.usuario}</strong>
                {carga.senha.atualizada_em && (
                  <>
                    {" "}
                    · definida em {formatarDataHora(carga.senha.atualizada_em)}
                  </>
                )}
              </p>
            </Aviso>
          ) : (
            <Aviso tom="info" titulo={TEXTOS.semSenha} anuncio="nenhum">
              <p>{TEXTOS.semSenhaDetalhe}</p>
            </Aviso>
          )}
          <Card>
            <form
              className="minha-senha-formulario"
              noValidate
              onSubmit={aoSalvar}
            >
              <h2 className="minha-senha-titulo">
                {carga.senha.definida
                  ? TEXTOS.tituloFormularioTrocar
                  : TEXTOS.tituloFormularioCriar}
              </h2>
              <ComDica texto={DICAS.usuario}>
                <Input
                  ref={refUsuario}
                  rotulo={TEXTOS.rotuloUsuario}
                  dica={TEXTOS.ajudaUsuario}
                  name="usuario"
                  autoComplete="username"
                  autoCapitalize="none"
                  spellCheck={false}
                  maxLength={MAXIMO_USUARIO_ADMIN}
                  value={usuario}
                  erro={erros.usuario}
                  onChange={(evento) => {
                    setUsuario(evento.target.value);
                    if (erros.usuario)
                      setErros({ ...erros, usuario: undefined });
                  }}
                />
              </ComDica>
              <ComDica texto={DICAS.senha}>
                <Input
                  ref={refSenha}
                  rotulo={TEXTOS.rotuloSenha}
                  dica={TEXTOS.ajudaSenha}
                  name="nova-senha"
                  type="password"
                  autoComplete="new-password"
                  autoCapitalize="none"
                  spellCheck={false}
                  maxLength={200}
                  value={senha}
                  erro={erros.senha}
                  onChange={(evento) => {
                    setSenha(evento.target.value);
                    if (erros.senha) setErros({ ...erros, senha: undefined });
                  }}
                />
              </ComDica>
              <ComDica texto={DICAS.confirmacao}>
                <Input
                  ref={refConfirmacao}
                  rotulo={TEXTOS.rotuloConfirmacao}
                  name="confirmacao"
                  type="password"
                  autoComplete="new-password"
                  autoCapitalize="none"
                  spellCheck={false}
                  maxLength={200}
                  value={confirmacao}
                  erro={erros.confirmacao}
                  onChange={(evento) => {
                    setConfirmacao(evento.target.value);
                    if (erros.confirmacao)
                      setErros({ ...erros, confirmacao: undefined });
                  }}
                />
              </ComDica>
              <div
                ref={refResultado}
                tabIndex={-1}
                className="minha-senha-resultado"
              >
                {resultado.tipo === "salva" && (
                  <Aviso
                    tom="sucesso"
                    titulo={
                      resultado.criada
                        ? TEXTOS.salvaCriada
                        : TEXTOS.salvaTrocada
                    }
                  >
                    <p>{TEXTOS.salvaDetalhe}</p>
                  </Aviso>
                )}
                {resultado.tipo === "removida" && (
                  <Aviso tom="sucesso" titulo={TEXTOS.removida} />
                )}
                {resultado.tipo === "falha" && (
                  <Aviso tom="perigo" titulo="Não foi possível salvar agora.">
                    <p>{mensagemDoErro(resultado.erro)}</p>
                  </Aviso>
                )}
              </div>
              <ComDica texto={salvando ? DICAS.salvando : DICAS.salvar}>
                <Button
                  type="submit"
                  larguraTotal
                  aria-disabled={salvando || undefined}
                >
                  {salvando ? TEXTOS.salvando : TEXTOS.salvar}
                </Button>
              </ComDica>
              <p className="minha-senha-nota">{TEXTOS.aviso}</p>
            </form>
          </Card>
          {carga.senha.definida && (
            <ComDica texto={DICAS.remover}>
              <Button
                variante="perigo-discreto"
                onClick={() => setConfirmandoRemocao(true)}
              >
                {TEXTOS.remover}
              </Button>
            </ComDica>
          )}
          <Dialogo
            aberto={confirmandoRemocao}
            papel="alertdialog"
            titulo={TEXTOS.removerTitulo}
            descricao={TEXTOS.removerDescricao}
            aoFechar={() => {
              if (!removendo) setConfirmandoRemocao(false);
            }}
            rodape={
              <>
                <Button
                  variante="secundario"
                  onClick={() => setConfirmandoRemocao(false)}
                >
                  {TEXTOS.cancelar}
                </Button>
                <Button
                  variante="perigo"
                  aria-disabled={removendo || undefined}
                  onClick={() => void aoRemover()}
                >
                  {removendo ? "Removendo…" : TEXTOS.removerConfirmar}
                </Button>
              </>
            }
          />
        </div>
      )}
    </>
  );
}
