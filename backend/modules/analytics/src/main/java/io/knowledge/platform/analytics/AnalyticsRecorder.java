package io.knowledge.platform.analytics;

import io.knowledge.platform.common.Ids;
import java.time.Clock;
import java.time.OffsetDateTime;
import java.util.Locale;
import java.util.Set;
import java.util.UUID;
import org.jooq.JSONB;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;
import tools.jackson.databind.ObjectMapper;

@Service
public class AnalyticsRecorder {
    private static final Set<String> TYPES = Set.of("PAGE", "KNOWLEDGE_BASE", "QUICK_NOTE");
    private static final Set<String> EVENTS = Set.of("VIEW", "EDIT", "COMMENT", "SHARE", "EXPORT", "REACTION");
    private final AnalyticsRepository repository;
    private final ObjectMapper objectMapper;
    private final Clock clock;

    public AnalyticsRecorder(AnalyticsRepository repository, ObjectMapper objectMapper, Clock clock) {
        this.repository = repository; this.objectMapper = objectMapper; this.clock = clock;
    }

    @Transactional
    public void record(AnalyticsEventCommand input) {
        if (input == null || input.workspaceId() == null || input.resourceId() == null
                || (input.actorId() == null && (input.anonymousVisitorHash() == null || input.anonymousVisitorHash().isBlank()))) {
            throw new IllegalArgumentException("Analytics event identity is invalid");
        }
        String resourceType = normalize(input.resourceType(), TYPES, "Analytics resource type");
        String eventType = normalize(input.eventType(), EVENTS, "Analytics event type");
        UUID knowledgeBaseId = input.knowledgeBaseId();
        if ("PAGE".equals(resourceType) && knowledgeBaseId == null) knowledgeBaseId = repository.pageKnowledgeBase(input.resourceId());
        var command = new AnalyticsEventCommand(input.workspaceId(), input.actorId(), trim(input.anonymousVisitorHash(), 128),
                resourceType, input.resourceId(), knowledgeBaseId, eventType, trim(input.sessionId(), 128), input.metadata());
        JSONB metadata = JSONB.valueOf(objectMapper.writeValueAsString(
                input.metadata() == null ? objectMapper.createObjectNode() : input.metadata()));
        repository.record(Ids.next(), command, metadata, OffsetDateTime.now(clock));
    }

    private static String normalize(String value, Set<String> allowed, String label) {
        String normalized = value == null ? "" : value.toUpperCase(Locale.ROOT);
        if (!allowed.contains(normalized)) throw new IllegalArgumentException(label + " is invalid");
        return normalized;
    }
    private static String trim(String value, int max) { if (value == null || value.isBlank()) return null; String v=value.trim(); return v.substring(0, Math.min(v.length(), max)); }
}
