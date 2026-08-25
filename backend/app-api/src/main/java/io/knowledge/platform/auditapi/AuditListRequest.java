package io.knowledge.platform.auditapi;

import java.util.UUID;

record AuditListRequest(UUID workspaceId, Integer limit, Integer offset) {}
