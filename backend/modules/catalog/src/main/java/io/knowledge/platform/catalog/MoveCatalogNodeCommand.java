package io.knowledge.platform.catalog;

import java.util.UUID;

public record MoveCatalogNodeCommand(
        UUID nodeId,
        UUID targetParentId,
        UUID beforeNodeId,
        UUID afterNodeId,
        long expectedRevision) {}
