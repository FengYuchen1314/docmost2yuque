package io.knowledge.platform.adminapi;

import io.knowledge.platform.setup.InstanceAdministrationService;
import io.knowledge.platform.setup.RegistrationSettings;
import io.knowledge.platform.setup.UpdateRegistrationSettings;
import jakarta.validation.Valid;
import jakarta.validation.constraints.NotNull;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

@RestController
@RequestMapping("/api/v1/admin/auth-settings")
final class AdminAuthSettingsController {

    private final InstanceAdministrationService administrationService;

    AdminAuthSettingsController(InstanceAdministrationService administrationService) {
        this.administrationService = administrationService;
    }

    @GetMapping
    RegistrationSettings get() {
        return administrationService.getRegistrationSettings();
    }

    @PostMapping("/registration")
    RegistrationSettings update(@Valid @RequestBody UpdateRequest request) {
        return administrationService.updateRegistrationSettings(
                new UpdateRegistrationSettings(
                        request.registrationMode(),
                        request.passwordLoginEnabled(),
                        request.emailCodeLoginEnabled()));
    }

    record UpdateRequest(
            @NotNull io.knowledge.platform.setup.RegistrationMode registrationMode,
            boolean passwordLoginEnabled,
            boolean emailCodeLoginEnabled) {}
}
