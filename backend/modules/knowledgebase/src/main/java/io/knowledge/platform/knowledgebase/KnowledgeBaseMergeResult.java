package io.knowledge.platform.knowledgebase;

import java.time.OffsetDateTime;
import java.util.List;
import java.util.UUID;

public record KnowledgeBaseMergeResult(
        UUID mergeId,
        UUID sourceKnowledgeBaseId,
        UUID targetKnowledgeBaseId,
        int movedPages,
        int movedCatalogNodes,
        int mergedMembers,
        int revokedKnowledgeBaseShares,
        long targetCatalogRevision,
        List<KnowledgeBaseMergePath> paths,
        List<String> warnings,
        OffsetDateTime completedAt,
        boolean replayed) {}
