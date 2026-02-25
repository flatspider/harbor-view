import { useShipData } from "./hooks/useShipData";
import { useIntegrations } from "./hooks/useIntegrations";
import { HarborScene } from "./components/HarborScene";
import { StatusBar } from "./components/StatusBar";
import { ConditionsStrip } from "./components/ConditionsStrip";
import { toHarborEnvironment } from "./types/environment";

function App() {
  const { ships, connectionStatus, shipCount } = useShipData();
  const { sources } = useIntegrations();
  const environment = toHarborEnvironment(sources);

  return (
    <>
      <StatusBar shipCount={shipCount} connectionStatus={connectionStatus} />
      <ConditionsStrip environment={environment} />
      <HarborScene ships={ships} environment={environment} />
    </>
  );
}

export default App;
