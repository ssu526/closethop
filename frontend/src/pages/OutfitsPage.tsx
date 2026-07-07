import { keepPreviousData, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ArrowLeft, Check, Edit3, Plus, Trash2 } from "lucide-react";
import { Link } from "react-router-dom";
import { useState } from "react";
import { useAuth } from "../auth/AuthContext";
import { OutfitForm } from "../components/OutfitForm";
import { Button, EmptyState, ErrorState, Loading, Modal, Pagination } from "../components/ui";
import { api } from "../lib/api";
import type { Outfit, PageResponse } from "../types";

interface OutfitValues {
  clothingItemIds: string[];
}

function outfitGridColumns(itemCount: number) {
  return Math.max(1, Math.ceil(Math.sqrt(itemCount)));
}

function OutfitGrid({
  data,
  emptyTitle,
  emptyCopy,
  loading,
  error,
  page,
  onPageChange,
  canEdit,
  canDelete,
  canAccept,
  onEdit,
  onDelete,
  onAccept
}: {
  data?: PageResponse<Outfit>;
  emptyTitle: string;
  emptyCopy: string;
  loading: boolean;
  error?: Error | null;
  page: number;
  onPageChange(page: number): void;
  canEdit?(outfit: Outfit): boolean;
  canDelete?(outfit: Outfit): boolean;
  canAccept?(outfit: Outfit): boolean;
  onEdit(outfit: Outfit): void;
  onDelete(outfit: Outfit): void;
  onAccept?(outfit: Outfit): void;
}) {
  if (loading) return <Loading />;
  if (error) return <ErrorState message={error.message} />;
  if (!data?.content.length) return <EmptyState title={emptyTitle} copy={emptyCopy} />;

  return (
    <>
      <div className="grid gap-6 md:grid-cols-2 lg:grid-cols-3">
        {data.content.map((outfit) => {
          const editable = canEdit?.(outfit) ?? false;
          const deletable = canDelete?.(outfit) ?? false;
          const acceptable = canAccept?.(outfit) ?? false;
          return (
            <article key={outfit.id} className="overflow-hidden rounded-[1.75rem] border border-stone/50 bg-white shadow-sm transition hover:shadow-card">
              <div
                className="grid aspect-[4/3] gap-0.5 overflow-hidden bg-white p-2"
                style={{
                  gridTemplateColumns: `repeat(${outfitGridColumns(outfit.items.length)}, minmax(0, 1fr))`,
                  gridAutoRows: "minmax(0, 1fr)"
                }}
              >
                {outfit.items.map((item) => (
                  <div key={item.id} className="group/item relative min-h-0 min-w-0">
                    <img className="h-full w-full bg-white object-contain p-1" src={item.imageUrl ?? ""} alt={item.category?.toLowerCase() ?? "clothing"} />
                    {item.removedFromWardrobe && (
                      <span className="absolute right-1 top-1">
                        <span
                          className="flex h-6 w-6 items-center justify-center rounded-full border border-stone bg-white text-ink/55 shadow-sm"
                          aria-label="Item removed from wardrobe"
                        >
                          <Trash2 size={12} />
                        </span>
                        <span
                          role="tooltip"
                          className="pointer-events-none absolute right-0 top-8 z-10 w-max max-w-44 rounded-lg bg-ink px-2.5 py-1.5 text-xs text-white opacity-0 shadow-md transition group-hover/item:opacity-100"
                        >
                          Item removed from wardrobe
                        </span>
                      </span>
                    )}
                  </div>
                ))}
              </div>
              {(outfit.suggestedBy || editable || deletable || acceptable) && (
                <div className="flex items-center gap-3 border-t border-stone/40 px-5 py-4">
                  {outfit.suggestedBy && (
                    <p className="flex-1 text-sm text-ink/55">
                      Suggested by <span className="font-semibold text-ink">{outfit.suggestedBy.username}</span>
                    </p>
                  )}
                  <div className="ml-auto flex">
                    {acceptable && (
                      <button className="rounded-full p-2 text-clay hover:bg-linen" onClick={() => onAccept?.(outfit)} aria-label="Accept suggestion">
                        <Check size={17} />
                      </button>
                    )}
                    {editable && (
                      <button className="rounded-full p-2 hover:bg-linen" onClick={() => onEdit(outfit)} aria-label="Edit outfit">
                        <Edit3 size={16} />
                      </button>
                    )}
                    {deletable && (
                      <button className="rounded-full p-2 hover:bg-red-50 hover:text-red-800" onClick={() => onDelete(outfit)} aria-label="Delete outfit">
                        <Trash2 size={16} />
                      </button>
                    )}
                  </div>
                </div>
              )}
            </article>
          );
        })}
      </div>
      <Pagination page={page} totalPages={data.page.totalPages} onChange={onPageChange} />
    </>
  );
}

export function OutfitsPage({ viewUserId }: { viewUserId?: string }) {
  const { user } = useAuth();
  const readOnly = Boolean(viewUserId);
  const ownerId = viewUserId ?? user?.id ?? "";
  const client = useQueryClient();
  const [page, setPage] = useState(0);
  const [includeCreated, setIncludeCreated] = useState(true);
  const [includeAccepted, setIncludeAccepted] = useState(true);
  const [editing, setEditing] = useState<Outfit | undefined>();
  const [deleting, setDeleting] = useState<Outfit | undefined>();
  const [open, setOpen] = useState(false);
  const [error, setError] = useState("");

  const outfits = useQuery({
    queryKey: ["outfits", ownerId, page, includeCreated, includeAccepted],
    queryFn: () => viewUserId
      ? api.users.outfits(viewUserId, { page, includeCreated, includeAccepted })
      : api.outfits.list({ page, includeCreated, includeAccepted }),
    placeholderData: keepPreviousData
  });
  const profile = useQuery({
    queryKey: ["profile", ownerId],
    queryFn: () => viewUserId ? api.users.profile(viewUserId) : api.users.me()
  });
  const pendingSuggestions = useQuery({
    queryKey: ["pending-outfit-suggestions", 0, 1],
    queryFn: () => api.outfits.pendingSuggestions(0, 1),
    enabled: !readOnly
  });
  const refresh = () => {
    client.invalidateQueries({ queryKey: ["outfits", ownerId] });
  };
  const create = useMutation({
    mutationFn: api.outfits.create,
    onSuccess: () => { setOpen(false); refresh(); },
    onError: (reason) => setError(reason instanceof Error ? reason.message : "Could not create outfit.")
  });
  const update = useMutation({
    mutationFn: (values: OutfitValues) => api.outfits.update(editing!.id, values),
    onSuccess: () => { setOpen(false); setEditing(undefined); refresh(); },
    onError: (reason) => setError(reason instanceof Error ? reason.message : "Could not update outfit.")
  });
  const remove = useMutation({
    mutationFn: api.outfits.delete,
    onSuccess: () => {
      setDeleting(undefined);
      refresh();
    },
    onError: (reason) => setError(reason instanceof Error ? reason.message : "Could not delete outfit.")
  });

  function openCreate() { setEditing(undefined); setError(""); setOpen(true); }
  function openEdit(outfit: Outfit) { setEditing(outfit); setError(""); setOpen(true); }
  function confirmDelete(outfit: Outfit) { setError(""); setDeleting(outfit); }
  return (
    <>
      <section className="mb-10 flex flex-col justify-between gap-6 md:flex-row md:items-end">
        <h1 className="font-display text-5xl md:text-6xl">
          {readOnly && profile.data ? `${profile.data.username}’s outfits` : "Outfit journal"}
        </h1>
        {!readOnly && (
          <div className="flex flex-wrap gap-3">
            <Link to="/outfits/pending">
              <Button variant="secondary" className="relative pr-10">
                Pending suggestions
                {pendingSuggestions.isSuccess && pendingSuggestions.data.page.totalElements > 0 && (
                  <span
                    aria-hidden="true"
                    className="pointer-events-none absolute right-4 top-1/2 flex h-3.5 w-3.5 -translate-y-1/2 items-center justify-center"
                  >
                    <span className="absolute h-3.5 w-3.5 rounded-full bg-red-500/20 shadow-[0_0_0_4px_rgba(239,68,68,0.12)]" />
                    <span className="absolute h-3.5 w-3.5 animate-ping rounded-full bg-red-400/35" />
                    <span className="relative h-2.5 w-2.5 rounded-full bg-red-500 shadow-sm" />
                  </span>
                )}
              </Button>
            </Link>
            <Button onClick={openCreate}><Plus size={18} /> Compose outfit</Button>
          </div>
        )}
      </section>
      {error && <div className="mb-6"><ErrorState message={error} onClose={() => setError("")} /></div>}

      <section>
        <div className="mb-6 flex flex-wrap items-center gap-5 rounded-2xl border border-stone/60 bg-white px-5 py-4">
          <span className="text-sm font-semibold text-ink/55">Show</span>
          <label className="flex cursor-pointer items-center gap-2 text-sm text-ink">
            <input
              type="checkbox"
              checked={includeCreated}
              onChange={(event) => { setIncludeCreated(event.target.checked); setPage(0); }}
              className="h-4 w-4 accent-clay"
            />
            User-created outfits
          </label>
          <label className="flex cursor-pointer items-center gap-2 text-sm text-ink">
            <input
              type="checkbox"
              checked={includeAccepted}
              onChange={(event) => { setIncludeAccepted(event.target.checked); setPage(0); }}
              className="h-4 w-4 accent-clay"
            />
            Accepted suggestions
          </label>
        </div>
        <OutfitGrid
          data={outfits.data}
          loading={outfits.isLoading}
          error={outfits.error}
          page={page}
          onPageChange={setPage}
          emptyTitle="No matching outfits."
          emptyCopy="Choose another filter or compose a new outfit."
          canEdit={(outfit) => !readOnly && !outfit.suggestedBy}
          canDelete={() => !readOnly}
          onEdit={openEdit}
          onDelete={confirmDelete}
        />
      </section>

      {!readOnly && (
        <Modal open={open} extraWide title={editing ? "Edit outfit" : "Compose an outfit"} onClose={() => setOpen(false)}>
          {error && <div className="mb-5"><ErrorState message={error} onClose={() => setError("")} /></div>}
          <OutfitForm outfit={editing} busy={create.isPending || update.isPending} onSubmit={(values) => editing ? update.mutate(values) : create.mutate(values)} />
        </Modal>
      )}

      <Modal open={Boolean(deleting)} title="Delete this outfit?" onClose={() => !remove.isPending && setDeleting(undefined)}>
        {deleting && (
          <div>
            <div className="flex gap-4 rounded-2xl border border-stone bg-white p-3">
              <div
                className="grid h-24 w-24 shrink-0 gap-0.5 overflow-hidden rounded-xl border border-stone/50 bg-white"
                style={{
                  gridTemplateColumns: `repeat(${outfitGridColumns(deleting.items.length)}, minmax(0, 1fr))`,
                  gridAutoRows: "minmax(0, 1fr)"
                }}
              >
                {deleting.items.map((item) => (
                  <img key={item.id} className="h-full w-full bg-white object-contain p-0.5" src={item.imageUrl ?? ""} alt="" />
                ))}
              </div>
              <p className="self-center text-sm leading-6 text-ink/55">
                This outfit will be permanently deleted. The individual clothing pieces will remain in the wardrobe.
              </p>
            </div>
            {error && <div className="mt-5"><ErrorState message={error} onClose={() => setError("")} /></div>}
            <div className="mt-7 flex flex-col-reverse gap-3 sm:flex-row sm:justify-end">
              <Button variant="secondary" disabled={remove.isPending} onClick={() => setDeleting(undefined)}>Keep outfit</Button>
              <Button variant="danger" disabled={remove.isPending} onClick={() => remove.mutate(deleting.id)}>
                {remove.isPending ? "Deleting…" : "Delete permanently"}
              </Button>
            </div>
          </div>
        )}
      </Modal>
    </>
  );
}

export function PendingSuggestionsPage() {
  const client = useQueryClient();
  const [page, setPage] = useState(0);
  const [deleting, setDeleting] = useState<Outfit>();
  const [error, setError] = useState("");
  const suggestions = useQuery({
    queryKey: ["pending-outfit-suggestions", page],
    queryFn: () => api.outfits.pendingSuggestions(page),
    placeholderData: keepPreviousData
  });
  const refresh = () => {
    client.invalidateQueries({ queryKey: ["pending-outfit-suggestions"] });
    client.invalidateQueries({ queryKey: ["outfits"] });
  };
  const accept = useMutation({
    mutationFn: api.outfits.accept,
    onSuccess: refresh,
    onError: (reason) =>
      setError(reason instanceof Error ? reason.message : "Could not accept this suggestion.")
  });
  const remove = useMutation({
    mutationFn: api.outfits.delete,
    onSuccess: () => {
      setDeleting(undefined);
      refresh();
    },
    onError: (reason) =>
      setError(reason instanceof Error ? reason.message : "Could not delete this suggestion.")
  });

  return (
    <>
      <Link to="/outfits" className="mb-7 inline-flex items-center gap-2 text-sm font-semibold text-clay">
        <ArrowLeft size={17} /> Outfit journal
      </Link>
      <section className="mb-10">
        <h1 className="font-display text-5xl md:text-6xl">Pending suggestions</h1>
        <p className="mt-3 text-sm leading-6 text-ink/55">
          Accept suggestions you want to add to your outfit journal.
        </p>
      </section>
      {error && <div className="mb-6"><ErrorState message={error} onClose={() => setError("")} /></div>}
      <OutfitGrid
        data={suggestions.data}
        loading={suggestions.isLoading}
        error={suggestions.error}
        page={page}
        onPageChange={setPage}
        emptyTitle="No pending suggestions."
        emptyCopy="New suggestions from other people will appear here."
        canAccept={() => true}
        canDelete={() => true}
        onAccept={(outfit) => accept.mutate(outfit.id)}
        onEdit={() => undefined}
        onDelete={setDeleting}
      />

      <Modal
        open={Boolean(deleting)}
        title="Delete this suggestion?"
        onClose={() => !remove.isPending && setDeleting(undefined)}
      >
        {deleting && (
          <div>
            <p className="text-sm leading-6 text-ink/60">
              This pending suggestion will be permanently deleted.
            </p>
            <div className="mt-7 flex flex-col-reverse gap-3 sm:flex-row sm:justify-end">
              <Button variant="secondary" disabled={remove.isPending} onClick={() => setDeleting(undefined)}>
                Keep suggestion
              </Button>
              <Button variant="danger" disabled={remove.isPending} onClick={() => remove.mutate(deleting.id)}>
                {remove.isPending ? "Deleting…" : "Delete suggestion"}
              </Button>
            </div>
          </div>
        )}
      </Modal>
    </>
  );
}
