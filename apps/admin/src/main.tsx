import "@yorozu/ui/styles/tokens.css";
import "@yorozu/ui/styles/global.css";
import "./styles/admin-tokens.css";
import { render } from "solid-js/web";
import App from "./App";

render(() => <App />, document.getElementById("root") as HTMLElement);
