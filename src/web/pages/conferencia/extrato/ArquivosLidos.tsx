import {
  formatarData,
  formatarDataHora,
  formatarMoeda,
} from "../../../lib/formatadores";
import type { ExtratoLido, FalhaDoExtrato } from "./lancamentos";
import { VARIOS_ARQUIVOS, plural } from "./textos";

/** O que houve com cada arquivo escolhido (RIFA-074). */
export type ResumoDoArquivo =
  | { nome: string; tipo: "falha"; falha: FalhaDoExtrato }
  | { nome: string; tipo: "lido"; extrato: ExtratoLido; repetidos: number };

/** "Comprovante de Pix: R$ 20,00 em 16/11/2026 10:05" ou "Extrato (arquivo PDF): 12 lançamentos". */
function textoDoLido(extrato: ExtratoLido): string {
  const [primeiro] = extrato.lancamentos;
  if (extrato.formato === "comprovante" && primeiro)
    return `Comprovante de Pix: ${formatarMoeda(primeiro.centavos)} em ${
      primeiro.instante === null
        ? formatarData(primeiro.dia)
        : formatarDataHora(primeiro.instante)
    }`;
  const formato =
    extrato.formato === "texto"
      ? "arquivo de texto"
      : `arquivo ${extrato.formato.toUpperCase()}`;
  return `Extrato (${formato}): ${plural(extrato.lancamentos.length, "lançamento", "lançamentos")}`;
}

// A lista dos arquivos escolhidos de uma vez (RIFA-074, D34), cada um com o seu resultado: lido (o comprovante com o
// valor e a hora; o extrato com os lançamentos; e quantos Pix já estavam noutro arquivo) ou a falha dele. O nome do
// arquivo e o resultado ficam só na tela, como o resto do extrato (D26).
export function ArquivosLidos({
  arquivos,
}: {
  arquivos: readonly ResumoDoArquivo[];
}) {
  return (
    <section className="extrato-arquivos" aria-label={VARIOS_ARQUIVOS.titulo}>
      <h3 className="extrato-subtitulo">{VARIOS_ARQUIVOS.titulo}</h3>
      <ul className="extrato-arquivos-lista">
        {arquivos.map((arquivo, indice) => (
          <li
            key={`${indice}-${arquivo.nome}`}
            data-tom={arquivo.tipo === "falha" ? "perigo" : undefined}
          >
            <span className="extrato-codigo">{arquivo.nome}</span>
            {arquivo.tipo === "falha" ? (
              <span>
                {arquivo.falha.titulo}. {arquivo.falha.mensagem}
              </span>
            ) : (
              <span>
                {textoDoLido(arquivo.extrato)}
                {arquivo.repetidos > 0 &&
                  ` (${VARIOS_ARQUIVOS.repetidos(arquivo.repetidos)})`}
                .
              </span>
            )}
          </li>
        ))}
      </ul>
    </section>
  );
}
