package io.knowledge.platform.setup;

public final class SmtpNotReadyException extends RuntimeException {

    private static final long serialVersionUID = 1L;

    public SmtpNotReadyException() {
        super("A successfully tested and enabled SMTP configuration is required");
    }
}
