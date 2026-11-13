import {
  Fragment,
  useId,
  useLayoutEffect,
  useRef,
  useState,
  type RefObject,
} from "react";
import { Aviso, Button, Card, ComDica } from "../../components/ui";
import { formatarDataHora, formatarMoeda } from "../../lib/formatadores";
import type { AfiliadoResumo, CelulaAdesao } from "./adesao-api";
import { EscolherCelula } from "./EscolherCelula";
import { quantidade, tempoRelativo } from "./formatos";
import { DialogoRemoverAfiliado } from "./RemoverAfiliado";
import { DICAS } from "./textos";
import {
  avisoDaFila,
  type AoRemoverAfiliado,
  type AoSalvarVinculo,
  type AvisoDeSucesso,
} from "./vinculo";

type Props = {
  /** Afiliados sem célula, o mais recente primeiro. */
  orfaos: AfiliadoResumo[];
  celulas: CelulaAdesao[];
  /** Base do "há 2 min" (ms). */
  agora: number;
  /** Último vínculo salvo: aparece aqui se foi feito nesta seção. */
  aviso: AvisoDeSucesso | null;
  aoSalvar: AoSalvarVinculo;
  /** Só para o admin (RIFA-031): remover afiliado de teste. */
  aoRemover: AoRemoverAfiliado | null;
};

// Fila de órfãos: códigos que a Rifei mandou (o líder iniciou uma compra pelo próprio link) e que ainda
// não têm célula. O mais recente fica no topo.
export function SemCelula({
  orfaos,
  celulas,
  agora,
  aviso,
  aoSalvar,
  aoRemover,
}: Props) {
  const idTitulo = useId();
  const refTitulo = useRef<HTMLSpanElement>(null);
  const refAviso = useRef<HTMLDivElement>(null);
  // Botão "Vincular" de cada órfão: depois de vincular, o foco vai para o do próximo da fila.
  const botoes = useRef(new Map<number, HTMLButtonElement>());
  // Vínculo feito aqui e ainda não mostrado: quem recebe o foco (affiliate_id; null = título da seção).
  const focoPendente = useRef<{ affiliateId: number | null } | null>(null);
  const textoAviso = avisoDaFila(aviso);

  // Quando o aviso entra na tela (o cartão do vinculado já saiu): foco num lugar que continua na tela
  // depois da atualização e rolagem até o foco e o aviso, que ficam lado a lado.
  useLayoutEffect(() => {
    const pendente = focoPendente.current;
    if (!pendente || !avisoDaFila(aviso)) return;
    focoPendente.current = null;
    const alvo =
      (pendente.affiliateId !== null &&
        botoes.current.get(pendente.affiliateId)) ||
      refTitulo.current;
    alvo?.focus({ preventScroll: true });
    // O jsdom não tem scrollIntoView.
    alvo?.scrollIntoView?.({ block: "nearest" });
    refAviso.current?.scrollIntoView?.({ block: "nearest" });
  }, [aviso]);

  function registrarBotao(
    affiliateId: number,
    botao: HTMLButtonElement | null,
  ) {
    if (botao) botoes.current.set(affiliateId, botao);
    else botoes.current.delete(affiliateId);
  }

  async function vincular(afiliado: AfiliadoResumo, celula: CelulaAdesao) {
    const posicao = orfaos.findIndex(
      (orfao) => orfao.affiliate_id === afiliado.affiliate_id,
    );
    const abaixo = orfaos[posicao + 1];
    const proximo = abaixo ?? orfaos[posicao - 1];
    focoPendente.current = { affiliateId: proximo?.affiliate_id ?? null };
    try {
      await aoSalvar({
        affiliateId: afiliado.affiliate_id,
        celulaId: celula.celula_id,
        sucesso: `Afiliado ${afiliado.affiliate_id} vinculado: ${celula.celula_nome}.`,
        local: { secao: "sem-celula", antesDe: abaixo?.affiliate_id ?? null },
      });
    } catch (falha) {
      focoPendente.current = null;
      throw falha;
    }
  }

  /**
   * Remove o órfão (admin): o foco vai para o próximo da fila (ou para o título), como depois de vincular. Quem dá
   * o foco é o diálogo, ao sair (`focoAoFechar`): enquanto ele está aberto, o resto da página é `inert` e não
   * recebe foco, e o efeito do aviso roda antes de o diálogo sair.
   */
  async function remover(
    afiliado: AfiliadoResumo,
    focoAoFechar: RefObject<HTMLElement | null>,
  ) {
    if (!aoRemover) return;
    const posicao = orfaos.findIndex(
      (orfao) => orfao.affiliate_id === afiliado.affiliate_id,
    );
    const abaixo = orfaos[posicao + 1];
    const proximo = abaixo ?? orfaos[posicao - 1];
    focoPendente.current = { affiliateId: proximo?.affiliate_id ?? null };
    focoAoFechar.current =
      (proximo && botoes.current.get(proximo.affiliate_id)) ||
      refTitulo.current;
    try {
      await aoRemover({
        affiliateId: afiliado.affiliate_id,
        sucesso: `Afiliado ${afiliado.affiliate_id} removido.`,
        local: { secao: "sem-celula", antesDe: abaixo?.affiliate_id ?? null },
      });
    } catch (falha) {
      focoPendente.current = null;
      focoAoFechar.current = null;
      throw falha;
    }
  }

  const avisoVisivel = textoAviso && (
    <div ref={refAviso} className="adesao-alvo-foco">
      <Aviso tom="sucesso" anuncio="nenhum" titulo={textoAviso} />
    </div>
  );
  // O aviso fica no lugar do cartão que saiu: antes do órfão que vinha abaixo dele ou no fim da fila.
  const antesDe =
    aviso?.local.secao === "sem-celula" ? aviso.local.antesDe : null;
  const avisoAntesDe = orfaos.some((orfao) => orfao.affiliate_id === antesDe)
    ? antesDe
    : null;

  return (
    <section aria-labelledby={idTitulo}>
      <Card
        titulo={
          <span
            id={idTitulo}
            ref={refTitulo}
            tabIndex={-1}
            className="adesao-alvo-foco"
          >
            Sem célula ({orfaos.length})
          </span>
        }
      >
        <div className="pilha adesao-secao">
          {orfaos.length === 0 ? (
            <>
              {avisoVisivel}
              <p className="adesao-explicacao">
                <strong>Nenhum afiliado sem célula agora.</strong> Quando o
                líder iniciar uma compra pelo próprio link de afiliado (sem
                pagar), o código dele aparece aqui em segundos.
              </p>
            </>
          ) : (
            <>
              <p className="adesao-explicacao">
                Toque em Vincular e escolha a célula do líder.
              </p>
              <ul className="adesao-lista">
                {orfaos.map((afiliado) => (
                  <Fragment key={afiliado.affiliate_id}>
                    {avisoVisivel && avisoAntesDe === afiliado.affiliate_id && (
                      <li>{avisoVisivel}</li>
                    )}
                    <li>
                      <ItemOrfao
                        afiliado={afiliado}
                        celulas={celulas}
                        agora={agora}
                        registrarBotao={registrarBotao}
                        aoVincular={vincular}
                        aoRemover={aoRemover ? remover : null}
                      />
                    </li>
                  </Fragment>
                ))}
                {avisoVisivel && avisoAntesDe === null && (
                  <li>{avisoVisivel}</li>
                )}
              </ul>
            </>
          )}
        </div>
      </Card>
    </section>
  );
}

type PropsItem = {
  afiliado: AfiliadoResumo;
  celulas: CelulaAdesao[];
  agora: number;
  registrarBotao: (
    affiliateId: number,
    botao: HTMLButtonElement | null,
  ) => void;
  aoVincular: (afiliado: AfiliadoResumo, celula: CelulaAdesao) => Promise<void>;
  /** Só para o admin: remover o afiliado de teste (e onde o foco fica quando o diálogo sai). */
  aoRemover:
    | ((
        afiliado: AfiliadoResumo,
        focoAoFechar: RefObject<HTMLElement | null>,
      ) => Promise<void>)
    | null;
};

function ItemOrfao({
  afiliado,
  celulas,
  agora,
  registrarBotao,
  aoVincular,
  aoRemover,
}: PropsItem) {
  const [aberto, setAberto] = useState(false);
  const [removendo, setRemovendo] = useState(false);
  // Depois de remover, este cartão sai da tela: o foco vai para o próximo da fila (veja `remover`).
  const refFocoAposRemover = useRef<HTMLElement | null>(null);
  const refBotao = useRef<HTMLButtonElement | null>(null);
  const idPainel = useId();
  const { affiliate_id: codigo, vendas } = afiliado;

  function fechar() {
    setAberto(false);
    refBotao.current?.focus();
  }

  return (
    <article className="adesao-item">
      <div className="adesao-item__cabecalho">
        <h3 className="adesao-item__titulo">Afiliado {codigo}</h3>
        <p className="adesao-item__quando">
          apareceu{" "}
          <time
            dateTime={afiliado.criado_em}
            title={formatarDataHora(afiliado.criado_em)}
          >
            {tempoRelativo(afiliado.criado_em, agora)}
          </time>
        </p>
      </div>
      <p className="adesao-item__detalhe">
        {vendas.pedidos_aprovados === 0
          ? "Nenhuma venda aprovada ainda"
          : `${quantidade(vendas.pedidos_aprovados, "pedido aprovado", "pedidos aprovados")} · ${formatarMoeda(vendas.total_centavos)} (vão para a célula ao vincular)`}
      </p>
      {afiliado.rotulo && (
        <p className="adesao-item__detalhe">Nota: {afiliado.rotulo}</p>
      )}
      {/* Aberto, o botão fica secundário: a ação principal passa a ser a confirmação da célula. */}
      <ComDica texto={aberto ? DICAS.vincularAberto : DICAS.vincular}>
        <Button
          ref={(botao) => {
            refBotao.current = botao;
            registrarBotao(codigo, botao);
          }}
          variante={aberto ? "secundario" : "primario"}
          larguraTotal
          className="adesao-alvo-foco"
          aria-expanded={aberto}
          aria-controls={aberto ? idPainel : undefined}
          onClick={() => (aberto ? fechar() : setAberto(true))}
        >
          Vincular{" "}
          <span className="visualmente-oculto">o afiliado {codigo}</span>
        </Button>
      </ComDica>
      {aoRemover && (
        <ComDica texto={DICAS.removerAfiliado}>
          {/* Ação destrutiva leve (RIFA-051, A-15): o vermelho do perigo discreto, não o roxo de um link. */}
          <Button
            variante="perigo-discreto"
            larguraTotal
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
      {removendo && aoRemover && (
        <DialogoRemoverAfiliado
          affiliateId={codigo}
          celulaNome={null}
          focoAoFechar={refFocoAposRemover}
          aoRemover={() => aoRemover(afiliado, refFocoAposRemover)}
          aoFechar={() => setRemovendo(false)}
        />
      )}
      {aberto && (
        <div id={idPainel}>
          <EscolherCelula
            celulas={celulas}
            legenda={`Célula do afiliado ${codigo}`}
            textoConfirmar={(celula) => `Vincular: ${celula.celula_nome}`}
            aoConfirmar={async (celula) => {
              // Quem vincula cuida do foco (o próximo da fila): este cartão sai da tela.
              await aoVincular(afiliado, celula);
              setAberto(false);
            }}
            aoCancelar={fechar}
          />
        </div>
      )}
    </article>
  );
}
