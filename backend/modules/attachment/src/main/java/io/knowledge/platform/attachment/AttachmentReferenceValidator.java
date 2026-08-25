package io.knowledge.platform.attachment;

import java.util.UUID;

public interface AttachmentReferenceValidator {

    void requirePageAttachment(UUID pageId, UUID attachmentId);
}
