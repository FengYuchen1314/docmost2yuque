package io.knowledge.platform.authentication;

import io.knowledge.platform.common.SecretCipher;
import io.knowledge.platform.jobs.DurableJobHandler;
import io.knowledge.platform.jobs.LeasedJob;
import io.knowledge.platform.mail.MailDeliveryService;
import io.knowledge.platform.mail.OutboundEmail;
import java.time.Clock;
import java.time.OffsetDateTime;
import org.springframework.stereotype.Component;
import tools.jackson.databind.ObjectMapper;

@Component
class EmailChallengeDeliveryJobHandler implements DurableJobHandler {

    private final EmailChallengeRepository repository;
    private final SecretCipher secretCipher;
    private final MailDeliveryService mailDeliveryService;
    private final ObjectMapper objectMapper;
    private final Clock clock;

    EmailChallengeDeliveryJobHandler(
            EmailChallengeRepository repository,
            SecretCipher secretCipher,
            MailDeliveryService mailDeliveryService,
            ObjectMapper objectMapper,
            Clock clock) {
        this.repository = repository;
        this.secretCipher = secretCipher;
        this.mailDeliveryService = mailDeliveryService;
        this.objectMapper = objectMapper;
        this.clock = clock;
    }

    @Override
    public String jobType() {
        return "email.challenge.deliver";
    }

    @Override
    public void handle(LeasedJob job) throws Exception {
        EmailChallengeDeliveryPayload payload =
                objectMapper.treeToValue(job.payload(), EmailChallengeDeliveryPayload.class);
        EmailChallengeRecord challenge = repository.findForDelivery(payload.challengeId());
        if (challenge == null
                || challenge.encryptedDeliverySecret() == null
                || !challenge.expiresAt().isAfter(OffsetDateTime.now(clock))) {
            throw new EmailChallengeInvalidException();
        }
        String code = secretCipher.decrypt(
                "auth.code", challenge.encryptedDeliverySecret());
        String action = switch (challenge.purpose()) {
            case "PUBLIC_SIGNUP_VERIFY" -> "complete your registration";
            case "PASSWORD_RESET" -> "reset your password";
            default -> "sign in";
        };
        mailDeliveryService.send(
                payload.smtpSettingsVersion(),
                new OutboundEmail(
                        challenge.emailNormalized(),
                        "Your Knowledge Platform verification code",
                        "Use this single-use code to "
                                + action
                                + ": "
                                + code
                                + "\n\nIt expires at "
                                + challenge.expiresAt()
                                + "."));
    }
}
