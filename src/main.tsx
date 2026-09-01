import "@fontsource/barlow-condensed/latin-400.css";
import "@fontsource/barlow-condensed/latin-500.css";
import "@fontsource/barlow-condensed/latin-600.css";
import "@fontsource/barlow-condensed/latin-700.css";
import "@fontsource/ibm-plex-mono/latin-400.css";
import "@fontsource/ibm-plex-mono/latin-500.css";
import "@fontsource/source-sans-3/latin-400.css";
import "@fontsource/source-sans-3/latin-600.css";
import { createRoot } from "react-dom/client";
import { App } from "./app/App";
import "./styles.css";

const root = document.getElementById("root");
if (!root) {
  throw new Error("Application root was not found.");
}

createRoot(root).render(<App />);
