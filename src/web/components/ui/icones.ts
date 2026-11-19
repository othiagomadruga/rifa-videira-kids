// Desenhos dos ícones do site (RIFA-049, D25): só dados. Cada um é o `d` de um <path> numa grade de 24×24, desenhado
// com traço de 2 em currentColor, pontas e cantos redondos (o Icone.tsx põe o resto). Desenhos próprios: nada de
// biblioteca, de fonte de ícones nem de logo de terceiros (a "conversa" é um balão genérico, não o logo do WhatsApp).
// Um ponto é um traço de comprimento quase zero ("h.01"): a ponta redonda o desenha. O Icone.test.tsx confere que cada
// `d` só tem comandos e números.

const CHAVE = "M8 16a4 4 0 1 0 0-8 4 4 0 0 0 0 8zM12 12h9M17 12v3.5M20.5 12v3";

export const ICONES = {
  // Menu da coordenação (uma por tela de pages/coordenacao/telas.ts).
  "visao-geral": "M4 4h6v7H4zM14 4h6v4h-6zM14 12h6v8h-6zM4 15h6v5H4z",
  campanha: "M4 9h3l8-4v14l-8-4H4zM18.5 9a4 4 0 0 1 0 6M7.5 15v5h3v-3.5",
  hierarquia: "M9.5 3h5v4h-5zM3 17h5v4H3zM16 17h5v4h-5zM12 7v5M5.5 17v-5h13v5",
  adesao:
    "M9 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8zM3 21v-1a6 6 0 0 1 9.5-4.9M15 17l2 2 4-4",
  pedidos: "M6 3h12v18l-3-2-3 2-3-2-3 2zM9 8h6M9 12h6M9 16h3",
  // Um bilhete com o picote no meio (RIFA-075: tela Bilhetes).
  bilhetes:
    "M3 7a1 1 0 0 1 1-1h16a1 1 0 0 1 1 1v3a2 2 0 0 0 0 4v3a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1v-3a2 2 0 0 0 0-4zM14 6v2M14 11v2M14 16v2",
  suspeito:
    "M10.3 4.2 2.6 18a2 2 0 0 0 1.7 3h15.4a2 2 0 0 0 1.7-3L13.7 4.2a2 2 0 0 0-3.4 0zM12 9v4M12 17h.01",
  ranking: "M3 20h18M4.5 20v-7h4.5v7M9.5 20V6h5v14M15 20v-4.5h4.5V20",
  mapa: "M12 21s-7-6.2-7-11.5a7 7 0 0 1 14 0C19 14.8 12 21 12 21zM12 12a2.5 2.5 0 1 0 0-5 2.5 2.5 0 0 0 0 5z",
  bumbo:
    "M4 10c0 1.7 3.6 3 8 3s8-1.3 8-3-3.6-3-8-3-8 1.3-8 3zM4 10v6c0 1.7 3.6 3 8 3s8-1.3 8-3v-6M8 3l3 5M16 3l-3 5",
  conferencia:
    "M9 4H6a1 1 0 0 0-1 1v15a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1V5a1 1 0 0 0-1-1h-3M9 3h6v3H9zM8.5 13.5 11 16l4.5-4.5",
  acessos: CHAVE,
  trilha: "M3 12a9 9 0 1 0 2.6-6.4M3 3.5V8h4.5M12 7.5V12l3 2",
  // Ações.
  copiar:
    "M9 9h10a1 1 0 0 1 1 1v10a1 1 0 0 1-1 1H9a1 1 0 0 1-1-1V10a1 1 0 0 1 1-1zM5 15H4a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1h10a1 1 0 0 1 1 1v1",
  conversa:
    "M21 11.5a8.5 8.5 0 0 1-12.4 7.6L3 21l1.9-5.6A8.5 8.5 0 1 1 21 11.5zM8.5 11.5h.01M12.5 11.5h.01M16.5 11.5h.01",
  qr: "M4 4h6v6H4zM14 4h6v6h-6zM4 14h6v6H4zM14 14h3v3h-3zM20 14v.01M14 20v.01M17 20h3v-3",
  baixar: "M12 4v11M7 10l5 5 5-5M5 20h14",
  imprimir:
    "M7 9V3h10v6M7 18H5a2 2 0 0 1-2-2v-5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2v5a2 2 0 0 1-2 2h-2M7 14h10v7H7z",
  atualizar:
    "M20 11a8 8 0 0 0-14.9-3.6M4 3.5V8h4.5M4 13a8 8 0 0 0 14.9 3.6M20 20.5V16h-4.5",
  sair: "M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4M16 17l5-5-5-5M21 12H9",
  link: "M10 14a4.5 4.5 0 0 0 6.4 0l3-3a4.5 4.5 0 0 0-6.4-6.4l-1 1M14 10a4.5 4.5 0 0 0-6.4 0l-3 3a4.5 4.5 0 0 0 6.4 6.4l1-1",
  menu: "M4 6h16M4 12h16M4 18h16",
  fechar: "M6 6l12 12M18 6 6 18",
  // Situação (dentro de um círculo: no Aviso, no IndicadorSituacao e nos estados).
  check: "M5 12.5 9.5 17 19 7.5",
  alerta: "M12 5v9M12 19h.01",
  info: "M12 11v8M12 5h.01",
  menos: "M6 12h12",
  subiu: "M12 19V5M5.5 11.5 12 5l6.5 6.5",
  caiu: "M12 5v14M5.5 12.5 12 19l6.5-6.5",
  estavel: "M5 12h14M12.5 5.5 19 12l-6.5 6.5",
  trofeu:
    "M7 3h10v6a5 5 0 0 1-10 0zM7 5H4v2a4 4 0 0 0 3.5 4M17 5h3v2a4 4 0 0 1-3.5 4M12 14v3.5M9.5 17.5h5L15.5 21h-7z",
  "sem-conexao":
    "M2 8.8a15 15 0 0 1 4.2-2.6M10.7 5a15 15 0 0 1 11.3 3.8M5 12.6a10 10 0 0 1 5.2-2.5M14 10.2a10 10 0 0 1 5 2.4M8.5 16.2a5 5 0 0 1 7 0M12 20h.01M3 3l18 18",
  // Para as telas abertas (P2) e a /minha (P3).
  chave: CHAVE,
  bussola: "M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18zM15.5 8.5l-2 5-5 2 2-5z",
  pessoas:
    "M15.5 20v-1a4 4 0 0 0-4-4h-4a4 4 0 0 0-4 4v1M9.5 11a3.5 3.5 0 1 0 0-7 3.5 3.5 0 0 0 0 7zM20.5 20v-1a4 4 0 0 0-3-3.9M15.5 4.2a3.5 3.5 0 0 1 0 6.6",
  calendario:
    "M5 5h14a1 1 0 0 1 1 1v14a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V6a1 1 0 0 1 1-1zM4 10h16M8 3v4M16 3v4",
  // Acabamento (RIFA-053): para não repetir um ícone com outro sentido.
  // A célula: uma casa (a célula se reúne numa casa); "pessoas" fica para gente.
  celula:
    "M4 10.5 12 4l8 6.5V20a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1zM9.5 21v-5.5h5V21",
  // Abrir (o chevron para baixo de um <details>; gira para cima quando aberto).
  abrir: "M6 9l6 6 6-6",
  // A curva: os eixos e a linha de tendência subindo.
  grafico: "M4 4v15a1 1 0 0 0 1 1h15M7.5 15.5l4-4.5 3 3L20 8M15.5 8H20v4.5",
  // Um documento: a folha com o canto dobrado e as linhas (o "pedidos" é o recibo, com o pé serrilhado).
  documento:
    "M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8zM14 3v5h5M9 13h6M9 17h6M9 9h1.5",
  // Um período (semana): o calendário com o intervalo marcado.
  periodo:
    "M5 5h14a1 1 0 0 1 1 1v14a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V6a1 1 0 0 1 1-1zM4 10h16M8 3v4M16 3v4M8 15.5h8M8 14v3M16 14v3",
  // Ajuda (RIFA-066): o ponto de interrogação num círculo, ao lado de títulos e rótulos (o "info" é o "i" dos avisos).
  ajuda:
    "M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18zM9.5 9.5a2.5 2.5 0 1 1 3.4 2.3c-.6.3-.9.8-.9 1.4v.6M12 17h.01",
} as const satisfies Record<string, string>;

/** O nome de um ícone (ex.: "copiar"): a chave de ICONES. */
export type NomeIcone = keyof typeof ICONES;

/** Todos os nomes, na ordem de ICONES. */
export const NOMES_ICONES = Object.keys(ICONES) as NomeIcone[];

/** O texto é o nome de um ícone? (para props que aceitam também um caractere, como o `icone` do IndicadorSituacao) */
export function ehNomeDeIcone(nome: string): nome is NomeIcone {
  return Object.hasOwn(ICONES, nome);
}
