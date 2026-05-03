import { Link, useRouter } from "@tanstack/react-router";
import { ArrowLeft } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useAuth } from "@/lib/auth-context";

interface BackButtonProps {
  /** Fallback route if there's no history entry to go back to. */
  fallback?: string;
  label?: string;
  className?: string;
}

/**
 * Smart back button:
 * - If browser has history, goes back one step.
 * - Otherwise routes to a sensible default (admin → /admin, student → /dashboard, else /).
 */
export function BackButton({ fallback, label = "Back", className }: BackButtonProps) {
  const router = useRouter();
  const { role } = useAuth();

  const fallbackTo =
    fallback ?? (role === "admin" ? "/admin" : role === "student" ? "/dashboard" : "/");

  const handleClick = () => {
    if (typeof window !== "undefined" && window.history.length > 1) {
      router.history.back();
    } else {
      router.navigate({ to: fallbackTo });
    }
  };

  // Render an <a> for accessibility (cmd+click etc.) but intercept clicks for history-back.
  return (
    <Button asChild variant="ghost" size="sm" className={className}>
      <Link
        to={fallbackTo}
        onClick={(e) => {
          e.preventDefault();
          handleClick();
        }}
      >
        <ArrowLeft className="h-4 w-4" />
        {label}
      </Link>
    </Button>
  );
}
