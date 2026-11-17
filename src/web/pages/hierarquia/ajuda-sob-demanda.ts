import { ajudasSobDemanda } from "../../components/ui";

/** Os textos de ajuda da Hierarquia, sob demanda (RIFA-066): o pedaço de `ajuda.ts` chega logo depois da tela. */
export const ajuda = ajudasSobDemanda(() => import("./ajuda"));
