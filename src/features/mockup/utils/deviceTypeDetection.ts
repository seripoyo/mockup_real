/**
 * デバイス種類検出ユーティリティ
 * サンプル画像から学習した特徴を基に、より正確なデバイス判定を行う
 */

import { ScreenRectPct } from '../types/frame';

export type DeviceType = 'laptop' | 'smartphone' | 'tablet' | 'unknown';

/**
 * デバイス種類の定義と特徴
 */
export const DeviceCharacteristics = {
  laptop: {
    // ラップトップ: 横長で、一般的に16:9または16:10のアスペクト比
    aspectRatioRange: { min: 1.3, max: 2.0 },
    typicalAspectRatios: [16/9, 16/10, 3/2],
    hasNotch: false,
    hasDynamicIsland: false,
    description: 'ノートPC - 横長のディスプレイ',
    orientation: 'landscape' as const,
  },
  smartphone: {
    // スマートフォン: 縦長で、ノッチやダイナミックアイランドを持つ可能性
    aspectRatioRange: { min: 0.4, max: 0.7 },
    typicalAspectRatios: [9/16, 9/19.5, 9/20, 10/16],
    hasNotch: true,
    hasDynamicIsland: true,
    description: 'スマートフォン - 縦長のディスプレイ、ノッチ/ダイナミックアイランド付き',
    orientation: 'portrait' as const,
  },
  tablet: {
    // タブレット: より正方形に近いアスペクト比
    aspectRatioRange: { min: 0.7, max: 1.3 },
    typicalAspectRatios: [3/4, 4/5, 1, 5/4, 4/3],
    hasNotch: false,
    hasDynamicIsland: false,
    description: 'タブレット - 正方形に近いディスプレイ',
    orientation: 'variable' as const, // 縦横どちらでも使用可能
  },
};

/**
 * アスペクト比からデバイス種類を判定（改良版）
 */
export function detectDeviceType(
  width: number,
  height: number,
  hasBlackCutout: boolean = false
): DeviceType {
  const aspectRatio = width / height;

  // ノッチ/ダイナミックアイランドがある場合は確実にスマートフォン
  // ただし、横長の場合はラップトップの可能性が高い
  if (hasBlackCutout && aspectRatio < 1.3) {
    console.log('🔍 Black cutout detected + Portrait aspect ratio -> Smartphone');
    return 'smartphone';
  }

  // 各デバイスタイプとの適合度を計算
  const scores: Record<DeviceType, number> = {
    laptop: 0,
    smartphone: 0,
    tablet: 0,
    unknown: 0,
  };

  // アスペクト比による基本スコア
  for (const [deviceType, chars] of Object.entries(DeviceCharacteristics) as [DeviceType, any][]) {
    if (deviceType === 'unknown') continue;

    const { aspectRatioRange, typicalAspectRatios } = chars;

    // 範囲内チェック
    if (aspectRatio >= aspectRatioRange.min && aspectRatio <= aspectRatioRange.max) {
      scores[deviceType] += 50; // 基本スコア

      // 典型的なアスペクト比との近さをボーナススコアとして追加
      for (const typical of typicalAspectRatios) {
        const difference = Math.abs(aspectRatio - typical);
        if (difference < 0.1) {
          scores[deviceType] += Math.max(0, 30 * (1 - difference / 0.1));
        }
      }
    }
  }

  // 特別ルール：極端なアスペクト比
  if (aspectRatio < 0.5) {
    scores.smartphone += 30; // 非常に縦長 = スマホの可能性高
  } else if (aspectRatio > 1.5) {
    scores.laptop += 40; // 横長 = ラップトップの可能性高（より強いスコア）
  } else if (aspectRatio > 1.35) {
    scores.laptop += 25; // やや横長 = ラップトップの可能性
  }

  // 最高スコアのデバイスを返す
  let maxScore = 0;
  let detectedType: DeviceType = 'unknown';

  for (const [type, score] of Object.entries(scores) as [DeviceType, number][]) {
    if (score > maxScore) {
      maxScore = score;
      detectedType = type;
    }
  }

  console.log('📊 Device type detection scores:', scores);
  console.log(`✅ Detected device type: ${detectedType} (score: ${maxScore})`);

  return detectedType;
}

/**
 * 画面領域情報からデバイス種類を検出（マスクデータ分析付き）
 */
export function detectDeviceTypeFromRegion(
  rect: ScreenRectPct,
  containerSize: { w: number; h: number },
  maskData?: ImageData
): { type: DeviceType; confidence: number; hasNotch: boolean } {
  // 実際のピクセルサイズを計算
  const actualWidth = rect.wPct * containerSize.w;
  const actualHeight = rect.hPct * containerSize.h;

  // マスクデータから黒い切り抜きを検出
  let hasNotch = false;
  if (maskData) {
    hasNotch = detectBlackCutout(maskData);
  }

  const type = detectDeviceType(actualWidth, actualHeight, hasNotch);

  // 信頼度を計算（0-100%）
  let confidence = 50; // 基本信頼度

  const aspectRatio = actualWidth / actualHeight;
  const chars = DeviceCharacteristics[type as keyof typeof DeviceCharacteristics];

  if (chars && type !== 'unknown') {
    // アスペクト比が範囲の中央に近いほど高信頼度
    const range = chars.aspectRatioRange;
    const center = (range.min + range.max) / 2;
    const deviation = Math.abs(aspectRatio - center) / (range.max - range.min);
    confidence += (1 - deviation) * 30;

    // ノッチ検出との一致
    if (type === 'smartphone' && hasNotch) {
      confidence += 20; // スマホでノッチ検出 = 高信頼度
    }

    confidence = Math.min(100, Math.max(0, confidence));
  }

  return { type, confidence, hasNotch };
}

/**
 * マスクデータから黒い切り抜き（ノッチ/ダイナミックアイランド）を検出
 */
export function detectBlackCutout(maskData: ImageData): boolean {
  const { data, width, height } = maskData;

  // アスペクト比を確認（横長の場合はラップトップの可能性が高い）
  const aspectRatio = width / height;
  if (aspectRatio > 1.4) {
    // 横長の場合はノッチなしと判定
    return false;
  }

  // 上部10%の領域をチェック（ノッチは通常上部の狭い領域にある）
  const checkHeight = Math.floor(height * 0.1);
  let blackPixelCount = 0;

  // 中央60%の幅のみをチェック（ノッチは通常中央にある）
  const checkStartX = Math.floor(width * 0.2);
  const checkEndX = Math.floor(width * 0.8);

  for (let y = 0; y < checkHeight; y++) {
    for (let x = checkStartX; x < checkEndX; x++) {
      const idx = (y * width + x) * 4;
      const luminance = 0.299 * data[idx] + 0.587 * data[idx + 1] + 0.114 * data[idx + 2];

      // 黒いピクセル（輝度30未満）
      if (luminance < 30) {
        blackPixelCount++;
      }
    }
  }

  // チェックした領域の5%以上が黒い場合、ノッチありと判定（より厳しい閾値）
  const checkArea = checkHeight * (checkEndX - checkStartX);
  const blackRatio = blackPixelCount / checkArea;
  const hasNotch = blackRatio > 0.05;

  if (hasNotch) {
    console.log('📱 Notch detected:', { blackRatio, aspectRatio });
  }

  return hasNotch;
}

/**
 * デバイスの向きを決定
 * @param deviceType デバイス種類
 * @param maskData マスクデータ（ノッチ位置検出用）
 * @param rect デバイス領域
 * @returns 推奨される画像の回転角度
 */
export function determineDeviceOrientation(
  deviceType: DeviceType,
  maskData?: ImageData,
  rect?: ScreenRectPct
): number {
  switch (deviceType) {
    case 'laptop':
      // ラップトップは回転不要（元画像が正しい向き）
      return 0;

    case 'smartphone':
      // スマートフォンはノッチの位置で判定
      if (maskData) {
        return detectNotchOrientation(maskData);
      }
      return 0; // デフォルトは縦向き

    case 'tablet':
      // タブレットは領域の形状で判定
      if (rect) {
        const aspectRatio = rect.wPct / rect.hPct;
        if (aspectRatio > 1) {
          // 横長の場合は横向き
          return 90;
        }
      }
      return 0; // デフォルトは縦向き

    default:
      return 0;
  }
}

/**
 * ノッチの位置から画像の回転角度を検出
 */
function detectNotchOrientation(maskData: ImageData): number {
  const { data, width, height } = maskData;

  // 各辺の黒いピクセル密度を計算
  const edgeDepth = 20;
  const edges = {
    top: 0,
    bottom: 0,
    left: 0,
    right: 0
  };

  // 上端
  for (let y = 0; y < Math.min(edgeDepth, height); y++) {
    for (let x = 0; x < width; x++) {
      const idx = (y * width + x) * 4;
      const lum = 0.299 * data[idx] + 0.587 * data[idx + 1] + 0.114 * data[idx + 2];
      if (lum < 30) edges.top++;
    }
  }

  // 下端
  for (let y = Math.max(0, height - edgeDepth); y < height; y++) {
    for (let x = 0; x < width; x++) {
      const idx = (y * width + x) * 4;
      const lum = 0.299 * data[idx] + 0.587 * data[idx + 1] + 0.114 * data[idx + 2];
      if (lum < 30) edges.bottom++;
    }
  }

  // 左端
  for (let x = 0; x < Math.min(edgeDepth, width); x++) {
    for (let y = 0; y < height; y++) {
      const idx = (y * width + x) * 4;
      const lum = 0.299 * data[idx] + 0.587 * data[idx + 1] + 0.114 * data[idx + 2];
      if (lum < 30) edges.left++;
    }
  }

  // 右端
  for (let x = Math.max(0, width - edgeDepth); x < width; x++) {
    for (let y = 0; y < height; y++) {
      const idx = (y * width + x) * 4;
      const lum = 0.299 * data[idx] + 0.587 * data[idx + 1] + 0.114 * data[idx + 2];
      if (lum < 30) edges.right++;
    }
  }

  // 最も黒いピクセルが多い辺がノッチのある辺
  const maxEdge = Math.max(edges.top, edges.bottom, edges.left, edges.right);

  // デバッグ用のログ
  console.log('🔄 Edge detection:', {
    top: edges.top,
    bottom: edges.bottom,
    left: edges.left,
    right: edges.right,
    maxEdge: maxEdge
  });

  if (maxEdge === edges.top) {
    return 0; // ノッチが上 = 回転不要
  } else if (maxEdge === edges.bottom) {
    return 180; // ノッチが下 = 180度回転
  } else if (maxEdge === edges.left) {
    // ノッチが左側にある場合、画像を180度回転させる
    return 180; // 180度回転に変更
  } else {
    // ノッチが右側にある場合も180度回転
    return 180; // 180度回転に変更
  }
}

/**
 * デバイス種類の表示名を取得
 */
export function getDeviceDisplayName(deviceType: DeviceType): string {
  const names: Record<DeviceType, string> = {
    laptop: 'ノートPC',
    smartphone: 'スマートフォン',
    tablet: 'タブレット',
    unknown: '不明なデバイス',
  };
  return names[deviceType] || '不明';
}

/**
 * デバイス種類に基づいた最適なブリード値を取得（改良版）
 */
export function getOptimalBleedForDevice(deviceType: DeviceType): number {
  const bleedValues: Record<DeviceType, number> = {
    laptop: 12,     // ラップトップは大きめのブリード
    smartphone: 5,  // スマホは小さめ
    tablet: 8,      // タブレットは中間
    unknown: 5,     // デフォルトは控えめ
  };
  return bleedValues[deviceType];
}