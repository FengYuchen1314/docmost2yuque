package io.knowledge.platform.authentication;

public final class EmailCodeLoginDisabledException extends RuntimeException {

    private static final long serialVersionUID = 1L;

    public EmailCodeLoginDisabledException() {
        super("Email code login is disabled");
    }
}
