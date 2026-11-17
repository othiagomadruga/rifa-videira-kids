import { useId, useRef, useState, type ReactNode, type RefObject } from "react";
import {
  Aviso,
  Badge,
  Button,
  Card,
  ComAjuda,
  ComDica,
  DataTable,
  ErrorState,
  Icone,
  Loading,
  Stat,
  Textarea,
  type ColunaTabela,
} from "../../../components/ui";
import { ehFalhaDeConexao, mensagemDoErro } from "../../../lib/api";
import {
  formatarData,
  formatarDataHora,
  formatarMoeda,
} from "../../../lib/formatadores";
import {
  numerosParaCopiar,
  type Casamento,
  type JaContado,
  type PedidoDoCruzamento,
  type PixAmbiguo,
  type PixSemPedido,
  type ResultadoDoCruzamento,
} from "./cruzamento";
import type { PedidosBuscados } from "./extrato-api";
import type {
  ExtratoLido,
  FormatoExtrato,
  Ignorados,
  Pix,
} from "./lancamentos";
import {
  AJUDA,
  AVISO_EXPIRADO,
  COPIADO,
  COPIAR,
  DICAS,
  EXPLICACAO_DO_GRAU,
  FALHAS,
  GRAU,
  GRUPOS,
  MAIS_AMBIGUOS,
  MAIS_CANDIDATOS,
  MAXIMO_AMBIGUOS_NA_TELA,
  MAXIMO_CANDIDATOS_NA_TELA,
  motivoSemPedido,
  plural,
  RESULTADO,
  ROTULO_NUMEROS,
  SEM_AREA_DE_TRANSFERENCIA,
  STATUS,
  textoDosIgnorados,
  UM_DESTES,
  valorDiferente,
} from "./textos";

type Busca =
  | { tipo: "carregando" }
  | { tipo: "ok"; buscados: PedidosBuscados }
  | { tipo: "erro"; erro: unknown };

type Props = {
  origem: FormatoExtrato;
  extrato: ExtratoLido;
  ignorados: Ignorados;
  totalDePix: number;
  busca: Busca | null;
  resultado: ResultadoDoCruzamento | null;
  /** Recebe o foco quando o resultado chega. */
  refTitulo: RefObject<HTMLSpanElement | null>;
  aoTentarDeNovo: () => void;
  aoAnunciar: (texto: string) => void;
};

/** Quando o Pix chegou: "16/11/2026 10:05" ou, sem a hora, "16/11/2026". */
function quandoDoPix(pix: Pix): string {
  return pix.instante === null
    ? formatarData(pix.dia)
    : formatarDataHora(pix.instante);
}

/** O Pix numa linha: quando, o valor e a descrição do banco (que pode trazer o nome de quem pagou: só na tela). */
function DoPix({ pix, comValor = false }: { pix: Pix; comValor?: boolean }) {
  return (
    <span className="extrato-pix">
      <span>
        {quandoDoPix(pix)}
        {comValor && ` · ${formatarMoeda(pix.centavos)}`}
      </span>
      <span className="extrato-suave">{pix.descricao}</span>
    </span>
  );
}

function Grupo({
  titulo,
  explicacao,
  ajuda,
  children,
}: {
  titulo: string;
  explicacao?: string;
  /** A ajuda do título (RIFA-066): o que é o grupo e o que fazer com ele. */
  ajuda: string;
  children: ReactNode;
}) {
  const id = useId();
  return (
    <section className="extrato-grupo" aria-labelledby={id}>
      <ComAjuda texto={ajuda} idDoTitulo={id}>
        <h3 id={id} className="extrato-subtitulo">
          {titulo}
        </h3>
      </ComAjuda>
      {explicacao && <p className="extrato-suave">{explicacao}</p>}
      {children}
    </section>
  );
}

const COLUNAS_PARA_MARCAR: ColunaTabela<Casamento>[] = [
  {
    chave: "pedido",
    titulo: "Pedido",
    principal: true,
    celula: ({ pedido }) => <span className="extrato-codigo">{pedido.id}</span>,
  },
  {
    chave: "valor",
    titulo: "Valor",
    alinhamento: "fim",
    celula: ({ pedido }) => formatarMoeda(pedido.total_centavos),
  },
  {
    chave: "celula",
    titulo: "Célula",
    celula: ({ pedido }) => pedido.celula_nome ?? "Sem célula",
  },
  {
    chave: "grau",
    titulo: "Grau",
    celula: (casamento) => (
      <span className="extrato-selos">
        <Badge tom={GRAU[casamento.grau].tom}>
          {GRAU[casamento.grau].rotulo}
        </Badge>
        {casamento.pedido.status === "expired" && (
          <Badge tom="alerta">{STATUS.expired}</Badge>
        )}
      </span>
    ),
  },
  {
    chave: "pix",
    titulo: "Pix",
    celula: (casamento) => (
      <span className="extrato-pix">
        <DoPix pix={casamento.pix} />
        {casamento.valorDiferente && (
          <span className="extrato-atencao">
            {valorDiferente(formatarMoeda(casamento.pix.centavos))}
          </span>
        )}
        {casamento.pedido.status === "expired" && (
          <span className="extrato-atencao">{AVISO_EXPIRADO}</span>
        )}
      </span>
    ),
  },
];

const COLUNAS_SEM_PEDIDO: ColunaTabela<PixSemPedido>[] = [
  {
    chave: "valor",
    titulo: "Valor",
    principal: true,
    celula: ({ pix }) => formatarMoeda(pix.centavos),
  },
  { chave: "pix", titulo: "Pix", celula: ({ pix }) => <DoPix pix={pix} /> },
  {
    chave: "motivo",
    titulo: "Por quê",
    celula: ({ motivo, pedidos }) => motivoSemPedido(motivo, pedidos),
  },
];

const COLUNAS_JA_CONTADOS: ColunaTabela<JaContado>[] = [
  {
    chave: "pedido",
    titulo: "Pedido",
    principal: true,
    celula: ({ pedidos }) =>
      pedidos.length === 1 ? (
        <span className="extrato-codigo">{pedidos[0].id}</span>
      ) : (
        <span className="extrato-codigos">
          {UM_DESTES}{" "}
          {pedidos
            .slice(0, MAXIMO_CANDIDATOS_NA_TELA)
            .map((pedido) => pedido.id)
            .join(", ")}
          {pedidos.length > MAXIMO_CANDIDATOS_NA_TELA &&
            `. ${MAIS_CANDIDATOS(pedidos.length - MAXIMO_CANDIDATOS_NA_TELA)}`}
        </span>
      ),
  },
  {
    chave: "valor",
    titulo: "Valor",
    alinhamento: "fim",
    celula: ({ pix }) => formatarMoeda(pix.centavos),
  },
  {
    chave: "celula",
    titulo: "Célula",
    celula: ({ pedidos }) =>
      pedidos.length === 1 ? (pedidos[0].celula_nome ?? "Sem célula") : "—",
  },
  {
    chave: "grau",
    titulo: "Grau",
    celula: ({ grau }) =>
      grau ? (
        <Badge tom={GRAU[grau].tom}>{GRAU[grau].rotulo}</Badge>
      ) : (
        <Badge tom="neutro">Ambíguo</Badge>
      ),
  },
  { chave: "pix", titulo: "Pix", celula: ({ pix }) => <DoPix pix={pix} /> },
];

/** Um candidato de um Pix ambíguo: número, célula, reserva, quantidade e situação. */
function Candidato({ pedido }: { pedido: PedidoDoCruzamento }) {
  return (
    <li className="extrato-candidato">
      <span className="extrato-codigo">{pedido.id}</span>
      <span>
        {pedido.celula_nome ?? "Sem célula"} · reservado em{" "}
        {formatarDataHora(pedido.reserva)} ·{" "}
        {plural(pedido.qtd_bilhetes, "bilhete", "bilhetes")}
      </span>
      <Badge
        tom={
          pedido.status === "approved"
            ? "sucesso"
            : pedido.status === "expired"
              ? "alerta"
              : "neutro"
        }
      >
        {STATUS[pedido.status]}
      </Badge>
    </li>
  );
}

function Ambiguos({ itens }: { itens: PixAmbiguo[] }) {
  return (
    <>
      <ul className="extrato-lista">
        {itens.slice(0, MAXIMO_AMBIGUOS_NA_TELA).map(({ pix, candidatos }) => (
          <li key={pix.chave} className="extrato-ambiguo">
            <p className="extrato-ambiguo__pix">
              <strong>Pix de {formatarMoeda(pix.centavos)}</strong> ·{" "}
              {quandoDoPix(pix)}
            </p>
            <p className="extrato-suave">{pix.descricao}</p>
            <p>
              {plural(candidatos.length, "pedido serve", "pedidos servem")}:
            </p>
            <ul className="extrato-lista">
              {candidatos.slice(0, MAXIMO_CANDIDATOS_NA_TELA).map((pedido) => (
                <Candidato key={pedido.id} pedido={pedido} />
              ))}
            </ul>
            {candidatos.length > MAXIMO_CANDIDATOS_NA_TELA && (
              <p className="extrato-suave">
                {MAIS_CANDIDATOS(candidatos.length - MAXIMO_CANDIDATOS_NA_TELA)}
              </p>
            )}
          </li>
        ))}
      </ul>
      {itens.length > MAXIMO_AMBIGUOS_NA_TELA && (
        <p className="extrato-atencao">
          {MAIS_AMBIGUOS(itens.length - MAXIMO_AMBIGUOS_NA_TELA)}
        </p>
      )}
    </>
  );
}

/** "Copiar os números dos pedidos": a área de transferência ou, sem ela, os números selecionados num campo. */
function CopiarNumeros({
  numeros,
  quantos,
  aoAnunciar,
}: {
  numeros: string;
  quantos: number;
  aoAnunciar: (texto: string) => void;
}) {
  const [semAreaDeTransferencia, setSemAreaDeTransferencia] = useState(false);
  const [copiado, setCopiado] = useState(false);
  const campo = useRef<HTMLTextAreaElement>(null);

  async function copiar() {
    try {
      if (!navigator.clipboard) throw new Error("sem área de transferência");
      await navigator.clipboard.writeText(numeros);
      setSemAreaDeTransferencia(false);
      setCopiado(true);
      aoAnunciar(COPIADO(quantos));
    } catch {
      setCopiado(false);
      setSemAreaDeTransferencia(true);
      aoAnunciar(SEM_AREA_DE_TRANSFERENCIA);
      requestAnimationFrame(() => campo.current?.select());
    }
  }

  return (
    <div className="extrato-bloco">
      <div className="extrato-acoes">
        <ComDica texto={DICAS.copiar}>
          <Button onClick={() => void copiar()}>
            <Icone nome="copiar" />
            {COPIAR}
          </Button>
        </ComDica>
        {copiado && <span className="extrato-suave">{COPIADO(quantos)}</span>}
      </div>
      {semAreaDeTransferencia && (
        <>
          <p className="extrato-atencao">{SEM_AREA_DE_TRANSFERENCIA}</p>
          <Textarea
            ajuda={AJUDA.numeros}
            ref={campo}
            rotulo={ROTULO_NUMEROS}
            readOnly
            rows={Math.min(8, Math.max(2, quantos))}
            value={numeros}
            onFocus={(evento) => evento.currentTarget.select()}
          />
        </>
      )}
    </div>
  );
}

// O resultado do extrato: os números do cruzamento e as quatro listas. Só lê: nada do sistema muda aqui.
export function ResultadoDoExtrato({
  origem,
  extrato,
  ignorados,
  totalDePix,
  busca,
  resultado,
  refTitulo,
  aoTentarDeNovo,
  aoAnunciar,
}: Props) {
  const ignoradosTexto = textoDosIgnorados(ignorados);
  const titulo = (
    <span ref={refTitulo} tabIndex={-1} className="extrato-foco">
      {RESULTADO.titulo}
    </span>
  );
  return (
    <Card titulo={titulo} ajuda={AJUDA.resultado}>
      <div className="extrato-bloco">
        <p className="extrato-suave">
          Lido do {RESULTADO.formato[origem]}:{" "}
          {plural(extrato.lancamentos.length, "lançamento", "lançamentos")}.{" "}
          {ignoradosTexto}
        </p>
        {extrato.semHora && totalDePix > 0 && (
          <Aviso tom="info" anuncio="nenhum">
            <p>{RESULTADO.semHora}</p>
          </Aviso>
        )}
        {busca?.tipo === "carregando" && (
          <Loading texto={RESULTADO.carregando} />
        )}
        {busca?.tipo === "erro" && (
          <ErrorState
            titulo={ehFalhaDeConexao(busca.erro) ? undefined : FALHAS.pedidos}
            mensagem={mensagemDoErro(busca.erro)}
            conexao={ehFalhaDeConexao(busca.erro)}
            aoTentarDeNovo={aoTentarDeNovo}
          />
        )}
        {busca?.tipo === "ok" && busca.buscados.cortada && (
          <Aviso tom="alerta" anuncio="nenhum">
            <p>{RESULTADO.cortada}</p>
          </Aviso>
        )}
        {resultado && totalDePix === 0 && (
          <Aviso tom="info" anuncio="nenhum">
            <p>{RESULTADO.semPix}</p>
          </Aviso>
        )}
        {resultado && totalDePix > 0 && (
          <>
            <div className="grade extrato-numeros">
              <Stat
                rotulo={RESULTADO.numeros.lidos}
                ajuda={AJUDA.lidos}
                valor={plural(totalDePix, "Pix", "Pix")}
                icone="documento"
                tom="marca"
              />
              <Stat
                rotulo={RESULTADO.numeros.paraMarcar}
                ajuda={AJUDA.paraMarcar}
                valor={plural(resultado.paraMarcar.length, "pedido", "pedidos")}
                icone={resultado.paraMarcar.length > 0 ? "alerta" : "check"}
                tom={resultado.paraMarcar.length > 0 ? "alerta" : "neutro"}
              />
              <Stat
                rotulo={RESULTADO.numeros.ambiguos}
                ajuda={AJUDA.ambiguos}
                valor={plural(resultado.ambiguos.length, "Pix", "Pix")}
                icone="info"
                tom={resultado.ambiguos.length > 0 ? "alerta" : "neutro"}
              />
              <Stat
                rotulo={RESULTADO.numeros.semPedido}
                ajuda={AJUDA.semPedido}
                valor={plural(resultado.semPedido.length, "Pix", "Pix")}
                icone="suspeito"
                tom="neutro"
              />
              <Stat
                rotulo={RESULTADO.numeros.jaContados}
                ajuda={AJUDA.jaContados}
                valor={plural(resultado.jaContados.length, "Pix", "Pix")}
                icone="check"
                tom="sucesso"
              />
            </div>

            <Grupo
              titulo={GRUPOS.paraMarcar.titulo}
              ajuda={GRUPOS.paraMarcar.explicacao}
            >
              {resultado.paraMarcar.length === 0 ? (
                <p className="extrato-suave">{GRUPOS.paraMarcar.vazio}</p>
              ) : (
                <>
                  <Aviso tom="alerta" anuncio="nenhum">
                    <p>{GRUPOS.paraMarcar.aviso}.</p>
                  </Aviso>
                  <CopiarNumeros
                    numeros={numerosParaCopiar(resultado)}
                    quantos={resultado.paraMarcar.length}
                    aoAnunciar={aoAnunciar}
                  />
                  <p className="extrato-suave">{EXPLICACAO_DO_GRAU}</p>
                  <DataTable
                    colunas={COLUNAS_PARA_MARCAR}
                    linhas={resultado.paraMarcar}
                    chaveDaLinha={(casamento) => casamento.pix.chave}
                    legenda={GRUPOS.paraMarcar.titulo}
                  />
                </>
              )}
            </Grupo>

            {resultado.ambiguos.length > 0 && (
              <Grupo
                titulo={GRUPOS.ambiguos.titulo}
                ajuda={GRUPOS.ambiguos.explicacao}
                explicacao={GRUPOS.ambiguos.explicacao}
              >
                <Ambiguos itens={resultado.ambiguos} />
              </Grupo>
            )}

            {resultado.semPedido.length > 0 && (
              <Grupo
                titulo={GRUPOS.semPedido.titulo}
                ajuda={GRUPOS.semPedido.explicacao}
                explicacao={GRUPOS.semPedido.explicacao}
              >
                <DataTable
                  colunas={COLUNAS_SEM_PEDIDO}
                  linhas={resultado.semPedido}
                  chaveDaLinha={(item) => item.pix.chave}
                  legenda={GRUPOS.semPedido.titulo}
                />
              </Grupo>
            )}

            {resultado.jaContados.length > 0 && (
              <Grupo
                titulo={GRUPOS.jaContados.titulo}
                ajuda={GRUPOS.jaContados.explicacao}
                explicacao={GRUPOS.jaContados.explicacao}
              >
                <DataTable
                  colunas={COLUNAS_JA_CONTADOS}
                  linhas={resultado.jaContados}
                  chaveDaLinha={(item) => item.pix.chave}
                  legenda={GRUPOS.jaContados.titulo}
                />
              </Grupo>
            )}
          </>
        )}
      </div>
    </Card>
  );
}
