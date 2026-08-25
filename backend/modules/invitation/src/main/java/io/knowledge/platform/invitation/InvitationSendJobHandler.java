package io.knowledge.platform.invitation;

import tools.jackson.databind.ObjectMapper;
import io.knowledge.platform.common.SecretCipher;
import io.knowledge.platform.jobs.DurableJobHandler;
import io.knowledge.platform.jobs.LeasedJob;
import io.knowledge.platform.mail.MailDeliveryService;
import io.knowledge.platform.mail.OutboundEmail;
import java.time.Clock;
import java.time.OffsetDateTime;
import java.util.Objects;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.stereotype.Component;
import org.springframework.transaction.annotation.Transactional;

@Component
public class InvitationSendJobHandler implements DurableJobHandler {

    private final InvitationRepository repository;
    private final SecretCipher secretCipher;
    private final MailDeliveryService mailDeliveryService;
    private final ObjectMapper objectMapper;
    private final Clock clock;
    private final String publicBaseUrl;

    InvitationSendJobHandler(
            InvitationRepository repository,
            SecretCipher secretCipher,
            MailDeliveryService mailDeliveryService,
            ObjectMapper objectMapper,
            Clock clock,
            @Value("${platform.public-base-url:http://localhost:3000}") String publicBaseUrl) {
        this.repository = repository;
        this.secretCipher = secretCipher;
        this.mailDeliveryService = mailDeliveryService;
        this.objectMapper = objectMapper;
        this.clock = clock;
        this.publicBaseUrl = publicBaseUrl.replaceAll("/+$", "");
    }

    @Override
    public String jobType() {
        return "invitation.send";
    }

    @Override
    @Transactional
    public void handle(LeasedJob job) throws Exception {
        InvitationSendPayload payload =
                objectMapper.treeToValue(job.payload(), InvitationSendPayload.class);
        InvitationRecord invitation = repository.findForDelivery(payload.invitationId());
        if (invitation == null) {
            // A queued delivery may outlive a revoke or acceptance. That is a completed no-op,
            // not a transient failure that should consume every retry attempt.
            return;
        }
        if (payload.tokenHash() == null
                || !Objects.equals(invitation.tokenHash(), payload.tokenHash())) {
            // Every delivery is tied to the token generation that created the job. A resend
            // invalidates older queued jobs without allowing them to send the replacement token.
            return;
        }
        if (invitation.smtpSettingsVersion() != payload.smtpSettingsVersion()) {
            // A queued job must not deliver through a different SMTP configuration generation.
            return;
        }
        OffsetDateTime now = OffsetDateTime.now(clock);
        if (!invitation.expiresAt().isAfter(now)) {
            repository.markExpired(invitation.id(), now);
            return;
        }
        if (invitation.encryptedDeliveryToken() == null) {
            throw new InvitationInvalidException();
        }
        try {
            String token = secretCipher.decrypt(
                    "invitation.token", invitation.encryptedDeliveryToken());
            String acceptanceUrl = publicBaseUrl + "/invitations/accept?token=" + token;
            mailDeliveryService.send(
                    payload.smtpSettingsVersion(),
                    new OutboundEmail(
                            invitation.emailNormalized(),
                            "You have been invited to " + invitation.workspaceName(),
                            "Open this single-use invitation link before "
                                    + invitation.expiresAt()
                                    + ":\n\n"
                                    + acceptanceUrl));
            repository.markSent(
                    invitation.id(), payload.tokenHash(), OffsetDateTime.now(clock));
        } catch (RuntimeException exception) {
            repository.markDeliveryFailed(
                    invitation.id(),
                    payload.tokenHash(),
                    exception.getClass().getSimpleName(),
                    OffsetDateTime.now(clock));
            throw exception;
        }
    }
}
