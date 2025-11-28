/**
 * デバイスの向き判定と変換に関するユーティリティ
 */

import type { ScreenRectPct } from '../types/frame';

export type Orientation = 'portrait' | 'landscape' | 'square';

/**
 * アスペクト比から向きを判定
 */
export function getOrientation(width: number, height: number): Orientation {
  const aspectRatio = width / height;

  // 閾値を少し緩めに設定（0.95-1.05をsquareとする）
  if (aspectRatio >= 0.95 && aspectRatio <= 1.05) {
    return 'square';
  } else if (aspectRatio < 0.95) {
    return 'portrait';
  } else {
    return 'landscape';
  }
}

/**
 * デバイス領域の向きを角度で表現
 * 上を0度として、時計回りに0-360度で表現
 * 縦向き（portrait）: 0度または180度
 * 横向き（landscape）: 90度または270度
 */
export function getDeviceAngle(rect: ScreenRectPct): number {
  const orientation = getOrientation(rect.wPct, rect.hPct);

  switch (orientation) {
    case 'portrait':
      return 0; // 縦向きは0度
    case 'landscape':
      return 90; // 横向きは90度
    case 'square':
      return 0; // 正方形は縦向き扱い
  }
}

/**
 * 画像とデバイス領域の向きが一致しているか判定
 */
export function isOrientationMatched(
  imageWidth: number,
  imageHeight: number,
  regionWidth: number,
  regionHeight: number
): boolean {
  const imageOrientation = getOrientation(imageWidth, imageHeight);
  const regionOrientation = getOrientation(regionWidth, regionHeight);

  // 正方形の場合は常に一致とする
  if (imageOrientation === 'square' || regionOrientation === 'square') {
    return true;
  }

  return imageOrientation === regionOrientation;
}

/**
 * デバイス領域の角丸半径を計算
 * デバイスのカテゴリーに基づいて適切な角丸を返す
 */
export function getCornerRadius(
  width: number,
  height: number,
  deviceCategory?: string
): number {
  const minDimension = Math.min(width, height);

  // カテゴリーに基づく角丸の割合
  if (deviceCategory === 'smartphone' || deviceCategory?.includes('phone')) {
    return minDimension * 0.08; // スマートフォンは8%
  } else if (deviceCategory === 'tablet') {
    return minDimension * 0.05; // タブレットは5%
  } else if (deviceCategory === 'laptop' || deviceCategory === 'desktop') {
    return minDimension * 0.02; // PCは2%
  }

  // デフォルトは3%
  return minDimension * 0.03;
}

/**
 * デバッグ用の詳細情報を生成
 */
export interface DeviceDebugInfo {
  frameName: string;
  deviceIndex: number;
  deviceAngle: number;
  regionSize: { width: number; height: number };
  regionOrientation: Orientation;
  cornerRadius: number;
  imageOrientation?: Orientation;
  imageSize?: { width: number; height: number };
  isOrientationMatched?: boolean;
  isFittingCorrectly?: boolean;
  fitMode?: 'contain' | 'cover';
}

export function generateDeviceDebugInfo(
  frameName: string,
  deviceIndex: number,
  rect: ScreenRectPct,
  containerSize: { w: number; h: number },
  imageNatural?: { w: number; h: number } | null,
  deviceCategory?: string,
  fitMode?: 'contain' | 'cover'
): DeviceDebugInfo {
  const regionWidth = rect.wPct * containerSize.w;
  const regionHeight = rect.hPct * containerSize.h;
  const regionOrientation = getOrientation(regionWidth, regionHeight);
  const deviceAngle = getDeviceAngle(rect);
  const cornerRadius = getCornerRadius(regionWidth, regionHeight, deviceCategory);

  const info: DeviceDebugInfo = {
    frameName,
    deviceIndex,
    deviceAngle,
    regionSize: {
      width: Math.round(regionWidth),
      height: Math.round(regionHeight),
    },
    regionOrientation,
    cornerRadius: Math.round(cornerRadius),
  };

  if (imageNatural) {
    const imageOrientation = getOrientation(imageNatural.w, imageNatural.h);
    const isMatched = isOrientationMatched(
      imageNatural.w,
      imageNatural.h,
      regionWidth,
      regionHeight
    );

    info.imageOrientation = imageOrientation;
    info.imageSize = {
      width: imageNatural.w,
      height: imageNatural.h,
    };
    info.isOrientationMatched = isMatched;
    info.isFittingCorrectly = true; // これは実際の描画後に更新する
    info.fitMode = fitMode;
  }

  return info;
}