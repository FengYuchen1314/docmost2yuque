package io.knowledge.platform.adminapi;

import jakarta.validation.constraints.NotNull;
import java.util.UUID;

record InvitationIdRequest(@NotNull UUID invitationId) {}
