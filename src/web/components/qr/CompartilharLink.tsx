import { useRef, useState, type ReactNode } from "react";
import { Button, Textarea, classesBotao } from "../ui";
import {
  TEXTO_COPIA,
  copiarTexto,
  linkWhatsAppLinkVendas,
  type ResultadoCopia,
} from "./compartilhar";
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
  /** Botões a mais na mesma linha (ex.: "Ver QR"). */
  extra?: ReactNode;
  /** Quando a célula tem mais de um código: o afiliado deste link (no nome dos botões, para o leitor de tela). */
  affiliateId?: number;
};

/** Linhas do campo: o link inteiro à mostra (sem rolar dentro do campo) num celular de 360 px, até 4 linhas. */
function linhasDoCampo(url: string): number {
  return Math.min(4, Math.max(2, Math.ceil(url.length / 32)));
}

/**
 * O link de vendas num campo só leitura (quebra a linha; seleciona tudo ao focar), com "Copiar link" (sem a área de
 * transferência, o link fica selecionado no campo) e "Enviar no WhatsApp" (a mensagem fixa da D24). Sem o `qr`.
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
        <Button
          variante={destaque ? "primario" : "secundario"}
          onClick={() => void copiar()}
        >
          Copiar link <span className="visualmente-oculto">{doLink}</span>
        </Button>
        <a
          className={classesBotao({ variante: "secundario" })}
          href={linkWhatsAppLinkVendas({ celulaNome, url, telefone })}
          target="_blank"
          rel="noopener noreferrer"
        >
          Enviar no WhatsApp{" "}
          <span className="visualmente-oculto">o link {doLink}</span>
        </a>
        {extra}
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
