import {
  useState,
  type ChangeEvent,
  type FormEvent,
  type ReactNode,
  type RefObject,
} from "react";
import type {
  Celula,
  Discipulador,
  Divisao,
  Rede,
} from "../../../shared/contracts";
import {
  Aviso,
  Button,
  ComAjuda,
  ComDica,
  Dialogo,
  Input,
  Select,
} from "../../components/ui";
import {
  LIMITES,
  textoOuNulo,
  useFormularioEdicao,
  validarEmail,
  validarNome,
  validarOpcional,
  validarPessoas,
} from "./formulario";
import {
  excluir,
  salvarCelula,
  salvarDiscipulador,
  salvarRede,
  type Recurso,
} from "./hierarquia-api";
import {
  DICAS,
  DIVISOES,
  ROTULO_DIVISAO,
  compararNomes,
  mensagemAoExcluir,
  dadosDesatualizados,
  type Entidade,
} from "./textos";
import { ajuda } from "../ajuda-sob-demanda";

type PropsEdicao<T> = {
  item: T;
  aoFechar: () => void;
  /** Salvou: quem abriu fecha o diálogo e recarrega as listas. */
  aoSalvar: (salvo: T) => void;
  /** O registro (ou a referência escolhida) não existe mais ou mudou ao mesmo tempo: recarregue as listas. */
  aoDesatualizar: () => void;
};

/** Valores do formulário como texto (o que está nos campos). */
type Valores<C extends string> = Record<C, string>;

function useValores<C extends string>(
  iniciais: Valores<C>,
  limpar: (campo: C) => void,
) {
  const [valores, setValores] = useState(iniciais);
  function mudar(campo: C) {
    return (evento: ChangeEvent<HTMLInputElement | HTMLSelectElement>) => {
      const valor = evento.currentTarget.value;
      setValores((atuais) => ({ ...atuais, [campo]: valor }));
      limpar(campo);
    };
  }
  return { valores, mudar };
}

function Rodape({
  salvando,
  aoCancelar,
}: {
  salvando: boolean;
  aoCancelar: () => void;
}) {
  return (
    <>
      <ComDica texto={DICAS.cancelarEdicao}>
        <Button variante="secundario" onClick={aoCancelar}>
          Cancelar
        </Button>
      </ComDica>
      <ComDica texto={salvando ? DICAS.salvando : DICAS.salvar}>
        <Button type="submit">{salvando ? "Salvando…" : "Salvar"}</Button>
      </ComDica>
    </>
  );
}

function ErroDoEnvio({ mensagem }: { mensagem: string | null }) {
  return mensagem ? (
    <Aviso tom="perigo" titulo="Não foi possível salvar">
      <p>{mensagem}</p>
    </Aviso>
  ) : null;
}

// ---------------------------------------------------------------------------------------------------
// Célula
// ---------------------------------------------------------------------------------------------------

const CAMPOS_CELULA = [
  "nome",
  "discipulador_id",
  "qtd_pessoas",
  "lider_nome",
  "lider_email",
  "lider_telefone",
] as const;
type CampoCelula = (typeof CAMPOS_CELULA)[number];

const ROTULOS_CELULA: Record<CampoCelula, string> = {
  nome: "Nome da célula",
  discipulador_id: "Discipulador",
  qtd_pessoas: "Nº de pessoas",
  lider_nome: "Nome do líder",
  lider_email: "E-mail do líder",
  lider_telefone: "Telefone do líder",
};

const ERROS_API_CELULA: Record<CampoCelula, string> = {
  nome: `Confira o nome: obrigatório, até ${LIMITES.nome} caracteres.`,
  discipulador_id: "Escolha um discipulador da lista.",
  qtd_pessoas: `Use um número inteiro de ${LIMITES.pessoasMin} a ${LIMITES.pessoasMax}.`,
  lider_nome: `Confira o nome do líder: obrigatório, até ${LIMITES.nome} caracteres.`,
  lider_email: "Confira o e-mail (ou deixe em branco).",
  lider_telefone: `Use no máximo ${LIMITES.telefone} caracteres.`,
};

export function DialogoCelula({
  item: celula,
  discipuladores,
  aoFechar,
  aoSalvar,
  aoDesatualizar,
}: PropsEdicao<Celula> & { discipuladores: readonly Discipulador[] }) {
  const formulario = useFormularioEdicao({
    entidade: "celula",
    ordem: CAMPOS_CELULA,
    rotulos: ROTULOS_CELULA,
    errosDaApi: ERROS_API_CELULA,
    aoDesatualizar,
  });
  const { valores, mudar } = useValores<CampoCelula>(
    {
      nome: celula.nome,
      discipulador_id: String(celula.discipulador_id),
      qtd_pessoas: String(celula.qtd_pessoas),
      lider_nome: celula.lider_nome,
      lider_email: celula.lider_email ?? "",
      lider_telefone: celula.lider_telefone ?? "",
    },
    formulario.limparErro,
  );
  const { erros } = formulario;

  function enviar(evento: FormEvent<HTMLFormElement>) {
    void formulario.enviar({
      formulario: evento.currentTarget,
      erros: {
        nome: validarNome(valores.nome, "Informe o nome da célula."),
        discipulador_id: valores.discipulador_id
          ? undefined
          : "Escolha o discipulador.",
        qtd_pessoas: validarPessoas(valores.qtd_pessoas),
        lider_nome: validarNome(valores.lider_nome, "Informe o nome do líder."),
        lider_email: validarEmail(valores.lider_email),
        lider_telefone: validarOpcional(
          valores.lider_telefone,
          LIMITES.telefone,
        ),
      },
      nome: valores.nome.trim(),
      salvar: () =>
        salvarCelula(celula.id, {
          discipulador_id: Number(valores.discipulador_id),
          nome: valores.nome.trim(),
          qtd_pessoas: Number(valores.qtd_pessoas.trim()),
          lider_nome: valores.lider_nome.trim(),
          lider_email: textoOuNulo(valores.lider_email),
          lider_telefone: textoOuNulo(valores.lider_telefone),
        }),
      aoSalvar,
    });
  }

  return (
    <Dialogo
      aberto
      titulo="Editar célula"
      descricao={celula.nome}
      aoFechar={aoFechar}
      aoEnviar={enviar}
      rodape={<Rodape salvando={formulario.salvando} aoCancelar={aoFechar} />}
    >
      <div className="hierarquia-formulario">
        <ErroDoEnvio mensagem={formulario.mensagem} />
        <Input
          rotulo={ROTULOS_CELULA.nome}
          ajuda={ajuda("nomeCelula")}
          name="nome"
          value={valores.nome}
          onChange={mudar("nome")}
          maxLength={LIMITES.nome}
          autoComplete="off"
          erro={erros.nome}
        />

        <Select
          rotulo={ROTULOS_CELULA.discipulador_id}
          ajuda={ajuda("discipuladorDaCelula")}
          name="discipulador_id"
          dica="A célula fica na rede do discipulador escolhido."
          value={valores.discipulador_id}
          onChange={mudar("discipulador_id")}
          erro={erros.discipulador_id}
        >
          {gruposPorRede(discipuladores).map((grupo) => (
            <optgroup key={grupo.id} label={grupo.rotulo}>
              {grupo.itens.map((discipulador) => (
                <option key={discipulador.id} value={discipulador.id}>
                  {discipulador.nome}
                </option>
              ))}
            </optgroup>
          ))}
        </Select>

        <Input
          rotulo={ROTULOS_CELULA.qtd_pessoas}
          ajuda={ajuda("qtdPessoas")}
          name="qtd_pessoas"
          dica={`Número inteiro de ${LIMITES.pessoasMin} a ${LIMITES.pessoasMax}: é a base da meta da célula.`}
          inputMode="numeric"
          autoComplete="off"
          value={valores.qtd_pessoas}
          onChange={mudar("qtd_pessoas")}
          erro={erros.qtd_pessoas}
        />

        {/* O "?" da ajuda fica dentro da legenda (a primeira filha do fieldset): o nome do grupo vem só do texto. */}
        <fieldset
          className="hierarquia-grupo"
          aria-labelledby="hierarquia-grupo-lider"
        >
          <legend className="hierarquia-grupo__titulo">
            <ComAjuda
              texto={ajuda("lider")}
              idDoTitulo="hierarquia-grupo-lider"
            >
              <span id="hierarquia-grupo-lider">Líder</span>
            </ComAjuda>
          </legend>
          <Input
            rotulo={ROTULOS_CELULA.lider_nome}
            ajuda={ajuda("liderNome")}
            name="lider_nome"
            value={valores.lider_nome}
            onChange={mudar("lider_nome")}
            maxLength={LIMITES.nome}
            autoComplete="off"
            erro={erros.lider_nome}
          />

          <Input
            rotulo="E-mail (opcional)"
            ajuda={ajuda("liderEmail")}
            name="lider_email"
            type="email"
            value={valores.lider_email}
            onChange={mudar("lider_email")}
            maxLength={LIMITES.email}
            autoComplete="off"
            erro={erros.lider_email}
          />

          <Input
            rotulo="Telefone (opcional)"
            ajuda={ajuda("liderTelefone")}
            name="lider_telefone"
            type="tel"
            dica="Com DDD, ex.: (91) 90000-0001."
            value={valores.lider_telefone}
            onChange={mudar("lider_telefone")}
            maxLength={LIMITES.telefone}
            autoComplete="off"
            erro={erros.lider_telefone}
          />
        </fieldset>
      </div>
    </Dialogo>
  );
}

/** Discipuladores agrupados por rede (para <optgroup>), em ordem alfabética. */
function gruposPorRede(discipuladores: readonly Discipulador[]) {
  const grupos = new Map<
    number,
    { id: number; rotulo: string; itens: Discipulador[] }
  >();
  const ordenados = [...discipuladores].sort(
    (a, b) =>
      compararNomes(a.rede_nome, b.rede_nome) || compararNomes(a.nome, b.nome),
  );
  for (const discipulador of ordenados) {
    const grupo = grupos.get(discipulador.rede_id) ?? {
      id: discipulador.rede_id,
      rotulo: `${discipulador.rede_nome} (${ROTULO_DIVISAO[discipulador.divisao]})`,
      itens: [],
    };
    grupo.itens.push(discipulador);
    grupos.set(discipulador.rede_id, grupo);
  }
  return [...grupos.values()];
}

// ---------------------------------------------------------------------------------------------------
// Discipulador
// ---------------------------------------------------------------------------------------------------

const CAMPOS_DISCIPULADOR = ["nome", "rede_id"] as const;
type CampoDiscipulador = (typeof CAMPOS_DISCIPULADOR)[number];

const ROTULOS_DISCIPULADOR: Record<CampoDiscipulador, string> = {
  nome: "Nome do discipulador",
  rede_id: "Rede",
};

const ERROS_API_DISCIPULADOR: Record<CampoDiscipulador, string> = {
  nome: `Confira o nome: obrigatório, até ${LIMITES.nome} caracteres.`,
  rede_id: "Escolha uma rede da lista.",
};

export function DialogoDiscipulador({
  item: discipulador,
  redes,
  aoFechar,
  aoSalvar,
  aoDesatualizar,
}: PropsEdicao<Discipulador> & { redes: readonly Rede[] }) {
  const formulario = useFormularioEdicao({
    entidade: "discipulador",
    ordem: CAMPOS_DISCIPULADOR,
    rotulos: ROTULOS_DISCIPULADOR,
    errosDaApi: ERROS_API_DISCIPULADOR,
    aoDesatualizar,
  });
  const { valores, mudar } = useValores<CampoDiscipulador>(
    { nome: discipulador.nome, rede_id: String(discipulador.rede_id) },
    formulario.limparErro,
  );
  const { erros } = formulario;

  function enviar(evento: FormEvent<HTMLFormElement>) {
    void formulario.enviar({
      formulario: evento.currentTarget,
      erros: {
        nome: validarNome(valores.nome, "Informe o nome do discipulador."),
        rede_id: valores.rede_id ? undefined : "Escolha a rede.",
      },
      nome: valores.nome.trim(),
      salvar: () =>
        salvarDiscipulador(discipulador.id, {
          rede_id: Number(valores.rede_id),
          nome: valores.nome.trim(),
        }),
      aoSalvar,
    });
  }

  return (
    <Dialogo
      aberto
      titulo="Editar discipulador"
      descricao={discipulador.nome}
      aoFechar={aoFechar}
      aoEnviar={enviar}
      rodape={<Rodape salvando={formulario.salvando} aoCancelar={aoFechar} />}
    >
      <div className="hierarquia-formulario">
        <ErroDoEnvio mensagem={formulario.mensagem} />
        <Input
          rotulo={ROTULOS_DISCIPULADOR.nome}
          ajuda={ajuda("nomeDiscipulador")}
          name="nome"
          value={valores.nome}
          onChange={mudar("nome")}
          maxLength={LIMITES.nome}
          autoComplete="off"
          erro={erros.nome}
        />

        <Select
          rotulo={ROTULOS_DISCIPULADOR.rede_id}
          ajuda={ajuda("redeDoDiscipulador")}
          name="rede_id"
          dica="As células do discipulador vão junto para a rede escolhida."
          value={valores.rede_id}
          onChange={mudar("rede_id")}
          erro={erros.rede_id}
        >
          {[...redes]
            .sort((a, b) => compararNomes(a.nome, b.nome))
            .map((rede) => (
              <option key={rede.id} value={rede.id}>
                {rede.nome} ({ROTULO_DIVISAO[rede.divisao]})
              </option>
            ))}
        </Select>
      </div>
    </Dialogo>
  );
}

// ---------------------------------------------------------------------------------------------------
// Rede
// ---------------------------------------------------------------------------------------------------

const CAMPOS_REDE = ["nome", "divisao", "responsavel_nome"] as const;
type CampoRede = (typeof CAMPOS_REDE)[number];

const ROTULOS_REDE: Record<CampoRede, string> = {
  nome: "Nome da rede",
  divisao: "Divisão",
  responsavel_nome: "Responsável",
};

const ERROS_API_REDE: Record<CampoRede, string> = {
  nome: `Confira o nome: obrigatório, até ${LIMITES.nome} caracteres.`,
  divisao: "Escolha Jovens ou Adultos.",
  responsavel_nome: `Use no máximo ${LIMITES.nome} caracteres.`,
};

export function DialogoRede({
  item: rede,
  aoFechar,
  aoSalvar,
  aoDesatualizar,
}: PropsEdicao<Rede>) {
  const formulario = useFormularioEdicao({
    entidade: "rede",
    ordem: CAMPOS_REDE,
    rotulos: ROTULOS_REDE,
    errosDaApi: ERROS_API_REDE,
    aoDesatualizar,
  });
  const { valores, mudar } = useValores<CampoRede>(
    {
      nome: rede.nome,
      divisao: rede.divisao,
      responsavel_nome: rede.responsavel_nome ?? "",
    },
    formulario.limparErro,
  );
  const { erros } = formulario;

  function enviar(evento: FormEvent<HTMLFormElement>) {
    void formulario.enviar({
      formulario: evento.currentTarget,
      erros: {
        nome: validarNome(valores.nome, "Informe o nome da rede."),
        divisao: (DIVISOES as readonly string[]).includes(valores.divisao)
          ? undefined
          : "Escolha a divisão.",
        responsavel_nome: validarOpcional(
          valores.responsavel_nome,
          LIMITES.nome,
        ),
      },
      nome: valores.nome.trim(),
      salvar: () =>
        salvarRede(rede.id, {
          nome: valores.nome.trim(),
          divisao: valores.divisao as Divisao,
          responsavel_nome: textoOuNulo(valores.responsavel_nome),
        }),
      aoSalvar,
    });
  }

  return (
    <Dialogo
      aberto
      titulo="Editar rede"
      descricao={rede.nome}
      aoFechar={aoFechar}
      aoEnviar={enviar}
      rodape={<Rodape salvando={formulario.salvando} aoCancelar={aoFechar} />}
    >
      <div className="hierarquia-formulario">
        <ErroDoEnvio mensagem={formulario.mensagem} />
        <Input
          rotulo={ROTULOS_REDE.nome}
          ajuda={ajuda("nomeRede")}
          name="nome"
          value={valores.nome}
          onChange={mudar("nome")}
          maxLength={LIMITES.nome}
          autoComplete="off"
          erro={erros.nome}
        />

        <Select
          rotulo={ROTULOS_REDE.divisao}
          ajuda={ajuda("divisaoRede")}
          name="divisao"
          dica="Mudar a divisão muda também a das células da rede."
          value={valores.divisao}
          onChange={mudar("divisao")}
          erro={erros.divisao}
        >
          {DIVISOES.map((divisao) => (
            <option key={divisao} value={divisao}>
              {ROTULO_DIVISAO[divisao]}
            </option>
          ))}
        </Select>

        <Input
          rotulo="Responsável (opcional)"
          ajuda={ajuda("responsavel")}
          name="responsavel_nome"
          dica="Pastor ou obreiro da rede."
          value={valores.responsavel_nome}
          onChange={mudar("responsavel_nome")}
          maxLength={LIMITES.nome}
          autoComplete="off"
          erro={erros.responsavel_nome}
        />
      </div>
    </Dialogo>
  );
}

// ---------------------------------------------------------------------------------------------------
// Exclusão (confirmação)
// ---------------------------------------------------------------------------------------------------

export type AlvoExclusao =
  | { entidade: "celula"; item: Celula }
  | { entidade: "discipulador"; item: Discipulador }
  | { entidade: "rede"; item: Rede };

const RECURSO: Record<Entidade, Recurso> = {
  celula: "celulas",
  discipulador: "discipuladores",
  rede: "redes",
};

const CONFIRMACAO: Record<Entidade, { titulo: string; regra: ReactNode }> = {
  celula: {
    titulo: "Excluir a célula",
    regra: "Só dá para excluir uma célula sem afiliado da Rifei vinculado.",
  },
  discipulador: {
    titulo: "Excluir o discipulador",
    regra: "Só dá para excluir um discipulador sem células.",
  },
  rede: {
    titulo: "Excluir a rede",
    regra: "Só dá para excluir uma rede sem discipuladores.",
  },
};

export function DialogoExcluir({
  alvo,
  aoFechar,
  aoExcluir,
  aoDesatualizar,
  focoAoFechar,
}: {
  alvo: AlvoExclusao;
  aoFechar: () => void;
  aoExcluir: () => void;
  aoDesatualizar: () => void;
  /** Para onde o foco vai depois de excluir (a linha some da tabela). */
  focoAoFechar?: RefObject<HTMLElement | null>;
}) {
  const [excluindo, setExcluindo] = useState(false);
  const [mensagem, setMensagem] = useState<string | null>(null);
  const { titulo, regra } = CONFIRMACAO[alvo.entidade];

  async function confirmar() {
    if (excluindo) return;
    setExcluindo(true);
    setMensagem(null);
    try {
      await excluir(RECURSO[alvo.entidade], alvo.item.id);
      aoExcluir();
    } catch (erro) {
      setMensagem(mensagemAoExcluir(erro, alvo.entidade));
      if (dadosDesatualizados(erro)) aoDesatualizar();
      setExcluindo(false);
    }
  }

  return (
    <Dialogo
      aberto
      papel="alertdialog"
      titulo={`${titulo} “${alvo.item.nome}”?`}
      descricao="Isso não pode ser desfeito."
      aoFechar={aoFechar}
      focoAoFechar={focoAoFechar}
      rodape={
        <>
          <ComDica texto={DICAS.cancelarExclusao}>
            <Button variante="secundario" onClick={aoFechar}>
              Cancelar
            </Button>
          </ComDica>
          <ComDica
            texto={excluindo ? DICAS.excluindo : DICAS.confirmarExclusao}
          >
            <Button variante="perigo" onClick={() => void confirmar()}>
              {excluindo ? "Excluindo…" : "Excluir"}
            </Button>
          </ComDica>
        </>
      }
    >
      <div className="hierarquia-formulario">
        {mensagem && (
          <Aviso tom="perigo" titulo="Não foi possível excluir">
            <p>{mensagem}</p>
          </Aviso>
        )}
        <p>{regra}</p>
      </div>
    </Dialogo>
  );
}
