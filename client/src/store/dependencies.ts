// ============================================================================
// Declarative Dependency Graph
// ============================================================================
// All entity relationships are defined here in one place.
// When an entity is removed, the system automatically cascades deletions
// to dependent entities based on this graph.

import { usePlayback } from "./playback";

// ============================================================================
// Types
// ============================================================================

type CascadeTarget = {
  entity: string;
  foreignKey: string;
};

type SideEffect<K> = (id: K) => void;

export type EntityDependency<K = unknown> = {
  cascadeTo?: CascadeTarget[];
  onAdd?: SideEffect<K>;
  onRemove?: SideEffect<K>;
};

// ============================================================================
// Dependency Graph
// ============================================================================
// This graph defines:
// 1. cascadeTo: When this entity is removed, remove related entities by foreignKey
// 2. onAdd: Side effect to run when an entity is added
// 3. onRemove: Side effect to run when an entity is removed

export const dependencyGraph: Record<string, EntityDependency<unknown>> = {
  group: {
    cascadeTo: [
      { entity: "channel", foreignKey: "groupId" },
      { entity: "acl", foreignKey: "groupId" },
    ],
  },
  channel: {
    cascadeTo: [
      { entity: "message", foreignKey: "channelId" },
      { entity: "voip", foreignKey: "channelId" },
    ],
  },
  voip: {
    onAdd: (userId) => {
      const [, playbackActions] = usePlayback();
      playbackActions.initializeForUser(userId as number);
    },
    onRemove: (userId) => {
      const [, playbackActions] = usePlayback();
      playbackActions.cleanupForUser(userId as number);
    },
  },
};
