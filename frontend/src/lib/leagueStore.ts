import { promises as fs } from 'fs';
import path from 'path';

type WeekStatus = 'pre' | 'live' | 'final';
type Pairing = { away?: { owner: `0x${string}`; name: string }; home?: { owner: `0x${string}`; name: string }; bye?: `0x${string}` | null };
type ScheduleBlob = { pairings: Record<number, Pairing[]>; status: Record<number, WeekStatus> };

const DATA_DIR   = path.join(process.cwd(), 'data');
const SCHED_FILE = path.join(DATA_DIR, 'league-schedules.json');
const SCORES_FILE= path.join(DATA_DIR, 'league-scores.json');

async function ensureFiles() {
  await fs.mkdir(DATA_DIR, { recursive: true });
  try { await fs.access(SCHED_FILE); } catch { await fs.writeFile(SCHED_FILE, '{}', { encoding:'utf8', mode:0o600 }); }
  try { await fs.access(SCORES_FILE);} catch { await fs.writeFile(SCORES_FILE,'{}', { encoding:'utf8', mode:0o600 }); }
}

async function readJson<T>(file: string): Promise<T> {
  await ensureFiles();
  const raw = await fs.readFile(file, 'utf8');
  try { return JSON.parse(raw) as T; } catch { return {} as T; }
}

async function writeJson(file: string, data: any) {
  await ensureFiles();
  const tmp = file + '.tmp';
  await fs.writeFile(tmp, JSON.stringify(data, null, 2), { encoding:'utf8', mode:0o600 });
  await fs.rename(tmp, file); // atomic swap
}

export async function getStore() {
  return {
    async getSchedule(leagueLc: string): Promise<ScheduleBlob | null> {
      const db = await readJson<Record<string, ScheduleBlob>>(SCHED_FILE);
      return db[leagueLc] ?? null;
    },
    async setSchedule(leagueLc: string, blob: ScheduleBlob): Promise<void> {
      const db = await readJson<Record<string, ScheduleBlob>>(SCHED_FILE);
      db[leagueLc] = blob || { pairings:{}, status:{} };
      await writeJson(SCHED_FILE, db);
    },
    async getScores(leagueLc: string, week: number): Promise<Record<string, any> | null> {
      const db = await readJson<Record<string, any>>(SCORES_FILE);
      return db[`${leagueLc}:${week}`] ?? null;
    },
    async setScores(leagueLc: string, week: number, scores: Record<string, any>): Promise<void> {
      const db = await readJson<Record<string, any>>(SCORES_FILE);
      db[`${leagueLc}:${week}`] = scores || {};
      await writeJson(SCORES_FILE, db);
    },
  };
}
