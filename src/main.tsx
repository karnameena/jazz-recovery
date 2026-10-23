import { createRoot } from "react-dom/client";
import { App } from "./App";
import "./styles.css";
import "./responsive-fixes.css";

createRoot(document.getElementById("root")!).render(<App />);
