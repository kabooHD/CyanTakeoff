import { describe, expect, it } from 'vitest';
import { captureFiles, dataUrlBytes, isJpeg, legendsOf } from '../src/model/captureExport';
import type { Markup } from '../src/model/types';

const mk = (id: string, extra: Partial<Markup>): Markup => ({
  id, type: 'rectangle', page: 0, points: [{ x: 0, y: 0 }, { x: 10, y: 10 }], subject: 'Door', label: '', comment: '', author: 'A', created: '', modified: '', status: 'None',
  style: { color: '#FF0000', fill: null, opacity: 1, fillOpacity: 1, width: 1, lineStyle: 'solid', fontSize: 10 }, ...extra,
} as Markup);
const jpg = 'data:image/jpeg;base64,/9j/4AAQ';

describe('capture export', () => {
  it('decodes data URLs and tells JPEG from PNG', () => {
    expect([...dataUrlBytes(jpg).slice(0, 2)]).toEqual([0xff, 0xd8]);
    expect(isJpeg(dataUrlBytes(jpg))).toBe(true);
    expect(isJpeg(new Uint8Array([0x89, 0x50]))).toBe(false);
  });
  it('lists every photo with a unique, safe file name', () => {
    const ms = [mk('a', { capture: [{ name: 'Door.jpg', data: jpg }, { name: 'Door.jpg', data: jpg }] }), mk('b', { capture: [{ name: 'site/photo:1.jpg', data: jpg }] }), mk('c', {})];
    const files = captureFiles(ms);
    expect(files.map((f) => f.name)).toEqual(['Door.jpg', 'Door (1).jpg', 'site_photo_1.jpg']);
    expect(files[1].markup.id).toBe('a');
    expect(files[1].index).toBe(1);
  });
  it('names the legends a markup is listed in', () => {
    const door = mk('d', {});
    const other = mk('o', { subject: 'Window' });
    const legend = mk('l', { type: 'legend', page: 0, legend: { title: 'Openings', keys: ['rectangle|Door|#ff0000'], source: 'page', showQuantity: true, showMeasurement: false } });
    const legend2 = mk('l2', { type: 'legend', page: 3, legend: { title: 'All doors', keys: ['rectangle|Door|#ff0000'], source: 'all', showQuantity: true, showMeasurement: false } });
    const all = [door, other, legend, legend2];
    expect(legendsOf(door, all)).toBe('Openings, All doors');
    expect(legendsOf(other, all)).toBe('');
    expect(legendsOf(legend, all)).toBe('Openings');
  });
});
