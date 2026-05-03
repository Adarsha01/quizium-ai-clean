import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { Navbar } from "@/components/navbar";
import { ProtectedRoute } from "@/components/protected-route";
import { BackButton } from "@/components/back-button";
import { useAuth } from "@/lib/auth-context";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Loader2, Plus, Trash2, FileText, Upload, ChevronRight, Users, CheckCircle2,
  GraduationCap, BookOpen, ClipboardList, TrendingUp,
} from "lucide-react";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import { extractPdfText } from "@/lib/pdf-extract";
import { AdminAnalyticsCharts } from "@/components/admin-analytics-charts";

export const Route = createFileRoute("/admin")({
  component: () => (
    <ProtectedRoute requireRole="admin">
      <AdminPage />
    </ProtectedRoute>
  ),
});

interface Course { id: string; name: string; description: string | null }
interface Semester { id: string; name: string; course_id: string }
interface Subject { id: string; name: string; semester_id: string }
interface Unit { id: string; name: string; subject_id: string }
interface Pdf { id: string; title: string; storage_path: string; unit_id: string; extracted_text: string | null; created_at: string; description?: string | null }

function AdminPage() {
  const { user } = useAuth();
  const [tab, setTab] = useState<"upload" | "structure" | "analytics">("upload");
  const [courses, setCourses] = useState<Course[]>([]);
  const [semesters, setSemesters] = useState<Semester[]>([]);
  const [subjects, setSubjects] = useState<Subject[]>([]);
  const [units, setUnits] = useState<Unit[]>([]);
  const [pdfs, setPdfs] = useState<Pdf[]>([]);
  const [selectedCourse, setSelectedCourse] = useState<string>("");
  const [selectedSemester, setSelectedSemester] = useState<string>("");
  const [selectedSubject, setSelectedSubject] = useState<string>("");
  const [selectedUnit, setSelectedUnit] = useState<string>("");

  // Add forms
  const [newCourse, setNewCourse] = useState("");
  const [newSemester, setNewSemester] = useState("");
  const [newSubject, setNewSubject] = useState("");
  const [newUnit, setNewUnit] = useState("");

  // PDF upload
  const [pdfTitle, setPdfTitle] = useState("");
  const [pdfDescription, setPdfDescription] = useState("");
  const [uploading, setUploading] = useState(false);
  const [lastUploadedTitle, setLastUploadedTitle] = useState<string | null>(null);

  // Analytics
  const [attempts, setAttempts] = useState<any[]>([]);

  // Top-level admin stat cards (always-visible overview)
  const [stats, setStats] = useState<{
    students: number;
    pdfs: number;
    quizzes: number;
    topSubject: string | null;
  }>({ students: 0, pdfs: 0, quizzes: 0, topSubject: null });

  useEffect(() => { loadCourses(); loadAdminStats(); }, []);

  const loadAdminStats = async () => {
    // Counts via head + count
    const [studentsRes, pdfsRes, quizzesRes, attemptsForSubject] = await Promise.all([
      supabase.from("user_roles").select("*", { count: "exact", head: true }).eq("role", "student"),
      supabase.from("pdfs").select("*", { count: "exact", head: true }),
      supabase.from("attempts").select("*", { count: "exact", head: true }),
      // Fetch up to 1k attempts to determine the most-attempted subject.
      supabase
        .from("attempts")
        .select("unit_id, units(subjects(name))")
        .limit(1000),
    ]);

    const counts: Record<string, number> = {};
    (attemptsForSubject.data ?? []).forEach((row: any) => {
      const name = row?.units?.subjects?.name;
      if (!name) return;
      counts[name] = (counts[name] ?? 0) + 1;
    });
    const topSubject =
      Object.entries(counts).sort((a, b) => b[1] - a[1])[0]?.[0] ?? null;

    setStats({
      students: studentsRes.count ?? 0,
      pdfs: pdfsRes.count ?? 0,
      quizzes: quizzesRes.count ?? 0,
      topSubject,
    });
  };

  const loadCourses = async () => {
    const { data } = await supabase.from("courses").select("*").order("created_at");
    setCourses((data ?? []) as Course[]);
  };

  useEffect(() => {
    if (!selectedCourse) { setSemesters([]); setSelectedSemester(""); return; }
    supabase.from("semesters").select("*").eq("course_id", selectedCourse).order("position")
      .then(({ data }) => setSemesters((data ?? []) as Semester[]));
  }, [selectedCourse]);

  useEffect(() => {
    if (!selectedSemester) { setSubjects([]); setSelectedSubject(""); return; }
    supabase.from("subjects").select("*").eq("semester_id", selectedSemester).order("name")
      .then(({ data }) => setSubjects((data ?? []) as Subject[]));
  }, [selectedSemester]);

  useEffect(() => {
    if (!selectedSubject) { setUnits([]); setSelectedUnit(""); return; }
    supabase.from("units").select("*").eq("subject_id", selectedSubject).order("position")
      .then(({ data }) => setUnits((data ?? []) as Unit[]));
  }, [selectedSubject]);

  useEffect(() => {
    if (!selectedUnit) { setPdfs([]); return; }
    supabase.from("pdfs").select("*").eq("unit_id", selectedUnit).order("created_at")
      .then(({ data }) => setPdfs((data ?? []) as Pdf[]));
  }, [selectedUnit]);

  useEffect(() => {
    if (tab !== "analytics") return;
    supabase.from("attempts")
      .select("id, score, total, difficulty, created_at, user_id, pdf_id, pdfs(title)")
      .order("created_at", { ascending: false })
      .limit(100)
      .then(({ data }) => setAttempts(data ?? []));
  }, [tab]);

  const addCourse = async () => {
    if (!newCourse.trim()) return;
    const { error } = await supabase.from("courses").insert({ name: newCourse.trim() });
    if (error) toast.error(error.message);
    else { toast.success("Course added"); setNewCourse(""); loadCourses(); }
  };

  const addSemester = async () => {
    if (!newSemester.trim() || !selectedCourse) return;
    const pos = semesters.length + 1;
    const { error } = await supabase.from("semesters").insert({ name: newSemester.trim(), course_id: selectedCourse, position: pos });
    if (error) toast.error(error.message);
    else {
      toast.success("Semester added"); setNewSemester("");
      const { data } = await supabase.from("semesters").select("*").eq("course_id", selectedCourse).order("position");
      setSemesters((data ?? []) as Semester[]);
    }
  };

  const addSubject = async () => {
    if (!newSubject.trim() || !selectedSemester) return;
    const { error } = await supabase.from("subjects").insert({ name: newSubject.trim(), semester_id: selectedSemester });
    if (error) toast.error(error.message);
    else {
      toast.success("Subject added"); setNewSubject("");
      const { data } = await supabase.from("subjects").select("*").eq("semester_id", selectedSemester).order("name");
      setSubjects((data ?? []) as Subject[]);
    }
  };

  const addUnit = async () => {
    if (!newUnit.trim() || !selectedSubject) return;
    const pos = units.length + 1;
    const { error } = await supabase.from("units").insert({ name: newUnit.trim(), subject_id: selectedSubject, position: pos });
    if (error) toast.error(error.message);
    else {
      toast.success("Unit added"); setNewUnit("");
      const { data } = await supabase.from("units").select("*").eq("subject_id", selectedSubject).order("position");
      setUnits((data ?? []) as Unit[]);
    }
  };

  const remove = async (table: "courses" | "semesters" | "subjects" | "units" | "pdfs", id: string) => {
    if (!confirm("Delete this? Child items will also be deleted.")) return;
    const { error } = await supabase.from(table).delete().eq("id", id);
    if (error) toast.error(error.message);
    else {
      toast.success("Deleted");
      if (table === "courses") loadCourses();
      else if (table === "semesters") setSemesters((s) => s.filter((x) => x.id !== id));
      else if (table === "subjects") setSubjects((s) => s.filter((x) => x.id !== id));
      else if (table === "units") setUnits((s) => s.filter((x) => x.id !== id));
      else setPdfs((s) => s.filter((x) => x.id !== id));
    }
  };

  const onUploadFile = async (file: File) => {
    if (!file) return;
    if (!selectedUnit) { toast.error("Pick a unit first"); return; }
    if (file.type !== "application/pdf") { toast.error("PDF only"); return; }
    if (file.size > 25 * 1024 * 1024) { toast.error("Max 25MB"); return; }
    const title = pdfTitle.trim() || file.name.replace(/\.pdf$/i, "");
    const description = pdfDescription.trim() || null;

    setUploading(true);
    try {
      toast.info("Extracting text from PDF…");
      const text = await extractPdfText(file);

      const path = `${selectedUnit}/${Date.now()}-${file.name}`;
      const { error: upErr } = await supabase.storage.from("pdfs").upload(path, file);
      if (upErr) throw upErr;

      const { error: insErr } = await supabase.from("pdfs").insert({
        unit_id: selectedUnit,
        title,
        description,
        storage_path: path,
        extracted_text: text,
        created_by: user!.id,
      });
      if (insErr) throw insErr;

      toast.success("PDF uploaded successfully.");
      setLastUploadedTitle(title);
      setPdfTitle("");
      setPdfDescription("");
      const { data } = await supabase.from("pdfs").select("*").eq("unit_id", selectedUnit).order("created_at");
      setPdfs((data ?? []) as Pdf[]);
    } catch (err: any) {
      toast.error("Upload failed: " + (err?.message ?? err));
    } finally {
      setUploading(false);
    }
  };

  const resetUploadFlow = () => {
    setLastUploadedTitle(null);
    setPdfTitle("");
    setPdfDescription("");
  };

  const breadcrumb = {
    course: courses.find((c) => c.id === selectedCourse)?.name,
    semester: semesters.find((s) => s.id === selectedSemester)?.name,
    subject: subjects.find((s) => s.id === selectedSubject)?.name,
    unit: units.find((u) => u.id === selectedUnit)?.name,
  };

  return (
    <div className="min-h-screen">
      <Navbar />
      <main className="mx-auto max-w-7xl px-4 py-8 sm:px-6 lg:px-8">
        <BackButton fallback="/admin" label="Back to dashboard" className="mb-3 -ml-2" />
        <div className="flex items-center justify-between flex-wrap gap-4">
          <div>
            <h1 className="text-3xl font-bold">Admin</h1>
            <p className="mt-1 text-muted-foreground">Upload study material, manage course structure, and view analytics.</p>
          </div>
          <Button asChild variant="outline"><Link to="/profile">Profile</Link></Button>
        </div>

        {/* Admin overview cards */}
        <div className="mt-6 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <AdminStatCard icon={GraduationCap} label="Total students" value={stats.students} />
          <AdminStatCard icon={BookOpen} label="PDFs uploaded" value={stats.pdfs} />
          <AdminStatCard icon={ClipboardList} label="Quizzes taken" value={stats.quizzes} />
          <AdminStatCard
            icon={TrendingUp}
            label="Most attempted subject"
            value={stats.topSubject ?? "—"}
          />
        </div>

        <div className="mt-6 inline-flex flex-wrap rounded-lg border border-border/60 bg-surface/40 p-1">
          {(["upload", "structure", "analytics"] as const).map((t) => (
            <button
              key={t}
              onClick={() => setTab(t)}
              className={cn(
                "rounded-md px-4 py-1.5 text-sm font-medium transition-all capitalize",
                tab === t ? "bg-gradient-primary text-primary-foreground shadow-glow" : "text-muted-foreground hover:text-foreground"
              )}
            >
              {t === "upload" ? "Upload PDF" : t === "structure" ? "Course structure" : "Analytics"}
            </button>
          ))}
        </div>

        {tab === "upload" && (
          <PdfUploadFlow
            courses={courses}
            semesters={semesters}
            subjects={subjects}
            units={units}
            selectedCourse={selectedCourse} setSelectedCourse={setSelectedCourse}
            selectedSemester={selectedSemester} setSelectedSemester={setSelectedSemester}
            selectedSubject={selectedSubject} setSelectedSubject={setSelectedSubject}
            selectedUnit={selectedUnit} setSelectedUnit={setSelectedUnit}
            newCourse={newCourse} setNewCourse={setNewCourse} addCourse={addCourse}
            newSemester={newSemester} setNewSemester={setNewSemester} addSemester={addSemester}
            newSubject={newSubject} setNewSubject={setNewSubject} addSubject={addSubject}
            newUnit={newUnit} setNewUnit={setNewUnit} addUnit={addUnit}
            pdfTitle={pdfTitle} setPdfTitle={setPdfTitle}
            pdfDescription={pdfDescription} setPdfDescription={setPdfDescription}
            uploading={uploading}
            onUploadFile={onUploadFile}
            breadcrumb={breadcrumb}
            lastUploadedTitle={lastUploadedTitle}
            onUploadAnother={resetUploadFlow}
            unitPdfs={pdfs}
          />
        )}

        {tab === "structure" && (
          <div className="mt-6 grid gap-6 lg:grid-cols-4">
            <Column title="Courses" addPlaceholder="New course…" addValue={newCourse} setAddValue={setNewCourse} onAdd={addCourse}>
              {courses.map((c) => (
                <Row key={c.id} label={c.name} active={selectedCourse === c.id}
                  onClick={() => setSelectedCourse(c.id)}
                  onDelete={() => remove("courses", c.id)} />
              ))}
            </Column>
            <Column title="Semesters" addPlaceholder="e.g. Sem 1" addValue={newSemester} setAddValue={setNewSemester} onAdd={addSemester} disabled={!selectedCourse}>
              {semesters.map((s) => (
                <Row key={s.id} label={s.name} active={selectedSemester === s.id}
                  onClick={() => setSelectedSemester(s.id)}
                  onDelete={() => remove("semesters", s.id)} />
              ))}
            </Column>
            <Column title="Subjects" addPlaceholder="New subject…" addValue={newSubject} setAddValue={setNewSubject} onAdd={addSubject} disabled={!selectedSemester}>
              {subjects.map((s) => (
                <Row key={s.id} label={s.name} active={selectedSubject === s.id}
                  onClick={() => setSelectedSubject(s.id)}
                  onDelete={() => remove("subjects", s.id)} />
              ))}
            </Column>
            <Column title="Units" addPlaceholder="e.g. Unit 1" addValue={newUnit} setAddValue={setNewUnit} onAdd={addUnit} disabled={!selectedSubject}>
              {units.map((u) => (
                <Row key={u.id} label={u.name} active={selectedUnit === u.id}
                  onClick={() => setSelectedUnit(u.id)}
                  onDelete={() => remove("units", u.id)} />
              ))}
            </Column>
            {selectedUnit && pdfs.length > 0 && (
              <div className="lg:col-span-4 rounded-2xl bg-gradient-card border border-border/60 p-5 shadow-card">
                <h4 className="text-sm font-semibold mb-3 text-muted-foreground uppercase tracking-wide">
                  PDFs in selected unit
                </h4>
                <div className="space-y-2">
                  {pdfs.map((p) => (
                    <div key={p.id} className="flex items-center justify-between rounded-lg border border-border/40 bg-surface/30 p-3">
                      <div className="flex items-center gap-2 min-w-0">
                        <FileText className="h-4 w-4 text-primary-glow shrink-0" />
                        <p className="truncate text-sm font-medium">{p.title}</p>
                      </div>
                      <Button variant="ghost" size="icon" onClick={() => remove("pdfs", p.id)}>
                        <Trash2 className="h-4 w-4 text-destructive" />
                      </Button>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        )}

        {tab === "analytics" && (
          <div className="mt-6">
            <AdminAnalyticsCharts />
          </div>
        )}
      </main>
    </div>
  );
}

function Column({
  title, children, addPlaceholder, addValue, setAddValue, onAdd, disabled,
}: {
  title: string; children: React.ReactNode;
  addPlaceholder: string; addValue: string; setAddValue: (v: string) => void; onAdd: () => void;
  disabled?: boolean;
}) {
  return (
    <div className="rounded-2xl bg-gradient-card border border-border/60 p-4 shadow-card">
      <h3 className="font-semibold text-sm uppercase tracking-wide text-muted-foreground mb-3">{title}</h3>
      <div className="space-y-1.5 mb-3 max-h-72 overflow-y-auto">
        {children}
      </div>
      {!disabled ? (
        <div className="flex gap-2">
          <Input className="h-9 text-sm" placeholder={addPlaceholder} value={addValue} onChange={(e) => setAddValue(e.target.value)} onKeyDown={(e) => e.key === "Enter" && onAdd()} />
          <Button size="icon" variant="hero" onClick={onAdd}><Plus className="h-4 w-4" /></Button>
        </div>
      ) : (
        <p className="text-xs text-muted-foreground">Select a parent first</p>
      )}
    </div>
  );
}

function Row({ label, active, onClick, onDelete }: { label: string; active: boolean; onClick: () => void; onDelete: () => void }) {
  return (
    <div className={cn(
      "group flex items-center justify-between rounded-md px-3 py-2 text-sm cursor-pointer transition-colors",
      active ? "bg-primary/15 text-foreground border border-primary/30" : "hover:bg-surface/40 border border-transparent"
    )} onClick={onClick}>
      <span className="flex items-center gap-1.5 truncate">
        <ChevronRight className={cn("h-3 w-3 transition-transform shrink-0", active && "rotate-90 text-primary-glow")} />
        <span className="truncate">{label}</span>
      </span>
      <button
        onClick={(e) => { e.stopPropagation(); onDelete(); }}
        className="opacity-0 group-hover:opacity-100 text-destructive hover:text-destructive/80 transition"
      >
        <Trash2 className="h-3.5 w-3.5" />
      </button>
    </div>
  );
}

/* =====================================================================
 *  PDF Upload Flow — clean step-by-step card layout
 * ===================================================================== */

interface PdfUploadFlowProps {
  courses: Course[];
  semesters: Semester[];
  subjects: Subject[];
  units: Unit[];
  selectedCourse: string; setSelectedCourse: (v: string) => void;
  selectedSemester: string; setSelectedSemester: (v: string) => void;
  selectedSubject: string; setSelectedSubject: (v: string) => void;
  selectedUnit: string; setSelectedUnit: (v: string) => void;
  newCourse: string; setNewCourse: (v: string) => void; addCourse: () => void;
  newSemester: string; setNewSemester: (v: string) => void; addSemester: () => void;
  newSubject: string; setNewSubject: (v: string) => void; addSubject: () => void;
  newUnit: string; setNewUnit: (v: string) => void; addUnit: () => void;
  pdfTitle: string; setPdfTitle: (v: string) => void;
  pdfDescription: string; setPdfDescription: (v: string) => void;
  uploading: boolean;
  onUploadFile: (file: File) => Promise<void>;
  breadcrumb: { course?: string; semester?: string; subject?: string; unit?: string };
  lastUploadedTitle: string | null;
  onUploadAnother: () => void;
  unitPdfs: Pdf[];
}

function PdfUploadFlow(p: PdfUploadFlowProps) {
  const [pendingFile, setPendingFile] = useState<File | null>(null);
  const [dragOver, setDragOver] = useState(false);

  const acceptFile = (file: File | null | undefined) => {
    if (!file) return;
    if (file.type !== "application/pdf") {
      toast.error("Only PDF files are allowed");
      return;
    }
    if (file.size > 25 * 1024 * 1024) {
      toast.error("Max file size is 25MB");
      return;
    }
    setPendingFile(file);
  };

  const fullySelected = p.selectedCourse && p.selectedSemester && p.selectedSubject && p.selectedUnit;
  const canConfirm = !!fullySelected && !!pendingFile && !p.uploading;

  const handleConfirmUpload = async () => {
    if (!canConfirm || !pendingFile) return;
    await p.onUploadFile(pendingFile);
    setPendingFile(null);
  };

  // Success screen after a successful upload
  if (p.lastUploadedTitle) {
    return (
      <div className="mt-6 rounded-3xl bg-gradient-card border border-border/60 p-8 shadow-card text-center">
        <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-2xl bg-success/15">
          <CheckCircle2 className="h-7 w-7 text-success" />
        </div>
        <h2 className="mt-4 text-2xl font-bold">PDF uploaded successfully.</h2>
        <p className="mt-1 text-sm text-muted-foreground">
          “{p.lastUploadedTitle}” is now available to students under{" "}
          <span className="text-foreground">
            {[p.breadcrumb.course, p.breadcrumb.semester, p.breadcrumb.subject, p.breadcrumb.unit]
              .filter(Boolean).join(" → ")}
          </span>.
        </p>
        <div className="mt-6 flex flex-wrap justify-center gap-3">
          <Button variant="hero" onClick={p.onUploadAnother}>
            <Upload className="h-4 w-4" /> Upload another PDF
          </Button>
        </div>
      </div>
    );
  }

  return (
    <div className="mt-6 space-y-6">
      {/* Card header */}
      <div className="rounded-3xl bg-gradient-card border border-border/60 p-6 shadow-card">
        <div className="flex items-center gap-3">
          <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-primary/15">
            <Upload className="h-5 w-5 text-primary-glow" />
          </div>
          <div>
            <h2 className="text-xl font-bold">Upload Study Material</h2>
            <p className="text-sm text-muted-foreground">
              Pick the academic path, add details, then confirm and upload.
            </p>
          </div>
        </div>
      </div>

      {/* STEP 1 — Academic details */}
      <StepCard step={1} title="Academic Details" subtitle="Select where this PDF belongs.">
        <div className="grid gap-4 sm:grid-cols-2">
          <SelectField
            label="Course"
            value={p.selectedCourse}
            onChange={p.setSelectedCourse}
            options={p.courses}
            placeholder="Select course"
            createValue={p.newCourse}
            setCreateValue={p.setNewCourse}
            onCreate={p.addCourse}
            createPlaceholder="New course name"
            createDisabled={false}
          />
          <SelectField
            label="Semester"
            value={p.selectedSemester}
            onChange={p.setSelectedSemester}
            options={p.semesters}
            placeholder={p.selectedCourse ? "Select semester" : "Pick course first"}
            disabled={!p.selectedCourse}
            createValue={p.newSemester}
            setCreateValue={p.setNewSemester}
            onCreate={p.addSemester}
            createPlaceholder="e.g. Sem 1"
            createDisabled={!p.selectedCourse}
          />
          <SelectField
            label="Subject"
            value={p.selectedSubject}
            onChange={p.setSelectedSubject}
            options={p.subjects}
            placeholder={p.selectedSemester ? "Select subject" : "Pick semester first"}
            disabled={!p.selectedSemester}
            createValue={p.newSubject}
            setCreateValue={p.setNewSubject}
            onCreate={p.addSubject}
            createPlaceholder="New subject name"
            createDisabled={!p.selectedSemester}
          />
          <SelectField
            label="Unit"
            value={p.selectedUnit}
            onChange={p.setSelectedUnit}
            options={p.units}
            placeholder={p.selectedSubject ? "Select unit" : "Pick subject first"}
            disabled={!p.selectedSubject}
            createValue={p.newUnit}
            setCreateValue={p.setNewUnit}
            onCreate={p.addUnit}
            createPlaceholder="e.g. Unit 1"
            createDisabled={!p.selectedSubject}
          />
        </div>
      </StepCard>

      {/* STEP 2 — PDF details */}
      <StepCard
        step={2}
        title="PDF Details"
        subtitle="Add a title, optional description, and the file itself."
        disabled={!fullySelected}
      >
        <div className="grid gap-4">
          <div>
            <Label htmlFor="pdf-title">PDF title</Label>
            <Input
              id="pdf-title"
              className="mt-1.5"
              placeholder="e.g. Chapter 3 — Thermodynamics"
              value={p.pdfTitle}
              onChange={(e) => p.setPdfTitle(e.target.value)}
              disabled={!fullySelected}
            />
            <p className="mt-1 text-xs text-muted-foreground">
              Defaults to the file name if left blank.
            </p>
          </div>
          <div>
            <Label htmlFor="pdf-desc">Description (optional)</Label>
            <Textarea
              id="pdf-desc"
              className="mt-1.5 min-h-[80px]"
              placeholder="A short note about this material…"
              value={p.pdfDescription}
              onChange={(e) => p.setPdfDescription(e.target.value)}
              disabled={!fullySelected}
            />
          </div>

          <label
            htmlFor="pdf-upload-input"
            onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
            onDragLeave={() => setDragOver(false)}
            onDrop={(e) => {
              e.preventDefault();
              setDragOver(false);
              if (!fullySelected) { toast.error("Pick course, semester, subject and unit first"); return; }
              acceptFile(e.dataTransfer.files?.[0]);
            }}
            className={cn(
              "flex flex-col items-center justify-center gap-2 rounded-xl border-2 border-dashed p-8 cursor-pointer transition-all text-center",
              dragOver ? "border-primary bg-primary/10" : "border-border/60 hover:border-primary/60 bg-surface/30",
              (!fullySelected || p.uploading) && "opacity-60 pointer-events-none",
            )}
          >
            <Upload className="h-8 w-8 text-primary-glow" />
            <p className="text-sm font-medium">
              {pendingFile ? "Replace file" : "Drag & drop your PDF here"}
            </p>
            <p className="text-xs text-muted-foreground">or click to browse · max 25MB</p>
            <input
              id="pdf-upload-input"
              type="file"
              accept="application/pdf"
              className="hidden"
              disabled={!fullySelected || p.uploading}
              onChange={(e) => acceptFile(e.target.files?.[0])}
            />
          </label>

          {pendingFile && (
            <div className="flex items-center gap-2 rounded-lg border border-border/40 bg-surface/40 p-3 text-sm">
              <FileText className="h-4 w-4 text-primary-glow shrink-0" />
              <div className="min-w-0 flex-1">
                <p className="truncate font-medium">{pendingFile.name}</p>
                <p className="text-xs text-muted-foreground">
                  {(pendingFile.size / 1024 / 1024).toFixed(2)} MB
                </p>
              </div>
              <button
                onClick={() => setPendingFile(null)}
                className="text-muted-foreground hover:text-destructive"
                disabled={p.uploading}
                aria-label="Remove file"
              >
                <Trash2 className="h-4 w-4" />
              </button>
            </div>
          )}
        </div>
      </StepCard>

      {/* STEP 3 — Preview & confirm */}
      <StepCard
        step={3}
        title="Preview & Confirm"
        subtitle="Review the details below, then upload."
        disabled={!fullySelected || !pendingFile}
      >
        <div className="rounded-xl border border-border/40 bg-surface/30 p-4 text-sm">
          <div className="flex flex-wrap items-center gap-1.5 text-xs text-muted-foreground">
            {[p.breadcrumb.course, p.breadcrumb.semester, p.breadcrumb.subject, p.breadcrumb.unit]
              .filter(Boolean)
              .map((seg, i, arr) => (
                <span key={i} className="flex items-center gap-1.5">
                  <span className="rounded-md bg-surface/60 border border-border/40 px-2 py-0.5 text-foreground">
                    {seg}
                  </span>
                  {i < arr.length - 1 && <ChevronRight className="h-3 w-3" />}
                </span>
              ))}
          </div>
          <div className="mt-3 grid gap-1">
            <p>
              <span className="text-muted-foreground">Title: </span>
              <span className="font-medium">
                {p.pdfTitle.trim() || pendingFile?.name.replace(/\.pdf$/i, "") || "—"}
              </span>
            </p>
            {p.pdfDescription.trim() && (
              <p>
                <span className="text-muted-foreground">Description: </span>
                <span>{p.pdfDescription.trim()}</span>
              </p>
            )}
            <p>
              <span className="text-muted-foreground">File: </span>
              <span>{pendingFile?.name ?? "—"}</span>
            </p>
          </div>
        </div>

        <Button
          variant="hero"
          size="lg"
          className="mt-5 w-full sm:w-auto"
          disabled={!canConfirm}
          onClick={handleConfirmUpload}
        >
          {p.uploading ? (
            <><Loader2 className="h-4 w-4 animate-spin" /> Processing…</>
          ) : (
            <><Upload className="h-4 w-4" /> Upload PDF</>
          )}
        </Button>
      </StepCard>

      {/* Existing PDFs in selected unit */}
      {fullySelected && (
        <div className="rounded-2xl bg-gradient-card border border-border/60 p-5 shadow-card">
          <h4 className="text-sm font-semibold mb-3 text-muted-foreground uppercase tracking-wide">
            PDFs already in this unit
          </h4>
          {p.unitPdfs.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              No PDFs uploaded for this unit yet.
            </p>
          ) : (
            <div className="space-y-2">
              {p.unitPdfs.map((pdf) => (
                <div key={pdf.id} className="flex items-center gap-2 rounded-lg border border-border/40 bg-surface/30 p-3">
                  <FileText className="h-4 w-4 text-primary-glow shrink-0" />
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-medium">{pdf.title}</p>
                    {pdf.description && (
                      <p className="truncate text-xs text-muted-foreground">{pdf.description}</p>
                    )}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function StepCard({
  step, title, subtitle, disabled, children,
}: {
  step: number; title: string; subtitle?: string; disabled?: boolean; children: React.ReactNode;
}) {
  return (
    <div className={cn(
      "rounded-3xl bg-gradient-card border border-border/60 p-6 shadow-card transition-opacity",
      disabled && "opacity-60",
    )}>
      <div className="flex items-start gap-3 mb-5">
        <div className="flex h-8 w-8 items-center justify-center rounded-full bg-gradient-primary text-primary-foreground text-sm font-bold shadow-glow shrink-0">
          {step}
        </div>
        <div>
          <h3 className="font-semibold">{title}</h3>
          {subtitle && <p className="text-xs text-muted-foreground mt-0.5">{subtitle}</p>}
        </div>
      </div>
      {children}
    </div>
  );
}

function SelectField({
  label, value, onChange, options, placeholder, disabled,
  createValue, setCreateValue, onCreate, createPlaceholder, createDisabled,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  options: { id: string; name: string }[];
  placeholder: string;
  disabled?: boolean;
  createValue: string;
  setCreateValue: (v: string) => void;
  onCreate: () => void;
  createPlaceholder: string;
  createDisabled: boolean;
}) {
  const [creating, setCreating] = useState(false);

  return (
    <div>
      <div className="flex items-center justify-between">
        <Label>{label}</Label>
        {!createDisabled && (
          <button
            type="button"
            onClick={() => setCreating((v) => !v)}
            className="text-xs text-primary-glow hover:underline"
          >
            {creating ? "Cancel" : "+ Create new"}
          </button>
        )}
      </div>
      {creating ? (
        <div className="mt-1.5 flex gap-2">
          <Input
            className="h-10"
            placeholder={createPlaceholder}
            value={createValue}
            onChange={(e) => setCreateValue(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") { e.preventDefault(); onCreate(); setCreating(false); }
            }}
            autoFocus
          />
          <Button
            type="button"
            size="icon"
            variant="hero"
            onClick={() => { onCreate(); setCreating(false); }}
          >
            <Plus className="h-4 w-4" />
          </Button>
        </div>
      ) : (
        <select
          className={cn(
            "mt-1.5 h-10 w-full rounded-md border border-border bg-background px-3 text-sm",
            "focus:outline-none focus:ring-2 focus:ring-primary/40",
            disabled && "opacity-60 cursor-not-allowed",
          )}
          disabled={disabled}
          value={value}
          onChange={(e) => onChange(e.target.value)}
        >
          <option value="">{placeholder}</option>
          {options.map((opt) => (
            <option key={opt.id} value={opt.id}>{opt.name}</option>
          ))}
        </select>
      )}
    </div>
  );
}

function AdminStatCard({
  icon: Icon,
  label,
  value,
}: {
  icon: any;
  label: string;
  value: string | number;
}) {
  return (
    <div className="rounded-2xl bg-gradient-card border border-border/60 p-5 shadow-card">
      <div className="flex items-center gap-3">
        <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-primary/20 shrink-0">
          <Icon className="h-5 w-5 text-primary-glow" />
        </div>
        <div className="min-w-0">
          <div className="text-xs text-muted-foreground">{label}</div>
          <div className="text-xl font-bold truncate">{value}</div>
        </div>
      </div>
    </div>
  );
}
