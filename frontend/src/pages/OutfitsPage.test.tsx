import {
  QueryClient,
  QueryClientProvider,
} from "@tanstack/react-query";
import { cleanup, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import * as authModule from "../auth/AuthContext";
import { api } from "../lib/api";
import type {
  Outfit,
  PageResponse,
  UserProfile,
  WardrobeListItem,
} from "../types";
import { OutfitsPage } from "./OutfitsPage";

function makeSummary(
  overrides: Partial<WardrobeListItem> = {},
): WardrobeListItem {
  return {
    id: "item-1",
    category: "TOPS",
    imageUrl: "https://example.com/item-1.png",
    processingState: "READY",
    failureReason: null,
    displayNote: null,
    ...overrides,
  };
}

function makePage<T>(content: T[]): PageResponse<T> {
  return {
    content,
    page: {
      size: 12,
      number: 0,
      totalElements: content.length,
      totalPages: Math.max(1, Math.ceil(content.length / 12)),
    },
  };
}

function makeProfile(overrides: Partial<UserProfile> = {}): UserProfile {
  return {
    id: "user-1",
    username: "sue",
    visibility: "PRIVATE",
    clothingItemCount: 4,
    categoryCounts: { TOPS: 2, DRESSES: 2 },
    featuredOutfit: null,
    ...overrides,
  };
}

function renderOutfitsPage() {
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: { retry: false },
      mutations: { retry: false },
    },
  });
  return render(
    <MemoryRouter>
      <QueryClientProvider client={queryClient}>
        <OutfitsPage />
      </QueryClientProvider>
    </MemoryRouter>,
  );
}

describe("OutfitsPage", () => {
  beforeEach(() => {
    vi.spyOn(authModule, "useAuth").mockReturnValue({
      mode: "local",
      user: { id: "user-1", username: "sue" },
      loading: false,
      otpPending: false,
      login: vi.fn(),
      register: vi.fn(),
      requestEmailOtp: vi.fn(),
      confirmEmailOtp: vi.fn(),
      signInWithGoogle: vi.fn(),
      logout: vi.fn(),
      refresh: vi.fn(),
    });
    vi.spyOn(api.users, "me").mockResolvedValue(makeProfile());
    vi.spyOn(api.outfits, "list").mockResolvedValue(makePage<Outfit>([]));
    vi.spyOn(api.outfits, "pendingSuggestions").mockResolvedValue(makePage<Outfit>([]));
    vi.spyOn(api.outfits, "create").mockResolvedValue({
      id: "outfit-1",
      items: [],
      userId: "user-1",
      suggestedBy: null,
      acceptedAt: null,
      createdAt: "2026-07-07T00:00:00Z",
      updatedAt: "2026-07-07T00:00:00Z",
    });
    vi.spyOn(api.clothing, "list").mockResolvedValue(makePage([
      makeSummary({ id: "top-1", category: "TOPS", imageUrl: "https://example.com/top-1.png" }),
      makeSummary({ id: "top-2", category: "TOPS", imageUrl: "https://example.com/top-2.png" }),
      makeSummary({ id: "dress-1", category: "DRESSES", imageUrl: "https://example.com/dress-1.png" }),
      makeSummary({ id: "dress-2", category: "DRESSES", imageUrl: "https://example.com/dress-2.png" }),
    ]));
  });

  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
  });

  it("shows dresses in the personal outfit composer", async () => {
    const user = userEvent.setup();
    renderOutfitsPage();

    await user.click(await screen.findByRole("button", { name: /compose outfit/i }));
    const dialog = await screen.findByRole("dialog", { name: /compose an outfit/i });
    await user.click(within(dialog).getByRole("button", { name: /dresses/i }));

    expect(await within(dialog).findAllByAltText("dresses")).toHaveLength(2);
    expect(api.clothing.list).toHaveBeenCalledWith({ page: 0, size: 100 });
  });

  it("shows a red dot on pending suggestions when pending items exist", async () => {
    vi.spyOn(api.outfits, "pendingSuggestions").mockResolvedValueOnce(makePage<Outfit>([
      {
        id: "outfit-pending-1",
        items: [],
        userId: "user-1",
        suggestedBy: { id: "user-2", username: "alex" },
        acceptedAt: null,
        createdAt: "2026-07-07T00:00:00Z",
        updatedAt: "2026-07-07T00:00:00Z",
      },
    ]));

    renderOutfitsPage();

    const pendingButton = await screen.findByRole("button", { name: /pending suggestions/i });
    await waitFor(() => {
      expect(pendingButton.querySelector("span[aria-hidden='true'].pointer-events-none")).toBeTruthy();
    });
    expect(api.outfits.pendingSuggestions).toHaveBeenCalledWith(0, 1);
  });

  it("hides the red dot on pending suggestions when there are no pending items", async () => {
    renderOutfitsPage();

    const pendingButton = await screen.findByRole("button", { name: /pending suggestions/i });
    expect(pendingButton.querySelector("span[aria-hidden='true'].pointer-events-none")).toBeNull();
    expect(api.outfits.pendingSuggestions).toHaveBeenCalledWith(0, 1);
  });
});
