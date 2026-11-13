import { useId } from "react";
import type {
  CelulaLinksVendas,
  RespostaMeusLinksVendas,
} from "../../../shared/contracts/api";
import type { Alvo } from "../../../shared/contracts/dominio";
import { CompartilharLink } from "../../components/qr/CompartilharLink";
import { QrCodeLinkVendasLazy } from "../../components/qr/QrCodeLazy";
import { VerQr } from "../../components/qr/VerQr";
import {
  Aviso,
  Card,
  EmptyState,
  ErrorState,
  Loading,
} from "../../components/ui";
import { ehFalhaDeConexao, mensagemDoErro } from "../../lib/api";
import { linksDaCelula } from "./links-vendas-api";
import { useMeusLinksVendas } from "./useMeusLinksVendas";
import "./minha-links.css";

// O link de vendas (RIFA-046, D24): a venda só conta para a célula quando é feita na Rifei pelo link de afiliado do
// líder. O líder vê o link da célula dele, com o QR code em destaque ("Seu link de vendas"); o discipulador e a rede,
// os links das células deles, com "Ver QR" num diálogo. Copiar, "Enviar no WhatsApp" e o QR (Baixar imagem e
// Imprimir). Pedido uma vez ao abrir (sem a atualização de 60 s da visão) e de novo só quando os vínculos do líder
// mudam (`vinculos`, RIFA-036). Nada de dinheiro.

/** O título do cartão, pelo tipo do alvo (o da sessão enquanto carrega). */
function tituloDoCartao(alvo: Alvo): string {
  return alvo.tipo === "celula"
    ? "Seu link de vendas"
    : "Links de vendas das suas células";
}

export function LinksDeVendas({
  alvo,
  vinculos = null,
}: {
  alvo: Alvo;
  /** `afiliados_vinculados` da visão (só do líder): mudou, os links são pedidos de novo (useMeusLinksVendas). */
  vinculos?: number | null;
}) {
  const { estado, tentarDeNovo } = useMeusLinksVendas(vinculos);
  const idTitulo = useId();
  const doAlvo = estado.tipo === "ok" ? estado.dados.alvo : alvo;

  return (
    <section className="minha-links" aria-labelledby={idTitulo}>
      <Card
        icone="link"
        titulo={<span id={idTitulo}>{tituloDoCartao(doAlvo)}</span>}
      >
        {estado.tipo === "carregando" && (
          <Loading texto="Carregando o link de vendas…" />
        )}
        {estado.tipo === "erro" && (
          <ErrorState
            titulo="Não foi possível carregar o link de vendas."
            mensagem={mensagemDoErro(estado.erro)}
            aoTentarDeNovo={tentarDeNovo}
            conexao={ehFalhaDeConexao(estado.erro)}
          />
        )}
        {estado.tipo === "desligado" && (
          <Aviso tom="alerta" titulo={estado.texto} anuncio="nenhum" />
        )}
        {estado.tipo === "sem_campanha" && (
          <EmptyState
            titulo="A campanha ainda não está ativa."
            descricao="O link de vendas aparece aqui quando a coordenação ativar a campanha."
          />
        )}
        {estado.tipo === "ok" && <Conteudo dados={estado.dados} />}
      </Card>
    </section>
  );
}

function Conteudo({ dados }: { dados: RespostaMeusLinksVendas }) {
  const lider = dados.alvo.tipo === "celula";
  if (!dados.configurado)
    return (
      <Aviso
        tom="info"
        titulo="A coordenação ainda não liberou o link de vendas."
        anuncio="nenhum"
      >
        <p>
          {lider
            ? "Enquanto isso, use o link da sua Área de afiliados na Rifei."
            : "Enquanto isso, cada líder usa o link da Área de afiliados dele na Rifei."}
        </p>
      </Aviso>
    );
  if (lider) {
    const [celula] = dados.itens;
    return celula ? <LinkDoLider celula={celula} /> : null;
  }
  if (dados.itens.length === 0)
    return (
      <EmptyState
        titulo="Ainda não há células com você."
        descricao="Os links aparecem aqui quando a coordenação cadastrar as células na hierarquia."
      />
    );
  return (
    <div className="minha-links__corpo">
      <p className="minha-links__explicacao">
        Cada compra feita na Rifei pelo link de uma célula conta para ela. Mande
        o link ou o QR code para quem for vender.
      </p>
      <ul className="minha-links__celulas">
        {dados.itens.map((celula) => (
          <li key={celula.celula_id}>
            <LinksDaCelula
              celula={celula}
              comDiscipulador={dados.alvo.tipo === "rede"}
            />
          </li>
        ))}
      </ul>
    </div>
  );
}

/** O líder: o link mais recente em destaque, com o QR code à mostra; os outros, abaixo. */
function LinkDoLider({ celula }: { celula: CelulaLinksVendas }) {
  const [principal, ...outros] = linksDaCelula(celula);
  if (!principal)
    return (
      <Aviso
        tom="alerta"
        titulo="Sua célula ainda não tem cadastro de afiliado ligado: fale com a coordenação."
        anuncio="nenhum"
      >
        <p>
          Só contam para a célula as compras feitas pelo link de afiliado ligado
          a ela.
        </p>
      </Aviso>
    );
  return (
    <div className="minha-links__corpo">
      <p className="minha-links__explicacao">
        Cada compra feita na Rifei por este link conta para a{" "}
        {celula.celula_nome}. Mande o link ou mostre o QR code para quem for
        comprar.
      </p>
      <div className="minha-links__destaque">
        <QrCodeLinkVendasLazy
          url={principal.url}
          celulaNome={celula.celula_nome}
        />
        <CompartilharLink
          url={principal.url}
          celulaNome={celula.celula_nome}
          destaque
        />
      </div>
      {outros.length > 0 && (
        <OutrosLinks
          celula={celula}
          links={outros}
          titulo="Também contam para a sua célula"
        />
      )}
    </div>
  );
}

/**
 * Discipulador e rede: cada célula num bloco compacto (o nome, o líder, o link e os botões numa linha só no
 * computador), com o link mais recente, "Ver QR" e os outros links dela.
 */
function LinksDaCelula({
  celula,
  comDiscipulador,
}: {
  celula: CelulaLinksVendas;
  comDiscipulador: boolean;
}) {
  const [principal, ...outros] = linksDaCelula(celula);
  return (
    <article className="minha-links__celula">
      <div className="minha-links__identidade">
        <h3 className="minha-links__nome">{celula.celula_nome}</h3>
        <p className="minha-links__detalhe">
          Líder: {celula.lider_nome}
          {comDiscipulador && ` · Discipulador: ${celula.discipulador_nome}`}
        </p>
      </div>
      {principal ? (
        <>
          <CompartilharLink
            url={principal.url}
            celulaNome={celula.celula_nome}
            rotulo={
              <>
                Link de vendas{" "}
                <span className="visualmente-oculto">
                  da {celula.celula_nome}
                </span>
              </>
            }
            extra={
              <VerQr url={principal.url} celulaNome={celula.celula_nome} />
            }
          />
          {outros.length > 0 && (
            <OutrosLinks
              celula={celula}
              links={outros}
              titulo="Também contam para a célula"
            />
          )}
        </>
      ) : (
        <p className="minha-links__sem-link">
          Ainda sem cadastro de afiliado ligado: o líder fala com a coordenação.
        </p>
      )}
    </article>
  );
}

/** Os outros códigos da célula (o líder tem duas contas na Rifei, a célula tem dois líderes...): todos contam. */
function OutrosLinks({
  celula,
  links,
  titulo,
}: {
  celula: CelulaLinksVendas;
  links: CelulaLinksVendas["links"];
  titulo: string;
}) {
  const idTitulo = useId();
  return (
    <div
      className="minha-links__outros"
      role="group"
      aria-labelledby={idTitulo}
    >
      <h4 id={idTitulo} className="minha-links__outros-titulo">
        {titulo}
      </h4>
      <ul className="minha-links__lista">
        {links.map((link) => (
          <li key={link.affiliate_id}>
            <CompartilharLink
              url={link.url}
              celulaNome={celula.celula_nome}
              affiliateId={link.affiliate_id}
              rotulo={
                <>
                  Link do afiliado {link.affiliate_id}{" "}
                  <span className="visualmente-oculto">
                    da {celula.celula_nome}
                  </span>
                </>
              }
              extra={
                <VerQr
                  url={link.url}
                  celulaNome={celula.celula_nome}
                  affiliateId={link.affiliate_id}
                />
              }
            />
          </li>
        ))}
      </ul>
    </div>
  );
}
