import { Icone } from "./Icone";
import type { NomeIcone } from "./icones";
import "./IconeDaTela.css";

// O ícone grande da tela, num círculo da marca (RIFA-050, A-22): no topo do cartão do /entrar e do /acesso e, pelo
// `icone` do PageHeader, ao lado do título da 404 e do erro de rota (RIFA-053). Só visual (o título diz o que é a
// tela).
export function IconeDaTela({ nome }: { nome: NomeIcone }) {
  return (
    <span className="ui-icone-da-tela" aria-hidden="true">
      <Icone nome={nome} />
    </span>
  );
}
