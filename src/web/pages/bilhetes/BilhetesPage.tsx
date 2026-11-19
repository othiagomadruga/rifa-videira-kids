import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type FormEvent,
} from "react";
import { Link } from "react-router";
import type {
  RespostaBilhete,
  RespostaBilhetes,
} from "../../../shared/contracts/api";
import {
  INTERVALO_ATUALIZACAO_BILHETES_MS,
  SITUACOES_BILHETE,
} from "../../../shared/contracts/bilhetes";
import {
  Aviso,
  Badge,
  Button,
  Card,
  ComDica,
  EmptyState,
  ErrorState,
  Input,
  Loading,
  PageHeader,
  Select,
  Stat,
} from "../../components/ui";
import { ehFalhaDeConexao, mensagemDoErro } from "../../lib/api";
import {
  formatarDataHora,
  formatarHora,
  formatarNumero,
  formatarPercentual,
} from "../../lib/formatadores";
import { buscarBilhete, carregarBilhetes, ehSemCampanha } from "./bilhetes-api";
import { GradeBilhetes } from "./GradeBilhetes";
import { gradeDaResposta, type Grade } from "./grade";
import {
  DESCRICAO_TELA,
  DICAS,
  FILTROS,
  NOME_SITUACAO,
  NOME_SITUACAO_PEDIDO,
  TOM_SITUACAO,
  TOM_SITUACAO_PEDIDO,
  plural,
  type FiltroGrade,
} from "./textos";
import "./bilhetes.css";
import { DICA_DO_MENU } from "../coordenacao/textos";
import { ajuda } from "../ajuda-sob-demanda";

type Estado =
  | { tipo: "carregando" }
  | { tipo: "sem_campanha" }
  | { tipo: "erro"; erro: unknown }
  | {
      tipo: "ok";
      resposta: RespostaBilhetes;
      grade: Grade;
      falhaAoAtualizar: unknown;
    };

type Busca =
  | { tipo: "nada" }
  | { tipo: "buscando"; numero: number }
  | { tipo: "ok"; resposta: RespostaBilhete }
  | { tipo: "erro"; numero: number; erro: unknown }
  | { tipo: "invalido" };

/** A tela está visível (aba em primeiro plano)? Sem a API (testes antigos), sim. */
const visivel = () =>
  typeof document === "undefined" || document.visibilityState !== "hidden";

// Bilhetes pagos, reservados e livres (RIFA-075, D35; coordenação e admin). Busca de novo a cada 30 s enquanto a tela
// está aberta e visível (e logo que volta a ficar visível), e no "Atualizar agora".
export function BilhetesPage() {
  const [estado, setEstado] = useState<Estado>({ tipo: "carregando" });
  const [atualizando, setAtualizando] = useState(false);
  const [filtro, setFiltro] = useState<FiltroGrade>("todos");
  const [textoBusca, setTextoBusca] = useState("");
  const [busca, setBusca] = useState<Busca>({ tipo: "nada" });
  const controle = useRef<AbortController | null>(null);
  const controleBusca = useRef<AbortController | null>(null);

  const carregar = useCallback(() => {
    controle.current?.abort();
    const atual = new AbortController();
    controle.current = atual;
    carregarBilhetes({ signal: atual.signal }).then(
      (resposta) => {
        if (atual.signal.aborted) return;
        setAtualizando(false);
        setEstado({
          tipo: "ok",
          resposta,
          grade: gradeDaResposta(resposta),
          falhaAoAtualizar: null,
        });
      },
      (erro: unknown) => {
        if (atual.signal.aborted) return;
        setAtualizando(false);
        setEstado((anterior) => {
          if (ehSemCampanha(erro)) return { tipo: "sem_campanha" };
          // Falhou com a grade na tela: ela fica, com o aviso.
          if (anterior.tipo === "ok")
            return { ...anterior, falhaAoAtualizar: erro };
          return { tipo: "erro", erro };
        });
      },
    );
  }, []);

  /** Busca de novo com a grade na tela ("Atualizar agora", o relógio de 30 s e a volta da aba). */
  const atualizar = useCallback(() => {
    setAtualizando(true);
    carregar();
  }, [carregar]);

  useEffect(() => {
    carregar();
    const relogio = setInterval(() => {
      if (visivel()) atualizar();
    }, INTERVALO_ATUALIZACAO_BILHETES_MS);
    const aoMudarVisibilidade = () => {
      if (visivel()) atualizar();
    };
    document.addEventListener("visibilitychange", aoMudarVisibilidade);
    return () => {
      clearInterval(relogio);
      document.removeEventListener("visibilitychange", aoMudarVisibilidade);
      controle.current?.abort();
      controleBusca.current?.abort();
    };
  }, [carregar, atualizar]);

  function buscar(numero: number) {
    controleBusca.current?.abort();
    const atual = new AbortController();
    controleBusca.current = atual;
    setTextoBusca(String(numero));
    setBusca({ tipo: "buscando", numero });
    buscarBilhete(numero, { signal: atual.signal }).then(
      (resposta) => {
        if (!atual.signal.aborted) setBusca({ tipo: "ok", resposta });
      },
      (erro: unknown) => {
        if (!atual.signal.aborted) setBusca({ tipo: "erro", numero, erro });
      },
    );
  }

  function aoBuscar(evento: FormEvent<HTMLFormElement>) {
    evento.preventDefault();
    const limpo = textoBusca.trim();
    if (!/^\d{1,7}$/.test(limpo)) {
      controleBusca.current?.abort();
      setBusca({ tipo: "invalido" });
      return;
    }
    buscar(Number(limpo));
  }

  return (
    <>
      <PageHeader
        titulo="Bilhetes"
        ajuda={DICA_DO_MENU.bilhetes}
        descricao={DESCRICAO_TELA}
      />
      <div className="pilha bilhetes-tela">
        {estado.tipo === "carregando" && (
          <Loading texto="Carregando os bilhetes…" />
        )}
        {estado.tipo === "erro" && (
          <ErrorState
            titulo="Não foi possível carregar os bilhetes."
            mensagem={mensagemDoErro(estado.erro)}
            conexao={ehFalhaDeConexao(estado.erro)}
            aoTentarDeNovo={carregar}
          />
        )}
        {estado.tipo === "sem_campanha" && (
          <EmptyState
            titulo="Nenhuma campanha ativa."
            descricao={
              <>
                A grade mostra os números da campanha ativa. Configure a
                campanha em <Link to="/coordenacao/campanha">Campanha</Link>.
              </>
            }
          />
        )}
        {estado.tipo === "ok" && (
          <Conteudo
            resposta={estado.resposta}
            grade={estado.grade}
            falhaAoAtualizar={estado.falhaAoAtualizar}
            atualizando={atualizando}
            aoAtualizar={atualizar}
            filtro={filtro}
            aoFiltrar={setFiltro}
            textoBusca={textoBusca}
            aoDigitar={setTextoBusca}
            aoBuscar={aoBuscar}
            aoEscolher={buscar}
            busca={busca}
          />
        )}
      </div>
    </>
  );
}

type PropsConteudo = {
  resposta: RespostaBilhetes;
  grade: Grade;
  falhaAoAtualizar: unknown;
  atualizando: boolean;
  aoAtualizar: () => void;
  filtro: FiltroGrade;
  aoFiltrar: (filtro: FiltroGrade) => void;
  textoBusca: string;
  aoDigitar: (texto: string) => void;
  aoBuscar: (evento: FormEvent<HTMLFormElement>) => void;
  aoEscolher: (numero: number) => void;
  busca: Busca;
};

function Conteudo({
  resposta,
  grade,
  falhaAoAtualizar,
  atualizando,
  aoAtualizar,
  filtro,
  aoFiltrar,
  textoBusca,
  aoDigitar,
  aoBuscar,
  aoEscolher,
  busca,
}: PropsConteudo) {
  const { contagem, sem_numeros, fora_da_faixa } = resposta;
  const selecionado =
    busca.tipo === "ok"
      ? busca.resposta.numero
      : busca.tipo === "buscando"
        ? busca.numero
        : null;
  const descricao = `Grade dos ${formatarNumero(resposta.quantidade)} números da rifa: ${plural(contagem.pagos, "pago", "pagos")}, ${plural(contagem.reservados, "reservado", "reservados")} e ${plural(contagem.livres, "livre", "livres")}.`;
  return (
    <>
      <p className="visualmente-oculto" role="status">
        {atualizando
          ? ""
          : `Atualizado às ${formatarHora(resposta.atualizado_em)}.`}
      </p>
      <div className="bilhetes-barra">
        <ComDica texto={DICAS.atualizar}>
          <Button
            variante="secundario"
            aria-disabled={atualizando ? true : undefined}
            onClick={() => {
              if (!atualizando) aoAtualizar();
            }}
          >
            {atualizando ? "Atualizando…" : "Atualizar agora"}
          </Button>
        </ComDica>
        <p className="bilhetes-barra__hora">
          Atualizado às {formatarHora(resposta.atualizado_em)}. Atualiza sozinho
          a cada 30 segundos.
        </p>
      </div>
      {falhaAoAtualizar !== null && (
        <Aviso
          tom="alerta"
          titulo="Não foi possível atualizar agora."
          anuncio="nenhum"
        >
          <p>{mensagemDoErro(falhaAoAtualizar)}</p>
          <p>
            Os números abaixo são os das {formatarHora(resposta.atualizado_em)}.
          </p>
        </Aviso>
      )}
      <div className="bilhetes-contadores">
        <Stat
          rotulo="Pagos"
          ajuda={ajuda("pagos")}
          valor={formatarNumero(contagem.pagos)}
          icone="check"
          tom="sucesso"
        />
        <Stat
          rotulo="Reservados"
          ajuda={ajuda("reservados")}
          valor={formatarNumero(contagem.reservados)}
          icone="periodo"
          tom="alerta"
        />
        <Stat
          rotulo="Livres"
          ajuda={ajuda("livres")}
          valor={formatarNumero(contagem.livres)}
        />
        <Stat
          rotulo="Vendido"
          ajuda={ajuda("vendido")}
          valor={formatarPercentual(resposta.vendido_bp, { casasDecimais: 1 })}
          icone="grafico"
          tom="marca"
        />
      </div>
      {sem_numeros.pedidos > 0 && (
        <Aviso
          tom="info"
          titulo="Pedidos sem os números na grade."
          anuncio="nenhum"
        >
          <p>
            {plural(
              sem_numeros.pedidos,
              "pedido pago ou reservado chegou",
              "pedidos pagos ou reservados chegaram",
            )}{" "}
            sem a lista dos números (
            {plural(sem_numeros.bilhetes, "bilhete", "bilhetes")}), em geral os
            recuperados pela Conferência. Eles contam nas vendas, mas não
            aparecem na grade: confira os números deles na Rifei.
          </p>
        </Aviso>
      )}
      {fora_da_faixa > 0 && (
        <Aviso tom="alerta" titulo="Números fora da rifa." anuncio="nenhum">
          <p>
            {plural(
              fora_da_faixa,
              "número de pedido ficou",
              "números de pedidos ficaram",
            )}{" "}
            fora da faixa de {formatarNumero(grade.inicial)} a{" "}
            {formatarNumero(grade.inicial + grade.quantidade - 1)}. Confira a
            quantidade de números e o número inicial na{" "}
            <Link to="/coordenacao/campanha">Campanha</Link>.
          </p>
        </Aviso>
      )}
      {resposta.numero_inicial_automatico && (
        <p className="bilhetes-grade__nota">
          A numeração começa no {resposta.numero_inicial}, deduzido dos números
          dos pedidos (
          {resposta.numero_inicial === 0
            ? "algum pedido tem o número 0"
            : "nenhum pedido tem o número 0"}
          ). Para fixar, escolha o número inicial na{" "}
          <Link to="/coordenacao/campanha">Campanha</Link>.
        </p>
      )}

      <Card titulo="Buscar um número" ajuda={ajuda("buscarUmNumero")}>
        <form className="bilhetes-busca" onSubmit={aoBuscar} role="search">
          <Input
            ajuda={ajuda("numeroDoBilhete")}
            rotulo="Número do bilhete"
            inputMode="numeric"
            autoComplete="off"
            value={textoBusca}
            onChange={(evento) => aoDigitar(evento.target.value)}
          />

          <Button type="submit">Buscar</Button>
        </form>
        <ResultadoBusca busca={busca} grade={grade} />
      </Card>

      <Card titulo="Todos os números" ajuda={ajuda("todosOsNumeros")}>
        <div className="pilha">
          <div className="bilhetes-barra">
            <Select
              ajuda={ajuda("mostrarNaGrade")}
              rotulo="Mostrar na grade"
              value={filtro}
              onChange={(evento) =>
                aoFiltrar(evento.target.value as FiltroGrade)
              }
            >
              {FILTROS.map(({ valor, rotulo }) => (
                <option key={valor} value={valor}>
                  {rotulo}
                </option>
              ))}
            </Select>
          </div>
          <ul className="bilhetes-legenda" aria-label="Legenda da grade">
            {SITUACOES_BILHETE.map((situacao) => (
              <li key={situacao}>
                <span
                  className="bilhetes-legenda__cor"
                  data-situacao={situacao}
                  aria-hidden="true"
                />
                {NOME_SITUACAO[situacao]}:{" "}
                {formatarNumero(
                  contagem[
                    situacao === "pago"
                      ? "pagos"
                      : situacao === "reservado"
                        ? "reservados"
                        : "livres"
                  ],
                )}
              </li>
            ))}
          </ul>
          <GradeBilhetes
            grade={grade}
            filtro={filtro}
            selecionado={selecionado}
            aoEscolher={aoEscolher}
            descricao={descricao}
          />
        </div>
      </Card>
    </>
  );
}

function ResultadoBusca({ busca, grade }: { busca: Busca; grade: Grade }) {
  if (busca.tipo === "nada") return null;
  if (busca.tipo === "buscando")
    return <Loading texto={`Buscando o número ${busca.numero}…`} />;
  if (busca.tipo === "invalido")
    return (
      <Aviso tom="alerta" titulo="Número inválido." anuncio="alerta">
        <p>Digite só o número do bilhete, sem letras.</p>
      </Aviso>
    );
  if (busca.tipo === "erro")
    return (
      <Aviso tom="perigo" titulo="Não foi possível buscar." anuncio="alerta">
        <p>{mensagemDoErro(busca.erro)}</p>
      </Aviso>
    );
  const { numero, situacao, pedidos } = busca.resposta;
  const ultimo = grade.inicial + grade.quantidade - 1;
  const fora = numero < grade.inicial || numero > ultimo;
  return (
    <div className="bilhetes-resultado" role="status">
      <p>
        Número <strong>{numero}</strong>:{" "}
        <Badge tom={TOM_SITUACAO[situacao]}>{NOME_SITUACAO[situacao]}</Badge>
        {fora &&
          ` (fora da rifa, que vai do ${formatarNumero(grade.inicial)} ao ${formatarNumero(ultimo)})`}
      </p>
      {pedidos.length === 0 ? (
        <p>Nenhum pedido com este número.</p>
      ) : (
        <ul
          className="bilhetes-resultado__pedidos"
          aria-label={`Pedidos com o número ${numero}`}
        >
          {pedidos.map((pedido) => (
            <li key={pedido.id}>
              <span>
                Pedido <strong>{pedido.id}</strong>
              </span>
              <Badge tom={TOM_SITUACAO_PEDIDO[pedido.situacao]}>
                {NOME_SITUACAO_PEDIDO[pedido.situacao]}
              </Badge>
              <span>{pedido.celula ?? "Sem célula"}</span>
              <span>{formatarDataHora(pedido.data)}</span>
              <span>{plural(pedido.qtd_bilhetes, "bilhete", "bilhetes")}</span>
              {pedido.desconsiderado && (
                <Badge tom="neutro">Desconsiderado</Badge>
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
