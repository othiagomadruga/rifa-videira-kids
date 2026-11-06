import { useId, useRef, useState } from "react";
import { Button, Card, EmptyState } from "../../components/ui";
import { formatarDataHora, formatarMoeda } from "../../lib/formatadores";
import type { AfiliadoResumo, CelulaAdesao } from "./adesao-api";
import { EscolherCelula } from "./EscolherCelula";
import type { AoSalvarVinculo } from "./TodasAsCelulas";
import { quantidade, tempoRelativo } from "./formatos";

type Props = {
  /** Afiliados sem célula, o mais recente primeiro. */
  orfaos: AfiliadoResumo[];
  celulas: CelulaAdesao[];
  /** Base do "há 2 min" (ms). */
  agora: number;
  aoSalvar: AoSalvarVinculo;
};

// Fila de órfãos: códigos que a Rifei mandou (o líder iniciou uma compra pelo próprio link) e que ainda
// não têm célula. O mais recente fica no topo.
export function SemCelula({ orfaos, celulas, agora, aoSalvar }: Props) {
  const idTitulo = useId();
  return (
    <section aria-labelledby={idTitulo}>
      <Card titulo={<span id={idTitulo}>Sem célula ({orfaos.length})</span>}>
        <div className="pilha adesao-secao">
          <p className="adesao-explicacao">
            O líder inicia uma compra pelo próprio link de afiliado, sem pagar.
            O código dele aparece aqui em segundos: toque em Vincular e escolha
            a célula.
          </p>
          {orfaos.length === 0 ? (
            <EmptyState
              titulo="Nenhum afiliado sem célula."
              descricao="Os códigos novos aparecem aqui sozinhos."
            />
          ) : (
            <ul className="adesao-lista">
              {orfaos.map((afiliado) => (
                <li key={afiliado.affiliate_id}>
                  <ItemOrfao
                    afiliado={afiliado}
                    celulas={celulas}
                    agora={agora}
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

type PropsItem = Omit<Props, "orfaos"> & { afiliado: AfiliadoResumo };

function ItemOrfao({ afiliado, celulas, agora, aoSalvar }: PropsItem) {
  const [aberto, setAberto] = useState(false);
  const refBotao = useRef<HTMLButtonElement>(null);
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
      <Button
        ref={refBotao}
        variante={aberto ? "secundario" : "primario"}
        larguraTotal
        aria-expanded={aberto}
        aria-controls={aberto ? idPainel : undefined}
        onClick={() => (aberto ? fechar() : setAberto(true))}
      >
        Vincular <span className="visualmente-oculto">o afiliado {codigo}</span>
      </Button>
      {aberto && (
        <div id={idPainel}>
          <EscolherCelula
            celulas={celulas}
            legenda={`Célula do afiliado ${codigo}`}
            textoConfirmar={(celula) => `Vincular: ${celula.celula_nome}`}
            aoConfirmar={async (celula) => {
              await aoSalvar(
                codigo,
                celula.celula_id,
                `Afiliado ${codigo} vinculado: ${celula.celula_nome}.`,
              );
              fechar();
            }}
            aoCancelar={fechar}
          />
        </div>
      )}
    </article>
  );
}
