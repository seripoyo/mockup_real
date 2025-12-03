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
 * アスペクト比と視覚的特徴からデバイス種類を判定（改良版）
 * device.mdの仕様に基づく視覚的特徴優先の判定
 * @param width 幅
 * @param height 高さ
 * @param hasBlackCutout ノッチ/ダイナミックアイランドの有無
 * @param hasKeyboard キーボードの有無
 */
export function detectDeviceType(
  width: number,
  height: number,
  hasBlackCutout: boolean = false,
  hasKeyboard: boolean = false
): DeviceType {
  const aspectRatio = width / height;

  console.log('🔍 Device type detection starting:', {
    aspectRatio: aspectRatio.toFixed(2),
    hasBlackCutout,
    hasKeyboard,
    width,
    height
  });

  // device.mdの判定フローに従った視覚的特徴による優先判定

  // 1. キーボード/水平な板がある → ラップトップ（最優先）
  if (hasKeyboard) {
    console.log('✅ Laptop detected: keyboard/horizontal plate found');
    return 'laptop';
  }

  // 2. 黒い切り抜き/楕円がある → スマートフォン
  if (hasBlackCutout) {
    console.log('✅ Smartphone detected: black cutout/notch found');
    return 'smartphone';
  }

  // 3. 視覚的特徴がない場合はアスペクト比による補助判定
  // device.mdの表に基づく範囲判定

  // ラップトップ: 1.3 - 2.0
  if (aspectRatio >= 1.3 && aspectRatio <= 2.0) {
    console.log('✅ Laptop detected by aspect ratio:', aspectRatio.toFixed(2));
    return 'laptop';
  }

  // スマートフォン: 0.4 - 0.7
  if (aspectRatio >= 0.4 && aspectRatio <= 0.7) {
    console.log('✅ Smartphone detected by aspect ratio:', aspectRatio.toFixed(2));
    return 'smartphone';
  }

  // タブレット: 0.7 - 1.3
  if (aspectRatio > 0.7 && aspectRatio < 1.3) {
    console.log('✅ Tablet detected by aspect ratio:', aspectRatio.toFixed(2));
    return 'tablet';
  }

  // エッジケースの処理
  if (aspectRatio < 0.4) {
    // 非常に縦長 → スマートフォンの可能性
    console.log('✅ Smartphone detected (very tall):', aspectRatio.toFixed(2));
    return 'smartphone';
  }

  if (aspectRatio > 2.0) {
    // 非常に横長 → ラップトップの可能性
    console.log('✅ Laptop detected (very wide):', aspectRatio.toFixed(2));
    return 'laptop';
  }

  console.log('⚠️ Unknown device type, defaulting to tablet');
  return 'tablet';
}

/**
 * 画面領域情報からデバイス種類を検出（マスクデータ分析付き）
 */
export function detectDeviceTypeFromRegion(
  rect: ScreenRectPct,
  containerSize: { w: number; h: number },
  maskData?: ImageData
): { type: DeviceType; confidence: number; hasNotch: boolean; hasKeyboard: boolean } {
  // 実際のピクセルサイズを計算
  const actualWidth = rect.wPct * containerSize.w;
  const actualHeight = rect.hPct * containerSize.h;

  // マスクデータから視覚的特徴を検出
  let hasNotch = false;
  let hasKeyboard = false;

  if (maskData) {
    hasNotch = detectBlackCutout(maskData);
    hasKeyboard = detectKeyboard(maskData);
  }

  const type = detectDeviceType(actualWidth, actualHeight, hasNotch, hasKeyboard);

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

    // 視覚的特徴による信頼度ブースト
    if (type === 'laptop' && hasKeyboard) {
      confidence += 30; // ラップトップでキーボード検出 = 高信頼度
    }
    if (type === 'smartphone' && hasNotch) {
      confidence += 30; // スマホでノッチ検出 = 高信頼度
    }

    confidence = Math.min(100, Math.max(0, confidence));
  }

  console.log('🎯 Device type detection result:', {
    type,
    confidence: `${confidence.toFixed(1)}%`,
    hasNotch,
    hasKeyboard,
    aspectRatio: aspectRatio.toFixed(2)
  });

  return { type, confidence, hasNotch, hasKeyboard };
}

/**
 * マスク画像からキーボードの存在を検出（ラップトップ判定用）
 * ラップトップの場合、画面の下部に黒い横長の領域（キーボード/水平な板）が存在する
 * device.mdの仕様: 「下部にキーボードまたは水平な板が必ず存在」
 */
export function detectKeyboard(maskData: ImageData): boolean {
  const { data, width, height } = maskData;

  // アスペクト比を確認（横長でない場合はキーボードなし）
  const aspectRatio = width / height;
  if (aspectRatio < 1.2) {
    return false;
  }

  // 下部25%の領域をチェック（キーボードは画面下にある）
  const checkStartY = Math.floor(height * 0.75);
  let blackPixelCount = 0;
  let totalPixelCount = 0;

  // 中央70%の幅をチェック（キーボードは中央に配置）
  const checkStartX = Math.floor(width * 0.15);
  const checkEndX = Math.floor(width * 0.85);

  // 横方向の黒いピクセルの連続性を確認
  let hasHorizontalBlackStripe = false;

  for (let y = checkStartY; y < height; y++) {
    let rowBlackCount = 0;
    for (let x = checkStartX; x < checkEndX; x++) {
      const idx = (y * width + x) * 4;
      const luminance = 0.299 * data[idx] + 0.587 * data[idx + 1] + 0.114 * data[idx + 2];

      totalPixelCount++;
      // 黒いピクセル（輝度80未満に緩和）
      if (luminance < 80) {
        blackPixelCount++;
        rowBlackCount++;
      }
    }

    // この行の50%以上が黒い場合、横縞があると判定
    const rowWidth = checkEndX - checkStartX;
    if (rowBlackCount > rowWidth * 0.5) {
      hasHorizontalBlackStripe = true;
    }
  }

  // チェック領域の40%以上が黒い、または横縞がある場合、キーボードありと判定
  const blackRatio = totalPixelCount > 0 ? blackPixelCount / totalPixelCount : 0;
  const hasKeyboard = blackRatio > 0.4 || hasHorizontalBlackStripe;

  if (hasKeyboard) {
    console.log('⌨️ Keyboard/horizontal plate detected (laptop feature):', {
      blackRatio: blackRatio.toFixed(3),
      blackPixels: blackPixelCount,
      totalPixels: totalPixelCount,
      hasHorizontalStripe: hasHorizontalBlackStripe,
      aspectRatio: aspectRatio.toFixed(2)
    });
  }

  return hasKeyboard;
}

/**
 * マスクデータから黒い切り抜き（ノッチ/ダイナミックアイランド）を検出
 */
export function detectBlackCutout(maskData: ImageData): boolean {
  const { data, width, height } = maskData;

  // アスペクト比を確認
  const aspectRatio = width / height;

  // 横長の場合はノッチなしと判定（ラップトップの可能性）
  if (aspectRatio > 1.2) {
    return false;
  }

  // 上部15%の領域をチェック（ノッチは通常上部の狭い領域にある）
  const checkHeight = Math.floor(height * 0.15);
  let blackPixelCount = 0;
  let totalPixelCount = 0;

  // 中央70%の幅のみをチェック（ノッチは通常中央にある）
  const checkStartX = Math.floor(width * 0.15);
  const checkEndX = Math.floor(width * 0.85);

  for (let y = 0; y < checkHeight; y++) {
    for (let x = checkStartX; x < checkEndX; x++) {
      const idx = (y * width + x) * 4;
      const luminance = 0.299 * data[idx] + 0.587 * data[idx + 1] + 0.114 * data[idx + 2];

      totalPixelCount++;
      // 黒いピクセル（輝度30未満）
      if (luminance < 30) {
        blackPixelCount++;
      }
    }
  }

  // チェックした領域の3%以上が黒い場合、ノッチありと判定
  const blackRatio = totalPixelCount > 0 ? blackPixelCount / totalPixelCount : 0;
  const hasNotch = blackRatio > 0.03;

  if (hasNotch) {
    console.log('📱 Notch detected (smartphone feature):', {
      blackRatio: blackRatio.toFixed(3),
      aspectRatio: aspectRatio.toFixed(2),
      blackPixels: blackPixelCount,
      totalPixels: totalPixelCount
    });
  }

  return hasNotch;
}

/**
 * デバイスの縦方向（矢印方向）を検出
 * device.mdの仕様に基づく判定
 * @param deviceType デバイス種類
 * @param deviceAspectRatio デバイス領域のアスペクト比
 * @returns 矢印の方向（'up', 'right', 'diagonal-up'）
 */
export function detectDeviceVerticalDirection(
  deviceType: DeviceType,
  deviceAspectRatio: number
): 'up' | 'right' | 'diagonal-up' {
  console.log('🧭 Detecting device vertical direction:', {
    deviceType,
    deviceAspectRatio: deviceAspectRatio.toFixed(2)
  });

  switch (deviceType) {
    case 'laptop':
      // ラップトップ：矢印は常に上向き（↑）
      return 'up';

    case 'smartphone':
      if (deviceAspectRatio < 1.0) {
        // 縦向きの場合：矢印は上向き（↑）
        return 'up';
      } else {
        // 横向きの場合：矢印は横向き（→）
        return 'right';
      }

    case 'tablet':
      if (deviceAspectRatio < 0.9) {
        // 縦向きの場合：矢印は上向き（↑）
        return 'up';
      } else if (deviceAspectRatio > 1.1) {
        // 横向きの場合：矢印は斜め上向き（↗）
        return 'diagonal-up';
      } else {
        // ほぼ正方形：デフォルトは上向き
        return 'up';
      }

    default:
      return 'up';
  }
}

/**
 * デバイスの向きを決定（改良版）
 * デバイスの縦方向に合わせて画像を適切に配置
 * @param deviceType デバイス種類
 * @param maskData マスクデータ（ノッチ位置検出用）
 * @param rect デバイス領域
 * @param imageNatural ユーザーがアップロードした画像のサイズ
 * @returns 推奨される画像の回転角度
 */
export function determineDeviceOrientation(
  deviceType: DeviceType,
  _maskData?: ImageData,
  rect?: ScreenRectPct,
  imageNatural?: { w: number; h: number }
): number {
  // デバイス領域のアスペクト比を計算
  let deviceAspectRatio = 1;
  if (rect) {
    deviceAspectRatio = rect.wPct / rect.hPct;
  }

  // アップロード画像のアスペクト比を計算
  let imageAspectRatio = 1;
  if (imageNatural) {
    imageAspectRatio = imageNatural.w / imageNatural.h;
  }

  // デバイスの縦方向を検出
  const verticalDirection = detectDeviceVerticalDirection(deviceType, deviceAspectRatio);

  console.log('🔄 Orientation detection:', {
    deviceType,
    deviceAspectRatio: deviceAspectRatio.toFixed(2),
    imageAspectRatio: imageNatural ? imageAspectRatio.toFixed(2) : 'N/A',
    verticalDirection
  });

  // 縦方向に基づいて画像の回転を決定
  switch (verticalDirection) {
    case 'up':
      // 矢印が上向き：デバイスは縦向き
      if (deviceAspectRatio < 1.0) {
        // デバイスが縦長
        if (imageNatural && imageAspectRatio > 1.2) {
          // 画像が横長 → 90度回転して縦にする
          console.log('🔄 Rotating landscape image 90° to match vertical device');
          return 90;
        }
      } else {
        // デバイスが横長（ラップトップ等）
        if (imageNatural && imageAspectRatio < 0.8) {
          // 画像が縦長 → 90度回転して横にする
          console.log('🔄 Rotating portrait image 90° to match horizontal device');
          return 90;
        }
      }
      return 0;

    case 'right':
      // 矢印が横向き：デバイスは横向き（横向きスマホ）
      if (imageNatural && imageAspectRatio < 0.8) {
        // 画像が縦長 → 90度回転して横にする
        console.log('🔄 Rotating portrait image 90° to match horizontal smartphone');
        return 90;
      }
      return 0;

    case 'diagonal-up':
      // 矢印が斜め上：デバイスは横向き（横向きタブレット）
      if (imageNatural && imageAspectRatio < 0.9) {
        // 画像が縦長 → 90度回転して横にする
        console.log('🔄 Rotating portrait image 90° to match horizontal tablet');
        return 90;
      }
      return 0;

    default:
      return 0;
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