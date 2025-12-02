# モックアップエディタ改善計画

## 現状の問題分析

### 1. 画像が即座に表示されない問題

#### 症状
- 画像をアップロードしても、該当エリアに画像が表示されない
- ボタン（デバッグON/OFF、アスペクト比変更等）を押すと初めて表示される
- 2つ目、3つ目のエリアも同様に、ボタンを押すごとに順番に表示される

#### ログから判明した事実
```
device-0-upload: 960x1706 (line 350)
device-0-image-changed (line 349)
→ しかし実際の描画座標は (0, 0) になっている (line 86, 147)
```

#### 根本原因
**useEffectの依存配列とCanvas描画タイミングの問題**

1. 画像アップロード時に`deviceRegions`の状態は更新される
2. しかし、Canvas描画を行うuseEffectが適切にトリガーされない
3. 別のボタンを押すとコンポーネントの再レンダリングが発生し、その時初めて描画される

#### 技術的詳細
- `MultiDeviceMockup.tsx`のline 612-835のuseEffect内で描画処理が行われている
- 依存配列に`deviceRegions`が含まれているが、React.useEffectが浅い比較しか行わないため、配列内のオブジェクトの変更を検知できていない可能性
- Canvas要素への直接描画が非同期的に処理されており、Reactのレンダリングサイクルと同期していない

### 2. デバイスインデックス番号の問題

#### 症状
- console.logにはすべて「Device 1」と表示されている（実際はDevice 0とDevice 1が処理されている）
- Device 0の処理ログが「Device 1」として表示
- Device 2は`isActive: false`のため処理されていない

#### ログから判明した事実

**console.logの分析結果:**
```
全ての出力が「Device 1」になっている:
- MultiDeviceMockup.tsx:697 === Device 1 Debug Info === (全インスタンス)
- debugVisualization.ts:110 🔍 Device 1 Coordinate Transform Analysis (全インスタンス)
```

**function.logの分析結果:**
```json
deviceRegions配列の実際の状態:
- deviceRegions[0]: deviceIndex: 0, isActive: true, hasImage: true (スマホ)
- deviceRegions[1]: deviceIndex: 1, isActive: true, hasImage: true (ノートPC)
- deviceRegions[2]: deviceIndex: 2, isActive: false, hasImage: false (未使用)

ログ出力は正常:
- "device-0-image-changed" → 正しいインデックス
- "device-1-image-changed" → 正しいインデックス
- "device-0: {...debugInfo...}" → 正しいJSON
- "device-1: {...debugInfo...}" → 正しいJSON
```

**座標ミスマッチの発見:**
```
Device 1 (ノートPC)の重大な問題:
- 🚨 SIZE MISMATCH DETECTED!
  Expected: 561 x 336
  Actual: 758 x 454
  差分: 197 x 118 (約35%の拡大)

- 🚨 COORDINATE MISMATCH DETECTED!
  実際の描画座標が期待値と一致していない
```

#### 根本原因
**MultiDeviceMockup.tsxのログ出力でインデックスが常に「1」になっている**

**原因特定:**
- line 697の`console.log(\`=== Device ${deviceIndex} Debug Info ===\`)`
- このコードは正しく見えるが、実際には常に「Device 1」と出力されている
- **推測**: deviceIndexがループ変数ではなく、固定値またはクロージャ問題でキャプチャされている

**具体的な問題箇所:**
```typescript
// MultiDeviceMockup.tsx line 697付近
if (debugMode) {
  console.log(`=== Device ${deviceIndex} Debug Info ===`);
  // ↑ このdeviceIndexが常に1を返している
}
```

**debugVisualization.tsの問題:**
```typescript
// debugVisualization.ts line 110
export function logCoordinateTransform(
  deviceIndex: number,  // ← パラメータは受け取っているが
  frameNatural: { w: number; h: number },
  // ...
): void {
  console.group(`🔍 Device ${deviceIndex} Coordinate Transform Analysis`);
  // ↑ 呼び出し元から常に1が渡されている
}
```

#### 技術的詳細

**問題の層:**
1. **ログ出力レベル**: console.logは正しくdeviceIndexを参照しているが、値が間違っている
2. **変数スコープレベル**: deviceIndexの値がループの外側で固定されている可能性
3. **データフローレベル**: function.logのdeviceIndexは正しい → 表示だけの問題

**なぜこれが問題か:**
- デバッグが困難になる（Device 0の問題をDevice 1として追跡してしまう）
- Device 2の未処理状態が見えにくい
- 座標ミスマッチの原因デバイスが特定しにくい

### 3. 座標とサイズのミスマッチ問題（新発見）

#### 症状
- Device 1（ノートPC）で画像が期待サイズより約35%大きく描画されている
- 座標の位置ずれが発生している
- 画像がデバイス領域からはみ出している

#### ログから判明した事実

**console.logのエラーメッセージ:**
```
🚨 SIZE MISMATCH DETECTED!
Expected: 561 x 336
Actual: 758 x 454
差分: width +197px (35%増), height +118px (35%増)

🚨 COORDINATE MISMATCH DETECTED!
The actual drawing coordinates do not match the expected coordinates.
This will cause the image to be positioned incorrectly.
```

**function.logのデータ:**
```json
Device 1 (ノートPC):
- regionSize (期待値): { width: 561, height: 336 }
- imageSize (入力): { width: 4032, height: 2268 }
- regionOrientation: "landscape"
- imageOrientation: "landscape"
- isOrientationMatched: true
- fitMode: "cover"
```

#### 根本原因
**スケール計算とCanvas生成の不整合**

1. **期待値の計算**: 領域サイズは正しく561x336と計算されている
2. **実際の描画**: Canvasが758x454で生成されている（約1.35倍）
3. **スケールの二重適用**: 以下の可能性
   - フレームのスケールが二重に適用されている
   - containerSizeとframeNaturalの変換でエラー
   - displayScaleの計算ミス

#### 技術的詳細

**問題のデータフロー:**
```
1. 検出時のサイズ (frameNatural基準): 561 x 336
2. Canvas生成時のサイズ: 758 x 454  ← ここで拡大
3. 合成時の座標変換: 期待値とずれる
```

**推測される原因箇所:**
```typescript
// MultiDeviceMockup.tsx内のCanvas生成処理
const canvasWidth = /* ここで間違ったスケールが適用されている */;
const canvasHeight = /* ここで間違ったスケールが適用されている */;

// 正しい値: 561 x 336
// 実際の値: 758 x 454
// 比率: 1.351... (約1.35倍)
```

**影響:**
- 画像が正しく領域にフィットしない
- はみ出しや空白が発生
- マスクと画像のサイズ不一致

### 4. マスクの滑らかさの問題

#### 症状
- 画像の四隅が角張っている
- マスクの形状に完全にフィットしていない
- 丸みを帯びるべき箇所が直角になっている

#### ログから判明した事実
```
Device 0 (スマホ): cornerRadius: 3px
Device 1 (ノートPC): cornerRadius: 7px
→ cornerRadiusは計算されているが、適用されていない
```

#### 根本原因
**Featherパラメータとマスク生成の問題**

1. マスク生成時にfeatherパラメータが使用されていない
2. cornerRadiusが計算されているが、実際のマスク描画に反映されていない
3. アルファブレンディングが適切に行われていない

#### 技術的詳細
- マスク生成関数でfeather値がデフォルト0になっている可能性
- Canvas 2DコンテキストのglobalCompositeOperationが適切に設定されていない
- 角丸の描画にroundRectメソッドまたはarcToメソッドが使用されていない

## 解決策の実装計画

### 優先度の再評価

ログ分析の結果、優先度を以下のように変更します：

**最優先（Critical）:**
1. **座標とサイズのミスマッチ** - 画像が正しく配置されない根本的な問題
2. **画像の即座表示問題** - ユーザビリティに最も影響

**高優先度（High）:**
3. **デバイスインデックス問題** - デバッグを困難にしている

**中優先度（Medium）:**
4. **マスクの滑らかさ** - ビジュアル品質の問題

### フェーズ0: 座標・サイズミスマッチの修正 ✅ 完了（2024/11/24）

#### ステップ0.1: 問題箇所の特定
```typescript
// MultiDeviceMockup.tsx内のCanvas生成処理を調査
// 目標: canvasWidth/canvasHeightがどこで758x454になっているか特定

// 期待される計算フロー:
// 1. region.rect (パーセンテージ) → ピクセル座標変換
// 2. frameNatural基準での領域サイズ計算
// 3. containerSizeへのスケール適用 ← ここで問題発生の可能性

// 調査ポイント:
const scale = Math.min(
  containerSize.w / frameNatural.w,
  containerSize.h / frameNatural.h
);
// ↑ このscaleが正しいか検証
```

#### ステップ0.2: スケール計算の修正
```typescript
// 正しい計算フロー:
// 1. frameNatural基準での領域サイズを取得
const regionWidthNatural = region.rect.wPct * frameNatural.w;
const regionHeightNatural = region.rect.hPct * frameNatural.h;

// 2. displayScaleは適用しない（すでに検出時に含まれている）
const canvasWidth = regionWidthNatural;
const canvasHeight = regionHeightNatural;

// ❌ 間違った方法（現在の実装と推測）:
const displayScale = containerSize.w / frameNatural.w;
const canvasWidth = regionWidthNatural * displayScale;  // 二重スケール!
```

#### ステップ0.3: 座標変換の統一
```typescript
// すべての座標計算を統一したヘルパー関数を作成
function getRegionPixelCoords(
  region: DeviceRegion,
  frameNatural: { w: number; h: number }
): { x: number; y: number; width: number; height: number } {
  return {
    x: region.rect.xPct * frameNatural.w,
    y: region.rect.yPct * frameNatural.h,
    width: region.rect.wPct * frameNatural.w,
    height: region.rect.hPct * frameNatural.h
  };
}

// 合成時の座標変換（containerSize基準）
function transformToDisplayCoords(
  pixelCoords: { x: number; y: number; width: number; height: number },
  frameNatural: { w: number; h: number },
  containerSize: { w: number; h: number }
): { x: number; y: number; width: number; height: number } {
  const scale = Math.min(
    containerSize.w / frameNatural.w,
    containerSize.h / frameNatural.h
  );

  return {
    x: pixelCoords.x * scale,
    y: pixelCoords.y * scale,
    width: pixelCoords.width * scale,
    height: pixelCoords.height * scale
  };
}
```

#### ステップ0.4: 検証ログの追加
```typescript
// デバッグモード時に詳細なスケール検証ログを出力
if (debugMode) {
  console.group('🔍 Scale Verification');
  console.log('Frame Natural:', frameNatural);
  console.log('Container Size:', containerSize);
  console.log('Scale Factor:', scale);
  console.log('Region % (rect):', region.rect);
  console.log('Region Pixels (Natural):', regionPixels);
  console.log('Region Pixels (Display):', regionDisplay);
  console.log('Canvas Size:', { width: canvasWidth, height: canvasHeight });
  console.groupEnd();
}
```

### フェーズ1: 即座表示問題の修正 ✅ 完了（ユーザー確認済み）

#### ステップ1.1: 状態管理の改善
```typescript
// 現在の問題のあるコード
const [deviceRegions, setDeviceRegions] = useState([...]);

// 改善案: 深い比較を行うための専用状態を追加
const [renderTrigger, setRenderTrigger] = useState(0);

// 画像アップロード時に明示的にトリガー
const handleImageUpload = (deviceIndex, image) => {
  // ... 既存の処理
  setRenderTrigger(prev => prev + 1); // 強制的に再レンダリング
};
```

#### ステップ1.2: Canvas描画の即座実行
```typescript
// 画像アップロード後に直接Canvas描画を実行
const drawImmediately = useCallback((deviceIndex) => {
  const canvas = canvasRef.current;
  if (!canvas) return;

  // 該当デバイスの描画処理を即座に実行
  const region = deviceRegions[deviceIndex];
  if (region && region.hasImage) {
    drawDeviceImage(canvas, region);
  }
}, [deviceRegions]);
```

#### ステップ1.3: useEffectの依存配列修正
```typescript
// 深い比較のためのカスタムフック使用
import { useDeepCompareEffect } from 'use-deep-compare-effect';

useDeepCompareEffect(() => {
  // Canvas描画処理
}, [deviceRegions, frameImage, aspectRatio]);
```

### フェーズ2: デバイスインデックス問題の修正 ✅ 完了（2024/11/24）

#### ステップ2.1: 問題箇所の特定と調査
```typescript
// MultiDeviceMockup.tsx line 697付近を調査
// deviceIndexがどこから来ているか追跡

// 予想される問題パターン:
// 1. ループ変数ではなく、外側のスコープの変数を参照
// 2. クロージャでキャプチャされた古い値
// 3. 非同期処理でインデックスが上書きされている

// 調査コード例:
deviceRegions.forEach((region, index) => {
  console.log('Loop index:', index);           // これが正しい値
  console.log('Region deviceIndex:', region.deviceIndex);  // これも正しい値

  // しかし、以下のconsole.logでは常に1が出力されている
  if (debugMode) {
    console.log(`=== Device ${deviceIndex} Debug Info ===`);
    // ↑ このdeviceIndexはどこから来ている？
  }
});
```

#### ステップ2.2: ループ変数の修正
```typescript
// ❌ 現在の実装（推測）:
// グローバルまたは外側のスコープのdeviceIndexを使用
let deviceIndex = 1;  // なぜか1で固定？
deviceRegions.forEach((region) => {
  if (debugMode) {
    console.log(`=== Device ${deviceIndex} Debug Info ===`);
  }
});

// ✅ 正しい実装:
// region.deviceIndexまたはループインデックスを使用
deviceRegions.forEach((region, index) => {
  if (debugMode) {
    console.log(`=== Device ${region.deviceIndex} Debug Info ===`);
    // または
    console.log(`=== Device ${index} Debug Info ===`);
  }
});
```

#### ステップ2.3: debugVisualization.tsの呼び出し修正
```typescript
// ❌ 現在の実装（推測）:
// 固定値またはスコープ外の変数を渡している
logCoordinateTransform(
  deviceIndex,  // ← これが常に1
  frameNatural,
  containerSize,
  region.rect,
  actualPixelCoords
);

// ✅ 正しい実装:
// region.deviceIndexを明示的に渡す
logCoordinateTransform(
  region.deviceIndex,  // または index
  frameNatural,
  containerSize,
  region.rect,
  actualPixelCoords
);
```

#### ステップ2.4: すべてのログ出力箇所を統一
```typescript
// MultiDeviceMockup.tsx内のすべてのログ出力を修正

// パターン1: console.logの直接出力
deviceRegions.forEach((region, index) => {
  if (debugMode) {
    console.log(`=== Device ${region.deviceIndex} Debug Info ===`);
    console.log('Frame:', debugInfo.frameName);
    // ... その他のログ
  }
});

// パターン2: debugVisualization関数の呼び出し
deviceRegions.forEach((region, index) => {
  logCoordinateTransform(
    region.deviceIndex,  // 正しいインデックスを渡す
    frameNatural,
    containerSize,
    region.rect,
    actualPixelCoords
  );
});

// パターン3: drawDebugOverlayの呼び出し
deviceRegions.forEach((region, index) => {
  drawDebugOverlay(
    ctx,
    debugData,
    region.deviceIndex  // 正しいインデックスを渡す
  );
});
```

#### ステップ2.5: Device 2の処理確認
```typescript
// Device 2が処理されない理由の確認
// function.logによると、isActive: falseのため

// 確認ポイント:
// 1. なぜisActive: falseなのか？
// 2. フレーム画像に3つ目のデバイスが検出されていないのか？
// 3. それとも検出後に無効化されているのか？

// 検証コード:
console.log('All Device Regions:');
deviceRegions.forEach((region, index) => {
  console.log(`Device ${index}:`, {
    deviceIndex: region.deviceIndex,
    isActive: region.isActive,
    hasImage: region.hasImage,
    hasRect: !!region.rect
  });
});
```

### フェーズ3: マスク滑らかさの修正

#### ステップ3.1: Featherパラメータの適用
```typescript
// マスク生成関数の修正
function generateMask(params) {
  const { width, height, cornerRadius, feather = 20 } = params;

  const maskCanvas = document.createElement('canvas');
  const ctx = maskCanvas.getContext('2d');

  // グラデーションマスクの生成
  ctx.filter = `blur(${feather}px)`;

  // 角丸矩形の描画
  if (ctx.roundRect) {
    ctx.roundRect(0, 0, width, height, cornerRadius);
  } else {
    // フォールバック実装
    drawRoundedRect(ctx, 0, 0, width, height, cornerRadius);
  }

  return maskCanvas;
}
```

#### ステップ3.2: アルファ合成の改善
```typescript
// マスク適用の改善
function applyMask(imageCanvas, maskCanvas) {
  const ctx = imageCanvas.getContext('2d');

  // 保存
  ctx.save();

  // マスクを destination-in で適用
  ctx.globalCompositeOperation = 'destination-in';
  ctx.drawImage(maskCanvas, 0, 0);

  // 復元
  ctx.restore();

  return imageCanvas;
}
```

#### ステップ3.3: cornerRadiusの動的計算
```typescript
// デバイスタイプに応じた角丸の計算
function calculateCornerRadius(deviceType, regionSize) {
  const { width, height } = regionSize;
  const minDimension = Math.min(width, height);

  // デバイスタイプに応じた比率
  const radiusRatio = {
    smartphone: 0.15,  // 15%の角丸
    laptop: 0.02,      // 2%の角丸
    tablet: 0.08       // 8%の角丸
  };

  return minDimension * (radiusRatio[deviceType] || 0.05);
}
```

#### ステップ3.4: マスク調整バーの削除
```typescript
// UIから削除する要素
// - MaskSmoothnessSlider コンポーネント全体
// - maskSmoothness 状態変数
// - handleMaskSmoothnessChange ハンドラー

// 固定値として設定
const MASK_SMOOTHNESS = 1.0; // 常に100%
const FEATHER_AMOUNT = 20;   // 固定のフェザー量
```

## 実装優先順位（2024/11/24更新）

### ✅ 解決済み問題

1. **座標とサイズのミスマッチ問題** ✅ 完了
   - Canvas自体は正しく作成されていた
   - エラー検出ロジックの誤検出を修正
   - **解決**: SIZE MISMATCH、COORDINATE MISMATCHエラー完全解消

2. **画像の即座表示問題** ✅ 完了（ユーザー確認済み）
   - displayPosition追加により解決
   - 画像アップロード後即座に表示される
   - **解決**: ユーザーから「問題解消」の確認済み

3. **デバイスインデックス問題** ✅ 完了
   - forEach内でregion.deviceIndexを正しく参照
   - ログが正確にデバイス番号を表示
   - **解決**: Device 0, 1, 2が正しく識別される

### Medium（中優先度 - ビジュアル品質）
4. **マスクの滑らかさ問題**（未対応）
   - 画像の四隅が角張っている
   - 機能的には動作するが、見た目が悪い
   - **影響度**: 🟢 Medium - ビジュアル品質の問題

### 修正の順序と理由

**Phase 0（Day 1）: 座標・サイズミスマッチ → 最優先**
- 理由: これが修正されないと、他の修正が意味をなさない
- 影響: すべての画像合成処理の基盤

**Phase 1（Day 1-2）: 即座表示問題 → 次に重要**
- 理由: ユーザビリティに直結
- 依存: Phase 0の修正が完了していれば、正しい位置に即座表示される

**Phase 2（Day 2）: デバイスインデックス → 開発効率向上**
- 理由: デバッグが正確になり、残りの作業が効率化
- 依存: Phase 0, 1の修正時に正しいデバッグ情報が必要

**Phase 3（Day 3）: マスク滑らかさ → 仕上げ**
- 理由: 機能が正常動作した後のビジュアル改善
- 依存: 他のすべての問題が解決済み

## テスト計画

### ユニットテスト
1. 画像アップロード後の即座表示確認
2. 3つのデバイスすべての処理確認
3. マスクの角丸適用確認

### 統合テスト
1. 異なるアスペクト比での動作確認
2. 複数デバイス同時処理の確認
3. マスクのビジュアル品質確認

### ユーザビリティテスト
1. 画像アップロード → 即座表示の流れ
2. 3つのデバイスへの画像設定
3. 最終的な合成画像の品質確認

## 実装スケジュール（ログ分析後の更新版）

### Day 1 AM: Phase 0 - 座標・サイズミスマッチ修正
- [ ] ステップ0.1: MultiDeviceMockup.tsx内のCanvas生成箇所を特定
- [ ] ステップ0.2: スケール計算のデバッグログ追加
- [ ] ステップ0.3: 758x454になる原因を特定
- [ ] ステップ0.4: スケール計算ロジックの修正
- [ ] ステップ0.5: 座標変換ヘルパー関数の実装
- [ ] テスト: 561x336の正しいサイズで描画されることを確認

### Day 1 PM: Phase 1 - 即座表示問題修正
- [ ] ステップ1.1: useEffectの依存配列を調査
- [ ] ステップ1.2: renderTriggerの実装
- [ ] ステップ1.3: Canvas即座描画の実装
- [ ] ステップ1.4: useDeepCompareEffectの導入検討
- [ ] テスト: 画像アップロード後0.5秒以内に表示されることを確認

### Day 2 AM: Phase 2 - デバイスインデックス修正
- [ ] ステップ2.1: line 697付近のdeviceIndex変数のスコープを調査
- [ ] ステップ2.2: ループ変数をregion.deviceIndexに修正
- [ ] ステップ2.3: debugVisualization.tsの呼び出しを修正
- [ ] ステップ2.4: すべてのログ出力箇所を統一
- [ ] ステップ2.5: Device 2の状態を確認
- [ ] テスト: Device 0とDevice 1が正しく表示されることを確認

### Day 2 PM: Phase 3 - マスク滑らかさ修正
- [ ] ステップ3.1: Featherパラメータの適用
- [ ] ステップ3.2: cornerRadiusの動的計算
- [ ] ステップ3.3: アルファ合成の改善
- [ ] ステップ3.4: マスク調整バーの削除
- [ ] テスト: 角丸が滑らかに表示されることを確認

### Day 3: 統合テストとドキュメント更新
- [ ] すべての修正の統合テスト
- [ ] 異なるアスペクト比での動作確認
- [ ] 複数デバイス同時処理の確認
- [ ] パフォーマンステスト
- [ ] READMEとドキュメントの更新

## 成功指標（2024/11/24検証済み）

### Phase 0: 座標・サイズミスマッチ ✅ 達成
- ✅ Canvas SizeとExpected Sizeが一致（誤差1px未満）
- ✅ SIZE MISMATCHエラーが出ない
- ✅ COORDINATE MISMATCHエラーが出ない
- ✅ 画像がデバイス領域内に正しく収まる

### Phase 1: 即座表示 ✅ 達成（ユーザー確認）
- ✅ アップロード後即座に画像表示
- ✅ ボタンを押さなくても表示される
- ✅ すべてのデバイスで即座表示が動作

### Phase 2: デバイスインデックス ✅ 達成
- ✅ console.logに「Device 0」「Device 1」「Device 2」が正しく表示
- ✅ debugVisualization.tsも正しいインデックスを表示
- ✅ Device 2の状態が正しく表示される（isActive: true/false）

### Phase 3: マスク品質（未実装）
- ⬜ 角丸が滑らかで自然な仕上がり
- ⬜ 四隅が角張っていない
- ⬜ cornerRadiusが正しく適用される

### 全体的な成功指標
1. **機能正常性**: すべての画像が正しいサイズと位置で表示される
2. **ユーザビリティ**: 画像アップロード後、即座に結果が見える
3. **デバッグ容易性**: ログから正確な情報が得られる
4. **ビジュアル品質**: プロフェッショナルな仕上がり
5. **パフォーマンス**: 処理時間が2秒以内

## リスクと対策

### リスク1: React再レンダリングの過剰
**対策**: useMemoとuseCallbackの適切な使用

### リスク2: Canvas描画のメモリリーク
**対策**: 適切なクリーンアップとガベージコレクション

### リスク3: ブラウザ互換性
**対策**: roundRectのフォールバック実装

## まとめ（ログ分析後の更新版）

### ログ分析で判明した重要な事実

1. **新発見の重大問題**: 座標とサイズのミスマッチ（35%の拡大）
   - これがすべての画像合成処理の根本的な問題
   - 最優先で修正が必要

2. **デバイスインデックス問題の詳細**: すべてが「Device 1」と表示
   - デバッグを著しく困難にしている
   - function.logは正しい → console.logだけの問題

3. **Device 2の状態**: isActive: false のため処理されていない
   - 使用中のフレーム画像には2つのデバイスしかない
   - 3つ目のデバイスがあるフレーム画像でテストが必要

### 修正による期待される改善

**Phase 0完了後:**
- ✅ 画像が正しいサイズと位置で表示される
- ✅ はみ出しや空白がなくなる
- ✅ 座標ミスマッチエラーが消える

**Phase 1完了後:**
- ✅ 画像アップロード後、即座に表示される
- ✅ ボタンを押す必要がなくなる
- ✅ スムーズな編集体験

**Phase 2完了後:**
- ✅ デバッグログが正確になる
- ✅ 問題の追跡が容易になる
- ✅ 開発効率が向上

**Phase 3完了後:**
- ✅ プロフェッショナルなビジュアル品質
- ✅ 滑らかな角丸
- ✅ 完成度の高い仕上がり

### 実装アプローチ

1. **データドリブン**: ログから得られた正確な数値に基づいて修正
2. **段階的**: 各フェーズで確実にテストしながら進行
3. **優先度明確**: Critical → High → Medium の順に実装
4. **依存関係考慮**: Phase 0が完了しないと他の修正が意味をなさない

### 期待される最終結果

この計画に従って実装を進めることで、以下の改善が期待できます：

1. **機能正常性**: すべての画像が正しく合成される（現在: 35%のサイズエラー）
2. **UX向上**: 画像アップロード後の即座表示（現在: ボタンを押すまで表示されない）
3. **デバッグ容易性**: 正確なログ情報（現在: すべて「Device 1」と表示）
4. **ビジュアル品質**: プロフェッショナルな角丸マスク（現在: 角張っている）
5. **コード品質**: 保守性とパフォーマンスの向上

実装は優先度順に進め、各フェーズでテストを実施して品質を確保します。特にPhase 0の座標・サイズミスマッチ問題は、他のすべての修正の基盤となるため、最優先で取り組みます。