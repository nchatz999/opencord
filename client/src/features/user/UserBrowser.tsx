import type { Component } from "solid-js";
import { For } from "solid-js";

import { UserEntry } from "./UserEntry";
import type { User } from "../../model";

export const UserBrowser: Component<{
  users: User[];
}> = (props) => {
  return (
    <div class="p-2">
      <div class="flex items-center justify-between px-2 py-1 mb-2">
        <h3 class="text-xs font-semibold text-muted-foreground uppercase">
          All Users — {props.users.length}
        </h3>
      </div>

      <For each={props.users}>
        {(user) => (
          <UserEntry user={user} />
        )}
      </For>
    </div>
  );
};
