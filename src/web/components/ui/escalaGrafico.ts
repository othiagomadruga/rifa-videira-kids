// Escalas dos gráficos (sem React): marcas "redondas" no eixo Y e quais pontos do eixo X ganham rótulo.

/**
 * Marcas do eixo Y de 0 até um valor redondo que cobre `maximo`, com passo 1, 2 ou 5 × 10^n (inteiro, no
 * mínimo 1) e cerca de `quantidadeAlvo` intervalos: 360 → 0, 100, 200, 300, 400; 139 → 0, 50, 100, 150.
 * Sem dados (máximo 0), o eixo vai de 0 a 1.
 */
export function marcasDoEixoY(maximo: number, quantidadeAlvo = 4): number[] {
  const topo = Number.isFinite(maximo) && maximo > 0 ? maximo : 1;
  const bruto = topo / quantidadeAlvo;
  const potencia = 10 ** Math.floor(Math.log10(bruto));
  const passo = Math.max(
    1,
    [1, 2, 5].map((fator) => fator * potencia).find((p) => p >= bruto) ??
      10 * potencia,
  );
  const ultimo = Math.ceil(topo / passo) * passo;
  const marcas: number[] = [];
  for (let valor = 0; valor <= ultimo; valor += passo) marcas.push(valor);
  return marcas;
}

/** Folga mínima (px) entre dois rótulos vizinhos do eixo X. */
const FOLGA_ENTRE_ROTULOS = 12;

/**
 * Índices dos pontos do eixo X que ganham rótulo: o primeiro, a cada passo regular e sempre o último, sem
 * que dois se encostem. O primeiro rótulo é alinhado pelo início e o último pelo fim (para caberem no
 * gráfico), então a distância até o vizinho deles é a maior: 1,5 × a largura do rótulo, mais a folga.
 */
export function indicesDoEixoX(
  total: number,
  larguraUtil: number,
  larguraRotulo = 40,
): number[] {
  if (total <= 0) return [];
  if (total === 1) return [0];
  const ultimo = total - 1;
  const pxPorPonto = larguraUtil / ultimo;
  const distanciaNaPonta = larguraRotulo * 1.5 + FOLGA_ENTRE_ROTULOS;
  const passo = Math.max(1, Math.ceil(distanciaNaPonta / pxPorPonto));
  const indices: number[] = [];
  for (let indice = 0; indice < ultimo; indice += passo) indices.push(indice);
  // O último sempre aparece; os de antes saem se ficarem perto demais dele.
  while (
    indices.length > 1 &&
    (ultimo - indices[indices.length - 1]) * pxPorPonto < distanciaNaPonta
  ) {
    indices.pop();
  }
  indices.push(ultimo);
  return indices;
}
