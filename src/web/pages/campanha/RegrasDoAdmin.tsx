// As regras do admin na Campanha (D20): as chaves (desconsiderar pedido, o acesso de discipuladores e de redes e,
// desde a RIFA-064 (D29), o login das células com a senha padrão) e os quatro modelos das mensagens do link pessoal, com a pré-visualização preenchida por
// `preencherMensagem` (a mesma que a tela Acessos usa) e os problemas do modelo enquanto a pessoa digita.
// Só o admin muda esses três grupos (RIFA-042): para a coordenação, os dois cartões ficam só leitura, com o aviso
// "Só o admin muda estas regras." (as caixas com `aria-disabled` e os textos com `readOnly`, focáveis e descritos
// pelo aviso; o resumo "Regras da campanha" continua levando o foco a eles). Com uma rede só (RIFA-065, D30), sem a
// chave do acesso das redes nem a mensagem do link da rede: o valor gravado fica como está e vai igual no PUT.
import { useId } from "react";
import {
  LIMITE_CARACTERES_MENSAGEM,
  MARCADORES_DO_MODELO,
  MENSAGENS_PADRAO,
  TIPOS_MENSAGEM,
  preencherMensagem,
  problemasDoModelo,
  type TipoMensagem,
  type ValoresMensagem,
} from "../../../shared/contracts";
import {
  Aviso,
  Button,
  Card,
  ComAjuda,
  ComDica,
  Textarea,
} from "../../components/ui";
import { formatarNumero } from "../../lib/formatadores";
import {
  ROTULO_MENSAGEM,
  type ErrosFormulario,
  type Formulario,
} from "./formulario";
import { AJUDA, DICAS } from "./textos";

/** As chaves da campanha, pelo campo do formulário. */
export type ChaveDoFormulario =
  | "pedidos_desconsiderar"
  | "acesso_discipuladores"
  | "acesso_redes"
  | "acesso_celulas_senha";

/** O caminho de cada chave no contrato (para os erros e os ids dos campos). */
export const CAMINHO_DA_CHAVE: Record<ChaveDoFormulario, string> = {
  pedidos_desconsiderar: "pedidos.desconsiderar",
  acesso_discipuladores: "acesso.discipuladores",
  acesso_redes: "acesso.redes",
  acesso_celulas_senha: "acesso.celulas_senha",
};

/** Cada chave: o nome e uma linha do que acontece ligada e desligada. */
export const TEXTO_DA_CHAVE: Record<
  ChaveDoFormulario,
  { rotulo: string; ligada: string; desligada: string }
> = {
  pedidos_desconsiderar: {
    rotulo: "Permitir desconsiderar pedidos",
    ligada:
      "Ligada: o admin tira das contas um pedido de teste, fraude ou estorno (e desfaz), na tela Pedidos.",
    desligada:
      "Desligada: ninguém desconsidera nem desfaz; o que já foi desconsiderado continua fora das contas.",
  },
  acesso_discipuladores: {
    rotulo: "Acesso dos discipuladores",
    ligada:
      "Ligado: os discipuladores entram pelo link pessoal (ou com o nome e a senha padrão) e veem as células deles.",
    desligada:
      "Desligado: eles não entram (nem pela senha) nem recebem link novo; os links guardados voltam a valer quando religar.",
  },
  acesso_redes: {
    rotulo: "Acesso das redes",
    ligada:
      "Ligado: as redes entram pelo link pessoal e veem os discipuladores e as células delas.",
    desligada:
      "Desligado: elas não entram nem recebem link novo; os links guardados voltam a valer quando religar.",
  },
  // RIFA-064 (D29): a senha é a mesma regra para todas (não é segredo): o máximo que se vê é a página da célula. RIFA-082
  // (D37): a mesma chave vale para os discipuladores (junto com a do acesso deles), que veem só as células deles.
  acesso_celulas_senha: {
    rotulo: "Login com senha padrão (células e discipuladores)",
    ligada:
      "Ligado: cada célula entra com o nome dela e a senha @ + nome da célula + 1234 e vê só a página dela (ranking, meta e link de vendas); cada discipulador entra do mesmo jeito, com o nome dele, e vê só as células dele.",
    desligada:
      "Desligado: ninguém entra pela senha, e quem entrou assim sai na hora; os links pessoais continuam.",
  },
};

const ORDEM_DAS_CHAVES: readonly ChaveDoFormulario[] = [
  "pedidos_desconsiderar",
  "acesso_discipuladores",
  "acesso_redes",
  "acesso_celulas_senha",
];

/** As chaves que a tela mostra: com uma rede só (D30), sem o acesso das redes. */
export function chavesVisiveis(
  redeUnica: boolean,
): readonly ChaveDoFormulario[] {
  return redeUnica
    ? ORDEM_DAS_CHAVES.filter((chave) => chave !== "acesso_redes")
    : ORDEM_DAS_CHAVES;
}

/** As mensagens que a tela mostra: com uma rede só (D30), sem a do link da rede. */
export function mensagensVisiveis(redeUnica: boolean): readonly TipoMensagem[] {
  return redeUnica
    ? TIPOS_MENSAGEM.filter((tipo) => tipo !== "link_rede")
    : TIPOS_MENSAGEM;
}

/** O título do aviso dos grupos só do admin, para a coordenação (RIFA-042). */
export const TEXTO_SO_ADMIN = "Só o admin muda estas regras.";

/** O aviso no topo de cada cartão só leitura; os campos o têm como descrição (`id`). */
function AvisoSoAdmin({ id }: { id: string }) {
  return (
    <Aviso id={id} tom="info" anuncio="nenhum" titulo={TEXTO_SO_ADMIN}>
      Aqui você vê como estão valendo. Para mudar, fale com o admin.
    </Aviso>
  );
}

type PropsChaves = {
  formulario: Formulario;
  /** Coordenação (RIFA-042): as chaves aparecem como estão, sem mudar. */
  somenteLeitura: boolean;
  /** Uma rede só (D30): sem a chave do acesso das redes. */
  redeUnica?: boolean;
  idDoCampo: (chave: string) => string;
  aoAlterar: (chave: ChaveDoFormulario, ligada: boolean) => void;
};

/** As quatro chaves: uma caixa de marcar cada, com o que acontece ligada e desligada. */
export function ChavesDaCampanha({
  formulario,
  somenteLeitura,
  redeUnica = false,
  idDoCampo,
  aoAlterar,
}: PropsChaves) {
  const idAviso = useId();
  return (
    <Card titulo="Pedidos e acessos" ajuda={AJUDA.pedidosEAcessos}>
      <div className="campanha-campos">
        {somenteLeitura && <AvisoSoAdmin id={idAviso} />}
        <p className="campanha-texto-suave">
          {somenteLeitura
            ? "O que se pode fazer com os pedidos e quem entra no sistema."
            : "Ligue ou desligue o que a coordenação pode fazer e quem entra no sistema."}{" "}
          Os líderes de célula entram sempre pelo link pessoal.
        </p>
        <ul className="campanha-chaves">
          {chavesVisiveis(redeUnica).map((chave) => {
            const id = idDoCampo(CAMINHO_DA_CHAVE[chave]);
            const texto = TEXTO_DA_CHAVE[chave];
            const ligada = formulario[chave];
            return (
              <li key={chave} className="campanha-chave">
                {/* A ajuda fica na linha toda (caixa e texto) e no "?"; a caixa a tem na descrição (`id` dela). Só
                    leitura, ela diz também por que a caixa está indisponível. */}
                <ComAjuda
                  id={`${id}-dica`}
                  texto={
                    somenteLeitura
                      ? `${AJUDA.chave[chave]} ${DICAS.chaveSoLeitura}`
                      : AJUDA.chave[chave]
                  }
                  idDoTitulo={`${id}-rotulo`}
                >
                  <label className="campanha-opcao" htmlFor={id}>
                    <input
                      id={id}
                      type="checkbox"
                      checked={ligada}
                      // Só leitura: continua focável (o resumo e o link da tela Pedidos levam o foco a ela), com o
                      // aviso como descrição; o clique não muda nada (o React devolve a caixa ao valor dela).
                      aria-disabled={somenteLeitura || undefined}
                      aria-describedby={
                        somenteLeitura
                          ? `${idAviso} ${id}-explicacao ${id}-dica`
                          : `${id}-explicacao ${id}-dica`
                      }
                      onChange={(evento) => {
                        if (!somenteLeitura)
                          aoAlterar(chave, evento.target.checked);
                      }}
                    />
                    <span id={`${id}-rotulo`}>{texto.rotulo}</span>
                  </label>
                </ComAjuda>
                <p
                  id={`${id}-explicacao`}
                  className="campanha-chave__explicacao"
                >
                  <span className="campanha-chave__estado">
                    {ligada ? texto.ligada : texto.desligada}
                  </span>{" "}
                  <span className="campanha-texto-suave">
                    {ligada ? texto.desligada : texto.ligada}
                  </span>
                </p>
              </li>
            );
          })}
        </ul>
      </div>
    </Card>
  );
}

// ---------------------------------------------------------------------------------------------------
// Mensagens do link pessoal (RIFA-032)
// ---------------------------------------------------------------------------------------------------

/** Os nomes de exemplo da pré-visualização (fictícios). */
export const EXEMPLO_DA_MENSAGEM: Record<
  TipoMensagem,
  Omit<ValoresMensagem, "url">
> = {
  link_coordenacao: { pessoaNome: "Ana Souza" },
  link_lider: { pessoaNome: "Ana Souza", alvoNome: "Célula Ágape" },
  link_discipulador: { pessoaNome: "Carlos Lima", alvoNome: "Carlos Lima" },
  link_rede: { pessoaNome: "Paula Reis", alvoNome: "Rede Jovem" },
};

/** O link de exemplo da pré-visualização (o de verdade só existe na hora em que é gerado). */
export function linkDeExemplo(): string {
  return new URL("/acesso/link-pessoal-de-exemplo", window.location.origin)
    .href;
}

/** O que cada marcador vira, para a dica do campo. */
const EXPLICACAO_DO_MARCADOR: Record<string, string> = {
  saudacao: '{saudacao} = "Olá, Ana!" (ou "Olá!" sem nome)',
  nome: "{nome} = o primeiro nome",
  alvo: "{alvo} = o nome da célula, do discipulador ou da rede",
  link: "{link} = o link pessoal (obrigatório)",
};

/** Com uma rede só (D30), o {alvo} sem a rede. */
const EXPLICACAO_DO_ALVO_REDE_UNICA =
  "{alvo} = o nome da célula ou do discipulador";

/**
 * Os problemas do modelo como a pessoa digitou, em português: os do contrato (marcador desconhecido, falta do
 * {link}) e o tamanho (vazio ou acima do limite).
 */
export function problemasDaMensagem(
  tipo: TipoMensagem,
  texto: string,
): string[] {
  const tamanho = texto.trim().length;
  const problemas: string[] = [];
  if (tamanho === 0) problemas.push("Escreva a mensagem.");
  if (tamanho > LIMITE_CARACTERES_MENSAGEM)
    problemas.push(
      `A mensagem passou de ${formatarNumero(LIMITE_CARACTERES_MENSAGEM)} caracteres (tem ${formatarNumero(tamanho)}).`,
    );
  return tamanho === 0
    ? problemas
    : [...problemasDoModelo(tipo, texto), ...problemas];
}

type PropsMensagens = {
  mensagens: Formulario["mensagens"];
  /** Coordenação (RIFA-042): os modelos aparecem como estão (com a pré-visualização), sem editar. */
  somenteLeitura: boolean;
  /** Uma rede só (D30): sem a mensagem do link da rede, e o {alvo} sem a rede. */
  redeUnica?: boolean;
  /** Os erros do último "Salvar" (do contrato ou da API). */
  erros: ErrosFormulario;
  idDoCampo: (chave: string) => string;
  aoAlterar: (tipo: TipoMensagem, texto: string) => void;
  aoVoltarAoPadrao: (tipo: TipoMensagem) => void;
};

/** Os quatro modelos, cada um com a dica dos marcadores, os problemas e a pré-visualização. */
export function MensagensDoLink({
  mensagens,
  somenteLeitura,
  redeUnica = false,
  erros,
  idDoCampo,
  aoAlterar,
  aoVoltarAoPadrao,
}: PropsMensagens) {
  const idAviso = useId();
  return (
    <Card titulo="Mensagens do link pessoal" ajuda={AJUDA.mensagens}>
      <div className="campanha-campos">
        {somenteLeitura && <AvisoSoAdmin id={idAviso} />}
        <p className="campanha-texto-suave">
          {somenteLeitura
            ? "O texto que vai pelo WhatsApp com o link de cada pessoa (tela Acessos): o sistema troca cada marcador entre chaves pelo valor de quem recebe."
            : "O texto que vai pelo WhatsApp com o link de cada pessoa (tela Acessos). Escreva os marcadores entre chaves, como estão na dica: o sistema troca cada um pelo valor de quem recebe."}{" "}
          O bumbo não muda aqui.
        </p>
        {mensagensVisiveis(redeUnica).map((tipo) => (
          <EditorMensagem
            key={tipo}
            tipo={tipo}
            redeUnica={redeUnica}
            texto={mensagens[tipo]}
            idAvisoSoAdmin={somenteLeitura ? idAviso : null}
            erroAoSalvar={erros[`mensagens.${tipo}`]}
            id={idDoCampo(`mensagens.${tipo}`)}
            aoAlterar={(texto) => aoAlterar(tipo, texto)}
            aoVoltarAoPadrao={() => aoVoltarAoPadrao(tipo)}
          />
        ))}
      </div>
    </Card>
  );
}

function EditorMensagem({
  tipo,
  redeUnica,
  texto,
  idAvisoSoAdmin,
  erroAoSalvar,
  id,
  aoAlterar,
  aoVoltarAoPadrao,
}: {
  tipo: TipoMensagem;
  redeUnica: boolean;
  texto: string;
  /** O aviso "Só o admin muda estas regras." (só leitura), ou null (o admin edita). */
  idAvisoSoAdmin: string | null;
  erroAoSalvar: string | undefined;
  id: string;
  aoAlterar: (texto: string) => void;
  aoVoltarAoPadrao: () => void;
}) {
  const somenteLeitura = idAvisoSoAdmin !== null;
  const idPrevia = useId();
  const idContagem = useId();
  const problemas = problemasDaMensagem(tipo, texto);
  const ehPadrao = texto === MENSAGENS_PADRAO[tipo];
  const previa = preencherMensagem(texto, {
    ...EXEMPLO_DA_MENSAGEM[tipo],
    url: linkDeExemplo(),
  });
  const erro =
    erroAoSalvar ?? (problemas.length > 0 ? problemas.join(" ") : undefined);

  function voltar() {
    aoVoltarAoPadrao();
    document.getElementById(id)?.focus();
  }

  return (
    <div className="campanha-mensagem">
      <Textarea
        id={id}
        rotulo={ROTULO_MENSAGEM[tipo]}
        ajuda={
          somenteLeitura ? DICAS.mensagemSoLeitura(tipo) : AJUDA.mensagem(tipo)
        }
        dica={`Marcadores: ${MARCADORES_DO_MODELO[tipo]
          .map((marcador) =>
            redeUnica && marcador === "alvo"
              ? EXPLICACAO_DO_ALVO_REDE_UNICA
              : EXPLICACAO_DO_MARCADOR[marcador],
          )
          .join("; ")}.`}
        erro={erro}
        value={texto}
        rows={5}
        spellCheck={!somenteLeitura}
        readOnly={somenteLeitura}
        aria-describedby={idAvisoSoAdmin ?? undefined}
        onChange={(evento) => {
          if (!somenteLeitura) aoAlterar(evento.target.value);
        }}
      />
      <div className="campanha-mensagem__rodape">
        <p id={idContagem} className="campanha-texto-suave">
          {formatarNumero(texto.trim().length)} de{" "}
          {formatarNumero(LIMITE_CARACTERES_MENSAGEM)} caracteres
          {ehPadrao ? " · é o texto padrão" : ""}
        </p>
        {!somenteLeitura && (
          <ComDica
            texto={
              ehPadrao ? DICAS.voltarAoPadraoJaEstaNele : DICAS.voltarAoPadrao
            }
          >
            <Button
              variante="discreto"
              aria-disabled={ehPadrao || undefined}
              // Indisponível: a contagem ao lado diz por quê ("é o texto padrão").
              aria-describedby={ehPadrao ? idContagem : undefined}
              onClick={() => {
                if (!ehPadrao) voltar();
              }}
            >
              Voltar ao texto padrão{" "}
              <span className="visualmente-oculto">
                da {ROTULO_MENSAGEM[tipo].toLowerCase()}
              </span>
            </Button>
          </ComDica>
        )}
      </div>
      <figure className="campanha-previa" aria-labelledby={idPrevia}>
        <figcaption id={idPrevia} className="campanha-previa__titulo">
          Pré-visualização: {ROTULO_MENSAGEM[tipo].toLowerCase()}, com nomes de
          exemplo
        </figcaption>
        <p className="campanha-previa__texto">{previa}</p>
      </figure>
    </div>
  );
}
