import React from "react";
import ReactDOM from "react-dom/client";
import { SuperTokensWrapper } from "supertokens-auth-react";
import App from "./App";
import { initAuth } from "./auth";
import "./styles.css";

const authInitialized = initAuth();

const Root = authInitialized ? (
  <SuperTokensWrapper>
    <App />
  </SuperTokensWrapper>
) : (
  <App />
);

ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
  <React.StrictMode>{Root}</React.StrictMode>
);
