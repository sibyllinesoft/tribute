import React from "react";
import ReactDOM from "react-dom/client";
import { SuperTokensWrapper } from "supertokens-auth-react";
import App from "./App";
import { initAuth } from "./auth";
import "./styles.css";

initAuth();

ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
  <React.StrictMode>
    <SuperTokensWrapper>
      <App />
    </SuperTokensWrapper>
  </React.StrictMode>
);
