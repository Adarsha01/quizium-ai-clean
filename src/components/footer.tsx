export function Footer() {
  return (
    <footer className="mt-32 border-t border-border/50">
      <div className="mx-auto max-w-7xl px-4 py-10 sm:px-6 lg:px-8">
        <div className="flex flex-col items-center justify-between gap-4 sm:flex-row">
          <p className="text-sm text-muted-foreground">
            © 2026 Quizium. Built for learners.
          </p>
          <div className="flex gap-6 text-sm text-muted-foreground">
            <span>AI-powered learning</span>
            <span>•</span>
            <span>PDF-grounded</span>
          </div>
        </div>
      </div>
    </footer>
  );
}
