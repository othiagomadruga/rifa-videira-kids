import { useRef, useState, type ReactNode } from "react";
import { Button, ComDica, Icone, Textarea, classesBotao } from "../ui";
import {
  TEXTO_COPIA,
  copiarTexto,
  linkWhatsAppLinkVendas,
  numeroDoWhatsApp,
  type ResultadoCopia,
} from "./compartilhar";
import { AJUDA, DICAS } from "./textos";
import "./compartilhar.css";

type Props = {
  url: string;
  celulaNome: string;
  /** O rótulo do campo (padrão: "Link de vendas"). */
  rotulo?: ReactNode;
  /** O telefone do líder no formato do wa.me (só na coordenação); sem ele, a pessoa escolhe o contato. */
  telefone?: string | null;
  /** "Copiar link" como botão principal (o link em destaque). */
  destaque?: boolean;
  /**
   * Botões a mais na mesma linha (ex.: "Ver QR"), logo depois do "Copiar link": no celular, os dois dividem a linha e
   * o "Enviar no WhatsApp" (o nome mais longo) fica com a linha de baixo inteira.
   */
  extra?: ReactNode;
  /** Quando a célula tem mais de um código: o afiliado deste link (no nome dos botões, para o leitor de tela). */
  affiliateId?: number;
};

/** Linhas do campo: o link inteiro à mostra (sem rolar dentro do campo) num celular de 360 px, até 4 linhas. */
function linhasDoCampo(url: string): number {
  return Math.min(4, Math.max(2, Math.ceil(url.length / 32)));
}

/**
 * O link de vendas num campo só leitura com cara de bloco de leitura (fundo suave, sem a borda de campo de digitar;
 * quebra a linha; seleciona tudo ao focar), com "Copiar link" (sem a área de transferência, o link fica selecionado no
 * campo) e "Enviar no WhatsApp" (a mensagem fixa da D24), cada um com o seu ícone à esquerda (só visual: o nome do
 * botão continua o texto). Sem o `qr`.
 */
export function CompartilharLink({
  url,
  celulaNome,
  rotulo = "Link de vendas",
  telefone = null,
  destaque = false,
  extra,
  affiliateId,
}: Props) {
  const refCampo = useRef<HTMLTextAreaElement>(null);
  const [copia, setCopia] = useState<ResultadoCopia | null>(null);

  async function copiar() {
    setCopia(await copiarTexto(url, refCampo.current));
  }

  const texto = copia ? TEXTO_COPIA[copia] : "";
  const doLink = `da ${celulaNome}${affiliateId === undefined ? "" : ` (afiliado ${affiliateId})`}`;
  return (
    <div className="qr-compartilhar">
      <Textarea
        ajuda={AJUDA.campoLink}
        ref={refCampo}
        rotulo={rotulo}
        value={url}
        readOnly
        rows={linhasDoCampo(url)}
        spellCheck={false}
        autoComplete="off"
        className="qr-compartilhar__campo"
        onFocus={(evento) => evento.currentTarget.select()}
      />

      <div className="qr-compartilhar__acoes">
        <ComDica texto={DICAS.copiarLink}>
          <Button
            variante={destaque ? "primario" : "secundario"}
            onClick={() => void copiar()}
          >
            <Icone nome="copiar" />
            Copiar link <span className="visualmente-oculto">{doLink}</span>
          </Button>
        </ComDica>
        {extra}
        <ComDica
          texto={
            numeroDoWhatsApp(telefone) === ""
              ? DICAS.enviarWhatsApp
              : DICAS.enviarWhatsAppAoLider
          }
        >
          <a
            className={classesBotao({ variante: "secundario" })}
            href={linkWhatsAppLinkVendas({ celulaNome, url, telefone })}
            target="_blank"
            rel="noopener noreferrer"
          >
            <Icone nome="conversa" />
            Enviar no WhatsApp{" "}
            <span className="visualmente-oculto">o link {doLink}</span>
          </a>
        </ComDica>
      </div>
      {/* Região viva fixa (anuncia o resultado de copiar) e o mesmo texto visível. */}
      <p className="visualmente-oculto" role="status">
        {texto}
      </p>
      {copia && (
        <p className="qr-compartilhar__retorno" data-resultado={copia}>
          {texto}
        </p>
      )}
    </div>
  );
}
