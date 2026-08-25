package io.knowledge.platform.collaboration;

import io.knowledge.platform.common.DomainConflictException;
import io.knowledge.platform.common.Ids;
import io.knowledge.platform.page.PageCollaborationAccess;
import io.knowledge.platform.page.PageService;
import java.time.Clock;
import java.time.Duration;
import java.time.OffsetDateTime;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.UUID;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.stereotype.Service;
import tools.jackson.core.JacksonException;
import tools.jackson.databind.ObjectMapper;

@Service
public class CollaborationTicketService {

    private static final Duration TICKET_LIFETIME = Duration.ofSeconds(60);
    private static final String COLLABORATE = "collaborate";

    private final PageService pageService;
    private final ObjectMapper objectMapper;
    private final Clock clock;
    private final CollaborationTicketSigner signer;
    private final CollaborationSessionService sessionService;

    public CollaborationTicketService(
            PageService pageService,
            ObjectMapper objectMapper,
            Clock clock,
            CollaborationSessionService sessionService,
            @Value("${COLLAB_TICKET_PRIVATE_KEY:}") String encodedPrivateKey) {
        this.pageService = pageService;
        this.objectMapper = objectMapper;
        this.clock = clock;
        this.sessionService = sessionService;
        this.signer = new CollaborationTicketSigner(encodedPrivateKey);
    }

    public CollaborationTicketView issue(UUID actorId, UUID pageId, String httpSessionId) {
        if (actorId == null || pageId == null || httpSessionId == null) {
            throw new IllegalArgumentException("Actor id, page id, and HTTP session id are required");
        }
        if (!signer.configured()) {
            throw new DomainConflictException(
                    "COLLABORATION_NOT_CONFIGURED",
                    "Configure COLLAB_TICKET_PRIVATE_KEY before enabling collaboration");
        }

        PageCollaborationAccess access = pageService.collaborationAccess(actorId, pageId);
        UUID sessionId = sessionService.requireActive(actorId, httpSessionId);
        OffsetDateTime issuedAt = OffsetDateTime.now(clock);
        OffsetDateTime expiresAt = issuedAt.plus(TICKET_LIFETIME);
        Map<String, Object> claims = new LinkedHashMap<>();
        claims.put("version", 2);
        claims.put("page_id", access.pageId());
        claims.put("user_id", actorId);
        claims.put("workspace_id", access.workspaceId());
        claims.put("content_type", access.contentType().name());
        claims.put("capabilities", List.of(COLLABORATE));
        claims.put("permission_version", access.permissionVersion());
        claims.put("session_id", sessionId);
        claims.put("nonce", Ids.next());
        claims.put("scope", COLLABORATE);
        claims.put("issued_at", issuedAt.toEpochSecond());
        claims.put("expires_at", expiresAt.toEpochSecond());

        try {
            String ticket = signer.sign(objectMapper.writeValueAsBytes(claims));
            return new CollaborationTicketView(
                    ticket,
                    "/collaboration/" + pageId,
                    expiresAt);
        } catch (JacksonException exception) {
            throw new IllegalStateException("Failed to serialize collaboration ticket", exception);
        }
    }
}
