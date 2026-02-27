import { useCallback, useEffect, useState } from "react";
import { useShipData } from "./hooks/useShipData";
import { useAircraftData } from "./hooks/useAircraftData";
import { useIntegrations } from "./hooks/useIntegrations";
import { HarborScene } from "./components/HarborScene";
import { StatusBar } from "./components/StatusBar";
import { ConditionsStrip } from "./components/ConditionsStrip";
import { RadarLoadingScreen } from "./components/RadarLoadingScreen";
import { toHarborEnvironment } from "./types/environment";

function App() {
  const { ships, connectionStatus, shipCount, hasInitialFetchComplete: hasInitialShipFetchComplete } = useShipData();
  const { aircraft, aircraftCount, hasInitialFetchComplete: hasInitialAircraftFetchComplete } = useAircraftData();
  const { sources } = useIntegrations();
  const [sceneReady, setSceneReady] = useState(false);
  const [showLoader, setShowLoader] = useState(true);
  const environment = toHarborEnvironment(sources);
  const appReady = sceneReady && hasInitialShipFetchComplete && hasInitialAircraftFetchComplete;
  const loaderDismissing = showLoader && appReady;

  const handleSceneReady = useCallback(() => {
    setSceneReady(true);
  }, []);

  useEffect(() => {
    if (!appReady || !showLoader) return;
    const timer = window.setTimeout(() => {
      setShowLoader(false);
    }, 850);
    return () => window.clearTimeout(timer);
  }, [appReady, showLoader]);

  return (
    <>
      <StatusBar shipCount={shipCount} aircraftCount={aircraftCount} connectionStatus={connectionStatus} />
      <ConditionsStrip environment={environment} />
      <HarborScene ships={ships} aircraft={aircraft} environment={environment} onSceneReady={handleSceneReady} />
      {showLoader ? <RadarLoadingScreen dismissing={loaderDismissing} /> : null}
    </>
  );
}

export default App;
