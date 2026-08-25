package io.knowledge.platform.quicknoteapi;

import java.util.Set;
import java.util.UUID;
import tools.jackson.databind.JsonNode;

final class QuickNoteRequests {

    private QuickNoteRequests() {}

    record ListNotes(String status, UUID tagId, String query, Integer limit, Integer offset) {}

    record Create(
            UUID workspaceId,
            JsonNode content,
            String plainText,
            String source,
            UUID clientRequestId,
            Set<UUID> tagIds) {}

    record Save(
            UUID quickNoteId,
            long expectedRevision,
            JsonNode content,
            String plainText,
            String kind) {}

    record Id(UUID quickNoteId) {}

    record Archive(UUID quickNoteId, boolean archived) {}

    record Batch(Set<UUID> quickNoteIds, String operation, Set<UUID> tagIds) {}

    record Convert(
            Set<UUID> quickNoteIds,
            UUID knowledgeBaseId,
            String title,
            String path) {}

    record History(UUID quickNoteId, Integer limit, Integer offset) {}

    record RestoreRevision(UUID quickNoteId, long revision) {}

    record TagCreate(String name, String color) {}

    record TagUpdate(UUID tagId, String name, String color) {}

    record TagDelete(UUID tagId) {}
}
