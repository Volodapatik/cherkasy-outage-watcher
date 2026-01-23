import fs from "fs/promises";
import path from "path";

export const dataDir = path.resolve(process.cwd(), "data");

export async function ensureDataDir() {
  await fs.mkdir(dataDir, { recursive: true });
}

export function resolveDataPath(fileName: string) {
  return path.join(dataDir, fileName);
}

export async function readJsonFile<T>(filePath: string, fallback: T): Promise<T> {
  try {
    const raw = await fs.readFile(filePath, "utf-8");
    return JSON.parse(raw) as T;
  } catch {
    return fallback;
  }
}

export async function atomicWriteJson(filePath: string, data: unknown) {
  const tempPath = `${filePath}.tmp`;
  const payload = JSON.stringify(data, null, 2);
  await fs.writeFile(tempPath, payload, "utf-8");
  await fs.rename(tempPath, filePath);
}
