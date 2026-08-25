package io.knowledge.platform.invitation;

import io.knowledge.platform.identity.AuthenticatedIdentity;
import java.util.UUID;

public record AcceptedInvitation(
        UUID invitationId,
        UUID workspaceId,
        AuthenticatedIdentity identity) {}
