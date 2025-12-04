/**
 * デバイス種類の詳細分析ユーティリティ
 * デバイス判定の理由を含む詳細な分析結果を提供
 */

export interface DeviceAnalysisResult {
  deviceType: 'laptop' | 'smartphone' | 'tablet' | 'unknown';
  confidence: number;
  aspectRatio: number;
  orientation: 'portrait' | 'landscape' | 'square';
  dimensions: {
    widthPercent: number;
    heightPercent: number;
    pixelArea: number;
  };
  reasoning: {
    primary: string;
    factors: string[];
    scores: {
      aspectRatioScore: number;
      sizeScore: number;
      orientationScore: number;
      totalScore: number;
    };
  };
  detectionSteps: string[];
}

/**
 * アスペクト比とビジュアル特徴からデバイスタイプを判定する詳細分析
 * DEVICE_DETECTION_SPEC.md に基づいて実装
 */
export function analyzeDeviceType(
  rect: { xPct: number; yPct: number; wPct: number; hPct: number } | null,
  frameWidth?: number,
  frameHeight?: number,
  visualFeatures?: { hasKeyboard?: boolean; hasNotch?: boolean }
): DeviceAnalysisResult {
  const steps: string[] = [];
  const factors: string[] = [];

  // デフォルト値
  if (!rect) {
    steps.push('❌ No rect data provided - cannot analyze device');
    return {
      deviceType: 'unknown',
      confidence: 0,
      aspectRatio: 0,
      orientation: 'portrait',
      dimensions: { widthPercent: 0, heightPercent: 0, pixelArea: 0 },
      reasoning: {
        primary: 'No device region data available',
        factors: ['Missing rect data'],
        scores: {
          aspectRatioScore: 0,
          sizeScore: 0,
          orientationScore: 0,
          totalScore: 0
        }
      },
      detectionSteps: steps
    };
  }

  steps.push(`📏 Starting device analysis for region at (${(rect.xPct * 100).toFixed(1)}%, ${(rect.yPct * 100).toFixed(1)}%)`);

  // Step 1: 基本寸法の計算
  const widthPercent = rect.wPct * 100;
  const heightPercent = rect.hPct * 100;
  const aspectRatio = rect.wPct / rect.hPct;
  const pixelArea = widthPercent * heightPercent;

  steps.push(`📐 Dimensions: ${widthPercent.toFixed(1)}% × ${heightPercent.toFixed(1)}% = ${pixelArea.toFixed(1)}% area`);
  steps.push(`📊 Aspect ratio: ${aspectRatio.toFixed(3)} (width/height)`);

  // Step 2: 向きの判定
  let orientation: 'portrait' | 'landscape' | 'square';
  if (aspectRatio < 0.95) {
    orientation = 'portrait';
    steps.push(`📱 Orientation: PORTRAIT (aspect ratio < 0.95)`);
    factors.push('Portrait orientation detected');
  } else if (aspectRatio > 1.05) {
    orientation = 'landscape';
    steps.push(`💻 Orientation: LANDSCAPE (aspect ratio > 1.05)`);
    factors.push('Landscape orientation detected');
  } else {
    orientation = 'square';
    steps.push(`⬜ Orientation: SQUARE (0.95 ≤ aspect ratio ≤ 1.05)`);
    factors.push('Square/nearly square shape');
  }

  // Step 3: ビジュアル特徴の優先チェック（DEVICE_DETECTION_SPEC.mdに基づく）
  let hasKeyboard = visualFeatures?.hasKeyboard || false;
  let hasNotch = visualFeatures?.hasNotch || false;

  // キーボード検出シミュレーション（横長でサイズが大きい場合）
  if (!hasKeyboard && aspectRatio > 1.4 && pixelArea > 2500) {
    // 横長で大きいデバイスはラップトップの可能性が高い
    hasKeyboard = true;
    steps.push(`⌨️ キーボードあり推定（横長 + 大画面）`);
    factors.push('横長配置によりキーボード存在を推定');
  }

  // ノッチ検出シミュレーション（縦長で細い場合）
  if (!hasNotch && aspectRatio < 0.6 && widthPercent < 35) {
    // 縦長で細いデバイスはスマートフォンの可能性が高い
    hasNotch = true;
    steps.push(`📱 ノッチあり推定（縦長 + 狭い幅）`);
    factors.push('縦長配置によりノッチ存在を推定');
  }

  // Step 4: デバイスタイプのスコアリング（視覚特徴を最優先）
  let laptopScore = 0;
  let smartphoneScore = 0;
  let tabletScore = 0;

  steps.push(`\n🎯 Device Type Scoring:`);

  // 第1優先: キーボードチェック
  if (hasKeyboard) {
    laptopScore += 100; // 確定的なスコア
    steps.push(`  ⌨️ ノートPC確定: キーボード検出 (+100点)`);
    factors.push('⌨️ キーボード検出 - ノートPC確定');
  }
  // 第2優先: ノッチチェック
  else if (hasNotch) {
    smartphoneScore += 100; // 確定的なスコア
    steps.push(`  📱 スマホ確定: ノッチ検出 (+100点)`);
    factors.push('📱 ノッチ検出 - スマートフォン確定');
  }
  // 第3優先: アスペクト比による判定
  else {
    // アスペクト比によるスコアリング（改善版）
    if (aspectRatio > 1.5) {
      laptopScore += 70;
      steps.push(`  💻 Laptop +70pts: Wide aspect ratio (${aspectRatio.toFixed(2)} > 1.5)`);
      factors.push(`Wide aspect ratio typical of laptops (${aspectRatio.toFixed(2)})`);
    } else if (aspectRatio > 1.35) {
      laptopScore += 50;
      steps.push(`  💻 Laptop +50pts: Moderate landscape (1.35 < ${aspectRatio.toFixed(2)} < 1.5)`);
      factors.push('Moderate landscape ratio - likely laptop');
    } else if (aspectRatio >= 0.7 && aspectRatio <= 1.35) {
      tabletScore += 40;
      steps.push(`  📱 Tablet +40pts: Tablet-like ratio (0.7 ≤ ${aspectRatio.toFixed(2)} ≤ 1.35)`);
      factors.push('Aspect ratio typical of tablets');
    } else if (aspectRatio < 0.6) {
      smartphoneScore += 70;
      steps.push(`  📱 Smartphone +70pts: Tall portrait (${aspectRatio.toFixed(2)} < 0.6)`);
      factors.push(`Tall portrait ratio typical of smartphones (${aspectRatio.toFixed(2)})`);
    } else if (aspectRatio < 0.7) {
      smartphoneScore += 50;
      steps.push(`  📱 Smartphone +50pts: Portrait (0.6 ≤ ${aspectRatio.toFixed(2)} < 0.7)`);
      factors.push('Portrait ratio - likely smartphone');
    }

  }

  // サイズによる補助スコアリング（ビジュアル特徴がない場合のみ重要）
  if (!hasKeyboard && !hasNotch) {
    steps.push(`\n📏 Size-based scoring (area = ${pixelArea.toFixed(1)}%):`);

    if (pixelArea > 3000) {
      laptopScore += 30;
      steps.push(`  💻 Laptop +30pts: Large screen area (> 3000%)`);
      factors.push('Large screen area suggests laptop');
    } else if (pixelArea > 1500) {
      tabletScore += 25;
      laptopScore += 15;
      steps.push(`  📱 Tablet +25pts, Laptop +15pts: Medium-large area (1500-3000%)`);
      factors.push('Medium to large screen area');
    } else if (pixelArea > 800) {
      tabletScore += 20;
      smartphoneScore += 10;
      steps.push(`  📱 Tablet +20pts, Phone +10pts: Medium area (800-1500%)`);
      factors.push('Medium screen area');
    } else {
      smartphoneScore += 25;
      steps.push(`  📱 Smartphone +25pts: Small area (< 800%)`);
      factors.push('Small screen area typical of smartphones');
    }

    // 幅による追加スコアリング
    steps.push(`\n📐 Width-based scoring (${widthPercent.toFixed(1)}% width):`);

    if (widthPercent > 50) {
      laptopScore += 20;
      steps.push(`  💻 Laptop +20pts: Wide screen (> 50% frame width)`);
      factors.push('Wide screen relative to frame');
    } else if (widthPercent < 35) {
      smartphoneScore += 20;
      steps.push(`  📱 Smartphone +20pts: Narrow screen (< 35% frame width)`);
      factors.push('Narrow screen typical of smartphones');
    } else {
      tabletScore += 10;
      steps.push(`  📱 Tablet +10pts: Medium width (35-50% frame width)`);
    }
  }

  // Step 4: 最終スコアと判定
  const totalScores = {
    laptop: laptopScore,
    smartphone: smartphoneScore,
    tablet: tabletScore
  };

  steps.push(`\n🏆 Final Scores:`);
  steps.push(`  💻 Laptop: ${laptopScore}pts`);
  steps.push(`  📱 Smartphone: ${smartphoneScore}pts`);
  steps.push(`  📱 Tablet: ${tabletScore}pts`);

  // 最高スコアのデバイスタイプを決定
  let deviceType: 'laptop' | 'smartphone' | 'tablet' | 'unknown';
  let maxScore = Math.max(laptopScore, smartphoneScore, tabletScore);
  let confidence = 0;

  if (maxScore === 0) {
    deviceType = 'unknown';
    confidence = 0;
    steps.push(`\n❓ Result: UNKNOWN - No clear device type detected`);
  } else if (laptopScore === maxScore) {
    deviceType = 'laptop';
    confidence = laptopScore / 100;
    steps.push(`\n💻 Result: LAPTOP (confidence: ${(confidence * 100).toFixed(0)}%)`);
  } else if (smartphoneScore === maxScore) {
    deviceType = 'smartphone';
    confidence = smartphoneScore / 100;
    steps.push(`\n📱 Result: SMARTPHONE (confidence: ${(confidence * 100).toFixed(0)}%)`);
  } else {
    deviceType = 'tablet';
    confidence = tabletScore / 100;
    steps.push(`\n📱 Result: TABLET (confidence: ${(confidence * 100).toFixed(0)}%)`);
  }

  // 判定理由のサマリー（ビジュアル特徴を優先）
  let primaryReason = '';
  if (deviceType === 'laptop') {
    if (hasKeyboard) {
      primaryReason = `⌨️ キーボード検出 - ノートパソコン確定`;
    } else {
      primaryReason = `横長画面 (アスペクト比: ${aspectRatio.toFixed(2)}) と大画面サイズ`;
    }
  } else if (deviceType === 'smartphone') {
    if (hasNotch) {
      primaryReason = `📱 ノッチ検出 - スマートフォン確定`;
    } else {
      primaryReason = `縦長画面 (アスペクト比: ${aspectRatio.toFixed(2)}) と狭い画面幅`;
    }
  } else if (deviceType === 'tablet') {
    primaryReason = `中間的なアスペクト比 (${aspectRatio.toFixed(2)}) と中サイズ画面`;
  } else {
    primaryReason = '利用可能なデータからデバイスタイプを判定できません';
  }

  return {
    deviceType,
    confidence: Math.min(confidence, 1),
    aspectRatio,
    orientation,
    dimensions: {
      widthPercent,
      heightPercent,
      pixelArea
    },
    reasoning: {
      primary: primaryReason,
      factors,
      scores: {
        aspectRatioScore: Math.max(
          laptopScore > 0 && aspectRatio > 1.3 ? 50 : 0,
          smartphoneScore > 0 && aspectRatio < 0.7 ? 50 : 0,
          tabletScore > 0 ? 40 : 0
        ),
        sizeScore: Math.max(
          laptopScore > 0 && pixelArea > 3000 ? 30 : 0,
          smartphoneScore > 0 && pixelArea < 800 ? 25 : 0,
          tabletScore > 0 ? 20 : 0
        ),
        orientationScore: orientation === 'landscape' ? laptopScore / 2 :
                         orientation === 'portrait' ? smartphoneScore / 2 :
                         tabletScore / 2,
        totalScore: maxScore
      }
    },
    detectionSteps: steps
  };
}

/**
 * 複数デバイスの相対的な位置関係を分析
 */
export function analyzeDeviceLayout(regions: any[]): string[] {
  const analysis: string[] = [];

  if (regions.length === 0) {
    analysis.push('No devices detected in frame');
    return analysis;
  }

  if (regions.length === 1) {
    analysis.push('Single device configuration');
    return analysis;
  }

  // 複数デバイスの配置パターンを分析
  analysis.push(`${regions.length} devices detected in frame`);

  // Y座標でソート（上から下）
  const sortedByY = [...regions].sort((a, b) =>
    (a.rect?.yPct || 0) - (b.rect?.yPct || 0)
  );

  // X座標でソート（左から右）
  const sortedByX = [...regions].sort((a, b) =>
    (a.rect?.xPct || 0) - (b.rect?.xPct || 0)
  );

  // 縦並びか横並びかを判定
  const verticalSpread = Math.abs(
    (sortedByY[sortedByY.length - 1].rect?.yPct || 0) -
    (sortedByY[0].rect?.yPct || 0)
  );

  const horizontalSpread = Math.abs(
    (sortedByX[sortedByX.length - 1].rect?.xPct || 0) -
    (sortedByX[0].rect?.xPct || 0)
  );

  if (verticalSpread > horizontalSpread * 1.5) {
    analysis.push('Devices arranged VERTICALLY (stacked)');
  } else if (horizontalSpread > verticalSpread * 1.5) {
    analysis.push('Devices arranged HORIZONTALLY (side-by-side)');
  } else {
    analysis.push('Devices arranged DIAGONALLY or in GRID pattern');
  }

  return analysis;
}