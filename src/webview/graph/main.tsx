import { render } from "preact";
import { App } from "./app";
import { initVsCodeApi } from "./signals";
import "./styles/global.css";

initVsCodeApi();
render(<App />, document.getElementById("root")!);
