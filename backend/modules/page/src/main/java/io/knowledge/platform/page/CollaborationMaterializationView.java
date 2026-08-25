package io.knowledge.platform.page;

public record CollaborationMaterializationView(
        boolean applied,
        long sequence,
        long draftRevision) {}
