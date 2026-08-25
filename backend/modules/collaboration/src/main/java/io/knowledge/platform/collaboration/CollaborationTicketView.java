package io.knowledge.platform.collaboration;

import java.time.OffsetDateTime;

public record CollaborationTicketView(
        String ticket,
        String websocketPath,
        OffsetDateTime expiresAt) {}
