package io.knowledge.platform.page;

import java.time.OffsetDateTime;
import java.util.UUID;

public record TrashItemView(
        UUID id,
        UUID workspaceId,
        String workspaceName,
        UUID knowledgeBaseId,
        String knowledgeBaseName,
        String knowledgeBaseIcon,
        String title,
        ContentType contentType,
        String path,
        UUID deletedBy,
        String deletedByName,
        String deletedByEmail,
        OffsetDateTime deletedAt,
        boolean restoreAllowed,
        boolean deleteAllowed) {

    TrashItemView withPermissions(boolean canRestore, boolean canDelete) {
        return new TrashItemView(
                id, workspaceId, workspaceName, knowledgeBaseId, knowledgeBaseName,
                knowledgeBaseIcon, title, contentType, path, deletedBy, deletedByName,
                deletedByEmail, deletedAt, canRestore, canDelete);
    }
}
