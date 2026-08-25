package io.knowledge.platform.engagement;

import java.time.Clock;
import java.time.OffsetDateTime;
import java.util.List;
import java.util.Locale;
import java.util.Set;
import java.util.UUID;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;
import tools.jackson.databind.JsonNode;

@Service
public class NotificationService {

    private final EngagementRepository repository;
    private final Clock clock;

    public NotificationService(EngagementRepository repository, Clock clock) {
        this.repository = repository;
        this.clock = clock;
    }

    @Transactional
    public void notify(
            UUID recipientId,
            UUID workspaceId,
            String type,
            UUID actorId,
            String resourceType,
            UUID resourceId,
            JsonNode anchor,
            JsonNode payload,
            String aggregationKey) {
        if (!recipientId.equals(actorId)) {
            repository.notify(
                    recipientId, workspaceId, type, actorId, resourceType, resourceId,
                    anchor, payload, aggregationKey, OffsetDateTime.now(clock));
        }
    }

    @Transactional(readOnly = true)
    public void requireWorkspaceMember(UUID workspaceId, UUID userId) {
        if (workspaceId == null || userId == null || !repository.workspaceMember(workspaceId, userId)) {
            throw new IllegalArgumentException("Mentioned user is not in this workspace");
        }
    }

    @Transactional(readOnly = true)
    public List<NotificationView> list(UUID recipientId, boolean unreadOnly, int limit) {
        return page(recipientId, unreadOnly, "ALL", 0, limit).items();
    }

    @Transactional(readOnly = true)
    public NotificationPage page(
            UUID recipientId, boolean unreadOnly, String category,
            int requestedOffset, int requestedLimit) {
        String normalized = category == null ? "ALL" : category.toUpperCase(Locale.ROOT);
        if (!Set.of("ALL", "MENTIONS", "COMMENTS", "ACCESS", "UPDATES").contains(normalized)) {
            throw new IllegalArgumentException("Notification category is invalid");
        }
        int offset = Math.max(0, requestedOffset);
        int limit = Math.max(1, Math.min(requestedLimit, 100));
        List<NotificationView> values = repository.notifications(
                recipientId, unreadOnly, normalized, offset, limit + 1);
        boolean hasMore = values.size() > limit;
        List<NotificationView> items = hasMore ? values.subList(0, limit) : values;
        return new NotificationPage(List.copyOf(items), offset + items.size(), hasMore);
    }

    @Transactional
    public void read(UUID recipientId, UUID notificationId) {
        repository.readNotification(recipientId, notificationId, OffsetDateTime.now(clock));
    }

    @Transactional
    public void readAll(UUID recipientId) {
        repository.readAll(recipientId, OffsetDateTime.now(clock));
    }
}
