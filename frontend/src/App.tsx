import { Navigate, Route, Routes, useLocation, useParams } from "react-router-dom";
import { useAuth } from "./auth/AuthContext";
import { AppShell } from "./components/AppShell";
import { Loading } from "./components/ui";
import { AuthPage } from "./pages/AuthPage";
import { OutfitsPage, PendingSuggestionsPage } from "./pages/OutfitsPage";
import { WardrobePage } from "./pages/WardrobePage";
import { DiscoverPage } from "./pages/DiscoverPage";

function PublicWardrobeRoute() {
  const { userId } = useParams();
  return <WardrobePage viewUserId={userId} />;
}

function PublicOutfitsRoute() {
  const { userId } = useParams();
  return <OutfitsPage viewUserId={userId} />;
}

function PublicProfileRedirect() {
  const { userId } = useParams();
  return <Navigate to={`/discover/${userId}/wardrobe`} replace />;
}

function ProtectedLayout() {
  const auth = useAuth();
  const location = useLocation();
  if (auth.loading) return <div className="min-h-screen bg-linen"><Loading /></div>;
  if (!auth.user) return <Navigate to="/login" state={{ from: location }} replace />;
  return <AppShell />;
}

function AuthCallback() {
  const auth = useAuth();
  if (auth.loading) return <div className="min-h-screen bg-linen"><Loading label="Completing sign in" /></div>;
  return <Navigate to={auth.user ? "/wardrobe" : "/login"} replace />;
}

export default function App() {
  return (
    <Routes>
      <Route path="/login" element={<AuthPage />} />
      <Route path="/register" element={<AuthPage register />} />
      <Route path="/auth/callback" element={<AuthCallback />} />
      <Route element={<ProtectedLayout />}>
        <Route path="/wardrobe" element={<WardrobePage />} />
        <Route path="/outfits" element={<OutfitsPage />} />
        <Route path="/outfits/pending" element={<PendingSuggestionsPage />} />
        <Route path="/discover" element={<DiscoverPage />} />
        <Route path="/discover/:userId" element={<PublicProfileRedirect />} />
        <Route path="/discover/:userId/wardrobe" element={<PublicWardrobeRoute />} />
        <Route path="/discover/:userId/outfits" element={<PublicOutfitsRoute />} />
      </Route>
      <Route path="/" element={<Navigate to="/wardrobe" replace />} />
      <Route path="*" element={<Navigate to="/wardrobe" replace />} />
    </Routes>
  );
}
