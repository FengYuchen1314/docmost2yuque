package io.knowledge.platform.engagement;

import java.time.OffsetDateTime;
import java.util.List;
import java.util.UUID;

public record WorkbenchItem(
        UUID resourceId,
        String resourceType,
        UUID workspaceId,
        UUID knowledgeBaseId,
        String knowledgeBaseName,
        String title,
        String path,
        String contentType,
        String publicationStatus,
        String reason,
        OffsetDateTime activityAt,
        boolean favorite,
        List<WorkbenchCollaborator> collaborators) {

    public WorkbenchItem withCollaborators(List<WorkbenchCollaborator> values) {
        return new WorkbenchItem(
                resourceId, resourceType, workspaceId, knowledgeBaseId, knowledgeBaseName,
                title, path, contentType, publicationStatus, reason, activityAt, favorite,
                List.copyOf(values));
    }
}
