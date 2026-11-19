import { useId, type ReactNode } from "react";
import { Link } from "react-router";
import type {
  RespostaPainelResumo,
  TotaisVendas,
} from "../../../shared/contracts/calculos";
import { ComAjuda, Icone } from "../../components/ui";
import { ajuda } from "../ajuda-sob-demanda";
import { useRedes } from "../../lib/redes";
import { textoDosTotais } from "./textos";

type Props = { resumo: RespostaPainelResumo };

/** O verbo concorda com os pedidos: 1 pedido "conta"; 2 pedidos "contam". */
const contam = (totais: TotaisVendas) =>
  totais.pedidos_aprovados === 1 ? "conta" : "contam";

// Avisos discretos do escopo campanha, só quando há o que avisar: vendas sem célula (contam na campanha,
// em nenhuma divisão, rede ou célula; com uma rede só, sem citar a rede: D30) e vendas fora da janela (antes do 1º
// dia ou depois do último: não contam em nada).
export function AvisosVendas({ resumo }: Props) {
  const idTitulo = useId();
  const redeUnica = useRedes().unica;
  const {
    vendas_sem_celula: semCelula,
    vendas_fora_da_janela: fora,
    unidade,
  } = resumo;
  const avisos: { chave: string; texto: ReactNode }[] = [];
  if (semCelula && semCelula.pedidos_aprovados > 0) {
    avisos.push({
      chave: "sem-celula",
      texto: (
        <>
          <strong>{textoDosTotais(semCelula, unidade)} sem célula</strong>:{" "}
          {contam(semCelula)} na campanha, mas em nenhuma{" "}
          {redeUnica ? "divisão nem célula" : "divisão, rede ou célula"}.
          Vincule os afiliados em <Link to="/coordenacao/adesao">Adesão</Link>.
        </>
      ),
    });
  }
  if (fora && fora.antes_do_inicio.pedidos_aprovados > 0) {
    avisos.push({
      chave: "antes-do-inicio",
      texto: (
        <>
          <strong>
            {textoDosTotais(fora.antes_do_inicio, unidade)} antes do início
          </strong>
          : não {contam(fora.antes_do_inicio)} em nada (ex.: compra de teste na
          reunião de cadastro).
        </>
      ),
    });
  }
  if (fora && fora.depois_do_fim.pedidos_aprovados > 0) {
    avisos.push({
      chave: "depois-do-fim",
      texto: (
        <>
          <strong>
            {textoDosTotais(fora.depois_do_fim, unidade)} depois do fim
          </strong>
          : não {contam(fora.depois_do_fim)} na campanha.
        </>
      ),
    });
  }
  if (avisos.length === 0) return null;

  return (
    <section className="visao-avisos" aria-labelledby={idTitulo}>
      <ComAjuda texto={ajuda("paraConferir")} idDoTitulo={idTitulo}>
        <h2 id={idTitulo} className="visao-avisos__titulo">
          Para conferir
        </h2>
      </ComAjuda>
      <ul className="visao-avisos__lista">
        {avisos.map((aviso) => (
          <li key={aviso.chave}>
            <span className="visao-avisos__icone" aria-hidden="true">
              <Icone nome="info" />
            </span>
            <p>{aviso.texto}</p>
          </li>
        ))}
      </ul>
    </section>
  );
}
