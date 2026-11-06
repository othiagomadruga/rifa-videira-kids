import { useId, useRef, useState, type FormEvent, type RefObject } from "react";
import {
  Badge,
  Button,
  Card,
  EmptyState,
  Input,
  type TomBadge,
} from "../../components/ui";
import { mensagemDoErro } from "../../lib/api";
import { formatarDataHora } from "../../lib/formatadores";
import type { AfiliadoResumo, CelulaAdesao } from "./adesao-api";
import { EscolherCelula } from "./EscolherCelula";
import {
  celulaCombina,
  lerCodigoAfiliado,
  quantidade,
  situacaoDaCelula,
  type SituacaoCelula,
} from "./formatos";

/** Salva o vínculo e, se der certo, mostra `sucesso`. Se falhar, lança o erro (ErroApi). */
export type AoSalvarVinculo = (
  affiliateId: number,
  celulaId: number | null,
  sucesso: string,
) => Promise<void>;

type Props = {
  celulas: CelulaAdesao[];
  orfaos: AfiliadoResumo[];
  aoSalvar: AoSalvarVinculo;
};

const SITUACOES: Record<SituacaoCelula, { rotulo: string; tom: TomBadge }> = {
  sem_afiliado: { rotulo: "Sem afiliado", tom: "alerta" },
  vinculada: { rotulo: "Vinculada", tom: "info" },
  ja_vendeu: { rotulo: "Já vendeu", tom: "sucesso" },
};

// Todas as células, com a situação de cada uma. Aqui a coordenação também informa o código de afiliado
// que o líder já sabe (pré-cadastro), troca um afiliado de célula ou desvincula.
export function TodasAsCelulas({ celulas, orfaos, aoSalvar }: Props) {
  const [busca, setBusca] = useState("");
  const filtradas = celulas.filter((celula) => celulaCombina(celula, busca));
  const idTitulo = useId();

  return (
    <section aria-labelledby={idTitulo}>
      <Card titulo={<span id={idTitulo}>Todas as células</span>}>
        <div className="pilha adesao-secao">
          <Input
            rotulo="Buscar célula, líder ou código"
            type="search"
            autoComplete="off"
            value={busca}
            onChange={(evento) => setBusca(evento.target.value)}
          />
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
                    aoSalvar={aoSalvar}
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

function CartaoCelula({ celula, celulas, orfaos, aoSalvar }: PropsCartao) {
  const situacao = SITUACOES[situacaoDaCelula(celula)];
  return (
    <article className="adesao-celula">
      <div className="adesao-item__cabecalho">
        <h3 className="adesao-item__titulo">{celula.celula_nome}</h3>
        <Badge tom={situacao.tom}>{situacao.rotulo}</Badge>
      </div>
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
                celula={celula}
                celulas={celulas}
                aoSalvar={aoSalvar}
              />
            </li>
          ))}
        </ul>
      )}
      <FormCodigo
        celula={celula}
        celulas={celulas}
        orfaos={orfaos}
        aoSalvar={aoSalvar}
      />
    </article>
  );
}

type PropsAfiliado = Omit<PropsCartao, "orfaos"> & { codigo: number };

/** Um afiliado da célula, com "Trocar" (escolhe outra célula) e "Desvincular" (pede confirmação). */
function AfiliadoDaCelula({
  codigo,
  celula,
  celulas,
  aoSalvar,
}: PropsAfiliado) {
  const [acao, setAcao] = useState<"trocar" | "desvincular" | null>(null);
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
      await aoSalvar(
        codigo,
        null,
        `Afiliado ${codigo} desvinculado. Ele voltou para “Sem célula”.`,
      );
      setAcao(null);
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
          <Button
            ref={refDesvincular}
            variante="secundario"
            aria-expanded={acao === "desvincular"}
            onClick={() => alternar("desvincular", refDesvincular)}
          >
            Desvincular{" "}
            <span className="visualmente-oculto">o afiliado {codigo}</span>
          </Button>
        </div>
      </div>
      {acao === "trocar" && (
        <EscolherCelula
          celulas={celulas}
          celulaAtualId={celula.celula_id}
          legenda={`Nova célula do afiliado ${codigo}`}
          textoConfirmar={(nova) => `Trocar para: ${nova.celula_nome}`}
          aoConfirmar={async (nova) => {
            await aoSalvar(
              codigo,
              nova.celula_id,
              `Afiliado ${codigo} trocado para: ${nova.celula_nome}.`,
            );
            fechar(refTrocar);
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
            <Button
              variante="perigo"
              aria-describedby={idPergunta}
              onClick={() => void desvincular()}
              disabled={enviando}
              autoFocus
            >
              {enviando ? "Desvinculando…" : "Confirmar desvínculo"}
            </Button>
            <Button
              variante="secundario"
              onClick={() => fechar(refDesvincular)}
              disabled={enviando}
            >
              Cancelar
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}

/**
 * Código de afiliado que o líder já sabe (pré-cadastro). Célula sem afiliado: o campo fica à mostra.
 * Célula com afiliado: atrás de "Adicionar outro código" (o líder pode ter duas contas na Rifei).
 * Se o código já está em outra célula, pede confirmação antes de trocar.
 */
function FormCodigo({ celula, celulas, orfaos, aoSalvar }: PropsCartao) {
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
      await aoSalvar(id, celula.celula_id, sucesso);
      setCodigo("");
      setTroca(null);
      setAberto(false);
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
      <Button variante="discreto" onClick={() => setAberto(true)}>
        Adicionar outro código{" "}
        <span className="visualmente-oculto">em {celula.celula_nome}</span>
      </Button>
    );
  }

  return (
    <form className="adesao-codigo" onSubmit={aoEnviar} noValidate>
      <div className="adesao-codigo__linha">
        <div className="adesao-codigo__campo">
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
        </div>
        <Button type="submit" disabled={enviando}>
          {enviando ? "Salvando…" : "Salvar código"}
        </Button>
      </div>
      {troca && (
        <div className="adesao-confirmacao">
          <p id={idPergunta}>
            O afiliado {troca.codigo} está em {troca.de.celula_nome}. Trocar
            para esta célula?
          </p>
          <div className="adesao-acoes">
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
            <Button
              variante="secundario"
              onClick={() => setTroca(null)}
              disabled={enviando}
            >
              Cancelar
            </Button>
          </div>
        </div>
      )}
    </form>
  );
}
