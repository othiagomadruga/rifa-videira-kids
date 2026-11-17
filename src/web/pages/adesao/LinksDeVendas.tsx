// A seção "Links de vendas" da Adesão (RIFA-046, D24), num pacote à parte (`lazy`, com o próprio CSS): o modelo do
// link (o admin edita; a coordenação vê só leitura) e o link e o QR code de cada célula, para mandar ao líder
// (Copiar, WhatsApp para o telefone dele) ou imprimir ("Imprimir os QR codes" de todas as células com link).
//
// A lista é pedida ao abrir e de novo só quando os vínculos mudam (um afiliado ligado ou desligado de uma célula
// nesta tela ou em outra, que o painel da Adesão traz a cada 15 s): sem cache e sem consulta a cada 15 s.
import { useEffect, useId, useMemo, useState } from "react";
import { eLinkDeVendas } from "../../../shared/contracts/link-vendas";
import { CompartilharLink } from "../../components/qr/CompartilharLink";
import { VerQr } from "../../components/qr/VerQr";
import { useImpressaoQr } from "../../components/qr/QrCodeLinkVendas";
import {
  Aviso,
  Button,
  Card,
  ComAjuda,
  ComDica,
  EmptyState,
  ErrorState,
  Input,
  Loading,
} from "../../components/ui";
import { ehFalhaDeConexao, ErroApi, mensagemDoErro } from "../../lib/api";
import { useUsuarioConectado } from "../../lib/sessao";
import { telefoneParaWhatsApp } from "../acessos/textos";
import type { CelulaAdesao } from "./adesao-api";
import { normalizar, quantidade } from "./formatos";
import {
  carregarLinks,
  salvarModelo,
  type RespostaLinksVendas,
} from "./links-vendas-api";
import {
  AFILIADO_DE_EXEMPLO,
  ModeloLinkVendas,
  type ExemploDaPrevia,
} from "./ModeloLinkVendas";
import { DICAS } from "./textos";
import "./links-vendas.css";
import { ajuda } from "../ajuda-sob-demanda";

type CelulaComLinks = RespostaLinksVendas["itens"][number];

type Estado =
  | { tipo: "carregando" }
  | { tipo: "erro"; erro: unknown }
  | { tipo: "sem_campanha" }
  /** `falha`: a última consulta (depois de um vínculo) falhou e a lista é a anterior. */
  | { tipo: "ok"; dados: RespostaLinksVendas; falha: unknown };

/** Os vínculos das células (célula → afiliados): quando mudam, os links mudam. */
function chaveDosVinculos(celulas: CelulaAdesao[]): string {
  return celulas
    .map((celula) => `${celula.celula_id}:${celula.afiliados.join(",")}`)
    .join("|");
}

/** Os links que a tela mostra: só os `https://rifei.com.br/...` (a segunda trava, depois do schema da API). */
function linksValidos(celula: CelulaComLinks): CelulaComLinks["links"] {
  return celula.links.filter((link) => eLinkDeVendas(link.url));
}

function ehSemCampanha(erro: unknown): boolean {
  return (
    erro instanceof ErroApi &&
    erro.status === 404 &&
    erro.codigo === "nao_encontrado"
  );
}

export function LinksDeVendas({ celulas }: { celulas: CelulaAdesao[] }) {
  const admin = useUsuarioConectado().papel === "admin";
  const [estado, setEstado] = useState<Estado>({ tipo: "carregando" });
  const [rodada, setRodada] = useState(0);
  const idTitulo = useId();
  const vinculos = chaveDosVinculos(celulas);

  useEffect(() => {
    const controle = new AbortController();
    carregarLinks({ signal: controle.signal }).then(
      (dados) => {
        if (!controle.signal.aborted)
          setEstado({ tipo: "ok", dados, falha: null });
      },
      (erro: unknown) => {
        if (controle.signal.aborted) return;
        setEstado((anterior) =>
          anterior.tipo === "ok"
            ? { ...anterior, falha: erro }
            : ehSemCampanha(erro)
              ? { tipo: "sem_campanha" }
              : { tipo: "erro", erro },
        );
      },
    );
    return () => controle.abort();
  }, [vinculos, rodada]);

  // O telefone do líder (já no formato do wa.me) e o afiliado da prévia vêm do painel da Adesão.
  const telefones = useMemo(
    () =>
      new Map(
        celulas.map((celula) => [
          celula.celula_id,
          telefoneParaWhatsApp(celula.lider_telefone),
        ]),
      ),
    [celulas],
  );
  const comAfiliado = celulas.find((celula) => celula.afiliados.length > 0);
  const exemplo: ExemploDaPrevia = comAfiliado
    ? {
        affiliateId: comAfiliado.afiliados[0],
        celulaNome: comAfiliado.celula_nome,
      }
    : { affiliateId: AFILIADO_DE_EXEMPLO, celulaNome: null };

  async function aoSalvar(modelo: string | null) {
    const dados = await salvarModelo(modelo);
    setEstado({ tipo: "ok", dados, falha: null });
  }

  return (
    <section aria-labelledby={idTitulo}>
      <Card
        titulo={<span id={idTitulo}>Links de vendas</span>}
        ajuda={ajuda("linksDeVendas")}
      >
        <div className="adesao-links">
          <p className="adesao-links__explicacao">
            A venda conta para a célula quando é feita na Rifei pelo link de
            afiliado do líder. Aqui fica o link de cada célula, com o QR code,
            para mandar ao líder ou imprimir.
          </p>
          {estado.tipo === "carregando" && (
            <Loading texto="Carregando os links de vendas…" />
          )}
          {estado.tipo === "erro" && (
            <ErrorState
              titulo="Não foi possível carregar os links de vendas."
              mensagem={mensagemDoErro(estado.erro)}
              conexao={ehFalhaDeConexao(estado.erro)}
              aoTentarDeNovo={() => {
                setEstado({ tipo: "carregando" });
                setRodada((n) => n + 1);
              }}
            />
          )}
          {estado.tipo === "sem_campanha" && (
            <EmptyState
              titulo="A campanha ainda não foi configurada."
              descricao="O link de vendas sai do endereço da campanha na Rifei (tela Campanha)."
            />
          )}
          {estado.tipo === "ok" && (
            <>
              <ModeloLinkVendas
                modelo={estado.dados.modelo}
                admin={admin}
                exemplo={exemplo}
                aoSalvar={aoSalvar}
              />
              {estado.falha !== null && (
                <p className="adesao-links__falha" role="status">
                  Não foi possível atualizar os links agora:{" "}
                  {mensagemDoErro(estado.falha)}
                </p>
              )}
              <LinksDasCelulas
                dados={estado.dados}
                admin={admin}
                telefones={telefones}
              />
            </>
          )}
        </div>
      </Card>
    </section>
  );
}

function LinksDasCelulas({
  dados,
  admin,
  telefones,
}: {
  dados: RespostaLinksVendas;
  admin: boolean;
  telefones: Map<number, string | null>;
}) {
  const [busca, setBusca] = useState("");
  const { imprimir, folhas } = useImpressaoQr();
  const idTitulo = useId();

  if (!dados.configurado)
    return (
      <Aviso
        tom="alerta"
        titulo="Os links de vendas ainda não foram liberados."
        anuncio="nenhum"
      >
        <p>
          {admin
            ? "Falta o modelo do link: preencha-o acima depois de confirmar com a Rifei o formato do link de afiliado."
            : "Falta o modelo do link, que só o admin preenche, depois de confirmar com a Rifei o formato do link de afiliado."}{" "}
          Enquanto isso, os líderes veem que o link ainda não foi liberado.
        </p>
      </Aviso>
    );

  const paraImprimir = dados.itens.flatMap((celula) => {
    const [principal] = linksValidos(celula);
    return principal
      ? [{ celulaNome: celula.celula_nome, url: principal.url }]
      : [];
  });
  const termos = normalizar(busca).split(/\s+/).filter(Boolean);
  const filtradas = dados.itens.filter((celula) => {
    const texto = normalizar(
      `${celula.celula_nome} ${celula.lider_nome} ${celula.discipulador_nome} ${celula.rede_nome}`,
    );
    const codigos = celula.links.map((link) => String(link.affiliate_id));
    return termos.every(
      (termo) => texto.includes(termo) || codigos.includes(termo),
    );
  });

  return (
    <div
      className="adesao-links__celulas"
      role="group"
      aria-labelledby={idTitulo}
    >
      <div className="adesao-links__cabecalho">
        <ComAjuda texto={ajuda("linkDeCadaCelula")} idDoTitulo={idTitulo}>
          <h3 id={idTitulo} className="adesao-links__subtitulo">
            Link de cada célula
          </h3>
        </ComAjuda>
        <ComDica
          texto={
            paraImprimir.length > 0
              ? DICAS.imprimirOsQrCodes
              : DICAS.imprimirOsQrCodesSemLink
          }
        >
          <Button
            variante="secundario"
            aria-disabled={paraImprimir.length === 0 || undefined}
            onClick={() => {
              if (paraImprimir.length > 0) imprimir(paraImprimir);
            }}
          >
            Imprimir os QR codes ({paraImprimir.length})
          </Button>
        </ComDica>
      </div>
      <p className="adesao-links__nota">
        Uma página por célula com link: o QR code, o nome da célula e o link em
        texto.
      </p>
      <Input
        ajuda={ajuda("buscarLinks")}
        rotulo="Buscar nos links: célula, líder ou código"
        type="search"
        autoComplete="off"
        value={busca}
        onChange={(evento) => setBusca(evento.target.value)}
      />

      <p className="adesao-contagem">
        {termos.length > 0
          ? `${quantidade(filtradas.length, "célula encontrada", "células encontradas")} de ${dados.itens.length}`
          : quantidade(dados.itens.length, "célula", "células")}
      </p>
      {filtradas.length === 0 ? (
        <EmptyState titulo="Nenhuma célula encontrada." />
      ) : (
        <ul className="adesao-links__lista">
          {filtradas.map((celula) => (
            <li key={celula.celula_id}>
              <LinkDaCelula
                celula={celula}
                telefone={telefones.get(celula.celula_id) ?? null}
              />
            </li>
          ))}
        </ul>
      )}
      {folhas}
    </div>
  );
}

function LinkDaCelula({
  celula,
  telefone,
}: {
  celula: CelulaComLinks;
  telefone: string | null;
}) {
  const [principal, ...outros] = linksValidos(celula);
  return (
    <article className="adesao-links__celula">
      <h4 className="adesao-links__nome">{celula.celula_nome}</h4>
      <p className="adesao-item__detalhe">
        Líder: {celula.lider_nome} · {celula.rede_nome}
      </p>
      {principal ? (
        [principal, ...outros].map((link, indice) => (
          <CompartilharLink
            key={link.affiliate_id}
            url={link.url}
            celulaNome={celula.celula_nome}
            telefone={telefone}
            affiliateId={outros.length > 0 ? link.affiliate_id : undefined}
            rotulo={
              <>
                {indice === 0 ? "Link de vendas" : "Também conta para a célula"}{" "}
                (afiliado {link.affiliate_id}){" "}
                <span className="visualmente-oculto">
                  da {celula.celula_nome}
                </span>
              </>
            }
            extra={
              <VerQr
                url={link.url}
                celulaNome={celula.celula_nome}
                affiliateId={outros.length > 0 ? link.affiliate_id : undefined}
              />
            }
          />
        ))
      ) : (
        <p className="adesao-links__sem-link">
          Sem link: a célula ainda não tem afiliado ligado.
        </p>
      )}
    </article>
  );
}
