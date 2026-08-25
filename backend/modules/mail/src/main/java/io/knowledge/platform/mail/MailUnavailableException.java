package io.knowledge.platform.mail;

public final class MailUnavailableException extends RuntimeException {

    private static final long serialVersionUID = 1L;

    public MailUnavailableException() {
        super("A successfully tested and enabled SMTP configuration is required");
    }
}
