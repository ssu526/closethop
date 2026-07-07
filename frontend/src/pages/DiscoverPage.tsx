import { useQuery } from "@tanstack/react-query";
import { ArrowLeft, ArrowRight, Sparkles } from "lucide-react";
import { Link, useLocation, useParams } from "react-router-dom";
import { EmptyState, ErrorState, Loading } from "../components/ui";
import { api } from "../lib/api";

function outfitGridColumns(itemCount: number) {
  return Math.max(1, Math.ceil(Math.sqrt(itemCount)));
}

export function DiscoverPage() {
  const users = useQuery({ queryKey: ["public-users"], queryFn: api.users.public });

  return (
    <>
      <section className="mb-10">
        <h1 className="font-display text-5xl md:text-6xl">Explore</h1>
      </section>
      {users.isLoading ? <Loading label="Finding public wardrobes" /> :
        users.isError ? <ErrorState message={users.error.message} /> :
          !users.data?.length ? <EmptyState title="No public wardrobes yet." copy="When another user shares their wardrobe, it will appear here." /> :
            <div className="grid gap-6 sm:grid-cols-2 lg:grid-cols-3">
              {users.data.map((user) => (
                <Link key={user.id} to={`/discover/${user.id}/wardrobe`} className="group overflow-hidden rounded-[1.5rem] border border-stone/50 bg-white shadow-sm transition hover:-translate-y-1 hover:shadow-card">
                  {user.featuredOutfit?.imageUrls.length ? (
                    <span className="grid aspect-[4/3] grid-cols-2 gap-0.5 overflow-hidden bg-white">
                      {user.featuredOutfit.imageUrls.map((imageUrl, index) => (
                        <img key={`${imageUrl}-${index}`} className="h-full w-full bg-white object-contain p-1" src={imageUrl} alt="" />
                      ))}
                    </span>
                  ) : (
                    <span className="flex aspect-[4/3] flex-col items-center justify-center bg-linen/50 px-6 text-center">
                      <span className="rounded-full bg-white p-3 text-clay shadow-sm"><Sparkles size={22} /></span>
                      <span className="mt-4 text-sm font-semibold text-ink/65">Help {user.username} create an outfit</span>
                    </span>
                  )}
                  <span className="flex items-center gap-3 p-5">
                    <span className="flex-1">
                      <span className="block font-display text-xl">{user.username}</span>
                      <span className="mt-1 block text-xs text-ink/45">{user.clothingItemCount} {user.clothingItemCount === 1 ? "clothing item" : "clothing items"}</span>
                    </span>
                    <ArrowRight className="text-ink/35 transition group-hover:translate-x-1 group-hover:text-clay" size={19} />
                  </span>
                </Link>
              ))}
            </div>}
    </>
  );
}

export function PublicOutfitsPage() {
  const { userId = "" } = useParams();
  const location = useLocation();
  const passedUsername = (location.state as { username?: string } | null)?.username;
  const users = useQuery({ queryKey: ["public-users"], queryFn: api.users.public });
  const username = passedUsername ?? users.data?.find((user) => user.id === userId)?.username;
  const outfits = useQuery({
    queryKey: ["public-outfits", userId],
    queryFn: () => api.users.outfits(userId),
    enabled: Boolean(userId)
  });

  return (
    <>
      <Link to="/discover" className="mb-7 inline-flex items-center gap-2 text-sm font-semibold text-clay"><ArrowLeft size={17} /> Explore</Link>
      <section className="mb-10">
        <p className="text-xs font-bold uppercase tracking-[.18em] text-ink/40">You are viewing</p>
        <Link
          to={`/discover/${userId}/wardrobe`}
          state={{ username }}
          className="mt-2 inline-block font-display text-4xl transition hover:text-clay md:text-5xl"
        >
          {username ? `${username}’s wardrobe` : "Shared wardrobe"}
        </Link>
      </section>
      {outfits.isLoading ? <Loading label="Opening shared outfits" /> :
        outfits.isError ? <ErrorState message={outfits.error.message} /> :
          !outfits.data?.content.length ? <EmptyState title="No outfits yet." copy={`${username ?? "This user"} has not created an outfit yet.`} /> :
            <div className="grid gap-6 md:grid-cols-2 lg:grid-cols-3">
              {outfits.data.content.map((outfit) => (
                <article key={outfit.id} className="overflow-hidden rounded-[1.75rem] border border-stone/50 bg-white shadow-sm">
                  <div
                    className="grid aspect-[4/3] gap-0.5 overflow-hidden bg-white p-2"
                    style={{
                      gridTemplateColumns: `repeat(${outfitGridColumns(outfit.items.length)}, minmax(0, 1fr))`,
                      gridAutoRows: "minmax(0, 1fr)"
                    }}
                  >
                    {outfit.items.map((item) => (
                      <img key={item.id} className="h-full min-h-0 w-full min-w-0 bg-white object-contain p-1" src={item.imageUrl ?? ""} alt={item.category?.toLowerCase() ?? "clothing"} />
                    ))}
                  </div>
                </article>
              ))}
            </div>}
    </>
  );
}

export function PublicWardrobePage() {
  const { userId = "" } = useParams();
  const location = useLocation();
  const username = (location.state as { username?: string } | null)?.username;
  const wardrobe = useQuery({
    queryKey: ["public-wardrobe", userId],
    queryFn: () => api.users.wardrobe(userId),
    enabled: Boolean(userId)
  });

  return (
    <>
      <Link to={`/discover/${userId}`} state={{ username }} className="mb-7 inline-flex items-center gap-2 text-sm font-semibold text-clay"><ArrowLeft size={17} /> Outfits</Link>
      <h1 className="mb-10 font-display text-5xl">{username ? `${username}’s wardrobe` : "Shared wardrobe"}</h1>
      {wardrobe.isLoading ? <Loading /> : wardrobe.isError ? <ErrorState message={wardrobe.error.message} /> :
        !wardrobe.data?.content.length ? <EmptyState title="This wardrobe is empty." copy="There are no shared pieces here yet." /> :
          <div className="grid grid-cols-2 gap-4 md:grid-cols-3 lg:grid-cols-4 md:gap-6">
            {wardrobe.data.content.map((item) => (
              <article key={item.id} className="overflow-hidden rounded-[1.5rem] border border-stone/60 bg-white">
                <div className="aspect-[4/5] overflow-hidden bg-stone/20"><img className="h-full w-full object-contain p-2" src={item.imageUrl ?? ""} alt={item.category?.toLowerCase() ?? "clothing"} /></div>
                <div className="p-4">
                  <p className="text-xs font-bold uppercase tracking-[.15em] text-clay">{item.category}</p>
                </div>
              </article>
            ))}
          </div>}
    </>
  );
}
