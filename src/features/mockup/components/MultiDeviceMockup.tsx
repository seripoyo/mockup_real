import React, { useMemo, useState, useEffect, useLayoutEffect, useRef } from 'react';
import type { AspectRatio, FrameMeta, ScreenRectPct, DeviceIndex, DeviceRegionState } from '../types/frame';
import { frames } from '../data/frames';
import { containSize, coverSize } from '../utils/fit';
import { DEVICE_COLOR_ORDER, getDeviceColor } from '../../../constants/deviceColors';
import DebugButton from '../../../components/DebugButton';

function aspectToCss(aspect: AspectRatio) {
  switch (aspect) {
    case '9:16':
      return '9 / 16';
    case '16:9':
      return '16 / 9';
    case '1:1':
      return '1 / 1';
    case '4:5':
      return '4 / 5';
    case '3:4':
      return '3 / 4';
    case '8:9':
      return '8 / 9';
    default:
      return '1 / 1';
  }
}

function isWhitePixel(r: number, g: number, b: number, a: number) {
  const thr = 240;
  return a > 200 && r >= thr && g >= thr && b >= thr;
}

function findNearestWhite(x: number, y: number, data: Uint8ClampedArray, w: number, h: number, maxR = 6) {
  let idx = (y * w + x) * 4;
  if (isWhitePixel(data[idx], data[idx + 1], data[idx + 2], data[idx + 3])) return { x, y };

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

export default function MultiDeviceMockup() {
  const [selectedFrame, setSelectedFrame] = useState<FrameMeta | null>(null);
  const [aspect, setAspect] = useState<AspectRatio>('9:16');
  const [fitMode, setFitMode] = useState<'contain' | 'cover'>('cover');
  const [showOverlay, setShowOverlay] = useState<boolean>(false);
  const [frameNatural, setFrameNatural] = useState<{ w: number; h: number } | null>(null);
  const [containerSize, setContainerSize] = useState<{ w: number; h: number }>({ w: 800, h: 800 });
  const [fillEnabled, setFillEnabled] = useState<boolean>(true);
  const [feather, setFeather] = useState<number>(2);
  const [editedFrameUrl, setEditedFrameUrl] = useState<string | null>(null);
  const [isEditingFrame, setIsEditingFrame] = useState<boolean>(false);

  // 複数デバイス対応の状態管理
  const [deviceRegions, setDeviceRegions] = useState<DeviceRegionState[]>([]);
  const [activeDeviceIndex, setActiveDeviceIndex] = useState<DeviceIndex | null>(null);
  const [imageUrls, setImageUrls] = useState<(string | null)[]>([null, null, null]);
  const [imageKeys, setImageKeys] = useState<number[]>([0, 0, 0]);

  const containerRef = useRef<HTMLDivElement>(null);
  const debugLogRef = useRef<string[]>([]);

  const frameUrl = useMemo(() => (selectedFrame ? (editedFrameUrl ?? selectedFrame.frameImage) : null), [selectedFrame, editedFrameUrl]);

  // Canvas refs
  const offscreenCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const offscreenImageDataRef = useRef<ImageData | null>(null);
  const overlayCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const lastMasksRef = useRef<Map<DeviceIndex, { rx: number; ry: number; rw: number; rh: number; mask: Uint8Array }>>(new Map());

  // デバイス領域の初期化
  useEffect(() => {
    const newRegions: DeviceRegionState[] = [];
    for (let i = 0; i < 3; i++) {
      newRegions.push({
        deviceIndex: i as DeviceIndex,
        rect: null,
        maskDataUrl: null,
        hardMaskUrl: null,
        darkOverlayUrl: null,
        compositeUrl: null,
        imageUrl: null,
        imageNatural: null,
        fillColor: getDeviceColor(i as DeviceIndex),
        isActive: false,
      });
    }
    setDeviceRegions(newRegions);
  }, []);

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

  useEffect(() => {
    return () => {
      imageUrls.forEach(url => {
        if (url) URL.revokeObjectURL(url);
      });
    };
  }, [imageUrls]);

  const onFileChange = (e: React.ChangeEvent<HTMLInputElement>, deviceIndex: DeviceIndex) => {
    const file = e.target.files?.[0];
    if (!file) return;

    const url = URL.createObjectURL(file);
    const oldUrl = imageUrls[deviceIndex];
    if (oldUrl) URL.revokeObjectURL(oldUrl);

    const newUrls = [...imageUrls];
    newUrls[deviceIndex] = url;
    setImageUrls(newUrls);

    const probe = new Image();
    probe.onload = () => {
      setDeviceRegions(prev => prev.map((region, idx) =>
        idx === deviceIndex
          ? { ...region, imageUrl: url, imageNatural: { w: probe.naturalWidth, h: probe.naturalHeight } }
          : region
      ));
      debugLogRef.current.push(`device-${deviceIndex}-upload: ${probe.naturalWidth}x${probe.naturalHeight}`);
    };
    probe.src = url;

    const newKeys = [...imageKeys];
    newKeys[deviceIndex] = (newKeys[deviceIndex] || 0) + 1;
    setImageKeys(newKeys);

    e.target.value = '';
    debugLogRef.current.push(`device-${deviceIndex}-image-changed`);
  };

  const aspectCss = useMemo(() => aspectToCss(aspect), [aspect]);

  useEffect(() => {
    if (!selectedFrame || !frameNatural || !frameUrl) return;

    const off = document.createElement('canvas');
    off.width = frameNatural.w;
    off.height = frameNatural.h;
    const offctx = off.getContext('2d');
    if (!offctx) return;

    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.src = frameUrl;
    img.onload = () => {
      offctx.drawImage(img, 0, 0, frameNatural.w, frameNatural.h);
      const imgData = offctx.getImageData(0, 0, frameNatural.w, frameNatural.h);
      offscreenCanvasRef.current = off;
      offscreenImageDataRef.current = imgData;
      debugLogRef.current.push('offscreen-ready');

      // リセット
      setDeviceRegions(prev => prev.map(region => ({
        ...region,
        rect: null,
        maskDataUrl: null,
        hardMaskUrl: null,
        darkOverlayUrl: null,
        compositeUrl: null,
      })));
      lastMasksRef.current.clear();
    };

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

  const drawMaskIntoOverlay = () => {
    const overlay = overlayCanvasRef.current;
    if (!overlay) return;
    const octx = overlay.getContext('2d');
    if (!octx) return;

    octx.clearRect(0, 0, overlay.width, overlay.height);

    deviceRegions.forEach((region, idx) => {
      if (region.rect && lastMasksRef.current.has(idx as DeviceIndex)) {
        const maskData = lastMasksRef.current.get(idx as DeviceIndex)!;
        const { rx, ry, rw, rh, mask } = maskData;

        const img = octx.getImageData(rx, ry, rw, rh);
        const d = img.data;

        // デバイスごとの色を使用
        const color = parseInt(region.fillColor.substring(1), 16);
        const r = (color >> 16) & 0xFF;
        const g = (color >> 8) & 0xFF;
        const b = color & 0xFF;

        for (let j = 0; j < rh; j++) {
          for (let i = 0; i < rw; i++) {
            const m = mask[j * rw + i];
            if (m) {
              const p = (j * rw + i) * 4;
              d[p] = r;
              d[p + 1] = g;
              d[p + 2] = b;
              d[p + 3] = 0xFF;
            }
          }
        }
        octx.putImageData(img, rx, ry);
      }
    });
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

  const findDeviceIndexByPosition = (x: number, y: number): DeviceIndex | null => {
    for (let i = deviceRegions.length - 1; i >= 0; i--) {
      const region = deviceRegions[i];
      if (region.rect && frameNatural) {
        const rx = region.rect.xPct * frameNatural.w;
        const ry = region.rect.yPct * frameNatural.h;
        const rw = region.rect.wPct * frameNatural.w;
        const rh = region.rect.hPct * frameNatural.h;

        if (x >= rx && x <= rx + rw && y >= ry && y <= ry + rh) {
          return i as DeviceIndex;
        }
      }
    }
    return null;
  };

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

    // まず既存の領域内かチェック
    const existingDevice = findDeviceIndexByPosition(x, y);
    if (existingDevice !== null) {
      setActiveDeviceIndex(existingDevice);
      debugLogRef.current.push(`switched-to-device-${existingDevice}`);
      return;
    }

    // 新しいデバイス領域を検出
    const availableIndex = deviceRegions.findIndex(r => !r.isActive);
    if (availableIndex === -1) {
      debugLogRef.current.push('max-devices-reached');
      return;
    }

    const seed = findNearestWhite(x, y, data, w, h, 6);
    if (!seed) {
      debugLogRef.current.push(`no-white-nearby @${x},${y}`);
      return;
    }
    x = seed.x; y = seed.y;

    // BFS flood fill
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

    const rx = minX;
    const ry = minY;
    const rw = Math.max(1, maxX - minX + 1);
    const rh = Math.max(1, maxY - minY + 1);

    // マスク生成
    const baseMask = new Uint8Array(rw * rh);
    for (let j = 0; j < rh; j++) {
      for (let i = 0; i < rw; i++) {
        const pos = (ry + j) * w + (rx + i);
        baseMask[j * rw + i] = visited[pos] ? 1 : 0;
      }
    }

    // 穴埋め処理
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

    const finalMask = new Uint8Array(rw * rh);
    const holeDarkMask = new Uint8Array(rw * rh);
    for (let j = 0; j < rh; j++) {
      for (let i = 0; i < rw; i++) {
        const k = j * rw + i;
        if (baseMask[k]) { finalMask[k] = 1; continue; }
        const isHole = seen[k] === 0;
        const gx = rx + i;
        const gy = ry + j;
        const gi = (gy * w + gx) * 4;
        const r = data[gi], g = data[gi + 1], b = data[gi + 2], a = data[gi + 3];
        const whiteish = isWhitePixel(r, g, b, a);
        if (isHole) {
          finalMask[k] = whiteish ? 1 : 0;
          holeDarkMask[k] = !whiteish && a > 0 ? 1 : 0;
        } else {
          finalMask[k] = 0;
        }
      }
    }

    // 新しいデバイス領域として保存
    const deviceIndex = availableIndex as DeviceIndex;
    lastMasksRef.current.set(deviceIndex, { rx, ry, rw, rh, mask: finalMask });

    const mUrl = maskToDataUrl(finalMask, rw, rh, feather);
    const hUrl = maskToDataUrl(finalMask, rw, rh, 0);

    // Dark overlay
    const frameData = offscreenImageDataRef.current;
    let darkUrl: string | null = null;
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
        darkUrl = dCan.toDataURL('image/png');
      }
    }

    const newRect: ScreenRectPct = {
      xPct: rx / w,
      yPct: ry / h,
      wPct: rw / w,
      hPct: rh / h,
    };

    setDeviceRegions(prev => prev.map((region, idx) =>
      idx === deviceIndex
        ? { ...region, rect: newRect, maskDataUrl: mUrl, hardMaskUrl: hUrl, darkOverlayUrl: darkUrl, isActive: true }
        : region
    ));
    setActiveDeviceIndex(deviceIndex);

    drawMaskIntoOverlay();
    debugLogRef.current.push(`device-${deviceIndex}-rect: ${JSON.stringify(newRect)}`);
  };

  const clearOverlay = () => {
    const overlay = overlayCanvasRef.current;
    if (!overlay) return;
    const ctx = overlay.getContext('2d');
    if (!ctx) return;
    ctx.clearRect(0, 0, overlay.width, overlay.height);

    setDeviceRegions(prev => prev.map(region => ({
      ...region,
      rect: null,
      maskDataUrl: null,
      hardMaskUrl: null,
      darkOverlayUrl: null,
      compositeUrl: null,
      isActive: false,
    })));
    lastMasksRef.current.clear();
    setActiveDeviceIndex(null);
    debugLogRef.current.push('all-overlays-cleared');
  };

  const clearDevice = (deviceIndex: DeviceIndex) => {
    lastMasksRef.current.delete(deviceIndex);
    setDeviceRegions(prev => prev.map((region, idx) =>
      idx === deviceIndex
        ? { ...region, rect: null, maskDataUrl: null, hardMaskUrl: null, darkOverlayUrl: null, compositeUrl: null, isActive: false }
        : region
    ));
    drawMaskIntoOverlay();
    debugLogRef.current.push(`device-${deviceIndex}-cleared`);
  };

  // Re-generate masks when feather changes
  useEffect(() => {
    drawMaskIntoOverlay();
  }, [deviceRegions]);

  useEffect(() => {
    lastMasksRef.current.forEach((maskData, deviceIndex) => {
      const { rw, rh, mask } = maskData;
      const url = maskToDataUrl(mask, rw, rh, feather);
      if (url) {
        setDeviceRegions(prev => prev.map((region, idx) =>
          idx === deviceIndex ? { ...region, maskDataUrl: url } : region
        ));
      }
    });
  }, [feather]);

  // Composite images for each device
  useEffect(() => {
    deviceRegions.forEach((region, deviceIndex) => {
      (async () => {
        const last = lastMasksRef.current.get(deviceIndex as DeviceIndex);
        const imageUrl = imageUrls[deviceIndex];
        if (!last || !region.hardMaskUrl || !imageUrl || !region.imageNatural) {
          if (region.compositeUrl) {
            setDeviceRegions(prev => prev.map((r, idx) =>
              idx === deviceIndex ? { ...r, compositeUrl: null } : r
            ));
          }
          return;
        }

        const { rw, rh } = last;
        const comp = document.createElement('canvas');
        comp.width = rw; comp.height = rh;
        const cctx = comp.getContext('2d');
        if (!cctx) return;

        const up = await new Promise<HTMLImageElement>((resolve) => {
          const im = new Image();
          im.onload = () => resolve(im);
          im.src = imageUrl;
        });
        const mk = await new Promise<HTMLImageElement>((resolve) => {
          const im = new Image();
          im.onload = () => resolve(im);
          im.src = region.hardMaskUrl!;
        });

        let fitRect;
        if (fitMode === 'cover') {
          fitRect = coverSize(rw, rh, region.imageNatural.w, region.imageNatural.h);
        } else {
          fitRect = containSize(rw, rh, region.imageNatural.w, region.imageNatural.h);
        }
        cctx.drawImage(up, fitRect.left, fitRect.top, fitRect.w, fitRect.h);

        cctx.globalCompositeOperation = 'destination-in';
        cctx.drawImage(mk, 0, 0, rw, rh);
        cctx.globalCompositeOperation = 'source-over';

        const compositeUrl = comp.toDataURL('image/png');
        setDeviceRegions(prev => prev.map((r, idx) =>
          idx === deviceIndex ? { ...r, compositeUrl } : r
        ));
      })();
    });
  }, [deviceRegions, imageUrls, fitMode]);

  return (
    <div className="w-full max-w-6xl mx-auto p-4">
      <h2 className="text-xl font-semibold mb-3">複数デバイス対応モックアップエディタ</h2>

      {/* Frame selector */}
      <div className="flex gap-3 overflow-x-auto pb-2">
        {frames.map((f) => (
          <button
            key={f.id}
            onClick={() => {
              setSelectedFrame(f);
              setAspect(f.aspectSupport[0] ?? '1:1');
              setFrameNatural(null);
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

      {/* Aspect & FitMode selector */}
      <div className="mt-4 flex items-center gap-2 flex-wrap">
        <span className="text-sm text-gray-600">アスペクト比:</span>
        {(['9:16', '16:9', '1:1', '4:5'] as AspectRatio[]).map((a) => (
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
      </div>

      {/* Control buttons */}
      <div className="mt-4 flex items-center gap-2 flex-wrap">
        <span className="text-sm text-gray-600">白塗りモード:</span>
        <label className="flex items-center gap-2 text-sm">
          <input type="checkbox" checked={fillEnabled} onChange={(e)=> setFillEnabled(e.target.checked)} />
          クリックで白領域塗り
        </label>
        <span className="ml-4 text-sm text-gray-600">マスクの滑らかさ:</span>
        <input type="range" min={0} max={10} step={1} value={feather} onChange={(e)=> setFeather(parseInt(e.target.value))} />
        <button onClick={clearOverlay} className="ml-2 px-2 py-1 text-sm border rounded bg-white hover:bg-gray-50">全クリア</button>
      </div>

      {/* Multiple image uploaders */}
      <div className="mt-4 grid grid-cols-1 md:grid-cols-3 gap-4">
        {deviceRegions.map((region, idx) => (
          <div key={idx} className="border rounded-lg p-3" style={{ borderColor: region.fillColor }}>
            <div className="flex items-center justify-between mb-2">
              <label className="text-sm font-medium flex items-center gap-2">
                <span className="w-4 h-4 rounded-full" style={{ backgroundColor: region.fillColor }}></span>
                デバイス {idx + 1}
              </label>
              {region.isActive && (
                <button
                  onClick={() => clearDevice(idx as DeviceIndex)}
                  className="text-xs px-2 py-1 border rounded hover:bg-gray-50"
                >
                  クリア
                </button>
              )}
            </div>
            <input
              type="file"
              accept="image/*"
              onChange={(e) => onFileChange(e, idx as DeviceIndex)}
              className="block text-sm"
            />
            {imageUrls[idx] && (
              <div className="mt-2 text-xs text-gray-600">
                画像アップロード済み {region.imageNatural && `(${region.imageNatural.w}x${region.imageNatural.h})`}
              </div>
            )}
          </div>
        ))}
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
          {/* Frame image */}
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

          {/* Overlay canvas */}
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

          {/* Composite results for each device */}
          {selectedFrame && frameNatural && deviceRegions.map((region, idx) => {
            if (!region.compositeUrl || !region.rect) return null;
            const contain = containSize(containerSize.w, containerSize.h, frameNatural.w, frameNatural.h);
            const sx = region.rect.xPct * contain.w + contain.left;
            const sy = region.rect.yPct * contain.h + contain.top;
            const sw = region.rect.wPct * contain.w;
            const sh = region.rect.hPct * contain.h;

            return (
              <div
                key={idx}
                style={{
                  position: 'absolute',
                  left: `${sx}px`,
                  top: `${sy}px`,
                  width: `${sw}px`,
                  height: `${sh}px`,
                  zIndex: 50 + idx,
                  backgroundColor: 'transparent',
                  pointerEvents: fillEnabled ? 'none' : 'auto',
                }}
              >
                <img
                  key={imageKeys[idx]}
                  src={region.compositeUrl}
                  alt={`composite-${idx}`}
                  style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', pointerEvents: fillEnabled ? 'none' : 'auto' }}
                />
                {region.darkOverlayUrl && (
                  <img
                    src={region.darkOverlayUrl}
                    alt="frame-details"
                    style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', pointerEvents: 'none' }}
                  />
                )}
              </div>
            );
          })}

          {/* No image hint */}
          {!imageUrls.some(Boolean) && (
            <div className="absolute inset-0 flex items-center justify-center text-sm text-gray-600">
              画像未選択
            </div>
          )}
        </div>
      </div>

      {/* Debug button */}
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
            } : null,
            frameNatural,
            deviceRegions: deviceRegions.map(r => ({
              deviceIndex: r.deviceIndex,
              rect: r.rect,
              isActive: r.isActive,
              hasImage: !!r.imageUrl,
              fillColor: r.fillColor,
            })),
            activeDeviceIndex,
            logs: debugLogRef.current,
          };
          return JSON.stringify(data, null, 2);
        }}
      />
    </div>
  );
}