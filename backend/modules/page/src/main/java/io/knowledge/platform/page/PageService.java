package io.knowledge.platform.page;

import io.knowledge.platform.audit.AuditService;
import io.knowledge.platform.authorization.AuthorizationService;
import io.knowledge.platform.authorization.Capability;
import io.knowledge.platform.authorization.ResourceNotFoundException;
import io.knowledge.platform.authorization.ResourceType;
import io.knowledge.platform.common.DomainConflictException;
import io.knowledge.platform.common.Ids;
import io.knowledge.platform.engagement.ActivityService;
import io.knowledge.platform.search.SearchDocumentCommand;
import io.knowledge.platform.search.SearchIndexWriter;
import java.net.URI;
import java.time.Clock;
import java.time.OffsetDateTime;
import java.util.HashSet;
import java.util.List;
import java.util.Locale;
import java.util.Set;
import java.util.UUID;
import java.util.regex.Pattern;
import org.springframework.dao.DuplicateKeyException;
import org.springframework.context.ApplicationEventPublisher;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;
import tools.jackson.databind.JsonNode;
import tools.jackson.databind.ObjectMapper;
import tools.jackson.databind.node.ObjectNode;

@Service
public class PageService {

    private static final Pattern PATH =
            Pattern.compile("[\\p{L}\\p{N}]+(?:-[\\p{L}\\p{N}]+)*");
    private final PageRepository repository;
    private final PageReferenceService references;
    private final ContentCardService cards;
    private final ContentTypeRegistry contentTypes;
    private final PageLabelService labels;
    private final AuthorizationService authorization;
    private final AuditService auditService;
    private final ActivityService activityService;
    private final SearchIndexWriter searchIndex;
    private final ObjectMapper objectMapper;
    private final ApplicationEventPublisher events;
    private final Clock clock;

    public PageService(
            PageRepository repository,
            PageReferenceService references,
            ContentCardService cards,
            ContentTypeRegistry contentTypes,
            PageLabelService labels,
            AuthorizationService authorization,
            AuditService auditService,
            ActivityService activityService,
            SearchIndexWriter searchIndex,
            ObjectMapper objectMapper,
            ApplicationEventPublisher events,
            Clock clock) {
        this.repository = repository;
        this.references = references;
        this.cards = cards;
        this.contentTypes = contentTypes;
        this.labels = labels;
        this.authorization = authorization;
        this.auditService = auditService;
        this.activityService = activityService;
        this.searchIndex = searchIndex;
        this.objectMapper = objectMapper;
        this.events = events;
        this.clock = clock;
    }

    @Transactional
    public PageView create(UUID actorId, CreatePageCommand command) {
        if (command == null || command.knowledgeBaseId() == null) {
            throw new IllegalArgumentException("Knowledge base id is required");
        }
        var knowledgeBase = authorization.require(
                actorId,
                ResourceType.KNOWLEDGE_BASE,
                command.knowledgeBaseId(),
                Capability.EDIT);
        ContentType type = command.contentType() == null
                ? ContentType.DOCUMENT
                : command.contentType();
        ContentTypeAdapter adapter = contentTypes.require(type);
        JsonNode content = command.content() == null
                ? adapter.createEmptyContent()
                : command.content();
        adapter.validate(content, 1);
        OffsetDateTime now = OffsetDateTime.now(clock);
        PageView page = new PageView(
                Ids.next(),
                knowledgeBase.workspaceId(),
                command.knowledgeBaseId(),
                title(command.title()),
                text(command.icon(), 2_000, "Page icon"),
                cover(command.cover()),
                type,
                path(command.path()),
                publishMode(command.publishMode()),
                null,
                null,
                visibility(command.visibilityOverride()),
                DocumentSettingsPolicy.normalize(objectMapper, command.documentSettings()),
                1,
                0,
                content,
                adapter.extractPlainText(content),
                actorId,
                actorId,
                now,
                now,
                null);
        try {
            repository.insert(page);
        } catch (DuplicateKeyException exception) {
            throw pathConflict();
        }
        references.synchronizeDraft(actorId, page, content, true);
        cards.synchronize(actorId, page, content, true);
        indexDraft(actorId, page);
        auditService.success(page.workspaceId(), actorId, "page.create", "PAGE", page.id());
        activityService.recordPageMutation(page.workspaceId(), actorId, page.id(), "CREATE");
        draftChanged(page);
        return page;
    }

    @Transactional
    public PageView get(UUID actorId, UUID pageId) {
        authorization.require(actorId, ResourceType.PAGE, pageId, Capability.READ);
        PageView page = requireActive(pageId);
        activityService.recordPageView(actorId, pageId);
        return page;
    }

    @Transactional(readOnly = true)
    public PageCollaborationAccess collaborationAccess(UUID actorId, UUID pageId) {
        var decision =
                authorization.require(actorId, ResourceType.PAGE, pageId, Capability.EDIT);
        PageView page = requireActive(pageId);
        return new PageCollaborationAccess(
                page.id(),
                page.workspaceId(),
                page.contentType(),
                decision.permissionVersion());
    }

    @Transactional
    public CollaborationMaterializationView materializeCollaboration(
            UUID pageId,
            long sequence,
            UUID actorId,
            ContentType contentType,
            String plainText) {
        if (pageId == null
                || sequence < 1
                || actorId == null
                || contentType == null
                || plainText == null
                || plainText.length() > 2_000_000) {
            throw new IllegalArgumentException("Collaboration materialization is invalid");
        }
        PageView current = requireActive(pageId);
        if (current.contentType() != contentType) {
            throw new DomainConflictException(
                    "COLLABORATION_CONTENT_TYPE_MISMATCH",
                    "Collaboration content type does not match the page");
        }
        ContentTypeAdapter adapter = contentTypes.require(contentType);
        JsonNode content;
        String indexedText;
        if (contentType == ContentType.DOCUMENT) {
            var document = objectMapper.createObjectNode();
            document.put("type", "doc");
            var paragraph = document.putArray("content").addObject();
            paragraph.put("type", "paragraph");
            paragraph.put("text", plainText);
            content = document;
            indexedText = plainText;
        } else {
            try {
                content = objectMapper.readTree(plainText);
            } catch (RuntimeException exception) {
                throw new IllegalArgumentException(
                        "Structured collaboration content is not valid JSON", exception);
            }
            indexedText = adapter.extractPlainText(content);
        }
        adapter.validate(content, current.schemaVersion());
        CollaborationMaterializationView result = repository.materializeCollaboration(
                pageId,
                sequence,
                actorId,
                content,
                indexedText,
                OffsetDateTime.now(clock));
        if (result.applied()) {
            PageView materialized = requireActive(pageId);
            references.synchronizeDraft(actorId, materialized, content, false);
            cards.synchronize(actorId, materialized, content, false);
            indexDraft(actorId, materialized);
            activityService.recordPageMutation(
                    current.workspaceId(), actorId, pageId, "EDIT");
            draftChanged(materialized);
        }
        return result;
    }

    @Transactional(readOnly = true)
    public List<PageView> list(UUID actorId, UUID knowledgeBaseId) {
        authorization.require(
                actorId, ResourceType.KNOWLEDGE_BASE, knowledgeBaseId, Capability.READ);
        return repository.listActive(knowledgeBaseId).stream()
                .filter(page -> authorization
                        .resolve(actorId, ResourceType.PAGE, page.id())
                        .allows(Capability.READ))
                .toList();
    }

    @Transactional
    public PageView update(UUID actorId, UpdatePageCommand command) {
        if (command == null || command.pageId() == null || command.expectedRevision() < 0) {
            throw new IllegalArgumentException("Page id and expected revision are required");
        }
        authorization.require(actorId, ResourceType.PAGE, command.pageId(), Capability.EDIT);
        PageView current = requireActive(command.pageId());
        int schemaVersion = command.schemaVersion() == null
                ? current.schemaVersion()
                : command.schemaVersion();
        JsonNode content = command.content() == null ? current.content() : command.content();
        ContentTypeAdapter adapter = contentTypes.require(current.contentType());
        adapter.validate(content, schemaVersion);
        OffsetDateTime now = OffsetDateTime.now(clock);
        PageView requested = new PageView(
                current.id(),
                current.workspaceId(),
                current.knowledgeBaseId(),
                command.title() == null ? current.title() : title(command.title()),
                command.icon() == null ? current.icon() : text(command.icon(), 2_000, "Page icon"),
                command.cover() == null ? current.cover() : cover(command.cover()),
                current.contentType(),
                command.path() == null ? current.path() : path(command.path()),
                command.publishMode() == null
                        ? current.publishMode()
                        : publishMode(command.publishMode()),
                current.publishedRevisionId(),
                current.publishedAt(),
                command.visibilityOverride() == null
                        ? current.visibilityOverride()
                        : visibility(command.visibilityOverride()),
                command.documentSettings() == null
                        ? current.documentSettings()
                        : DocumentSettingsPolicy.normalize(
                                objectMapper, command.documentSettings()),
                schemaVersion,
                command.expectedRevision() + 1,
                content,
                adapter.extractPlainText(content),
                current.createdBy(),
                actorId,
                current.createdAt(),
                now,
                null);
        try {
            boolean updated = repository.update(
                    requested,
                    command.expectedRevision(),
                    revisionKind(command.revisionKind()),
                    text(command.revisionDescription(), 500, "Revision description"));
            if (!updated) {
                throw new DomainConflictException(
                        "PAGE_REVISION_CONFLICT",
                        "The page changed since it was loaded; reload and apply the edit again");
            }
            references.synchronizeDraft(actorId, requested, content, true);
            cards.synchronize(actorId, requested, content, true);
            indexDraft(actorId, requested);
        } catch (DuplicateKeyException exception) {
            throw pathConflict();
        }
        if (!current.visibilityOverride().equals(requested.visibilityOverride())) {
            authorization.invalidateWorkspace(current.workspaceId());
        }
        auditService.success(
                requested.workspaceId(), actorId, "page.update", "PAGE", requested.id());
        activityService.recordPageMutation(
                requested.workspaceId(), actorId, requested.id(), "EDIT");
        draftChanged(requested);
        return requested;
    }

    @Transactional
    public PageView appendPublishedDatabaseFormRow(
            UUID updatedBy,
            UUID pageId,
            UUID rowId,
            JsonNode values,
            OffsetDateTime submittedAt) {
        if (updatedBy == null
                || pageId == null
                || rowId == null
                || values == null
                || !values.isObject()
                || submittedAt == null) {
            throw new IllegalArgumentException("Published database form row is invalid");
        }
        PageView current = repository.findActiveForUpdate(pageId);
        if (current == null || current.contentType() != ContentType.DATABASE) {
            throw new ResourceNotFoundException();
        }
        if (!current.content().isObject()) {
            throw new DomainConflictException(
                    "DATABASE_FORM_CHANGED", "The database form has changed; reload and try again");
        }
        ObjectNode content = (ObjectNode) current.content().deepCopy();
        var acceptedFields = new HashSet<String>();
        for (JsonNode field : content.path("fields")) {
            String id = field.path("id").isString() ? field.path("id").stringValue() : "";
            String type = field.path("type").isString()
                    ? field.path("type").stringValue().toUpperCase(Locale.ROOT)
                    : "TEXT";
            if (!id.isBlank() && !Set.of("FORMULA", "ROLLUP").contains(type)) {
                acceptedFields.add(id);
            }
        }
        for (var property : values.properties()) {
            if (!acceptedFields.contains(property.getKey())) {
                throw new DomainConflictException(
                        "DATABASE_FORM_CHANGED",
                        "The database fields changed after publication; republish the form and try again");
            }
        }
        JsonNode existingRows = content.path("rows");
        if (!existingRows.isArray() || existingRows.size() >= 50_000) {
            throw new DomainConflictException(
                    "DATABASE_FORM_CAPACITY_REACHED",
                    "The database cannot accept more form submissions");
        }
        var row = ((tools.jackson.databind.node.ArrayNode) existingRows).addObject();
        row.put("id", rowId.toString());
        row.set("values", values.deepCopy());
        row.put("createdAt", submittedAt.toString());
        ContentTypeAdapter adapter = contentTypes.require(ContentType.DATABASE);
        adapter.validate(content, current.schemaVersion());
        OffsetDateTime now = OffsetDateTime.now(clock);
        PageView requested = new PageView(
                current.id(),
                current.workspaceId(),
                current.knowledgeBaseId(),
                current.title(),
                current.icon(),
                current.cover(),
                current.contentType(),
                current.path(),
                current.publishMode(),
                current.publishedRevisionId(),
                current.publishedAt(),
                current.visibilityOverride(),
                current.documentSettings(),
                current.schemaVersion(),
                current.draftRevision() + 1,
                content,
                adapter.extractPlainText(content),
                current.createdBy(),
                updatedBy,
                current.createdAt(),
                now,
                null);
        if (!repository.update(
                requested,
                current.draftRevision(),
                "AUTO",
                "Public database form submission")) {
            throw new DomainConflictException(
                    "PAGE_REVISION_CONFLICT",
                    "The database changed while the form was being submitted; try again");
        }
        references.synchronizeDraft(updatedBy, requested, content, true);
        cards.synchronize(updatedBy, requested, content, true);
        indexDraft(updatedBy, requested);
        draftChanged(requested);
        return requested;
    }

    @Transactional
    public void moveToTrash(UUID actorId, UUID pageId) {
        authorization.require(actorId, ResourceType.PAGE, pageId, Capability.DELETE);
        PageView page = requireActive(pageId);
        repository.softDelete(pageId, OffsetDateTime.now(clock), actorId);
        searchIndex.delete(pageId);
        searchIndex.deletePublications(pageId);
        authorization.invalidateWorkspace(page.workspaceId());
        auditService.success(page.workspaceId(), actorId, "page.trash", "PAGE", pageId);
    }

    @Transactional(readOnly = true)
    public List<PageView> trash(UUID actorId, UUID workspaceId) {
        authorization.require(actorId, ResourceType.WORKSPACE, workspaceId, Capability.READ);
        return repository.listTrash(workspaceId).stream()
                .filter(page -> {
                    boolean[] permissions = trashPermissions(actorId, page.knowledgeBaseId());
                    return permissions[0] || permissions[1];
                })
                .toList();
    }

    @Transactional(readOnly = true)
    public TrashPageView globalTrash(
            UUID actorId, String requestedQuery, int requestedOffset, int requestedLimit) {
        String query = requestedQuery == null ? "" : requestedQuery.trim();
        if (query.length() > 200) {
            throw new IllegalArgumentException("Trash search query is too long");
        }
        int limit = Math.max(1, Math.min(requestedLimit, 100));
        int scanOffset = Math.max(0, requestedOffset);
        int batchSize = Math.max(25, Math.min(200, limit * 2));
        java.util.ArrayList<TrashItemView> items = new java.util.ArrayList<>(limit);
        boolean hasMore = false;
        while (!hasMore) {
            List<TrashItemView> candidates = repository.globalTrash(
                    actorId, query, scanOffset, batchSize);
            if (candidates.isEmpty()) break;
            for (TrashItemView candidate : candidates) {
                boolean[] permissions = trashPermissions(actorId, candidate.knowledgeBaseId());
                boolean visible = permissions[0] || permissions[1];
                if (visible && items.size() == limit) {
                    hasMore = true;
                    break;
                }
                scanOffset++;
                if (visible) items.add(candidate.withPermissions(permissions[0], permissions[1]));
            }
            if (hasMore || candidates.size() < batchSize) break;
        }
        return new TrashPageView(List.copyOf(items), scanOffset, hasMore);
    }

    @Transactional
    public PageView restore(UUID actorId, UUID pageId) {
        PageView page = requireAny(pageId);
        if (page.deletedAt() == null) {
            return page;
        }
        authorization.require(
                actorId,
                ResourceType.KNOWLEDGE_BASE,
                page.knowledgeBaseId(),
                Capability.RESTORE);
        try {
            repository.restore(pageId, OffsetDateTime.now(clock), actorId);
        } catch (DuplicateKeyException exception) {
            throw pathConflict();
        }
        authorization.invalidateWorkspace(page.workspaceId());
        auditService.success(page.workspaceId(), actorId, "page.restore", "PAGE", pageId);
        PageView restored = requireActive(pageId);
        indexDraft(actorId, restored);
        return restored;
    }

    @Transactional
    public void permanentlyDelete(UUID actorId, UUID pageId) {
        PageView page = requireAny(pageId);
        if (page.deletedAt() == null) {
            throw new DomainConflictException(
                    "PAGE_NOT_TRASHED", "Move the page to trash before permanently deleting it");
        }
        authorization.require(
                actorId,
                ResourceType.KNOWLEDGE_BASE,
                page.knowledgeBaseId(),
                Capability.DELETE);
        repository.permanentlyDelete(pageId);
        searchIndex.delete(pageId);
        searchIndex.deletePublications(pageId);
        auditService.success(
                page.workspaceId(), actorId, "page.delete-permanently", "PAGE", pageId);
    }

    @Transactional
    public List<PageView> restoreBatch(UUID actorId, List<UUID> pageIds) {
        return batchIds(pageIds).stream().map(pageId -> restore(actorId, pageId)).toList();
    }

    @Transactional
    public void permanentlyDeleteBatch(UUID actorId, List<UUID> pageIds) {
        for (UUID pageId : batchIds(pageIds)) permanentlyDelete(actorId, pageId);
    }

    private boolean[] trashPermissions(UUID actorId, UUID knowledgeBaseId) {
        try {
            var decision = authorization.resolve(
                    actorId, ResourceType.KNOWLEDGE_BASE, knowledgeBaseId);
            return new boolean[]{
                    decision.allows(Capability.RESTORE), decision.allows(Capability.DELETE)};
        } catch (ResourceNotFoundException exception) {
            return new boolean[]{false, false};
        }
    }

    private static List<UUID> batchIds(List<UUID> pageIds) {
        if (pageIds == null || pageIds.isEmpty() || pageIds.size() > 100
                || pageIds.stream().anyMatch(java.util.Objects::isNull)) {
            throw new IllegalArgumentException("Select between 1 and 100 trash items");
        }
        return pageIds.stream().distinct().toList();
    }

    @Transactional(readOnly = true)
    public List<PageHistoryView> history(UUID actorId, UUID pageId, int limit) {
        authorization.require(actorId, ResourceType.PAGE, pageId, Capability.READ);
        return repository.history(pageId, limit, 0);
    }

    @Transactional(readOnly = true)
    public PageHistoryPageView historyPage(
            UUID actorId, UUID pageId, int limit, int offset) {
        authorization.require(actorId, ResourceType.PAGE, pageId, Capability.READ);
        int count = Math.max(1, Math.min(limit, 50));
        int start = Math.max(0, Math.min(offset, 1_000_000));
        List<PageHistoryView> rows = repository.history(pageId, count + 1, start);
        boolean hasMore = rows.size() > count;
        List<PageHistoryView> items = List.copyOf(rows.subList(0, Math.min(rows.size(), count)));
        return new PageHistoryPageView(items, start + items.size(), hasMore);
    }

    @Transactional
    public PageView copyHistoryRevision(
            UUID actorId, UUID pageId, long revisionNo, String targetTitle, String targetPath) {
        if (pageId == null || revisionNo < 1) {
            throw new IllegalArgumentException("Page id and history revision are required");
        }
        authorization.require(actorId, ResourceType.PAGE, pageId, Capability.COPY);
        PageView source = requireActive(pageId);
        PageHistoryView revision = repository.historyRevision(pageId, revisionNo);
        if (revision == null) {
            throw new ResourceNotFoundException();
        }
        PageView emptyCopy = create(
                actorId,
                new CreatePageCommand(
                        source.knowledgeBaseId(),
                        targetTitle,
                        targetPath,
                        source.contentType(),
                        source.icon(),
                        source.cover(),
                        source.publishMode(),
                        source.visibilityOverride(),
                        source.documentSettings(),
                        null));
        PageView copy = update(
                actorId,
                new UpdatePageCommand(
                        emptyCopy.id(),
                        emptyCopy.draftRevision(),
                        null,
                        null,
                        null,
                        null,
                        null,
                        null,
                        null,
                        revision.content(),
                        revision.schemaVersion(),
                        "MIGRATION",
                        "Copied from page " + pageId + " revision " + revisionNo));
        auditService.success(
                copy.workspaceId(), actorId, "page.copy-history", "PAGE", copy.id());
        return copy;
    }

    @Transactional
    public PageView copyCurrent(
            UUID actorId,
            UUID pageId,
            UUID targetKnowledgeBaseId,
            String targetTitle,
            String targetPath) {
        if (pageId == null) {
            throw new IllegalArgumentException("Page id is required");
        }
        authorization.require(actorId, ResourceType.PAGE, pageId, Capability.COPY);
        PageView source = requireActive(pageId);
        UUID destination = targetKnowledgeBaseId == null
                ? source.knowledgeBaseId()
                : targetKnowledgeBaseId;
        PageLabelsView sourceLabels = labels.labels(actorId, pageId);
        PageView emptyCopy = create(
                actorId,
                new CreatePageCommand(
                        destination,
                        targetTitle,
                        targetPath,
                        source.contentType(),
                        source.icon(),
                        source.cover(),
                        source.publishMode(),
                        source.visibilityOverride(),
                        source.documentSettings(),
                        null));
        PageView copy = update(
                actorId,
                new UpdatePageCommand(
                        emptyCopy.id(),
                        emptyCopy.draftRevision(),
                        null,
                        null,
                        null,
                        null,
                        null,
                        null,
                        null,
                        source.content(),
                        source.schemaVersion(),
                        "MIGRATION",
                        "Copied from page " + pageId + " draft revision " + source.draftRevision()));
        if (!sourceLabels.labels().isEmpty()) {
            labels.update(
                    actorId,
                    copy.id(),
                    0,
                    sourceLabels.labels().stream()
                            .map(label -> new PageLabelInput(label.name(), label.color()))
                            .toList());
        }
        auditService.success(copy.workspaceId(), actorId, "page.copy", "PAGE", copy.id());
        return copy;
    }

    private PageView requireActive(UUID id) {
        PageView page = repository.findActive(id);
        if (page == null) {
            throw new ResourceNotFoundException();
        }
        return page;
    }

    private PageView requireAny(UUID id) {
        PageView page = repository.findAny(id);
        if (page == null) {
            throw new ResourceNotFoundException();
        }
        return page;
    }

    private void draftChanged(PageView page) {
        events.publishEvent(new PageDraftChangedEvent(
                page.id(), page.updatedBy(), page.draftRevision()));
    }

    private void indexDraft(UUID actorId, PageView page) {
        var decision = authorization.resolve(actorId, ResourceType.PAGE, page.id());
        var metadata = objectMapper.createObjectNode();
        metadata.put("knowledgeBaseId", page.knowledgeBaseId().toString());
        metadata.put("draftRevision", page.draftRevision());
        metadata.put("publicationStatus", page.publishedRevisionId() == null
                ? "UNPUBLISHED"
                : page.publishedAt() != null && page.updatedAt().isAfter(page.publishedAt())
                        ? "CHANGED"
                        : "PUBLISHED");
        if (page.icon() != null) metadata.put("icon", page.icon());
        searchIndex.upsert(new SearchDocumentCommand(
                page.id(),
                page.workspaceId(),
                "PAGE",
                page.id(),
                "DRAFT",
                page.title(),
                page.plainText(),
                labels.namesForIndex(page.id()),
                page.path(),
                page.createdBy(),
                page.contentType().name(),
                effectiveVisibility(decision.visibility()),
                null,
                decision.permissionVersion(),
                metadata,
                page.createdAt(),
                page.updatedAt()));
    }

    private static String effectiveVisibility(String value) {
        return Set.of("PRIVATE", "WORKSPACE", "PUBLIC").contains(value)
                ? value
                : "PRIVATE";
    }

    private static String title(String value) {
        if (value == null || value.trim().isEmpty() || value.trim().length() > 500) {
            throw new IllegalArgumentException("Page title must be between 1 and 500 characters");
        }
        return value.trim();
    }

    private static String path(String value) {
        if (value == null) {
            throw new IllegalArgumentException("Page path is required");
        }
        String normalized = value.trim().toLowerCase(Locale.ROOT);
        if (normalized.isEmpty()
                || normalized.length() > 180
                || !PATH.matcher(normalized).matches()) {
            throw new IllegalArgumentException("Page path is invalid");
        }
        return normalized;
    }

    private static String publishMode(String value) {
        String normalized = value == null ? "INHERIT" : value.toUpperCase(Locale.ROOT);
        if (!Set.of("INHERIT", "MANUAL", "AUTO").contains(normalized)) {
            throw new IllegalArgumentException("Page publish mode is invalid");
        }
        return normalized;
    }

    private static String visibility(String value) {
        String normalized = value == null ? "INHERIT" : value.toUpperCase(Locale.ROOT);
        if (!Set.of("INHERIT", "PRIVATE", "WORKSPACE", "PUBLIC").contains(normalized)) {
            throw new IllegalArgumentException("Page visibility override is invalid");
        }
        return normalized;
    }

    private static String revisionKind(String value) {
        String normalized = value == null ? "AUTO" : value.toUpperCase(Locale.ROOT);
        if (!Set.of("AUTO", "MANUAL", "MIGRATION").contains(normalized)) {
            throw new IllegalArgumentException("Page revision kind is invalid");
        }
        return normalized;
    }

    private static String text(String value, int max, String label) {
        if (value == null || value.isBlank()) {
            return null;
        }
        String normalized = value.trim();
        if (normalized.length() > max) {
            throw new IllegalArgumentException(label + " is too long");
        }
        return normalized;
    }

    static String cover(String value) {
        String normalized = text(value, 2_000, "Page cover");
        if (normalized == null) return null;
        try {
            URI uri = URI.create(normalized);
            if (!"https".equalsIgnoreCase(uri.getScheme())
                    || uri.getHost() == null
                    || uri.getUserInfo() != null) {
                throw new IllegalArgumentException("Page cover URL is invalid");
            }
            return uri.toASCIIString();
        } catch (RuntimeException exception) {
            throw new IllegalArgumentException("Page cover URL is invalid");
        }
    }

    private static DomainConflictException pathConflict() {
        return new DomainConflictException(
                "PAGE_PATH_CONFLICT", "Page path is already in use in this knowledge base");
    }
}
