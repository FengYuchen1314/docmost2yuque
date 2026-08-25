package io.knowledge.platform.searchapi;

import java.time.OffsetDateTime;
import java.util.Set;
import java.util.UUID;

final class SearchRequests {

    private SearchRequests() {}

    record Internal(
            UUID workspaceId,
            String query,
            Set<String> resourceTypes,
            UUID knowledgeBaseId,
            UUID creatorId,
            OffsetDateTime updatedFrom,
            OffsetDateTime updatedTo,
            Integer offset,
            Integer limit) {}

    record Public(
            UUID workspaceId,
            String query,
            Integer offset,
            Integer limit) {}

    record RebuildStart(UUID workspaceId) {}
    record RebuildTask(UUID rebuildId, Integer batchSize) {}
    record RebuildList(UUID workspaceId, Integer limit, Integer offset) {}
}
