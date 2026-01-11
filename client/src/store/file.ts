import { createStore } from "solid-js/store";
import { createRoot } from "solid-js";
import type { File } from "../model";
import type { Result } from "opencord-utils";
import { ok, err } from "opencord-utils";
import { request } from "../utils";
import { useConnection } from "./connection";

interface FileState {
    files: File[];
}

interface FileActions {
    init: () => Promise<Result<void, string>>;
    cleanup: () => void;
    list: () => File[];
    findById: (id: number) => File | undefined;
    replaceAll: (files: File[]) => void;
    add: (file: File) => void;
    removeByMessageId: (messageId: number) => void;
    downloadFile: (fileId: number) => Promise<Result<Blob, string>>;
}

export type FileStore = [FileState, FileActions];

function createFileStore(): FileStore {
    const [state, setState] = createStore<FileState>({
        files: [],
    });

    const connection = useConnection();
    let cleanupFn: (() => void) | null = null;

    const actions: FileActions = {
        async init() {
            actions.cleanup();

            cleanupFn = connection.onServerEvent((event) => {
                if (event.type === "messageDeleted") {
                    actions.removeByMessageId(event.messageId);
                }
            });

            return ok(undefined);
        },

        cleanup() {
            if (cleanupFn) {
                cleanupFn();
                cleanupFn = null;
            }
            setState("files", []);
        },

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
            setState("files", (files) => [...files, file]);
        },

        removeByMessageId(messageId) {
            setState("files", (files) => files.filter((f) => f.messageId !== messageId));
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
