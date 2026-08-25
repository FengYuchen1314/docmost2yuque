package io.knowledge.platform.invitation;

import java.util.UUID;

public record InvitationSendPayload(
        UUID invitationId,
        long smtpSettingsVersion,
        String tokenHash) {}
