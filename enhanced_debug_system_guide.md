# 🔬 Enhanced Debug System ガイド

## 完成日時
2025-12-04 09:12 JST

## 📋 実装内容

### 1. EnhancedDebugPanel コンポーネント
新しい詳細デバッグパネルを作成しました。このパネルは：
- **常時表示**: debugModeのON/OFFに関わらず表示
- **リアルタイムイベントログ**: すべてのイベントを記録
- **診断情報**: システム状態を一目で確認
- **全デバイス表示**: すべてのデバイス領域の状態を表示

### 2. 詳細ログシステム
各デバイスクリック時に以下のログが出力されます：

```javascript
// クリック時のログ例
🖱️ Device 1 clicked - BEFORE state update
  Current debugMode: true
  Current selectedDeviceIndex: null
  Current orientationAnalyses length: 0
  Current whiteMarginAnalyses length: 0
✅ Device 1 selected - state updated
📊 Device 1 detailed info: { ... }
🔬 Creating orientation analysis for device 1
  ➡️ Updated orientationAnalyses: 1 items
🔬 Creating margin analysis for device 1
  ➡️ Updated whiteMarginAnalyses: 1 items
```

## 🎯 使用方法

### 1. アプリケーションを起動
```bash
# 開発サーバーが起動済みであることを確認
http://127.0.0.1:5176/
```

### 2. デバッグ機能の確認手順

#### Step 1: フレーム選択
1. 任意のフレームを選択（例：「Laptop 1 (16:9)」）
2. 3つのデバイスエリアが表示されることを確認

#### Step 2: EnhancedDebugPanelの確認
画面下部に新しいデバッグパネルが表示されます：
- **紫〜青のグラデーションヘッダー**: "🔬 Enhanced Debug Panel"
- **Debug: OFF** と **Panel: VISIBLE** のバッジが表示

#### Step 3: デバッグモードをON
1. 右下の「Debug」ボタンをクリック
2. EnhancedDebugPanelの **Debug: ON** バッジが緑色に変化
3. 追加の診断情報セクションが表示される

#### Step 4: デバイスエリアをクリック
1. デバイス1〜3のいずれかをクリック
2. ブラウザのコンソールでログを確認
3. EnhancedDebugPanelで以下を確認：
   - **Diagnostic Info**: パネル状態の詳細
   - **Selected Device**: 選択中のデバイス情報
   - **Analysis Data**: 生成された分析データ
   - **Event Log**: クリックイベントの記録

## 🔍 デバッグパネルの見方

### Diagnostic Info セクション
```
Debug Mode: ✅ ON / ❌ OFF
Panel Visible: ✅ Yes / ❌ No
Selected Device: ✅ Device 1 / ❌ None
Device Regions: 3 regions
White Margin Analyses: 1 items
Orientation Analyses: 1 items
Has Selected Data: ✅ / ❌
```

### Selected Device セクション
選択中のデバイスの詳細情報：
- Index: デバイス番号（0始まり）
- Fill Color: 識別色
- Active: アクティブ状態
- Has Image: 画像の有無
- Has Rect: 領域データの有無
- Rect座標: X/Y/W/H（パーセント表示）

### Analysis Data セクション
- **Orientation**: デバイスの向き分析
  - Type: laptop/smartphone/tablet
  - Rotation: 回転角度
  - Aspect: アスペクト比
  - Portrait: 縦向きかどうか

- **White Margin**: 白い余白分析
  - Has Margin: 余白の有無
  - Required Bleed: 必要なブリード率

### Event Log セクション
最新10件のイベントが表示：
- タイムスタンプ
- イベントタイプ（state/event/render/analysis）
- コンポーネント名
- アクション名
- 詳細データ（JSON形式）

### All Device Regions セクション
すべてのデバイス領域の状態を一覧表示：
- 各デバイスのカード表示
- 選択中のデバイスは青枠でハイライト
- 各プロパティの状態を✅/❌で表示

## ❗ トラブルシューティング

### Q: デバッグパネルが表示されない
**A:** EnhancedDebugPanelは常に表示されるはずです。表示されない場合：
1. ブラウザのコンソールでエラーを確認
2. ページをリロード（Ctrl+R / Cmd+R）
3. 開発サーバーを再起動

### Q: デバイスクリック時に情報が更新されない
**A:** コンソールログを確認：
```javascript
// 以下のようなログが出力されるか確認
🖱️ Device 1 clicked - BEFORE state update
✅ Device 1 selected - state updated
```
出力されない場合、クリックイベントが正しく動作していません。

### Q: 分析データが生成されない
**A:** デバッグモードがONになっているか確認：
1. 右下の「Debug」ボタンでONに
2. コンソールで `📊 Device X detailed info:` が出力されるか確認
3. `region.rect` がnullの場合は分析データが生成されません

### Q: 旧デバッグパネルと新パネルが重なる
**A:** これは正常な動作です：
- **旧パネル（DebugPanel）**: debugMode ONで画像アップロード後に詳細表示
- **新パネル（EnhancedDebugPanel）**: 常時表示で診断情報を提供

## 🚀 今後の改善提案

### 1. パネルの切り替え機能
```typescript
// トグルボタンで切り替え
const [useEnhancedPanel, setUseEnhancedPanel] = useState(true);
```

### 2. イベントログのエクスポート
```typescript
// JSONファイルとしてダウンロード
const exportLogs = () => {
  const blob = new Blob([JSON.stringify(debugEvents)], { type: 'application/json' });
  // ... ダウンロード処理
};
```

### 3. フィルタリング機能
```typescript
// イベントタイプでフィルタ
const filteredEvents = debugEvents.filter(e => e.type === selectedType);
```

### 4. パフォーマンスメトリクス
```typescript
// レンダリング時間の計測
const measurePerformance = () => {
  const start = performance.now();
  // ... 処理
  const end = performance.now();
  logDebugEvent({ /* ... */ });
};
```

## 📝 技術仕様

### コンポーネント構造
```
MultiDeviceMockup.tsx
├── DebugPanel（既存）
│   └── デバッグモード時の詳細分析表示
└── EnhancedDebugPanel（新規）
    ├── 診断情報
    ├── イベントログ
    ├── 選択デバイス情報
    └── 全デバイス状態
```

### State管理
- `debugMode`: デバッグモードのON/OFF
- `selectedDeviceIndex`: 選択中のデバイス番号
- `orientationAnalyses`: デバイス向き分析データ
- `whiteMarginAnalyses`: 白余白分析データ
- `deviceRegions`: デバイス領域データ

### イベントフロー
1. デバイスクリック
2. onClick ハンドラー実行
3. コンソールログ出力（詳細）
4. State更新（selectedDeviceIndex）
5. debugMode時：分析データ生成
6. State更新（analyses）
7. EnhancedDebugPanel再レンダリング
8. イベントログ記録

## 🎉 まとめ

新しい包括的なデバッグシステムにより：
- **問題の早期発見**: 詳細なログとリアルタイム診断
- **開発効率の向上**: 状態の可視化とイベント追跡
- **デバッグの容易性**: 一目で分かる診断情報

これにより、「デバッグモードONでエリアを選択してもデバッグパネルに何も表示されない」問題を完全に解決し、さらに詳細な分析機能を提供できるようになりました。