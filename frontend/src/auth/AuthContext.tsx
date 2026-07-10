import { Amplify } from "aws-amplify";
import {
  autoSignIn,
  confirmSignIn,
  confirmSignUp,
  fetchAuthSession,
  fetchUserAttributes,
  getCurrentUser,
  signIn,
  signInWithRedirect,
  signOut,
  signUp
} from "aws-amplify/auth";
import { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";
import { api, configureApi } from "../lib/api";

export type AuthMode = "local" | "cognito";

interface UserSession {
  id: string;
  username: string;
}

interface AuthContextValue {
  mode: AuthMode;
  user: UserSession | null;
  loading: boolean;
  otpPending: boolean;
  login(username: string, password: string): Promise<void>;
  register(email: string, username: string, password: string): Promise<void>;
  requestEmailOtp(email: string): Promise<void>;
  confirmEmailOtp(code: string): Promise<void>;
  signInWithGoogle(): Promise<void>;
  logout(): Promise<void>;
  refresh(): Promise<void>;
}

const LOCAL_SESSION_KEY = "closethop.local.session";
const AuthContext = createContext<AuthContextValue | null>(null);

function firstPresent(...values: Array<string | undefined>) {
  return values.map((value) => value?.trim()).find(Boolean);
}

function cognitoProfileName(
  attributes: Awaited<ReturnType<typeof fetchUserAttributes>>,
  fallback: string
) {
  const fullName = firstPresent(
    attributes.name,
    [attributes.given_name, attributes.family_name].filter(Boolean).join(" ")
  );
  const emailName = attributes.email?.split("@")[0];
  return firstPresent(fullName, attributes.preferred_username, emailName, fallback) ?? fallback;
}

function configureCognito() {
  const userPoolId = import.meta.env.VITE_COGNITO_USER_POOL_ID;
  const userPoolClientId = import.meta.env.VITE_COGNITO_CLIENT_ID;
  const domain = import.meta.env.VITE_COGNITO_DOMAIN;
  if (!userPoolId || !userPoolClientId || !domain) {
    throw new Error("Cognito mode requires user pool, client, and domain environment values.");
  }
  Amplify.configure({
    Auth: {
      Cognito: {
        userPoolId,
        userPoolClientId,
        loginWith: {
          oauth: {
            domain,
            scopes: ["openid", "email", "profile"],
            redirectSignIn: [
              import.meta.env.VITE_COGNITO_REDIRECT_SIGN_IN ?? "http://localhost:3000/auth/callback"
            ],
            redirectSignOut: [
              import.meta.env.VITE_COGNITO_REDIRECT_SIGN_OUT ?? "http://localhost:3000"
            ],
            responseType: "code"
          }
        }
      }
    }
  });
}

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const mode: AuthMode = import.meta.env.VITE_AUTH_MODE === "cognito" ? "cognito" : "local";
  const [user, setUser] = useState<UserSession | null>(null);
  const [loading, setLoading] = useState(true);
  const [otpPending, setOtpPending] = useState(false);
  const [otpStep, setOtpStep] = useState<"signIn" | "signUp">("signIn");
  const [otpEmail, setOtpEmail] = useState("");

  const getToken = useCallback(async () => {
    if (mode === "local") {
      const stored = sessionStorage.getItem(LOCAL_SESSION_KEY);
      return stored ? (JSON.parse(stored) as { token: string }).token : null;
    }
    try {
      return (await fetchAuthSession()).tokens?.accessToken.toString() ?? null;
    } catch {
      return null;
    }
  }, [mode]);

  const clearSession = useCallback(() => {
    sessionStorage.removeItem(LOCAL_SESSION_KEY);
    setUser(null);
  }, []);

  const refresh = useCallback(async () => {
    if (mode === "local") {
      const stored = sessionStorage.getItem(LOCAL_SESSION_KEY);
      setUser(stored ? (JSON.parse(stored) as UserSession) : null);
      return;
    }
    try {
      const current = await getCurrentUser();
      const attributes = await fetchUserAttributes();
      const profileName = cognitoProfileName(attributes, current.username);
      const profile = await api.users.updateProfileName(profileName);
      setUser({ id: current.userId, username: profile.username });
    } catch {
      setUser(null);
    }
  }, [mode]);

  useEffect(() => {
    if (mode === "cognito") configureCognito();
    configureApi(getToken, clearSession);
    refresh().finally(() => setLoading(false));
  }, [clearSession, getToken, mode, refresh]);

  const login = async (username: string, password: string) => {
    if (mode !== "local") throw new Error("Password login is only available in local mode.");
    const response = await api.login(username, password);
    sessionStorage.setItem(
      LOCAL_SESSION_KEY,
      JSON.stringify({ id: response.userId, username: response.username, token: response.token })
    );
    setUser({ id: response.userId, username: response.username });
  };

  const register = async (email: string, username: string, password: string) => {
    if (mode !== "local") throw new Error("Registration is only available in local mode.");
    const response = await api.register(email, username, password);
    sessionStorage.setItem(
      LOCAL_SESSION_KEY,
      JSON.stringify({ id: response.userId, username: response.username, token: response.token })
    );
    setUser({ id: response.userId, username: response.username });
  };

  const requestEmailOtp = async (email: string) => {
    if (mode !== "cognito") throw new Error("Email OTP is only available in Cognito mode.");
    setOtpEmail(email);
    try {
      const result = await signIn({ username: email, options: { authFlowType: "USER_AUTH", preferredChallenge: "EMAIL_OTP" } });
      if (result.isSignedIn) await refresh();
      else {
        setOtpStep("signIn");
        setOtpPending(true);
      }
    } catch (reason) {
      if (!(reason instanceof Error) || reason.name !== "UserNotFoundException") throw reason;
      await signUp({
        username: email,
        options: {
          userAttributes: { email },
          autoSignIn: { authFlowType: "USER_AUTH" }
        }
      });
      setOtpStep("signUp");
      setOtpPending(true);
    }
  };

  const confirmEmailOtp = async (code: string) => {
    if (otpStep === "signUp") {
      await confirmSignUp({ username: otpEmail, confirmationCode: code });
      const result = await autoSignIn();
      if (result.isSignedIn) {
        setOtpPending(false);
        await refresh();
      }
      return;
    }
    const result = await confirmSignIn({ challengeResponse: code });
    if (result.isSignedIn) {
      setOtpPending(false);
      await refresh();
    }
  };

  const value = useMemo<AuthContextValue>(
    () => ({
      mode,
      user,
      loading,
      otpPending,
      login,
      register,
      requestEmailOtp,
      confirmEmailOtp,
      signInWithGoogle: async () => {
        if (mode !== "cognito") throw new Error("Google sign-in is only available in Cognito mode.");
        await signInWithRedirect({ provider: "Google" });
      },
      logout: async () => {
        if (mode === "cognito") await signOut();
        clearSession();
      },
      refresh
    }),
    [loading, mode, otpPending, user, refresh, clearSession]
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const context = useContext(AuthContext);
  if (!context) throw new Error("useAuth must be used inside AuthProvider.");
  return context;
}
