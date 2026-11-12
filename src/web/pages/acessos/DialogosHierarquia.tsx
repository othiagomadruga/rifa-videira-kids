import { useEffect, useRef, useState } from "react";
import type {
  ItemAcessoHierarquia,
  LinkGeradoHierarquia,
  PapelHierarquia,
} from "../../../shared/contracts";
import {
  Aviso,
  Button,
  ComDica,
  Dialogo,
  Textarea,
  classesBotao,
} from "../../components/ui";
import { formatarData } from "../../lib/formatadores";
import { gerarLinksHierarquia } from "./acessos-api";
import { ehAcaoDesligada, type Mensagens } from "./regras";
import {
  DICAS,
  RESPONSAVEL_DO_ALVO,
  ehEmUso,
  ehNaoEncontrado,
  linkWhatsAppDoNumero,
  mensagemAoGerarLinks,
  mensagemHierarquia,
  motivoSemWhatsApp,
  telefoneParaWhatsApp,
} from "./textos";
import "./acessos-hierarquia.css";

// ---------------------------------------------------------------------------------------------------
// Trocar acesso: revoga os links válidos do alvo (o aparelho antigo sai) e gera um link novo
// ---------------------------------------------------------------------------------------------------

export function DialogoTrocarAcesso({
  papel,
  item,
  aoFechar,
  aoConcluir,
  aoDesatualizar,
  aoDesligada,
}: {
  papel: PapelHierarquia;
  item: ItemAcessoHierarquia;
  aoFechar: () => void;
  /** Trocou: quem abriu fecha este diálogo e mostra o link novo (uma vez só). */
  aoConcluir: (gerados: LinkGeradoHierarquia[]) => void;
  /** A lista está velha (404/409): recarregue. */
  aoDesatualizar: () => void;
  /** 409 `acao_desligada`: o acesso do papel foi desligado na Campanha. */
  aoDesligada?: () => void;
}) {
  const [trocando, setTrocando] = useState(false);
  const [erro, setErro] = useState<string | null>(null);
  // Trava síncrona contra toque duplo (o estado só muda no próximo render).
  const emAndamento = useRef(false);
  const quem = item.pessoa_nome ?? RESPONSAVEL_DO_ALVO[papel];

  async function confirmar() {
    if (emAndamento.current) return;
    emAndamento.current = true;
    setTrocando(true);
    setErro(null);
    try {
      aoConcluir(await gerarLinksHierarquia(papel, [item.alvo.id], true));
    } catch (falha) {
      setErro(mensagemAoGerarLinks(falha, papel));
      if (ehNaoEncontrado(falha) || ehEmUso(falha)) aoDesatualizar();
      if (ehAcaoDesligada(falha)) aoDesligada?.();
    } finally {
      emAndamento.current = false;
      setTrocando(false);
    }
  }

  return (
    <Dialogo
      aberto
      papel="alertdialog"
      titulo={`Trocar o acesso de ${item.alvo.nome}?`}
      descricao={`Um link novo é gerado para ${quem}.`}
      aoFechar={() => {
        if (!trocando) aoFechar();
      }}
      rodape={
        <>
          <ComDica texto={DICAS.cancelarTrocar}>
            <Button variante="secundario" onClick={aoFechar}>
              Cancelar
            </Button>
          </ComDica>
          <ComDica texto={DICAS.confirmarTrocar}>
            <Button
              variante="perigo"
              disabled={trocando}
              onClick={() => void confirmar()}
            >
              {trocando ? "Trocando…" : "Trocar acesso"}
            </Button>
          </ComDica>
        </>
      }
    >
      <div className="acessos-formulario">
        <p>
          Os links anteriores param de funcionar e o aparelho antigo sai do
          sistema: quem entrou com eles precisa do link novo para entrar de
          novo. Use quando a pessoa responsável mudou ou o link foi parar em
          outras mãos.
        </p>
        {erro && (
          <Aviso tom="perigo" titulo="Não foi possível trocar o acesso">
            <p>{erro}</p>
          </Aviso>
        )}
      </div>
    </Dialogo>
  );
}

// ---------------------------------------------------------------------------------------------------
// Links gerados: aparecem uma vez só, cada um com "Copiar mensagem" e "Abrir no WhatsApp"
// ---------------------------------------------------------------------------------------------------

type Copia = "nada" | "copiada" | "falhou";

/**
 * Os links gerados (no lote, num "Novo link" ou num "Trocar acesso"). Fechar (Esc, × ou "Pronto") com algum
 * link que ainda não foi copiado nem aberto no WhatsApp pede confirmação: depois de fechar, ele não aparece
 * de novo.
 */
export function DialogoLinksGerados({
  itens,
  mensagens,
  aoFechar,
}: {
  itens: LinkGeradoHierarquia[];
  /** Os modelos da campanha (D20, RIFA-032): a mensagem de cada link sai do modelo do tipo de alvo. */
  mensagens?: Mensagens;
  aoFechar: () => void;
}) {
  const [anuncio, setAnuncio] = useState("");
  /** Links já mandados: copiados com sucesso ou abertos no WhatsApp (pelo id do link). */
  const [entregues, setEntregues] = useState<ReadonlySet<number>>(
    () => new Set(),
  );
  const [confirmando, setConfirmando] = useState(false);
  const [primeiro] = itens;
  const pendentes = itens.filter((item) => !entregues.has(item.link.id));
  const titulo =
    itens.length === 1 && primeiro
      ? `Link de acesso: ${primeiro.alvo.nome}`
      : `${itens.length} links de acesso gerados`;

  function pedirParaFechar() {
    if (pendentes.length === 0) aoFechar();
    else setConfirmando(true);
  }

  function marcarEntregue(linkId: number) {
    setEntregues((atuais) =>
      atuais.has(linkId) ? atuais : new Set(atuais).add(linkId),
    );
  }

  return (
    <Dialogo
      aberto
      titulo={titulo}
      descricao="Estes links só aparecem agora: mande cada um antes de fechar."
      aoFechar={pedirParaFechar}
      dicaFechar={DICAS.prontoLinks}
      rodape={
        <ComDica texto={DICAS.prontoLinks}>
          <Button variante="secundario" onClick={pedirParaFechar}>
            Pronto
          </Button>
        </ComDica>
      }
    >
      <div className="acessos-link-criado">
        <Aviso
          tom="alerta"
          titulo={
            itens.length === 1
              ? "Este link só aparece agora."
              : "Estes links só aparecem agora."
          }
          anuncio="nenhum"
        >
          <p>
            Depois de fechar, só gerando outro. Cada link é pessoal: mande só
            para a pessoa indicada, porque quem tiver o link entra como ela.
            {primeiro && ` Vale até ${formatarData(primeiro.link.expira_em)}.`}
          </p>
        </Aviso>
        {/* role="list": com list-style none, o Safari deixaria de anunciar a lista. */}
        <ul className="acessos-gerados" role="list" aria-label="Links gerados">
          {itens.map((item) => (
            <LinkGerado
              key={item.link.id}
              item={item}
              mensagens={mensagens}
              aoCopiar={(copia, destinatario) => {
                if (copia === "copiada") marcarEntregue(item.link.id);
                setAnuncio(
                  copia === "copiada"
                    ? `Mensagem para ${destinatario} copiada.`
                    : `Não deu para copiar sozinho a mensagem para ${destinatario}: ela ficou selecionada no campo.`,
                );
              }}
              aoAbrirWhatsApp={() => marcarEntregue(item.link.id)}
            />
          ))}
        </ul>
        {/* Região viva fixa: anuncia o resultado de cada "Copiar mensagem". */}
        <p className="visualmente-oculto" role="status">
          {anuncio}
        </p>
      </div>
      {confirmando && (
        <Dialogo
          aberto
          papel="alertdialog"
          titulo="Fechar sem mandar todos os links?"
          descricao={
            pendentes.length === 1
              ? "1 link ainda não foi copiado nem aberto no WhatsApp."
              : `${pendentes.length} links ainda não foram copiados nem abertos no WhatsApp.`
          }
          aoFechar={() => setConfirmando(false)}
          dicaFechar={DICAS.voltarAosLinks}
          rodape={
            <>
              <ComDica texto={DICAS.voltarAosLinks}>
                <Button
                  variante="secundario"
                  onClick={() => setConfirmando(false)}
                >
                  Voltar aos links
                </Button>
              </ComDica>
              {/* Os dois diálogos saem juntos: a trava da rolagem do Dialogo é contada entre eles. */}
              <ComDica texto={DICAS.fecharMesmoAssim}>
                <Button
                  variante="perigo"
                  onClick={() => {
                    setConfirmando(false);
                    aoFechar();
                  }}
                >
                  Fechar mesmo assim
                </Button>
              </ComDica>
            </>
          }
        >
          <div className="acessos-formulario">
            <p>
              Depois de fechar,{" "}
              {pendentes.length === 1 ? "este link" : "estes links"} não{" "}
              {pendentes.length === 1 ? "aparece" : "aparecem"} de novo. Para
              mandar depois, só gerando outro, com &quot;Novo link&quot; na
              linha de cada um:
            </p>
            <ul className="acessos-pendentes">
              {pendentes.map((item) => (
                <li key={item.link.id}>
                  {item.alvo.nome}
                  {item.pessoa_nome && ` (${item.pessoa_nome})`}
                </li>
              ))}
            </ul>
          </div>
        </Dialogo>
      )}
    </Dialogo>
  );
}

function LinkGerado({
  item,
  mensagens,
  aoCopiar,
  aoAbrirWhatsApp,
}: {
  item: LinkGeradoHierarquia;
  mensagens?: Mensagens;
  aoCopiar: (copia: Exclude<Copia, "nada">, destinatario: string) => void;
  /** O admin abriu a conversa do WhatsApp com a mensagem pronta (conta como mandado). */
  aoAbrirWhatsApp: () => void;
}) {
  const [copia, setCopia] = useState<Copia>("nada");
  const refDetalhes = useRef<HTMLDetailsElement>(null);
  const refCampo = useRef<HTMLTextAreaElement>(null);
  const destinatario = item.pessoa_nome ?? item.alvo.nome;
  const mensagem = mensagemHierarquia(
    { alvo: item.alvo, pessoaNome: item.pessoa_nome, url: item.link.url },
    mensagens,
  );
  const numero = telefoneParaWhatsApp(item.telefone);

  // Sem a área de transferência: a mensagem aparece selecionada no campo, para copiar pelo menu do celular.
  useEffect(() => {
    if (copia !== "falhou") return;
    refCampo.current?.focus();
    refCampo.current?.select();
  }, [copia]);

  async function copiar() {
    try {
      await navigator.clipboard.writeText(mensagem);
      setCopia("copiada");
      aoCopiar("copiada", destinatario);
    } catch {
      if (refDetalhes.current) refDetalhes.current.open = true;
      setCopia("falhou");
      aoCopiar("falhou", destinatario);
    }
  }

  return (
    <li className="acessos-gerado">
      <h3 className="acessos-gerado__alvo">{item.alvo.nome}</h3>
      <p className="acessos-suave">
        {item.pessoa_nome
          ? `Para ${item.pessoa_nome}`
          : "Sem responsável na hierarquia"}
        {item.telefone && ` · ${item.telefone}`}
      </p>
      {numero === null && (
        <p className="acessos-suave">{motivoSemWhatsApp(item.telefone)}</p>
      )}
      <div className="acessos-link-acoes">
        <ComDica texto={DICAS.copiarMensagem}>
          <Button onClick={() => void copiar()}>
            Copiar mensagem{" "}
            <span className="visualmente-oculto">para {destinatario}</span>
          </Button>
        </ComDica>
        {numero !== null && (
          <ComDica texto={DICAS.abrirNoWhatsApp}>
            <a
              className={classesBotao({ variante: "secundario" })}
              href={linkWhatsAppDoNumero(numero, mensagem)}
              target="_blank"
              rel="noopener noreferrer"
              onClick={aoAbrirWhatsApp}
              onAuxClick={(evento) => {
                // Só o botão do meio abre o link (numa aba nova); o direito só abre o menu do navegador.
                if (evento.button === 1) aoAbrirWhatsApp();
              }}
            >
              Abrir no WhatsApp{" "}
              <span className="visualmente-oculto">de {destinatario}</span>
            </a>
          </ComDica>
        )}
      </div>
      {copia !== "nada" && (
        <p className="acessos-copia">
          {copia === "copiada"
            ? "Mensagem copiada."
            : "Não deu para copiar sozinho: a mensagem ficou selecionada no campo abaixo. Copie pelo menu do celular."}
        </p>
      )}
      <details ref={refDetalhes} className="acessos-gerado__mensagem">
        <ComDica texto={DICAS.verAMensagem}>
          <summary>
            Ver a mensagem{" "}
            <span className="visualmente-oculto">para {destinatario}</span>
          </summary>
        </ComDica>
        <ComDica texto={DICAS.campoMensagem}>
          <Textarea
            ref={refCampo}
            rotulo={`Mensagem para ${destinatario}`}
            value={mensagem}
            readOnly
            rows={6}
            className="acessos-url"
            onFocus={(evento) => evento.currentTarget.select()}
          />
        </ComDica>
      </details>
    </li>
  );
}
