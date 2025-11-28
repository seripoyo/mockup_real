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
- ログにはDevice 0しか出力されていない（実際はDevice 0とDevice 1が処理されている）
- Device 2の処理が全く行われていない

#### ログから判明した事実
```
Device 0: line 20-80, 81-141 (2回処理)
Device 1: line 142-202 (1回処理)
Device 2: 処理されていない
```

#### 根本原因
**デバイスの処理ループとログ出力の不一致**

1. デバッグログの出力箇所でインデックス番号が正しく使用されていない
2. Device 2に関しては、`isActive: false`のため処理がスキップされている（line 331）

#### 技術的詳細
- `debugVisualization.ts`のログ出力でデバイスインデックスがハードコードされている可能性
- line 678のログ出力箇所で実際のdeviceIndexではなく固定値を使用している

### 3. マスクの滑らかさの問題

#### 症状
- 画像の四隅が角張っている
- マスクの形状に完全にフィットしていない
- 丸みを帯びるべき箇所が直角になっている

#### ログから判明した事実
```
Device 0: cornerRadius: 2 (line 263)
Device 1: cornerRadius: 7 (line 316)
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

### フェーズ1: 即座表示問題の修正

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

### フェーズ2: デバイスインデックス問題の修正

#### ステップ2.1: ログ出力の修正
```typescript
// debugVisualization.ts
export function logCoordinateTransform(params) {
  const { deviceIndex } = params;
  console.log(`🔍 Device ${deviceIndex} Coordinate Transform Analysis`);
  // ... 残りのログ処理
}
```

#### ステップ2.2: Device 2の処理追加
```typescript
// 3つのデバイスすべてを明示的に処理
for (let i = 0; i < 3; i++) {
  const region = deviceRegions[i];
  if (region && region.isActive && region.hasImage) {
    await processDevice(region);
  }
}
```

#### ステップ2.3: デバイス状態の初期化改善
```typescript
// 初期状態で3つのデバイスを確保
const initializeDeviceRegions = () => {
  return Array.from({ length: 3 }, (_, index) => ({
    deviceIndex: index,
    isActive: false,
    hasImage: false,
    fillColor: DEVICE_COLORS[index],
    // ... その他のプロパティ
  }));
};
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

## 実装優先順位

### 最優先（即座に修正すべき）
1. **画像の即座表示問題** - ユーザビリティに最も影響
   - useEffectの修正
   - 強制レンダリングトリガーの追加
   - Canvas描画の即座実行

### 高優先度
2. **マスクの滑らかさ** - ビジュアル品質に影響
   - Featherパラメータの適用
   - cornerRadiusの実装
   - マスク調整バーの削除

### 中優先度
3. **デバイスインデックス問題** - デバッグとDevice 3サポート
   - ログ出力の修正
   - Device 2の処理追加
   - 初期化の改善

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

## 実装スケジュール

### Day 1: 即座表示問題
- [ ] useEffectの依存配列修正
- [ ] renderTriggerの実装
- [ ] Canvas即座描画の実装
- [ ] テスト実行

### Day 2: マスク滑らかさ
- [ ] Featherパラメータの適用
- [ ] cornerRadius実装
- [ ] マスク調整バー削除
- [ ] ビジュアルテスト

### Day 3: デバイスインデックス
- [ ] ログ出力修正
- [ ] Device 2処理追加
- [ ] 全体統合テスト

## 成功指標

1. **即座表示**: アップロード後0.5秒以内に画像表示
2. **デバイス処理**: 3つのデバイスすべてが正常処理
3. **マスク品質**: 角丸が滑らかで自然な仕上がり
4. **パフォーマンス**: 処理時間が2秒以内

## リスクと対策

### リスク1: React再レンダリングの過剰
**対策**: useMemoとuseCallbackの適切な使用

### リスク2: Canvas描画のメモリリーク
**対策**: 適切なクリーンアップとガベージコレクション

### リスク3: ブラウザ互換性
**対策**: roundRectのフォールバック実装

## まとめ

この計画に従って実装を進めることで、以下の改善が期待できます：

1. **UX向上**: 画像アップロード後の即座表示
2. **機能完全性**: 3デバイスすべての正常動作
3. **ビジュアル品質**: プロフェッショナルな角丸マスク
4. **コード品質**: 保守性とパフォーマンスの向上

実装は優先度順に進め、各フェーズでテストを実施して品質を確保します。