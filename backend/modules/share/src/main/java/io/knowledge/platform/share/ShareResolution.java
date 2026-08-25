package io.knowledge.platform.share;

import io.knowledge.platform.publication.PagePublicationView;
import java.util.UUID;
import tools.jackson.databind.JsonNode;

public record ShareResolution(
        ShareView share,
        boolean passwordRequired,
        boolean approvalRequired,
        String approvalStatus,
        PagePublicationView publication,
        JsonNode appearanceConfig,
        JsonNode watermarkConfig,
        KnowledgeBaseShareView knowledgeBase,
        QuickNoteShareView quickNote,
        boolean acceptanceRequired,
        UUID destinationKnowledgeBaseId) {}
