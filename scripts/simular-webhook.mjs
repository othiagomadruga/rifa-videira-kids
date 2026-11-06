// Simula a Rifei: envia uma fixture ao webhook do `npm run dev` com o token do .dev.vars.
//
// Uso: node scripts/simular-webhook.mjs <fixture.json> [url]
//      npm run webhook:simular -- <fixture.json> [url]
// URL padrão: http://localhost:5173/api/webhooks/rifei
// O arquivo vai como está (um JSON inválido também), e a saída é o status e o corpo da resposta.
// Sai com código 1 se a resposta não for 2xx e 2 se faltar argumento, arquivo ou token.
// Passo a passo: docs/integracao-rifei.md, seção "Como testar localmente".
import { readFile } from "node:fs/promises";
import { lerVariavel } from "./dev-vars.mjs";

const URL_PADRAO = "http://localhost:5173/api/webhooks/rifei";
const DEV_VARS = new URL("../.dev.vars", import.meta.url);
const NOME_DO_SEGREDO = "RIFEI_WEBHOOK_TOKEN";

function sair(mensagem) {
  console.error(mensagem);
  process.exit(2);
}

const [arquivo, url = URL_PADRAO] = process.argv.slice(2);
if (!arquivo) {
  sair("Uso: node scripts/simular-webhook.mjs <fixture.json> [url]");
}

const devVars = await readFile(DEV_VARS, "utf8").catch(() =>
  sair("Não achei o .dev.vars: copie o .dev.vars.example e troque o token."),
);
const token = lerVariavel(devVars, NOME_DO_SEGREDO);
if (!token) sair(`${NOME_DO_SEGREDO} está vazio ou ausente no .dev.vars.`);

const corpo = await readFile(arquivo, "utf8").catch(() =>
  sair(`Não consegui ler ${arquivo}.`),
);

let resposta;
try {
  resposta = await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${token}`,
    },
    body: corpo,
  });
} catch (erro) {
  console.error(
    `Sem resposta de ${url} (${erro.cause?.code ?? erro.message}). O npm run dev está rodando?`,
  );
  process.exit(1);
}

const texto = await resposta.text();
console.log(`HTTP ${resposta.status} ${resposta.statusText}`);
try {
  console.log(JSON.stringify(JSON.parse(texto), null, 2));
} catch {
  console.log(texto);
}
process.exitCode = resposta.ok ? 0 : 1;
