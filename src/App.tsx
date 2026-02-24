import { useShipData } from "./hooks/useShipData";
import { HarborScene } from "./components/HarborScene";
import { StatusBar } from "./components/StatusBar";

function App() {
  const { ships, connectionStatus, shipCount } = useShipData();

  return (
    <>
      <StatusBar shipCount={shipCount} connectionStatus={connectionStatus} />
      <HarborScene ships={ships} />
    </>
  );
}

export default App;
