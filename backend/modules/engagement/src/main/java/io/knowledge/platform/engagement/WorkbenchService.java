package io.knowledge.platform.engagement;

import io.knowledge.platform.authorization.AuthorizationService;
import io.knowledge.platform.authorization.Capability;
import io.knowledge.platform.authorization.ResourceType;
import java.util.List;
import java.util.Locale;
import java.util.Set;
import java.util.UUID;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

@Service
public class WorkbenchService {

    private final EngagementRepository repository;
    private final AuthorizationService authorization;

    public WorkbenchService(EngagementRepository repository, AuthorizationService authorization) {
        this.repository = repository;
        this.authorization = authorization;
    }

    @Transactional(readOnly = true)
    public List<WorkbenchItem> list(UUID actorId, String reason, int limit) {
        return page(actorId, reason, 0, limit).items();
    }

    @Transactional(readOnly = true)
    public WorkbenchPage page(UUID actorId, String reason, int requestedOffset, int requestedLimit) {
        String normalized = reason == null ? "EDITED" : reason.toUpperCase(Locale.ROOT);
        if (!Set.of("EDITED", "VIEWED", "COLLABORATED", "FAVORITE", "CREATED").contains(normalized)) {
            throw new IllegalArgumentException("Workbench filter is invalid");
        }
        int limit = Math.max(1, Math.min(requestedLimit, 100));
        int offset = Math.max(0, requestedOffset);
        int scanOffset = offset;
        int batchSize = Math.max(25, Math.min(200, limit * 2));
        java.util.ArrayList<WorkbenchItem> items = new java.util.ArrayList<>(limit);
        boolean hasMore = false;
        while (!hasMore) {
            List<WorkbenchItem> candidates = repository.workbench(actorId, normalized, scanOffset, batchSize);
            if (candidates.isEmpty()) {
                break;
            }
            for (WorkbenchItem item : candidates) {
                boolean allowed = authorization.resolve(actorId, ResourceType.PAGE, item.resourceId()).allows(Capability.READ);
                if (allowed && items.size() == limit) {
                    hasMore = true;
                    break;
                }
                scanOffset++;
                if (allowed) {
                    items.add(item);
                }
            }
            if (hasMore || candidates.size() < batchSize) {
                break;
            }
        }
        var collaborators = repository.collaborators(items.stream().map(WorkbenchItem::resourceId).toList());
        List<WorkbenchItem> enriched = items.stream()
                .map(item -> item.withCollaborators(collaborators.getOrDefault(item.resourceId(), List.of())))
                .toList();
        return new WorkbenchPage(enriched, scanOffset, hasMore);
    }
}
