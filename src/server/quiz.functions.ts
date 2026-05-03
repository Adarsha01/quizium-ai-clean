import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { supabaseAdmin } from "@/integrations/supabase/client.server";

const inputSchema = z.object({
  pdfId: z.string().uuid(),
  difficulty: z.enum(["beginner", "intermediate", "pro"]),
  questionCount: z.number().int().min(3).max(20).default(20),
  // When true, ignore cached questions and force a fresh AI generation.
  forceRegenerate: z.boolean().optional().default(false),
  // Optional: when present, the server avoids re-asking questions this user
  // has already seen for this PDF + difficulty (per-user uniqueness).
  userId: z.string().uuid().optional(),
});

interface QuizQuestion {
  question: string;
  options: string[];
  correct_index: number;
  explanation: string;
  concept?: string;
  tip?: string;
  page_reference?: string;
}

const SYSTEM_PROMPT = `You are an expert exam-question writer for university courses.
Your job is to create high-quality multiple-choice quiz questions GROUNDED in the provided PDF text but framed as CONCEPT-BASED understanding checks — NOT verbatim copy-paste from the source.

CORE RULES:
- Every question MUST be answerable using the concepts, facts, or relationships described in the provided text. Do NOT use outside knowledge.
- Do NOT copy whole sentences verbatim from the PDF as the question stem. Paraphrase, restructure, or pose the idea as a scenario / "why" / "which best describes" / comparison / "in context of X, what is the purpose of Y".
- Each question MUST be UNIQUE within this set AND must NOT duplicate any of the "previously asked questions" provided. Vary wording, structure, examples, and which option is correct. Cover DIFFERENT concepts across the set — do NOT test the same fact twice with reworded stems.
- Each question has exactly 4 options. Exactly one is correct. Distractors must be plausible and same-domain — not silly or obviously wrong.
- Randomize which option (A/B/C/D) is correct across the set — do not bias toward one position.
- Avoid "All of the above" / "None of the above" unless absolutely necessary.

PER-QUESTION FIELDS:
- question: the stem (paraphrased, concept-based)
- options: array of 4 plausible answers
- correct_index: 0-3
- explanation: 2-4 sentences. State WHY the correct answer is correct, restate the underlying concept, and add a short exam tip when natural. Student-friendly, useful for revision. Do NOT explain why wrong options are wrong.
- concept: ONE short sentence (≤25 words) restating the underlying definition / concept being tested.
- tip: ONE short exam tip (≤25 words) — a memory hook, distinction, or common mistake to avoid.
- page_reference: a short pointer to where this concept appears in the PDF, using the page markers in the source text. Format: "Page N" or "Page N–M". If you genuinely cannot localize it, return "Based on PDF content".

DIFFICULTY GUIDANCE (Bloom's taxonomy):
- beginner: recall + understand. Definitions, identify, recognize.
- intermediate: apply + analyze. Apply a concept to a short scenario, compare two concepts, infer.
- pro: evaluate + synthesize. Edge cases, multi-step reasoning, "best" judgment, trade-offs, tricky scenario-based questions.

If the source text is sparse, still produce the requested number of varied, concept-based questions from whatever IS present — do NOT pad with duplicates.`;

// Split extracted text into rough page chunks and prepend [Page N] markers so
// the model can cite a page in `page_reference`. Heuristic: split on form-feed
// (PDF page breaks often survive extraction) and fall back to N-char chunks.
function annotateWithPages(raw: string, maxChars: number): string {
  let pages = raw.split(/\f/);
  if (pages.length < 2) {
    // Fallback: ~2200 chars ≈ one printed page
    const CHUNK = 2200;
    pages = [];
    for (let i = 0; i < raw.length; i += CHUNK) pages.push(raw.slice(i, i + CHUNK));
  }
  let out = "";
  for (let i = 0; i < pages.length; i++) {
    const piece = `\n[Page ${i + 1}]\n${pages[i].trim()}\n`;
    if (out.length + piece.length > maxChars) break;
    out += piece;
  }
  return out.trim();
}

// Shuffle the options of a question and adjust correct_index accordingly.
function shuffleOptions(q: QuizQuestion): QuizQuestion {
  const order = q.options.map((_, i) => i).sort(() => Math.random() - 0.5);
  const newOptions = order.map((i) => q.options[i]);
  const newCorrect = order.indexOf(q.correct_index);
  return { ...q, options: newOptions, correct_index: newCorrect };
}

// Normalize a question stem for fuzzy duplicate detection.
function normalize(s: string): string {
  return s
    .toLowerCase()
    .replace(/[^a-z0-9 ]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export const generateQuiz = createServerFn({ method: "POST" })
  .inputValidator((input: unknown) => inputSchema.parse(input))
  .handler(async ({ data }) => {
    const { pdfId, difficulty, questionCount, forceRegenerate, userId } = data;

    // ---------- Per-user "already seen" stems ----------
    // Pull stems from this user's prior attempts on the same PDF + difficulty
    // so we can both (a) skip them when serving cache and (b) instruct the
    // AI to avoid re-asking them on a fresh generation.
    let seenStems: string[] = [];
    if (userId) {
      const { data: prior } = await supabaseAdmin
        .from("attempts")
        .select("details, difficulty, pdf_id")
        .eq("user_id", userId)
        .eq("pdf_id", pdfId)
        .eq("difficulty", difficulty)
        .order("created_at", { ascending: false })
        .limit(20);
      if (prior) {
        const set = new Set<string>();
        for (const a of prior) {
          const ans = (a.details as any)?.answers;
          if (Array.isArray(ans)) {
            for (const row of ans) {
              if (row?.question) set.add(normalize(String(row.question)));
            }
          }
        }
        seenStems = Array.from(set);
      }
    }

    const seenSet = new Set(seenStems);

    // ---------- Cache path ----------
    if (!forceRegenerate) {
      const { data: cached } = await supabaseAdmin
        .from("quiz_questions")
        .select("*")
        .eq("pdf_id", pdfId)
        .eq("difficulty", difficulty)
        .order("created_at");

      if (cached && cached.length > 0) {
        // Filter out questions this user has already seen
        const fresh = userId
          ? cached.filter((q) => !seenSet.has(normalize(q.question)))
          : cached;

        if (fresh.length >= questionCount) {
          const shuffled = [...fresh]
            .sort(() => Math.random() - 0.5)
            .slice(0, questionCount)
            .map((q) =>
              shuffleOptions({
                question: q.question,
                options: q.options as string[],
                correct_index: q.correct_index,
                explanation: q.explanation,
                concept: (q as any).concept ?? undefined,
                tip: (q as any).tip ?? undefined,
                page_reference: (q as any).page_reference ?? undefined,
              }),
            );
          return {
            questions: shuffled.map((q, i) => ({ id: `cache-${i}`, ...q })),
            cached: true,
          };
        }
        // Otherwise: not enough fresh questions → fall through and generate more.
      }
    } else {
      // Force regenerate: wipe old cached questions for this pdf+difficulty
      await supabaseAdmin
        .from("quiz_questions")
        .delete()
        .eq("pdf_id", pdfId)
        .eq("difficulty", difficulty);
    }

    // ---------- Fetch PDF text ----------
    const { data: pdf, error: pdfError } = await supabaseAdmin
      .from("pdfs")
      .select("extracted_text, title")
      .eq("id", pdfId)
      .maybeSingle();

    if (pdfError || !pdf) {
      throw new Error("PDF not found");
    }
    if (!pdf.extracted_text || pdf.extracted_text.trim().length < 100) {
      throw new Error("PDF text not yet processed or too short. Please re-upload or wait a moment.");
    }

    // Annotate with [Page N] markers so the AI can cite pages in page_reference.
    const text = annotateWithPages(pdf.extracted_text, 30000);

    const apiKey = process.env.LOVABLE_API_KEY;
    if (!apiKey) throw new Error("AI service not configured");

    // Generate a LARGER pool than requested so we have room to reject duplicates
    // and the cache becomes richer over time. We always cap at a safe upper bound.
    const targetGenerate = Math.min(30, Math.max(questionCount + 5, Math.ceil(questionCount * 1.4)));

    // Random nonce nudges the model to produce a different question set on each
    // forced regenerate, even though the underlying source text is identical.
    const variationSeed = Math.random().toString(36).slice(2, 10);

    const seenBlock =
      seenStems.length > 0
        ? `\n\nPREVIOUSLY ASKED QUESTIONS (do NOT repeat or paraphrase any of these — the student has already seen them):\n${seenStems
            .slice(0, 60)
            .map((s, i) => `${i + 1}. ${s}`)
            .join("\n")}`
        : "";

    const userPrompt = `PDF title: "${pdf.title}"
Difficulty level: ${difficulty}
Number of questions to generate: ${targetGenerate}
Variation seed (use to vary phrasing and which concepts you pick): ${variationSeed}

The PDF text below is annotated with [Page N] markers. When you write each question's "page_reference", cite the [Page N] where the underlying concept appears. If a concept spans multiple pages, use "Page N–M".${seenBlock}

PDF CONTENT:
"""
${text}
"""

Generate ${targetGenerate} ${difficulty}-level multiple-choice questions grounded in the content above.
- Cover ${targetGenerate} DIFFERENT concepts/facts — do not test the same idea twice.
- Paraphrase the source. Do not copy whole sentences as the question stem.
- Make options plausible and same-domain. Randomize which option is correct.
- Each explanation must restate the underlying concept and be useful for revision.
- ALWAYS fill concept, tip, and page_reference for every question.`;

    const response = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: "google/gemini-2.5-flash",
        messages: [
          { role: "system", content: SYSTEM_PROMPT },
          { role: "user", content: userPrompt },
        ],
        tools: [
          {
            type: "function",
            function: {
              name: "submit_quiz",
              description: "Submit the generated quiz questions",
              parameters: {
                type: "object",
                properties: {
                  questions: {
                    type: "array",
                    items: {
                      type: "object",
                      properties: {
                        question: { type: "string" },
                        options: {
                          type: "array",
                          items: { type: "string" },
                          minItems: 4,
                          maxItems: 4,
                        },
                        correct_index: { type: "integer", minimum: 0, maximum: 3 },
                        explanation: { type: "string" },
                        concept: { type: "string" },
                        tip: { type: "string" },
                        page_reference: { type: "string" },
                      },
                      required: [
                        "question",
                        "options",
                        "correct_index",
                        "explanation",
                        "concept",
                        "tip",
                        "page_reference",
                      ],
                      additionalProperties: false,
                    },
                  },
                },
                required: ["questions"],
                additionalProperties: false,
              },
            },
          },
        ],
        tool_choice: { type: "function", function: { name: "submit_quiz" } },
      }),
    });

    if (!response.ok) {
      const body = await response.text().catch(() => "");
      console.error("AI gateway error:", response.status, body);
      if (response.status === 429) throw new Error("Rate limit hit. Please wait a few seconds and try again.");
      if (response.status === 402) throw new Error("AI credits exhausted. Please add credits in Settings → Workspace → Usage.");
      throw new Error("AI quiz generation failed");
    }

    const json = await response.json();
    const toolCall = json.choices?.[0]?.message?.tool_calls?.[0];
    if (!toolCall) throw new Error("AI returned no questions");

    const args = JSON.parse(toolCall.function.arguments);
    let questions: QuizQuestion[] = args.questions ?? [];

    // ---------- Dedup vs. seen + within batch ----------
    const within = new Set<string>();
    questions = questions.filter((q) => {
      const n = normalize(q.question);
      if (!n) return false;
      if (seenSet.has(n)) return false;
      if (within.has(n)) return false;
      within.add(n);
      return true;
    });

    if (questions.length < questionCount) {
      throw new Error(
        "Couldn't generate enough unique questions. Please try again — generating a fresh set.",
      );
    }

    // ---------- Cache them ----------
    const { data: inserted, error: insertError } = await supabaseAdmin
      .from("quiz_questions")
      .insert(
        questions.map((q) => ({
          pdf_id: pdfId,
          difficulty,
          question: q.question,
          options: q.options,
          correct_index: q.correct_index,
          explanation: q.explanation,
          concept: q.concept ?? null,
          tip: q.tip ?? null,
          page_reference: q.page_reference ?? null,
        })),
      )
      .select();

    if (insertError) console.error("Cache insert failed:", insertError);

    const source = inserted ?? questions.map((q) => ({ id: crypto.randomUUID(), ...q }));

    // Trim to requested count, shuffle order, and shuffle each question's options.
    const finalQs = [...source]
      .sort(() => Math.random() - 0.5)
      .slice(0, questionCount)
      .map((q: any) =>
        shuffleOptions({
          question: q.question,
          options: q.options as string[],
          correct_index: q.correct_index,
          explanation: q.explanation,
          concept: q.concept ?? undefined,
          tip: q.tip ?? undefined,
          page_reference: q.page_reference ?? undefined,
        }),
      );

    return {
      questions: finalQs.map((q, i) => ({ id: `gen-${i}`, ...q })),
      cached: false,
    };
  });
