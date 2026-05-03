import { Link } from "@tanstack/react-router";
import { ArrowLeft } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

interface BackToHomeProps {
  className?: string;
  label?: string;
}

/**
 * Subtle "Back to Home" link for unauthenticated entry pages
 * (login, signup, forgot/reset password).
 */
export function BackToHome({ className, label = "Back to Home" }: BackToHomeProps) {
  return (
    <Button asChild variant="ghost" size="sm" className={cn("-ml-2", className)}>
      <Link to="/">
        <ArrowLeft className="h-4 w-4" />
        {label}
      </Link>
    </Button>
  );
}
