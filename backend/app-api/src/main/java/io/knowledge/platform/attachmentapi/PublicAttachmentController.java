package io.knowledge.platform.attachmentapi;

import io.knowledge.platform.attachment.AttachmentService;
import java.util.UUID;
import org.springframework.core.io.Resource;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;

@RestController
@RequestMapping("/api/public/v1/attachments")
final class PublicAttachmentController {

    private final AttachmentService service;

    PublicAttachmentController(AttachmentService service) {
        this.service = service;
    }

    @GetMapping("/{attachmentId}/content")
    ResponseEntity<Resource> content(
            @PathVariable UUID attachmentId,
            @RequestParam(defaultValue = "false") boolean download) {
        return AttachmentController.response(service.publicContent(attachmentId), download);
    }
}
