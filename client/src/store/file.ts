import { createStore, produce } from "solid-js/store";
import { createRoot } from "solid-js";
import type { File } from "../model";
import type { Result } from "opencord-utils";
import { ok, err } from "opencord-utils";
import { request } from "../utils";

interface FileState {
  files: File[];
}

interface FileActions {
  list: () => File[];
  findById: (id: number) => File | undefined;
  replaceAll: (files: File[]) => void;
  add: (file: File) => void;
  fetchFiles: (
    contextType: "channel" | "dm",
    contextId: number,
    limit: number,
    timestamp: string
  ) => Promise<Result<File[], string>>;
  downloadFile: (fileId: number) => Promise<Result<Blob, string>>;
}

export type FileStore = [FileState, FileActions];

function createFileStore(): FileStore {
  const [state, setState] = createStore<FileState>({
    files: [],
  });

  const actions: FileActions = {
    list() {
      return state.files;
    },

    findById(id) {
      return state.files.find((f) => f.fileId === id);
    },

    replaceAll(files) {
      setState("files", files);
    },

    add(file) {
      setState(
        "files",
        produce((files) => {
          files.push(file);
        })
      );
    },

    async fetchFiles(contextType, contextId, limit, timestamp) {
      const endpoint =
        contextType === "dm"
          ? `/message/dm/${contextId}/files`
          : `/message/channel/${contextId}/files`;

      const result = await request<File[]>(endpoint, {
        method: "GET",
        query: { limit, timestamp },
      });

      if (result.isErr()) {
        return err(result.error.reason);
      }

      for (const file of result.value) {
        actions.add(file);
      }

      return ok(result.value);
    },

    async downloadFile(fileId) {
      const result = await request<Blob>(`/message/files/${fileId}`, {
        method: "GET",
        responseType: "blob",
      });

      if (result.isErr()) {
        return err(result.error.reason);
      }

      return ok(result.value);
    },
  };

  return [state, actions];
}

let instance: FileStore | null = null;

export function useFile(): FileStore {
  if (!instance) {
    createRoot(() => {
      instance = createFileStore();
    });
  }
  return instance!;
}
