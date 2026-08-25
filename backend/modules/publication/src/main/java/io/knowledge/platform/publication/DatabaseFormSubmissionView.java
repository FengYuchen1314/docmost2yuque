package io.knowledge.platform.publication;

import java.time.OffsetDateTime;
import java.util.UUID;

public record DatabaseFormSubmissionView(
        UUID rowId,
        boolean duplicate,
        OffsetDateTime submittedAt) {}
