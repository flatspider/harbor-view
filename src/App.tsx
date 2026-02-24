import { useShipData } from "./hooks/useShipData";
import { useIntegrations } from "./hooks/useIntegrations";
import { HarborScene } from "./components/HarborScene";
import { StatusBar } from "./components/StatusBar";
import { IntegrationsPanel } from "./components/IntegrationsPanel";

function App() {
  const { ships, connectionStatus, shipCount } = useShipData();
  const { sources, updatedAt, isLoading } = useIntegrations();

  return (
    <>
      <StatusBar shipCount={shipCount} connectionStatus={connectionStatus} />
      <IntegrationsPanel
        sources={sources}
        updatedAt={updatedAt}
        isLoading={isLoading}
      />
      <HarborScene ships={ships} />
    </>
  );
}

export default App;
