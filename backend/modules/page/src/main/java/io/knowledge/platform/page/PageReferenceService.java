package io.knowledge.platform.page;

import io.knowledge.platform.authorization.AuthorizationDeniedException;
import io.knowledge.platform.authorization.AuthorizationService;
import io.knowledge.platform.authorization.Capability;
import io.knowledge.platform.authorization.ResourceNotFoundException;
import io.knowledge.platform.authorization.ResourceType;
import io.knowledge.platform.common.DomainConflictException;
import java.time.Clock;
import java.time.OffsetDateTime;
import java.util.ArrayDeque;
import java.util.ArrayList;
import java.util.HashMap;
import java.util.HashSet;
import java.util.LinkedHashMap;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.UUID;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;
import tools.jackson.databind.JsonNode;

@Service
public class PageReferenceService {

    private static final int MAX_GRAPH_DEPTH = 4;
    private static final int MAX_GRAPH_NODES = 200;
    private static final int MAX_EMBED_DEPTH = 32;
    private final PageReferenceRepository repository;
    private final PageReferenceExtractor extractor;
    private final AuthorizationService authorization;
    private final Clock clock;

    public PageReferenceService(
            PageReferenceRepository repository,
            PageReferenceExtractor extractor,
            AuthorizationService authorization,
            Clock clock) {
        this.repository = repository;
        this.extractor = extractor;
        this.authorization = authorization;
        this.clock = clock;
    }

    void synchronizeDraft(
            UUID actorId,
            PageView source,
            JsonNode content,
            boolean strict) {
        List<ExtractedPageReference> extracted;
        try {
            extracted = extractor.extract(content);
        } catch (IllegalArgumentException exception) {
            if (strict) {
                throw exception;
            }
            repository.replaceDraft(source, List.of(), OffsetDateTime.now(clock));
            return;
        }
        Map<UUID, Set<UUID>> embedGraph = currentEmbedGraph(source);
        List<ExtractedPageReference> accepted = new ArrayList<>(extracted.size());
        for (ExtractedPageReference reference : extracted) {
            try {
                validateReference(actorId, source, reference, embedGraph);
                accepted.add(reference);
                if (reference.embedsContent()) {
                    embedGraph
                            .computeIfAbsent(source.id(), ignored -> new LinkedHashSet<>())
                            .add(reference.targetPageId());
                }
            } catch (AuthorizationDeniedException
                    | ResourceNotFoundException
                    | DomainConflictException
                    | IllegalArgumentException exception) {
                if (strict) {
                    throw exception;
                }
            }
        }
        repository.replaceDraft(source, accepted, OffsetDateTime.now(clock));
    }

    @Transactional
    public void snapshotPublication(
            UUID sourcePageId,
            UUID publicationId,
            long sourceRevision) {
        repository.snapshotPublication(
                sourcePageId,
                publicationId,
                sourceRevision,
                OffsetDateTime.now(clock));
    }

    @Transactional(readOnly = true)
    public List<PageReferenceSummary> outgoing(UUID actorId, UUID sourcePageId) {
        authorization.require(actorId, ResourceType.PAGE, sourcePageId, Capability.READ);
        List<PageReferenceSummary> result = new ArrayList<>();
        for (StoredPageReference reference : repository.outgoing(sourcePageId)) {
            var target = repository.metadata(reference.targetPageId());
            boolean accessible = target != null && readable(actorId, target.pageId());
            result.add(summary(reference, "OUTGOING", accessible ? target : null));
        }
        return List.copyOf(result);
    }

    @Transactional(readOnly = true)
    public List<PageReferenceSummary> backlinks(UUID actorId, UUID targetPageId) {
        authorization.require(actorId, ResourceType.PAGE, targetPageId, Capability.READ);
        List<PageReferenceSummary> result = new ArrayList<>();
        for (StoredPageReference reference : repository.backlinks(targetPageId)) {
            var source = repository.metadata(reference.sourcePageId());
            if (source == null
                    || (reference.sourcePublicationId() != null
                            && !reference.sourcePublicationId().equals(source.publishedRevisionId()))
                    || !readable(actorId, source.pageId())) {
                continue;
            }
            result.add(summary(reference, "BACKLINK", source));
        }
        return List.copyOf(result);
    }

    @Transactional(readOnly = true)
    public EmbeddedPageView resolve(UUID actorId, UUID referenceId) {
        StoredPageReference reference = repository.find(referenceId);
        if (reference == null) {
            throw new ResourceNotFoundException();
        }
        authorization.require(
                actorId,
                ResourceType.PAGE,
                reference.sourcePageId(),
                Capability.READ);
        if (!readable(actorId, reference.targetPageId())) {
            return EmbeddedPageView.unavailable(reference.id(), reference.mode());
        }
        PageReferenceRepository.ContentSnapshot snapshot = reference.mode() == EmbedMode.FIXED
                ? repository.publicationSnapshot(
                        reference.fixedPublicationId(), reference.targetPageId())
                : repository.draftSnapshot(reference.targetPageId());
        if (snapshot == null) {
            return EmbeddedPageView.unavailable(reference.id(), reference.mode());
        }
        JsonNode content = snapshot.content();
        String status = "READY";
        if (reference.targetBlockId() != null) {
            content = findBlock(content, reference.targetBlockId());
            if (content == null) {
                status = "MISSING_BLOCK";
            }
        } else if (reference.mode() != EmbedMode.LIVE
                && reference.mode() != EmbedMode.FIXED) {
            content = null;
        }
        String plainText = switch (reference.mode()) {
            case CARD -> abbreviate(snapshot.plainText(), 500);
            case LIVE, FIXED -> snapshot.plainText();
            case LINK, TITLE -> null;
        };
        return new EmbeddedPageView(
                reference.id(),
                status,
                reference.mode(),
                snapshot.pageId(),
                snapshot.title(),
                snapshot.contentType(),
                content,
                plainText,
                reference.targetBlockId(),
                snapshot.publicationId(),
                snapshot.snapshotAt());
    }

    @Transactional(readOnly = true)
    public KnowledgeGraphView graph(
            UUID actorId,
            UUID rootPageId,
            int requestedDepth,
            int requestedLimit) {
        authorization.require(actorId, ResourceType.PAGE, rootPageId, Capability.READ);
        var root = repository.metadata(rootPageId);
        if (root == null) {
            throw new ResourceNotFoundException();
        }
        int depthLimit = Math.max(1, Math.min(requestedDepth, MAX_GRAPH_DEPTH));
        int nodeLimit = Math.max(1, Math.min(requestedLimit, MAX_GRAPH_NODES));
        List<StoredPageReference> candidates =
                repository.workspaceDraftReferences(root.workspaceId());
        Map<UUID, List<StoredPageReference>> adjacency = new HashMap<>();
        for (StoredPageReference candidate : candidates) {
            adjacency.computeIfAbsent(candidate.sourcePageId(), ignored -> new ArrayList<>())
                    .add(candidate);
            adjacency.computeIfAbsent(candidate.targetPageId(), ignored -> new ArrayList<>())
                    .add(candidate);
        }

        Map<UUID, PageReferenceRepository.PageMetadata> metadata = new HashMap<>();
        Map<UUID, Boolean> readable = new HashMap<>();
        LinkedHashMap<UUID, KnowledgeGraphView.Node> nodes = new LinkedHashMap<>();
        LinkedHashMap<UUID, KnowledgeGraphView.Edge> edges = new LinkedHashMap<>();
        ArrayDeque<NodeDepth> queue = new ArrayDeque<>();
        Set<UUID> visited = new HashSet<>();
        metadata.put(rootPageId, root);
        readable.put(rootPageId, true);
        nodes.put(rootPageId, graphNode(root));
        visited.add(rootPageId);
        queue.add(new NodeDepth(rootPageId, 0));
        boolean truncated = false;

        while (!queue.isEmpty()) {
            NodeDepth current = queue.removeFirst();
            if (current.depth() >= depthLimit) {
                if (!adjacency.getOrDefault(current.pageId(), List.of()).isEmpty()) {
                    truncated = true;
                }
                continue;
            }
            for (StoredPageReference reference :
                    adjacency.getOrDefault(current.pageId(), List.of())) {
                UUID other = reference.sourcePageId().equals(current.pageId())
                        ? reference.targetPageId()
                        : reference.sourcePageId();
                if (!readable.computeIfAbsent(other, id -> readable(actorId, id))) {
                    continue;
                }
                var otherMetadata = metadata.computeIfAbsent(other, repository::metadata);
                if (otherMetadata == null) {
                    continue;
                }
                if (!nodes.containsKey(other) && nodes.size() >= nodeLimit) {
                    truncated = true;
                    continue;
                }
                nodes.putIfAbsent(other, graphNode(otherMetadata));
                edges.putIfAbsent(
                        reference.id(),
                        new KnowledgeGraphView.Edge(
                                reference.id(),
                                reference.sourcePageId(),
                                reference.targetPageId(),
                                reference.kind(),
                                reference.mode()));
                if (visited.add(other)) {
                    queue.addLast(new NodeDepth(other, current.depth() + 1));
                }
            }
        }
        return new KnowledgeGraphView(
                rootPageId,
                List.copyOf(nodes.values()),
                List.copyOf(edges.values()),
                truncated);
    }

    private void validateReference(
            UUID actorId,
            PageView source,
            ExtractedPageReference reference,
            Map<UUID, Set<UUID>> embedGraph) {
        var target = repository.metadata(reference.targetPageId());
        if (target == null) {
            throw new ResourceNotFoundException();
        }
        if (!source.workspaceId().equals(target.workspaceId())) {
            throw new DomainConflictException(
                    "REFERENCE_CROSS_WORKSPACE",
                    "Page references cannot cross workspace boundaries");
        }
        authorization.require(
                actorId,
                ResourceType.PAGE,
                reference.targetPageId(),
                Capability.READ);
        if (reference.mode() == EmbedMode.FIXED
                && !repository.publicationBelongsToPage(
                        reference.fixedPublicationId(), reference.targetPageId())) {
            throw new DomainConflictException(
                    "REFERENCE_PUBLICATION_MISMATCH",
                    "The fixed publication does not belong to the referenced page");
        }
        if (reference.embedsContent()
                && (source.id().equals(reference.targetPageId())
                        || pathExists(
                                embedGraph,
                                reference.targetPageId(),
                                source.id()))) {
            throw new DomainConflictException(
                    "REFERENCE_EMBED_CYCLE",
                    "The content embed would create a reference cycle");
        }
    }

    private Map<UUID, Set<UUID>> currentEmbedGraph(PageView source) {
        Map<UUID, Set<UUID>> graph = new HashMap<>();
        for (StoredPageReference reference :
                repository.workspaceDraftReferences(source.workspaceId())) {
            if (reference.sourcePageId().equals(source.id()) || !reference.embedsContent()) {
                continue;
            }
            graph.computeIfAbsent(reference.sourcePageId(), ignored -> new LinkedHashSet<>())
                    .add(reference.targetPageId());
        }
        return graph;
    }

    private static boolean pathExists(
            Map<UUID, Set<UUID>> graph,
            UUID start,
            UUID target) {
        ArrayDeque<NodeDepth> queue = new ArrayDeque<>();
        Set<UUID> visited = new HashSet<>();
        queue.add(new NodeDepth(start, 0));
        visited.add(start);
        while (!queue.isEmpty()) {
            NodeDepth current = queue.removeFirst();
            if (current.pageId().equals(target)) {
                return true;
            }
            Set<UUID> next = graph.getOrDefault(current.pageId(), Set.of());
            if (current.depth() >= MAX_EMBED_DEPTH) {
                if (!next.isEmpty()) {
                    return true;
                }
                continue;
            }
            for (UUID pageId : next) {
                if (visited.add(pageId)) {
                    queue.addLast(new NodeDepth(pageId, current.depth() + 1));
                }
            }
        }
        return false;
    }

    private boolean readable(UUID actorId, UUID pageId) {
        try {
            return authorization
                    .resolve(actorId, ResourceType.PAGE, pageId)
                    .allows(Capability.READ);
        } catch (AuthorizationDeniedException | ResourceNotFoundException exception) {
            return false;
        }
    }

    private static PageReferenceSummary summary(
            StoredPageReference reference,
            String direction,
            PageReferenceRepository.PageMetadata page) {
        boolean accessible = page != null;
        return new PageReferenceSummary(
                reference.id(),
                direction,
                reference.sourceScope(),
                reference.kind(),
                reference.mode(),
                accessible ? reference.targetBlockId() : null,
                accessible ? reference.fixedPublicationId() : null,
                accessible,
                accessible ? page.pageId() : null,
                accessible ? page.knowledgeBaseId() : null,
                accessible ? page.title() : null,
                accessible ? page.contentType() : null,
                accessible ? page.path() : null,
                accessible ? page.updatedAt() : null);
    }

    private static KnowledgeGraphView.Node graphNode(
            PageReferenceRepository.PageMetadata page) {
        return new KnowledgeGraphView.Node(
                page.pageId(),
                page.knowledgeBaseId(),
                page.title(),
                page.contentType());
    }

    private static JsonNode findBlock(JsonNode node, String blockId) {
        if (node == null || node.isNull()) {
            return null;
        }
        if (node.isObject()) {
            JsonNode attributes = node.path("attrs");
            if (blockId.equals(node.path("id").stringValue(null))
                    || blockId.equals(node.path("blockId").stringValue(null))
                    || blockId.equals(attributes.path("id").stringValue(null))
                    || blockId.equals(attributes.path("blockId").stringValue(null))) {
                return node.deepCopy();
            }
            for (var property : node.properties()) {
                JsonNode found = findBlock(property.getValue(), blockId);
                if (found != null) {
                    return found;
                }
            }
        } else if (node.isArray()) {
            for (JsonNode child : node) {
                JsonNode found = findBlock(child, blockId);
                if (found != null) {
                    return found;
                }
            }
        }
        return null;
    }

    private static String abbreviate(String value, int maximum) {
        if (value == null || value.length() <= maximum) {
            return value;
        }
        return value.substring(0, maximum) + "…";
    }

    private record NodeDepth(UUID pageId, int depth) {}
}
