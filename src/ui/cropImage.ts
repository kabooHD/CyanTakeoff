// Markup > Crop Image: drag the area of the selected image markup to keep.
import { useApp } from '../model/store';
import { cropRect } from '../model/cropImage';
import { pickRect } from './pickRect';

export function startCropImage() {
  const s = useApp.getState();
  const d = s.docs.find((x) => x.id === s.activeId);
  const m = d?.markups.find((x) => x.id === d.selection[0]);
  if (!d || d.selection.length !== 1 || !m || m.type !== 'image' || !m.image) { s.setStatus('Crop Image: select one image markup first.'); return; }
  const id = m.id;
  pickRect('Crop Image: drag the part of the image to keep (Esc cancels).', (docId, page, a, b) => {
    const doc = useApp.getState().docs.find((x) => x.id === docId);
    const cur = doc?.markups.find((x) => x.id === id);
    if (!cur || cur.page !== page || !cur.image) return;
    const img = new Image();
    img.onload = () => {
      const c = cropRect(cur.points, img.naturalWidth, img.naturalHeight, a, b);
      if (!c) { useApp.getState().setStatus('Crop Image: drag inside the image.'); return; }
      const canvas = document.createElement('canvas');
      canvas.width = c.sw; canvas.height = c.sh;
      canvas.getContext('2d')!.drawImage(img, c.sx, c.sy, c.sw, c.sh, 0, 0, c.sw, c.sh);
      useApp.getState().updateMarkups([id], () => ({ points: c.box, image: canvas.toDataURL('image/png') }));
      useApp.getState().setStatus('Image cropped');
    };
    img.src = cur.image;
  });
}
