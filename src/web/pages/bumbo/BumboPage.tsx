import { useId, useLayoutEffect, useRef, useState } from "react";
import { Link } from "react-router";
import type { RespostaBumbo } from "../../../shared/contracts/calculos";
import {
  Aviso,
  Button,
  Card,
  ComDica,
  EmptyState,
  ErrorState,
  Icone,
  Loading,
  PageHeader,
  Select,
  classesBotao,
} from "../../components/ui";
import { ehFalhaDeConexao, mensagemDoErro } from "../../lib/api";
import { TextoDoWhatsApp } from "./formatacao";
import {
  DICAS,
  NOTA_DA_PREVIA,
  NOTA_DO_TEXTO_PURO,
  avisoDaMensagem,
  linkWhatsApp,
  opcoesDoSeletor,
  textoDaReferencia,
  type OpcaoDoDia,
} from "./textos";
import { useBumbo } from "./useBumbo";
import "./bumbo.css";
import { DICA_DO_MENU } from "../coordenacao/textos";
import { ajuda } from "../ajuda-sob-demanda";

// Bumbo (RIFA-011): quem anima a campanha no grupo de WhatsApp dos líderes abre esta tela todo dia, vê a
// mensagem pronta e a envia com um toque. O texto vem de GET /api/publico/bumbo e aparece exatamente como
// chegou (com as quebras de linha e o *negrito* do WhatsApp); a API nunca põe nele valores em dinheiro
// nem quantidade de bilhetes (R9). Pensada para o celular.
export function BumboPage() {
  // null = hoje (a consulta vai sem `data`).
  const [data, setData] = useState<string | null>(null);
  const { estado, datas, tentarDeNovo } = useBumbo(data);
  const opcoes = datas ? opcoesDoSeletor(datas) : [];

  return (
    <>
      <PageHeader
        titulo="Bumbo"
        ajuda={DICA_DO_MENU.bumbo}
        descricao="A mensagem do dia para o grupo de WhatsApp dos líderes: só percentuais e posições, sem valores em dinheiro."
      />
      {estado.tipo === "sem_campanha" ? (
        <EmptyState
          titulo="A campanha ainda não foi configurada."
          descricao="A mensagem do bumbo aparece aqui depois que a campanha estiver configurada."
          acao={
            <ComDica texto={DICAS.configurarCampanha}>
              <Link
                className={classesBotao({ variante: "secundario" })}
                to="/coordenacao/campanha"
              >
                Configurar a campanha
              </Link>
            </ComDica>
          }
        />
      ) : (
        <>
          {/* Antes do início só existe a de hoje: o seletor aparece quando houver outro dia. */}
          {opcoes.length > 1 && (
            <SeletorDoDia
              opcoes={opcoes}
              valor={data ?? ""}
              aoMudar={(valor) => setData(valor === "" ? null : valor)}
            />
          )}
          <Card
            titulo="Mensagem do dia"
            ajuda={ajuda("mensagemDoDia")}
            className="bumbo__cartao"
          >
            {estado.tipo === "carregando" && (
              <Loading texto="Carregando a mensagem…" />
            )}
            {estado.tipo === "erro" && (
              <ErrorState
                titulo="Não foi possível carregar a mensagem."
                mensagem={mensagemDoErro(estado.erro)}
                conexao={ehFalhaDeConexao(estado.erro)}
                aoTentarDeNovo={tentarDeNovo}
              />
            )}
            {estado.tipo === "ok" && (
              // A chave zera o "copiada" quando a mensagem muda.
              <Mensagem
                key={`${estado.bumbo.data}\n${estado.bumbo.texto}`}
                bumbo={estado.bumbo}
                hoje={datas?.hoje ?? null}
              />
            )}
          </Card>
        </>
      )}
    </>
  );
}

type PropsSeletor = {
  opcoes: OpcaoDoDia[];
  valor: string;
  aoMudar: (valor: string) => void;
};

/** Os dias que têm mensagem: hoje (padrão) e os da campanha, do mais recente ao 1º. */
function SeletorDoDia({ opcoes, valor, aoMudar }: PropsSeletor) {
  return (
    <div className="bumbo__seletor">
      <Select
        ajuda={ajuda("diaDaMensagem")}
        rotulo="Dia da mensagem"
        dica="A mensagem fala sempre do dia anterior, já fechado."
        value={valor}
        onChange={(evento) => aoMudar(evento.target.value)}
      >
        {opcoes.map((opcao) => (
          <option key={opcao.data} value={opcao.valor}>
            {opcao.rotulo}
          </option>
        ))}
      </Select>
    </div>
  );
}

type Copia = "nada" | "copiada" | "falhou";

const TEXTO_DA_COPIA: Record<Copia, string> = {
  nada: "",
  copiada: "Mensagem copiada. Agora é só colar no grupo dos líderes.",
  falhou:
    "Não deu para copiar sozinho: a mensagem ficou selecionada. Copie pelo menu do celular.",
};

/** Seleciona o texto do elemento (para copiar à mão quando a área de transferência não deixa). */
function selecionarTexto(elemento: HTMLElement | null) {
  const selecao = window.getSelection();
  if (!elemento || !selecao) return;
  const intervalo = document.createRange();
  intervalo.selectNodeContents(elemento);
  selecao.removeAllRanges();
  selecao.addRange(intervalo);
}

type PropsMensagem = {
  bumbo: RespostaBumbo;
  /** O "hoje" do servidor, para marcar a mensagem de hoje. */
  hoje: string | null;
};

function Mensagem({ bumbo, hoje }: PropsMensagem) {
  const idLegenda = useId();
  const refTexto = useRef<HTMLPreElement>(null);
  const [copia, setCopia] = useState<Copia>("nada");
  const referencia = textoDaReferencia(bumbo.referencia, hoje);
  const aviso = avisoDaMensagem(bumbo);

  // Sem copiar sozinho, a prévia volta ao texto puro (com os * e _), selecionado: é ele que a pessoa copia à mão.
  // A seleção vem depois de a prévia trocar (a troca desfaria a seleção feita antes dela).
  useLayoutEffect(() => {
    if (copia === "falhou") selecionarTexto(refTexto.current);
  }, [copia]);

  async function copiar() {
    // Zera antes: copiar de novo volta a anunciar.
    setCopia("nada");
    try {
      // Sem a área de transferência (navegador antigo ou página sem HTTPS), cai na seleção do texto.
      if (!navigator.clipboard)
        throw new Error("Área de transferência indisponível");
      await navigator.clipboard.writeText(bumbo.texto);
      setCopia("copiada");
    } catch {
      selecionarTexto(refTexto.current);
      setCopia("falhou");
    }
  }

  return (
    <div className="bumbo__mensagem">
      <p className="bumbo__referencia">
        <span className="bumbo__data">{referencia.data}</span>{" "}
        <strong className="bumbo__fase">{referencia.fase}</strong>
      </p>
      {aviso && (
        <Aviso tom="info" titulo={aviso.titulo} anuncio="nenhum">
          <p>{aviso.texto}</p>
        </Aviso>
      )}
      {/* As ações vêm antes do texto: ao abrir a tela, enviar é um toque, sem rolar. */}
      <div className="bumbo__acoes">
        <ComDica texto={DICAS.enviarNoWhatsApp}>
          <a
            className={classesBotao({ variante: "primario" }, "bumbo__acao")}
            href={linkWhatsApp(bumbo.texto)}
            target="_blank"
            rel="noreferrer"
          >
            Enviar no WhatsApp{" "}
            <span className="visualmente-oculto">(abre em outra aba)</span>
          </a>
        </ComDica>
        <ComDica texto={DICAS.copiar}>
          <Button
            variante="secundario"
            className="bumbo__acao"
            onClick={() => void copiar()}
          >
            Copiar mensagem
          </Button>
        </ComDica>
      </div>
      {/* Região viva fixa (anuncia o resultado de copiar) e o mesmo texto, visível. */}
      <p className="visualmente-oculto" role="status">
        {TEXTO_DA_COPIA[copia]}
      </p>
      {copia !== "nada" && (
        <p className="bumbo__copia" data-resultado={copia}>
          {/* O ícone (RIFA-053: antes, os caracteres ✓ e !), só visual: o texto diz o que houve. */}
          <span className="bumbo__copia-icone" aria-hidden="true">
            <Icone nome={copia === "copiada" ? "check" : "alerta"} />
          </span>
          {TEXTO_DA_COPIA[copia]}
        </p>
      )}
      {/* A prévia como os líderes vão ver no grupo (RIFA-051, P3.9): a mensagem num balão de conversa, com o
          *negrito* e o _itálico_ do WhatsApp desenhados. O texto (textContent) é exatamente o da API, com as quebras
          de linha (white-space: pre-wrap) e as marcas, escondidas da vista. */}
      <figure className="bumbo__figura" aria-labelledby={idLegenda}>
        <figcaption id={idLegenda} className="visualmente-oculto">
          Texto da mensagem
        </figcaption>
        <pre ref={refTexto} className="bumbo__texto">
          {copia === "falhou" ? (
            bumbo.texto
          ) : (
            <TextoDoWhatsApp texto={bumbo.texto} />
          )}
        </pre>
      </figure>
      <p className="bumbo__dica">
        {copia === "falhou" ? NOTA_DO_TEXTO_PURO : NOTA_DA_PREVIA}
      </p>
    </div>
  );
}
