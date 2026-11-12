// RIFA-044: o zod 4, ao criar o primeiro schema de objeto, testa se pode compilar validadores com `new Function("")`
// (eval). O CSP do site (public/_headers) não permite eval, e o navegador registrava a violação no console da tela
// Campanha, mesmo com o erro engolido pelo zod. Com `jitless`, o zod nem testa e valida do jeito interpretado (o
// mesmo resultado). Precisa rodar antes de qualquer schema: é o primeiro import do pacote da Campanha
// (ConfiguracaoCampanha.tsx), o único que carrega o zod no site (o resto usa só tipos e os módulos sem zod).
import { z } from "zod";

z.config({ jitless: true });
