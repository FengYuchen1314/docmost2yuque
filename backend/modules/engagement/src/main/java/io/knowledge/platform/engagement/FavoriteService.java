package io.knowledge.platform.engagement;

import io.knowledge.platform.audit.AuditService;
import io.knowledge.platform.authorization.AuthorizationDecision;
import io.knowledge.platform.authorization.AuthorizationService;
import io.knowledge.platform.authorization.Capability;
import io.knowledge.platform.authorization.ResourceType;
import java.time.Clock;
import java.time.OffsetDateTime;
import java.util.UUID;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

@Service
public class FavoriteService {

    private final EngagementRepository repository;
    private final AuthorizationService authorization;
    private final AuditService auditService;
    private final Clock clock;

    public FavoriteService(
            EngagementRepository repository,
            AuthorizationService authorization,
            AuditService auditService,
            Clock clock) {
        this.repository = repository;
        this.authorization = authorization;
        this.auditService = auditService;
        this.clock = clock;
    }

    @Transactional
    public boolean setPageFavorite(UUID actorId, UUID pageId, boolean favorite) {
        AuthorizationDecision decision =
                authorization.require(actorId, ResourceType.PAGE, pageId, Capability.READ);
        repository.favorite(
                actorId, decision.workspaceId(), "PAGE", pageId, favorite, OffsetDateTime.now(clock));
        auditService.success(
                decision.workspaceId(), actorId,
                favorite ? "favorite.add" : "favorite.remove", "PAGE", pageId);
        return favorite;
    }

    @Transactional(readOnly = true)
    public boolean isPageFavorite(UUID actorId, UUID pageId) {
        authorization.require(actorId, ResourceType.PAGE, pageId, Capability.READ);
        return repository.isFavorite(actorId, "PAGE", pageId);
    }
}
