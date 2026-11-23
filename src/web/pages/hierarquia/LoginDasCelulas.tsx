import { useState } from "react";
import type { Celula, Discipulador } from "../../../shared/contracts";
// Sem o zod (o index do contrato o traria): a regra da senha vem dos módulos dela.
import {
  problemasDoLoginDasCelulas,
  senhaPadraoDaCelula,
} from "../../../shared/contracts/login-celula";
import {
  problemasDoLoginDosDiscipuladores,
  senhaPadraoDoDiscipulador,
} from "../../../shared/contracts/login-discipulador";
import { Aviso, Button, Card, ComDica } from "../../components/ui";
import { copiarTexto } from "../../components/qr/compartilhar";
import { DICAS, compararNomes } from "./textos";
import { ajuda } from "../ajuda-sob-demanda";

/** "“Pão Vivo” e “Pao Vivo”", "“A”, “B” e “C”". */
function juntarNomes(itens: readonly { nome: string }[]): string {
  const nomes = itens.map((item) => `“${item.nome}”`);
  return nomes.length <= 1
    ? (nomes[0] ?? "")
    : `${nomes.slice(0, -1).join(", ")} e ${nomes.at(-1)}`;
}

/** Quem entra com a senha padrão: a célula (RIFA-064, D29) ou o discipulador (RIFA-082, D37). */
type Grupo = "celula" | "discipulador";

type Copia = { grupo: Grupo; id: number; resultado: "copiada" | "falhou" };

type Item = { id: number; nome: string };

/** O que muda entre a lista das células e a dos discipuladores: a regra (a mesma), os textos e as dicas. */
const DO_GRUPO = {
  celula: {
    senhaDe: senhaPadraoDaCelula,
    problemas: problemasDoLoginDasCelulas<Item>,
    verSenhas: "Ver a senha de cada célula",
    dicaVerSenhas: DICAS.verSenhas,
    dicaCopiar: DICAS.copiarSenha,
    /** "da Célula Betel": no "Copiar a senha …" e no aviso de copiada. */
    deQuem: (nome: string) => `da ${nome}`,
    tituloDoAviso: (quantas: number) =>
      quantas === 1
        ? "1 célula não entra com a senha padrão"
        : `${quantas} células não entram com a senha padrão`,
    repetidas: (nomes: string) =>
      `${nomes} ficam com o mesmo nome no login. Mude o nome de uma delas (Editar, na aba Células) para que entrem.`,
    semSenha: (nome: string) =>
      `${nome}: o nome não tem letra nem número. Mude o nome para que ela entre.`,
  },
  discipulador: {
    senhaDe: senhaPadraoDoDiscipulador,
    problemas: problemasDoLoginDosDiscipuladores<Item>,
    verSenhas: "Ver a senha de cada discipulador",
    dicaVerSenhas: DICAS.verSenhasDiscipuladores,
    dicaCopiar: DICAS.copiarSenhaDiscipulador,
    /** "de Pr. Fábio": os discipuladores são pessoas, chamadas pelo nome. */
    deQuem: (nome: string) => `de ${nome}`,
    tituloDoAviso: (quantos: number) =>
      quantos === 1
        ? "1 discipulador não entra com a senha padrão"
        : `${quantos} discipuladores não entram com a senha padrão`,
    repetidas: (nomes: string) =>
      `${nomes} ficam com o mesmo nome no login. Mude o nome de um deles (Editar, na aba Discipuladores) para que entrem.`,
    semSenha: (nome: string) =>
      `${nome}: o nome não tem letra nem número. Mude o nome para que ele entre.`,
  },
} as const satisfies Record<Grupo, unknown>;

/** Um grupo pronto para a tela: os itens em ordem de nome, quem não entra pela senha e por quê. */
function montarGrupo(grupo: Grupo, itens: readonly Item[]) {
  const ordenados = [...itens].sort((a, b) => compararNomes(a.nome, b.nome));
  const { repetidas, semSenha } = DO_GRUPO[grupo].problemas(ordenados);
  const bloqueados = new Set(
    [...repetidas.flat(), ...semSenha].map((item) => item.id),
  );
  return { grupo, ordenados, repetidas, semSenha, bloqueados };
}

// O login com a senha padrão (RIFA-064, D29: as células; RIFA-082, D37: os discipuladores), para a coordenação (esta
// tela é de admin e coordenação, nunca dos papéis da hierarquia): para cada grupo, o aviso de quem não entra pela senha
// (dois nomes iguais depois da normalização, que a API recusa por serem ambíguos, ou um nome sem letra nem número) e, num
// <details> fechado, a senha de cada um com "Copiar", para repassar. A senha não é segredo nem vem da API: sai do nome,
// pela mesma regra do Worker (src/shared/contracts/login-celula.ts e login-discipulador.ts).
export function LoginDasCelulas({
  celulas,
  discipuladores = [],
}: {
  celulas: readonly Celula[];
  discipuladores?: readonly Discipulador[];
}) {
  const [copia, setCopia] = useState<Copia | null>(null);
  if (celulas.length === 0 && discipuladores.length === 0) return null;

  const grupos = [
    montarGrupo("celula", celulas),
    montarGrupo("discipulador", discipuladores),
  ].filter((montado) => montado.ordenados.length > 0);

  async function copiar(grupo: Grupo, item: Item, senha: string) {
    const resultado = await copiarTexto(senha, null);
    setCopia({
      grupo,
      id: item.id,
      resultado: resultado === "copiado" ? "copiada" : "falhou",
    });
  }

  return (
    <Card titulo="Login com senha padrão" ajuda={ajuda("loginDasCelulas")}>
      <div className="hierarquia-login">
        <p className="hierarquia-login__texto">
          Cada célula entra na tela Entrar com o nome dela e a senha padrão: @,
          o nome da célula sem acentos, espaços e pontuação, e 1234. Quem entra
          vê só a página da célula. Cada discipulador entra do mesmo jeito, em
          “Sou discipulador”, com o nome dele, e vê só as células dele. Ligar e
          desligar fica na Campanha (só o admin).
        </p>
        {grupos.map(({ grupo, repetidas, semSenha, bloqueados }) => {
          const textos = DO_GRUPO[grupo];
          return (
            bloqueados.size > 0 && (
              <Aviso
                key={`aviso-${grupo}`}
                tom="alerta"
                anuncio="nenhum"
                titulo={textos.tituloDoAviso(bloqueados.size)}
              >
                <ul className="hierarquia-login__problemas">
                  {repetidas.map((repetidos) => (
                    <li key={repetidos.map((item) => item.id).join("-")}>
                      {textos.repetidas(juntarNomes(repetidos))}
                    </li>
                  ))}
                  {semSenha.map((item) => (
                    <li key={item.id}>
                      {textos.semSenha(juntarNomes([item]))}
                    </li>
                  ))}
                </ul>
              </Aviso>
            )
          );
        })}
        {grupos.map(({ grupo, ordenados, bloqueados }) => {
          const textos = DO_GRUPO[grupo];
          const nomeDaCopia =
            copia?.grupo === grupo
              ? ordenados.find((item) => item.id === copia.id)?.nome
              : undefined;
          return (
            <details key={grupo} className="hierarquia-login__senhas">
              <ComDica texto={textos.dicaVerSenhas}>
                <summary>{textos.verSenhas}</summary>
              </ComDica>
              <p className="hierarquia-login__copia" role="status">
                {copia === null || nomeDaCopia === undefined
                  ? ""
                  : copia.resultado === "copiada"
                    ? `Senha ${textos.deQuem(nomeDaCopia)} copiada.`
                    : `Não deu para copiar sozinho: copie a senha ${textos.deQuem(nomeDaCopia)} da lista.`}
              </p>
              <ul className="hierarquia-login__lista">
                {ordenados.map((item) => {
                  const senha = bloqueados.has(item.id)
                    ? null
                    : textos.senhaDe(item.nome);
                  return (
                    <li key={item.id} className="hierarquia-login__item">
                      <span className="hierarquia-login__celula">
                        {item.nome}
                      </span>
                      {senha === null ? (
                        <span className="hierarquia-login__sem-senha">
                          Não entra pela senha (veja o aviso).
                        </span>
                      ) : (
                        <>
                          <code className="hierarquia-login__senha">
                            {senha}
                          </code>
                          <ComDica texto={textos.dicaCopiar}>
                            <Button
                              variante="secundario"
                              tamanho="pequeno"
                              aria-label={`Copiar a senha ${textos.deQuem(item.nome)}`}
                              onClick={() => void copiar(grupo, item, senha)}
                            >
                              Copiar
                            </Button>
                          </ComDica>
                        </>
                      )}
                    </li>
                  );
                })}
              </ul>
            </details>
          );
        })}
      </div>
    </Card>
  );
}
