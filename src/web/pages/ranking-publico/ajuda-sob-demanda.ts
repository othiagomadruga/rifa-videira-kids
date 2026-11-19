import { ajudasSobDemanda } from "../../components/ui";

/**
 * A ajuda das telas abertas (RIFA-066): `ajuda={ajudaAberta("ranking")}`. Os textos chegam num pedaço à parte
 * (`ajuda.ts`), logo depois da tela. Separado da ajuda das telas da coordenação: as telas abertas não levam nada dela.
 */
export const ajudaAberta = ajudasSobDemanda(() => import("./ajuda"));
