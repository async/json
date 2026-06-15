import {
  appendFile,
  mkdir as nodeMkdir,
  open,
  readFile,
  readdir,
  rename,
  rm,
  stat,
  writeFile,
} from 'node:fs/promises';

export type JsonFileSystemDirent = {
  name: string;
  isFile(): boolean;
  isDirectory(): boolean;
};

export type JsonFileSystemStats = {
  mtimeMs: number;
  isFile?(): boolean;
  isDirectory?(): boolean;
};

export type JsonFileSystem = {
  readFile(path: string, encoding: BufferEncoding): Promise<string | Buffer>;
  writeFile(path: string, data: string | Uint8Array, encoding?: BufferEncoding): Promise<void>;
  appendFile?: (path: string, data: string | Uint8Array, encoding?: BufferEncoding) => Promise<void>;
  mkdir(path: string, options?: { recursive?: boolean }): Promise<void>;
  readdir(path: string, options?: { withFileTypes?: false }): Promise<string[]>;
  readdir(path: string, options: { withFileTypes: true }): Promise<JsonFileSystemDirent[]>;
  rename(oldPath: string, newPath: string): Promise<void>;
  rm(path: string, options?: { recursive?: boolean; force?: boolean }): Promise<void>;
  stat?(path: string): Promise<JsonFileSystemStats>;
  fsync?: (path: string) => Promise<void>;
};

export const nodeFileSystem: JsonFileSystem = {
  readFile,
  writeFile: async (filePath, data, encoding = 'utf8') => {
    await writeFile(filePath, data, encoding);
  },
  appendFile: async (filePath, data, encoding = 'utf8') => {
    await appendFile(filePath, data, encoding);
  },
  mkdir: async (directoryPath, options) => {
    await nodeMkdir(directoryPath, options);
  },
  readdir: readdir as JsonFileSystem['readdir'],
  rename,
  rm,
  stat,
  async fsync(filePath: string) {
    const handle = await open(filePath, 'r');
    try {
      await handle.sync();
    } finally {
      await handle.close();
    }
  },
};

export function jsonFileSystem(fs?: JsonFileSystem): JsonFileSystem {
  return fs ?? nodeFileSystem;
}
