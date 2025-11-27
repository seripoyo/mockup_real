import MinimalMockup from "./features/mockup/components/MinimalMockup";
import ErrorBoundary from "./components/ErrorBoundary";

function App() {
  return (
    <main
      className="min-h-screen flex items-center justify-center relative bg-[#F6F4F1] bg-cover bg-center bg-no-repeat"
      style={{
        backgroundImage: "url(/assets/youware-bg.png)",
      }}
    >
      <div className="z-10 w-full">
        <div className="text-center max-w-4xl mx-auto px-6 py-8">
          <h1 className="text-black font-normal leading-tight text-center mb-4 text-3xl sm:text-4xl lg:text-5xl">
            モックアップ生成（最小版）
          </h1>
          <p className="text-black/80 leading-relaxed text-center max-w-2xl mx-auto text-sm sm:text-base">
            フレーム選択・画像アップロード・プレビューを試せます
          </p>
        </div>
        <ErrorBoundary>
          <MinimalMockup />
        </ErrorBoundary>
      </div>
    </main>
  );
}

export default App;
