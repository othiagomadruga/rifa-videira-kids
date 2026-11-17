import {
  useRef,
  useState,
  type ChangeEvent,
  type FormEvent,
  type RefObject,
} from "react";
import type {
  LinkAcesso,
  LinkAcessoCriado,
  PapelCoordenacao,
  Usuario,
} from "../../../shared/contracts";
import {
  Aviso,
  Button,
  ComDica,
  Dialogo,
  Input,
  Select,
  Textarea,
  classesBotao,
} from "../../components/ui";
import { mensagemDoErro } from "../../lib/api";
import { formatarData, formatarDataHora } from "../../lib/formatadores";
import { ROTULO_PAPEL } from "../../lib/sessao";
import {
  LIMITES,
  PAPEIS_DO_FORMULARIO,
  criarPessoa,
  definirAtivo,
  revogarLink,
} from "./acessos-api";
import {
  DICAS,
  camposRecusados,
  ehNaoEncontrado,
  linkWhatsApp,
  mensagemAoDesativar,
  mensagemAoRevogar,
  primeiroNome,
} from "./textos";
import type { Mensagens } from "./regras";
import { ajuda } from "../ajuda-sob-demanda";

// ---------------------------------------------------------------------------------------------------
// Nova pessoa
// ---------------------------------------------------------------------------------------------------

type CampoPessoa = "nome" | "email" | "papel";
type ErrosPessoa = Partial<Record<CampoPessoa, string>>;
const ORDEM_CAMPOS: readonly CampoPessoa[] = ["nome", "email", "papel"];

const ERROS_DA_API: Record<CampoPessoa, string> = {
  nome: `Confira o nome: obrigatório, até ${LIMITES.nome} caracteres.`,
  email: "Confira o e-mail (ou deixe em branco).",
  papel: "Escolha o papel na lista.",
};

function validarPessoa(valores: Record<CampoPessoa, string>): ErrosPessoa {
  const erros: ErrosPessoa = {};
  const nome = valores.nome.trim();
  if (nome === "") erros.nome = "Informe o nome.";
  else if (nome.length > LIMITES.nome) {
    erros.nome = `Use no máximo ${LIMITES.nome} caracteres.`;
  }
  const email = valores.email.trim();
  if (
    email !== "" &&
    (email.length > LIMITES.email ||
      !/^[^\s@]+@[^\s@.]+(\.[^\s@.]+)+$/.test(email))
  ) {
    erros.email = "E-mail inválido. Confira ou deixe em branco.";
  }
  return erros;
}

export type PessoaCriada = { usuario: Usuario; link: LinkAcessoCriado };

export function DialogoNovaPessoa({
  aoFechar,
  aoCriar,
}: {
  aoFechar: () => void;
  /** Criou: quem abriu fecha este diálogo e mostra o link (uma vez só). */
  aoCriar: (criada: PessoaCriada) => void;
}) {
  const [valores, setValores] = useState<Record<CampoPessoa, string>>({
    nome: "",
    email: "",
    papel: "coordenacao",
  });
  const [erros, setErros] = useState<ErrosPessoa>({});
  const [mensagem, setMensagem] = useState<string | null>(null);
  const [salvando, setSalvando] = useState(false);
  // Trava síncrona contra envio duplo (o estado só muda no próximo render).
  const enviando = useRef(false);

  function mudar(campo: CampoPessoa) {
    return (evento: ChangeEvent<HTMLInputElement | HTMLSelectElement>) => {
      const valor = evento.currentTarget.value;
      setValores((atuais) => ({ ...atuais, [campo]: valor }));
      setErros((atuais) =>
        atuais[campo] ? { ...atuais, [campo]: undefined } : atuais,
      );
    };
  }

  function focarPrimeiroErro(
    formulario: HTMLFormElement,
    comErro: ErrosPessoa,
  ) {
    const campo = ORDEM_CAMPOS.find((nome) => comErro[nome]);
    const elemento = campo ? formulario.elements.namedItem(campo) : null;
    if (elemento instanceof HTMLElement) elemento.focus();
  }

  async function enviar(evento: FormEvent<HTMLFormElement>) {
    const formulario = evento.currentTarget;
    if (enviando.current) return;
    setMensagem(null);
    const doNavegador = validarPessoa(valores);
    if (Object.values(doNavegador).some(Boolean)) {
      setErros(doNavegador);
      focarPrimeiroErro(formulario, doNavegador);
      return;
    }
    setErros({});
    enviando.current = true;
    setSalvando(true);
    try {
      const criada = await criarPessoa({
        nome: valores.nome.trim(),
        email: valores.email.trim() === "" ? null : valores.email.trim(),
        papel: valores.papel as PapelCoordenacao,
      });
      aoCriar(criada);
    } catch (erro) {
      const daApi: ErrosPessoa = {};
      for (const campo of camposRecusados(erro)) {
        if ((ORDEM_CAMPOS as readonly string[]).includes(campo)) {
          daApi[campo as CampoPessoa] = ERROS_DA_API[campo as CampoPessoa];
        }
      }
      setErros(daApi);
      setMensagem(
        Object.keys(daApi).length > 0
          ? "A API recusou algum campo. Confira e tente de novo."
          : mensagemDoErro(erro),
      );
      focarPrimeiroErro(formulario, daApi);
    } finally {
      enviando.current = false;
      setSalvando(false);
    }
  }

  return (
    <Dialogo
      aberto
      titulo="Nova pessoa"
      descricao="Ela recebe um link pessoal para entrar, sem senha. O link aparece uma vez só, logo depois de criar."
      aoFechar={() => {
        if (!salvando) aoFechar();
      }}
      aoEnviar={(evento) => void enviar(evento)}
      rodape={
        <>
          {/* Criando: aria-disabled (RIFA-047), no Tab e com a dica dizendo por quê; o foco fica no botão (dentro do
              diálogo). O Cancelar barra o clique aqui; o envio, no `enviar` (o Enter num campo também envia). */}
          <ComDica texto={salvando ? DICAS.criando : DICAS.cancelarNovaPessoa}>
            <Button
              variante="secundario"
              aria-disabled={salvando || undefined}
              onClick={() => {
                if (!salvando) aoFechar();
              }}
            >
              Cancelar
            </Button>
          </ComDica>
          <ComDica texto={salvando ? DICAS.criando : DICAS.criarEGerarLink}>
            <Button type="submit" aria-disabled={salvando || undefined}>
              {salvando ? "Criando…" : "Criar e gerar link"}
            </Button>
          </ComDica>
        </>
      }
    >
      <div className="acessos-formulario">
        {mensagem && (
          <Aviso tom="perigo" titulo="Não foi possível criar">
            <p>{mensagem}</p>
          </Aviso>
        )}
        <Input
          ajuda={ajuda("nomePessoa")}
          rotulo="Nome"
          name="nome"
          value={valores.nome}
          onChange={mudar("nome")}
          maxLength={LIMITES.nome}
          autoComplete="off"
          erro={erros.nome}
        />

        <Input
          ajuda={ajuda("emailPessoa")}
          rotulo="E-mail (opcional)"
          name="email"
          type="email"
          inputMode="email"
          value={valores.email}
          onChange={mudar("email")}
          maxLength={LIMITES.email}
          autoComplete="off"
          dica="Só para referência: a entrada é pelo link."
          erro={erros.email}
        />

        <Select
          ajuda={ajuda("papelPessoa")}
          rotulo="Papel"
          name="papel"
          value={valores.papel}
          onChange={mudar("papel")}
          dica="Admin também cria pessoas e gera e revoga links. Coordenação usa as demais telas."
          erro={erros.papel}
        >
          {PAPEIS_DO_FORMULARIO.map((papel) => (
            <option key={papel} value={papel}>
              {ROTULO_PAPEL[papel]}
            </option>
          ))}
        </Select>
      </div>
    </Dialogo>
  );
}

// ---------------------------------------------------------------------------------------------------
// Link criado (aparece uma vez só)
// ---------------------------------------------------------------------------------------------------

type Copia = "nada" | "copiado" | "falhou";

const TEXTO_COPIA: Record<Copia, string> = {
  nada: "",
  copiado: "Link copiado.",
  falhou:
    "Não deu para copiar sozinho: o link ficou selecionado no campo acima. Copie pelo menu do celular.",
};

export function DialogoLink({
  nome,
  link,
  mensagens,
  aoFechar,
}: {
  nome: string;
  link: LinkAcessoCriado;
  /** Os modelos da campanha (D20): o do link da coordenação vai no "Enviar pelo WhatsApp". */
  mensagens?: Mensagens;
  aoFechar: () => void;
}) {
  const refCopiar = useRef<HTMLButtonElement>(null);
  const refCampo = useRef<HTMLTextAreaElement>(null);
  const [copia, setCopia] = useState<Copia>("nada");

  async function copiar() {
    try {
      await navigator.clipboard.writeText(link.url);
      setCopia("copiado");
    } catch {
      refCampo.current?.focus();
      refCampo.current?.select();
      setCopia("falhou");
    }
  }

  return (
    <Dialogo
      aberto
      titulo={`Link de acesso de ${nome}`}
      descricao="Este link só aparece agora: copie ou envie antes de fechar."
      aoFechar={aoFechar}
      dicaFechar={DICAS.fecharLink}
      focoInicial={refCopiar}
      rodape={
        <ComDica texto={DICAS.fecharLink}>
          <Button variante="secundario" onClick={aoFechar}>
            Pronto
          </Button>
        </ComDica>
      }
    >
      <div className="acessos-link-criado">
        <Aviso
          tom="alerta"
          titulo="Este link só aparece agora."
          anuncio="nenhum"
        >
          <p>
            Depois de fechar, só gerando um link novo. Mande só para{" "}
            {primeiroNome(nome)}: quem tiver o link entra como essa pessoa. Vale
            até {formatarData(link.expira_em)}.
          </p>
        </Aviso>
        <Textarea
          ajuda={ajuda("linkDeAcesso")}
          ref={refCampo}
          rotulo="Link de acesso"
          value={link.url}
          readOnly
          rows={3}
          className="acessos-url"
          onFocus={(evento) => evento.currentTarget.select()}
        />

        <div className="acessos-link-acoes">
          <ComDica texto={DICAS.copiarLink}>
            <Button ref={refCopiar} onClick={() => void copiar()}>
              Copiar link
            </Button>
          </ComDica>
          <ComDica texto={DICAS.enviarPeloWhatsApp}>
            <a
              className={classesBotao({ variante: "secundario" })}
              href={linkWhatsApp(nome, link.url, mensagens)}
              target="_blank"
              rel="noopener noreferrer"
            >
              Enviar pelo WhatsApp
            </a>
          </ComDica>
        </div>
        {/* Região viva fixa (anuncia o resultado de copiar) e o mesmo texto visível. */}
        <p className="visualmente-oculto" role="status">
          {TEXTO_COPIA[copia]}
        </p>
        {copia !== "nada" && (
          <p className="acessos-copia">{TEXTO_COPIA[copia]}</p>
        )}
      </div>
    </Dialogo>
  );
}

// ---------------------------------------------------------------------------------------------------
// Confirmações: revogar link e desativar pessoa
// ---------------------------------------------------------------------------------------------------

type PropsConfirmacao = {
  aoFechar: () => void;
  /** Deu certo: quem abriu fecha o diálogo, avisa e recarrega a lista. */
  aoConcluir: () => void;
  /** A pessoa ou o link não existe mais (404): recarregue a lista. */
  aoDesatualizar: () => void;
  /** Recebe o foco ao fechar (o botão que abriu pode sumir). */
  focoAoFechar?: RefObject<HTMLElement | null>;
};

function useConfirmacao(
  executar: () => Promise<unknown>,
  mensagemDaFalha: (erro: unknown) => string,
  { aoConcluir, aoDesatualizar }: PropsConfirmacao,
) {
  const [executando, setExecutando] = useState(false);
  const [erro, setErro] = useState<string | null>(null);
  const emAndamento = useRef(false);

  async function confirmar() {
    if (emAndamento.current) return;
    emAndamento.current = true;
    setExecutando(true);
    setErro(null);
    try {
      await executar();
      aoConcluir();
    } catch (falha) {
      setErro(mensagemDaFalha(falha));
      if (ehNaoEncontrado(falha)) aoDesatualizar();
    } finally {
      emAndamento.current = false;
      setExecutando(false);
    }
  }

  return { executando, erro, confirmar };
}

export function DialogoRevogar({
  pessoa,
  link,
  ...props
}: PropsConfirmacao & {
  /** A pessoa da coordenação ou o usuário de um alvo da hierarquia (só o nome importa aqui). */
  pessoa: Pick<Usuario, "nome">;
  link: LinkAcesso;
}) {
  const { executando, erro, confirmar } = useConfirmacao(
    () => revogarLink(link.id),
    mensagemAoRevogar,
    props,
  );
  // RIFA-043: o link pelo qual esta sessão entrou. Revogá-lo derruba a sessão deste aparelho (no primeiro acesso,
  // lançamento 3.1, o admin revoga o link do SM e não o novo, pelo qual acabou de entrar).
  const desteAparelho = link.desta_sessao;
  const criado = `Link de ${pessoa.nome} criado em ${formatarDataHora(link.criado_em)}.`;
  return (
    <Dialogo
      aberto
      papel="alertdialog"
      titulo={
        desteAparelho ? "Revogar o link deste aparelho?" : "Revogar este link?"
      }
      descricao={
        desteAparelho
          ? `${criado} Você entrou por este link neste aparelho: ao revogar, você sai do sistema aqui.`
          : criado
      }
      aoFechar={() => {
        if (!executando) props.aoFechar();
      }}
      focoAoFechar={props.focoAoFechar}
      rodape={
        <>
          {/* Revogando: os dois com aria-disabled (RIFA-047), no Tab e com a dica dizendo por quê; o clique é barrado aqui
              (o Cancelar fechava o diálogo no meio da gravação). */}
          <ComDica texto={executando ? DICAS.revogando : DICAS.cancelarRevogar}>
            <Button
              variante="secundario"
              aria-disabled={executando || undefined}
              onClick={() => {
                if (!executando) props.aoFechar();
              }}
            >
              Cancelar
            </Button>
          </ComDica>
          <ComDica
            texto={
              executando
                ? DICAS.revogando
                : desteAparelho
                  ? DICAS.confirmarRevogarESair
                  : DICAS.confirmarRevogar
            }
          >
            <Button
              variante="perigo"
              aria-disabled={executando || undefined}
              onClick={() => {
                if (!executando) void confirmar();
              }}
            >
              {executando
                ? "Revogando…"
                : desteAparelho
                  ? "Revogar e sair"
                  : "Revogar link"}
            </Button>
          </ComDica>
        </>
      }
    >
      <div className="acessos-formulario">
        {desteAparelho ? (
          <Aviso
            tom="alerta"
            anuncio="nenhum"
            titulo="Você vai sair do sistema neste aparelho"
          >
            <p>
              A sua sessão aqui foi aberta por este link e cai junto com ele.
              Para voltar, você vai precisar de outro link válido seu. Se a
              ideia é trocar de link, entre primeiro pelo link novo e revogue
              este de lá.
            </p>
          </Aviso>
        ) : (
          <p>
            O link para de funcionar e quem entrou com ele sai do sistema. Os
            outros links de {primeiroNome(pessoa.nome)} continuam valendo.
          </p>
        )}
        {erro && (
          <Aviso tom="perigo" titulo="Não foi possível revogar">
            <p>{erro}</p>
          </Aviso>
        )}
      </div>
    </Dialogo>
  );
}

export function DialogoDesativar({
  pessoa,
  aSiMesmo,
  ...props
}: PropsConfirmacao & {
  /** A pessoa da coordenação ou o usuário de um alvo da hierarquia (com o papel do alvo). */
  pessoa: Pick<Usuario, "id" | "nome" | "papel">;
  aSiMesmo: boolean;
}) {
  const { executando, erro, confirmar } = useConfirmacao(
    () => definirAtivo(pessoa.id, false),
    (falha) => mensagemAoDesativar(falha, aSiMesmo),
    props,
  );
  return (
    <Dialogo
      aberto
      papel="alertdialog"
      titulo={`Desativar o acesso de ${pessoa.nome}?`}
      descricao={`${ROTULO_PAPEL[pessoa.papel]}. Dá para reativar depois.`}
      aoFechar={() => {
        if (!executando) props.aoFechar();
      }}
      focoAoFechar={props.focoAoFechar}
      rodape={
        <>
          {/* Desativando: os dois com aria-disabled (RIFA-047), como no Revogar. */}
          <ComDica
            texto={executando ? DICAS.desativando : DICAS.cancelarDesativar}
          >
            <Button
              variante="secundario"
              aria-disabled={executando || undefined}
              onClick={() => {
                if (!executando) props.aoFechar();
              }}
            >
              Cancelar
            </Button>
          </ComDica>
          <ComDica
            texto={executando ? DICAS.desativando : DICAS.confirmarDesativar}
          >
            <Button
              variante="perigo"
              aria-disabled={executando || undefined}
              onClick={() => {
                if (!executando) void confirmar();
              }}
            >
              {executando ? "Desativando…" : "Desativar acesso"}
            </Button>
          </ComDica>
        </>
      }
    >
      <div className="acessos-formulario">
        <p>
          A pessoa sai do sistema em todos os aparelhos e os links dela param de
          funcionar enquanto o acesso estiver desativado.
        </p>
        {erro && (
          <Aviso tom="perigo" titulo="Não foi possível desativar">
            <p>{erro}</p>
          </Aviso>
        )}
      </div>
    </Dialogo>
  );
}
