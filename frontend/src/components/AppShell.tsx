import {
  ArrowLeft,
  Globe2,
  LogOut,
  Menu,
  Shirt,
  Sparkles,
  X,
} from "lucide-react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { NavLink, Outlet, useMatch, useNavigate } from "react-router-dom";
import { useAuth } from "../auth/AuthContext";
import { api } from "../lib/api";

export function AppShell() {
  const [open, setOpen] = useState(false);
  const { user, logout } = useAuth();
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const publicMatch = useMatch("/discover/:userId/*");
  const viewedUserId = publicMatch?.params.userId;
  const viewedProfile = useQuery({
    queryKey: ["profile", viewedUserId],
    queryFn: () => api.users.profile(viewedUserId!),
    enabled: Boolean(viewedUserId),
  });
  const wardrobeHref = viewedUserId
    ? `/discover/${viewedUserId}/wardrobe`
    : "/wardrobe";
  const outfitsHref = viewedUserId
    ? `/discover/${viewedUserId}/outfits`
    : "/outfits";
  const linkClass = ({ isActive }: { isActive: boolean }) =>
    `flex items-center gap-2 rounded-full px-4 py-2 text-sm font-semibold transition ${isActive ? "bg-ink text-paper" : "hover:bg-ink/5"}`;

  async function handleLogout() {
    await logout();
    queryClient.clear();
    navigate("/login");
  }

  return (
    <div className="min-h-screen">
      <header className="sticky top-0 z-40 border-b border-stone/70 bg-white/95 backdrop-blur-xl">
        <div className="mx-auto flex h-20 max-w-7xl items-center justify-between px-5 lg:px-8">
          <NavLink
            to="/wardrobe"
            className="brand-wordmark text-3xl"
          >
            ClosetHop
          </NavLink>
          <nav className="hidden items-center gap-2 md:flex">
            <NavLink to={wardrobeHref} className={linkClass}>
              <Shirt size={17} /> Wardrobe
            </NavLink>
            <NavLink to={outfitsHref} className={linkClass}>
              <Sparkles size={17} /> Outfits
            </NavLink>
            <NavLink end to="/discover" className={linkClass}>
              <Globe2 size={17} /> Explore
            </NavLink>
          </nav>
          <div className="hidden items-center gap-3 md:flex">
            {viewedUserId ? (
              <NavLink
                to="/wardrobe"
                className="inline-flex items-center gap-2 rounded-full px-3 py-2 text-sm font-semibold text-clay hover:bg-linen"
              >
                <ArrowLeft size={16} /> Return to my wardrobe
              </NavLink>
            ) : (
              <span className="text-sm text-ink/60">{user?.username}</span>
            )}
            <button
              onClick={handleLogout}
              className="rounded-full p-2 hover:bg-ink/5"
              aria-label="Sign out"
            >
              <LogOut size={19} />
            </button>
          </div>
          <button
            className="rounded-full p-2 md:hidden"
            onClick={() => setOpen(!open)}
            aria-label="Toggle navigation"
          >
            {open ? <X /> : <Menu />}
          </button>
        </div>
        {open && (
          <nav className="space-y-2 border-t border-stone p-5 md:hidden">
            {viewedUserId && (
              <p className="px-4 pb-1 text-xs text-ink/45">
                Viewing {viewedProfile.data?.username ?? "public wardrobe"}
              </p>
            )}
            <NavLink
              to={wardrobeHref}
              className={linkClass}
              onClick={() => setOpen(false)}
            >
              <Shirt size={17} /> Wardrobe
            </NavLink>
            <NavLink
              to={outfitsHref}
              className={linkClass}
              onClick={() => setOpen(false)}
            >
              <Sparkles size={17} /> Outfits
            </NavLink>
            <NavLink
              end
              to="/discover"
              className={linkClass}
              onClick={() => setOpen(false)}
            >
              <Globe2 size={17} /> Explore
            </NavLink>
            {viewedUserId && (
              <NavLink
                to="/wardrobe"
                className={linkClass}
                onClick={() => setOpen(false)}
              >
                <ArrowLeft size={17} /> Return to my wardrobe
              </NavLink>
            )}
            <button
              onClick={handleLogout}
              className="flex w-full items-center gap-2 rounded-full px-4 py-2 text-sm font-semibold"
            >
              <LogOut size={17} /> Sign out
            </button>
          </nav>
        )}
      </header>
      <main className="mx-auto max-w-7xl px-5 py-10 lg:px-8 lg:py-14">
        <Outlet />
      </main>
    </div>
  );
}
