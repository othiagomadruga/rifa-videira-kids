import { useEffect, useLayoutEffect, useRef, useState } from "react";
import type {
  ItemQuemComprou,
  RespostaQuemComprou,
} from "../../../shared/contracts/api";
import {
  Button,
  Card,
  ComDica,
  ErrorState,
  Loading,
} from "../../components/ui";
import { ehFalhaDeConexao, mensagemDoErro } from "../../lib/api";
import { carregarQuemComprou } from "./quem-comprou-api";
import {
  AJUDA,
  COMPRADOR_SEM_NOME,
  DICAS,
  bilhetes,
  quandoComprou,
} from "./textos";

type Estado =
  | { tipo: "carregando" }
  | { tipo: "erro"; erro: unknown }
  | {
      tipo: "ok";
      fuso: string;
      itens: ItemQuemComprou[];
      proximo: string | null;
      /** Quantas páginas estão na tela (o "Ver mais" soma uma). */
      paginas: number;
      /** Onde começa o que o último "Ver mais" trouxe (recebe o foco); null na primeira página. */
      inicioDaUltima: number | null;
    };

// Quem comprou (RIFA-089, adendo da D38; só o líder da célula): as compras pagas que contam para a célula (as do link
// dela e as que o admin atribuiu à mão, D41), da mais recente para a mais antiga, com o nome, o dia e a hora no fuso da
// campanha e os bilhetes. Nunca telefone, números dos bilhetes nem dinheiro (a rota não devolve; guarda-minha.test.ts
// confere o código). A primeira página acompanha a atualização da visão (a cada minuto) enquanto o líder não pediu
// "Ver mais"; depois disso, a lista fica como está até a página ser aberta de novo (não some o que ele já viu).
export function QuemComprou({ atualizadoEm }: { atualizadoEm: string }) {
  const [estado, setEstado] = useState<Estado>({ tipo: "carregando" });
  const [tentativa, setTentativa] = useState(0);
  const [carregandoMais, setCarregandoMais] = useState(false);
  const [falhaNoMais, setFalhaNoMais] = useState<string | null>(null);
  const emAndamento = useRef(false);
  const paginas = estado.tipo === "ok" ? estado.paginas : 1;
  const refPrimeiroNovo = useRef<HTMLLIElement>(null);
  // Depois do "Ver mais", o foco vai para a primeira compra nova (o botão pode sumir na última página).
  const focarNovo = useRef(false);

  useEffect(() => {
    if (paginas > 1) return;
    const controle = new AbortController();
    carregarQuemComprou(null, { signal: controle.signal }).then(
      (resposta) => {
        if (controle.signal.aborted) return;
        setEstado(primeiraPagina(resposta));
      },
      (erro: unknown) => {
        if (controle.signal.aborted) return;
        // Se uma atualização automática falha, a lista de antes fica.
        setEstado((anterior) =>
          anterior.tipo === "ok" ? anterior : { tipo: "erro", erro },
        );
      },
    );
    return () => controle.abort();
  }, [atualizadoEm, tentativa, paginas]);

  // Na mesma passada da tela que mostra as compras novas (antes de o botão sumido deixar o foco no <body>).
  useLayoutEffect(() => {
    if (!focarNovo.current) return;
    focarNovo.current = false;
    refPrimeiroNovo.current?.focus();
  });

  async function verMais() {
    if (estado.tipo !== "ok" || estado.proximo === null || emAndamento.current)
      return;
    emAndamento.current = true;
    setCarregandoMais(true);
    setFalhaNoMais(null);
    try {
      const resposta = await carregarQuemComprou(estado.proximo);
      setEstado((anterior) =>
        anterior.tipo !== "ok"
          ? anterior
          : {
              ...anterior,
              itens: [...anterior.itens, ...resposta.itens],
              proximo: resposta.proximo,
              paginas: anterior.paginas + 1,
              inicioDaUltima:
                resposta.itens.length > 0
                  ? anterior.itens.length
                  : anterior.inicioDaUltima,
            },
      );
      if (resposta.itens.length > 0) focarNovo.current = true;
    } catch (erro) {
      setFalhaNoMais(mensagemDoErro(erro));
    } finally {
      emAndamento.current = false;
      setCarregandoMais(false);
    }
  }

  const inicioDosNovos = estado.tipo === "ok" ? estado.inicioDaUltima : null;

  return (
    <Card
      titulo="Quem comprou"
      ajuda={AJUDA.quemComprou}
      className="minha-quem-comprou"
    >
      <div className="minha-quem-comprou__corpo">
        {estado.tipo === "carregando" ? (
          <Loading texto="Carregando quem comprou…" />
        ) : estado.tipo === "erro" ? (
          <ErrorState
            titulo="Não foi possível carregar quem comprou."
            mensagem={mensagemDoErro(estado.erro)}
            conexao={ehFalhaDeConexao(estado.erro)}
            aoTentarDeNovo={() => {
              setEstado({ tipo: "carregando" });
              setTentativa((atual) => atual + 1);
            }}
          />
        ) : estado.itens.length === 0 ? (
          <p className="minha-quem-comprou__vazio">
            Ainda não há compras pagas da sua célula.
          </p>
        ) : (
          <>
            <ol className="minha-quem-comprou__lista">
              {estado.itens.map((item, indice) => (
                <li
                  key={`${item.aprovado_em}-${indice}`}
                  className="minha-quem-comprou__item"
                  ref={indice === inicioDosNovos ? refPrimeiroNovo : undefined}
                  tabIndex={indice === inicioDosNovos ? -1 : undefined}
                >
                  <span className="minha-quem-comprou__quem">
                    <span
                      className={
                        item.nome === null
                          ? "minha-quem-comprou__nome minha-quem-comprou__nome--sem"
                          : "minha-quem-comprou__nome"
                      }
                    >
                      {item.nome ?? COMPRADOR_SEM_NOME}
                    </span>{" "}
                    <time
                      className="minha-quem-comprou__quando"
                      dateTime={item.aprovado_em}
                    >
                      {quandoComprou(item.aprovado_em, estado.fuso)}
                    </time>
                  </span>{" "}
                  <span className="minha-quem-comprou__bilhetes">
                    {bilhetes(item.bilhetes)}
                  </span>
                </li>
              ))}
            </ol>
            {estado.proximo !== null && (
              <ComDica
                texto={
                  carregandoMais
                    ? DICAS.carregandoMais
                    : DICAS.verMaisCompradores
                }
              >
                <Button
                  variante="secundario"
                  aria-disabled={carregandoMais || undefined}
                  onClick={() => void verMais()}
                >
                  {carregandoMais ? "Carregando…" : "Ver mais"}
                </Button>
              </ComDica>
            )}
            {/* Região viva fixa: avisa quando o "Ver mais" falha. */}
            <p className="minha-quem-comprou__falha" role="status">
              {falhaNoMais
                ? `Não foi possível trazer mais compras: ${falhaNoMais}`
                : ""}
            </p>
          </>
        )}
      </div>
    </Card>
  );
}

function primeiraPagina(resposta: RespostaQuemComprou): Estado {
  return {
    tipo: "ok",
    fuso: resposta.fuso_horario,
    itens: resposta.itens,
    proximo: resposta.proximo,
    paginas: 1,
    inicioDaUltima: null,
  };
}
