-- Roles
create type public.app_role as enum ('admin', 'student');

create table public.user_roles (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references auth.users(id) on delete cascade not null,
  role app_role not null,
  created_at timestamptz not null default now(),
  unique (user_id, role)
);
alter table public.user_roles enable row level security;

create or replace function public.has_role(_user_id uuid, _role app_role)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.user_roles
    where user_id = _user_id and role = _role
  )
$$;

create policy "users can view own roles" on public.user_roles
  for select to authenticated
  using (user_id = auth.uid() or public.has_role(auth.uid(), 'admin'));

create policy "admins manage roles" on public.user_roles
  for all to authenticated
  using (public.has_role(auth.uid(), 'admin'))
  with check (public.has_role(auth.uid(), 'admin'));

-- Profiles
create table public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  full_name text,
  avatar_url text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
alter table public.profiles enable row level security;

create policy "profiles viewable by owner or admin" on public.profiles
  for select to authenticated
  using (id = auth.uid() or public.has_role(auth.uid(), 'admin'));

create policy "users update own profile" on public.profiles
  for update to authenticated
  using (id = auth.uid())
  with check (id = auth.uid());

create policy "users insert own profile" on public.profiles
  for insert to authenticated
  with check (id = auth.uid());

-- Trigger: auto-create profile + default student role on signup
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.profiles (id, full_name)
  values (new.id, coalesce(new.raw_user_meta_data->>'full_name', split_part(new.email, '@', 1)));

  insert into public.user_roles (user_id, role)
  values (new.id, 'student')
  on conflict do nothing;

  return new;
end;
$$;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- Course hierarchy
create table public.courses (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  description text,
  created_at timestamptz not null default now()
);
alter table public.courses enable row level security;

create table public.semesters (
  id uuid primary key default gen_random_uuid(),
  course_id uuid references public.courses(id) on delete cascade not null,
  name text not null,
  position int not null default 1,
  created_at timestamptz not null default now()
);
alter table public.semesters enable row level security;

create table public.subjects (
  id uuid primary key default gen_random_uuid(),
  semester_id uuid references public.semesters(id) on delete cascade not null,
  name text not null,
  created_at timestamptz not null default now()
);
alter table public.subjects enable row level security;

create table public.units (
  id uuid primary key default gen_random_uuid(),
  subject_id uuid references public.subjects(id) on delete cascade not null,
  name text not null,
  position int not null default 1,
  created_at timestamptz not null default now()
);
alter table public.units enable row level security;

-- PDFs
create table public.pdfs (
  id uuid primary key default gen_random_uuid(),
  unit_id uuid references public.units(id) on delete cascade not null,
  title text not null,
  storage_path text not null,
  extracted_text text,
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now()
);
alter table public.pdfs enable row level security;

-- Quiz questions (cached AI generated, per pdf+difficulty)
create type public.difficulty as enum ('beginner', 'intermediate', 'pro');

create table public.quiz_questions (
  id uuid primary key default gen_random_uuid(),
  pdf_id uuid references public.pdfs(id) on delete cascade not null,
  difficulty difficulty not null,
  question text not null,
  options jsonb not null,
  correct_index int not null,
  explanation text not null,
  created_at timestamptz not null default now()
);
alter table public.quiz_questions enable row level security;

create index on public.quiz_questions (pdf_id, difficulty);

-- Attempts
create table public.attempts (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references auth.users(id) on delete cascade not null,
  pdf_id uuid references public.pdfs(id) on delete cascade not null,
  unit_id uuid references public.units(id) on delete cascade not null,
  difficulty difficulty not null,
  score int not null,
  total int not null,
  details jsonb,
  created_at timestamptz not null default now()
);
alter table public.attempts enable row level security;

create index on public.attempts (user_id, created_at desc);

-- Read policies: any authenticated user can browse the structure
create policy "auth view courses" on public.courses for select to authenticated using (true);
create policy "auth view semesters" on public.semesters for select to authenticated using (true);
create policy "auth view subjects" on public.subjects for select to authenticated using (true);
create policy "auth view units" on public.units for select to authenticated using (true);
create policy "auth view pdfs" on public.pdfs for select to authenticated using (true);
create policy "auth view questions" on public.quiz_questions for select to authenticated using (true);

-- Admin manage policies
create policy "admin manage courses" on public.courses for all to authenticated
  using (public.has_role(auth.uid(),'admin')) with check (public.has_role(auth.uid(),'admin'));
create policy "admin manage semesters" on public.semesters for all to authenticated
  using (public.has_role(auth.uid(),'admin')) with check (public.has_role(auth.uid(),'admin'));
create policy "admin manage subjects" on public.subjects for all to authenticated
  using (public.has_role(auth.uid(),'admin')) with check (public.has_role(auth.uid(),'admin'));
create policy "admin manage units" on public.units for all to authenticated
  using (public.has_role(auth.uid(),'admin')) with check (public.has_role(auth.uid(),'admin'));
create policy "admin manage pdfs" on public.pdfs for all to authenticated
  using (public.has_role(auth.uid(),'admin')) with check (public.has_role(auth.uid(),'admin'));
create policy "admin manage questions" on public.quiz_questions for all to authenticated
  using (public.has_role(auth.uid(),'admin')) with check (public.has_role(auth.uid(),'admin'));

-- Attempts: students see their own, admins see all
create policy "students view own attempts" on public.attempts for select to authenticated
  using (user_id = auth.uid() or public.has_role(auth.uid(),'admin'));
create policy "students insert own attempts" on public.attempts for insert to authenticated
  with check (user_id = auth.uid());

-- Storage buckets
insert into storage.buckets (id, name, public) values ('pdfs', 'pdfs', false)
  on conflict (id) do nothing;
insert into storage.buckets (id, name, public) values ('avatars', 'avatars', true)
  on conflict (id) do nothing;

-- PDFs storage policies
create policy "auth read pdfs" on storage.objects for select to authenticated
  using (bucket_id = 'pdfs');
create policy "admin upload pdfs" on storage.objects for insert to authenticated
  with check (bucket_id = 'pdfs' and public.has_role(auth.uid(),'admin'));
create policy "admin update pdfs" on storage.objects for update to authenticated
  using (bucket_id = 'pdfs' and public.has_role(auth.uid(),'admin'));
create policy "admin delete pdfs" on storage.objects for delete to authenticated
  using (bucket_id = 'pdfs' and public.has_role(auth.uid(),'admin'));

-- Avatars storage policies (public bucket, users manage own)
create policy "public read avatars" on storage.objects for select to public
  using (bucket_id = 'avatars');
create policy "users upload own avatar" on storage.objects for insert to authenticated
  with check (bucket_id = 'avatars' and (storage.foldername(name))[1] = auth.uid()::text);
create policy "users update own avatar" on storage.objects for update to authenticated
  using (bucket_id = 'avatars' and (storage.foldername(name))[1] = auth.uid()::text);
create policy "users delete own avatar" on storage.objects for delete to authenticated
  using (bucket_id = 'avatars' and (storage.foldername(name))[1] = auth.uid()::text);