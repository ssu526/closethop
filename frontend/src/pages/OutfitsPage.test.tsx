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
  ClothingItemDetail,
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

function makeDetail(
  overrides: Partial<ClothingItemDetail> = {},
): ClothingItemDetail {
  return {
    ...makeSummary(overrides),
    tags: [],
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
    vi.spyOn(api.outfits, "suggest").mockResolvedValue([]);
    vi.spyOn(api.clothing, "list").mockResolvedValue(makePage([
      makeSummary({ id: "top-1", category: "TOPS", imageUrl: "https://example.com/top-1.png" }),
      makeSummary({ id: "top-2", category: "TOPS", imageUrl: "https://example.com/top-2.png" }),
      makeSummary({ id: "dress-1", category: "DRESSES", imageUrl: "https://example.com/dress-1.png" }),
      makeSummary({ id: "dress-2", category: "DRESSES", imageUrl: "https://example.com/dress-2.png" }),
      makeSummary({ id: "dress-3", category: "DRESSES", imageUrl: "https://example.com/dress-3.png" }),
      makeSummary({ id: "dress-4", category: "DRESSES", imageUrl: "https://example.com/dress-4.png" }),
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

    expect(await within(dialog).findAllByAltText("dresses")).toHaveLength(4);
    expect(api.clothing.list).toHaveBeenCalledWith({ page: 0, size: 100 });
  });

  it("disables the ai suggestion button when the category has too few available items", async () => {
    const user = userEvent.setup();
    renderOutfitsPage();

    await user.click(await screen.findByRole("button", { name: /compose outfit/i }));
    const dialog = await screen.findByRole("dialog", { name: /compose an outfit/i });

    await user.click(within(dialog).getAllByRole("button", { name: /add tops to outfit/i })[0]);
    const aiButton = within(dialog).getByRole("button", { name: /ask ai for tops/i });

    expect(aiButton).toBeDisabled();
    expect(within(dialog).getByText(/We need more than/i)).toBeInTheDocument();
    expect(within(dialog).getByText("3")).toContainHTML("<strong>3</strong>");
  });

  it("lets the user select one ai outfit option before saving", async () => {
    vi.mocked(api.outfits.suggest).mockResolvedValue([
      makeDetail({ id: "dress-1", category: "DRESSES", imageUrl: "https://example.com/dress-1.png" }),
      makeDetail({ id: "dress-2", category: "DRESSES", imageUrl: "https://example.com/dress-2.png" }),
      makeDetail({ id: "dress-3", category: "DRESSES", imageUrl: "https://example.com/dress-3.png" }),
    ]);

    const user = userEvent.setup();
    renderOutfitsPage();

    await user.click(await screen.findByRole("button", { name: /compose outfit/i }));
    const dialog = await screen.findByRole("dialog", { name: /compose an outfit/i });

    await user.click(within(dialog).getAllByRole("button", { name: /add tops to outfit/i })[0]);
    await user.click(within(dialog).getByRole("button", { name: /dresses/i }));
    await user.click(within(dialog).getByRole("button", { name: /ask ai for dresses/i }));

    expect(await within(dialog).findByText("Suggested outfit options")).toBeInTheDocument();
    expect(within(dialog).queryByText("AI suggestions")).not.toBeInTheDocument();
    expect(within(dialog).queryByText(/AI found 3 dresses suggestions/i)).not.toBeInTheDocument();
    expect(within(dialog).getAllByRole("button", { name: /^select$/i })).toHaveLength(3);

    await user.click(within(dialog).getAllByRole("button", { name: /^select$/i })[1]);

    expect(api.outfits.create).not.toHaveBeenCalled();
    expect(within(dialog).queryByText("Suggested outfit options")).not.toBeInTheDocument();
    expect(within(dialog).getByText("2 selected")).toBeInTheDocument();

    await user.click(within(dialog).getByRole("button", { name: /create outfit/i }));

    await waitFor(() => {
      expect(api.outfits.create).toHaveBeenCalled();
      expect(vi.mocked(api.outfits.create).mock.calls[0]?.[0]).toEqual({
        clothingItemIds: ["top-1", "dress-2"],
      });
    });
  });

  it("lets the user discard ai outfit options without changing the selected outfit", async () => {
    vi.mocked(api.outfits.suggest).mockResolvedValue([
      makeDetail({ id: "dress-1", category: "DRESSES", imageUrl: "https://example.com/dress-1.png" }),
      makeDetail({ id: "dress-2", category: "DRESSES", imageUrl: "https://example.com/dress-2.png" }),
      makeDetail({ id: "dress-3", category: "DRESSES", imageUrl: "https://example.com/dress-3.png" }),
    ]);

    const user = userEvent.setup();
    renderOutfitsPage();

    await user.click(await screen.findByRole("button", { name: /compose outfit/i }));
    const dialog = await screen.findByRole("dialog", { name: /compose an outfit/i });

    await user.click(within(dialog).getAllByRole("button", { name: /add tops to outfit/i })[0]);
    await user.click(within(dialog).getByRole("button", { name: /dresses/i }));
    await user.click(within(dialog).getByRole("button", { name: /ask ai for dresses/i }));

    expect(await within(dialog).findByText("Suggested outfit options")).toBeInTheDocument();

    await user.click(within(dialog).getByRole("button", { name: /^discard$/i }));

    expect(within(dialog).queryByText("Suggested outfit options")).not.toBeInTheDocument();
    expect(within(dialog).getByText("1 selected")).toBeInTheDocument();
    expect(api.outfits.create).not.toHaveBeenCalled();
  });

  it("shows a friendly message when no ai match is found", async () => {
    vi.mocked(api.outfits.suggest).mockResolvedValue([]);

    const user = userEvent.setup();
    renderOutfitsPage();

    await user.click(await screen.findByRole("button", { name: /compose outfit/i }));
    const dialog = await screen.findByRole("dialog", { name: /compose an outfit/i });

    await user.click(within(dialog).getAllByRole("button", { name: /add tops to outfit/i })[0]);
    await user.click(within(dialog).getByRole("button", { name: /dresses/i }));
    await user.click(within(dialog).getByRole("button", { name: /ask ai for dresses/i }));

    expect(await within(dialog).findByText("No matching found.")).toBeInTheDocument();
    expect(within(dialog).queryByText("Suggested outfit options")).not.toBeInTheDocument();
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
