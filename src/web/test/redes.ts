// Apoio dos testes (RIFA-065, D30): a lista das redes (GET /api/admin/redes, ROTAS.listarRedes) como a API devolve,
// para as telas que não recebem a hierarquia e perguntam quantas redes ela tem (Rankings, Campanha e Acessos). As API
// falsas dessas telas respondem por aqui (com duas redes, se o teste não disser outra coisa: a tela como sempre foi) e
// guardam o pedido à parte, sem misturar com as chamadas que os testes de antes conferem.
import { respostaListaRedesSchema, type Rede } from "../../shared/contracts";
import { CAMINHO_REDES } from "../lib/redes";
import { respostaJson } from "./renderizar";

/** Os nomes das redes fictícias, na ordem dos ids (1, 2, ...). */
const NOMES = ["Rede Jovem Ficticia", "Rede Adulta Ficticia"];

/** `quantidade` redes fictícias (ids 1, 2, ...), como a lista da API. */
export function redesDeTeste(quantidade: number): Rede[] {
  return Array.from({ length: quantidade }, (_, indice) => ({
    id: indice + 1,
    nome: NOMES[indice] ?? `Rede Ficticia ${indice + 1}`,
    divisao: indice % 2 === 0 ? "jovens" : "adultos",
    responsavel_nome: null,
    criado_em: "2026-11-06T18:00:00.000Z",
    atualizado_em: "2026-11-06T18:00:00.000Z",
  }));
}

/** A resposta de GET /api/admin/redes com `quantidade` redes (passa pelo schema do contrato). */
export function respostaRedes(quantidade: number): Response {
  return respostaJson(
    respostaListaRedesSchema.parse({ itens: redesDeTeste(quantidade) }),
  );
}

/** A chamada é a lista das redes (GET, com ou sem consulta)? */
export function ehListaDasRedes(caminho: string, metodo = "GET"): boolean {
  return (
    metodo === "GET" &&
    new URL(caminho, "http://localhost").pathname === CAMINHO_REDES
  );
}
