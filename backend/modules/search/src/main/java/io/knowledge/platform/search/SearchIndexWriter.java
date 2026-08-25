package io.knowledge.platform.search;

import java.time.Clock;
import java.time.OffsetDateTime;
import java.util.Locale;
import java.util.Set;
import java.util.UUID;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;
import tools.jackson.databind.ObjectMapper;

@Service
public class SearchIndexWriter {

    private static final Set<String> RESOURCE_TYPES = Set.of(
            "PAGE", "KNOWLEDGE_BASE", "QUICK_NOTE", "TEMPLATE", "USER", "TEAM", "ATTACHMENT");
    private static final Set<String> SCOPES = Set.of("DRAFT", "PUBLISHED", "CANONICAL");
    private static final Set<String> VISIBILITIES = Set.of("PRIVATE", "WORKSPACE", "PUBLIC");
    private final SearchRepository repository;
    private final ObjectMapper objectMapper;
    private final Clock clock;

    public SearchIndexWriter(
            SearchRepository repository,
            ObjectMapper objectMapper,
            Clock clock) {
        this.repository = repository;
        this.objectMapper = objectMapper;
        this.clock = clock;
    }

    @Transactional
    public void upsert(SearchDocumentCommand command) {
        validate(command);
        repository.upsert(
                normalized(command),
                OffsetDateTime.now(clock),
                objectMapper);
    }

    @Transactional
    public void delete(UUID documentId) {
        if (documentId != null) {
            repository.delete(documentId);
        }
    }

    @Transactional
    public void deletePublications(UUID resourceId) {
        if (resourceId != null) {
            repository.deletePublications(resourceId);
        }
    }

    @Transactional
    public void deleteKnowledgeBase(UUID knowledgeBaseId) {
        if (knowledgeBaseId != null) {
            repository.deleteKnowledgeBase(knowledgeBaseId);
        }
    }

    @Transactional
    public void updateLabels(
            UUID workspaceId,
            String resourceType,
            UUID resourceId,
            java.util.List<String> requestedLabels,
            OffsetDateTime sourceUpdatedAt) {
        if (workspaceId == null
                || resourceId == null
                || resourceType == null
                || !RESOURCE_TYPES.contains(resourceType.toUpperCase(Locale.ROOT))
                || sourceUpdatedAt == null) {
            throw new IllegalArgumentException("Search label update is invalid");
        }
        String[] labels = (requestedLabels == null ? java.util.List.<String>of() : requestedLabels)
                .stream()
                .filter(value -> value != null && !value.isBlank())
                .map(String::trim)
                .distinct()
                .limit(100)
                .toArray(String[]::new);
        repository.updateLabels(
                workspaceId,
                resourceType.toUpperCase(Locale.ROOT),
                resourceId,
                labels,
                sourceUpdatedAt,
                OffsetDateTime.now(clock));
    }

    @Transactional
    public void updatePagePublicationStatus(UUID pageId, String status) {
        if (pageId == null || !Set.of("UNPUBLISHED", "PUBLISHED", "CHANGED").contains(status)) {
            throw new IllegalArgumentException("Page publication search status is invalid");
        }
        repository.updatePagePublicationStatus(pageId, status, OffsetDateTime.now(clock));
    }

    private static SearchDocumentCommand normalized(SearchDocumentCommand command) {
        return new SearchDocumentCommand(
                command.id(),
                command.workspaceId(),
                command.resourceType().toUpperCase(Locale.ROOT),
                command.resourceId(),
                command.sourceScope().toUpperCase(Locale.ROOT),
                command.title().trim(),
                command.body() == null ? "" : command.body(),
                command.labels() == null ? java.util.List.of() : command.labels(),
                blankToNull(command.path()),
                command.ownerId(),
                blankToNull(command.contentType()),
                command.visibility().toUpperCase(Locale.ROOT),
                command.publicationId(),
                Math.max(0, command.permissionVersion()),
                command.metadata(),
                command.sourceCreatedAt(),
                command.sourceUpdatedAt());
    }

    private static void validate(SearchDocumentCommand command) {
        if (command == null
                || command.id() == null
                || command.workspaceId() == null
                || command.resourceId() == null
                || command.title() == null
                || command.title().isBlank()
                || command.title().length() > 500
                || command.sourceCreatedAt() == null
                || command.sourceUpdatedAt() == null
                || !RESOURCE_TYPES.contains(command.resourceType().toUpperCase(Locale.ROOT))
                || !SCOPES.contains(command.sourceScope().toUpperCase(Locale.ROOT))
                || !VISIBILITIES.contains(command.visibility().toUpperCase(Locale.ROOT))) {
            throw new IllegalArgumentException("Search document is invalid");
        }
        boolean publication = "PUBLISHED".equalsIgnoreCase(command.sourceScope());
        if (publication != (command.publicationId() != null)) {
            throw new IllegalArgumentException("Search publication identity is invalid");
        }
    }

    private static String blankToNull(String value) {
        return value == null || value.isBlank() ? null : value.trim();
    }
}
