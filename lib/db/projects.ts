import { db } from "./index";
import type { Project } from "./schema";

// SQLite stores study_enabled as INTEGER (0/1); Project.study_enabled is
// boolean. Map every row through this so consumers get a real boolean.
type ProjectRow = Omit<Project, "study_enabled"> & { study_enabled: number };
function coerce(row: ProjectRow | undefined): Project | undefined {
  if (!row) return undefined;
  return { ...row, study_enabled: row.study_enabled === 1 };
}

export function listProjects(): Project[] {
  const rows = db.prepare("SELECT * FROM projects ORDER BY created_at DESC").all() as ProjectRow[];
  return rows.map((row) => coerce(row)!);
}

export function getProject(id: string): Project | undefined {
  return coerce(db.prepare("SELECT * FROM projects WHERE id = ?").get(id) as ProjectRow | undefined);
}

export function createProject(name: string, studyEnabled = false): Project {
  const row: Project = {
    id: crypto.randomUUID(),
    name,
    created_at: Date.now(),
    study_enabled: studyEnabled,
  };
  db.prepare("INSERT INTO projects (id, name, created_at, study_enabled) VALUES (?, ?, ?, ?)").run(
    row.id, row.name, row.created_at, row.study_enabled ? 1 : 0,
  );
  return row;
}

export function renameProject(id: string, name: string): void {
  db.prepare("UPDATE projects SET name = ? WHERE id = ?").run(name, id);
}

export function setProjectStudyEnabled(id: string, studyEnabled: boolean): void {
  db.prepare("UPDATE projects SET study_enabled = ? WHERE id = ?").run(studyEnabled ? 1 : 0, id);
}

export function deleteProject(id: string): void {
  // ON DELETE CASCADE drops materials+chunks; conversations.project_id SET NULL.
  db.prepare("DELETE FROM projects WHERE id = ?").run(id);
}