package io.knowledge.platform.knowledgebase;

import java.util.List;
import java.util.UUID;

public record KnowledgeBaseMergePlan(
        UUID sourceKnowledgeBaseId,
        String sourceName,
        UUID targetKnowledgeBaseId,
        String targetName,
        int pageCount,
        int activePageCount,
        int catalogNodeCount,
        int publicationCount,
        int memberCount,
        int activeKnowledgeBaseShareCount,
        List<KnowledgeBaseMergePath> paths,
        List<String> warnings,
        String fingerprint) {}
