import { useEffect, useState } from 'react';
import { useSystemStore } from './store/systemStore';
import { useIsMobile } from './lib/useIsMobile';
import { hydrateFromDb } from './lib/dbHydrate';
import { tauriClient } from './lib/tauriClient';
import { DesktopShell } from './components/layout/DesktopShell';
import { MobileShell } from './components/layout/MobileShell';

function App() {
  const isMobile = useIsMobile();
  const [ready, setReady] = useState(false);

  useEffect(() => {
    hydrateFromDb().then(async () => {
      // Initialize sidecar IPC (Tauri event listener + process start)
      await tauriClient.init();
      useSystemStore.getState().setConnected(true);
      setReady(true);
    });
  }, []);

  if (!ready) {
    return (
      <div className="flex items-center justify-center h-screen w-full bg-[#0e0e0e]">
        <div className="text-center">
          <div className="text-2xl font-bold text-[#e5e2e1] mb-2">🐟 tunaChat</div>
          <p className="text-[12px] text-[#e5e2e1]/40">로딩 중...</p>
        </div>
      </div>
    );
  }

  return isMobile ? <MobileShell /> : <DesktopShell />;
}

export default App;
