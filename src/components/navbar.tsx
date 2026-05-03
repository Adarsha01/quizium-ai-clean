import { useState } from "react";
import { Link, useNavigate } from "@tanstack/react-router";
import { useAuth } from "@/lib/auth-context";
import { Button } from "@/components/ui/button";
import { Sparkles, Loader2, Trophy } from "lucide-react";

export function Navbar() {
  const { user, role, signOut } = useAuth();
  const navigate = useNavigate();
  const [signingOut, setSigningOut] = useState(false);

  const goDashboard = () => {
    const target = role === "admin" ? "/admin" : "/dashboard";
    console.log("[Navbar] Dashboard click → navigating to", target);
    navigate({ to: target });
  };

  const handleSignOut = async () => {
    if (signingOut) return; // prevent double-click
    console.log("[Navbar] Sign out click");
    setSigningOut(true);
    try {
      await signOut();
    } catch (err) {
      console.error("[Navbar] Sign out failed", err);
    } finally {
      navigate({ to: "/" });
      // Leave button disabled briefly while route swaps in.
      setTimeout(() => setSigningOut(false), 300);
    }
  };

  return (
    <header className="sticky top-0 z-50 w-full">
      <div className="glass border-b border-border/50">
        <div className="mx-auto flex h-16 max-w-7xl items-center justify-between px-4 sm:px-6 lg:px-8">
          <Link to="/" className="flex items-center gap-2 group">
            <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-gradient-primary shadow-glow group-hover:scale-110 transition-transform">
              <Sparkles className="h-5 w-5 text-primary-foreground" />
            </div>
            <span className="text-xl font-bold tracking-tight">Quizium</span>
          </Link>

          <nav className="flex items-center gap-2 sm:gap-3">
            {!user ? (
              <>
                <Button asChild variant="ghost" size="sm" className="hidden sm:inline-flex">
                  <Link to="/login">Student Login</Link>
                </Button>
                <Button asChild variant="hero" size="sm">
                  <Link to="/signup">Get Started</Link>
                </Button>
              </>
            ) : (
              <>
                <Button variant="ghost" size="sm" onClick={goDashboard}>
                  Dashboard
                </Button>
                {role !== "admin" && (
                  <Button asChild variant="ghost" size="sm" className="hidden sm:inline-flex">
                    <Link to="/leaderboard">
                      <Trophy className="h-4 w-4" />
                      Leaderboard
                    </Link>
                  </Button>
                )}
                <Button
                  variant="outline"
                  size="sm"
                  onClick={handleSignOut}
                  disabled={signingOut}
                >
                  {signingOut ? (
                    <>
                      <Loader2 className="h-4 w-4 animate-spin" />
                      Signing out…
                    </>
                  ) : (
                    "Sign out"
                  )}
                </Button>
              </>
            )}
          </nav>
        </div>
      </div>
    </header>
  );
}
