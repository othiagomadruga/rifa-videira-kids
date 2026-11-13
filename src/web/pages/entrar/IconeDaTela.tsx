import { Icone, type NomeIcone } from "../../components/ui";
import "./icone-da-tela.css";

// O ícone grande da tela, num círculo da marca (RIFA-050, A-22): no topo do cartão do /entrar e do /acesso e acima do
// título da 404 e do erro de rota. Só visual (o título diz o que é a tela).
export function IconeDaTela({ nome }: { nome: NomeIcone }) {
  return (
    <span className="icone-da-tela" aria-hidden="true">
      <Icone nome={nome} />
    </span>
  );
}
