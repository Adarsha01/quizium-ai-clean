import { createFileRoute, Link } from "@tanstack/react-router";
import { Navbar } from "@/components/navbar";
import { Footer } from "@/components/footer";
import { Button } from "@/components/ui/button";
import { Sparkles, BookOpen, Layers, Zap, FileText, GraduationCap, ArrowRight, CheckCircle2 } from "lucide-react";
import heroImg from "@/assets/hero-ai.jpg";

export const Route = createFileRoute("/")({
  component: Landing,
});

function Landing() {
  return (
    <div className="min-h-screen">
      <Navbar />

      {/* Hero */}
      <section className="relative overflow-hidden">
        <div className="bg-gradient-hero absolute inset-0 -z-10" />
        <div className="mx-auto max-w-7xl px-4 pt-16 pb-20 sm:px-6 sm:pt-20 sm:pb-28 lg:px-8 lg:pt-28">
          <div className="grid gap-12 lg:grid-cols-2 lg:items-center lg:gap-16">
            <div>
              <div className="inline-flex items-center gap-2 rounded-full glass px-4 py-1.5 text-xs font-medium text-foreground/90">
                <Sparkles className="h-3.5 w-3.5 text-primary-glow" />
                AI-powered, unit-based learning
              </div>

              <h1 className="mt-6 text-4xl font-bold tracking-tight sm:text-5xl lg:text-6xl">
                Master every unit.{" "}
                <span className="text-gradient-primary">One quiz at a time.</span>
              </h1>

              <p className="mt-6 text-lg text-muted-foreground sm:text-xl max-w-xl">
                Quizium converts course PDFs into intelligent, level-based quizzes using AI — so every question is grounded in what you're actually studying.
              </p>

              <div className="mt-8 flex flex-wrap gap-3">
                <Button asChild variant="hero" size="xl">
                  <Link to="/signup">
                    Let's Begin <ArrowRight className="h-4 w-4" />
                  </Link>
                </Button>
                <Button asChild variant="outline" size="xl">
                  <Link to="/login">I have an account</Link>
                </Button>
              </div>

              <div className="mt-8 flex flex-wrap gap-2">
                {["3 difficulty levels", "PDF-grounded quizzes", "Instant feedback"].map((p) => (
                  <span
                    key={p}
                    className="inline-flex items-center gap-1.5 rounded-full border border-border/60 bg-surface/40 px-3 py-1 text-xs text-foreground/80 backdrop-blur"
                  >
                    <CheckCircle2 className="h-3 w-3 text-primary-glow" />
                    {p}
                  </span>
                ))}
              </div>
            </div>

            <div className="relative">
              <div className="absolute -inset-4 bg-gradient-primary opacity-30 blur-3xl rounded-full" />
              <div className="relative rounded-3xl glass p-2 shadow-elevated animate-float">
                <img
                  src={heroImg}
                  alt="AI brain processing PDFs into quizzes"
                  width={1024}
                  height={1024}
                  className="rounded-2xl w-full h-auto"
                />
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* Features */}
      <section className="mx-auto max-w-7xl px-4 py-20 sm:px-6 lg:px-8">
        <div className="mx-auto max-w-2xl text-center">
          <h2 className="text-3xl font-bold sm:text-4xl">
            Built for the way you actually learn
          </h2>
          <p className="mt-4 text-muted-foreground">
            Three pillars that turn your course material into mastery.
          </p>
        </div>

        <div className="mt-14 grid gap-6 md:grid-cols-3">
          {[
            {
              icon: BookOpen,
              title: "Course-organised PDFs",
              desc: "Browse content by course, semester, subject, and unit — no more digging through folders.",
            },
            {
              icon: FileText,
              title: "Unit-grounded quizzes",
              desc: "Every question comes from the PDF you're studying. No hallucinations, no off-topic noise.",
            },
            {
              icon: Layers,
              title: "Beginner → Pro progression",
              desc: "Unlock harder levels as you score. Build mastery without burning out.",
            },
          ].map((f) => (
            <div
              key={f.title}
              className="group relative rounded-2xl bg-gradient-card border border-border/60 p-6 shadow-card hover:shadow-glow transition-all duration-300 hover:-translate-y-1"
            >
              <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-gradient-primary shadow-glow">
                <f.icon className="h-6 w-6 text-primary-foreground" />
              </div>
              <h3 className="mt-5 text-lg font-semibold">{f.title}</h3>
              <p className="mt-2 text-sm text-muted-foreground leading-relaxed">{f.desc}</p>
            </div>
          ))}
        </div>
      </section>

      {/* CTA */}
      <section className="mx-auto max-w-7xl px-4 pb-20 sm:px-6 lg:px-8">
        <div className="relative overflow-hidden rounded-3xl bg-gradient-card border border-border/60 p-10 sm:p-16 text-center shadow-elevated">
          <div className="bg-gradient-hero absolute inset-0 opacity-50" />
          <div className="relative">
            <GraduationCap className="mx-auto h-12 w-12 text-primary-glow" />
            <h2 className="mt-4 text-3xl font-bold sm:text-4xl">
              Ready to quiz smarter?
            </h2>
            <p className="mt-3 text-muted-foreground max-w-xl mx-auto">
              Sign up free, browse your courses, and let AI do the rest.
            </p>
            <Button asChild variant="hero" size="xl" className="mt-8">
              <Link to="/signup">
                Create your account <Zap className="h-4 w-4" />
              </Link>
            </Button>
          </div>
        </div>
      </section>

      <Footer />
    </div>
  );
}
