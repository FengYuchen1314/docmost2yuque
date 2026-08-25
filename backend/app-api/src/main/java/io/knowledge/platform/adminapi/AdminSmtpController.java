package io.knowledge.platform.adminapi;

import io.knowledge.platform.mail.SmtpSettingsService;
import io.knowledge.platform.mail.SmtpSettingsView;
import io.knowledge.platform.mail.UpdateSmtpSettingsCommand;
import io.knowledge.platform.security.PlatformPrincipal;
import jakarta.validation.Valid;
import org.springframework.http.ResponseEntity;
import org.springframework.security.core.annotation.AuthenticationPrincipal;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

@RestController
@RequestMapping("/api/v1/admin/smtp")
final class AdminSmtpController {

    private final SmtpSettingsService smtpSettingsService;

    AdminSmtpController(SmtpSettingsService smtpSettingsService) {
        this.smtpSettingsService = smtpSettingsService;
    }

    @GetMapping
    SmtpSettingsView get() {
        return smtpSettingsService.get();
    }

    @PostMapping("/update")
    SmtpSettingsView update(
            @Valid @RequestBody SmtpUpdateRequest request,
            @AuthenticationPrincipal PlatformPrincipal principal) {
        return smtpSettingsService.update(new UpdateSmtpSettingsCommand(
                request.host(),
                request.port(),
                request.security(),
                request.username(),
                request.password(),
                request.clearPassword(),
                request.fromName(),
                request.fromAddress(),
                request.replyTo(),
                request.enabled(),
                principal.userId()));
    }

    @PostMapping("/test")
    ResponseEntity<Void> test(
            @Valid @RequestBody SmtpTestRequest request,
            @AuthenticationPrincipal PlatformPrincipal principal) {
        String recipient = request.recipient() == null || request.recipient().isBlank()
                ? principal.email()
                : request.recipient();
        smtpSettingsService.queueTest(principal.userId(), recipient);
        return ResponseEntity.accepted().build();
    }
}
