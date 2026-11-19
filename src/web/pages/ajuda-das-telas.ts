// Os textos de ajuda das telas que carregam junto com o site (RIFA-066, D31), num pedaço só que vem sob demanda
// (`ajuda-sob-demanda.ts`), logo depois da primeira tela: o JS inicial não leva os textos, e um `import()` só (em
// vez de um por tela) pesa menos nele. Cada tela escreve os dela no próprio `ajuda.ts`; as chaves não se repetem
// entre as telas (`ajuda-das-telas.test.ts` confere). As telas `lazy` deixam os textos no `textos.ts` delas.
import { AJUDA as ACESSOS } from "./acessos/ajuda";
import { AJUDA as ADESAO } from "./adesao/ajuda";
import { AJUDA as BUMBO } from "./bumbo/ajuda";
import { AJUDA as HIERARQUIA } from "./hierarquia/ajuda";
import { AJUDA as MINHA_SENHA } from "./minha-senha/ajuda";
import { AJUDA as RANKINGS } from "./rankings/ajuda";
import { AJUDA as VISAO_GERAL } from "./visao-geral/ajuda";

/** Todas as telas juntas: as chaves de cada uma não se repetem nas outras. */
export const AJUDA_DAS_TELAS = [
  VISAO_GERAL,
  HIERARQUIA,
  ADESAO,
  RANKINGS,
  BUMBO,
  ACESSOS,
  MINHA_SENHA,
] as const;

export const AJUDA = {
  ...VISAO_GERAL,
  ...HIERARQUIA,
  ...ADESAO,
  ...RANKINGS,
  ...BUMBO,
  ...ACESSOS,
  ...MINHA_SENHA,
};
