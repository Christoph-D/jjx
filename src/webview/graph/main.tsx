import { render } from "preact";
import { App } from "./app";
import { initVsCodeApi } from "./signals";

initVsCodeApi();
render(<App />, document.getElementById("root")!);
