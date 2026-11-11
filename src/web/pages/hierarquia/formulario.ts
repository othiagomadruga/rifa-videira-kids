// Apoio dos diálogos de edição: validação no navegador (com as regras do contrato) e o envio, que traduz
// os erros da API para os campos (400 mostra o campo, 409 nome_duplicado marca o nome).
import { useRef, useState } from "react";
import { ErroApi } from "../../lib/api";
import {
  camposDoErro,
  dadosDesatualizados,
  mensagemAoSalvar,
  mensagemNomeRepetido,
  type Entidade,
} from "./textos";

/** Limites do contrato (nomes até 120, telefone até 40, e-mail até 254, pessoas de 1 a 1000). */
export const LIMITES = {
  nome: 120,
  telefone: 40,
  email: 254,
  pessoasMin: 1,
  pessoasMax: 1000,
} as const;

export type Erros<C extends string> = Partial<Record<C, string>>;

export function validarNome(
  valor: string,
  mensagemVazio: string,
): string | undefined {
  const limpo = valor.trim();
  if (limpo === "") return mensagemVazio;
  if (limpo.length > LIMITES.nome) {
    return `Use no máximo ${LIMITES.nome} caracteres.`;
  }
  return undefined;
}

export function validarOpcional(
  valor: string,
  limite: number,
): string | undefined {
  return valor.trim().length > limite
    ? `Use no máximo ${limite} caracteres.`
    : undefined;
}

export function validarEmail(valor: string): string | undefined {
  const limpo = valor.trim();
  if (limpo === "") return undefined;
  return limpo.length <= LIMITES.email &&
    /^[^\s@]+@[^\s@.]+(\.[^\s@.]+)+$/.test(limpo)
    ? undefined
    : "E-mail inválido. Confira ou deixe em branco.";
}

export function validarPessoas(valor: string): string | undefined {
  const limpo = valor.trim();
  const numero = Number(limpo);
  return /^\d+$/.test(limpo) &&
    numero >= LIMITES.pessoasMin &&
    numero <= LIMITES.pessoasMax
    ? undefined
    : `Use um número inteiro de ${LIMITES.pessoasMin} a ${LIMITES.pessoasMax}.`;
}

/** Campo opcional: vazio vira null (apaga o valor no cadastro). */
export function textoOuNulo(valor: string): string | null {
  const limpo = valor.trim();
  return limpo === "" ? null : limpo;
}

type Configuracao<C extends string> = {
  entidade: Entidade;
  /** Campos na ordem da tela (o foco vai para o primeiro com erro). */
  ordem: readonly C[];
  /** Rótulos dos campos, para dizer qual a API recusou. */
  rotulos: Record<C, string>;
  /** Texto de cada campo quando a API o recusa (400). */
  errosDaApi: Record<C, string>;
  /** Chamado quando o registro ou a referência não existe mais (404, referencia_invalida) ou mudou ao mesmo tempo (409). */
  aoDesatualizar: () => void;
};

type Envio<C extends string, R> = {
  formulario: HTMLFormElement;
  /** Resultado da validação no navegador; com erro, nada é enviado. */
  erros: Erros<C>;
  /** Nome digitado (para a mensagem de nome repetido). */
  nome: string;
  salvar: () => Promise<R>;
  aoSalvar: (resultado: R) => void;
};

export function useFormularioEdicao<C extends string>({
  entidade,
  ordem,
  rotulos,
  errosDaApi,
  aoDesatualizar,
}: Configuracao<C>) {
  const [erros, setErros] = useState<Erros<C>>({});
  const [mensagem, setMensagem] = useState<string | null>(null);
  const [salvando, setSalvando] = useState(false);
  // Trava síncrona contra envio duplo (o estado só muda no próximo render).
  const enviando = useRef(false);

  function limparErro(campo: C) {
    setErros((atuais) =>
      atuais[campo] ? { ...atuais, [campo]: undefined } : atuais,
    );
  }

  function focarPrimeiroErro(formulario: HTMLFormElement, comErro: Erros<C>) {
    const campo = ordem.find((nome) => comErro[nome]);
    const elemento = campo ? formulario.elements.namedItem(campo) : null;
    if (elemento instanceof HTMLElement) elemento.focus();
  }

  async function enviar<R>(envio: Envio<C, R>) {
    if (enviando.current) return;
    setMensagem(null);
    if (ordem.some((campo) => envio.erros[campo])) {
      setErros(envio.erros);
      focarPrimeiroErro(envio.formulario, envio.erros);
      return;
    }
    setErros({});
    enviando.current = true;
    setSalvando(true);
    try {
      const resultado = await envio.salvar();
      envio.aoSalvar(resultado);
    } catch (erro) {
      const daApi = errosDoServidor(erro);
      setErros(daApi);
      setMensagem(mensagemDoEnvio(erro, envio.nome, daApi));
      if (dadosDesatualizados(erro)) aoDesatualizar();
      focarPrimeiroErro(envio.formulario, daApi);
    } finally {
      enviando.current = false;
      setSalvando(false);
    }
  }

  function errosDoServidor(erro: unknown): Erros<C> {
    const comErro: Erros<C> = {};
    for (const campo of camposDoErro(erro)) {
      if ((ordem as readonly string[]).includes(campo)) {
        comErro[campo as C] = errosDaApi[campo as C];
      }
    }
    if (
      erro instanceof ErroApi &&
      erro.codigo === "nome_duplicado" &&
      (ordem as readonly string[]).includes("nome")
    ) {
      comErro["nome" as C] = mensagemNomeRepetido(entidade);
    }
    return comErro;
  }

  function mensagemDoEnvio(
    erro: unknown,
    nome: string,
    comErro: Erros<C>,
  ): string {
    const campos = ordem.filter((campo) => comErro[campo]);
    if (
      erro instanceof ErroApi &&
      erro.codigo === "requisicao_invalida" &&
      campos.length > 0
    ) {
      const lista = campos.map((campo) => rotulos[campo]).join(", ");
      return `A API recusou ${campos.length > 1 ? "os campos" : "o campo"}: ${lista}. Confira e salve de novo.`;
    }
    return mensagemAoSalvar(erro, entidade, nome);
  }

  return { erros, mensagem, salvando, limparErro, enviar };
}
