import { useEffect, useId, useRef, useState, type FormEvent } from "react";
import {
  LIMITE_CARACTERES_MODELO_LINK_VENDAS,
  montarLinkDeVendas,
  problemasDoModeloLinkVendas,
} from "../../../shared/contracts/link-vendas";
import { Aviso, Button, ComDica, Input } from "../../components/ui";
import { ErroApi, mensagemDoErro } from "../../lib/api";
import { formatarNumero } from "../../lib/formatadores";
import { carregarSlug, problemasDoErro } from "./links-vendas-api";
import { DICAS } from "./textos";

/** O afiliado da prévia: um de verdade (o primeiro vinculado, com a célula dele) ou, sem nenhum, um de exemplo. */
export type ExemploDaPrevia = {
  affiliateId: number;
  celulaNome: string | null;
};

/** O código de exemplo da prévia quando nenhum afiliado está vinculado ainda. */
export const AFILIADO_DE_EXEMPLO = 1234;

/** O exemplo do formato (o real ainda não está documentado pela Rifei; D24). */
// RIFA-070 (D27): o link de vendas da Rifei é `?ref=<código do afiliado>`; o código vem da sincronização com a Rifei.
const EXEMPLO_DE_MODELO = "https://rifei.com.br/{slug}?ref={codigo}";

/**
 * Os problemas do modelo como a pessoa digitou (sem os espaços das pontas, que a API tira): os do contrato
 * (`problemasDoModeloLinkVendas`) e o tamanho. Vazio não é problema: apaga o modelo.
 */
export function problemasDoTexto(texto: string): string[] {
  const modelo = texto.trim();
  if (modelo === "") return [];
  const problemas = problemasDoModeloLinkVendas(modelo);
  if (modelo.length > LIMITE_CARACTERES_MODELO_LINK_VENDAS)
    problemas.push(
      `O modelo passou de ${formatarNumero(LIMITE_CARACTERES_MODELO_LINK_VENDAS)} caracteres (tem ${formatarNumero(modelo.length)}).`,
    );
  return problemas;
}

type EstadoSlug =
  | { tipo: "carregando" }
  | { tipo: "ok"; slug: string | null }
  | { tipo: "erro" };

type Props = {
  /** O modelo gravado (null = vazio). */
  modelo: string | null;
  /** Só o admin edita; a coordenação vê o modelo só leitura. */
  admin: boolean;
  exemplo: ExemploDaPrevia;
  /** Grava o modelo (PUT); a lista da tela troca pela resposta. */
  aoSalvar: (modelo: string | null) => Promise<void>;
};

/**
 * O modelo do link de vendas (D24): o admin edita, com os problemas enquanto digita, a contagem e a prévia do link de
 * um afiliado montado com o slug da campanha (para abrir e conferir antes de salvar); a coordenação vê só leitura,
 * com "Só o admin muda o modelo.".
 */
export function ModeloLinkVendas({ modelo, admin, exemplo, aoSalvar }: Props) {
  return admin ? (
    <EditorDoModelo modelo={modelo} exemplo={exemplo} aoSalvar={aoSalvar} />
  ) : (
    <ModeloSoLeitura modelo={modelo} />
  );
}

function ModeloSoLeitura({ modelo }: { modelo: string | null }) {
  const idAviso = useId();
  return (
    <div className="adesao-links__modelo">
      <p id={idAviso} className="adesao-links__so-admin">
        Só o admin muda o modelo.
      </p>
      <ComDica texto={DICAS.modeloSoLeitura}>
        <Input
          rotulo="Modelo do link de vendas"
          value={modelo ?? ""}
          placeholder="Ainda sem modelo"
          readOnly
          spellCheck={false}
          aria-describedby={idAviso}
          className="adesao-links__campo-modelo"
        />
      </ComDica>
    </div>
  );
}

function EditorDoModelo({ modelo, exemplo, aoSalvar }: Omit<Props, "admin">) {
  const [texto, setTexto] = useState(modelo ?? "");
  const [slug, setSlug] = useState<EstadoSlug>({ tipo: "carregando" });
  const [salvando, setSalvando] = useState(false);
  const [resultado, setResultado] = useState<{
    tom: "sucesso" | "perigo";
    texto: string;
  } | null>(null);
  const [problemasDaApi, setProblemasDaApi] = useState<string[]>([]);
  const trava = useRef(false);
  const refCampo = useRef<HTMLInputElement>(null);
  const idCampo = useId();
  const idContagem = useId();

  useEffect(() => {
    const controle = new AbortController();
    carregarSlug({ signal: controle.signal }).then(
      (valor) => {
        if (!controle.signal.aborted) setSlug({ tipo: "ok", slug: valor });
      },
      () => {
        if (!controle.signal.aborted) setSlug({ tipo: "erro" });
      },
    );
    return () => controle.abort();
  }, []);

  const valor = texto.trim();
  const novo = valor === "" ? null : valor;
  const problemas = problemasDoTexto(texto);
  const erros = problemas.length > 0 ? problemas : problemasDaApi;
  const mudou = novo !== modelo;
  const previa =
    novo !== null && problemas.length === 0 && slug.tipo === "ok" && slug.slug
      ? montarLinkDeVendas(novo, {
          slug: slug.slug,
          affiliateId: exemplo.affiliateId,
        })
      : null;

  async function salvar(evento: FormEvent<HTMLFormElement>) {
    evento.preventDefault();
    if (trava.current || !mudou) return;
    if (problemas.length > 0) {
      refCampo.current?.focus();
      return;
    }
    trava.current = true;
    setSalvando(true);
    setResultado(null);
    setProblemasDaApi([]);
    try {
      await aoSalvar(novo);
      setTexto(novo ?? "");
      setResultado({
        tom: "sucesso",
        texto:
          novo === null
            ? "Modelo apagado. Os líderes veem que o link de vendas ainda não foi liberado."
            : "Modelo salvo. Os links das células já usam o modelo novo.",
      });
    } catch (erro) {
      const daApi = problemasDoErro(erro);
      setProblemasDaApi(daApi);
      setResultado({
        tom: "perigo",
        texto:
          erro instanceof ErroApi && erro.status === 403
            ? "Só o admin muda o modelo."
            : erro instanceof ErroApi &&
                erro.status === 404 &&
                erro.codigo === "nao_encontrado"
              ? "A campanha ainda não foi configurada: configure-a na tela Campanha."
              : `Não foi possível salvar o modelo. ${mensagemDoErro(erro)}`,
      });
      if (daApi.length > 0) refCampo.current?.focus();
    } finally {
      trava.current = false;
      setSalvando(false);
    }
  }

  return (
    <form className="adesao-links__modelo" onSubmit={salvar} noValidate>
      <ComDica texto={DICAS.modelo}>
        <Input
          ref={refCampo}
          id={idCampo}
          rotulo="Modelo do link de vendas"
          dica={
            <>
              Use {"{slug}"} (o endereço da campanha na Rifei) e {"{codigo}"} (o
              código de afiliado de cada líder, gravado por Sincronizar com a
              Rifei) ou {"{afiliado}"} (o número do afiliado). Ex.:{" "}
              {EXEMPLO_DE_MODELO}
            </>
          }
          erro={erros.length > 0 ? erros.join(" ") : undefined}
          value={texto}
          inputMode="url"
          autoComplete="off"
          autoCapitalize="none"
          spellCheck={false}
          aria-describedby={idContagem}
          className="adesao-links__campo-modelo"
          onChange={(evento) => {
            setTexto(evento.target.value);
            setProblemasDaApi([]);
            setResultado(null);
          }}
        />
      </ComDica>
      <p id={idContagem} className="adesao-links__contagem">
        {formatarNumero(valor.length)} de{" "}
        {formatarNumero(LIMITE_CARACTERES_MODELO_LINK_VENDAS)} caracteres
      </p>
      <Previa
        novo={novo}
        problemas={problemas}
        slug={slug}
        previa={previa}
        exemplo={exemplo}
      />
      <div className="adesao-links__salvar">
        {/* Indisponível (continua focável) enquanto salva ou quando o campo é igual ao gravado. */}
        <ComDica
          texto={
            salvando
              ? DICAS.salvarModeloSalvando
              : mudou
                ? DICAS.salvarModelo
                : DICAS.salvarModeloSemMudanca
          }
        >
          <Button type="submit" aria-disabled={salvando || !mudou || undefined}>
            {salvando ? "Salvando…" : "Salvar modelo"}
          </Button>
        </ComDica>
      </div>
      {/* Região viva fixa: o resultado de salvar. */}
      <p className="visualmente-oculto" role="status">
        {resultado?.texto}
      </p>
      {resultado && (
        <Aviso tom={resultado.tom} titulo={resultado.texto} anuncio="nenhum" />
      )}
    </form>
  );
}

/** A prévia do link montado com o modelo digitado, o slug da campanha e um afiliado (D24: abrir e conferir). */
function Previa({
  novo,
  problemas,
  slug,
  previa,
  exemplo,
}: {
  novo: string | null;
  problemas: string[];
  slug: EstadoSlug;
  previa: string | null;
  exemplo: ExemploDaPrevia;
}) {
  const idTitulo = useId();
  let corpo;
  if (novo === null)
    corpo = (
      <p>
        Sem modelo, nenhuma célula tem link: os líderes veem que o link de
        vendas ainda não foi liberado.
      </p>
    );
  else if (problemas.length > 0)
    corpo = <p>A prévia aparece quando o modelo não tiver problemas.</p>;
  else if (slug.tipo === "carregando")
    corpo = <p>Carregando o endereço da campanha…</p>;
  else if (slug.tipo === "erro")
    corpo = (
      <p>
        Não foi possível ler o endereço da campanha para a prévia. Os links
        aparecem na lista abaixo depois de salvar.
      </p>
    );
  else if (slug.slug === null || previa === null)
    corpo = (
      <p>
        A campanha ainda não tem o endereço na Rifei (tela Campanha): sem ele,
        não há link para mostrar.
      </p>
    );
  else
    corpo = (
      <>
        <p>
          Com o afiliado {exemplo.affiliateId}
          {exemplo.celulaNome
            ? ` (${exemplo.celulaNome})`
            : " (um código de exemplo)"}
          :
        </p>
        <ComDica texto={DICAS.previa}>
          <a
            className="adesao-links__previa-link"
            href={previa}
            target="_blank"
            rel="noopener noreferrer"
          >
            {previa}
          </a>
        </ComDica>
        <p>
          Abra a prévia e confira, antes de salvar, que ela leva à página da
          campanha na Rifei.
        </p>
      </>
    );
  return (
    <figure className="adesao-links__previa" aria-labelledby={idTitulo}>
      <figcaption id={idTitulo} className="adesao-links__previa-titulo">
        Prévia do link
      </figcaption>
      {corpo}
    </figure>
  );
}
