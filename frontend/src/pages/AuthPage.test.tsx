import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import * as authModule from "../auth/AuthContext";
import { AuthPage } from "./AuthPage";

describe("AuthPage Google sign-in", () => {
  beforeEach(() => {
    vi.spyOn(authModule, "useAuth").mockReturnValue({
      mode: "cognito",
      user: null,
      loading: false,
      otpPending: false,
      login: vi.fn(),
      register: vi.fn(),
      requestEmailOtp: vi.fn(),
      confirmEmailOtp: vi.fn(),
      signInWithGoogle: vi.fn().mockResolvedValue(undefined),
      logout: vi.fn(),
      refresh: vi.fn(),
    });
  });

  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
  });

  it("redirects to the protected destination after Google sign-in resolves", async () => {
    render(
      <MemoryRouter initialEntries={[{ pathname: "/login", state: { from: { pathname: "/outfits" } } }]}>
        <Routes>
          <Route path="/login" element={<AuthPage />} />
          <Route path="/outfits" element={<div>Outfits destination</div>} />
        </Routes>
      </MemoryRouter>,
    );

    await userEvent.click(screen.getByRole("button", { name: /continue with google/i }));

    await waitFor(() => {
      expect(screen.getByText("Outfits destination")).toBeInTheDocument();
    });
  });

  it("shows auth errors when Google sign-in fails for another reason", async () => {
    vi.spyOn(authModule, "useAuth").mockReturnValue({
      mode: "cognito",
      user: null,
      loading: false,
      otpPending: false,
      login: vi.fn(),
      register: vi.fn(),
      requestEmailOtp: vi.fn(),
      confirmEmailOtp: vi.fn(),
      signInWithGoogle: vi.fn().mockRejectedValue(new Error("OAuth failed")),
      logout: vi.fn(),
      refresh: vi.fn(),
    });

    render(
      <MemoryRouter initialEntries={["/login"]}>
        <Routes>
          <Route path="/login" element={<AuthPage />} />
          <Route path="/wardrobe" element={<div>Wardrobe destination</div>} />
        </Routes>
      </MemoryRouter>,
    );

    await userEvent.click(screen.getByRole("button", { name: /continue with google/i }));

    expect(await screen.findByText("OAuth failed")).toBeInTheDocument();
    expect(screen.queryByText("Wardrobe destination")).not.toBeInTheDocument();
  });
});
