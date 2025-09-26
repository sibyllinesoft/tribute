import SuperTokens from "supertokens-auth-react";
import Session from "supertokens-auth-react/recipe/session";

let initialized = false;

export const initAuth = () => {
  if (initialized) {
    return;
  }
  initialized = true;

  const domain = window.location.origin;

  SuperTokens.init({
    appInfo: {
      appName: "Tribute Dashboard",
      apiDomain: domain,
      websiteDomain: domain,
      apiBasePath: "/auth",
      websiteBasePath: "/auth",
    },
    recipeList: [Session.init()],
  });
};
