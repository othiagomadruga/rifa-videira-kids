import { Suspense, lazy, useEffect, useRef, useState } from "react";
import type {
  LinkAcesso,
  LinkAcessoCriado,
  Usuario,
} from "../../../shared/contracts";
import {
  Abas,
  Aviso,
  Button,
  EmptyState,
  ErrorState,
  Loading,
  PageHeader,
} from "../../components/ui";
import { mensagemDoErro } from "../../lib/api";
import { useUsuarioConectado } from "../../lib/sessao";
import { definirAtivo, gerarLink, listarPessoas } from "./acessos-api";
import {
  DialogoDesativar,
  DialogoLink,
  DialogoNovaPessoa,
  DialogoRevogar,
  type PessoaCriada,
} from "./Dialogos";
import { PessoaCartao, idBotaoAtivo, idBotaoGerar } from "./PessoaCartao";
import { useRegrasDosAcessos, type Mensagens } from "./regras";
import "./acessos.css";

/** Pessoas carregadas e o erro da última carga (com dados, o erro é de uma recarga). */
type Carga = { dados: Usuario[] | null; erro: unknown };
/** O link que acabou de ser criado: a URL só existe aqui, até fechar o diálogo. */
type LinkMostrado = { nome: string; link: LinkAcessoCriado };
type Ocupada = { usuarioId: number; acao: "gerando" | "reativando" };
type Resultado = { tom: "sucesso" | "perigo"; texto: string };

type AbaAcessos = "coordenacao" | "hierarquia" | "webhook";

// As abas da hierarquia e do webhook vêm cada uma num pacote à parte, carregado quando o admin a abre pela primeira
// vez.
const AcessosHierarquia = lazy(() =>
  import("./AcessosHierarquia").then((modulo) => ({
    default: modulo.AcessosHierarquia,
  })),
);
const WebhookRifei = lazy(() =>
  import("./WebhookRifei").then((modulo) => ({
    default: modulo.WebhookRifei,
  })),
);

// Gestão dos acessos (só admin), em três abas: a coordenação (pessoas, cada uma com o próprio link), os
// líderes, discipuladores e redes (um acesso por alvo da hierarquia, com links em lote; RIFA-014) e o webhook da
// Rifei (o token que a Rifei usa para entregar as vendas; RIFA-039, D21). O link (com o token) só aparece na
// resposta que o cria: a tela o mostra uma vez, num diálogo, e o esquece ao fechar. As listas (GET) nunca trazem
// o token. As abas da hierarquia e do webhook só carregam quando são abertas.
export function AcessosPage() {
  const [aba, setAba] = useState<AbaAcessos>("coordenacao");
  // As regras da campanha (D20): o acesso de discipuladores e de redes e os modelos das mensagens.
  const { regras, desligar } = useRegrasDosAcessos();
  const [hierarquiaAberta, setHierarquiaAberta] = useState(false);
  const [webhookAberta, setWebhookAberta] = useState(false);

  function mudarAba(nova: AbaAcessos) {
    setAba(nova);
    if (nova === "hierarquia") setHierarquiaAberta(true);
    if (nova === "webhook") setWebhookAberta(true);
  }

  return (
    <>
      <PageHeader
        titulo="Acessos"
        descricao="Quem entra no sistema. Cada um entra pelo próprio link, mandado pelo WhatsApp; o link só aparece na hora em que é criado."
      />
      <Abas
        rotulo="Grupos de acesso"
        abaAtiva={aba}
        aoMudar={mudarAba}
        abas={[
          {
            id: "coordenacao",
            rotulo: "Coordenação",
            conteudo: <AcessosCoordenacao mensagens={regras.mensagens} />,
          },
          {
            id: "hierarquia",
            rotulo: "Líderes, discipuladores e redes",
            conteudo: hierarquiaAberta ? (
              <Suspense fallback={<Loading texto="Carregando os acessos…" />}>
                <AcessosHierarquia regras={regras} aoDesligar={desligar} />
              </Suspense>
            ) : null,
          },
          {
            id: "webhook",
            rotulo: "Webhook da Rifei",
            conteudo: webhookAberta ? (
              <Suspense
                fallback={<Loading texto="Carregando o token do webhook…" />}
              >
                <WebhookRifei />
              </Suspense>
            ) : null,
          },
        ]}
      />
    </>
  );
}

// Pessoas da coordenação (admin e coordenação): um cartão por pessoa, com os links e as ações.
function AcessosCoordenacao({ mensagens }: { mensagens: Mensagens }) {
  const eu = useUsuarioConectado();
  const [carga, setCarga] = useState<Carga>({ dados: null, erro: null });
  const [versao, setVersao] = useState(0);
  const [criando, setCriando] = useState(false);
  const [linkMostrado, setLinkMostrado] = useState<LinkMostrado | null>(null);
  const [revogacao, setRevogacao] = useState<{
    pessoa: Usuario;
    link: LinkAcesso;
  } | null>(null);
  const [desativacao, setDesativacao] = useState<Usuario | null>(null);
  const [ocupada, setOcupada] = useState<Ocupada | null>(null);
  const [resultado, setResultado] = useState<Resultado | null>(null);
  // Trava síncrona das ações diretas (gerar link e reativar).
  const acaoEmAndamento = useRef(false);
  // Depois de revogar, o botão do link some: o foco vai para outro botão da pessoa.
  const refFocoAposRevogar = useRef<HTMLElement | null>(null);

  useEffect(() => {
    const controle = new AbortController();
    listarPessoas({ signal: controle.signal }).then(
      (dados) => setCarga({ dados, erro: null }),
      (erro: unknown) => {
        if (!controle.signal.aborted) {
          setCarga((atual) => ({ dados: atual.dados, erro }));
        }
      },
    );
    return () => controle.abort();
  }, [versao]);

  function recarregar() {
    setVersao((atual) => atual + 1);
  }

  function tentarDeNovo() {
    setCarga({ dados: null, erro: null });
    recarregar();
  }

  function avisar(tom: Resultado["tom"], texto: string) {
    setResultado({ tom, texto });
  }

  function aoCriarPessoa({ usuario, link }: PessoaCriada) {
    setCriando(false);
    setLinkMostrado({ nome: usuario.nome, link });
    avisar("sucesso", `Cadastro de ${usuario.nome} criado.`);
    recarregar();
  }

  async function executarAcao(
    pessoa: Usuario,
    acao: Ocupada["acao"],
    executar: () => Promise<void>,
  ) {
    if (acaoEmAndamento.current) return;
    acaoEmAndamento.current = true;
    setOcupada({ usuarioId: pessoa.id, acao });
    try {
      await executar();
    } catch (erro) {
      avisar(
        "perigo",
        `${acao === "gerando" ? "Não foi possível gerar o link" : "Não foi possível reativar o acesso"} de ${pessoa.nome}: ${mensagemDoErro(erro)}`,
      );
      recarregar();
    } finally {
      acaoEmAndamento.current = false;
      setOcupada(null);
    }
  }

  function gerarLinkNovo(pessoa: Usuario) {
    void executarAcao(pessoa, "gerando", async () => {
      const link = await gerarLink(pessoa.id);
      setLinkMostrado({ nome: pessoa.nome, link });
      avisar("sucesso", `Link novo de ${pessoa.nome} criado.`);
      recarregar();
    });
  }

  function reativar(pessoa: Usuario) {
    void executarAcao(pessoa, "reativando", async () => {
      await definirAtivo(pessoa.id, true);
      avisar("sucesso", `Acesso de ${pessoa.nome} reativado.`);
      recarregar();
    });
  }

  function pedirRevogacao(pessoa: Usuario, link: LinkAcesso) {
    refFocoAposRevogar.current = null;
    setRevogacao({ pessoa, link });
  }

  function aoRevogar(pessoa: Usuario) {
    refFocoAposRevogar.current =
      document.getElementById(idBotaoGerar(pessoa.id)) ??
      document.getElementById(idBotaoAtivo(pessoa.id));
    setRevogacao(null);
    avisar("sucesso", `Link de ${pessoa.nome} revogado.`);
    recarregar();
  }

  function aoDesativar(pessoa: Usuario) {
    setDesativacao(null);
    avisar("sucesso", `Acesso de ${pessoa.nome} desativado.`);
    recarregar();
  }

  const { dados, erro } = carga;

  return (
    <div className="acessos-coordenacao">
      <div className="acessos-coordenacao__topo">
        <p className="acessos-suave">
          Quem entra na área da coordenação: admin e coordenação.
        </p>
        <Button onClick={() => setCriando(true)}>Nova pessoa</Button>
      </div>
      {/* Região viva fixa: anuncia o resultado de cada ação. */}
      <p className="visualmente-oculto" role="status">
        {resultado?.texto ?? ""}
      </p>
      {resultado && (
        <Aviso
          tom={resultado.tom}
          anuncio="nenhum"
          aoFechar={() => setResultado(null)}
        >
          <p>{resultado.texto}</p>
        </Aviso>
      )}
      {!dados && erro === null && <Loading texto="Carregando as pessoas…" />}
      {!dados && erro !== null && (
        <ErrorState
          titulo="Não foi possível carregar as pessoas."
          mensagem={mensagemDoErro(erro)}
          aoTentarDeNovo={tentarDeNovo}
        />
      )}
      {dados && erro !== null && (
        <Aviso
          tom="perigo"
          titulo="Não foi possível atualizar a lista"
          acao={
            <Button variante="secundario" onClick={recarregar}>
              Tentar de novo
            </Button>
          }
        >
          <p>{mensagemDoErro(erro)}</p>
        </Aviso>
      )}
      {dados && dados.length === 0 && (
        <EmptyState
          titulo="Ninguém cadastrado ainda."
          descricao="Toque em Nova pessoa para criar o primeiro acesso."
        />
      )}
      {dados && dados.length > 0 && (
        <ul className="acessos-lista" aria-label="Pessoas com acesso">
          {dados.map((pessoa) => (
            <li key={pessoa.id}>
              <PessoaCartao
                pessoa={pessoa}
                ehVoce={pessoa.id === eu.id}
                ocupada={ocupada?.usuarioId === pessoa.id ? ocupada.acao : null}
                aoGerarLink={() => gerarLinkNovo(pessoa)}
                aoRevogar={(link) => pedirRevogacao(pessoa, link)}
                aoDesativar={() => setDesativacao(pessoa)}
                aoReativar={() => reativar(pessoa)}
              />
            </li>
          ))}
        </ul>
      )}
      {criando && (
        <DialogoNovaPessoa
          aoFechar={() => setCriando(false)}
          aoCriar={aoCriarPessoa}
        />
      )}
      {linkMostrado && (
        <DialogoLink
          nome={linkMostrado.nome}
          link={linkMostrado.link}
          mensagens={mensagens}
          aoFechar={() => setLinkMostrado(null)}
        />
      )}
      {revogacao && (
        <DialogoRevogar
          pessoa={revogacao.pessoa}
          link={revogacao.link}
          aoFechar={() => setRevogacao(null)}
          aoConcluir={() => aoRevogar(revogacao.pessoa)}
          aoDesatualizar={recarregar}
          focoAoFechar={refFocoAposRevogar}
        />
      )}
      {desativacao && (
        <DialogoDesativar
          pessoa={desativacao}
          aSiMesmo={desativacao.id === eu.id}
          aoFechar={() => setDesativacao(null)}
          aoConcluir={() => aoDesativar(desativacao)}
          aoDesatualizar={recarregar}
        />
      )}
    </div>
  );
}
