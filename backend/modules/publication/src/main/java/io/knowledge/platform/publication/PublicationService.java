package io.knowledge.platform.publication;

import io.knowledge.platform.audit.AuditService;
import io.knowledge.platform.authorization.AuthorizationService;
import io.knowledge.platform.authorization.Capability;
import io.knowledge.platform.authorization.ResourceNotFoundException;
import io.knowledge.platform.authorization.ResourceType;
import io.knowledge.platform.page.PageReferenceService;
import io.knowledge.platform.page.PageLabelService;
import io.knowledge.platform.search.SearchDocumentCommand;
import io.knowledge.platform.search.SearchIndexWriter;
import java.time.Clock;
import java.time.OffsetDateTime;
import java.util.List;
import java.util.UUID;
import org.springframework.context.ApplicationEventPublisher;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

@Service
public class PublicationService {

    private final PublicationRepository repository;
    private final AuthorizationService authorization;
    private final AuditService auditService;
    private final PageReferenceService pageReferences;
    private final PageLabelService pageLabels;
    private final SearchIndexWriter searchIndex;
    private final ApplicationEventPublisher events;
    private final Clock clock;

    public PublicationService(
            PublicationRepository repository,
            AuthorizationService authorization,
            AuditService auditService,
            PageReferenceService pageReferences,
            PageLabelService pageLabels,
            SearchIndexWriter searchIndex,
            ApplicationEventPublisher events,
            Clock clock) {
        this.repository = repository;
        this.authorization = authorization;
        this.auditService = auditService;
        this.pageReferences = pageReferences;
        this.pageLabels = pageLabels;
        this.searchIndex = searchIndex;
        this.events = events;
        this.clock = clock;
    }

    @Transactional
    public PagePublicationView publish(
            UUID actorId,
            UUID pageId,
            String idempotencyKey) {
        String key = requireIdempotencyKey(idempotencyKey);
        authorization.require(actorId, ResourceType.PAGE, pageId, Capability.PUBLISH);
        PagePublicationView prior = repository.findRequest(pageId, actorId, key);
        if (prior != null) {
            return prior;
        }
        PublicationRepository.DraftSnapshot draft = repository.draftForUpdate(pageId);
        if (draft == null) {
            throw new ResourceNotFoundException();
        }
        return publishLocked(actorId, key, draft, false);
    }

    @Transactional
    public void autoPublish(
            UUID actorId,
            UUID pageId,
            long expectedDraftRevision,
            String idempotencyKey) {
        if (actorId == null || pageId == null || expectedDraftRevision < 0) {
            throw new IllegalArgumentException("Automatic publication payload is invalid");
        }
        String key = requireIdempotencyKey(idempotencyKey);
        if (repository.findRequest(pageId, actorId, key) != null) return;
        PublicationRepository.DraftSnapshot draft = repository.draftForUpdate(pageId);
        if (draft == null
                || draft.draftRevision() != expectedDraftRevision
                || !repository.autoPublishEnabled(pageId)) {
            return;
        }
        authorization.require(actorId, ResourceType.PAGE, pageId, Capability.PUBLISH);
        PagePublicationView current = repository.currentForPage(pageId);
        if (current != null && current.sourceDraftRevision() == expectedDraftRevision) return;
        publishLocked(actorId, key, draft, true);
    }

    @Transactional
    public void unpublish(UUID actorId, UUID pageId) {
        authorization.require(actorId, ResourceType.PAGE, pageId, Capability.PUBLISH);
        PublicationRepository.DraftSnapshot draft = repository.draftForUpdate(pageId);
        if (draft == null) {
            throw new ResourceNotFoundException();
        }
        repository.unpublish(draft, OffsetDateTime.now(clock));
        searchIndex.deletePublications(pageId);
        searchIndex.updatePagePublicationStatus(pageId, "UNPUBLISHED");
        auditService.success(
                draft.workspaceId(), actorId, "page.unpublish", "PAGE", pageId);
    }

    @Transactional(readOnly = true)
    public PublicationState state(UUID actorId, UUID pageId) {
        authorization.require(actorId, ResourceType.PAGE, pageId, Capability.READ);
        PublicationState state = repository.state(pageId);
        if (state == null) {
            throw new ResourceNotFoundException();
        }
        return state;
    }

    @Transactional(readOnly = true)
    public List<PagePublicationView> history(UUID actorId, UUID pageId, int limit) {
        authorization.require(actorId, ResourceType.PAGE, pageId, Capability.READ);
        return repository.history(pageId, limit, 0);
    }

    @Transactional(readOnly = true)
    public PublicationHistoryPageView historyPage(
            UUID actorId, UUID pageId, int limit, int offset) {
        authorization.require(actorId, ResourceType.PAGE, pageId, Capability.READ);
        int count = Math.max(1, Math.min(limit, 50));
        int start = Math.max(0, Math.min(offset, 1_000_000));
        List<PagePublicationView> rows = repository.history(pageId, count + 1, start);
        boolean hasMore = rows.size() > count;
        List<PagePublicationView> items = List.copyOf(
                rows.subList(0, Math.min(rows.size(), count)));
        return new PublicationHistoryPageView(items, start + items.size(), hasMore);
    }

    @Transactional(readOnly = true)
    public PagePublicationView currentSnapshot(UUID pageId) {
        PagePublicationView publication = repository.currentForPage(pageId);
        if (publication == null) {
            throw new ResourceNotFoundException();
        }
        return publication;
    }

    private static String requireIdempotencyKey(String value) {
        if (value == null || value.trim().length() < 8 || value.trim().length() > 200) {
            throw new IllegalArgumentException(
                    "Idempotency key must be between 8 and 200 characters");
        }
        return value.trim();
    }

    private PagePublicationView publishLocked(
            UUID actorId,
            String idempotencyKey,
            PublicationRepository.DraftSnapshot draft,
            boolean automatic) {
        List<String> labels = pageLabels.namesForIndex(draft.pageId());
        PagePublicationView publication = repository.insert(
                draft, actorId, idempotencyKey, labels, OffsetDateTime.now(clock));
        pageReferences.snapshotPublication(
                draft.pageId(), publication.id(), draft.draftRevision());
        searchIndex.deletePublications(draft.pageId());
        indexPublication(actorId, draft, publication, labels);
        searchIndex.updatePagePublicationStatus(draft.pageId(), "PUBLISHED");
        auditService.success(
                draft.workspaceId(), actorId,
                automatic ? "page.publish-auto" : "page.publish",
                "PAGE", draft.pageId());
        events.publishEvent(new PublicationPublishedEvent(
                publication.id(),
                draft.pageId(),
                draft.workspaceId(),
                draft.knowledgeBaseId(),
                actorId,
                publication.title(),
                preview(publication.plainText()),
                publication.contentType(),
                draft.effectiveVisibility(),
                publication.publishedAt()));
        return publication;
    }

    private static String preview(String value) {
        if (value == null) return "";
        String normalized = value.strip().replaceAll("\\s+", " ");
        return normalized.length() <= 240 ? normalized : normalized.substring(0, 240) + "…";
    }

    private void indexPublication(
            UUID actorId,
            PublicationRepository.DraftSnapshot draft,
            PagePublicationView publication,
            List<String> labels) {
        var decision = authorization.resolve(actorId, ResourceType.PAGE, draft.pageId());
        var metadata = publication.metadata().deepCopy();
        if (metadata.isObject()) {
            ((tools.jackson.databind.node.ObjectNode) metadata)
                    .put("knowledgeBaseId", draft.knowledgeBaseId().toString());
        }
        searchIndex.upsert(new SearchDocumentCommand(
                publication.id(),
                draft.workspaceId(),
                "PAGE",
                draft.pageId(),
                "PUBLISHED",
                publication.title(),
                publication.plainText(),
                labels,
                draft.path(),
                publication.publishedBy(),
                publication.contentType(),
                draft.effectiveVisibility(),
                publication.id(),
                decision.permissionVersion(),
                metadata,
                draft.createdAt(),
                publication.publishedAt()));
    }
}
