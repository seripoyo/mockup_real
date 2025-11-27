import React, { useMemo, useState, useEffect, useLayoutEffect, useRef } from 'react';
import type { AspectRatio, FrameMeta, ScreenRectPct } from '../types/frame';
import { frames } from '../data/frames';
import { containSize, coverSize } from '../utils/fit';
import DebugButton from '../../../components/DebugButton';

function aspectToCss(aspect: AspectRatio) {
  switch (aspect) {
    case '9:16':
      return '9 / 16';
    case '16:9':
      return '16 / 9';
    case '1:1':
    default:
      return '1 / 1';
  }
}

function isWhitePixel(r: number, g: number, b: number, a: number) {
  // tolerant white detection: bright and opaque
  const thr = 240; // whiteness threshold
  return a > 200 && r >= thr && g >= thr && b >= thr;
}

function findNearestWhite(x: number, y: number, data: Uint8ClampedArray, w: number, h: number, maxR = 6) {
  // If clicked directly on white, return immediately
  let idx = (y * w + x) * 4;
  if (isWhitePixel(data[idx], data[idx + 1], data[idx + 2], data[idx + 3])) return { x, y };
  // Expand search in a diamond neighborhood up to maxR
  for (let r = 1; r <= maxR; r++) {
    for (let dy = -r; dy <= r; dy++) {
      const dx = r - Math.abs(dy);
      const tryPoints = [
        { px: x - dx, py: y + dy },
        { px: x + dx, py: y + dy },
      ];
      for (const { px, py } of tryPoints) {
        if (px < 0 || py < 0 || px >= w || py >= h) continue;
        const i = (py * w + px) * 4;
        if (isWhitePixel(data[i], data[i + 1], data[i + 2], data[i + 3])) {
          return { x: px, y: py };
        }
      }
    }
  }
  return null;
}

export default function MinimalMockup() {
  const [selectedFrame, setSelectedFrame] = useState<FrameMeta | null>(null);
  const [aspect, setAspect] = useState<AspectRatio>('9:16');
  const [imageUrl, setImageUrl] = useState<string | null>(null);
  const [imageKey, setImageKey] = useState<number>(0);
  const [fitMode, setFitMode] = useState<'contain' | 'cover'>('cover');
  const [showOverlay, setShowOverlay] = useState<boolean>(false);
  const [frameNatural, setFrameNatural] = useState<{ w: number; h: number } | null>(null);
  const [containerSize, setContainerSize] = useState<{ w: number; h: number }>({ w: 800, h: 800 });
  const [fillEnabled, setFillEnabled] = useState<boolean>(true);
  const [customRectPct, setCustomRectPct] = useState<ScreenRectPct | null>(null);
  const [maskDataUrl, setMaskDataUrl] = useState<string | null>(null);
  const [hardMaskUrl, setHardMaskUrl] = useState<string | null>(null);
  const [darkOverlayUrl, setDarkOverlayUrl] = useState<string | null>(null);
  const [compositeUrl, setCompositeUrl] = useState<string | null>(null);
  const [feather, setFeather] = useState<number>(2); // px blur
  const [imageNatural, setImageNatural] = useState<{ w: number; h: number } | null>(null);
  const [editedFrameUrl, setEditedFrameUrl] = useState<string | null>(null);
  const [isEditingFrame, setIsEditingFrame] = useState<boolean>(false);
  const fillColor = '#e5c4be';

  const containerRef = useRef<HTMLDivElement>(null);
  const debugLogRef = useRef<string[]>([]);

  const frameUrl = useMemo(() => (selectedFrame ? (editedFrameUrl ?? selectedFrame.frameImage) : null), [selectedFrame, editedFrameUrl]);

  // Canvas refs for white-fill feature
  const offscreenCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const offscreenImageDataRef = useRef<ImageData | null>(null);
  const overlayCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const lastMaskRef = useRef<{ rx: number; ry: number; rw: number; rh: number; mask: Uint8Array } | null>(null);

  // measure container actual size based on aspect rule
  useLayoutEffect(() => {
    const update = () => {
      if (!containerRef.current) return;
      const w = Math.min(window.innerWidth * 0.9, 800);
      const [a, b] = aspect.split(':').map(Number);
      const h = w * (b / a);
      setContainerSize({ w, h });
      debugLogRef.current.push(`container-size: ${w}x${h}`);
    };
    update();
    window.addEventListener('resize', update);
    return () => window.removeEventListener('resize', update);
  }, [aspect]);

  // cleanup object URL
  useEffect(() => {
    return () => {
      if (imageUrl) URL.revokeObjectURL(imageUrl);
    };
  }, [imageUrl]);

  const onFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const url = URL.createObjectURL(file);
    if (imageUrl) URL.revokeObjectURL(imageUrl);
    setImageUrl(url);
    // measure natural size
    const probe = new Image();
    probe.onload = () => {
      setImageNatural({ w: probe.naturalWidth, h: probe.naturalHeight });
      debugLogRef.current.push(`upload-natural: ${probe.naturalWidth}x${probe.naturalHeight}`);
    };
    probe.src = url;
    setImageKey((k) => k + 1);
    // allow reselecting the same file to trigger change next time
    e.target.value = '';
    debugLogRef.current.push('image-changed');
  };

  const aspectCss = useMemo(() => aspectToCss(aspect), [aspect]);

  const activeRect = useMemo(() => {
    if (customRectPct) return customRectPct;
    if (!selectedFrame) return null;
    return selectedFrame.screenRect ?? { xPct: 0.1, yPct: 0.1, wPct: 0.8, hPct: 0.8 };
  }, [customRectPct, selectedFrame]);

  // Build offscreen canvas and overlay canvas when frame is ready
  useEffect(() => {
    if (!selectedFrame || !frameNatural || !frameUrl) return;

    // Prepare offscreen canvas with natural size
    const off = document.createElement('canvas');
    off.width = frameNatural.w;
    off.height = frameNatural.h;
    const offctx = off.getContext('2d');
    if (!offctx) return;

    const img = new Image();
    img.crossOrigin = 'anonymous'; // same-origin but keep safe
    img.src = frameUrl;
    img.onload = () => {
      offctx.drawImage(img, 0, 0, frameNatural.w, frameNatural.h);
      const imgData = offctx.getImageData(0, 0, frameNatural.w, frameNatural.h);
      offscreenCanvasRef.current = off;
      offscreenImageDataRef.current = imgData;
      debugLogRef.current.push('offscreen-ready');
      // reset previous mask when frame changes
      setMaskDataUrl(null);
      setHardMaskUrl(null);
      setDarkOverlayUrl(null);
      setCompositeUrl(null);
      lastMaskRef.current = null;
    };

    // Prepare overlay canvas pixel size = natural size
    const overlay = overlayCanvasRef.current;
    if (overlay) {
      overlay.width = frameNatural.w;
      overlay.height = frameNatural.h;
      const ctx = overlay.getContext('2d');
      if (ctx) {
        ctx.clearRect(0, 0, overlay.width, overlay.height);
      }
    }
  }, [selectedFrame, frameNatural, frameUrl]);

  const drawMaskIntoOverlay = (rx: number, ry: number, rw: number, rh: number, mask: Uint8Array) => {
    const overlay = overlayCanvasRef.current;
    if (!overlay) return;
    const octx = overlay.getContext('2d');
    if (!octx) return;
    const img = octx.getImageData(rx, ry, rw, rh);
    const d = img.data;
    for (let j = 0; j < rh; j++) {
      for (let i = 0; i < rw; i++) {
        const m = mask[j * rw + i];
        if (m) {
          const p = (j * rw + i) * 4;
          d[p] = 0xE5;     // R
          d[p + 1] = 0xC4; // G
          d[p + 2] = 0xBE; // B
          d[p + 3] = 0xFF; // A
        }
      }
    }
    octx.putImageData(img, rx, ry);
  };

  const maskToDataUrl = (mask: Uint8Array, rw: number, rh: number, featherPx: number) => {
    const mCan = document.createElement('canvas');
    mCan.width = rw; mCan.height = rh;
    const mctx = mCan.getContext('2d');
    if (!mctx) return null;
    const mImg = mctx.createImageData(rw, rh);
    const md = mImg.data;
    for (let j = 0; j < rh; j++) {
      for (let i = 0; i < rw; i++) {
        const k = j * rw + i;
        const p = k * 4;
        const v = mask[k] ? 255 : 0;
        md[p] = v; md[p+1] = v; md[p+2] = v; md[p+3] = 255;
      }
    }
    mctx.putImageData(mImg, 0, 0);
    if (featherPx > 0) {
      const bCan = document.createElement('canvas');
      bCan.width = rw; bCan.height = rh;
      const bctx = bCan.getContext('2d');
      if (!bctx) return mCan.toDataURL('image/png');
      bctx.filter = `blur(${featherPx}px)`;
      bctx.drawImage(mCan, 0, 0);
      return bCan.toDataURL('image/png');
    }
    return mCan.toDataURL('image/png');
  };

  // Handle click on overlay canvas to select area and fit image
  const onOverlayClick = (e: React.MouseEvent<HTMLCanvasElement>) => {
    const overlay = overlayCanvasRef.current;
    const imgData = offscreenImageDataRef.current;
    if (!overlay || !imgData) return;

    const rect = overlay.getBoundingClientRect();
    const sx = overlay.width / rect.width;
    const sy = overlay.height / rect.height;
    let x = Math.floor((e.clientX - rect.left) * sx);
    let y = Math.floor((e.clientY - rect.top) * sy);

    const w = imgData.width;
    const h = imgData.height;
    const data = imgData.data;

    // Seed on nearest white so clicking on text still works
    const seed = findNearestWhite(x, y, data, w, h, 6);
    if (!seed) {
      debugLogRef.current.push(`no-white-nearby @${x},${y}`);
      return;
    }
    x = seed.x; y = seed.y;

    // BFS flood fill on white pixels to get base region
    const visited = new Uint8Array(w * h);
    const stack: number[] = [y * w + x];
    visited[y * w + x] = 1;

    let minX = x, minY = y, maxX = x, maxY = y;

    while (stack.length) {
      const p = stack.pop() as number;
      const py = Math.floor(p / w);
      const px = p % w;
      if (px < minX) minX = px;
      if (px > maxX) maxX = px;
      if (py < minY) minY = py;
      if (py > maxY) maxY = py;

      const tryPush = (nx: number, ny: number) => {
        if (nx < 0 || ny < 0 || nx >= w || ny >= h) return;
        const pos = ny * w + nx;
        if (visited[pos]) return;
        const i = pos * 4;
        const r = data[i], g = data[i + 1], b = data[i + 2], a = data[i + 3];
        if (isWhitePixel(r, g, b, a)) {
          visited[pos] = 1;
          stack.push(pos);
        }
      };

      tryPush(px - 1, py);
      tryPush(px + 1, py);
      tryPush(px, py - 1);
      tryPush(px, py + 1);
    }

    // Define bounding rect
    const rx = minX;
    const ry = minY;
    const rw = Math.max(1, maxX - minX + 1);
    const rh = Math.max(1, maxY - minY + 1);

    // Build base mask within rect (1 = part of selected region)
    const baseMask = new Uint8Array(rw * rh);
    for (let j = 0; j < rh; j++) {
      for (let i = 0; i < rw; i++) {
        const pos = (ry + j) * w + (rx + i);
        baseMask[j * rw + i] = visited[pos] ? 1 : 0;
      }
    }

    // Hole filling: flood from rect border in complement; anything not reachable is a hole -> include
    const seen = new Uint8Array(rw * rh);
    const q: number[] = [];
    const enqueueIf = (ix: number, iy: number) => {
      if (ix < 0 || iy < 0 || ix >= rw || iy >= rh) return;
      const p = iy * rw + ix;
      if (seen[p]) return;
      if (baseMask[p] === 0) {
        seen[p] = 1;
        q.push(p);
      }
    };
    // seed from rectangle borders (background)
    for (let i = 0; i < rw; i++) { enqueueIf(i, 0); enqueueIf(i, rh - 1); }
    for (let j = 0; j < rh; j++) { enqueueIf(0, j); enqueueIf(rw - 1, j); }
    while (q.length) {
      const p = q.shift() as number;
      const py = Math.floor(p / rw);
      const px = p % rw;
      const pushN = (ix: number, iy: number) => {
        if (ix < 0 || iy < 0 || ix >= rw || iy >= rh) return;
        const np = iy * rw + ix;
        if (seen[np]) return;
        if (baseMask[np] === 0) { seen[np] = 1; q.push(np); }
      };
      pushN(px - 1, py);
      pushN(px + 1, py);
      pushN(px, py - 1);
      pushN(px, py + 1);
    }
    // final mask: include base white region + white-only holes (exclude black islands)
    const finalMask = new Uint8Array(rw * rh);
    const holeDarkMask = new Uint8Array(rw * rh); // dark islands inside white frame
    for (let j = 0; j < rh; j++) {
      for (let i = 0; i < rw; i++) {
        const k = j * rw + i;
        if (baseMask[k]) { finalMask[k] = 1; continue; }
        const isHole = seen[k] === 0; // not reachable from border in complement
        const gx = rx + i;
        const gy = ry + j;
        const gi = (gy * w + gx) * 4;
        const r = data[gi], g = data[gi + 1], b = data[gi + 2], a = data[gi + 3];
        const whiteish = isWhitePixel(r, g, b, a);
        if (isHole) {
          // white-only holes go into final mask; dark holes go to overlay
          finalMask[k] = whiteish ? 1 : 0;
          holeDarkMask[k] = !whiteish && a > 0 ? 1 : 0;
        } else {
          finalMask[k] = 0;
        }
      }
    }

    // Draw selection (clear previous)
    const octx = overlay.getContext('2d');
    if (!octx) return;
    octx.clearRect(0, 0, overlay.width, overlay.height);
    drawMaskIntoOverlay(rx, ry, rw, rh, finalMask);

    // Persist raw mask for re-feathering
    lastMaskRef.current = { rx, ry, rw, rh, mask: finalMask };

    // Generate blurred mask for CSS masking (white=visible)
    const mUrl = maskToDataUrl(finalMask, rw, rh, feather);
    const hUrl = maskToDataUrl(finalMask, rw, rh, 0);
    if (mUrl) setMaskDataUrl(mUrl);
    if (hUrl) setHardMaskUrl(hUrl);

    // Build dark overlay from original frame inside excluded holes
    const frameData = offscreenImageDataRef.current;
    if (frameData) {
      const dCan = document.createElement('canvas');
      dCan.width = rw; dCan.height = rh;
      const dctx = dCan.getContext('2d');
      if (dctx) {
        const out = dctx.createImageData(rw, rh);
        const od = out.data;
        for (let j = 0; j < rh; j++) {
          for (let i = 0; i < rw; i++) {
            const k = j * rw + i;
            if (holeDarkMask[k]) {
              const gx = rx + i;
              const gy = ry + j;
              const gi = (gy * frameData.width + gx) * 4;
              const r = frameData.data[gi], g = frameData.data[gi + 1], b = frameData.data[gi + 2], a = frameData.data[gi + 3];
              const p = k * 4;
              od[p] = r; od[p+1] = g; od[p+2] = b; od[p+3] = a;
            }
          }
        }
        dctx.putImageData(out, 0, 0);
        setDarkOverlayUrl(dCan.toDataURL('image/png'));
      }
    }

    // Use this rect as active screenRect (fit uploaded image)
    const newRect: ScreenRectPct = {
      xPct: rx / w,
      yPct: ry / h,
      wPct: rw / w,
      hPct: rh / h,
    };
    setCustomRectPct(newRect);
    debugLogRef.current.push(`custom-rect: ${JSON.stringify(newRect)}`);
  };

  const clearOverlay = () => {
    const overlay = overlayCanvasRef.current;
    if (!overlay) return;
    const ctx = overlay.getContext('2d');
    if (!ctx) return;
    ctx.clearRect(0, 0, overlay.width, overlay.height);
    setCustomRectPct(null);
    setMaskDataUrl(null);
    setHardMaskUrl(null);
    setDarkOverlayUrl(null);
    lastMaskRef.current = null;
    debugLogRef.current.push('overlay-cleared');
  };

  // Re-generate blurred mask when feather changes
  useEffect(() => {
    const last = lastMaskRef.current;
    if (!last) return;
    const { rw, rh, mask } = last;
    const url = maskToDataUrl(mask, rw, rh, feather);
    if (url) setMaskDataUrl(url);
  }, [feather]);

  // Compose masked upload image strictly via canvas (remove any overflow)
  useEffect(() => {
    (async () => {
      const last = lastMaskRef.current;
      if (!last || !hardMaskUrl || !imageUrl || !imageNatural) {
        setCompositeUrl(null);
        return;
      }
      const { rw, rh } = last;
      const comp = document.createElement('canvas');
      comp.width = rw; comp.height = rh;
      const cctx = comp.getContext('2d');
      if (!cctx) return;

      // load uploaded image and mask image
      const up = await new Promise<HTMLImageElement>((resolve) => { const im = new Image(); im.onload = () => resolve(im); im.src = imageUrl; });
      const mk = await new Promise<HTMLImageElement>((resolve) => { const im = new Image(); im.onload = () => resolve(im); im.src = hardMaskUrl!; });

      // draw uploaded image with fit
      let fitRect;
      if (fitMode === 'cover') {
        fitRect = coverSize(rw, rh, imageNatural.w, imageNatural.h);
      } else {
        fitRect = containSize(rw, rh, imageNatural.w, imageNatural.h);
      }
      cctx.drawImage(up, fitRect.left, fitRect.top, fitRect.w, fitRect.h);

      // apply mask strictly
      cctx.globalCompositeOperation = 'destination-in';
      cctx.drawImage(mk, 0, 0, rw, rh);
      cctx.globalCompositeOperation = 'source-over';

      setCompositeUrl(comp.toDataURL('image/png'));
    })();
  }, [hardMaskUrl, imageUrl, imageNatural, fitMode]);

  return (
    <div className="w-full max-w-6xl mx-auto p-4">
      <h2 className="text-xl font-semibold mb-3">最小UI — フレーム選択とアップロード</h2>

      {/* Frame selector */}
      <div className="flex gap-3 overflow-x-auto pb-2">
        {frames.map((f) => (
          <button
            key={f.id}
            onClick={() => {
              setSelectedFrame(f);
              setAspect(f.aspectSupport[0] ?? '1:1');
              setFrameNatural(null);
              setCustomRectPct(null);
              clearOverlay();
              debugLogRef.current.push(`frame-selected: ${f.id}`);
            }}
            className={`border rounded-md p-2 bg-white hover:bg-gray-50 transition shadow-sm min-w-[140px] ${
              selectedFrame?.id === f.id ? 'ring-2 ring-black' : ''
            }`}
            title={f.name}
          >
            <img
              src={f.frameImage}
              alt={f.name}
              className="w-32 h-24 object-contain pointer-events-none select-none"
              loading="lazy"
            />
            <div className="text-xs mt-1 text-gray-700 truncate">{f.name}</div>
          </button>
        ))}
      </div>

      {/* Frame tools */}
      <div className="mt-4 flex items-center gap-2 flex-wrap">
        <button
          onClick={async () => {
            if (!frameUrl) return;
            try {
              setIsEditingFrame(true);
              const cfg = (globalThis as any)?.ywConfig?.ai_config?.image_editor;
              if (!cfg) throw new Error('API Error - Image editor configuration not found');
              const res = await fetch(frameUrl);
              const blob = await res.blob();
              const file = new File([blob], 'frame.png', { type: blob.type || 'image/png' });
              const form = new FormData();
              form.append('model', cfg.model);
              const prompt = cfg.prompt_template ? cfg.prompt_template({}) : 'Remove text from the device frame';
              form.append('prompt', prompt);
              form.append('response_format', 'b64_json');
              form.append('image', file);
              const resp = await fetch('https://api.youware.com/public/v1/ai/images/edits', {
                method: 'POST',
                headers: { 'Authorization': 'Bearer sk-YOUWARE' },
                body: form,
              });
              if (!resp.ok) {
                const err = await resp.json().catch(() => ({}));
                console.error('API Error - Image editing failed:', resp.status, resp.statusText, err);
                throw new Error(`API Error - Image editing failed: ${resp.status} ${resp.statusText}`);
              }
              const data = await resp.json();
              const out = data?.data?.[0];
              const url = out?.b64_json ? `data:image/png;base64,${out.b64_json}` : out?.url;
              if (url) setEditedFrameUrl(url);
            } catch (e: any) {
              console.error('API Error - Image editing failed:', e?.message || e);
              alert('フレームのテキスト除去に失敗しました。後でもう一度お試しください。');
            } finally {
              setIsEditingFrame(false);
            }
          }}
          className={`px-2 py-1 text-sm border rounded ${isEditingFrame ? 'opacity-60' : 'bg-white hover:bg-gray-50'}`}
          disabled={isEditingFrame || !frameUrl}
        >
          {isEditingFrame ? 'テキスト除去中…' : 'フレームのテキストをAIで削除'}
        </button>
        {editedFrameUrl && (
          <button
            onClick={() => setEditedFrameUrl(null)}
            className="px-2 py-1 text-sm border rounded bg-white hover:bg-gray-50"
          >元に戻す</button>
        )}
      </div>

      {/* Aspect & FitMode selector */}
      <div className="mt-4 flex items-center gap-2 flex-wrap">
        <span className="text-sm text-gray-600">アスペクト比:</span>
        {(['9:16', '16:9', '1:1'] as AspectRatio[]).map((a) => (
          <button
            key={a}
            onClick={() => {
              setAspect(a);
              debugLogRef.current.push(`aspect-changed: ${a}`);
            }}
            className={`px-2 py-1 text-sm border rounded ${aspect === a ? 'bg-black text-white' : 'bg-white hover:bg-gray-50'}`}
          >
            {a}
          </button>
        ))}
        <span className="ml-4 text-sm text-gray-600">フィット方式:</span>
        {(['contain', 'cover'] as const).map((mode) => (
          <button
            key={mode}
            onClick={() => setFitMode(mode)}
            className={`px-2 py-1 text-sm border rounded ${fitMode === mode ? 'bg-black text-white' : 'bg-white hover:bg-gray-50'}`}
          >
            {mode}
          </button>
        ))}
        <span className="ml-4 text-sm text-gray-600">白塗りモード:</span>
        <label className="flex items-center gap-2 text-sm">
          <input type="checkbox" checked={fillEnabled} onChange={(e)=> setFillEnabled(e.target.checked)} />
          クリックで白領域塗り
        </label>
        <span className="ml-4 text-sm text-gray-600">マスクの滑らかさ:</span>
        <input type="range" min={0} max={10} step={1} value={feather} onChange={(e)=> setFeather(parseInt(e.target.value))} />
        <button onClick={clearOverlay} className="ml-2 px-2 py-1 text-sm border rounded bg-white hover:bg-gray-50">塗りつぶしをクリア</button>
      </div>

      {/* Uploader + Debug */}
      <div className="mt-4">
        <label className="text-sm font-medium">スクリーンショット画像をアップロード</label>
        <div className="mt-2 flex items-center gap-3">
          <input
            type="file"
            accept="image/*"
            onChange={(e) => {
              const prev = !!imageUrl;
              onFileChange(e);
              debugLogRef.current.push(`image-uploaded: prev=${prev}`);
            }}
            className="block"
          />
          <label className="flex items-center gap-2 text-sm">
            <input type="checkbox" checked={showOverlay} onChange={(e)=> setShowOverlay(e.target.checked)} />
            スクリーン領域を表示
          </label>
        </div>
        <DebugButton
          label="デバッグレポート生成"
          generateReport={() => {
            const data = {
              time: new Date().toISOString(),
              aspect,
              fitMode,
              container: containerSize,
              frame: selectedFrame ? {
                id: selectedFrame.id,
                name: selectedFrame.name,
                screenRect: activeRect,
              } : null,
              frameNatural,
              customRectPct,
              imageUrlPresent: !!imageUrl,
              logs: debugLogRef.current,
              ua: navigator.userAgent,
              react: {
                version: (React as any).version,
              },
            };
            return JSON.stringify(data, null, 2);
          }}
        />
      </div>

      {/* Preview */}
      <div className="mt-6">
        <div
          ref={containerRef}
          className="relative bg-gray-200 rounded-lg overflow-hidden mx-auto"
          style={{
            aspectRatio: aspectCss as any,
            width: 'min(90vw, 800px)',
          }}
        >
          {/* 1) Frame image (below) */}
          {selectedFrame ? (
            (() => {
              const style: React.CSSProperties = (() => {
                if (!frameNatural) return { position: 'absolute', inset: 0, zIndex: 1 } as React.CSSProperties;
                const c = containSize(containerSize.w, containerSize.h, frameNatural.w, frameNatural.h);
                return {
                  position: 'absolute',
                  left: `${c.left}px`,
                  top: `${c.top}px`,
                  width: `${c.w}px`,
                  height: `${c.h}px`,
                  objectFit: 'contain',
                  pointerEvents: 'none',
                  zIndex: 1,
                } as React.CSSProperties;
              })();
              return (
                <img
                  src={frameUrl ?? ''}
                  alt={selectedFrame.name}
                  onLoad={(e) => {
                    const img = e.currentTarget;
                    setFrameNatural({ w: img.naturalWidth, h: img.naturalHeight });
                    debugLogRef.current.push(`frame-loaded: natural=${img.naturalWidth}x${img.naturalHeight}`);
                  }}
                  style={style}
                />
              );
            })()
          ) : (
            <div className="absolute bottom-2 left-2 text-xs bg-white/70 px-2 py-1 rounded">フレーム未選択</div>
          )}

          {/* 1.5) White-fill overlay canvas aligned to frame contain */}
          {selectedFrame && frameNatural && (
            (() => {
              const c = containSize(containerSize.w, containerSize.h, frameNatural.w, frameNatural.h);
              const style: React.CSSProperties = {
                position: 'absolute',
                left: `${c.left}px`,
                top: `${c.top}px`,
                width: `${c.w}px`,
                height: `${c.h}px`,
                zIndex: 5,
                cursor: fillEnabled ? 'crosshair' : 'default',
                pointerEvents: fillEnabled ? 'auto' as const : 'none' as const,
              };
              return (
                <canvas
                  ref={overlayCanvasRef}
                  onClick={fillEnabled ? onOverlayClick : undefined}
                  style={style}
                />
              );
            })()
          )}

          {/* 2) Composite result strictly masked (image on top) */}
          {selectedFrame && compositeUrl && frameNatural && activeRect && (
            (() => {
              const contain = containSize(containerSize.w, containerSize.h, frameNatural.w, frameNatural.h);
              const sx = activeRect.xPct * contain.w + contain.left;
              const sy = activeRect.yPct * contain.h + contain.top;
              const sw = activeRect.wPct * contain.w;
              const sh = activeRect.hPct * contain.h;
              return (
                <div
                  style={{
                    position: 'absolute',
                    left: `${sx}px`,
                    top: `${sy}px`,
                    width: `${sw}px`,
                    height: `${sh}px`,
                    zIndex: 50,
                    backgroundColor: 'transparent',
                    pointerEvents: fillEnabled ? 'none' : 'auto',
                  }}
                >
                  <img
                    key={imageKey}
                    src={compositeUrl}
                    alt="composite"
                    style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', pointerEvents: fillEnabled ? 'none' : 'auto' }}
                  />
                  {darkOverlayUrl && (
                    <img
                      src={darkOverlayUrl}
                      alt="frame-details"
                      style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', pointerEvents: 'none' }}
                    />
                  )}
                </div>
              );
            })()
          )}

          {/* hint when no image */}
          {!imageUrl && (
            <div className="absolute inset-0 flex items-center justify-center text-sm text-gray-600">
              画像未選択
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
