import { useState } from "react";
import type { Celula } from "../../../shared/contracts";
// Sem o zod (o index do contrato o traria): a regra da senha vem do módulo dela.
import {
  problemasDoLoginDasCelulas,
  senhaPadraoDaCelula,
} from "../../../shared/contracts/login-celula";
import { Aviso, Button, Card, ComDica } from "../../components/ui";
import { copiarTexto } from "../../components/qr/compartilhar";
import { DICAS, compararNomes } from "./textos";
import { ajuda } from "../ajuda-sob-demanda";

/** "“Pão Vivo” e “Pao Vivo”", "“A”, “B” e “C”". */
function juntarNomes(celulas: readonly { nome: string }[]): string {
  const nomes = celulas.map((celula) => `“${celula.nome}”`);
  return nomes.length <= 1
    ? (nomes[0] ?? "")
    : `${nomes.slice(0, -1).join(", ")} e ${nomes.at(-1)}`;
}

type Copia = { celulaId: number; resultado: "copiada" | "falhou" };

// O login das células com a senha padrão (RIFA-064, D29), para a coordenação (esta tela é de admin e coordenação, nunca
// dos papéis da hierarquia): o aviso das células que não entram pela senha (dois nomes iguais depois da normalização,
// que a API recusa por serem ambíguos, ou um nome sem letra nem número) e, num <details> fechado, a senha de cada
// célula com "Copiar", para repassar ao líder. A senha não é segredo nem vem da API: sai do nome, pela mesma regra do
// Worker (src/shared/contracts/login-celula.ts).
export function LoginDasCelulas({ celulas }: { celulas: readonly Celula[] }) {
  const [copia, setCopia] = useState<Copia | null>(null);
  if (celulas.length === 0) return null;

  const ordenadas = [...celulas].sort((a, b) => compararNomes(a.nome, b.nome));
  const { repetidas, semSenha } = problemasDoLoginDasCelulas(ordenadas);
  const bloqueadas = new Set(
    [...repetidas.flat(), ...semSenha].map((celula) => celula.id),
  );
  const nomeDaCopia = ordenadas.find(
    (celula) => celula.id === copia?.celulaId,
  )?.nome;

  async function copiar(celula: Celula, senha: string) {
    const resultado = await copiarTexto(senha, null);
    setCopia({
      celulaId: celula.id,
      resultado: resultado === "copiado" ? "copiada" : "falhou",
    });
  }

  return (
    <Card titulo="Login das células com senha" ajuda={ajuda("loginDasCelulas")}>
      <div className="hierarquia-login">
        <p className="hierarquia-login__texto">
          Cada célula entra na tela Entrar com o nome dela e a senha padrão: @,
          o nome da célula sem acentos, espaços e pontuação, e 1234. Quem entra
          vê só a página da célula. Ligar e desligar fica na Campanha (só o
          admin).
        </p>
        {bloqueadas.size > 0 && (
          <Aviso
            tom="alerta"
            anuncio="nenhum"
            titulo={
              bloqueadas.size === 1
                ? "1 célula não entra com a senha padrão"
                : `${bloqueadas.size} células não entram com a senha padrão`
            }
          >
            <ul className="hierarquia-login__problemas">
              {repetidas.map((grupo) => (
                <li key={grupo.map((celula) => celula.id).join("-")}>
                  {juntarNomes(grupo)} ficam com o mesmo nome no login. Mude o
                  nome de uma delas (Editar, na aba Células) para que entrem.
                </li>
              ))}
              {semSenha.map((celula) => (
                <li key={celula.id}>
                  {juntarNomes([celula])}: o nome não tem letra nem número. Mude
                  o nome para que ela entre.
                </li>
              ))}
            </ul>
          </Aviso>
        )}
        <details className="hierarquia-login__senhas">
          <ComDica texto={DICAS.verSenhas}>
            <summary>Ver a senha de cada célula</summary>
          </ComDica>
          <p className="hierarquia-login__copia" role="status">
            {copia === null || nomeDaCopia === undefined
              ? ""
              : copia.resultado === "copiada"
                ? `Senha da ${nomeDaCopia} copiada.`
                : `Não deu para copiar sozinho: copie a senha da ${nomeDaCopia} da lista.`}
          </p>
          <ul className="hierarquia-login__lista">
            {ordenadas.map((celula) => {
              const senha = bloqueadas.has(celula.id)
                ? null
                : senhaPadraoDaCelula(celula.nome);
              return (
                <li key={celula.id} className="hierarquia-login__item">
                  <span className="hierarquia-login__celula">
                    {celula.nome}
                  </span>
                  {senha === null ? (
                    <span className="hierarquia-login__sem-senha">
                      Não entra pela senha (veja o aviso).
                    </span>
                  ) : (
                    <>
                      <code className="hierarquia-login__senha">{senha}</code>
                      <ComDica texto={DICAS.copiarSenha}>
                        <Button
                          variante="secundario"
                          tamanho="pequeno"
                          aria-label={`Copiar a senha da ${celula.nome}`}
                          onClick={() => void copiar(celula, senha)}
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
      </div>
    </Card>
  );
}
