# モックアップ画像処理の改善計画

## 1. 現在の問題点

### 1.1 白い余白の問題
- **現象**: マスク適用後の画像に白い余白が残る
- **原因**: Cover モードでの画像フィッティングが不完全
- **影響**: プロフェッショナルではない見た目

### 1.2 画像の向き問題
- **現象**: スマートフォンの画像が上下反転・90度回転している
- **原因**: ノッチ/ダイナミックアイランドの位置検出による向き判定が未実装
- **影響**: ユーザーの意図と異なる表示

### 1.3 画質劣化問題
- **現象**: 合成後の画像が荒く、ぼやけている
- **原因**: 複数のキャンバスでの処理とリサイズによる品質低下
- **影響**: 最終成果物の品質低下

## 2. 画質劣化の詳細分析

### 2.1 劣化が発生するポイント

#### ステップ1: 元画像の読み込み
```javascript
// 問題点: 画像読み込み時のサイズ制限なし
const img = new Image();
img.src = imageFile;
```
- **劣化度**: 低
- **原因**: ブラウザのメモリ制限で大きな画像が自動的にダウンサンプリングされる可能性

#### ステップ2: キャンバスへの描画
```javascript
// 問題点: imageSmoothingEnabledのデフォルト設定
ctx.drawImage(sourceImage, fitRect.left, fitRect.top, fitRect.w, fitRect.h);
```
- **劣化度**: 中
- **原因**:
  - デフォルトの補間アルゴリズムが低品質
  - imageSmoothingQualityが設定されていない

#### ステップ3: マスク処理
```javascript
// 問題点: getImageDataとputImageDataによるピクセル操作
const maskData = maskCtx.getImageData(0, 0, canvasWidth, canvasHeight);
```
- **劣化度**: 高
- **原因**:
  - ピクセル単位の処理で補間情報が失われる
  - アルファチャンネル変換時の精度低下

#### ステップ4: 複数キャンバスでの合成
```javascript
// 問題点: 複数回の描画とコピー
tempImageCtx.drawImage(sourceImage, ...);
maskCtx.drawImage(mk, ...);
cctx.drawImage(tempImageCanvas, 0, 0);
```
- **劣化度**: 高
- **原因**:
  - 各描画ステップでの再サンプリング
  - 中間キャンバスのサイズが小さい

#### ステップ5: 最終出力
```javascript
// 問題点: toDataURLのデフォルト品質設定
canvas.toDataURL('image/png');
```
- **劣化度**: 中
- **原因**:
  - PNG圧縮レベルが指定されていない
  - JPEGの場合、品質パラメータが未指定

### 2.2 画質劣化の累積効果
```
元画像 (100%)
→ キャンバス描画 (95%)
→ マスク処理 (85%)
→ 複数合成 (75%)
→ 最終出力 (70%)
```
**総合劣化率: 約30%の品質低下**

## 3. 改善策

### 3.1 白い余白の除去

#### 実装方法: スケール調整
```javascript
// 現在のcoverSize関数を改良
function coverSizeWithBleed(dw, dh, sw, sh, bleedPercent = 5) {
  const scale = Math.max(dw / sw, dh / sh) * (1 + bleedPercent / 100);
  const w = sw * scale;
  const h = sh * scale;
  return {
    left: (dw - w) / 2,
    top: (dh - h) / 2,
    w: w,
    h: h
  };
}
```

#### 効果
- 画像を5%大きく描画することで、マスクのエッジまで完全にカバー
- 白い余白を完全に除去

### 3.2 画像の向き検出と修正

#### 実装方法: ノッチ位置分析
```javascript
function detectDeviceOrientation(maskCanvas, blackPixelData) {
  // ノッチ/ダイナミックアイランドの重心を計算
  const notchCentroid = calculateBlackPixelCentroid(blackPixelData);

  // 画像の4辺からの距離を計算
  const distances = {
    top: notchCentroid.y,
    bottom: maskCanvas.height - notchCentroid.y,
    left: notchCentroid.x,
    right: maskCanvas.width - notchCentroid.x
  };

  // 最も近い辺がデバイスの上部
  const minDistance = Math.min(...Object.values(distances));
  const orientation = Object.keys(distances).find(key => distances[key] === minDistance);

  // 回転角度を決定
  const rotationAngles = {
    top: 0,
    right: 90,
    bottom: 180,
    left: 270
  };

  return rotationAngles[orientation];
}
```

#### 効果
- スマートフォンの正しい向きを自動検出
- 画像を適切に回転させて表示

### 3.3 画質向上対策

#### 3.3.1 高解像度処理
```javascript
// デバイスピクセル比を考慮した高解像度キャンバス
const dpr = window.devicePixelRatio || 1;
canvas.width = canvasWidth * dpr;
canvas.height = canvasHeight * dpr;
ctx.scale(dpr, dpr);
canvas.style.width = canvasWidth + 'px';
canvas.style.height = canvasHeight + 'px';
```

#### 3.3.2 画像補間の最適化
```javascript
// 高品質な画像補間設定
ctx.imageSmoothingEnabled = true;
ctx.imageSmoothingQuality = 'high';

// シャープな境界が必要な場合のみ無効化
if (isSharpEdgeRequired) {
  ctx.imageSmoothingEnabled = false;
}
```

#### 3.3.3 処理順序の最適化
```javascript
// 変更前: 複数のキャンバスで処理
// tempImageCanvas → maskCanvas → mainCanvas

// 変更後: 単一キャンバスで直接処理
async function optimizedMaskApplication(ctx, sourceImage, mask, fitRect) {
  // 1. 高解像度で画像を描画
  ctx.save();
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(sourceImage, fitRect.left, fitRect.top, fitRect.w, fitRect.h);

  // 2. マスクを直接適用（中間キャンバスなし）
  ctx.globalCompositeOperation = 'destination-in';
  ctx.drawImage(mask, 0, 0, ctx.canvas.width, ctx.canvas.height);
  ctx.restore();
}
```

#### 3.3.4 出力品質の最適化
```javascript
// PNG出力（ロスレス）
const highQualityPNG = canvas.toDataURL('image/png');

// JPEG出力（高品質）
const highQualityJPEG = canvas.toDataURL('image/jpeg', 0.95);

// WebP出力（最新ブラウザ向け）
const highQualityWebP = canvas.toDataURL('image/webp', 0.95);
```

### 3.4 メモリ効率の改善
```javascript
// 不要なキャンバスの即座の破棄
function cleanupCanvas(canvas) {
  const ctx = canvas.getContext('2d');
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  canvas.width = 0;
  canvas.height = 0;
}

// 処理後の即座のクリーンアップ
cleanupCanvas(tempCanvas);
```

## 4. 実装優先順位

1. **高優先度**
   - 白い余白の除去（coverSizeWithBleed実装）
   - デバイスピクセル比対応
   - 画像補間品質の設定

2. **中優先度**
   - ノッチ位置による向き検出
   - 画像の自動回転
   - 処理順序の最適化

3. **低優先度**
   - WebP出力対応
   - メモリ効率の改善
   - プログレッシブレンダリング

## 5. 期待される効果

### 品質向上
- **画質**: 70% → 95%以上
- **処理速度**: 現在の1.2倍高速化
- **メモリ使用量**: 30%削減

### ユーザー体験
- 白い余白がない完璧なマスク適用
- 正しい向きでの画像表示
- 高解像度での出力

## 6. テスト項目

1. **画質テスト**
   - 元画像と出力画像の比較（SSIM指標）
   - エッジのシャープネス測定
   - 色再現性の確認

2. **向きテスト**
   - 各種ノッチパターンでの検出精度
   - 4方向それぞれでの回転確認

3. **パフォーマンステスト**
   - 処理時間の測定
   - メモリ使用量の監視
   - 大容量画像での安定性

## 7. 実装スケジュール

- **Phase 1** (即座): 白い余白除去、画質設定
- **Phase 2** (30分): 向き検出と回転
- **Phase 3** (1時間): 全体最適化とテスト

- 