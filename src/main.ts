import "./styles/index.css";
import { LatexWorkspaceApp } from "./app";

const app = new LatexWorkspaceApp();
app.start();

window.addEventListener("beforeunload", () => app.dispose(), { once: true });
