import { describe, expect, expectTypeOf, it } from 'vitest';
import expiredOrder from '../../../test/fixtures/rifei/expired_order.json';
import malformado from '../../../test/fixtures/rifei/malformado.json';
import newOrderAfiliado from '../../../test/fixtures/rifei/new_order.afiliado.json';
import newOrderMinimo from '../../../test/fixtures/rifei/new_order.minimo.json';
import paidOrderAfiliado from '../../../test/fixtures/rifei/paid_order.afiliado.json';
import paidOrderAposExpirado from '../../../test/fixtures/rifei/paid_order.apos_expirado.json';
import paidOrderOficial from '../../../test/fixtures/rifei/paid_order.oficial.json';
import paidOrderOutraCampanha from '../../../test/fixtures/rifei/paid_order.outra_campanha.json';
import { detalhesDeValidacao } from './erros';
import {
  CAMPOS_DESCARTADOS_NA_REDACAO,
  derivarTelefone,
  identificarPayloadInvalido,
  payloadRifeiRedigidoSchema,
  payloadRifeiSchema,
  reaisParaCentavos,
  redigirPayloadRifei,
  type PayloadRifei,
  type PayloadRifeiRedigido,
} from './rifei';

const FIXTURES_VALIDAS: ReadonlyArray<readonly [string, unknown]> = [
  ['paid_order.oficial', paidOrderOficial],
  ['new_order.afiliado', newOrderAfiliado],
  ['paid_order.afiliado', paidOrderAfiliado],
  ['expired_order', expiredOrder],
  ['paid_order.apos_expirado', paidOrderAposExpirado],
  ['paid_order.outra_campanha', paidOrderOutraCampanha],
  ['new_order.minimo', newOrderMinimo],
];

function errosDoPayload(corpo: unknown) {
  const resultado = payloadRifeiSchema.safeParse(corpo);
  if (resultado.success) throw new Error('o payload deveria ser rejeitado');
  return resultado.error;
}

/** Textos pessoais do payload bruto (buyer, observation, fbp, fbc) com 5+ caracteres, para busca no JSON. */
function valoresPessoais(payload: PayloadRifei): string[] {
  const { name, phone, email, document, date_of_birth, address } = payload.buyer;
  const candidatos = [
    name,
    phone,
    phone.replace('+', ''),
    email,
    document,
    date_of_birth,
    payload.observation,
    payload.fbp,
    payload.fbc,
    ...(address ? Object.values(address) : []),
  ];
  return candidatos.filter(
    (valor): valor is string => typeof valor === 'string' && valor.length >= 5,
  );
}

describe('CA1: schema do webhook da Rifei (doc oficial)', () => {
  it.each(FIXTURES_VALIDAS)('aceita a fixture válida %s', (_nome, fixture) => {
    const resultado = payloadRifeiSchema.safeParse(fixture);
    expect(resultado.error?.issues).toBeUndefined();
    expect(resultado.success).toBe(true);
  });

  it('exemplo oficial: os campos ausentes (expired_at, fbp, fbc) viram null', () => {
    for (const campo of ['expired_at', 'fbp', 'fbc']) {
      expect(paidOrderOficial).not.toHaveProperty(campo);
    }
    const payload = payloadRifeiSchema.parse(paidOrderOficial);
    expect(payload).toMatchObject({
      event: 'paid_order',
      id: 'XXXXXXXXXXX',
      slug: 'demonstracao',
      status: 'approved',
      subtotal: 2.5,
      total: 1.25,
      affiliate_id: null,
      expired_at: null,
      fbp: null,
      fbc: null,
    });
  });

  it('todo campo que a doc marca como null aceita null e também a ausência', () => {
    expect(payloadRifeiSchema.parse(newOrderMinimo)).toMatchObject({
      buyer: { email: null, document: null, date_of_birth: null, address: null },
      numbers: null,
      lucky_numbers: null,
      promotion_discount: null,
      coupon_discount: null,
      coupon_id: null,
      affiliate_id: null,
      approved_at: null,
      expired_at: null,
      observation: null,
      fbp: null,
      fbc: null,
      utm: { source: null, campaign: null, medium: null, content: null, term: null },
    });
    const tudoNulo = {
      ...paidOrderOficial,
      buyer: {
        ...paidOrderOficial.buyer,
        email: null,
        document: null,
        date_of_birth: null,
        address: null,
      },
      numbers: null,
      lucky_numbers: null,
      promotion_discount: null,
      coupon_discount: null,
      coupon_id: null,
      affiliate_id: null,
      approved_at: null,
      expired_at: null,
      observation: null,
      fbp: null,
      fbc: null,
      utm: { source: null, campaign: null, medium: null, content: null, term: null },
    };
    expect(payloadRifeiSchema.safeParse(tudoNulo).success).toBe(true);
  });

  it('tolera campos desconhecidos e os descarta', () => {
    const payload = payloadRifeiSchema.parse({
      ...paidOrderOficial,
      campo_novo_da_rifei: { qualquer: 'coisa' },
      buyer: { ...paidOrderOficial.buyer, instagram: '@ficticio' },
    });
    expect(payload).not.toHaveProperty('campo_novo_da_rifei');
    expect(payload.buyer).not.toHaveProperty('instagram');
  });

  it.each([
    ['id', null],
    ['id', ''],
    ['event', 'refunded_order'],
    ['slug', null],
    ['total', null],
    ['total', '1,25'],
    ['subtotal', -1],
    ['numbers_count', 2.5],
    ['affiliate_id', '1042'],
    ['is_rifinha', 'false'],
    ['created_at', '23/08/2024 11:28'],
    ['approved_at', '2024-08-23 12:09:29'],
    ['upsells', null],
  ])('rejeita %s = %j', (campo, valor) => {
    expect(payloadRifeiSchema.safeParse({ ...paidOrderOficial, [campo]: valor }).success).toBe(
      false,
    );
  });

  it('rejeita a fixture malformada apontando cada campo errado', () => {
    const caminhos = errosDoPayload(malformado).issues.map((problema) => problema.path.join('.'));
    expect(caminhos).toEqual(
      expect.arrayContaining([
        'event',
        'id',
        'is_rifinha',
        'numbers_count',
        'subtotal',
        'total',
        'affiliate_id',
        'created_at',
      ]),
    );
  });

  it('rejeita corpos que nem são objeto', () => {
    for (const corpo of [null, 'texto', 42, [paidOrderOficial]]) {
      expect(payloadRifeiSchema.safeParse(corpo).success).toBe(false);
    }
  });

  it('os detalhes do erro de validação não carregam nenhum dado pessoal', () => {
    const detalhes = JSON.stringify(detalhesDeValidacao(errosDoPayload(malformado)));
    const { name, phone, email, document, date_of_birth } = malformado.buyer;
    for (const valor of [name, phone, email, document, date_of_birth]) {
      expect(detalhes).not.toContain(valor);
    }
  });

  it('de um corpo inválido só aproveita os textos de event, id e slug', () => {
    expect(identificarPayloadInvalido(malformado)).toEqual({
      evento: 'order_refunded',
      pedido_id: null,
      slug: 'videira-kids-teste',
    });
    expect(identificarPayloadInvalido('não é objeto')).toEqual({
      evento: null,
      pedido_id: null,
      slug: null,
    });
    expect(identificarPayloadInvalido({ id: 'x'.repeat(500), event: 7 })).toEqual({
      evento: null,
      pedido_id: 'x'.repeat(128),
      slug: null,
    });
  });
});

describe('CA1/CA6: payload redigido (D1)', () => {
  it('o tipo redigido não contém campos pessoais', () => {
    expectTypeOf<PayloadRifeiRedigido>().not.toHaveProperty('buyer');
    expectTypeOf<PayloadRifeiRedigido>().not.toHaveProperty('observation');
    expectTypeOf<PayloadRifeiRedigido>().not.toHaveProperty('fbp');
    expectTypeOf<PayloadRifeiRedigido>().not.toHaveProperty('fbc');
    expectTypeOf<PayloadRifeiRedigido['comprador']>().toEqualTypeOf<{
      ddd: string | null;
      pais: string | null;
    }>();

    const chaves = Object.keys(payloadRifeiRedigidoSchema.shape);
    for (const campo of CAMPOS_DESCARTADOS_NA_REDACAO) {
      expect(chaves).not.toContain(campo.split('.')[0]);
    }
    expect(Object.keys(payloadRifeiRedigidoSchema.shape.comprador.shape).sort()).toEqual([
      'ddd',
      'pais',
    ]);
  });

  it.each(FIXTURES_VALIDAS)(
    'redige %s: passa no schema estrito e não sobra nenhum valor pessoal',
    (_nome, fixture) => {
      const bruto = payloadRifeiSchema.parse(fixture);
      const redigido = redigirPayloadRifei(bruto);
      expect(payloadRifeiRedigidoSchema.parse(redigido)).toEqual(redigido);

      const json = JSON.stringify(redigido);
      const pessoais = valoresPessoais(bruto);
      expect(pessoais.length).toBeGreaterThan(0);
      for (const valor of pessoais) {
        expect(json).not.toContain(valor);
      }
      expect(redigido.comprador).toEqual(derivarTelefone(bruto.buyer.phone));
    },
  );

  it('o schema redigido recusa qualquer campo a mais', () => {
    const redigido = redigirPayloadRifei(payloadRifeiSchema.parse(paidOrderOficial));
    expect(
      payloadRifeiRedigidoSchema.safeParse({ ...redigido, buyer: paidOrderOficial.buyer }).success,
    ).toBe(false);
    expect(
      payloadRifeiRedigidoSchema.safeParse({ ...redigido, observation: 'texto' }).success,
    ).toBe(false);
    expect(
      payloadRifeiRedigidoSchema.safeParse({
        ...redigido,
        comprador: { ...redigido.comprador, phone: paidOrderOficial.buyer.phone },
      }).success,
    ).toBe(false);
  });

  it('guarda do comprador só DDD e país: exemplo oficial e fixtures', () => {
    const comprador = (fixture: unknown) =>
      redigirPayloadRifei(payloadRifeiSchema.parse(fixture)).comprador;
    expect(comprador(paidOrderOficial)).toEqual({ ddd: '99', pais: '55' });
    expect(comprador(newOrderAfiliado)).toEqual({ ddd: '91', pais: '55' });
    expect(comprador(expiredOrder)).toEqual({ ddd: null, pais: '351' });
  });

  it.each([
    ['+5591988887777', { ddd: '91', pais: '55' }],
    ['+55 (91) 98888-7777', { ddd: '91', pais: '55' }],
    ['+559133334444', { ddd: '91', pais: '55' }],
    ['+5501988887777', { ddd: null, pais: '55' }],
    ['+55919888', { ddd: null, pais: '55' }],
    ['+351910000002', { ddd: null, pais: '351' }],
    ['+12025550123', { ddd: null, pais: '1' }],
    ['+447911123456', { ddd: null, pais: '44' }],
    ['91988887777', { ddd: null, pais: null }],
    ['', { ddd: null, pais: null }],
    ['sem telefone', { ddd: null, pais: null }],
  ])('deriva DDD e país de %j', (telefone, esperado) => {
    expect(derivarTelefone(telefone)).toEqual(esperado);
  });

  it.each([
    [1.25, 125],
    [2.5, 250],
    [60, 6000],
    [19.99, 1999],
    [0.1 + 0.2, 30],
    [0, 0],
  ])('D2: R$ %d vira %d centavos', (reais, centavos) => {
    expect(reaisParaCentavos(reais)).toBe(centavos);
  });
});
