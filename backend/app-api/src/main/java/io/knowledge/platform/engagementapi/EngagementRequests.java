package io.knowledge.platform.engagementapi;

import java.util.Set;
import java.util.UUID;
import tools.jackson.databind.JsonNode;

final class EngagementRequests {

    private EngagementRequests() {}

    record Page(UUID pageId) {}

    record Favorite(UUID pageId, boolean favorite) {}

    record CommentList(UUID pageId, Integer limit, Integer offset) {}

    record CommentCreate(
            UUID pageId,
            UUID parentId,
            JsonNode anchor,
            JsonNode body,
            String plainText,
            Set<UUID> mentionedUserIds) {}

    record CommentUpdate(UUID commentId, JsonNode body, String plainText) {}

    record CommentResolve(UUID commentId, boolean resolved) {}

    record CommentDelete(UUID commentId) {}

    record NotificationList(Boolean unreadOnly, String category, Integer offset, Integer limit) {}

    record NotificationRead(UUID notificationId) {}

    record WorkbenchList(String reason, Integer offset, Integer limit) {}
}
