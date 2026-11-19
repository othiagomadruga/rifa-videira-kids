// Dicas (RIFA-045) da tela Adesão: para que serve cada botão e campo e o que acontece ao usar, em 1 ou 2 frases curtas,
// sem repetir o rótulo. A seção "Links de vendas" veio com a RIFA-046; o resto da tela, na fase 2b. Os botões do link e
// do QR code de cada célula (Copiar, WhatsApp, Ver QR, Baixar imagem, Imprimir) têm as dicas em
// components/qr/textos.ts, que a /minha também usa.

export const DICAS = {
  atualizarAgora:
    "Busca agora os afiliados e as células, sem esperar a próxima atualização automática.",

  // "Sem célula": a fila dos códigos que a Rifei mandou e ainda não têm célula.
  vincular:
    "Abre a lista das células para escolher a do líder dono deste código.",
  vincularAberto: "Fecha a escolha da célula sem vincular.",
  removerAfiliado:
    "Pede confirmação para tirar este afiliado de teste do sistema. Só dá certo se nenhum pedido dele conta.",

  // A escolha da célula (ao vincular e ao trocar).
  buscarNaEscolha:
    "Filtra as células pelo nome, pelo líder, pelo discipulador, pela rede ou pelo código de afiliado.",
  opcaoCelula:
    "Marca esta célula. Nada é gravado até você confirmar no botão abaixo.",
  confirmarSemEscolha:
    "Grava a célula escolhida para este afiliado. Marque uma célula na lista antes.",
  confirmarEscolha:
    "Grava a escolha: as vendas deste afiliado passam a contar para a célula marcada.",
  salvandoEscolha:
    "Indisponível enquanto a escolha é gravada. Espere um instante.",
  cancelarEscolha: "Fecha a escolha sem mudar nada.",

  // "Quem falta": as células sem afiliado, com o telefone do líder.
  ligar: "No celular, abre o discador com o número do líder.",
  copiarTelefone:
    "Copia o número do líder para colar onde quiser, como no WhatsApp.",

  // "Todas as células".
  buscarCelulas:
    "Filtra a lista pelo nome da célula, do líder, do discipulador, da rede ou pelo código de afiliado.",
  trocar:
    "Abre a lista das células para mudar este afiliado de célula. As vendas dele passam a contar para a nova.",
  trocarAberto: "Fecha a troca sem mudar nada.",
  desvincular:
    "Pergunta antes de tirar este afiliado da célula. Ele volta para “Sem célula”.",
  desvincularAberto: "Fecha a pergunta sem desvincular.",
  confirmarDesvinculo:
    "Tira o afiliado desta célula agora: as vendas dele deixam de contar para ela até ele ser vinculado de novo.",
  desvinculando: "Indisponível enquanto o desvínculo é gravado.",
  cancelarDesvinculo: "Fecha a pergunta sem desvincular.",
  adicionarOutroCodigo:
    "Abre o campo para ligar mais um código de afiliado a esta célula (o líder pode ter duas contas na Rifei).",
  codigoAfiliado:
    "Só os números do código de afiliado que o líder já tem na Rifei (ex.: 1043).",
  salvarCodigo:
    "Liga o código a esta célula: as vendas dele passam a contar para ela. Se ele já está em outra, pergunta antes.",
  salvandoCodigo: "Indisponível enquanto o código é gravado.",
  trocarParaEstaCelula:
    "Tira o afiliado da outra célula e liga a esta. As vendas dele passam a contar aqui.",
  cancelarTroca: "Fecha a pergunta sem trocar o afiliado de célula.",

  // A confirmação de remover o afiliado de teste (só admin).
  cancelarRemocao: "Fecha a confirmação sem remover o afiliado.",
  entendiRemocao:
    "Fecha a confirmação sem remover. Para remover, desconsidere antes os pedidos da lista.",
  confirmarRemocao:
    "Tira o afiliado do sistema, se nenhum pedido dele conta. Os pedidos desconsiderados dele ficam sem afiliado.",
  removendo: "Indisponível enquanto o afiliado é removido.",

  // Seção "Links de vendas" (RIFA-046).
  modelo: "O endereço do link de afiliado da Rifei, com {slug} e {afiliado}.",
  modeloSoLeitura: "Só o admin muda o modelo.",
  salvarModelo: "Grava o modelo; os links de todas as células mudam na hora.",
  salvarModeloSemMudanca: "Nada mudou desde o modelo gravado.",
  salvarModeloSalvando:
    "Indisponível enquanto o modelo é gravado. Espere um instante.",
  previa: "Abre o link de exemplo na Rifei para conferir.",
  buscar: "Filtra pelo nome da célula, do líder ou pelo código.",
  imprimirOsQrCodes: "Imprime uma página por célula com link.",
  imprimirOsQrCodesSemLink:
    "Indisponível: nenhuma célula tem link ainda. A célula ganha o link quando um afiliado é ligado a ela.",
} as const;

/** Com uma rede só (RIFA-065, D30), as buscas sem citar a rede (a busca ainda acha pelo nome dela). */
export const DICAS_REDE_UNICA = {
  buscarNaEscolha:
    "Filtra as células pelo nome, pelo líder, pelo discipulador ou pelo código de afiliado.",
  buscarCelulas:
    "Filtra a lista pelo nome da célula, do líder, do discipulador ou pelo código de afiliado.",
} as const;
