package io.knowledge.platform.search;

import io.knowledge.platform.authorization.AuthorizationDeniedException;
import io.knowledge.platform.authorization.AuthorizationService;
import io.knowledge.platform.authorization.Capability;
import io.knowledge.platform.authorization.ResourceNotFoundException;
import io.knowledge.platform.authorization.ResourceType;
import java.time.OffsetDateTime;
import java.util.ArrayList;
import java.util.HashSet;
import java.util.List;
import java.util.Locale;
import java.util.Set;
import java.util.UUID;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

@Service
public class SearchService {

    private static final Set<String> INTERNAL_TYPES = Set.of(
            "PAGE", "KNOWLEDGE_BASE", "QUICK_NOTE", "TEMPLATE", "USER", "TEAM", "ATTACHMENT");
    private final SearchRepository repository;
    private final AuthorizationService authorization;

    public SearchService(SearchRepository repository, AuthorizationService authorization) {
        this.repository = repository;
        this.authorization = authorization;
    }

    @Transactional(readOnly = true)
    public SearchResponse search(
            UUID actorId,
            UUID workspaceId,
            String rawQuery,
            Set<String> requestedTypes,
            int requestedOffset,
            int requestedLimit) {
        return search(actorId, workspaceId, rawQuery, requestedTypes, null, null, null, null, requestedOffset, requestedLimit);
    }

    @Transactional(readOnly = true)
    public SearchResponse search(
            UUID actorId,
            UUID workspaceId,
            String rawQuery,
            Set<String> requestedTypes,
            UUID knowledgeBaseId,
            UUID creatorId,
            OffsetDateTime updatedFrom,
            OffsetDateTime updatedTo,
            int requestedOffset,
            int requestedLimit) {
        authorization.require(
                actorId, ResourceType.WORKSPACE, workspaceId, Capability.READ);
        if (updatedFrom != null && updatedTo != null && updatedFrom.isAfter(updatedTo)) {
            throw new IllegalArgumentException("Search update range is invalid");
        }
        String query = query(rawQuery);
        Set<String> types = types(requestedTypes);
        int resultLimit = Math.max(1, Math.min(requestedLimit, 50));
        int candidateOffset = Math.max(0, requestedOffset);
        List<SearchResultView> results = new ArrayList<>();
        boolean hasMore = false;
        int scanned = 0;
        boolean exhausted = false;
        searchLoop:
        while (!exhausted && scanned < 1_000) {
            List<SearchCandidate> candidates = repository.search(
                    workspaceId,
                    query,
                    types,
                    Set.of("DRAFT", "CANONICAL"),
                    candidateOffset,
                    100,
                    false,
                    knowledgeBaseId,
                    creatorId,
                    updatedFrom,
                    updatedTo);
            if (candidates.isEmpty()) break;
            for (SearchCandidate candidate : candidates) {
                boolean allowed = allowed(actorId, candidate);
                if (allowed && results.size() == resultLimit) {
                    hasMore = true;
                    break searchLoop;
                }
                candidateOffset++;
                scanned++;
                if (allowed) results.add(view(candidate, query));
                if (scanned >= 1_000) break;
            }
            exhausted = candidates.size() < 100;
        }
        if (!exhausted && scanned >= 1_000) hasMore = true;
        return new SearchResponse(List.copyOf(results), candidateOffset, hasMore);
    }

    @Transactional(readOnly = true)
    public SearchResponse publicSearch(
            UUID workspaceId,
            String rawQuery,
            int requestedOffset,
            int requestedLimit) {
        String query = query(rawQuery);
        int limit = Math.max(1, Math.min(requestedLimit, 50));
        List<SearchCandidate> candidates = repository.search(
                workspaceId,
                query,
                Set.of("PAGE"),
                Set.of("PUBLISHED"),
                Math.max(0, requestedOffset),
                limit + 1,
                true,
                null,
                null,
                null,
                null);
        boolean hasMore = candidates.size() > limit;
        List<SearchResultView> results = candidates.stream()
                .limit(limit)
                .map(candidate -> view(candidate, query))
                .toList();
        return new SearchResponse(
                results,
                Math.max(0, requestedOffset) + results.size(),
                hasMore);
    }

    private boolean allowed(UUID actorId, SearchCandidate candidate) {
        if ("USER".equals(candidate.resourceType())) {
            return true;
        }
        if ("QUICK_NOTE".equals(candidate.resourceType())) {
            return actorId.equals(candidate.ownerId());
        }
        if ("TEMPLATE".equals(candidate.resourceType())) {
            return !"PRIVATE".equals(candidate.visibility()) || actorId.equals(candidate.ownerId());
        }
        if ("ATTACHMENT".equals(candidate.resourceType())) {
            try {
                if(candidate.parentPageId()==null)return authorization.resolve(actorId,ResourceType.WORKSPACE,candidate.workspaceId()).allows(Capability.READ);
                return authorization.resolve(actorId,ResourceType.PAGE,candidate.parentPageId()).allows(Capability.READ);
            } catch (AuthorizationDeniedException | ResourceNotFoundException exception) {
                return false;
            }
        }
        try {
            ResourceType type = ResourceType.valueOf(candidate.resourceType());
            return authorization
                    .resolve(actorId, type, candidate.resourceId())
                    .allows(Capability.READ);
        } catch (IllegalArgumentException
                | AuthorizationDeniedException
                | ResourceNotFoundException exception) {
            return false;
        }
    }

    private static SearchResultView view(SearchCandidate candidate, String query) {
        return new SearchResultView(
                candidate.documentId(),
                candidate.resourceId(),
                candidate.resourceType(),
                candidate.sourceScope(),
                candidate.title(),
                snippet(candidate.body(), query),
                candidate.path(),
                candidate.contentType(),
                candidate.publicationId(),
                candidate.knowledgeBaseId(),
                candidate.ownerId(),
                candidate.publicationStatus(),
                candidate.score(),
                candidate.updatedAt());
    }

    private static String query(String value) {
        if (value == null || value.trim().length() < 1 || value.trim().length() > 200) {
            throw new IllegalArgumentException("Search query must be between 1 and 200 characters");
        }
        return value.trim();
    }

    private static Set<String> types(Set<String> requested) {
        if (requested == null || requested.isEmpty()) {
            return INTERNAL_TYPES;
        }
        Set<String> normalized = new HashSet<>();
        for (String value : requested) {
            if (value != null) {
                String type = value.toUpperCase(Locale.ROOT);
                if (INTERNAL_TYPES.contains(type)) {
                    normalized.add(type);
                }
            }
        }
        if (normalized.isEmpty()) {
            throw new IllegalArgumentException("Search resource types are invalid");
        }
        return Set.copyOf(normalized);
    }

    private static String snippet(String body, String query) {
        if (body == null || body.isBlank()) {
            return "";
        }
        String normalized = body.replaceAll("\\s+", " ").trim();
        int match = normalized.toLowerCase(Locale.ROOT)
                .indexOf(query.toLowerCase(Locale.ROOT));
        int start = Math.max(0, match < 0 ? 0 : match - 70);
        int end = Math.min(normalized.length(), start + 180);
        while (start > 0 && !normalized.isEmpty() && Character.isLowSurrogate(normalized.charAt(start))) {
            start--;
        }
        while (end < normalized.length() && Character.isHighSurrogate(normalized.charAt(end - 1))) {
            end++;
        }
        return (start > 0 ? "…" : "")
                + normalized.substring(start, end)
                + (end < normalized.length() ? "…" : "");
    }
}
