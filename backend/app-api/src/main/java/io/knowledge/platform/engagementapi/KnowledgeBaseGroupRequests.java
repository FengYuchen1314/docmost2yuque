package io.knowledge.platform.engagementapi;

import java.util.List;
import java.util.UUID;

final class KnowledgeBaseGroupRequests {

    private KnowledgeBaseGroupRequests() {}

    record Workspace(UUID workspaceId) {}

    record Create(UUID workspaceId, String name) {}

    record Rename(UUID groupId, String name) {}

    record Group(UUID groupId) {}

    record Reorder(UUID workspaceId, List<UUID> orderedGroupIds) {}

    record MoveItem(UUID groupId, UUID knowledgeBaseId) {}

    record RemoveItem(UUID knowledgeBaseId) {}

    record ReorderItems(UUID groupId, List<UUID> orderedKnowledgeBaseIds) {}
}
