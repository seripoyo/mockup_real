# デバイス種類検出と画像回転の改善

## 概要

視覚的特徴ベースのデバイス検出アルゴリズムを実装し、アスペクト比のみに依存していた従来の検出方法を改善しました。

## 実装した改善点

### 1. 視覚的特徴に基づくデバイス検出

#### キーボード検出（ラップトップ判定）
- **場所**: `src/features/mockup/utils/deviceTypeDetection.ts`
- **関数**: `detectKeyboard(maskData: ImageData): boolean`
- **ロジック**:
  - マスク画像の下部20%の領域をスキャン
  - 中央80%の幅で黒いピクセル（輝度 < 50）をカウント
  - 30%以上が黒い場合、キーボードありと判定
  - キーボードが検出された場合、確実に**ラップトップ**と判定

```typescript
// 検出例のログ出力
⌨️ Keyboard detected (laptop feature): {
  blackRatio: 0.456,
  blackPixels: 3240,
  totalPixels: 7100
}
```

#### ノッチ検出（スマートフォン判定）
- **場所**: `src/features/mockup/utils/deviceTypeDetection.ts`
- **関数**: `detectBlackCutout(maskData: ImageData): boolean`
- **ロジック**:
  - マスク画像の上部15%の領域をスキャン
  - 中央70%の幅で黒いピクセル（輝度 < 30）をカウント
  - 3%以上が黒い場合、ノッチありと判定
  - ノッチが検出され、かつ縦長（アスペクト比 < 1.0）の場合、確実に**スマートフォン**と判定

```typescript
// 検出例のログ出力
📱 Notch detected (smartphone feature): {
  blackRatio: 0.048,
  aspectRatio: 0.56,
  blackPixels: 156,
  totalPixels: 3250
}
```

### 2. デバイス種類判定ロジックの強化

#### 優先順位ベースの判定
1. **第1優先**: キーボード検出 → ラップトップ
2. **第2優先**: ノッチ検出 + 縦長 → スマートフォン
3. **第3優先**: アスペクト比ベースのスコアリング

```typescript
// 改良された detectDeviceType 関数シグネチャ
export function detectDeviceType(
  width: number,
  height: number,
  hasBlackCutout: boolean = false,
  hasKeyboard: boolean = false  // 新規パラメータ
): DeviceType
```

#### アスペクト比スコアの調整
- **ラップトップ**:
  - アスペクト比 > 1.5: スコア +70（従来: +60）
  - アスペクト比 > 1.35: スコア +50（従来: +45）

- **スマートフォン**:
  - アスペクト比 < 0.7: スコア +50（従来: +40）
  - より縦長の画面を正確に識別

### 3. 画像回転ロジックの改善

#### 新しい `determineDeviceOrientation` 関数
- **場所**: `src/features/mockup/utils/deviceTypeDetection.ts`
- **新規パラメータ**: `imageNatural?: { w: number; h: number }`
  - アップロードされた画像のサイズを考慮

#### デバイスタイプ別の回転ロジック

**ラップトップ**:
- 基本: 横長（回転なし）
- 画像が縦長の場合: +90°回転

**スマートフォン**:
- 基本: 縦長（回転なし）
- 画像が横長でデバイスが縦長の場合: -90°回転（反時計回り）

**タブレット**:
- 画像とデバイスの向きが一致しない場合に回転
- 画像が横長 & デバイスが縦長: -90°回転
- 画像が縦長 & デバイスが横長: +90°回転

```typescript
// 回転決定のログ出力例
🔄 Orientation detection: {
  deviceType: 'smartphone',
  deviceAspectRatio: '0.56',
  imageAspectRatio: '1.78'
}
🔄 Smartphone: Rotating landscape image -90° to portrait
```

### 4. 信頼度計算の改善

```typescript
// detectDeviceTypeFromRegion の戻り値
{
  type: DeviceType;
  confidence: number;      // 0-100%
  hasNotch: boolean;       // 新規
  hasKeyboard: boolean;    // 新規
}
```

#### 信頼度ブースト
- ラップトップでキーボード検出: +30%
- スマートフォンでノッチ検出: +30%

```typescript
// ログ出力例
🎯 Device type detection result: {
  type: 'laptop',
  confidence: '95.4%',
  hasNotch: false,
  hasKeyboard: true,
  aspectRatio: '1.67'
}
```

## MultiDeviceMockup.tsx の変更点

### デバッグログの強化

```typescript
deviceDebugLog.deviceTypeDetection = {
  type: deviceType,
  displayName: getDeviceDisplayName(deviceDetectionResult.type),
  confidence: `${detectionConfidence.toFixed(1)}%`,
  hasNotch: hasNotchDetected,
  hasKeyboard: hasKeyboardDetected,  // 新規
  aspectRatio: aspectRatio.toFixed(2),
  visualFeatures: hasKeyboardDetected ? '⌨️ Keyboard detected' :
                  hasNotchDetected ? '📱 Notch detected' : 'None'  // 新規
};

deviceDebugLog.orientationDetection = {
  deviceType: deviceDetectionResult.type,
  rotationAngle: `${rotationAngle}°`,
  imageAspectRatio: region.imageNatural ? (region.imageNatural.w / region.imageNatural.h).toFixed(2) : 'N/A',  // 新規
  deviceAspectRatio: (region.rect.wPct / region.rect.hPct).toFixed(2),  // 新規
  method: '...',
  explanation: '...'
};
```

## テスト結果

### 期待される動作

#### シナリオ1: ラップトップ + スマートフォン
- **Device 1 (左側の横長画面)**:
  - キーボード検出 → ✅ ラップトップと判定
  - 信頼度: 95%+

- **Device 2 (右側の縦長画面)**:
  - ノッチ検出 → ✅ スマートフォンと判定
  - 横長画像がアップロードされた場合 → -90°回転で縦向きに表示
  - 信頼度: 90%+

#### シナリオ2: 向きの異なる画像
- **ラップトップに縦長画像をアップロード**:
  - +90°回転して横長に表示

- **スマートフォンに横長画像をアップロード**:
  - -90°回転して縦長に表示

## 使用方法

### 開発サーバーでの確認
```bash
npm run dev
```

### デバッグモードの有効化
1. アプリケーション内の「デバッグモード: OFF」ボタンをクリック
2. コンソールに詳細なログが出力される
3. 以下の情報を確認:
   - `⌨️ Keyboard detected` または `📱 Notch detected`
   - `🎯 Device type detection result`
   - `🔄 Orientation detection`

## 関連ファイル

### 修正したファイル
1. `src/features/mockup/utils/deviceTypeDetection.ts`
   - `detectKeyboard()` 新規追加
   - `detectBlackCutout()` 改善
   - `detectDeviceType()` パラメータ追加
   - `detectDeviceTypeFromRegion()` 戻り値拡張
   - `determineDeviceOrientation()` パラメータ追加

2. `src/features/mockup/components/MultiDeviceMockup.tsx`
   - デバイス検出結果の利用方法を更新
   - デバッグログの強化

## 今後の改善案

1. **エッジケースの処理**
   - タブレットとラップトップの区別をさらに改善
   - 画面が斜めに配置されている場合の対応

2. **パフォーマンス最適化**
   - マスクデータのスキャン範囲を動的に調整
   - キャッシュ機構の導入

3. **追加の視覚的特徴**
   - カメラホールの検出
   - ベゼルの太さ分析
   - デバイスフレームの形状認識

## まとめ

この改善により、アスペクト比だけでなく視覚的特徴（キーボード、ノッチ）に基づいた堅牢なデバイス検出が可能になりました。また、画像の向きも自動的に調整されるため、ユーザーエクスペリエンスが大幅に向上しました。
