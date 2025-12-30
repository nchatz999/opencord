import { createStore } from "solid-js/store";
import { createRoot } from "solid-js";

export type ModalType =
  | { type: "createGroup" }
  | { type: "createChannel"; groupId: number }
  | { type: "channelSettings"; channelId: number }
  | { type: "groupSettings"; groupId: number }
  | { type: "userSettings" }
  | { type: "roleSettings"; roleId: number }
  | { type: "createRole" }
  | { type: "serverSettings" }
  | null;

interface ModalState {
  modal: ModalType;
}

interface ModalActions {
  getCurrent: () => ModalType;
  open: (modal: ModalType) => void;
  close: () => void;
}

export type ModalStore = [ModalState, ModalActions];

function createModalStore(): ModalStore {
  const [state, setState] = createStore<ModalState>({
    modal: null,
  });

  const actions: ModalActions = {
    getCurrent() {
      return state.modal;
    },

    open(modal) {
      setState("modal", modal);
    },

    close() {
      setState("modal", null);
    },
  };

  return [state, actions];
}

let instance: ModalStore | null = null;

export function useModal(): ModalStore {
  if (!instance) {
    createRoot(() => {
      instance = createModalStore();
    });
  }
  return instance!;
}
