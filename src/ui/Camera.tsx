// Camera (Revu, Ctrl+Alt+I): take a photo with the device camera and place
// it on the drawing as an image markup (site photos on a tablet). Without
// camera access, the phone's camera or a photo file is used instead.
import { useEffect, useRef, useState } from 'react';
import { create } from 'zustand';
import { useApp } from '../model/store';
import { loadImage } from './toolActions';
import { attachCapture, shrinkPhoto } from './Capture';

export const useCamera = create<{ open: boolean; forMarkup?: string }>(() => ({ open: false }));
/** Right-click > Capture > From Camera: the photo is attached to the markup. */
export const openCameraFor = (forMarkup: string) => useCamera.setState({ open: true, forMarkup });

/** Place a photo: the next click on the drawing puts it there. */
function place(url: string, w: number, h: number) {
  const k = Math.min(1, 240 / Math.max(w, h));
  useApp.setState({ pendingImage: { url, w: w * k, h: h * k, subject: 'Camera' } });
  useApp.getState().setTool('image');
  useApp.getState().setStatus('Click on the drawing to place the photo.');
}

async function fromFile(forMarkup?: string) {
  const input = Object.assign(document.createElement('input'), { type: 'file', accept: 'image/*' });
  input.setAttribute('capture', 'environment');
  const f = await new Promise<File | null>((resolve) => { input.onchange = () => resolve(input.files?.[0] ?? null); input.oncancel = () => resolve(null); input.click(); });
  const file = f ?? null;
  if (!file) return;
  if (forMarkup) { attachCapture(forMarkup, await shrinkPhoto(file)); return; }
  const img = await loadImage(file);
  place(img.url, img.w, img.h);
}

export function CameraDialog() {
  const open = useCamera((x) => x.open);
  return open ? <CameraView /> : null;
}

function CameraView() {
  const video = useRef<HTMLVideoElement>(null);
  const [error, setError] = useState('');
  const [ready, setReady] = useState(false);
  const close = () => useCamera.setState({ open: false, forMarkup: undefined });
  useEffect(() => {
    let stream: MediaStream | null = null;
    let alive = true;
    (async () => {
      try {
        if (!navigator.mediaDevices?.getUserMedia) throw new Error('no camera API');
        stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'environment' }, audio: false });
        if (!alive) { stream.getTracks().forEach((t) => t.stop()); return; }
        if (video.current) { video.current.srcObject = stream; await video.current.play().catch(() => {}); setReady(true); }
      } catch { setError('No camera is available, or access was refused. You can choose a photo instead.'); }
    })();
    return () => { alive = false; stream?.getTracks().forEach((t) => t.stop()); };
  }, []);
  const capture = () => {
    const v = video.current;
    if (!v || !v.videoWidth) return;
    const c = document.createElement('canvas');
    c.width = v.videoWidth; c.height = v.videoHeight;
    c.getContext('2d')!.drawImage(v, 0, 0);
    const url = c.toDataURL('image/jpeg', 0.85);
    const forMarkup = useCamera.getState().forMarkup;
    close();
    if (forMarkup) attachCapture(forMarkup, { name: 'camera.jpg', data: url });
    else place(url, c.width, c.height);
  };
  return (
    <div className="modal-backdrop" onPointerDown={(e) => e.target === e.currentTarget && close()}>
      <div className="modal" role="dialog" aria-label="Camera" onKeyDown={(e) => { e.stopPropagation(); if (e.key === 'Escape') close(); }}>
        <div className="modal-title">Camera</div>
        <div className="scale-dialog">
          {error ? <p className="muted">{error}</p> : <video ref={video} className="camera-video" playsInline muted />}
          <div className="modal-actions">
            <button onClick={() => { const f = useCamera.getState().forMarkup; close(); fromFile(f); }}>Choose Photo…</button>
            <span className="spacer" />
            <button className="primary" disabled={!ready} onClick={capture}>Take Photo</button>
            <button onClick={close}>Cancel</button>
          </div>
        </div>
      </div>
    </div>
  );
}
