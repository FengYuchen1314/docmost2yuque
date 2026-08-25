package io.knowledge.platform.publication;

import io.knowledge.platform.workspace.WorkspaceArchivedEvent;
import org.springframework.context.event.EventListener;
import org.springframework.stereotype.Component;

@Component
final class WorkspacePublicationLifecycle {

    private final PublicationRepository repository;

    WorkspacePublicationLifecycle(PublicationRepository repository) {
        this.repository = repository;
    }

    @EventListener
    void onWorkspaceArchived(WorkspaceArchivedEvent event) {
        repository.archiveWorkspace(event.workspaceId(), event.archivedAt());
    }
}
