import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useMemo, useRef, useState } from "react";
import { Navbar } from "@/components/navbar";
import { ProtectedRoute } from "@/components/protected-route";
import { BackButton } from "@/components/back-button";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Loader2,
  ZoomIn,
  ZoomOut,
  ChevronLeft,
  ChevronRight,
  Sparkles,
} from "lucide-react";

export const Route = createFileRoute("/pdf/$pdfId")({
  component: () => (
    <ProtectedRoute>
      <PdfViewer />
    </ProtectedRoute>
  ),
});

const ZOOM_LEVELS = [50, 75, 100, 125, 150, 200] as const;

function PdfViewer() {
  const { pdfId } = Route.useParams();
  const [url, setUrl] = useState<string | null>(null);
  const [title, setTitle] = useState<string>("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [page, setPage] = useState(1);
  const [pageInput, setPageInput] = useState("1");
  const [zoom, setZoom] = useState<number>(100);
  const iframeRef = useRef<HTMLIFrameElement | null>(null);

  useEffect(() => {
    (async () => {
      const { data: pdf, error: pe } = await supabase
        .from("pdfs")
        .select("title, storage_path")
        .eq("id", pdfId)
        .maybeSingle();
      if (pe || !pdf) {
        setError("PDF not found");
        setLoading(false);
        return;
      }
      setTitle(pdf.title);
      const { data: signed, error: se } = await supabase.storage
        .from("pdfs")
        .createSignedUrl(pdf.storage_path, 60 * 60);
      if (se || !signed) {
        setError("Could not load PDF file");
        setLoading(false);
        return;
      }
      setUrl(signed.signedUrl);
      setLoading(false);
    })();
  }, [pdfId]);

  // Browsers' built-in PDF viewer accepts `#page=N&zoom=PCT` open-parameters.
  // Re-keying the iframe `src` when these change forces it to re-navigate.
  const viewerSrc = useMemo(() => {
    if (!url) return null;
    return `${url}#page=${page}&zoom=${zoom}`;
  }, [url, page, zoom]);

  const goPrev = () => {
    const next = Math.max(1, page - 1);
    setPage(next);
    setPageInput(String(next));
  };
  const goNext = () => {
    const next = page + 1;
    setPage(next);
    setPageInput(String(next));
  };
  const submitPage = (e: React.FormEvent) => {
    e.preventDefault();
    const n = parseInt(pageInput, 10);
    if (!isNaN(n) && n >= 1) setPage(n);
    else setPageInput(String(page));
  };

  const zoomOut = () => {
    const idx = ZOOM_LEVELS.findIndex((z) => z >= zoom);
    setZoom(ZOOM_LEVELS[Math.max(0, idx - 1)]);
  };
  const zoomIn = () => {
    const idx = ZOOM_LEVELS.findIndex((z) => z >= zoom);
    setZoom(ZOOM_LEVELS[Math.min(ZOOM_LEVELS.length - 1, idx + 1)]);
  };

  return (
    <div className="min-h-screen">
      <Navbar />
      <main className="mx-auto max-w-6xl px-4 py-6 sm:px-6 lg:px-8">
        <div className="flex items-center justify-between gap-4 mb-3 flex-wrap">
          <BackButton fallback="/dashboard" label="Back to PDFs" />
          <h1 className="text-lg font-semibold truncate max-w-[60%] text-right sm:text-left">
            {title}
          </h1>
        </div>

        {/* Source label */}
        <div className="mb-3 inline-flex items-center gap-2 rounded-full border border-primary/30 bg-primary/10 px-3 py-1 text-xs font-medium text-primary-glow">
          <Sparkles className="h-3.5 w-3.5" />
          This quiz is generated from this PDF
        </div>

        {/* Toolbar */}
        <div className="mb-3 flex items-center justify-between gap-3 flex-wrap rounded-xl border border-border/60 bg-surface/40 px-3 py-2">
          <div className="flex items-center gap-1.5">
            <Button
              variant="ghost"
              size="icon"
              onClick={goPrev}
              disabled={page <= 1}
              aria-label="Previous page"
            >
              <ChevronLeft className="h-4 w-4" />
            </Button>
            <form onSubmit={submitPage} className="flex items-center gap-1 text-sm">
              <span className="text-muted-foreground">Page</span>
              <Input
                value={pageInput}
                onChange={(e) => setPageInput(e.target.value.replace(/[^0-9]/g, ""))}
                onBlur={submitPage}
                inputMode="numeric"
                className="h-8 w-14 text-center"
                aria-label="Go to page"
              />
            </form>
            <Button
              variant="ghost"
              size="icon"
              onClick={goNext}
              aria-label="Next page"
            >
              <ChevronRight className="h-4 w-4" />
            </Button>
          </div>

          <div className="flex items-center gap-1.5">
            <Button variant="ghost" size="icon" onClick={zoomOut} aria-label="Zoom out">
              <ZoomOut className="h-4 w-4" />
            </Button>
            <span className="text-xs font-medium tabular-nums w-12 text-center text-muted-foreground">
              {zoom}%
            </span>
            <Button variant="ghost" size="icon" onClick={zoomIn} aria-label="Zoom in">
              <ZoomIn className="h-4 w-4" />
            </Button>
          </div>
        </div>

        <div
          className="rounded-2xl border border-border/60 overflow-hidden bg-surface"
          style={{ height: "calc(100vh - 240px)" }}
        >
          {loading ? (
            <div className="flex h-full items-center justify-center">
              <Loader2 className="h-8 w-8 animate-spin text-primary-glow" />
            </div>
          ) : error ? (
            <div className="flex h-full items-center justify-center text-destructive">
              {error}
            </div>
          ) : (
            <iframe
              ref={iframeRef}
              key={viewerSrc /* re-mount on page/zoom change */}
              src={viewerSrc!}
              title={title}
              className="w-full h-full"
            />
          )}
        </div>
      </main>
    </div>
  );
}
