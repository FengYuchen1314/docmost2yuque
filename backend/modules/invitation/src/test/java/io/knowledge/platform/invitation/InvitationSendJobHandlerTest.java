package io.knowledge.platform.invitation;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.verifyNoInteractions;
import static org.mockito.Mockito.when;

import io.knowledge.platform.common.SecretCipher;
import io.knowledge.platform.jobs.LeasedJob;
import io.knowledge.platform.mail.MailDeliveryService;
import io.knowledge.platform.mail.OutboundEmail;
import java.time.Clock;
import java.time.Instant;
import java.time.OffsetDateTime;
import java.time.ZoneOffset;
import java.util.List;
import java.util.UUID;
import org.junit.jupiter.api.Test;
import org.mockito.ArgumentCaptor;
import org.springframework.transaction.annotation.Transactional;
import tools.jackson.databind.ObjectMapper;

class InvitationSendJobHandlerTest {

    private static final Instant NOW = Instant.parse("2026-08-25T01:00:00Z");
    private static final String TOKEN_HASH = "a".repeat(64);

    private final InvitationRepository repository = mock(InvitationRepository.class);
    private final SecretCipher secretCipher = mock(SecretCipher.class);
    private final MailDeliveryService mailDeliveryService = mock(MailDeliveryService.class);
    private final ObjectMapper objectMapper = new ObjectMapper();
    private final InvitationSendJobHandler handler = new InvitationSendJobHandler(
            repository,
            secretCipher,
            mailDeliveryService,
            objectMapper,
            Clock.fixed(NOW, ZoneOffset.UTC),
            "https://knowledge.example/");

    @Test
    void skipsAJobFromAnOlderTokenGeneration() throws Exception {
        UUID invitationId = UUID.randomUUID();
        when(repository.findForDelivery(invitationId)).thenReturn(invitation(invitationId));

        handler.handle(job(new InvitationSendPayload(
                invitationId,
                7,
                "b".repeat(64))));

        verifyNoInteractions(secretCipher, mailDeliveryService);
    }

    @Test
    void skipsLegacyPayloadsThatCannotProveTheirTokenGeneration() throws Exception {
        UUID invitationId = UUID.randomUUID();
        when(repository.findForDelivery(invitationId)).thenReturn(invitation(invitationId));
        var payload = objectMapper.createObjectNode();
        payload.put("invitationId", invitationId.toString());
        payload.put("smtpSettingsVersion", 7);

        handler.handle(new LeasedJob(
                UUID.randomUUID(), "invitation.send", "legacy", payload, 1, 8));

        verifyNoInteractions(secretCipher, mailDeliveryService);
    }

    @Test
    void sendsAndMarksOnlyTheMatchingTokenGeneration() throws Exception {
        UUID invitationId = UUID.randomUUID();
        when(repository.findForDelivery(invitationId)).thenReturn(invitation(invitationId));
        when(secretCipher.decrypt("invitation.token", "encrypted-token"))
                .thenReturn("clear-token");

        handler.handle(job(new InvitationSendPayload(invitationId, 7, TOKEN_HASH)));

        ArgumentCaptor<OutboundEmail> email = ArgumentCaptor.forClass(OutboundEmail.class);
        verify(mailDeliveryService).send(eq(7L), email.capture());
        assertThat(email.getValue().recipient()).isEqualTo("member@example.com");
        assertThat(email.getValue().plainTextBody())
                .contains("https://knowledge.example/invitations/accept?token=clear-token");
        verify(repository).markSent(
                invitationId,
                TOKEN_HASH,
                OffsetDateTime.ofInstant(NOW, ZoneOffset.UTC));
    }

    @Test
    void holdsTheInvitationRowLockForTheWholeDeliveryTransaction() throws Exception {
        assertThat(InvitationSendJobHandler.class
                        .getMethod("handle", LeasedJob.class)
                        .getAnnotation(Transactional.class))
                .isNotNull();
    }

    private LeasedJob job(InvitationSendPayload payload) {
        return new LeasedJob(
                UUID.randomUUID(),
                "invitation.send",
                "invitation-send:" + payload.invitationId(),
                objectMapper.valueToTree(payload),
                1,
                8);
    }

    private static InvitationRecord invitation(UUID invitationId) {
        return new InvitationRecord(
                invitationId,
                UUID.randomUUID(),
                "Primary Workspace",
                "member@example.com",
                "member@example.com",
                TOKEN_HASH,
                "encrypted-token",
                "MEMBER",
                List.of(),
                List.of(),
                "QUEUED",
                7,
                OffsetDateTime.ofInstant(NOW.plusSeconds(3_600), ZoneOffset.UTC),
                null);
    }
}
