import { Amplify } from "aws-amplify";
import {
  autoSignIn,
  confirmSignIn,
  confirmSignUp,
  fetchAuthSession,
  fetchUserAttributes,
  getCurrentUser,
  resendSignUpCode,
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
const ALREADY_SIGNED_IN_MESSAGE = "There is already a signed in user.";
const USERNAME_EXISTS_ERROR = "UsernameExistsException";
const CONFIRM_SIGN_UP_STEP = "CONFIRM_SIGN_UP";

interface CognitoErrorLike {
  name?: unknown;
  __type?: unknown;
  message?: unknown;
  cause?: unknown;
}

function firstPresent(...values: Array<string | undefined>) {
  return values.map((value) => value?.trim()).find(Boolean);
}

function normalizeCognitoDomain(domain: string) {
  return domain.trim().replace(/^https?:\/\//, "").replace(/\/$/, "");
}

function cognitoErrorChain(reason: unknown): CognitoErrorLike[] {
  const chain: CognitoErrorLike[] = [];
  let current = reason;
  while (typeof current === "object" && current !== null) {
    chain.push(current as CognitoErrorLike);
    current = "cause" in current ? (current as CognitoErrorLike).cause : null;
  }
  return chain;
}

function cognitoErrorNames(reason: unknown) {
  return cognitoErrorChain(reason).flatMap((error) => [error.name, error.__type]).flatMap((value) => {
    const normalized = typeof value === "string" ? value.trim() : "";
    if (!normalized) return [];
    const shortName = normalized.split(/[#:]/).pop() ?? normalized;
    return [normalized, shortName];
  });
}

function hasCognitoErrorName(reason: unknown, name: string) {
  return cognitoErrorNames(reason).some((value) => value === name);
}

function hasCognitoErrorMessage(reason: unknown, message: string) {
  if (reason instanceof Error && reason.message === message) return true;
  return cognitoErrorChain(reason).some((error) => error.message === message);
}

function isAlreadySignedInUserError(reason: unknown) {
  return hasCognitoErrorMessage(reason, ALREADY_SIGNED_IN_MESSAGE);
}

function isUsernameExistsError(reason: unknown) {
  return hasCognitoErrorName(reason, USERNAME_EXISTS_ERROR);
}

function stringClaim(value: unknown) {
  return typeof value === "string" ? value : undefined;
}

function cognitoProfileName(
  attributes: Record<string, unknown>,
  fallback: string
) {
  const fullName = firstPresent(
    stringClaim(attributes.name),
    [stringClaim(attributes.given_name), stringClaim(attributes.family_name)].filter(Boolean).join(" ")
  );
  const emailName = stringClaim(attributes.email)?.split("@")[0];
  return firstPresent(fullName, stringClaim(attributes.preferred_username), emailName, fallback) ?? fallback;
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
            domain: normalizeCognitoDomain(domain),
            scopes: ["openid", "email", "profile", "aws.cognito.signin.user.admin"],
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

  const clearCognitoSession = useCallback(async () => {
    try {
      await signOut();
    } catch {
      // If Cognito's cached session is already invalid, still clear app state.
    }
    clearSession();
    setOtpPending(false);
  }, [clearSession]);

  const getCognitoProfileAttributes = useCallback(async () => {
    const session = await fetchAuthSession();
    const idTokenPayload = session.tokens?.idToken?.payload ?? {};
    const tokenAttributes = {
      name: idTokenPayload.name,
      given_name: idTokenPayload.given_name,
      family_name: idTokenPayload.family_name,
      preferred_username: idTokenPayload.preferred_username,
      email: idTokenPayload.email
    };
    if (cognitoProfileName(tokenAttributes, "")) return tokenAttributes;
    return fetchUserAttributes();
  }, []);

  const refresh = useCallback(async () => {
    if (mode === "local") {
      const stored = sessionStorage.getItem(LOCAL_SESSION_KEY);
      setUser(stored ? (JSON.parse(stored) as UserSession) : null);
      return;
    }
    let foundCognitoUser = false;
    try {
      const current = await getCurrentUser();
      foundCognitoUser = true;
      const attributes = await getCognitoProfileAttributes();
      const profileName = cognitoProfileName(attributes, current.username);
      const profile = await api.users.updateProfileName(profileName);
      setUser({ id: current.userId, username: profile.username });
    } catch (reason) {
      if (foundCognitoUser) await clearCognitoSession();
      setUser(null);
    }
  }, [clearCognitoSession, getCognitoProfileAttributes, mode]);

  const beginExistingUserEmailOtp = useCallback(async (email: string) => {
    const result = await signIn({
      username: email,
      options: { authFlowType: "USER_AUTH", preferredChallenge: "EMAIL_OTP" }
    });
    if (result.isSignedIn) {
      setOtpPending(false);
      await refresh();
      return;
    }

    const needsSignUpConfirmation = result.nextStep.signInStep === CONFIRM_SIGN_UP_STEP;
    if (needsSignUpConfirmation) {
      await resendSignUpCode({ username: email });
    }

    setOtpStep(needsSignUpConfirmation ? "signUp" : "signIn");
    setOtpPending(true);
  }, [refresh]);

  const beginNewUserEmailOtp = useCallback(async (email: string) => {
    const result = await signUp({
      username: email,
      options: {
        userAttributes: { email },
        autoSignIn: { authFlowType: "USER_AUTH" }
      }
    });

    if (result.isSignUpComplete) {
      setOtpPending(false);
      await refresh();
      return;
    }

    setOtpStep("signUp");
    setOtpPending(true);
  }, [refresh]);

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
    const normalizedEmail = email.trim();
    setOtpEmail(normalizedEmail);
    const startEmailOtp = async () => {
      try {
        await beginNewUserEmailOtp(normalizedEmail);
      } catch (reason) {
        if (!isUsernameExistsError(reason)) throw reason;
        await beginExistingUserEmailOtp(normalizedEmail);
      }
    };

    try {
      await startEmailOtp();
    } catch (reason) {
      if (!isAlreadySignedInUserError(reason)) throw reason;
      await clearCognitoSession();
      await startEmailOtp();
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
        try {
          await signInWithRedirect({ provider: "Google" });
        } catch (reason) {
          if (!isAlreadySignedInUserError(reason)) throw reason;
          await clearCognitoSession();
          await signInWithRedirect({ provider: "Google" });
        }
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
