package io.knowledge.platform.mail;

import org.springframework.stereotype.Service;

@Service
public class MailDeliveryService {

    private final SmtpSettingsService settingsService;
    private final SmtpProbe smtpProbe;

    MailDeliveryService(
            SmtpSettingsService settingsService,
            SmtpProbe smtpProbe) {
        this.settingsService = settingsService;
        this.smtpProbe = smtpProbe;
    }

    public void send(long settingsVersion, OutboundEmail email) {
        SmtpConfiguration configuration =
                settingsService.loadReadyConfiguration(settingsVersion);
        smtpProbe.send(configuration, email);
    }
}
