import type { Component } from "solid-js";
import { For } from "solid-js";

import { UserEntry } from "./UserEntry";
import type { User } from "../../model";
import { useMessage } from "../../store/message";

export const UserBrowser: Component<{
  users: User[];
}> = (props) => {
  const [, messageActions] = useMessage();

  const sorted = () => [...props.users].sort((a, b) =>
    messageActions.getLastActivity(b.userId) - messageActions.getLastActivity(a.userId)
  );

  return (
    <div class="p-2">
      <div class="flex items-center justify-between px-2 py-1 mb-2">
        <h3 class="text-xs font-semibold text-muted-foreground uppercase">
          All Users — {props.users.length}
        </h3>
      </div>

      <For each={sorted()}>
        {(user) => (
          <UserEntry user={user} />
        )}
      </For>
    </div>
  );
};
