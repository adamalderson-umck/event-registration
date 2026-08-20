import { describe, expect, it } from 'vitest';
import { getValidatedTithelyGivingUrl } from './tithely.ts';

const FORM_ID = '11111111-1111-4111-8111-111111111111';

describe('getValidatedTithelyGivingUrl', () => {
  it('returns the canonical URL only when URL and embed IDs match', () => {
    const url = `https://give.tithe.ly/?formId=${FORM_ID}`;
    expect(getValidatedTithelyGivingUrl({
      tithely_giving_url: url,
      tithely_embed_config: { formId: FORM_ID },
    })).toBe(url);
  });

  it.each([
    {},
    {
      tithely_giving_url: 'https://evil.example/pay',
      tithely_embed_config: { formId: FORM_ID },
    },
    {
      tithely_giving_url: `https://give.tithe.ly/?formId=${FORM_ID}`,
      tithely_embed_config: { formId: '22222222-2222-4222-8222-222222222222' },
    },
  ])('rejects unsafe or inconsistent configuration', (configuration) => {
    expect(getValidatedTithelyGivingUrl(configuration)).toBeNull();
  });
});
