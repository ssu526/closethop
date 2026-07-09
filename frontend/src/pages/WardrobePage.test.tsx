import {
  QueryClient,
  QueryClientProvider,
} from "@tanstack/react-query";
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import * as authModule from "../auth/AuthContext";
import { ToastProvider } from "../components/Toast";
import { api } from "../lib/api";
import type {
  ClothingItem,
  ClothingItemSummary,
  PageResponse,
  UserProfile,
} from "../types";
import { WardrobePage } from "./WardrobePage";

vi.mock("../components/ClothingForm", async () => {
  return {
    ClothingForm({
      busy,
      item,
      onSubmit,
    }: {
      busy: boolean;
      item?: ClothingItem;
      onSubmit(values: { category?: string; tags?: string[]; image?: File }): void;
    }) {
      return (
        <div>
          <button
            type="button"
            disabled={busy}
            onClick={() =>
              onSubmit({
                category: "TOPS",
                tags: [],
                image: new File(["image"], "new-item.jpg", {
                  type: "image/jpeg",
                }),
              })
            }
          >
            Add to wardrobe
          </button>
        </div>
      );
    },
  };
});

function makeSummary(
  overrides: Partial<ClothingItemSummary> = {},
): ClothingItemSummary {
  return {
    id: "item-1",
    category: "TOPS",
    imageUrl: "https://example.com/item-1.png",
    status: "READY",
    processingError: null,
    duplicateOfId: null,
    removedFromWardrobe: false,
    subcategory: null,
    colors: [],
    pattern: null,
    materials: [],
    seasons: [],
    occasions: [],
    userId: "user-1",
    createdAt: "2026-07-07T00:00:00Z",
    updatedAt: "2026-07-07T00:00:00Z",
    ...overrides,
  };
}

function makeItem(overrides: Partial<ClothingItem> = {}): ClothingItem {
  return {
    ...makeSummary(overrides),
    tags: [],
    ...overrides,
  };
}

function makePage(
  content: ClothingItemSummary[],
  totalElements = content.length,
): PageResponse<ClothingItemSummary> {
  return {
    content,
    page: {
      size: 12,
      number: 0,
      totalElements,
      totalPages: Math.max(1, Math.ceil(totalElements / 12)),
    },
  };
}

function makeProfile(overrides: Partial<UserProfile> = {}): UserProfile {
  return {
    id: "user-1",
    username: "sue",
    visibility: "PRIVATE",
    clothingItemCount: 0,
    categoryCounts: {
      TOPS: 0,
      BOTTOMS: 0,
      DRESSES: 0,
      OUTERWEAR: 0,
      SHOES: 0,
      ACCESSORIES: 0,
      BAGS: 0,
    },
    featuredOutfit: null,
    ...overrides,
  };
}

function renderWardrobePage(props?: { viewUserId?: string }) {
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: { retry: false },
      mutations: { retry: false },
    },
  });
  return render(
    <QueryClientProvider client={queryClient}>
      <ToastProvider>
        <WardrobePage {...props} />
      </ToastProvider>
    </QueryClientProvider>,
  );
}

async function openCreateModal(user: ReturnType<typeof userEvent.setup>) {
  await user.click(screen.getByRole("button", { name: /add a piece/i }));
}

async function submitNewItem(user: ReturnType<typeof userEvent.setup>) {
  await user.click(screen.getByRole("button", { name: /add to wardrobe/i }));
}

describe("WardrobePage", () => {
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
    vi.spyOn(api.users, "profile").mockResolvedValue(makeProfile({
      id: "user-2",
      username: "alex",
      visibility: "PUBLIC",
      clothingItemCount: 4,
      categoryCounts: { TOPS: 2, DRESSES: 2 },
    }));
    vi.spyOn(api.users, "wardrobe").mockResolvedValue(makePage([]));
    vi.spyOn(api.users, "suggestOutfit").mockResolvedValue({
      id: "outfit-1",
      items: [],
      userId: "user-2",
      suggestedBy: { id: "user-1", username: "sue" },
      acceptedAt: null,
      createdAt: "2026-07-07T00:00:00Z",
      updatedAt: "2026-07-07T00:00:00Z",
    });
    vi.spyOn(api.users, "setVisibility").mockResolvedValue(makeProfile());
    vi.spyOn(api.clothing, "get").mockResolvedValue(makeItem());
    vi.spyOn(api.clothing, "update").mockResolvedValue(makeItem());
    vi.spyOn(api.clothing, "delete").mockResolvedValue(undefined);
    URL.createObjectURL = vi.fn(() => "blob:preview");
    URL.revokeObjectURL = vi.fn();
  });

  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
    vi.useRealTimers();
  });

  it("shows a user-friendly label for waiting upload status", async () => {
    vi.spyOn(api.clothing, "list").mockResolvedValue(
      makePage([
        makeSummary({
          id: "waiting-item",
          status: "WAITING_FOR_UPLOAD",
          imageUrl: "https://example.com/waiting-item.png",
        }),
      ]),
    );

    renderWardrobePage();

    expect(await screen.findByText("Processing")).toBeInTheDocument();
    expect(screen.queryByText("WAITING_FOR_UPLOAD")).not.toBeInTheDocument();
  });

  it("inserts a new processing card immediately after upload", async () => {
    vi.mocked(api.users.me)
      .mockResolvedValueOnce(
        makeProfile({ clothingItemCount: 1, categoryCounts: { TOPS: 1 } }),
      )
      .mockResolvedValue(
        makeProfile({ clothingItemCount: 2, categoryCounts: { TOPS: 2 } }),
      );
    vi.spyOn(api.clothing, "list")
      .mockResolvedValueOnce(makePage([makeSummary()]))
      .mockResolvedValue(makePage([
        makeSummary({
          id: "created-item",
          status: "PROCESSING",
          imageUrl: null,
          category: "TOPS",
        }),
        makeSummary(),
      ], 2));
    vi.spyOn(api.clothing, "create").mockResolvedValue(
      makeItem({
        id: "created-item",
        category: "TOPS",
        imageUrl: null,
        status: "PROCESSING",
        tags: ["linen"],
      }),
    );

    const user = userEvent.setup();
    renderWardrobePage();

    expect(await screen.findByAltText("tops wardrobe item")).toBeInTheDocument();
    await openCreateModal(user);
    await submitNewItem(user);

    expect(await screen.findByText("Processing image…")).toBeInTheDocument();
  });

  it("shows the uploaded original image while processing", async () => {
    vi.mocked(api.users.me)
      .mockResolvedValueOnce(
        makeProfile({ clothingItemCount: 1, categoryCounts: { TOPS: 1 } }),
      )
      .mockResolvedValue(
        makeProfile({ clothingItemCount: 2, categoryCounts: { TOPS: 2 } }),
      );
    vi.spyOn(api.clothing, "list").mockResolvedValue(makePage([]));
    vi.spyOn(api.clothing, "create").mockResolvedValue(
      makeItem({
        id: "created-item",
        category: "TOPS",
        imageUrl: "https://example.com/original-item.jpg",
        status: "PROCESSING",
      }),
    );
    vi.mocked(api.clothing.get).mockResolvedValue(
      makeItem({
        id: "created-item",
        category: "TOPS",
        imageUrl: "https://example.com/original-item.jpg",
        status: "PROCESSING",
      }),
    );

    const user = userEvent.setup();
    renderWardrobePage();

    expect(await screen.findByText("Nothing here—yet.")).toBeInTheDocument();
    await openCreateModal(user);
    await submitNewItem(user);

    const image = await screen.findByAltText("tops wardrobe item");
    expect(image).toHaveAttribute("src", "https://example.com/original-item.jpg");
    expect(screen.getByText("Processing")).toBeInTheDocument();
    expect(screen.queryByText("Processing image…")).not.toBeInTheDocument();
  });

  it("does not render duplicate rejected items returned by the wardrobe list", async () => {
    vi.spyOn(api.clothing, "list").mockResolvedValue(
      makePage([
        makeSummary({
          id: "canonical-item",
          imageUrl: "https://example.com/canonical-item.png",
        }),
        makeSummary({
          id: "duplicate-item",
          status: "DUPLICATE_REJECTED",
          imageUrl: null,
          processingError: "DUPLICATE_UPLOAD",
          duplicateOfId: "canonical-item",
        }),
      ]),
    );

    renderWardrobePage();

    expect(await screen.findByAltText("tops wardrobe item")).toHaveAttribute(
      "src",
      "https://example.com/canonical-item.png",
    );
    expect(screen.queryByText("Duplicate rejected")).not.toBeInTheDocument();
    expect(screen.queryByText("Image unavailable")).not.toBeInTheDocument();
  });

  it("does not show a new processing card in the wrong category", async () => {
    vi.mocked(api.users.me).mockResolvedValue(
      makeProfile({
        clothingItemCount: 0,
        categoryCounts: { TOPS: 0, DRESSES: 1 },
      }),
    );
    vi.spyOn(api.clothing, "list").mockResolvedValue(makePage([]));
    vi.spyOn(api.clothing, "create").mockResolvedValue(
      makeItem({
        id: "created-dress",
        category: "DRESSES",
        imageUrl: null,
        status: "PROCESSING",
      }),
    );
    vi.mocked(api.clothing.get).mockResolvedValue(
      makeItem({
        id: "created-dress",
        category: "DRESSES",
        imageUrl: null,
        status: "PROCESSING",
      }),
    );

    const user = userEvent.setup();
    renderWardrobePage();

    expect(await screen.findByText("Nothing here—yet.")).toBeInTheDocument();
    await openCreateModal(user);
    await submitNewItem(user);

    await waitFor(() => {
      expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    });
    expect(screen.queryByText("Processing image…")).not.toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: /dresses/i }));

    expect(await screen.findByText("Processing image…")).toBeInTheDocument();
  });

  it("shows a success toast once processing finishes with the AI category", async () => {
    vi.mocked(api.users.me)
      .mockResolvedValueOnce(
        makeProfile({ clothingItemCount: 0, categoryCounts: { TOPS: 0, BOTTOMS: 0 } }),
      )
      .mockResolvedValue(
        makeProfile({ clothingItemCount: 0, categoryCounts: { TOPS: 0, BOTTOMS: 0 } }),
      )
      .mockResolvedValueOnce(
        makeProfile({ clothingItemCount: 1, categoryCounts: { TOPS: 0, BOTTOMS: 1 } }),
      );
    vi.spyOn(api.clothing, "list").mockResolvedValue(makePage([]));
    vi.spyOn(api.clothing, "create").mockResolvedValue(
      makeItem({
        id: "created-item",
        category: "TOPS",
        imageUrl: null,
        status: "PROCESSING",
      }),
    );
    vi.mocked(api.clothing.get)
      .mockResolvedValueOnce(
        makeItem({
          id: "created-item",
          category: "TOPS",
          imageUrl: null,
          status: "PROCESSING",
        }),
      )
      .mockResolvedValueOnce(
        makeItem({
          id: "created-item",
          category: "TOPS",
          imageUrl: "https://example.com/processed-item.png",
          status: "READY",
          tags: ["navy", "wide leg"],
      }),
    );

    renderWardrobePage();

    vi.useFakeTimers();
    fireEvent.click(screen.getByRole("button", { name: /add a piece/i }));
    await act(async () => {
      await Promise.resolve();
    });
    fireEvent.click(screen.getByRole("button", { name: /add to wardrobe/i }));

    await act(async () => {
      await Promise.resolve();
    });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(3000);
    });
    expect(screen.getByText("New Tops has been added to your wardrobe.")).toBeInTheDocument();
  });

  it("removes a duplicate rejected pending upload after notifying the user", async () => {
    vi.spyOn(api.clothing, "list").mockResolvedValue(
      makePage([
        makeSummary({
          id: "canonical-item",
          imageUrl: "https://example.com/canonical-item.png",
        }),
      ]),
    );
    vi.spyOn(api.clothing, "create").mockResolvedValue(
      makeItem({
        id: "duplicate-item",
        category: "TOPS",
        imageUrl: null,
        status: "PROCESSING",
      }),
    );
    vi.mocked(api.clothing.get).mockResolvedValue(
      makeItem({
        id: "duplicate-item",
        category: "TOPS",
        imageUrl: null,
        status: "DUPLICATE_REJECTED",
        processingError: "DUPLICATE_UPLOAD",
        duplicateOfId: "canonical-item",
      }),
    );

    const user = userEvent.setup();
    renderWardrobePage();

    await openCreateModal(user);
    await submitNewItem(user);

    expect(await screen.findByText("That item is already in your wardrobe.")).toBeInTheDocument();
    await waitFor(() => {
      expect(screen.queryByText("Processing image…")).not.toBeInTheDocument();
      expect(screen.queryByText("Image unavailable")).not.toBeInTheDocument();
    });
    expect(screen.getByAltText("tops wardrobe item")).toHaveAttribute(
      "src",
      "https://example.com/canonical-item.png",
    );
  });

  it("keeps polling after a stale refetch misses the new item and reconciles without duplicating the card", async () => {
    const createdSummary = makeSummary({
      id: "created-item",
      status: "PROCESSING",
      imageUrl: null,
    });
    vi.mocked(api.users.me).mockResolvedValue(makeProfile());
    const listSpy = vi
      .spyOn(api.clothing, "list")
      .mockResolvedValueOnce(makePage([]))
      .mockResolvedValueOnce(makePage([]))
      .mockResolvedValue(makePage([createdSummary], 1));
    vi.spyOn(api.clothing, "create").mockResolvedValue(
      makeItem({
        id: "created-item",
        category: "TOPS",
        imageUrl: null,
        status: "PROCESSING",
      }),
    );

    const user = userEvent.setup();
    renderWardrobePage();

    expect(await screen.findByText("Nothing here—yet.")).toBeInTheDocument();
    await openCreateModal(user);
    await submitNewItem(user);

    expect(await screen.findByText("Processing image…")).toBeInTheDocument();

    await waitFor(
      () => expect(listSpy.mock.calls.length).toBeGreaterThanOrEqual(3),
      { timeout: 5000 },
    );

    expect(await screen.findByText("Processing image…")).toBeInTheDocument();
    expect(screen.getAllByText("Processing image…")).toHaveLength(1);
  }, 15000);

  it("shows dresses in the public suggestion picker", async () => {
    const sharedItems = [
      makeSummary({ id: "top-1", category: "TOPS", imageUrl: "https://example.com/top-1.png", userId: "user-2" }),
      makeSummary({ id: "top-2", category: "TOPS", imageUrl: "https://example.com/top-2.png", userId: "user-2" }),
      makeSummary({ id: "dress-1", category: "DRESSES", imageUrl: "https://example.com/dress-1.png", userId: "user-2" }),
      makeSummary({ id: "dress-2", category: "DRESSES", imageUrl: "https://example.com/dress-2.png", userId: "user-2" }),
    ];
    vi.mocked(api.users.wardrobe).mockImplementation((_userId, filters = {}) =>
      Promise.resolve(
        filters.category === "TOPS"
          ? makePage(sharedItems.filter((item) => item.category === "TOPS"))
          : makePage(sharedItems),
      ),
    );

    const user = userEvent.setup();
    renderWardrobePage({ viewUserId: "user-2" });

    await user.click(await screen.findByRole("button", { name: /suggest outfit/i }));
    const dialog = await screen.findByRole("dialog", { name: /suggest an outfit for alex/i });
    await user.click(within(dialog).getByRole("button", { name: /dresses/i }));

    expect(await within(dialog).findAllByAltText("dresses")).toHaveLength(2);
    expect(api.users.wardrobe).toHaveBeenCalledWith("user-2", { page: 0, size: 100 });
  });
});
