import { useMutation, useQuery } from "@tanstack/react-query";
import { LoaderCircle, Minus, Plus, Sparkles } from "lucide-react";
import { useEffect, useState } from "react";
import { useAuth } from "../auth/AuthContext";
import { api } from "../lib/api";
import type { Category, ClothingItemDetail, Outfit, OutfitItem, WardrobeListItem } from "../types";
import { categories } from "../types";
import { Button, EmptyState, Loading } from "./ui";

const MAX_AI_SUGGESTIONS = 3;

const categoryEmoji: Record<Category, string> = {
  TOPS: "👕",
  BOTTOMS: "👖",
  OUTERWEAR: "🧥",
  SHOES: "👟",
  DRESSES: "👗",
  ACCESSORIES: "🧣",
  BAGS: "👜"
};

export function OutfitForm({
  outfit,
  wardrobeUserId,
  manualOnly = false,
  busy,
  onSubmit,
  submitLabel
}: {
  outfit?: Outfit;
  wardrobeUserId?: string;
  manualOnly?: boolean;
  busy: boolean;
  onSubmit(values: { clothingItemIds: string[] }): void;
  submitLabel?: string;
}) {
  const { user } = useAuth();
  const [category, setCategory] = useState<Category>(categories[0]);
  const [selected, setSelected] = useState<string[]>(outfit?.items.map((item) => item.id) ?? []);
  const [aiSuggestions, setAiSuggestions] = useState<ClothingItemDetail[]>([]);
  const [validation, setValidation] = useState("");
  const dedupedSelected = Array.from(new Set(selected));
  const clothing = useQuery({
    queryKey: ["clothing", wardrobeUserId ?? user?.id, "outfit-picker"],
    queryFn: () => wardrobeUserId
      ? api.users.wardrobe(wardrobeUserId, { page: 0, size: 100 })
      : api.clothing.list({ page: 0, size: 100 })
  });

  useEffect(() => {
    setSelected(outfit?.items.map((item) => item.id) ?? []);
    setAiSuggestions([]);
  }, [outfit]);

  const wardrobeItems = (clothing.data?.content ?? []).filter((item) => item.processingState === "READY");
  const retainedOutfitItems = (outfit?.items ?? []).filter(
    (item) => !wardrobeItems.some((wardrobeItem) => wardrobeItem.id === item.id)
  );
  const allItems = [...wardrobeItems, ...retainedOutfitItems];
  const categoryItems = wardrobeItems.filter((item) => item.category === category);
  const availableCategoryItems = categoryItems.filter((item) => !dedupedSelected.includes(item.id));
  const notEnoughCategoryItemsForAi = availableCategoryItems.length <= MAX_AI_SUGGESTIONS;
  const selectedItems = allItems.filter((item) => selected.includes(item.id));
  const suggestion = useMutation({
    mutationFn: () => api.outfits.suggest(dedupedSelected, category),
    onSuccess: (items) => {
      setAiSuggestions(items);
      setValidation("");
      if (!items.length) {
        setValidation("No matching found.");
      }
    },
    onError: (reason) => {
      setAiSuggestions([]);
      setValidation(reason instanceof Error ? reason.message : "AI could not find a suggestion.");
    }
  });

  function formatCategory(value: string | null) {
    return value ? value.charAt(0) + value.slice(1).toLowerCase() : "clothing";
  }

  function add(id: string) {
    setSelected((current) => current.includes(id) ? current : [...current, id]);
    setAiSuggestions([]);
    setValidation("");
  }

  function remove(id: string) {
    setSelected((current) => current.filter((value) => value !== id));
    setAiSuggestions([]);
  }

  function selectSuggestion(id: string) {
    setSelected((current) => current.includes(id) ? current : [...current, id]);
    setAiSuggestions([]);
    setValidation("");
  }

  function discardSuggestions() {
    setAiSuggestions([]);
    setValidation("");
  }

  function askForSuggestion() {
    if (!selected.length) {
      setValidation("Choose at least one piece before asking AI for a suggestion.");
      return;
    }
    setValidation("");
    suggestion.mutate();
  }

  function submitOutfit(clothingItemIds: string[]) {
    if (!clothingItemIds.length) {
      setValidation("Choose at least one piece for this outfit.");
      return false;
    }
    onSubmit({
      clothingItemIds
    });
    return true;
  }

  function submit(event: React.FormEvent) {
    event.preventDefault();
    submitOutfit(dedupedSelected);
  }

  function renderOutfitTile(item: WardrobeListItem | ClothingItemDetail | OutfitItem, onRemove?: () => void) {
    return (
      <div key={item.id} className="relative aspect-[4/5] overflow-hidden rounded-xl border border-stone bg-white">
        <img className="h-full w-full object-contain p-2" src={item.imageUrl ?? ""} alt={item.category?.toLowerCase() ?? "clothing"} />
        {"removedFromWardrobe" in item && item.removedFromWardrobe && (
          <span
            title="Item removed from wardrobe"
            className="absolute bottom-2 left-2 rounded-full bg-ink px-2 py-1 text-[10px] font-semibold text-white"
          >
            Removed
          </span>
        )}
        {onRemove && (
          <button
            type="button"
            onClick={onRemove}
            className="absolute right-2 top-2 rounded-full bg-white p-1.5 text-red-800 shadow-md transition hover:bg-red-50"
            aria-label={`Remove ${item.category?.toLowerCase() ?? "clothing"} from outfit`}
          >
            <Minus size={14} />
          </button>
        )}
      </div>
    );
  }

  if (clothing.isLoading) return <Loading label="Opening the wardrobe" />;
  if (!allItems.length) return <EmptyState title="This wardrobe is empty" copy="Ready clothing is required before composing an outfit." />;

  return (
    <form onSubmit={submit}>
      <div className="grid min-h-[26rem] gap-5 md:grid-cols-[150px_minmax(0,1fr)_minmax(0,1fr)]">
        <section>
          <h3 className="mb-3 text-xs font-bold uppercase tracking-[.16em] text-ink/45">1. Choose a category</h3>
          <div className="grid grid-cols-2 gap-2 md:grid-cols-1">
            {categories.map((value) => (
              <button
                key={value}
                type="button"
                onClick={() => {
                  setCategory(value);
                  setAiSuggestions([]);
                  setValidation("");
                }}
                className={`flex items-center gap-2 rounded-xl border bg-white px-3 py-2.5 text-left text-xs font-semibold transition ${
                  category === value ? "border-clay text-clay ring-2 ring-clay/10" : "border-stone hover:border-clay"
                }`}
              >
                <span aria-hidden="true">{categoryEmoji[value]}</span>
                {value.charAt(0) + value.slice(1).toLowerCase()}
              </button>
            ))}
          </div>
          {!manualOnly && <div className="mt-4 rounded-2xl border border-clay/20 bg-linen/60 p-3">
            <p className="text-xs leading-5 text-ink/55">
              Start with one piece, select the category you want next, then let AI choose from your wardrobe.
            </p>
            <Button
              type="button"
              variant="secondary"
              className="mt-3 w-full px-3"
              disabled={!selected.length || suggestion.isPending || notEnoughCategoryItemsForAi}
              onClick={askForSuggestion}
            >
              {suggestion.isPending
                ? <><LoaderCircle className="animate-spin" size={16} /> Finding a match…</>
                : <><Sparkles size={16} /> Ask AI for {formatCategory(category)}</>}
            </Button>
            {!selected.length && (
              <p className="mt-2 text-center text-[11px] text-ink/45">Select a starting piece first.</p>
            )}
            {selected.length > 0 && notEnoughCategoryItemsForAi && (
              <p className="mt-2 text-center text-[11px] text-ink/45">
                We need more than <strong>{MAX_AI_SUGGESTIONS}</strong> available items in this category for AI suggestions.
              </p>
            )}
          </div>}
        </section>

        <section>
          <h3 className="mb-3 text-xs font-bold uppercase tracking-[.16em] text-ink/45">
            2. Pick {formatCategory(category)} manually
          </h3>
          {!categoryItems.length ? (
            <div className="rounded-2xl border border-dashed border-stone p-6 text-center text-sm text-ink/45">No pieces in this category.</div>
          ) : (
            <div className="grid max-h-[28rem] grid-cols-2 gap-3 overflow-y-auto pr-1">
              {categoryItems.map((item) => {
                const alreadySelected = selected.includes(item.id);
                return (
                  <button
                    type="button"
                    key={item.id}
                    disabled={alreadySelected}
                    onClick={() => add(item.id)}
                    className="group relative aspect-[4/5] overflow-hidden rounded-2xl border border-stone bg-white transition hover:border-clay disabled:opacity-40"
                    aria-label={`Add ${item.category?.toLowerCase() ?? "clothing"} to outfit`}
                  >
                    <img className="h-full w-full object-contain p-2" src={item.imageUrl ?? ""} alt={item.category?.toLowerCase() ?? "clothing"} />
                    {!alreadySelected && <span className="absolute bottom-2 right-2 rounded-full bg-ink p-1.5 text-white shadow-sm"><Plus size={14} /></span>}
                  </button>
                );
              })}
            </div>
          )}
        </section>

        <section className="rounded-2xl border border-stone/70 bg-white p-3">
          <div className="mb-3 flex items-center justify-between">
            <h3 className="text-xs font-bold uppercase tracking-[.16em] text-ink/45">Selected outfit</h3>
            <span className="text-xs text-ink/40">{selected.length} selected</span>
          </div>
          {!selectedItems.length ? (
            <div className="flex min-h-48 items-center justify-center rounded-xl border border-dashed border-stone px-5 text-center text-sm text-ink/45">
              Choose pieces from the middle panel.
            </div>
          ) : (
            <div className="grid max-h-[28rem] grid-cols-2 gap-3 overflow-y-auto">
              {selectedItems.map((item) => renderOutfitTile(item, () => remove(item.id)))}
            </div>
          )}
        </section>
      </div>
      {!manualOnly && aiSuggestions.length > 0 && (
        <section className="mt-6 rounded-2xl border border-stone/70 bg-white p-4">
          <div className="mb-4 flex items-start justify-between gap-4">
            <div>
              <h3 className="text-xs font-bold uppercase tracking-[.16em] text-ink/45">Suggested outfit options</h3>
              <p className="mt-1 text-sm text-ink/60">Choose one option to add it to the selected outfit, or discard them all.</p>
            </div>
            <Button type="button" variant="ghost" className="px-3" onClick={discardSuggestions}>
              Discard
            </Button>
          </div>
          <div className="grid gap-4 lg:grid-cols-3">
            {aiSuggestions.map((item, index) => (
              <article key={item.id} className="rounded-2xl border border-stone/70 bg-paper/40 p-3">
                <div className="mb-3 flex items-center justify-between gap-3">
                  <h4 className="text-sm font-semibold text-ink">Option {index + 1}</h4>
                  <span className="text-xs text-ink/45">{selected.length + (selected.includes(item.id) ? 0 : 1)} pieces</span>
                </div>
                <div className="grid grid-cols-2 gap-3">
                  {selectedItems.map((selectedItem) => renderOutfitTile(selectedItem))}
                  {renderOutfitTile(item)}
                </div>
                <Button
                  type="button"
                  className="mt-4 w-full"
                  disabled={busy}
                  onClick={() => selectSuggestion(item.id)}
                >
                  Select
                </Button>
              </article>
            ))}
          </div>
        </section>
      )}
      {validation && <p className="mt-4 text-sm text-red-700" role="alert">{validation}</p>}
      <div className="mt-6 flex justify-end">
        <Button type="submit" disabled={busy}>
          {busy ? "Saving…" : submitLabel ?? (outfit ? "Save outfit" : "Create outfit")}
        </Button>
      </div>
    </form>
  );
}
