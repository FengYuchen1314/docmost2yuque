package io.knowledge.platform.search;

import io.knowledge.platform.workspace.WorkspaceArchivedEvent;
import org.springframework.context.event.EventListener;
import org.springframework.stereotype.Component;

@Component
final class WorkspaceSearchLifecycle {

    private final SearchRepository repository;

    WorkspaceSearchLifecycle(SearchRepository repository) {
        this.repository = repository;
    }

    @EventListener
    void onWorkspaceArchived(WorkspaceArchivedEvent event) {
        repository.deleteWorkspace(event.workspaceId());
    }
}
