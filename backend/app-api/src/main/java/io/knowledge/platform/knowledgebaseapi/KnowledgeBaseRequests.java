package io.knowledge.platform.knowledgebaseapi;

import java.util.UUID;

final class KnowledgeBaseRequests {

    private KnowledgeBaseRequests() {}

    record WorkspaceId(UUID workspaceId) {}

    record KnowledgeBaseId(UUID knowledgeBaseId) {}

    record Create(
            UUID workspaceId,
            String name,
            String slug,
            String description,
            String icon,
            String ownerType,
            UUID ownerId,
            String visibility,
            Boolean allowPublicIndex,
            String publishMode) {}

    record Update(
            UUID knowledgeBaseId,
            String name,
            String slug,
            String description,
            String icon,
            String visibility,
            Boolean allowPublicIndex,
            String publishMode,
            String watermarkConfig,
            String appearanceConfig,
            String catalogConfig,
            UUID homepagePageId) {}

    record Transfer(UUID knowledgeBaseId, String ownerType, UUID ownerId) {}

    record MergePlan(UUID sourceKnowledgeBaseId, UUID targetKnowledgeBaseId) {}

    record MergeExecute(
            UUID sourceKnowledgeBaseId,
            UUID targetKnowledgeBaseId,
            String planFingerprint,
            String idempotencyKey) {}

    record Member(UUID knowledgeBaseId, UUID userId, String role) {}
}
