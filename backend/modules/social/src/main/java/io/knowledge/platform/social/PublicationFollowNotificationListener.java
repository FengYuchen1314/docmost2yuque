package io.knowledge.platform.social;

import io.knowledge.platform.engagement.NotificationService;
import io.knowledge.platform.publication.PublicationPublishedEvent;
import org.springframework.stereotype.Component;
import org.springframework.transaction.event.TransactionPhase;
import org.springframework.transaction.event.TransactionalEventListener;
import tools.jackson.databind.ObjectMapper;

@Component
final class PublicationFollowNotificationListener {

    private final SocialRepository repository;
    private final NotificationService notifications;
    private final ObjectMapper mapper;

    PublicationFollowNotificationListener(
            SocialRepository repository,
            NotificationService notifications,
            ObjectMapper mapper) {
        this.repository = repository;
        this.notifications = notifications;
        this.mapper = mapper;
    }

    @TransactionalEventListener(phase = TransactionPhase.BEFORE_COMMIT)
    void published(PublicationPublishedEvent event) {
        if (!"PUBLIC".equals(event.visibility())) return;
        var payload = mapper.createObjectNode()
                .put("publicationId", event.publicationId().toString())
                .put("pageId", event.pageId().toString())
                .put("knowledgeBaseId", event.knowledgeBaseId().toString())
                .put("title", event.title())
                .put("preview", event.preview())
                .put("contentType", event.contentType());
        var anchor = mapper.createObjectNode()
                .put("publicationId", event.publicationId().toString());
        for (var recipient : repository.publicationNotificationRecipients(
                event.publishedBy(), event.knowledgeBaseId())) {
            notifications.notify(
                    recipient,
                    event.workspaceId(),
                    "PUBLICATION",
                    event.publishedBy(),
                    "PAGE",
                    event.pageId(),
                    anchor,
                    payload,
                    "publication:" + event.publicationId());
        }
    }
}
