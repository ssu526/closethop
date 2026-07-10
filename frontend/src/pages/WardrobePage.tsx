import {
  keepPreviousData,
  useMutation,
  useQuery,
  useQueryClient,
} from "@tanstack/react-query";
import {
  Check,
  ChevronDown,
  Edit3,
  Globe2,
  Lock,
  LoaderCircle,
  Plus,
  Search,
  Trash2,
  Sparkles,
} from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { ClothingForm } from "../components/ClothingForm";
import { OutfitForm } from "../components/OutfitForm";
import {
  Button,
  EmptyState,
  ErrorState,
  Loading,
  Modal,
  Pagination,
  inputClass,
} from "../components/ui";
import { useToast } from "../components/Toast";
import { api } from "../lib/api";
import type {
  ClothingItemDetail,
  FailureReason,
  PageResponse,
  ProcessingState,
  UserProfile,
  WardrobeListItem,
} from "../types";
import { categories } from "../types";
import { useAuth } from "../auth/AuthContext";

const categoryEmoji: Record<string, string> = {
  TOPS: "👕",
  BOTTOMS: "👖",
  OUTERWEAR: "🧥",
  SHOES: "👟",
  DRESSES: "👗",
  ACCESSORIES: "🧣",
  BAGS: "👜",
};

type WardrobeDisplayState =
  | "UPLOADING"
  | "PROCESSING"
  | "READY"
  | "READY_WITH_ORIGINAL_FALLBACK"
  | "FAILED"
  | "DUPLICATE";

function toWardrobeListItem(item: ClothingItemDetail): WardrobeListItem {
  return {
    id: item.id,
    category: item.category,
    imageUrl: item.imageUrl,
    processingState: item.processingState,
    failureReason: item.failureReason,
    displayNote: item.displayNote,
  };
}

function matchesWardrobeQuery(item: ClothingItemDetail, query: string) {
  const normalizedQuery = query.trim().toLowerCase();
  if (!normalizedQuery) return true;
  return [item.category ?? "", ...item.tags]
    .join(" ")
    .toLowerCase()
    .includes(normalizedQuery);
}

function matchesWardrobeView(item: ClothingItemDetail, category: string, query: string) {
  return item.category === category && matchesWardrobeQuery(item, query);
}

function insertNewItemIntoPage(
  current: PageResponse<WardrobeListItem> | undefined,
  item: WardrobeListItem,
) {
  if (!current || current.content.some((existing) => existing.id === item.id))
    return current;

  const size = current.page.size || current.content.length || 12;
  const totalElements = current.page.totalElements + 1;
  return {
    ...current,
    content: [item, ...current.content].slice(0, size),
    page: {
      ...current.page,
      totalElements,
      totalPages: Math.max(1, Math.ceil(totalElements / size)),
    },
  };
}

function upsertItemIntoPage(
  current: PageResponse<WardrobeListItem> | undefined,
  item: WardrobeListItem,
) {
  if (!current) return current;
  if (current.content.some((existing) => existing.id === item.id)) {
    return {
      ...current,
      content: current.content.map((existing) =>
        existing.id === item.id ? item : existing,
      ),
    };
  }
  return insertNewItemIntoPage(current, item);
}

function removeItemFromPage(
  current: PageResponse<WardrobeListItem> | undefined,
  itemId: string,
) {
  if (!current?.content.some((item) => item.id === itemId)) return current;
  const content = current.content.filter((item) => item.id !== itemId);
  const totalElements = Math.max(0, current.page.totalElements - 1);
  return {
    ...current,
    content,
    page: {
      ...current.page,
      totalElements,
      totalPages: Math.max(1, Math.ceil(totalElements / (current.page.size || 1))),
    },
  };
}

function mergePendingItemsIntoPage(
  current: PageResponse<WardrobeListItem> | undefined,
  pendingItems: WardrobeListItem[],
) {
  if (!current || !pendingItems.length) return current;

  const pendingIds = new Set(pendingItems.map((item) => item.id));
  const missingItems = pendingItems.filter(
    (item) => !current.content.some((existing) => existing.id === item.id),
  );
  if (!missingItems.length) return current;

  const size = current.page.size || current.content.length || 12;
  const totalElements = current.page.totalElements + missingItems.length;
  return {
    ...current,
    content: [
      ...pendingItems,
      ...current.content.filter((item) => !pendingIds.has(item.id)),
    ].slice(0, size),
    page: {
      ...current.page,
      totalElements,
      totalPages: Math.max(1, Math.ceil(totalElements / size)),
    },
  };
}

function itemsHasProcessingStatus(
  current: PageResponse<WardrobeListItem> | undefined,
) {
  return current?.content.some((item) => isProcessingInFlight(item.processingState)) ?? false;
}

function isProcessingInFlight(processingState: ProcessingState) {
  return processingState === "WAITING_FOR_UPLOAD" || processingState === "PROCESSING";
}

function getWardrobeDisplayState(item: WardrobeListItem | ClothingItemDetail): WardrobeDisplayState {
  if (item.processingState === "WAITING_FOR_UPLOAD") return "UPLOADING";
  if (item.processingState === "PROCESSING") return "PROCESSING";
  if (item.processingState === "READY") return "READY";
  if (item.failureReason === "DUPLICATE") return "DUPLICATE";
  if (item.imageUrl && item.failureReason === "PROCESSING") {
    return "READY_WITH_ORIGINAL_FALLBACK";
  }
  return "FAILED";
}

function isVisibleWardrobeItem(item: WardrobeListItem) {
  return getWardrobeDisplayState(item) !== "DUPLICATE";
}

function clothingStatusLabel(
  displayState: WardrobeDisplayState,
  failureReason?: FailureReason | null,
) {
  switch (displayState) {
    case "UPLOADING":
      return "Uploading";
    case "PROCESSING":
      return "Processing";
    case "READY_WITH_ORIGINAL_FALLBACK":
      return "Using original image";
    case "FAILED":
      return failureReason === "UPLOAD" ? "Upload failed" : "Processing failed";
    case "DUPLICATE":
      return "Duplicate rejected";
    case "READY":
      return "Ready";
  }
}

function incrementProfileCounts(
  current: UserProfile | undefined,
  item: ClothingItemDetail,
) {
  if (!current || !item.category) return current;
  return {
    ...current,
    clothingItemCount: current.clothingItemCount + 1,
    categoryCounts: {
      ...current.categoryCounts,
      [item.category]:
        (current.categoryCounts[item.category] ?? 0) + 1,
    },
  };
}

function formatCategoryLabel(category: string | null | undefined) {
  if (!category) return "clothing";
  return category.charAt(0) + category.slice(1).toLowerCase();
}

function uploadFailedMessage() {
  return "Upload failed. Please choose the image again and upload again.";
}

export function WardrobePage({ viewUserId }: { viewUserId?: string }) {
  const { user } = useAuth();
  const { showToast } = useToast();
  const readOnly = Boolean(viewUserId);
  const client = useQueryClient();
  const ownerId = viewUserId ?? user?.id;
  const [page, setPage] = useState(0);
  const [query, setQuery] = useState("");
  const [category, setCategory] = useState<string>(categories[0]);
  const [editing, setEditing] = useState<ClothingItemDetail | undefined>();
  const [deleting, setDeleting] = useState<WardrobeListItem | undefined>();
  const [formOpen, setFormOpen] = useState(false);
  const [suggestionOpen, setSuggestionOpen] = useState(false);
  const [error, setError] = useState("");
  const [createBusy, setCreateBusy] = useState(false);
  const [createDraft, setCreateDraft] = useState<{
    id: string;
    category: string;
    failed: boolean;
  } | null>(null);
  const [createFormVersion, setCreateFormVersion] = useState(0);
  const [visibilityOpen, setVisibilityOpen] = useState(false);
  const [pendingCreatedItems, setPendingCreatedItems] = useState<
    Array<{
      id: string;
      page: number;
      query: string;
      category: string;
      item: WardrobeListItem;
    }>
  >([]);
  const visibilityMenu = useRef<HTMLDivElement>(null);
  const notifiedProcessingIds = useRef(new Set<string>());
  const itemsQueryKey = ["clothing", ownerId, page, query, category] as const;
  const profileQueryKey = ["profile", ownerId] as const;
  const activePendingCreatedItems = pendingCreatedItems.filter(
    (item) => item.page === page && item.query === query && item.category === category,
  );
  const hasVisibleProcessingItems =
    activePendingCreatedItems.length > 0 ||
    itemsHasProcessingStatus(
      client.getQueryData<PageResponse<WardrobeListItem>>(itemsQueryKey),
    );

  const items = useQuery({
    queryKey: itemsQueryKey,
    queryFn: () =>
      viewUserId
        ? api.users.wardrobe(viewUserId, { page, query, category })
        : api.clothing.list({ page, query, category }),
    placeholderData: keepPreviousData,
    refetchInterval: (result) =>
      activePendingCreatedItems.length > 0 ||
      result.state.data?.content.some((item) => isProcessingInFlight(item.processingState))
        ? 3000
        : false,
  });
  const profile = useQuery({
    queryKey: profileQueryKey,
    queryFn: () =>
      viewUserId ? api.users.profile(viewUserId) : api.users.me(),
    refetchInterval: () => (hasVisibleProcessingItems ? 3000 : false),
  });
  const visibleItems = mergePendingItemsIntoPage(
    items.data,
    activePendingCreatedItems.map((item) => item.item),
  );
  const renderedItems = visibleItems
    ? {
        ...visibleItems,
        content: visibleItems.content.filter(isVisibleWardrobeItem),
      }
    : visibleItems;
  const refresh = () => {
    client.invalidateQueries({ queryKey: ["clothing"] });
    client.invalidateQueries({ queryKey: profileQueryKey });
  };
  const update = useMutation({
    mutationFn: (values: {
      category: string;
      tags: string[];
      subcategory?: string;
      colors?: string[];
      pattern?: string;
      materials?: string[];
      seasons?: string[];
      occasions?: string[];
    }) => api.clothing.update(editing!.id, values),
    onSuccess: () => {
      setEditing(undefined);
      setFormOpen(false);
      refresh();
    },
    onError: (reason) =>
      setError(reason instanceof Error ? reason.message : "Update failed."),
  });
  const remove = useMutation({
    mutationFn: api.clothing.delete,
    onSuccess: () => {
      setDeleting(undefined);
      refresh();
    },
    onError: (reason) =>
      setError(reason instanceof Error ? reason.message : "Delete failed."),
  });
  const visibility = useMutation({
    mutationFn: api.users.setVisibility,
    onSuccess: (data) => client.setQueryData(["profile", user?.id], data),
    onError: (reason) =>
      setError(
        reason instanceof Error
          ? reason.message
          : "Could not update visibility.",
      ),
  });
  const suggestOutfit = useMutation({
    mutationFn: (clothingItemIds: string[]) =>
      api.users.suggestOutfit(viewUserId!, clothingItemIds),
    onSuccess: () => {
      setSuggestionOpen(false);
      client.invalidateQueries({
        queryKey: ["outfit-suggestions", viewUserId],
      });
    },
    onError: (reason) =>
      setError(
        reason instanceof Error
          ? reason.message
          : "Could not suggest this outfit.",
      ),
  });

  const applyCreatedItem = (createdItem: ClothingItemDetail) => {
    setFormOpen(false);
    setError("");
    setCreateDraft(null);
    client.setQueryData<PageResponse<WardrobeListItem> | undefined>(
      itemsQueryKey,
      (current) =>
        page === 0 && matchesWardrobeView(createdItem, category, query)
          ? insertNewItemIntoPage(current, toWardrobeListItem(createdItem))
          : current,
    );
    client.setQueryData<UserProfile | undefined>(profileQueryKey, (current) =>
      incrementProfileCounts(current, createdItem),
    );
    setPendingCreatedItems((current) =>
      isProcessingInFlight(createdItem.processingState) &&
      Boolean(createdItem.category) &&
      matchesWardrobeQuery(createdItem, query)
        ? [
            ...current.filter((item) => item.id !== createdItem.id),
            {
              id: createdItem.id,
              page,
              query,
              category: createdItem.category!,
              item: toWardrobeListItem(createdItem),
            },
          ]
        : current.filter((item) => item.id !== createdItem.id),
    );
    refresh();
  };

  const submitCreate = async (values: { category?: string; image?: File }) => {
    if (!values.category) {
      setError("Choose a category.");
      return;
    }
    if (!values.image) {
      setError("Choose a photograph.");
      return;
    }

    setCreateBusy(true);
    setError("");

    const contentType = values.image.type || "image/jpeg";
    const categoryValue = values.category;
    let draftId = createDraft?.id;
    let attemptedBrowserUpload = false;
    let uploadCompleted = false;

    try {
      const upload = createDraft?.failed
        ? await api.clothing.retryUploadUrl(createDraft.id, contentType)
        : await api.clothing.createDraftUpload({
            category: categoryValue,
            contentType,
          });
      draftId = upload.itemId;
      setCreateDraft({
        id: upload.itemId,
        category: categoryValue,
        failed: false,
      });
      attemptedBrowserUpload = true;
      await api.clothing.uploadOriginalToUrl(upload.uploadUrl, values.image);
      uploadCompleted = true;
      const createdItem = await api.clothing.get(upload.itemId);
      applyCreatedItem(createdItem);
    } catch (reason) {
      if (draftId && attemptedBrowserUpload && !uploadCompleted) {
        try {
          await api.clothing.markUploadFailed(draftId);
        } catch {
          // Cleanup job will reconcile abandoned uploads if reporting failure fails.
        }
        setCreateDraft({
          id: draftId,
          category: categoryValue,
          failed: true,
        });
        setCreateFormVersion((current) => current + 1);
        setError(uploadFailedMessage());
      } else {
        setError(reason instanceof Error ? reason.message : "Upload failed.");
      }
    } finally {
      setCreateBusy(false);
    }
  };

  const closeCreateModal = async () => {
    if (createBusy) return;
    if (createDraft?.failed) {
      try {
        setCreateBusy(true);
        await api.clothing.delete(createDraft.id);
        refresh();
      } catch (reason) {
        setError(
          reason instanceof Error
            ? reason.message
            : "Could not close this failed upload.",
        );
        setCreateBusy(false);
        return;
      }
    }
    setCreateBusy(false);
    setCreateDraft(null);
    setCreateFormVersion((current) => current + 1);
    setError("");
    setFormOpen(false);
  };

  useEffect(() => {
    if (!activePendingCreatedItems.length || !items.data?.content.length) return;
    setPendingCreatedItems((current) => {
      const processingStateById = new Map(
        items.data.content.map((item) => [item.id, item.processingState]),
      );
      const next = current.filter((item) => {
        const isActive =
          item.page === page &&
          item.query === query &&
          item.category === category;
        if (!isActive) return true;
        const processingState = processingStateById.get(item.id);
        return processingState === undefined || isProcessingInFlight(processingState);
      });
      return next.length === current.length ? current : next;
    });
  }, [activePendingCreatedItems.length, category, items.data?.content, page, query]);

  useEffect(() => {
    if (!pendingCreatedItems.length) return;
    let cancelled = false;

    const pollTrackedItems = async () => {
      const results = await Promise.all(
        pendingCreatedItems.map(async (trackedItem) => {
          try {
            const item = await api.clothing.get(trackedItem.id);
            return { trackedItem, item };
          } catch {
            return null;
          }
        }),
      );
      if (cancelled) return;

      const readyItems = results.filter(
        (entry): entry is { trackedItem: typeof pendingCreatedItems[number]; item: ClothingItemDetail } =>
          entry !== null && getWardrobeDisplayState(entry.item) === "READY",
      );
      const duplicateRejectedItems = results.filter(
        (entry): entry is { trackedItem: typeof pendingCreatedItems[number]; item: ClothingItemDetail } =>
          entry !== null && getWardrobeDisplayState(entry.item) === "DUPLICATE",
      );
      const failedItems = results.filter(
        (entry): entry is { trackedItem: typeof pendingCreatedItems[number]; item: ClothingItemDetail } =>
          entry !== null && getWardrobeDisplayState(entry.item) === "FAILED",
      );
      const fallbackItems = results.filter(
        (entry): entry is { trackedItem: typeof pendingCreatedItems[number]; item: ClothingItemDetail } =>
          entry !== null && getWardrobeDisplayState(entry.item) === "READY_WITH_ORIGINAL_FALLBACK",
      );
      const terminalItems = results.filter(
        (entry): entry is { trackedItem: typeof pendingCreatedItems[number]; item: ClothingItemDetail } =>
          entry !== null && !isProcessingInFlight(entry.item.processingState),
      );

      duplicateRejectedItems.forEach((result) => {
        client.setQueriesData<PageResponse<WardrobeListItem>>(
          { queryKey: ["clothing"] },
          (current) => removeItemFromPage(current, result.item.id),
        );
      });

      terminalItems
        .filter((result) => getWardrobeDisplayState(result.item) !== "DUPLICATE")
        .forEach((result) => {
          const summary = toWardrobeListItem(result.item);
          client.setQueriesData<PageResponse<WardrobeListItem>>(
            { queryKey: ["clothing"] },
            (current) => {
              if (!current?.content.some((item) => item.id === summary.id)) {
                return current;
              }
              return upsertItemIntoPage(current, summary);
            },
          );
          const isActive =
            result.trackedItem.page === page &&
            result.trackedItem.query === query &&
            result.trackedItem.category === category;
          if (isActive && page === 0 && matchesWardrobeView(result.item, category, query)) {
            client.setQueryData<PageResponse<WardrobeListItem> | undefined>(
              itemsQueryKey,
              (current) => upsertItemIntoPage(current, summary),
            );
          }
        });

      setPendingCreatedItems((current) => {
        const next = current.filter((trackedItem) => {
          const result = results.find(
            (entry) => entry?.trackedItem.id === trackedItem.id,
          );
          if (!result) return true;
          return isProcessingInFlight(result.item.processingState);
        });
        return next.length === current.length ? current : next;
      });

      if (terminalItems.length) {
        refresh();
      }
      readyItems.forEach((result) => {
        if (notifiedProcessingIds.current.has(result.trackedItem.id)) return;
        notifiedProcessingIds.current.add(result.trackedItem.id);
        showToast({
          title: `New ${formatCategoryLabel(result.item.category)} has been added to your wardrobe.`,
          tone: "success",
        });
      });
      duplicateRejectedItems.forEach((result) => {
        if (notifiedProcessingIds.current.has(result.trackedItem.id)) return;
        notifiedProcessingIds.current.add(result.trackedItem.id);
        showToast({
          title: "That item is already in your wardrobe.",
          tone: "info",
        });
      });
      failedItems.forEach((result) => {
        if (notifiedProcessingIds.current.has(result.trackedItem.id)) return;
        notifiedProcessingIds.current.add(result.trackedItem.id);
        showToast({
          title: "Upload failed. Try adding the item again.",
          tone: "info",
        });
      });
      fallbackItems.forEach((result) => {
        if (notifiedProcessingIds.current.has(result.trackedItem.id)) return;
        notifiedProcessingIds.current.add(result.trackedItem.id);
        showToast({
          title: "Processing failed, so the original image is being used.",
          tone: "info",
        });
      });
    };

    pollTrackedItems();
    const timer = window.setInterval(pollTrackedItems, 3000);
    return () => {
      cancelled = true;
      window.clearInterval(timer);
    };
  }, [category, client, itemsQueryKey, page, pendingCreatedItems, query, showToast]);

  useEffect(() => {
    function closeMenu(event: MouseEvent) {
      if (!visibilityMenu.current?.contains(event.target as Node))
        setVisibilityOpen(false);
    }
    function closeWithEscape(event: KeyboardEvent) {
      if (event.key === "Escape") setVisibilityOpen(false);
    }
    document.addEventListener("mousedown", closeMenu);
    document.addEventListener("keydown", closeWithEscape);
    return () => {
      document.removeEventListener("mousedown", closeMenu);
      document.removeEventListener("keydown", closeWithEscape);
    };
  }, []);

  function openCreate() {
    setCreateDraft(null);
    setCreateFormVersion((current) => current + 1);
    setEditing(undefined);
    setError("");
    setFormOpen(true);
  }
  async function openEdit(item: WardrobeListItem) {
    setError("");
    try {
      setEditing(await api.clothing.get(item.id));
      setFormOpen(true);
    } catch (reason) {
      setError(
        reason instanceof Error ? reason.message : "Could not load this item.",
      );
    }
  }
  function confirmDelete(item: WardrobeListItem) {
    setError("");
    setDeleting(item);
  }
  return (
    <>
      <section className="mb-10 flex flex-col justify-between gap-6 md:flex-row md:items-end">
        <div>
          <h1 className="font-display text-4xl md:text-4xl">
            {profile.data
              ? `${profile.data.username}’s wardrobe`
              : "Your wardrobe"}
          </h1>
        </div>
        <div className="flex flex-wrap items-center gap-3">
          {readOnly && (
            <Button
              className="!min-h-0 !px-4 !py-2 text-xs"
              onClick={() => {
                setError("");
                setSuggestionOpen(true);
              }}
            >
              <Sparkles size={15} /> Suggest outfit
            </Button>
          )}
          {!readOnly && (
            <>
              <div className="relative mb-1" ref={visibilityMenu}>
                <button
                  type="button"
                  disabled={!profile.data || visibility.isPending}
                  aria-haspopup="listbox"
                  aria-expanded={visibilityOpen}
                  onClick={() => setVisibilityOpen((open) => !open)}
                  className="inline-flex min-w-28 items-center gap-1.5 rounded-full border border-stone bg-white px-3 py-2 text-xs font-semibold text-ink shadow-sm transition hover:border-clay focus:border-clay disabled:opacity-50"
                >
                  {profile.data?.visibility === "PUBLIC" ? (
                    <Globe2 className="text-clay" size={14} />
                  ) : (
                    <Lock className="text-clay" size={14} />
                  )}
                  <span className="flex-1 text-left">
                    {profile.data?.visibility === "PUBLIC"
                      ? "Public"
                      : "Private"}
                  </span>
                  <ChevronDown
                    className={`text-ink/40 transition ${visibilityOpen ? "rotate-180" : ""}`}
                    size={14}
                  />
                </button>
                {visibilityOpen && (
                  <div
                    className="absolute left-0 top-full z-30 mt-2 w-40 overflow-hidden rounded-xl border border-stone bg-white p-1 shadow-card"
                    role="listbox"
                    aria-label="Wardrobe visibility"
                  >
                    {(["PRIVATE", "PUBLIC"] as const).map((option) => {
                      const selected = profile.data?.visibility === option;
                      return (
                        <button
                          key={option}
                          type="button"
                          role="option"
                          aria-selected={selected}
                          onClick={() => {
                            visibility.mutate(option);
                            setVisibilityOpen(false);
                          }}
                          className={`flex w-full items-center gap-2 rounded-lg px-2.5 py-2 text-left text-xs font-semibold transition ${
                            selected
                              ? "bg-linen text-clay"
                              : "text-ink hover:bg-linen/70"
                          }`}
                        >
                          {option === "PRIVATE" ? (
                            <Lock size={14} />
                          ) : (
                            <Globe2 size={14} />
                          )}
                          <span className="flex-1">
                            {option === "PRIVATE" ? "Private" : "Public"}
                          </span>
                          {selected && <Check size={14} />}
                        </button>
                      );
                    })}
                  </div>
                )}
              </div>
              <Button
                className="!min-h-0 min-w-28 !px-3 !py-2 text-xs"
                onClick={openCreate}
              >
                <Plus size={14} /> Add a piece
              </Button>
            </>
          )}
          <label className="relative block w-full sm:w-56">
            <Search className="absolute left-3 top-2.5 text-ink/35" size={15} />
            <span className="sr-only">Search selected category</span>
            <input
              className={`${inputClass} bg-white py-2 pl-9 text-xs`}
              value={query}
              onChange={(event) => {
                setQuery(event.target.value);
                setPage(0);
              }}
              placeholder="Search this category..."
            />
          </label>
        </div>
      </section>

      <div className="grid gap-8 md:grid-cols-[210px_1fr]">
        <aside>
          <p className="mb-3 text-xs font-bold uppercase tracking-[.18em] text-ink/45">
            Categories
          </p>
          <div className="grid grid-cols-2 gap-3 md:grid-cols-1">
            {categories.map((value) => {
              const active = !query && category === value;
              const label = value.charAt(0) + value.slice(1).toLowerCase();
              return (
                <button
                  key={value}
                  onClick={() => {
                    setCategory(value);
                    setQuery("");
                    setPage(0);
                  }}
                  className={`rounded-xl border bg-white p-4 text-left text-zinc-400 transition ${active ? "border-clay text-black ring-2 ring-clay/15" : "border-stone hover:border-clay"}`}
                >
                  <span className="flex items-center gap-3 font-display">
                    <span aria-hidden="true">{categoryEmoji[value]}</span>
                    <span className="flex-1">{label}</span>
                    <span className="px-2 py-0.5 font-sans text-xs font-semibold text-ink/55">
                      {profile.data?.categoryCounts?.[value] ?? 0}
                    </span>
                  </span>
                </button>
              );
            })}
          </div>
        </aside>
        <section className="p-5 rounded-lg">
          {items.isLoading ? (
            <Loading />
          ) : items.isError ? (
            <ErrorState message={items.error.message} />
          ) : !renderedItems?.content.length ? (
            <EmptyState
              title="Nothing here—yet."
              copy={
                query || category
                  ? "Try changing your search or category."
                  : readOnly
                    ? "This wardrobe has no shared pieces."
                    : "Add your first piece and begin building your personal archive."
              }
              action={
                !readOnly && !query && !category ? (
                  <Button onClick={openCreate}>
                    <Plus size={17} /> Add your first piece
                  </Button>
                ) : undefined
              }
            />
          ) : (
            <>
              <div className="grid grid-cols-2 gap-4 md:grid-cols-3 lg:grid-cols-4 md:gap-6">
                {renderedItems.content.map((item) => {
                  const displayState = getWardrobeDisplayState(item);
                  const showSpinner =
                    displayState === "UPLOADING" || displayState === "PROCESSING";
                  const disableEdit =
                    displayState !== "READY" && displayState !== "READY_WITH_ORIGINAL_FALLBACK";

                  return (
                    <article
                      key={item.id}
                      className="group overflow-hidden rounded-[0.5rem] border border-stone/50 bg-white shadow-sm transition hover:-translate-y-1 hover:shadow-card"
                    >
                      <div className="relative mx-2 mt-2 aspect-[4/5] overflow-hidden rounded-2xl bg-white">
                        {item.imageUrl ? (
                          <img
                            className="h-full w-full rounded-2xl object-contain p-2"
                            src={item.imageUrl}
                            alt={`${item.category?.toLowerCase() ?? "clothing"} wardrobe item`}
                            loading="lazy"
                          />
                        ) : (
                          <div className="flex h-full items-center justify-center bg-linen text-center text-sm text-ink/50">
                            {displayState === "UPLOADING"
                              ? "Uploading image..."
                              : displayState === "PROCESSING"
                                ? "Processing image..."
                                : "Image unavailable"}
                          </div>
                        )}
                        {showSpinner && (
                          <span className="absolute right-2 top-2 inline-flex items-center gap-1 rounded-full bg-white/90 px-2 py-1 text-[10px] font-semibold text-ink shadow-sm">
                            <LoaderCircle size={12} className="animate-spin" />
                            {clothingStatusLabel(displayState, item.failureReason)}
                          </span>
                        )}
                      </div>
                      <div className="p-4">
                        {displayState !== "READY" && !showSpinner && (
                          <div className="mb-2 flex items-center justify-between gap-2">
                            <span className="text-[10px] font-semibold text-ink/45">
                              {clothingStatusLabel(displayState, item.failureReason)}
                            </span>
                          </div>
                        )}
                        {item.displayNote && (
                          <p className="mb-2 text-[11px] text-ink/55">{item.displayNote}</p>
                        )}
                        {!readOnly && (
                          <div className="flex items-start justify-end gap-2">
                            <div className="flex">
                              <button
                                className="rounded-full p-1.5 hover:bg-linen"
                                onClick={() => openEdit(item)}
                                disabled={disableEdit}
                                aria-label="Edit item"
                              >
                                <Edit3 size={15} />
                              </button>
                              <button
                                className="rounded-full p-1.5 hover:bg-red-50 hover:text-red-800"
                                onClick={() => confirmDelete(item)}
                                aria-label="Delete item"
                              >
                                <Trash2 size={15} />
                              </button>
                            </div>
                          </div>
                        )}
                      </div>
                    </article>
                  );
                })}
              </div>
              <Pagination
                page={renderedItems.page.number}
                totalPages={renderedItems.page.totalPages}
                onChange={setPage}
              />
            </>
          )}
        </section>
      </div>

      {readOnly && viewUserId && (
        <Modal
          open={suggestionOpen}
          extraWide
          title={`Suggest an outfit${profile.data ? ` for ${profile.data.username}` : ""}`}
          onClose={() => !suggestOutfit.isPending && setSuggestionOpen(false)}
        >
          {error && (
            <div className="mb-5">
              <ErrorState message={error} onClose={() => setError("")} />
            </div>
          )}
          <OutfitForm
            wardrobeUserId={viewUserId}
            manualOnly
            busy={suggestOutfit.isPending}
            submitLabel="Suggest"
            onSubmit={({ clothingItemIds }) =>
              suggestOutfit.mutate(clothingItemIds)
            }
          />
        </Modal>
      )}

      {!readOnly && (
        <Modal
          open={formOpen}
          disableClose={createBusy}
          wide={Boolean(editing)}
          title={
            editing ? "Edit this piece" : "Add a new piece"
          }
          onClose={() => {
            if (editing) {
              if (!update.isPending) setFormOpen(false);
              return;
            }
            void closeCreateModal();
          }}
        >
          {error && (
            <div className="mb-5">
              <ErrorState message={error} onClose={() => setError("")} />
            </div>
          )}
          {editing ? (
            <div className="grid gap-7 md:grid-cols-[minmax(0,.85fr)_minmax(0,1.15fr)]">
              <div>
                <div className="aspect-[4/5] overflow-hidden rounded-2xl border border-stone/50 bg-white">
                  <img
                    className="h-full w-full object-contain p-3"
                    src={editing.imageUrl ?? ""}
                    alt={`${editing.category?.toLowerCase() ?? "clothing"} wardrobe item`}
                  />
                </div>
              </div>
              <div>
                <ClothingForm
                  item={editing}
                  busy={update.isPending}
                  onSubmit={(values) => {
                    if (!values.category) {
                      setError("Choose a category.");
                      return;
                    }
                    update.mutate({
                      category: values.category,
                      tags: values.tags ?? [],
                    });
                  }}
                />
              </div>
            </div>
          ) : (
            <div className="space-y-5">
              {createBusy && (
                <div className="flex items-center gap-3 rounded-xl border border-stone bg-linen/40 px-4 py-3 text-sm text-ink/70">
                  <LoaderCircle size={16} className="animate-spin" />
                  Uploading image...
                </div>
              )}
              <ClothingForm
                key={createFormVersion}
                busy={createBusy}
                initialCategory={createDraft?.category}
                submitLabel={createDraft?.failed ? "Upload again" : "Add to wardrobe"}
                onSubmit={(values) => {
                  void submitCreate(values);
                }}
              />
              {createDraft?.failed && (
                <div className="flex flex-col-reverse gap-3 sm:flex-row sm:justify-end">
                  <Button
                    variant="secondary"
                    disabled={createBusy}
                    onClick={() => {
                      void closeCreateModal();
                    }}
                  >
                    Close
                  </Button>
                </div>
              )}
            </div>
          )}
        </Modal>
      )}

      {!readOnly && (
        <Modal
          open={Boolean(deleting)}
          title="Remove this piece?"
          onClose={() => !remove.isPending && setDeleting(undefined)}
        >
          {deleting && (
            <div>
              <div className="flex items-center gap-4 rounded-2xl border border-stone bg-white p-3">
                <img
                  className="h-24 w-20 rounded-xl border border-stone/50 bg-white object-contain p-1"
                  src={deleting.imageUrl ?? ""}
                  alt={`${deleting.category?.toLowerCase() ?? "clothing"} wardrobe item`}
                />
                <div>
                  <p className="mt-2 text-sm leading-6 text-ink/55">
                    This piece will be permanently removed from your wardrobe.
                    This action cannot be undone.
                  </p>
                </div>
              </div>
              {error && (
                <div className="mt-5">
                  <ErrorState message={error} onClose={() => setError("")} />
                </div>
              )}
              <div className="mt-7 flex flex-col-reverse gap-3 sm:flex-row sm:justify-end">
                <Button
                  variant="secondary"
                  disabled={remove.isPending}
                  onClick={() => setDeleting(undefined)}
                >
                  Keep piece
                </Button>
                <Button
                  variant="danger"
                  disabled={remove.isPending}
                  onClick={() => remove.mutate(deleting.id)}
                >
                  {remove.isPending ? "Removing…" : "Remove permanently"}
                </Button>
              </div>
            </div>
          )}
        </Modal>
      )}
    </>
  );
}
