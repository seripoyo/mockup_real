import React from 'react';
import type { WhiteMarginAnalysis, DeviceOrientationAnalysis } from '../features/mockup/utils/debugAnalysis';

interface DebugPanelProps {
  whiteMarginAnalyses: WhiteMarginAnalysis[];
  orientationAnalyses: DeviceOrientationAnalysis[];
  isVisible: boolean;
}

export const DebugPanel: React.FC<DebugPanelProps> = ({
  whiteMarginAnalyses,
  orientationAnalyses,
  isVisible
}) => {
  if (!isVisible) return null;

  return (
    <div className="fixed bottom-0 left-0 right-0 bg-black bg-opacity-90 text-white p-4 max-h-96 overflow-y-auto z-50">
      <h3 className="text-lg font-bold mb-4">🔍 デバッグ分析結果</h3>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {/* 白い余白分析 */}
        <div>
          <h4 className="text-md font-semibold mb-2 text-yellow-400">📐 白い余白検出</h4>
          {whiteMarginAnalyses.map((analysis, index) => (
            <div key={index} className="mb-3 p-2 border border-gray-600 rounded">
              <div className="text-sm">
                <div className="font-semibold text-cyan-400">デバイス {analysis.deviceIndex + 1}</div>

                {analysis.hasWhiteMargin ? (
                  <div className="text-red-400">
                    ⚠️ 白い余白が検出されました！
                    <div className="ml-4 mt-1">
                      <div>上: {analysis.marginLocations.top}px</div>
                      <div>下: {analysis.marginLocations.bottom}px</div>
                      <div>左: {analysis.marginLocations.left}px</div>
                      <div>右: {analysis.marginLocations.right}px</div>
                      <div className="font-bold text-yellow-400 mt-1">
                        推奨ブリード: {analysis.requiredBleedPercentage}%
                      </div>
                    </div>
                  </div>
                ) : (
                  <div className="text-green-400">✓ 余白なし</div>
                )}

                <div className="text-xs text-gray-400 mt-1">
                  白ピクセル: {analysis.detectedWhitePixels}/{analysis.totalEdgePixels}
                  ({(analysis.whitePixelRatio * 100).toFixed(2)}%)
                </div>

                {analysis.recommendations.length > 0 && (
                  <div className="mt-2 text-xs">
                    <div className="font-semibold">推奨事項:</div>
                    {analysis.recommendations.map((rec, i) => (
                      <div key={i} className="ml-2">• {rec}</div>
                    ))}
                  </div>
                )}
              </div>
            </div>
          ))}
        </div>

        {/* デバイス向き分析 */}
        <div>
          <h4 className="text-md font-semibold mb-2 text-green-400">🧭 デバイス向き分析</h4>
          {orientationAnalyses.map((analysis, index) => (
            <div key={index} className="mb-3 p-2 border border-gray-600 rounded">
              <div className="text-sm">
                <div className="font-semibold text-cyan-400">
                  デバイス {analysis.deviceIndex + 1} ({analysis.deviceType})
                </div>

                <div className="ml-4 mt-1">
                  <div>デバイス回転: {Math.round(analysis.deviceRotation)}°</div>
                  <div>主軸角度: {Math.round(analysis.majorAxisAngle)}°</div>

                  {analysis.notchPosition.angle > 0 && (
                    <div className="text-yellow-400">
                      ノッチ位置: ({Math.round(analysis.notchPosition.x)}, {Math.round(analysis.notchPosition.y)})
                      <br />
                      ノッチ角度: {Math.round(analysis.notchPosition.angle)}°
                    </div>
                  )}

                  <div className="font-bold text-green-400 mt-1">
                    推奨画像回転: {Math.round(analysis.recommendedImageRotation)}°
                  </div>
                </div>

                <div className="text-xs text-gray-400 mt-1">
                  アスペクト比: {analysis.analysisDetails.aspectRatio.toFixed(2)}
                  {analysis.analysisDetails.isPortrait && ' (縦向き)'}
                  {analysis.analysisDetails.isLandscape && ' (横向き)'}
                  {analysis.analysisDetails.isDiagonal && ' (斜め)'}
                </div>
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* サマリー */}
      <div className="mt-4 pt-4 border-t border-gray-600">
        <h4 className="text-md font-semibold mb-2">📊 サマリー</h4>
        <div className="text-sm">
          {whiteMarginAnalyses.filter(a => a.hasWhiteMargin).length > 0 ? (
            <div className="text-red-400">
              ⚠️ {whiteMarginAnalyses.filter(a => a.hasWhiteMargin).length}個のデバイスで白い余白が検出されました
            </div>
          ) : (
            <div className="text-green-400">
              ✓ すべてのデバイスで余白なし
            </div>
          )}

          <div className="mt-1">
            画像回転が必要なデバイス: {
              orientationAnalyses.filter(a => a.recommendedImageRotation !== 0).length
            }個
          </div>
        </div>
      </div>
    </div>
  );
};