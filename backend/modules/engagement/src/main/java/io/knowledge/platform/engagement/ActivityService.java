package io.knowledge.platform.engagement;

import io.knowledge.platform.authorization.AuthorizationDecision;
import io.knowledge.platform.authorization.AuthorizationService;
import io.knowledge.platform.authorization.Capability;
import io.knowledge.platform.authorization.ResourceType;
import io.knowledge.platform.analytics.AnalyticsEventCommand;
import io.knowledge.platform.analytics.AnalyticsRecorder;
import java.time.Clock;
import java.time.OffsetDateTime;
import java.util.UUID;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;
import tools.jackson.databind.JsonNode;
import tools.jackson.databind.ObjectMapper;

@Service
public class ActivityService {

    private final EngagementRepository repository;
    private final AuthorizationService authorization;
    private final AnalyticsRecorder analytics;
    private final ObjectMapper objectMapper;
    private final Clock clock;

    public ActivityService(
            EngagementRepository repository,
            AuthorizationService authorization,
            AnalyticsRecorder analytics,
            ObjectMapper objectMapper,
            Clock clock) {
        this.repository = repository;
        this.authorization = authorization;
        this.analytics = analytics;
        this.objectMapper = objectMapper;
        this.clock = clock;
    }

    @Transactional
    public void recordPageView(UUID actorId, UUID pageId) {
        AuthorizationDecision decision =
                authorization.require(actorId, ResourceType.PAGE, pageId, Capability.READ);
        OffsetDateTime now = OffsetDateTime.now(clock);
        boolean recorded = repository.recordActivity(
                decision.workspaceId(), actorId, "PAGE", pageId, "VIEW",
                objectMapper.createObjectNode(), now, now.minusMinutes(10));
        if (recorded) {
            analytics.record(new AnalyticsEventCommand(
                    decision.workspaceId(), actorId, null, "PAGE", pageId, null,
                    "VIEW", null, objectMapper.createObjectNode()));
        }
    }

    @Transactional
    public int clearPageViews(UUID actorId) {
        return repository.clearActivities(actorId, "PAGE", "VIEW");
    }

    @Transactional
    public void recordPageMutation(UUID workspaceId, UUID actorId, UUID pageId, String eventType) {
        if (!java.util.Set.of("CREATE", "EDIT", "COLLABORATE").contains(eventType)) {
            throw new IllegalArgumentException("Activity event type is invalid");
        }
        OffsetDateTime now = OffsetDateTime.now(clock);
        repository.recordActivity(
                workspaceId, actorId, "PAGE", pageId, eventType,
                objectMapper.createObjectNode(), now,
                "COLLABORATE".equals(eventType) ? now.minusMinutes(5) : null);
        analytics.record(new AnalyticsEventCommand(
                workspaceId, actorId, null, "PAGE", pageId, null,
                "EDIT", null, objectMapper.createObjectNode().put("activityType", eventType)));
    }

    @Transactional
    public void recordPageComment(UUID workspaceId, UUID actorId, UUID pageId) {
        OffsetDateTime now = OffsetDateTime.now(clock);
        repository.recordActivity(
                workspaceId, actorId, "PAGE", pageId, "COLLABORATE",
                objectMapper.createObjectNode(), now, now.minusMinutes(5));
        analytics.record(new AnalyticsEventCommand(
                workspaceId, actorId, null, "PAGE", pageId, null,
                "COMMENT", null, objectMapper.createObjectNode()));
    }
}
