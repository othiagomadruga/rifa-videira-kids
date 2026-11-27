import { ComAjuda } from "../../components/ui";
import { AJUDA_NOTIFICACOES } from "./textos-notificacoes";

// RIFA-095 (D43): "Enviar notificações de venda" (`notificacoes.vendas`), no cartão do que o público vê. Desligada, o
// botão "Avisos no celular" some do ranking aberto e da /minha e nenhuma notificação sai. Da coordenação também
// (como o resto do cartão).
export const CAMPO_NOTIFICACOES = "notificacoes.vendas";

type Props = {
  ligada: boolean;
  idDoCampo: (chave: string) => string;
  aoAlterar: (ligada: boolean) => void;
};

export function OpcaoNotificacoes({ ligada, idDoCampo, aoAlterar }: Props) {
  const id = idDoCampo(CAMPO_NOTIFICACOES);
  return (
    <ComAjuda
      id={`${id}-dica`}
      texto={AJUDA_NOTIFICACOES.vendas}
      idDoTitulo={`${id}-rotulo`}
    >
      <label className="campanha-opcao" htmlFor={id}>
        <input
          id={id}
          type="checkbox"
          checked={ligada}
          aria-describedby={`${id}-dica`}
          onChange={(evento) => aoAlterar(evento.target.checked)}
        />
        <span id={`${id}-rotulo`}>Enviar notificações de venda</span>
      </label>
    </ComAjuda>
  );
}
