package io.knowledge.platform.usergroupapi;

import java.util.UUID;

final class UserGroupRequests {

    private UserGroupRequests() {}

    record Workspace(UUID workspaceId) {}

    record Id(UUID groupId) {}

    record Create(UUID workspaceId, String name, String description) {}

    record Update(UUID groupId, String name, String description) {}

    record Member(UUID groupId, UUID userId) {}
}
