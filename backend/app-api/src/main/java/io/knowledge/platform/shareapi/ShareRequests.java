package io.knowledge.platform.shareapi;

import java.time.OffsetDateTime;
import java.util.UUID;
import tools.jackson.databind.JsonNode;

final class ShareRequests {

    private ShareRequests() {}

    record Resource(String resourceType, UUID resourceId, UUID pageId) {}

    record Id(UUID shareId) {}

    record Create(
            String resourceType,
            UUID resourceId,
            UUID pageId,
            String shareType,
            String password,
            String role,
            Boolean requireApproval,
            OffsetDateTime expiresAt,
            Boolean allowCopy,
            Boolean allowDownload,
            Boolean allowExport,
            Boolean allowComment,
            Boolean allowSearchIndex) {}

    record Update(
            UUID shareId,
            String password,
            boolean clearPassword,
            String role,
            Boolean requireApproval,
            OffsetDateTime expiresAt,
            Boolean allowCopy,
            Boolean allowDownload,
            Boolean allowExport,
            Boolean allowComment,
            Boolean allowSearchIndex) {}

    record Resolve(String token, String accessToken, UUID pageId) {}

    record VerifyPassword(String token, String password) {}

    record RequestJoin(String token, String accessToken, String message) {}

    record AcceptInvite(String token, String accessToken) {}

    record ListRequests(UUID shareId) {}

    record ReviewRequest(UUID requestId, String decision) {}

    record CommentList(String token, String accessToken, UUID pageId, Integer limit, Integer offset) {}

    record CommentCreate(
            String token,
            String accessToken,
            UUID pageId,
            UUID parentId,
            JsonNode anchor,
            JsonNode body,
            String plainText) {}

    record CommentDelete(String token, String accessToken, UUID pageId, UUID commentId) {}
}
