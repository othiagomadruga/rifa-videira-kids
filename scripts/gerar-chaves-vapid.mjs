#!/usr/bin/env node
// Gera o par de chaves VAPID das notificações de venda (Web Push, RIFA-095, docs/decisions.md D43; roteiro em
// docs/lancamento.md, 3.9). Só o Node, sem dependência e sem rede.
//
//   node scripts/gerar-chaves-vapid.mjs --privada <arquivo-novo>
//
// - A chave PÚBLICA (P-256 sem compressão, base64url, 87 caracteres) sai no terminal: vai no wrangler.jsonc,
//   `vars.VAPID_PUBLIC_KEY` (não é segredo: todo navegador que se inscreve a recebe).
// - A chave PRIVADA (o `d`, base64url, 43 caracteres) vai só para o arquivo pedido, criado com permissão 600 (só o
//   dono lê) e nunca por cima de um que já existe. Ela NUNCA sai no terminal nem vai para o repositório: grave com
//   `npx wrangler secret put VAPID_PRIVATE_KEY < <arquivo>` e apague o arquivo.
// Trocar o par depois faz os aparelhos inscritos pararem de receber até ativarem de novo (o navegador guarda a pública).
import { writeFileSync } from "node:fs";
import { webcrypto } from "node:crypto";
import { fileURLToPath } from "node:url";

/** Um par novo: { publica, privada } em base64url. */
export async function gerarChavesVapid() {
  const par = await webcrypto.subtle.generateKey(
    { name: "ECDSA", namedCurve: "P-256" },
    true,
    ["sign", "verify"],
  );
  const publica = Buffer.from(
    await webcrypto.subtle.exportKey("raw", par.publicKey),
  ).toString("base64url");
  const { d } = await webcrypto.subtle.exportKey("jwk", par.privateKey);
  return { publica, privada: d };
}

/** Grava a privada (sem quebra de linha) num arquivo NOVO, com permissão 600. */
export function gravarChavePrivada(arquivo, privada) {
  writeFileSync(arquivo, privada, { mode: 0o600, flag: "wx" });
}

/** O arquivo da opção --privada, ou null. */
export function lerArquivoDaPrivada(argumentos) {
  const indice = argumentos.indexOf("--privada");
  const arquivo = indice === -1 ? undefined : argumentos[indice + 1];
  return arquivo && !arquivo.startsWith("--") ? arquivo : null;
}

export async function principal(argumentos, saida = console.log) {
  const arquivo = lerArquivoDaPrivada(argumentos);
  if (arquivo === null) {
    throw new Error(
      "Use: node scripts/gerar-chaves-vapid.mjs --privada <arquivo-novo> (a chave privada só vai para o arquivo).",
    );
  }
  const { publica, privada } = await gerarChavesVapid();
  gravarChavePrivada(arquivo, privada);
  saida(`VAPID_PUBLIC_KEY (wrangler.jsonc, vars): ${publica}`);
  saida(
    `Chave privada gravada em ${arquivo} (permissão 600). Grave como segredo e apague o arquivo:\n` +
      `  npx wrangler secret put VAPID_PRIVATE_KEY < ${arquivo}\n  rm ${arquivo}`,
  );
  return { publica };
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  principal(process.argv.slice(2)).catch((erro) => {
    console.error(erro.message);
    process.exitCode = 1;
  });
}
