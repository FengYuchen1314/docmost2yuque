package io.knowledge.platform.share;

import io.knowledge.platform.workspace.WorkspaceArchivedEvent;
import org.springframework.context.event.EventListener;
import org.springframework.stereotype.Component;

@Component
final class WorkspaceShareLifecycle {

    private final ShareRepository repository;

    WorkspaceShareLifecycle(ShareRepository repository) {
        this.repository = repository;
    }

    @EventListener
    void onWorkspaceArchived(WorkspaceArchivedEvent event) {
        repository.archiveWorkspace(event.workspaceId(), event.archivedAt());
    }
}
