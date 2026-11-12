import { useId, useRef, useState, type FormEvent, type RefObject } from "react";
import {
  Aviso,
  Badge,
  Button,
  Card,
  ComDica,
  EmptyState,
  Input,
  type TomBadge,
} from "../../components/ui";
import { mensagemDoErro } from "../../lib/api";
import { formatarDataHora } from "../../lib/formatadores";
import type { AfiliadoResumo, CelulaAdesao } from "./adesao-api";
import { EscolherCelula } from "./EscolherCelula";
import { DialogoRemoverAfiliado } from "./RemoverAfiliado";
import { DICAS } from "./textos";
import {
  celulaCombina,
  lerCodigoAfiliado,
  quantidade,
  situacaoDaCelula,
  type SituacaoCelula,
} from "./formatos";
import {
  avisoDaCelula,
  type AoRemoverAfiliado,
  type AoSalvarVinculo,
  type AvisoDeSucesso,
  type LocalDoAviso,
} from "./vinculo";

type Props = {
  celulas: CelulaAdesao[];
  orfaos: AfiliadoResumo[];
  /** Último vínculo salvo: aparece no cartão da célula onde foi feito. */
  aviso: AvisoDeSucesso | null;
  aoSalvar: AoSalvarVinculo;
  /** Só para o admin (RIFA-031): remover afiliado de teste. */
  aoRemover: AoRemoverAfiliado | null;
};

/** O título do cartão da célula: recebe o foco depois de salvar ou remover um afiliado dela. */
const idTituloDaCelula = (celulaId: number) =>
  `adesao-celula-${celulaId}-titulo`;

const SITUACOES: Record<SituacaoCelula, { rotulo: string; tom: TomBadge }> = {
  sem_afiliado: { rotulo: "Sem afiliado", tom: "alerta" },
  vinculada: { rotulo: "Vinculada", tom: "info" },
  ja_vendeu: { rotulo: "Já vendeu", tom: "sucesso" },
};

// Todas as células, com a situação de cada uma. Aqui a coordenação também informa o código de afiliado
// que o líder já sabe (pré-cadastro), troca um afiliado de célula ou desvincula.
export function TodasAsCelulas({
  celulas,
  orfaos,
  aviso,
  aoSalvar,
  aoRemover,
}: Props) {
  const [busca, setBusca] = useState("");
  const filtradas = celulas.filter((celula) => celulaCombina(celula, busca));
  const idTitulo = useId();

  return (
    <section aria-labelledby={idTitulo}>
      <Card titulo={<span id={idTitulo}>Todas as células</span>}>
        <div className="pilha adesao-secao">
          <ComDica texto={DICAS.buscarCelulas}>
            <Input
              rotulo="Buscar célula, líder ou código"
              type="search"
              autoComplete="off"
              value={busca}
              onChange={(evento) => setBusca(evento.target.value)}
            />
          </ComDica>
          <p className="adesao-contagem">
            {busca.trim()
              ? `${quantidade(filtradas.length, "célula encontrada", "células encontradas")} de ${celulas.length}`
              : quantidade(celulas.length, "célula", "células")}
          </p>
          {filtradas.length === 0 ? (
            <EmptyState titulo="Nenhuma célula encontrada." />
          ) : (
            <ul className="adesao-celulas">
              {filtradas.map((celula) => (
                <li key={celula.celula_id}>
                  <CartaoCelula
                    celula={celula}
                    celulas={celulas}
                    orfaos={orfaos}
                    aviso={aviso}
                    aoSalvar={aoSalvar}
                    aoRemover={aoRemover}
                  />
                </li>
              ))}
            </ul>
          )}
        </div>
      </Card>
    </section>
  );
}

type PropsCartao = Props & { celula: CelulaAdesao };

/** O que as ações do cartão recebem: onde fica o aviso e para onde vai o foco depois de salvar. */
type PropsAcao = {
  celula: CelulaAdesao;
  celulas: CelulaAdesao[];
  aoSalvar: AoSalvarVinculo;
  local: LocalDoAviso;
  /** Leva o foco ao título do cartão, que continua na tela depois da atualização. */
  aoConcluir: () => void;
};

function CartaoCelula({
  celula,
  celulas,
  orfaos,
  aviso,
  aoSalvar,
  aoRemover,
}: PropsCartao) {
  const situacao = SITUACOES[situacaoDaCelula(celula)];
  const refTitulo = useRef<HTMLHeadingElement>(null);
  const local: LocalDoAviso = { secao: "celula", celulaId: celula.celula_id };
  const textoAviso = avisoDaCelula(aviso, celula.celula_id);
  const acao = {
    celula,
    celulas,
    aoSalvar,
    local,
    aoConcluir: () => refTitulo.current?.focus(),
  };
  return (
    <article className="adesao-celula">
      <div className="adesao-item__cabecalho">
        <h3
          ref={refTitulo}
          id={idTituloDaCelula(celula.celula_id)}
          tabIndex={-1}
          className="adesao-item__titulo adesao-alvo-foco"
        >
          {celula.celula_nome}
        </h3>
        <Badge tom={situacao.tom}>{situacao.rotulo}</Badge>
      </div>
      {textoAviso && (
        <Aviso tom="sucesso" anuncio="nenhum" titulo={textoAviso} />
      )}
      <p className="adesao-item__detalhe">
        Líder: {celula.lider_nome} · {celula.rede_nome}
      </p>
      {celula.primeira_venda_em && (
        <p className="adesao-item__detalhe">
          {quantidade(
            celula.pedidos_aprovados,
            "pedido aprovado",
            "pedidos aprovados",
          )}{" "}
          · primeira venda em {formatarDataHora(celula.primeira_venda_em)}
        </p>
      )}
      {celula.afiliados.length > 0 && (
        <ul className="adesao-afiliados">
          {celula.afiliados.map((codigo) => (
            <li key={codigo}>
              <AfiliadoDaCelula
                codigo={codigo}
                aoRemover={aoRemover}
                {...acao}
              />
            </li>
          ))}
        </ul>
      )}
      <FormCodigo orfaos={orfaos} {...acao} />
    </article>
  );
}

/**
 * Um afiliado da célula, com "Trocar" (escolhe outra célula) e "Desvincular" (pede confirmação). Os dois
 * tiram o afiliado deste cartão: depois de salvar, o foco vai para o título do cartão.
 */
function AfiliadoDaCelula({
  codigo,
  celula,
  celulas,
  aoSalvar,
  local,
  aoConcluir,
  aoRemover,
}: PropsAcao & { codigo: number; aoRemover: AoRemoverAfiliado | null }) {
  const [acao, setAcao] = useState<"trocar" | "desvincular" | null>(null);
  const [removendo, setRemovendo] = useState(false);
  // Depois de remover, o afiliado sai do cartão: o foco vai para o título dele.
  const refFocoAposRemover = useRef<HTMLElement | null>(null);
  const [enviando, setEnviando] = useState(false);
  const [erro, setErro] = useState<string | null>(null);
  const refTrocar = useRef<HTMLButtonElement>(null);
  const refDesvincular = useRef<HTMLButtonElement>(null);
  const idPergunta = useId();

  function fechar(foco: RefObject<HTMLButtonElement | null>) {
    setAcao(null);
    setErro(null);
    foco.current?.focus();
  }

  function alternar(
    proxima: "trocar" | "desvincular",
    foco: RefObject<HTMLButtonElement | null>,
  ) {
    if (acao === proxima) fechar(foco);
    else {
      setErro(null);
      setAcao(proxima);
    }
  }

  async function desvincular() {
    setEnviando(true);
    setErro(null);
    try {
      await aoSalvar({
        affiliateId: codigo,
        celulaId: null,
        sucesso: `Afiliado ${codigo} desvinculado. Ele voltou para “Sem célula”.`,
        local,
      });
      setAcao(null);
      aoConcluir();
    } catch (falha) {
      setErro(mensagemDoErro(falha));
    } finally {
      setEnviando(false);
    }
  }

  return (
    <div className="adesao-afiliado">
      <div className="adesao-afiliado__linha">
        <p className="adesao-afiliado__codigo">Afiliado {codigo}</p>
        <div className="adesao-acoes">
          <ComDica
            texto={acao === "trocar" ? DICAS.trocarAberto : DICAS.trocar}
          >
            <Button
              ref={refTrocar}
              variante="secundario"
              aria-expanded={acao === "trocar"}
              onClick={() => alternar("trocar", refTrocar)}
            >
              Trocar{" "}
              <span className="visualmente-oculto">
                a célula do afiliado {codigo}
              </span>
            </Button>
          </ComDica>
          <ComDica
            texto={
              acao === "desvincular"
                ? DICAS.desvincularAberto
                : DICAS.desvincular
            }
          >
            <Button
              ref={refDesvincular}
              variante="secundario"
              aria-expanded={acao === "desvincular"}
              onClick={() => alternar("desvincular", refDesvincular)}
            >
              Desvincular{" "}
              <span className="visualmente-oculto">o afiliado {codigo}</span>
            </Button>
          </ComDica>
          {aoRemover && (
            <ComDica texto={DICAS.removerAfiliado}>
              <Button
                variante="secundario"
                onClick={() => {
                  refFocoAposRemover.current = null;
                  setRemovendo(true);
                }}
              >
                Remover{" "}
                <span className="visualmente-oculto">o afiliado {codigo}</span>
              </Button>
            </ComDica>
          )}
        </div>
      </div>
      {removendo && aoRemover && (
        <DialogoRemoverAfiliado
          affiliateId={codigo}
          celulaNome={celula.celula_nome}
          focoAoFechar={refFocoAposRemover}
          aoRemover={async () => {
            await aoRemover({
              affiliateId: codigo,
              sucesso: `Afiliado ${codigo} removido de ${celula.celula_nome}.`,
              local,
            });
            refFocoAposRemover.current = document.getElementById(
              idTituloDaCelula(celula.celula_id),
            );
            setRemovendo(false);
          }}
          aoFechar={() => setRemovendo(false)}
        />
      )}
      {acao === "trocar" && (
        <EscolherCelula
          celulas={celulas}
          celulaAtualId={celula.celula_id}
          legenda={`Nova célula do afiliado ${codigo}`}
          textoConfirmar={(nova) => `Trocar para: ${nova.celula_nome}`}
          aoConfirmar={async (nova) => {
            await aoSalvar({
              affiliateId: codigo,
              celulaId: nova.celula_id,
              sucesso: `Afiliado ${codigo} trocado para: ${nova.celula_nome}.`,
              local,
            });
            setAcao(null);
            aoConcluir();
          }}
          aoCancelar={() => fechar(refTrocar)}
        />
      )}
      {acao === "desvincular" && (
        <div className="adesao-confirmacao">
          <p id={idPergunta}>
            Desvincular o afiliado {codigo} desta célula? As vendas dele deixam
            de contar para ela até ele ser vinculado de novo.
          </p>
          {erro && (
            <p className="adesao-erro" role="alert">
              {erro}
            </p>
          )}
          <div className="adesao-acoes">
            <ComDica
              texto={enviando ? DICAS.desvinculando : DICAS.confirmarDesvinculo}
            >
              <Button
                variante="perigo"
                aria-describedby={idPergunta}
                onClick={() => void desvincular()}
                disabled={enviando}
                autoFocus
              >
                {enviando ? "Desvinculando…" : "Confirmar desvínculo"}
              </Button>
            </ComDica>
            <ComDica texto={DICAS.cancelarDesvinculo}>
              <Button
                variante="secundario"
                onClick={() => fechar(refDesvincular)}
                disabled={enviando}
              >
                Cancelar
              </Button>
            </ComDica>
          </div>
        </div>
      )}
    </div>
  );
}

/**
 * Código de afiliado que o líder já sabe (pré-cadastro). Célula sem afiliado: o campo fica à mostra.
 * Célula com afiliado: atrás de "Adicionar outro código" (o líder pode ter duas contas na Rifei).
 * Se o código já está em outra célula, pede confirmação antes de trocar. Depois de salvar, o foco vai para
 * o título do cartão (o formulário fecha ou vira "Adicionar outro código").
 */
function FormCodigo({
  celula,
  celulas,
  orfaos,
  aoSalvar,
  local,
  aoConcluir,
}: PropsAcao & { orfaos: AfiliadoResumo[] }) {
  const [aberto, setAberto] = useState(false);
  const [codigo, setCodigo] = useState("");
  const [erro, setErro] = useState<string | null>(null);
  const [troca, setTroca] = useState<{
    codigo: number;
    de: CelulaAdesao;
  } | null>(null);
  const [enviando, setEnviando] = useState(false);
  const idPergunta = useId();

  async function salvar(id: number, sucesso: string) {
    setEnviando(true);
    setErro(null);
    try {
      await aoSalvar({
        affiliateId: id,
        celulaId: celula.celula_id,
        sucesso,
        local,
      });
      setCodigo("");
      setTroca(null);
      setAberto(false);
      aoConcluir();
    } catch (falha) {
      setTroca(null);
      setErro(mensagemDoErro(falha));
    } finally {
      setEnviando(false);
    }
  }

  function aoEnviar(evento: FormEvent<HTMLFormElement>) {
    evento.preventDefault();
    const id = lerCodigoAfiliado(codigo);
    if (id === null) {
      setErro("Digite só os números do código de afiliado (ex.: 1043).");
      return;
    }
    if (celula.afiliados.includes(id)) {
      setErro(`O afiliado ${id} já está nesta célula.`);
      return;
    }
    const de = celulas.find((outra) => outra.afiliados.includes(id));
    if (de) {
      setTroca({ codigo: id, de });
      return;
    }
    const naFila = orfaos.some((afiliado) => afiliado.affiliate_id === id);
    void salvar(
      id,
      naFila
        ? `Afiliado ${id} vinculado: ${celula.celula_nome}.`
        : `Código ${id} pré-cadastrado: ${celula.celula_nome}. As vendas dele já vão contar para a célula.`,
    );
  }

  if (celula.vinculada && !aberto) {
    return (
      <ComDica texto={DICAS.adicionarOutroCodigo}>
        <Button variante="discreto" onClick={() => setAberto(true)}>
          Adicionar outro código{" "}
          <span className="visualmente-oculto">em {celula.celula_nome}</span>
        </Button>
      </ComDica>
    );
  }

  return (
    <form className="adesao-codigo" onSubmit={aoEnviar} noValidate>
      <div className="adesao-codigo__linha">
        <div className="adesao-codigo__campo">
          <ComDica texto={DICAS.codigoAfiliado}>
            <Input
              rotulo={
                <>
                  Código de afiliado{" "}
                  <span className="visualmente-oculto">
                    ({celula.celula_nome})
                  </span>
                </>
              }
              inputMode="numeric"
              autoComplete="off"
              value={codigo}
              erro={erro ?? undefined}
              onChange={(evento) => {
                setCodigo(evento.target.value);
                setErro(null);
                setTroca(null);
              }}
            />
          </ComDica>
        </div>
        <ComDica texto={enviando ? DICAS.salvandoCodigo : DICAS.salvarCodigo}>
          <Button type="submit" disabled={enviando}>
            {enviando ? "Salvando…" : "Salvar código"}
          </Button>
        </ComDica>
      </div>
      {troca && (
        <div className="adesao-confirmacao">
          <p id={idPergunta}>
            O afiliado {troca.codigo} está em {troca.de.celula_nome}. Trocar
            para esta célula?
          </p>
          <div className="adesao-acoes">
            <ComDica
              texto={
                enviando ? DICAS.salvandoCodigo : DICAS.trocarParaEstaCelula
              }
            >
              <Button
                aria-describedby={idPergunta}
                onClick={() =>
                  void salvar(
                    troca.codigo,
                    `Afiliado ${troca.codigo} trocado para: ${celula.celula_nome}.`,
                  )
                }
                disabled={enviando}
                autoFocus
              >
                Trocar para esta célula
              </Button>
            </ComDica>
            <ComDica texto={DICAS.cancelarTroca}>
              <Button
                variante="secundario"
                onClick={() => setTroca(null)}
                disabled={enviando}
              >
                Cancelar
              </Button>
            </ComDica>
          </div>
        </div>
      )}
    </form>
  );
}
