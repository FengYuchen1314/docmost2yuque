package io.knowledge.platform.setup;

import io.knowledge.platform.identity.IdentityProvisioning;
import io.knowledge.platform.identity.ProvisionedIdentity;
import io.knowledge.platform.workspace.ProvisionedWorkspace;
import io.knowledge.platform.workspace.WorkspaceProvisioning;
import java.time.Clock;
import java.time.OffsetDateTime;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

@Service
public class SetupService {

    private final InstanceSettingsRepository settingsRepository;
    private final IdentityProvisioning identityProvisioning;
    private final WorkspaceProvisioning workspaceProvisioning;
    private final Clock clock;

    SetupService(
            InstanceSettingsRepository settingsRepository,
            IdentityProvisioning identityProvisioning,
            WorkspaceProvisioning workspaceProvisioning,
            Clock clock) {
        this.settingsRepository = settingsRepository;
        this.identityProvisioning = identityProvisioning;
        this.workspaceProvisioning = workspaceProvisioning;
        this.clock = clock;
    }

    @Transactional(readOnly = true)
    public SetupStatus status() {
        return settingsRepository.getStatus();
    }

    @Transactional
    public SetupResult initialize(
            String email,
            String password,
            String passwordConfirmation,
            String workspaceName) {
        if (password == null || !password.equals(passwordConfirmation)) {
            throw new IllegalArgumentException("Password confirmation does not match");
        }

        settingsRepository.lockInitialization();
        if (settingsRepository.getStatus().initialized()) {
            throw new InstanceAlreadyInitializedException();
        }

        ProvisionedIdentity identity =
                identityProvisioning.provisionBootstrapAdmin(email, password);
        ProvisionedWorkspace workspace =
                workspaceProvisioning.provisionInitialWorkspace(identity.userId(), workspaceName);
        workspaceProvisioning.provisionPersonalWorkspace(identity.userId());
        settingsRepository.markInitialized(identity.userId(), OffsetDateTime.now(clock));

        return new SetupResult(
                identity.userId(),
                workspace.workspaceId(),
                identity.email(),
                workspace.name());
    }
}
