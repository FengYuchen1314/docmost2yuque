package io.knowledge.platform.setup;

import tools.jackson.databind.JsonNode;
import tools.jackson.databind.ObjectMapper;
import io.knowledge.platform.mail.SmtpSettingsService;
import java.time.Clock;
import java.time.OffsetDateTime;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

@Service
public class InstanceAdministrationService {

    private final InstanceSettingsRepository repository;
    private final SmtpSettingsService smtpSettingsService;
    private final ObjectMapper objectMapper;
    private final Clock clock;

    InstanceAdministrationService(
            InstanceSettingsRepository repository,
            SmtpSettingsService smtpSettingsService,
            ObjectMapper objectMapper,
            Clock clock) {
        this.repository = repository;
        this.smtpSettingsService = smtpSettingsService;
        this.objectMapper = objectMapper;
        this.clock = clock;
    }

    @Transactional(readOnly = true)
    public RegistrationSettings getRegistrationSettings() {
        InstanceAuthSettings settings = repository.getAuthSettings();
        return toView(settings, smtpSettingsService.isReady());
    }

    @Transactional
    public RegistrationSettings updateRegistrationSettings(
            UpdateRegistrationSettings command) {
        if (!command.passwordLoginEnabled() && !command.emailCodeLoginEnabled()) {
            throw new IllegalArgumentException("At least one login method must remain enabled");
        }
        boolean smtpReady = smtpSettingsService.isReady();
        if ((command.registrationMode() == RegistrationMode.PUBLIC
                        || command.emailCodeLoginEnabled())
                && !smtpReady) {
            throw new SmtpNotReadyException();
        }
        JsonNode authMethods = objectMapper.createObjectNode()
                .put("password", command.passwordLoginEnabled())
                .put("emailCode", command.emailCodeLoginEnabled());
        InstanceAuthSettings updated = repository.updateAuthSettings(
                command.registrationMode().name(),
                authMethods,
                OffsetDateTime.now(clock));
        return toView(updated, smtpReady);
    }

    private static RegistrationSettings toView(
            InstanceAuthSettings settings,
            boolean smtpReady) {
        return new RegistrationSettings(
                RegistrationMode.valueOf(settings.registrationMode()),
                settings.passwordLoginEnabled(),
                settings.emailCodeLoginEnabled(),
                smtpReady,
                settings.settingsVersion());
    }
}
