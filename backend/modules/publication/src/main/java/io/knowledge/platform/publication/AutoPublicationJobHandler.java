package io.knowledge.platform.publication;

import io.knowledge.platform.jobs.DurableJobHandler;
import io.knowledge.platform.jobs.LeasedJob;
import org.springframework.stereotype.Component;
import tools.jackson.databind.ObjectMapper;

@Component
final class AutoPublicationJobHandler implements DurableJobHandler {

    private final PublicationService publications;
    private final ObjectMapper mapper;

    AutoPublicationJobHandler(PublicationService publications, ObjectMapper mapper) {
        this.publications = publications;
        this.mapper = mapper;
    }

    @Override
    public String jobType() {
        return "page.auto-publish";
    }

    @Override
    public void handle(LeasedJob job) throws Exception {
        AutoPublicationPayload payload =
                mapper.treeToValue(job.payload(), AutoPublicationPayload.class);
        publications.autoPublish(
                payload.actorId(), payload.pageId(), payload.draftRevision(),
                job.idempotencyKey());
    }
}
