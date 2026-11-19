// RIFA-076 (D36): o telefone do comprador na tela Pedidos (só admin). Cópias de formatarTelefoneBr e numeroWhatsApp de
// src/shared/contracts/compradores.ts (o contrato entra no site só por tipos), conferidas por pedidos-contrato.test.ts.

/** "+5511987654321" → "(11) 98765-4321"; fora do Brasil, o E.164 como veio. */
export function telefoneLegivel(telefone: string): string {
  const brasil = /^\+55([1-9]{2})(\d{4,5})(\d{4})$/.exec(telefone);
  return brasil ? `(${brasil[1]}) ${brasil[2]}-${brasil[3]}` : telefone;
}

/** O número do link `https://wa.me/<numero>` (só algarismos, com o país); null se curto demais. */
export function numeroDoWhatsApp(telefone: string): string | null {
  const digitos = telefone.replace(/\D/g, "");
  return digitos.length >= 8 ? digitos : null;
}
