import React, { useMemo, useState, useEffect, useLayoutEffect, useRef } from 'react';
import type { AspectRatio, FrameMeta, ScreenRectPct, DeviceIndex, DeviceRegionState, Point } from '../types/frame';
import { frames } from '../data/frames';
import { containSize, coverSize } from '../utils/fit';
import { DEVICE_COLOR_ORDER, getDeviceColor } from '../../../constants/deviceColors';
import DebugButton from '../../../components/DebugButton';
import {
  getOrientation,
  getDeviceAngle,
  isOrientationMatched,
  getCornerRadius,
  generateDeviceDebugInfo,
  type DeviceDebugInfo
} from '../utils/deviceOrientation';
import {
  logCoordinateTransform,
  checkMaskContentAlignment,
  generateDebugReport
} from '../utils/debugVisualization';

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
  // Coverモードのみを使用
  const fitMode = 'cover' as const;
  const [showOverlay, setShowOverlay] = useState<boolean>(false);
  const [frameNatural, setFrameNatural] = useState<{ w: number; h: number } | null>(null);
  const [containerSize, setContainerSize] = useState<{ w: number; h: number }>({ w: 800, h: 800 });
  const [fillEnabled, setFillEnabled] = useState<boolean>(true);
  const [feather, setFeather] = useState<number>(2);
  const [editedFrameUrl, setEditedFrameUrl] = useState<string | null>(null);
  const [isEditingFrame, setIsEditingFrame] = useState<boolean>(false);
  const [debugMode, setDebugMode] = useState<boolean>(false);

  // 複数デバイス対応の状態管理
  const [deviceRegions, setDeviceRegions] = useState<DeviceRegionState[]>([]);
  const [activeDeviceIndex, setActiveDeviceIndex] = useState<DeviceIndex | null>(null);
  const [imageUrls, setImageUrls] = useState<(string | null)[]>([null, null, null]);
  const [imageKeys, setImageKeys] = useState<number[]>([0, 0, 0]);

  const containerRef = useRef<HTMLDivElement>(null);
  const debugLogRef = useRef<string[]>([]);
  const deviceDebugInfoRef = useRef<DeviceDebugInfo[]>([]);

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
        corners: null,  // 4隅座標を初期化
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

  // フレーム切り替え時に画像とエリア判定をクリア
  useEffect(() => {
    // 初回レンダリング時はスキップ
    if (!selectedFrame) return;

    // すべてのデータをリセット（エリア判定も含む）
    setDeviceRegions(prev => prev.map(region => ({
      ...region,
      rect: null,           // エリア判定もクリア
      corners: null,        // 4隅座標もクリア
      maskDataUrl: null,
      hardMaskUrl: null,
      darkOverlayUrl: null,
      compositeUrl: null,
      imageUrl: null,
      imageNatural: null,
      isActive: false,      // アクティブ状態もリセット
    })));

    // 画像URLsもクリア
    setImageUrls([null, null, null]);

    // マスクデータもクリア
    lastMasksRef.current.clear();

    // オーバーレイキャンバスもクリア
    const overlay = overlayCanvasRef.current;
    if (overlay) {
      const ctx = overlay.getContext('2d');
      if (ctx) {
        ctx.clearRect(0, 0, overlay.width, overlay.height);
      }
    }

    debugLogRef.current.push('frame-changed-all-cleared');
  }, [selectedFrame]);

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
        corners: null,  // 4隅座標もクリア
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

    // 検出領域の4隅座標を取得（左上、右上、右下、左下）
    const corners: [Point, Point, Point, Point] = [
      { x: rx, y: ry },           // 左上
      { x: rx + rw, y: ry },      // 右上
      { x: rx + rw, y: ry + rh }, // 右下
      { x: rx, y: ry + rh }       // 左下
    ];

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
        ? { ...region, rect: newRect, corners, maskDataUrl: mUrl, hardMaskUrl: hUrl, darkOverlayUrl: darkUrl, isActive: true }
        : region
    ));
    setActiveDeviceIndex(deviceIndex);

    drawMaskIntoOverlay();
    debugLogRef.current.push(`device-${deviceIndex}-rect: ${JSON.stringify(newRect)}`);
  };

  const clearOverlay = () => {
    // 画像とコンポジットのみをクリア、エリア判定（rect）とオーバーレイ表示は残す
    setDeviceRegions(prev => prev.map(region => ({
      ...region,
      // rect は残す（エリア判定を保持）
      // maskDataUrl も残す（塗りつぶしエリアを保持）
      // hardMaskUrl も残す
      // darkOverlayUrl も残す
      compositeUrl: null,  // 合成画像のみクリア
      imageUrl: null,      // アップロード画像のみクリア
      imageNatural: null,  // 画像サイズ情報のみクリア
      // isActive は保持
    })));

    // 画像URLsもクリア
    setImageUrls([null, null, null]);

    // オーバーレイの表示は維持（再描画）
    drawMaskIntoOverlay();

    debugLogRef.current.push('images-cleared-keeping-detection');
  };

  const clearDevice = (deviceIndex: DeviceIndex) => {
    // 画像のみクリア、エリア判定は保持
    setDeviceRegions(prev => prev.map((region, idx) =>
      idx === deviceIndex
        ? {
            ...region,
            // rect, maskDataUrl, hardMaskUrl, darkOverlayUrl, isActive は保持
            compositeUrl: null,   // 合成画像のみクリア
            imageUrl: null,       // アップロード画像のみクリア
            imageNatural: null    // 画像サイズ情報のみクリア
          }
        : region
    ));

    // 該当デバイスの画像URLもクリア
    setImageUrls(prev => {
      const newUrls = [...prev];
      newUrls[deviceIndex] = null;
      return newUrls;
    });

    drawMaskIntoOverlay();
    debugLogRef.current.push(`device-${deviceIndex}-image-cleared`);
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
    // デバイスが存在しない場合は早期リターン
    if (deviceRegions.length === 0) return;

    // Device状態のデバッグログを出力
    if (debugMode) {
      console.log('=== All Device Regions Status ===');
      deviceRegions.forEach((region, index) => {
        console.log(`Device ${region.deviceIndex}:`, {
          arrayIndex: index,
          deviceIndex: region.deviceIndex,
          isActive: region.isActive,
          hasImage: !!region.imageUrl,
          hasRect: !!region.rect,
          hasComposite: !!region.compositeUrl,
        });
      });
      console.log('===========================');
    }

    let isCancelled = false;

    // 実際に存在するデバイスのみを処理
    deviceRegions.forEach((region, deviceIndex) => {
      if (!region) return;

      (async () => {
        if (isCancelled) return;
        const last = lastMasksRef.current.get(region.deviceIndex as DeviceIndex);
        const imageUrl = imageUrls[region.deviceIndex];
        if (!last || !region.hardMaskUrl || !imageUrl || !region.imageNatural || !region.rect) {
          if (region.compositeUrl) {
            setDeviceRegions(prev => prev.map((r, idx) =>
              idx === deviceIndex ? { ...r, compositeUrl: null } : r
            ));
          }
          return;
        }

        const { rw, rh } = last;

        // 表示用のサイズを計算
        let canvasWidth = rw;
        let canvasHeight = rh;

        // frameNaturalが存在する場合、表示サイズに合わせて調整
        if (frameNatural && containerSize) {
          const scale = Math.min(
            containerSize.w / frameNatural.w,
            containerSize.h / frameNatural.h
          );
          const displayWidth = frameNatural.w * scale;
          const displayHeight = frameNatural.h * scale;

          canvasWidth = Math.round(region.rect.wPct * displayWidth);
          canvasHeight = Math.round(region.rect.hPct * displayHeight);
        }

        const comp = document.createElement('canvas');
        comp.width = canvasWidth;
        comp.height = canvasHeight;
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


        // デバッグ情報を生成
        const debugInfo = generateDeviceDebugInfo(
          selectedFrame?.name || 'unknown',
          deviceIndex,
          region.rect,
          containerSize,
          region.imageNatural,
          selectedFrame?.category,
          'cover' // coverモードのみ使用
        );

        // 座標変換の詳細ログを出力
        if (frameNatural && region.rect) {
          const scale = Math.min(
            containerSize.w / frameNatural.w,
            containerSize.h / frameNatural.h
          );
          const displayWidth = frameNatural.w * scale;
          const displayHeight = frameNatural.h * scale;
          const offsetX = (containerSize.w - displayWidth) / 2;
          const offsetY = (containerSize.h - displayHeight) / 2;

          const actualPosition = {
            x: Math.round(offsetX + region.rect.xPct * displayWidth),
            y: Math.round(offsetY + region.rect.yPct * displayHeight),
            width: canvasWidth,
            height: canvasHeight
          };

          logCoordinateTransform(
            region.deviceIndex,
            frameNatural,
            containerSize,
            region.rect,
            actualPosition
          );
        }

        // 画像と検出領域の向きを判定（canvasのサイズを使用）
        const needsRotation = !isOrientationMatched(
          up.width,
          up.height,
          canvasWidth,
          canvasHeight
        );

        // 詳細なデバッグログ出力（デバッグモードがONの時のみ）
        if (debugMode) {
          console.log(`=== Device ${region.deviceIndex} Debug Info ===`);
          console.log('Frame:', debugInfo.frameName);
          console.log('Device Angle:', debugInfo.deviceAngle, '°');
          console.log('Region Size:', debugInfo.regionSize);
          console.log('Region Orientation:', debugInfo.regionOrientation);
          console.log('Corner Radius:', debugInfo.cornerRadius, 'px');
          console.log('Image Size:', { w: up.width, h: up.height });
          console.log('Image Orientation:', getOrientation(up.width, up.height));
          console.log('Orientation Matched:', !needsRotation);
          console.log('Needs Rotation:', needsRotation);
          console.log('Fit Mode:', 'cover');
          console.log('Original Mask Size:', { w: rw, h: rh });
          console.log('Canvas Size:', { w: canvasWidth, h: canvasHeight });
          console.log('Composite Canvas Size:', { w: comp.width, h: comp.height });
        }

        // 実際の領域パーセンテージと期待される座標
        if (frameNatural && region.rect) {
          const scale = Math.min(
            containerSize.w / frameNatural.w,
            containerSize.h / frameNatural.h
          );
          const displayWidth = frameNatural.w * scale;
          const displayHeight = frameNatural.h * scale;
          const offsetX = (containerSize.w - displayWidth) / 2;
          const offsetY = (containerSize.h - displayHeight) / 2;

          const expectedPixels = {
            x: Math.round(offsetX + region.rect.xPct * displayWidth),
            y: Math.round(offsetY + region.rect.yPct * displayHeight),
            width: Math.round(region.rect.wPct * displayWidth),
            height: Math.round(region.rect.hPct * displayHeight)
          };

          if (debugMode) {
            console.log('Expected Pixel Coords:', expectedPixels);
            console.log('Actual Canvas Size:', { width: canvasWidth, height: canvasHeight });
            console.log('Original Detection Size (Natural):', { width: rw, height: rh });

            if (Math.abs(expectedPixels.width - canvasWidth) > 5 || Math.abs(expectedPixels.height - canvasHeight) > 5) {
              console.error('🚨 SIZE MISMATCH DETECTED!');
              console.error('Expected:', expectedPixels.width, 'x', expectedPixels.height);
              console.error('Actual Canvas:', canvasWidth, 'x', canvasHeight);
              console.error('This will cause the image to not fit properly in the designated area!');
            }
          }
        }

        // デバッグ情報を保存
        deviceDebugInfoRef.current[region.deviceIndex] = debugInfo;
        debugLogRef.current.push(`device-${region.deviceIndex}: ${JSON.stringify(debugInfo)}`);

        let sourceImage: HTMLImageElement | HTMLCanvasElement = up;
        let sourceWidth = up.width;
        let sourceHeight = up.height;

        // 必要に応じて画像を回転
        if (needsRotation) {
          const rotCanvas = document.createElement('canvas');
          const rotCtx = rotCanvas.getContext('2d');
          if (rotCtx) {
            // 90度回転後のサイズ設定
            rotCanvas.width = up.height;
            rotCanvas.height = up.width;

            // 中心を移動して回転
            rotCtx.translate(rotCanvas.width / 2, rotCanvas.height / 2);
            rotCtx.rotate(Math.PI / 2);
            rotCtx.drawImage(up, -up.width / 2, -up.height / 2);

            sourceImage = rotCanvas;
            sourceWidth = rotCanvas.width;
            sourceHeight = rotCanvas.height;

            if (debugMode) {
              console.log('Image rotated 90°, new size:', { w: sourceWidth, h: sourceHeight });
            }
          }
        }

        // 検出領域に画像をフィット（coverモードのみ使用）
        const fitRect = coverSize(canvasWidth, canvasHeight, sourceWidth, sourceHeight);

        if (debugMode) {
          console.log('Fit Result:', {
            mode: 'cover',
            originalMaskSize: { rw, rh },
            canvasSize: { w: canvasWidth, h: canvasHeight },
            sourceSize: { w: sourceWidth, h: sourceHeight },
            fitRect
          });
        }

        // 画像を描画
        cctx.drawImage(sourceImage, fitRect.left, fitRect.top, fitRect.w, fitRect.h);

        // マスクで切り抜き（マスクを適切なサイズにスケール）
        cctx.globalCompositeOperation = 'destination-in';
        cctx.drawImage(mk, 0, 0, mk.width, mk.height, 0, 0, canvasWidth, canvasHeight);

        // 角丸を適用（canvasサイズに基づいて計算）
        const cornerRadius = getCornerRadius(canvasWidth, canvasHeight, selectedFrame?.category);
        if (cornerRadius > 0) {
          if (debugMode) {
            console.log('Applying corner radius:', cornerRadius, 'px');
          }

          cctx.globalCompositeOperation = 'destination-in';
          cctx.beginPath();

          // 角丸パスを作成（canvasサイズを使用）
          cctx.moveTo(cornerRadius, 0);
          cctx.lineTo(canvasWidth - cornerRadius, 0);
          cctx.quadraticCurveTo(canvasWidth, 0, canvasWidth, cornerRadius);
          cctx.lineTo(canvasWidth, canvasHeight - cornerRadius);
          cctx.quadraticCurveTo(canvasWidth, canvasHeight, canvasWidth - cornerRadius, canvasHeight);
          cctx.lineTo(cornerRadius, canvasHeight);
          cctx.quadraticCurveTo(0, canvasHeight, 0, canvasHeight - cornerRadius);
          cctx.lineTo(0, cornerRadius);
          cctx.quadraticCurveTo(0, 0, cornerRadius, 0);
          cctx.closePath();

          cctx.fillStyle = '#ffffff';
          cctx.fill();
        }

        cctx.globalCompositeOperation = 'source-over';

        const compositeUrl = comp.toDataURL('image/png');

        // 表示位置情報を計算
        let displayPosition = { x: 0, y: 0, width: canvasWidth, height: canvasHeight };
        if (frameNatural && region.rect) {
          const scale = Math.min(
            containerSize.w / frameNatural.w,
            containerSize.h / frameNatural.h
          );
          const displayWidth = frameNatural.w * scale;
          const displayHeight = frameNatural.h * scale;
          const offsetX = (containerSize.w - displayWidth) / 2;
          const offsetY = (containerSize.h - displayHeight) / 2;

          displayPosition = {
            x: Math.round(offsetX + region.rect.xPct * displayWidth),
            y: Math.round(offsetY + region.rect.yPct * displayHeight),
            width: canvasWidth,
            height: canvasHeight
          };
        }

        if (!isCancelled) {
          setDeviceRegions(prev => prev.map((r, idx) =>
            idx === deviceIndex ? { ...r, compositeUrl, displayPosition } : r
          ));
        }

        if (debugMode && !isCancelled) {
          console.log('===========================');
        }
      })();
    });

    return () => {
      isCancelled = true;
    };
  }, [imageUrls, selectedFrame?.id, containerSize.w, containerSize.h, frameNatural?.w, frameNatural?.h, debugMode, deviceRegions, feather]);

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

      {/* Debug Mode Toggle */}
      <div className="mt-2 flex items-center gap-2">
        <button
          onClick={() => setDebugMode(prev => !prev)}
          className={`px-3 py-1 rounded text-sm font-medium ${
            debugMode
              ? 'bg-red-500 text-white'
              : 'bg-gray-200 text-gray-700'
          }`}
        >
          デバッグモード: {debugMode ? 'ON' : 'OFF'}
        </button>
        <span className="text-xs text-gray-500">
          {debugMode ? 'コンソールにデバッグ情報を出力中' : 'クリックしてデバッグ情報を表示'}
        </span>
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

        {/* Debug mode toggle */}
        <label className="ml-4 flex items-center gap-2 text-sm">
          <input type="checkbox" checked={debugMode} onChange={(e) => setDebugMode(e.target.checked)} />
          <span className="text-orange-600 font-medium">🔍 デバッグモード</span>
        </label>
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
          {selectedFrame && frameNatural && (() => {
            // デバイスの奥行き順序を計算（Y座標とサイズに基づく）
            const sortedRegions = deviceRegions
              .map((region, idx) => ({ region, idx }))
              .filter(item => item.region.compositeUrl && item.region.rect)
              .sort((a, b) => {
                // Y座標が小さい（上にある）デバイスを後ろに
                const yDiff = (a.region.rect!.yPct - b.region.rect!.yPct) * 100;
                if (Math.abs(yDiff) > 5) return yDiff;

                // Y座標が近い場合は面積が大きいものを後ろに
                const areaA = a.region.rect!.wPct * a.region.rect!.hPct;
                const areaB = b.region.rect!.wPct * b.region.rect!.hPct;
                return areaB - areaA;
              });

            return sortedRegions.map(({ region, idx }, sortIndex) => {
              // displayPositionが存在する場合はそれを使用、なければ従来の計算方法を使用
              let sx, sy, sw, sh;
              if (region.displayPosition) {
                sx = region.displayPosition.x;
                sy = region.displayPosition.y;
                sw = region.displayPosition.width;
                sh = region.displayPosition.height;
              } else {
                const contain = containSize(containerSize.w, containerSize.h, frameNatural.w, frameNatural.h);
                sx = region.rect!.xPct * contain.w + contain.left;
                sy = region.rect!.yPct * contain.h + contain.top;
                sw = region.rect!.wPct * contain.w;
                sh = region.rect!.hPct * contain.h;
              }

              return (
                <div
                  key={idx}
                  style={{
                    position: 'absolute',
                    left: `${sx}px`,
                    top: `${sy}px`,
                    width: `${sw}px`,
                    height: `${sh}px`,
                    zIndex: 50 + sortIndex,  // ソート順でz-indexを設定
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
            });
          })()}

          {/* No image hint */}
          {!imageUrls.some(Boolean) && (
            <div className="absolute inset-0 flex items-center justify-center text-sm text-gray-600">
              画像未選択
            </div>
          )}
        </div>
      </div>

      {/* Debug information display */}
      {debugMode && (
        <div className="mt-4 p-4 bg-orange-50 border border-orange-300 rounded-lg">
          <h3 className="font-bold text-orange-800 mb-2">🔍 デバッグ情報</h3>
          <div className="space-y-2 text-sm font-mono">
            <div>Frame Natural: {frameNatural ? `${frameNatural.w}x${frameNatural.h}` : 'N/A'}</div>
            <div>Container: {containerSize.w}x{containerSize.h}</div>
            <div className="space-y-1">
              {deviceRegions.map((region, idx) => region.rect && (
                <div key={idx} className="pl-4 border-l-2 border-orange-300">
                  <div className="font-semibold" style={{ color: region.fillColor }}>Device {idx}:</div>
                  <div>Position: ({(region.rect.xPct * 100).toFixed(1)}%, {(region.rect.yPct * 100).toFixed(1)}%)</div>
                  <div>Size: {(region.rect.wPct * 100).toFixed(1)}% × {(region.rect.hPct * 100).toFixed(1)}%</div>
                  {region.imageNatural && (
                    <div>Image: {region.imageNatural.w}x{region.imageNatural.h}</div>
                  )}
                </div>
              ))}
            </div>
            <div className="text-orange-600 text-xs mt-2">
              ⚠️ コンソールで詳細なデバッグ情報を確認してください
            </div>
          </div>
        </div>
      )}

      {/* Debug button */}
      <DebugButton
        label="デバッグレポート生成"
        generateReport={() => {
          const data = {
            time: new Date().toISOString(),
            aspect,
            fitMode: 'cover' as const,
            container: containerSize,
            frame: selectedFrame ? {
              id: selectedFrame.id,
              name: selectedFrame.name,
              category: selectedFrame.category,
            } : null,
            frameNatural,
            deviceRegions: deviceRegions.map((r, idx) => ({
              deviceIndex: r.deviceIndex,
              rect: r.rect,
              corners: r.corners,
              isActive: r.isActive,
              hasImage: !!r.imageUrl,
              fillColor: r.fillColor,
              imageNatural: r.imageNatural,
              debugInfo: deviceDebugInfoRef.current[idx] || null,
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