import { useState, useCallback } from "react";
import { useShipData } from "./hooks/useShipData";
import { HarborScene } from "./components/HarborScene";
import { StatusBar } from "./components/StatusBar";

const STORAGE_KEY = "harbor-watch-api-key";

function App() {
  const [apiKey, setApiKey] = useState<string>(
    () => localStorage.getItem(STORAGE_KEY) || ""
  );
  const [inputKey, setInputKey] = useState("");
  const [started, setStarted] = useState(() => !!localStorage.getItem(STORAGE_KEY));

  const { ships, connectionStatus, shipCount } = useShipData({
    apiKey,
    enabled: started,
  });

  const handleSubmit = useCallback(
    (e: React.FormEvent) => {
      e.preventDefault();
      if (inputKey.trim()) {
        localStorage.setItem(STORAGE_KEY, inputKey.trim());
        setApiKey(inputKey.trim());
        setStarted(true);
      }
    },
    [inputKey]
  );

  if (!started) {
    return (
      <div className="api-key-screen">
        <h1>Harbor Watch</h1>
        <p>
          Real-time visualization of New York Harbor. Enter your{" "}
          <a href="https://aisstream.io" target="_blank" rel="noreferrer">
            aisstream.io
          </a>{" "}
          API key to connect to live ship tracking data.
        </p>
        <form className="api-key-form" onSubmit={handleSubmit}>
          <input
            type="text"
            placeholder="Paste your API key"
            value={inputKey}
            onChange={(e) => setInputKey(e.target.value)}
            autoFocus
          />
          <button type="submit">Connect</button>
        </form>
      </div>
    );
  }

  return (
    <>
      <StatusBar shipCount={shipCount} connectionStatus={connectionStatus} />
      <HarborScene ships={ships} />
    </>
  );
}

export default App;
