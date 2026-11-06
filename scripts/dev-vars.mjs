// Leitura do .dev.vars (formato dotenv) pelos scripts de desenvolvimento.

/**
 * Valor de uma variável no conteúdo de um .dev.vars, como o dotenv lê: `NOME=valor`, com `export`
 * opcional, aspas simples, duplas ou crases, e comentário no fim (`NOME="x" # nota` → `x`;
 * `NOME=x # nota` → `x`). Sem aspas, o `#` começa um comentário. Se o nome aparece mais de uma vez,
 * vale a última linha. Ausente: undefined.
 */
export function lerVariavel(conteudo, nome) {
  let valor;
  for (const linha of conteudo.split(/\r?\n/)) {
    const par = /^\s*(?:export\s+)?([A-Za-z_]\w*)\s*=\s*(.*)$/.exec(linha);
    if (par === null || par[1] !== nome) continue;
    const entreAspas = /^(["'`])(.*?)\1/.exec(par[2]);
    valor = entreAspas ? entreAspas[2] : par[2].split("#")[0].trim();
  }
  return valor;
}
