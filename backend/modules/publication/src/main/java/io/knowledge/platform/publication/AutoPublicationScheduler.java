package io.knowledge.platform.publication;

import io.knowledge.platform.jobs.JobQueue;
import io.knowledge.platform.page.PageDraftChangedEvent;
import java.time.Clock;
import java.time.Duration;
import java.time.OffsetDateTime;
import org.springframework.stereotype.Component;
import org.springframework.transaction.event.TransactionPhase;
import org.springframework.transaction.event.TransactionalEventListener;
import tools.jackson.databind.ObjectMapper;

@Component
final class AutoPublicationScheduler {

    private static final Duration DEBOUNCE = Duration.ofSeconds(2);
    private static final int MAX_ATTEMPTS = 5;
    private final JobQueue jobs;
    private final PublicationRepository publications;
    private final ObjectMapper mapper;
    private final Clock clock;

    AutoPublicationScheduler(
            JobQueue jobs,
            PublicationRepository publications,
            ObjectMapper mapper,
            Clock clock) {
        this.jobs = jobs;
        this.publications = publications;
        this.mapper = mapper;
        this.clock = clock;
    }

    @TransactionalEventListener(phase = TransactionPhase.BEFORE_COMMIT)
    void schedule(PageDraftChangedEvent event) {
        if (!publications.autoPublishEnabled(event.pageId())) return;
        String key = "page-auto-publish:" + event.pageId() + ":" + event.draftRevision();
        jobs.enqueue(
                "page.auto-publish",
                key,
                mapper.valueToTree(new AutoPublicationPayload(
                        event.pageId(), event.actorId(), event.draftRevision())),
                OffsetDateTime.now(clock).plus(DEBOUNCE),
                MAX_ATTEMPTS);
    }
}
