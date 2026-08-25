package io.knowledge.platform.attachment;

import org.springframework.core.io.Resource;

public record AttachmentContent(AttachmentView attachment, Resource resource) {}
