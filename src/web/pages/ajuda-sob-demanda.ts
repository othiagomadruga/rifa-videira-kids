import { ajudasSobDemanda } from "../components/ui";

/**
 * A ajuda das telas que carregam com o site (RIFA-066): `ajuda={ajuda("hoje")}`. Os textos chegam num pedaço à parte
 * (`ajuda-das-telas.ts`), logo depois da primeira tela, e servem para todas elas.
 */
export const ajuda = ajudasSobDemanda(() => import("./ajuda-das-telas"));
