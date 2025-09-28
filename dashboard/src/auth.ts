import SuperTokens from "supertokens-auth-react";
import Session, { useSessionContext } from "supertokens-auth-react/recipe/session";

const AUTH_ENABLED = (import.meta.env.VITE_TRIBUTE_ENABLE_AUTH ?? "false").toString().toLowerCase() === "true";

let initialized = false;

export const isAuthEnabled = AUTH_ENABLED;

export const initAuth = (): boolean => {
  if (!AUTH_ENABLED) {
    return false;
  }
  if (initialized) {
    return true;
  }
  initialized = true;

  const domain = typeof window !== "undefined" ? window.location.origin : "";

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

  return true;
};

export interface SessionSummary {
  loading: boolean;
  userId: string | null;
  doesSessionExist: boolean;
}

export const useSessionSummary = (): SessionSummary => {
  if (!AUTH_ENABLED) {
    return { loading: false, userId: null, doesSessionExist: false };
  }
  const session = useSessionContext();
  return {
    loading: session.loading,
    userId: session.userId ?? null,
    doesSessionExist: session.doesSessionExist,
  };
};
