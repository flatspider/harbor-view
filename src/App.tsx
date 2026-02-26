import { useShipData } from "./hooks/useShipData";
import { useAircraftData } from "./hooks/useAircraftData";
import { useIntegrations } from "./hooks/useIntegrations";
import { HarborScene } from "./components/HarborScene";
import { StatusBar } from "./components/StatusBar";
import { ConditionsStrip } from "./components/ConditionsStrip";
import { toHarborEnvironment } from "./types/environment";

function App() {
  const { ships, connectionStatus, shipCount } = useShipData();
  const { aircraft, aircraftCount } = useAircraftData();
  const { sources } = useIntegrations();
  const environment = toHarborEnvironment(sources);

  return (
    <>
      <StatusBar shipCount={shipCount} aircraftCount={aircraftCount} connectionStatus={connectionStatus} />
      <ConditionsStrip environment={environment} />
      <HarborScene ships={ships} aircraft={aircraft} environment={environment} />
    </>
  );
}

export default App;
