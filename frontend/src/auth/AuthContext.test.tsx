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
      <button type="button" onClick={() => void auth.confirmEmailOtp("123456").catch(() => undefined)}>
        Confirm code
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

  it("clears a stale Cognito session and retries Google sign-in when Amplify reports an existing signed-in user", async () => {
    const user = userEvent.setup();

    authMocks.signInWithRedirect
      .mockRejectedValueOnce(new Error("There is already a signed in user."))
      .mockResolvedValueOnce(undefined);

    render(
      <AuthProvider>
        <AuthHarness />
      </AuthProvider>,
    );

    expect(await screen.findByText("ready")).toBeInTheDocument();
    expect(screen.getByText("anonymous")).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: /continue with google/i }));

    await waitFor(() => {
      expect(authMocks.signInWithRedirect).toHaveBeenCalledTimes(2);
    });
    expect(authMocks.signOut).toHaveBeenCalled();
  });

  it("clears a stale Cognito session for Google sign-in when Amplify returns a plain object error", async () => {
    const user = userEvent.setup();

    authMocks.signInWithRedirect
      .mockRejectedValueOnce({ message: "There is already a signed in user." })
      .mockResolvedValueOnce(undefined);

    render(
      <AuthProvider>
        <AuthHarness />
      </AuthProvider>,
    );

    expect(await screen.findByText("ready")).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: /continue with google/i }));

    await waitFor(() => {
      expect(authMocks.signInWithRedirect).toHaveBeenCalledTimes(2);
    });
    expect(authMocks.signOut).toHaveBeenCalled();
  });

  it("starts Google Hosted UI without signing out first", async () => {
    const user = userEvent.setup();

    render(
      <AuthProvider>
        <AuthHarness />
      </AuthProvider>,
    );

    expect(await screen.findByText("ready")).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: /continue with google/i }));

    await waitFor(() => {
      expect(authMocks.signInWithRedirect).toHaveBeenCalledWith({ provider: "Google" });
    });
    expect(authMocks.signOut).not.toHaveBeenCalled();
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

    authMocks.signIn.mockRejectedValueOnce(Object.assign(new Error("not found"), { name: "UserNotFoundException" }));

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
  });

  it("starts email OTP without signing out first", async () => {
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
    expect(authMocks.signOut).not.toHaveBeenCalled();
  });

  it("clears a stale Cognito session and retries email OTP when Amplify reports an existing signed-in user", async () => {
    const user = userEvent.setup();

    authMocks.signIn
      .mockRejectedValueOnce(new Error("There is already a signed in user."))
      .mockResolvedValueOnce({
        isSignedIn: false,
        nextStep: { signInStep: "CONFIRM_SIGN_IN_WITH_EMAIL_CODE" }
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
    expect(authMocks.signOut).toHaveBeenCalled();
    expect(authMocks.signIn).toHaveBeenCalledTimes(2);
  });

  it("clears a stale Cognito session and retries email OTP when Amplify returns a plain object error", async () => {
    const user = userEvent.setup();

    authMocks.signIn
      .mockRejectedValueOnce({ message: "There is already a signed in user." })
      .mockResolvedValueOnce({
        isSignedIn: false,
        nextStep: { signInStep: "CONFIRM_SIGN_IN_WITH_EMAIL_CODE" }
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
    expect(authMocks.signOut).toHaveBeenCalled();
    expect(authMocks.signIn).toHaveBeenCalledTimes(2);
  });

  it("starts sign-in OTP first when the email already has an account", async () => {
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
    expect(authMocks.signIn).toHaveBeenCalledWith({
      username: "sue@example.com",
      options: { authFlowType: "USER_AUTH", preferredChallenge: "EMAIL_OTP" }
    });
    expect(authMocks.signUp).not.toHaveBeenCalled();
  });

  it("falls back to sign-in OTP when signup races with an existing account", async () => {
    const user = userEvent.setup();

    authMocks.signIn
      .mockRejectedValueOnce(Object.assign(new Error("not found"), { name: "UserNotFoundException" }))
      .mockResolvedValueOnce({
        isSignedIn: false,
        nextStep: { signInStep: "CONFIRM_SIGN_IN_WITH_EMAIL_CODE" }
      });
    authMocks.signUp.mockRejectedValueOnce({ __type: "UsernameExistsException", message: "User already exists" });

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
    expect(authMocks.signIn).toHaveBeenCalledTimes(2);
  });

  it("falls back to sign-in OTP when Cognito returns a namespaced username-exists error", async () => {
    const user = userEvent.setup();

    authMocks.signIn
      .mockRejectedValueOnce(Object.assign(new Error("not found"), { name: "UserNotFoundException" }))
      .mockResolvedValueOnce({
        isSignedIn: false,
        nextStep: { signInStep: "CONFIRM_SIGN_IN_WITH_EMAIL_CODE" }
      });
    authMocks.signUp.mockRejectedValueOnce({
      __type: "com.amazonaws.cognitoidentityprovider#UsernameExistsException",
      message: "User already exists"
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
    expect(authMocks.signIn).toHaveBeenCalledWith({
      username: "sue@example.com",
      options: { authFlowType: "USER_AUTH", preferredChallenge: "EMAIL_OTP" }
    });
    expect(authMocks.signIn).toHaveBeenCalledTimes(2);
  });

  it("resends confirmation for an existing unconfirmed user", async () => {
    const user = userEvent.setup();

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

  it("selects email OTP when Cognito asks for a first auth factor", async () => {
    const user = userEvent.setup();

    authMocks.signIn.mockResolvedValueOnce({
      isSignedIn: false,
      nextStep: { signInStep: "CONTINUE_SIGN_IN_WITH_FIRST_FACTOR_SELECTION" }
    });
    authMocks.confirmSignIn.mockResolvedValueOnce({
      isSignedIn: false,
      nextStep: { signInStep: "CONFIRM_SIGN_IN_WITH_EMAIL_CODE" }
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
    expect(authMocks.confirmSignIn).toHaveBeenCalledWith({ challengeResponse: "EMAIL_OTP" });
  });

  it("refreshes the app user after confirming an existing-user email OTP", async () => {
    const user = userEvent.setup();

    authMocks.confirmSignIn.mockResolvedValueOnce({ isSignedIn: true });

    render(
      <AuthProvider>
        <AuthHarness />
      </AuthProvider>,
    );

    expect(await screen.findByText("ready")).toBeInTheDocument();
    authMocks.getCurrentUser.mockResolvedValueOnce({ userId: "cognito-user-1", username: "sue@example.com" });

    await user.click(screen.getByRole("button", { name: /email me a code/i }));
    await waitFor(() => {
      expect(screen.getByText("otp-pending")).toBeInTheDocument();
    });

    await user.click(screen.getByRole("button", { name: /confirm code/i }));

    await waitFor(() => {
      expect(screen.getByText("sue")).toBeInTheDocument();
    });
    expect(screen.getByText("otp-idle")).toBeInTheDocument();
  });

  it("keeps OTP pending when app-user refresh fails after code confirmation", async () => {
    const user = userEvent.setup();
    const profileError = new Error("Profile refresh failed");

    authMocks.confirmSignIn.mockResolvedValueOnce({ isSignedIn: true });

    render(
      <AuthProvider>
        <AuthHarness />
      </AuthProvider>,
    );

    expect(await screen.findByText("ready")).toBeInTheDocument();
    authMocks.getCurrentUser.mockResolvedValue({ userId: "cognito-user-1", username: "sue@example.com" });
    vi.mocked(api.users.updateProfileName).mockRejectedValue(profileError);

    await user.click(screen.getByRole("button", { name: /email me a code/i }));
    await waitFor(() => {
      expect(screen.getByText("otp-pending")).toBeInTheDocument();
    });

    await user.click(screen.getByRole("button", { name: /confirm code/i }));

    await waitFor(() => {
      expect(api.users.updateProfileName).toHaveBeenCalledTimes(3);
    });
    expect(screen.getByText("anonymous")).toBeInTheDocument();
    expect(screen.getByText("otp-pending")).toBeInTheDocument();
    expect(authMocks.signOut).not.toHaveBeenCalled();
  });
});
