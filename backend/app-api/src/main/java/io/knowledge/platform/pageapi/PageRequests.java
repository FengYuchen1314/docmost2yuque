package io.knowledge.platform.pageapi;

import io.knowledge.platform.page.ContentType;
import io.knowledge.platform.page.PageLabelInput;
import java.util.List;
import java.util.UUID;
import tools.jackson.databind.JsonNode;

final class PageRequests {

    private PageRequests() {}

    record Id(UUID pageId) {}

    record Ids(List<UUID> pageIds) {}

    record ListPages(UUID knowledgeBaseId) {}

    record Workspace(UUID workspaceId) {}

    record TrashPage(String query, Integer offset, Integer limit) {}

    record Create(
            UUID knowledgeBaseId,
            String title,
            String path,
            ContentType contentType,
            String icon,
            String cover,
            String publishMode,
            String visibilityOverride,
            JsonNode documentSettings,
            JsonNode content) {}

    record Update(
            UUID pageId,
            long expectedRevision,
            String title,
            String path,
            String icon,
            String cover,
            String publishMode,
            String visibilityOverride,
            JsonNode documentSettings,
            JsonNode content,
            Integer schemaVersion,
            String revisionKind,
            String revisionDescription) {}

    record History(UUID pageId, Integer limit, Integer offset) {}

    record CopyHistory(UUID pageId, long revisionNo, String title, String path) {}

    record Copy(UUID pageId, UUID targetKnowledgeBaseId, String title, String path) {}

    record Labels(UUID pageId, Long expectedRevision, List<PageLabelInput> labels) {}
}
