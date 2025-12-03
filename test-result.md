# MultiDeviceMockup修正結果

## 修正内容

### 問題
- デバッグモードONで画像が表示されない
- `lastMasksRef.current.get()`が常にundefinedを返す
- 原因: lastMasksRefはonOverlayClick（ユーザーのクリック時）でのみ設定されるが、useEffectは自動的に実行される

### 解決策
- lastMasksRefが空の場合でも、region.rectとframeNaturalから必要な情報を計算
- 720-752行目を修正：
  - 条件からlastのチェックを削除
  - lastが存在しない場合、region.rectから直接rwとrhを計算

### 修正後のコード（720-752行）
```typescript
const last = lastMasksRef.current.get(region.deviceIndex as DeviceIndex);
const imageUrl = imageUrls[region.deviceIndex];

console.log(`📋 Device ${region.deviceIndex} Prerequisites Check:`, {
  last: !!last,
  hardMaskUrl: !!region.hardMaskUrl,
  imageUrl: !!imageUrl,
  imageNatural: !!region.imageNatural,
  rect: !!region.rect,
  frameNatural: !!frameNatural
});

// lastMasksRefが空の場合でも、region.rectとframeNaturalがあれば処理を続行
if (!region.hardMaskUrl || !imageUrl || !region.imageNatural || !region.rect || !frameNatural) {
  console.log(`❌ Device ${region.deviceIndex}: Missing prerequisites. Skipping.`);
  if (region.compositeUrl) {
    setDeviceRegions(prev => prev.map((r, idx) =>
      idx === deviceIndex ? { ...r, compositeUrl: null } : r
    ));
  }
  return;
}

// lastMasksRefが空の場合、region.rectから計算
let rw: number, rh: number;
if (last) {
  ({ rw, rh } = last);
} else {
  // region.rectとframeNaturalから計算
  rw = Math.round(region.rect.wPct * frameNatural.w);
  rh = Math.round(region.rect.hPct * frameNatural.h);
  console.log(`⚠️ Device ${region.deviceIndex}: Using fallback size calculation from rect. rw=${rw}, rh=${rh}`);
}
```

## テスト手順
1. デバッグモードをONにする
2. フレーム画像を読み込む
3. デバイス領域が検出されることを確認
4. 画像をアップロードする
5. 画像が正しく表示されることを確認

## 期待される結果
- デバッグモードONでも画像が表示される
- コンソールに「Using fallback size calculation from rect」のログが出力される
- 各デバイスの画像が正しくマスク処理され、合成される