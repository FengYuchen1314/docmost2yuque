package io.knowledge.platform.mail;

import tools.jackson.databind.ObjectMapper;
import io.knowledge.platform.jobs.DurableJobHandler;
import io.knowledge.platform.jobs.LeasedJob;
import org.springframework.stereotype.Component;

@Component
final class SmtpTestJobHandler implements DurableJobHandler {

    private final ObjectMapper objectMapper;
    private final SmtpSettingsService settingsService;
    private final SmtpProbe probe;

    SmtpTestJobHandler(
            ObjectMapper objectMapper,
            SmtpSettingsService settingsService,
            SmtpProbe probe) {
        this.objectMapper = objectMapper;
        this.settingsService = settingsService;
        this.probe = probe;
    }

    @Override
    public String jobType() {
        return "smtp.test";
    }

    @Override
    public void handle(LeasedJob job) throws Exception {
        SmtpTestPayload payload = objectMapper.treeToValue(job.payload(), SmtpTestPayload.class);
        try {
            SmtpConfiguration configuration =
                    settingsService.loadConfiguration(payload.settingsVersion());
            probe.sendTest(configuration, payload.recipient());
            settingsService.markTestResult(payload.settingsVersion(), true, null);
        } catch (RuntimeException exception) {
            settingsService.markTestResult(
                    payload.settingsVersion(), false, exception.getClass().getSimpleName());
            throw exception;
        }
    }
}
