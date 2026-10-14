import { describe, expect, it } from 'vitest';
import { addTemplate, uniqueTemplateName, type PdfTemplate } from '../src/model/templates';

const t = (name: string): PdfTemplate => ({ id: name, name, pages: 1, size: 10, created: '', bytes: new Uint8Array() });

describe('PDF templates', () => {
  it('keeps names unique and lists newest first', () => {
    expect(uniqueTemplateName([t('Sheet')], 'Sheet')).toBe('Sheet (2)');
    expect(uniqueTemplateName([t('Sheet'), t('Sheet (2)')], 'Sheet')).toBe('Sheet (3)');
    const l = addTemplate(addTemplate([], t('A')), t('A'));
    expect(l.map((x) => x.name)).toEqual(['A (2)', 'A']);
  });
});
