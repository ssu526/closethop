import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { AuthProvider, useAuth } from "./AuthContext";
import { api } from "../lib/api";

const authMocks = vi.hoisted(() => ({
  autoSignIn: vi.fn(),
  confirmSignIn: vi.fn(),
  confirmSignUp: vi.fn(),
  fetchAuthSession: vi.fn(),
  fetchUserAttributes: vi.fn(),
  getCurrentUser: vi.fn(),
  resendSignUpCode: vi.fn(),
  signIn: vi.fn(),
  signInWithRedirect: vi.fn(),
  signOut: vi.fn(),
  signUp: vi.fn(),
}));

const amplifyMocks = vi.hoisted(() => ({
  configure: vi.fn(),
}));

vi.mock("aws-amplify", () => ({
  Amplify: { configure: amplifyMocks.configure },
}));

vi.mock("aws-amplify/auth", () => authMocks);

function AuthHarness() {
  const auth = useAuth();

  return (
    <div>
      <div>{auth.loading ? "loading" : "ready"}</div>
      <div>{auth.user?.username ?? "anonymous"}</div>
      <div>{auth.otpPending ? "otp-pending" : "otp-idle"}</div>
      <button type="button" onClick={() => void auth.signInWithGoogle()}>
        Continue with Google
      </button>
      <button type="button" onClick={() => void auth.requestEmailOtp("sue@example.com")}>
        Email me a code
      </button>
    </div>
  );
}

describe("AuthProvider Cognito auth", () => {
  beforeEach(() => {
    vi.stubEnv("VITE_AUTH_MODE", "cognito");
    vi.stubEnv("VITE_COGNITO_USER_POOL_ID", "pool-id");
    vi.stubEnv("VITE_COGNITO_CLIENT_ID", "client-id");
    vi.stubEnv("VITE_COGNITO_DOMAIN", "closethop.auth.us-east-1.amazoncognito.com");
    vi.stubEnv("VITE_COGNITO_REDIRECT_SIGN_IN", "http://localhost:3000/auth/callback");
    vi.stubEnv("VITE_COGNITO_REDIRECT_SIGN_OUT", "http://localhost:3000");

    authMocks.fetchAuthSession.mockResolvedValue({ tokens: { accessToken: { toString: () => "token" } } });
    authMocks.fetchUserAttributes.mockResolvedValue({ email: "sue@example.com", preferred_username: "sue" });
    authMocks.getCurrentUser.mockRejectedValue(new Error("not signed in"));
    authMocks.resendSignUpCode.mockResolvedValue(undefined);
    authMocks.signIn.mockResolvedValue({ isSignedIn: false, nextStep: { signInStep: "CONFIRM_SIGN_IN_WITH_EMAIL_CODE" } });
    authMocks.signInWithRedirect.mockResolvedValue(undefined);
    authMocks.signOut.mockResolvedValue(undefined);
    authMocks.signUp.mockResolvedValue({
      isSignUpComplete: false,
      nextStep: { signUpStep: "CONFIRM_SIGN_UP" },
      userId: "user-1"
    });

    vi.spyOn(api.users, "updateProfileName").mockResolvedValue({ username: "sue" } as never);
  });

  afterEach(() => {
    cleanup();
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
    Object.values(authMocks).forEach((mock) => mock.mockReset());
    amplifyMocks.configure.mockReset();
  });

  it("refreshes the current session when Amplify reports an existing signed-in user", async () => {
    const user = userEvent.setup();

    authMocks.getCurrentUser
      .mockRejectedValueOnce(new Error("not signed in"))
      .mockResolvedValueOnce({ userId: "user-1", username: "google_123" })
      .mockResolvedValueOnce({ userId: "user-1", username: "google_123" });
    authMocks.signInWithRedirect.mockRejectedValueOnce(new Error("There is already a signed in user."));

    render(
      <AuthProvider>
        <AuthHarness />
      </AuthProvider>,
    );

    expect(await screen.findByText("ready")).toBeInTheDocument();
    expect(screen.getByText("anonymous")).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: /continue with google/i }));

    await waitFor(() => {
      expect(screen.getByText("sue")).toBeInTheDocument();
    });
    expect(api.users.updateProfileName).toHaveBeenCalledWith("sue");
  });

  it("normalizes the hosted UI domain before configuring Amplify", async () => {
    vi.stubEnv("VITE_COGNITO_DOMAIN", "https://closethop.auth.us-east-1.amazoncognito.com/");

    render(
      <AuthProvider>
        <AuthHarness />
      </AuthProvider>,
    );

    expect(await screen.findByText("ready")).toBeInTheDocument();
    expect(amplifyMocks.configure).toHaveBeenCalledWith(
      expect.objectContaining({
        Auth: expect.objectContaining({
          Cognito: expect.objectContaining({
            loginWith: expect.objectContaining({
              oauth: expect.objectContaining({
                domain: "closethop.auth.us-east-1.amazoncognito.com"
              })
            })
          })
        })
      })
    );
  });

  it("starts sign-up confirmation for a new email OTP user", async () => {
    const user = userEvent.setup();

    render(
      <AuthProvider>
        <AuthHarness />
      </AuthProvider>,
    );

    expect(await screen.findByText("ready")).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: /email me a code/i }));

    await waitFor(() => {
      expect(screen.getByText("otp-pending")).toBeInTheDocument();
    });
    expect(authMocks.signUp).toHaveBeenCalledWith({
      username: "sue@example.com",
      options: {
        userAttributes: { email: "sue@example.com" },
        autoSignIn: { authFlowType: "USER_AUTH" }
      }
    });
    expect(authMocks.signIn).not.toHaveBeenCalled();
  });

  it("clears an existing Cognito session before starting email OTP", async () => {
    const user = userEvent.setup();

    authMocks.getCurrentUser
      .mockRejectedValueOnce(new Error("not signed in"))
      .mockResolvedValueOnce({ userId: "user-1", username: "sue@example.com" });

    render(
      <AuthProvider>
        <AuthHarness />
      </AuthProvider>,
    );

    expect(await screen.findByText("ready")).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: /email me a code/i }));

    await waitFor(() => {
      expect(authMocks.signOut).toHaveBeenCalled();
    });
    expect(authMocks.signOut.mock.invocationCallOrder[0]).toBeLessThan(
      authMocks.signUp.mock.invocationCallOrder[0]
    );
  });

  it("falls back to sign-in OTP when the email already has an account", async () => {
    const user = userEvent.setup();

    authMocks.signUp.mockRejectedValueOnce(Object.assign(new Error("exists"), { name: "UsernameExistsException" }));

    render(
      <AuthProvider>
        <AuthHarness />
      </AuthProvider>,
    );

    expect(await screen.findByText("ready")).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: /email me a code/i }));

    await waitFor(() => {
      expect(screen.getByText("otp-pending")).toBeInTheDocument();
    });
    expect(authMocks.signIn).toHaveBeenCalledWith({
      username: "sue@example.com",
      options: { authFlowType: "USER_AUTH", preferredChallenge: "EMAIL_OTP" }
    });
  });

  it("resends confirmation for an existing unconfirmed user", async () => {
    const user = userEvent.setup();

    authMocks.signUp.mockRejectedValueOnce(Object.assign(new Error("exists"), { name: "UsernameExistsException" }));
    authMocks.signIn.mockResolvedValueOnce({
      isSignedIn: false,
      nextStep: { signInStep: "CONFIRM_SIGN_UP" }
    });

    render(
      <AuthProvider>
        <AuthHarness />
      </AuthProvider>,
    );

    expect(await screen.findByText("ready")).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: /email me a code/i }));

    await waitFor(() => {
      expect(screen.getByText("otp-pending")).toBeInTheDocument();
    });
    expect(authMocks.resendSignUpCode).toHaveBeenCalledWith({ username: "sue@example.com" });
  });
});
